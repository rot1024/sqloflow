import type { ConversionContext } from './types.js';
import type { SchemaSnapshot, RelationSchema, ColumnSchema } from '../types/ir.js';
import { getColumnName } from './helpers.js';

export const createSnapshot = (ctx: ConversionContext, stepId: string): void => {
  const snapshot: SchemaSnapshot = {
    stepId,
    relations: JSON.parse(JSON.stringify(ctx.currentSchema)) // Deep copy
  };
  ctx.snapshots.push(snapshot);
};

export const applySchemaTransformation = (
  ctx: ConversionContext,
  nodeId: string,
  transformation: (schema: Record<string, RelationSchema>) => Record<string, RelationSchema>
): void => {
  ctx.currentSchema = transformation(ctx.currentSchema);
  createSnapshot(ctx, nodeId);
};

export const applySelectTransformation = (ctx: ConversionContext, nodeId: string, columns: any[]): void => {
  applySchemaTransformation(ctx, nodeId, (schema) => {
    const newSchema: Record<string, RelationSchema> = {};
    
    // Create a new relation for the SELECT result
    const resultRelation: RelationSchema = {
      name: '_result',
      columns: []
    };
    
    // Handle SELECT *
    if (columns.length === 1 && columns[0].expr?.type === 'star') {
      // Copy all columns from all relations
      for (const relation of Object.values(schema)) {
        if (!relation.name.startsWith('_')) {
          for (const col of relation.columns) {
            resultRelation.columns.push({
              id: `_result.${col.name}`,
              name: col.name,
              type: col.type,
              source: col.source
            });
          }
        }
      }
    } else {
      // Handle specific columns
      for (const col of columns) {
        if (col.expr) {
          if (col.expr.type === 'column_ref') {
            const colName = getColumnName(col.expr);
            const alias = col.as || colName;
            const tableName = col.expr.table;
            
            // Find the source column in current schema
            let sourceColumn: ColumnSchema | undefined;
            for (const relation of Object.values(schema)) {
              sourceColumn = relation.columns.find(c => {
                if (tableName) {
                  // If table is specified, match table.column format
                  return c.name === col.expr.column || c.id === `${tableName}.${col.expr.column}`;
                }
                return c.name === colName || c.id === colName;
              });
              if (sourceColumn) break;
            }
            
            // If column not found in schema, infer it
            if (!sourceColumn) {
              sourceColumn = {
                id: tableName ? `${tableName}.${col.expr.column}` : colName,
                name: col.expr.column || colName,
                type: undefined, // Unknown type
                source: tableName || '_unknown'
              };
            }
            
            resultRelation.columns.push({
              id: `_result.${alias}`,
              name: alias,
              type: sourceColumn.type,
              source: sourceColumn.source
            });
          } else if (col.expr.type === 'aggr_func') {
            const funcName = col.expr.name.toUpperCase();
            const alias = col.as || funcName;
            
            resultRelation.columns.push({
              id: `_result.${alias}`,
              name: alias,
              type: 'numeric', // Simplified type inference
              source: '_aggregate'
            });
          } else {
            // Handle other expression types (constants, functions, etc.)
            const alias = col.as || 'expr';
            resultRelation.columns.push({
              id: `_result.${alias}`,
              name: alias,
              type: undefined,
              source: '_expression'
            });
          }
        }
      }
    }
    
    newSchema['_result'] = resultRelation;
    return newSchema;
  });
};

export const applyJoinTransformation = (ctx: ConversionContext, nodeId: string, tableNames: string[]): void => {
  applySchemaTransformation(ctx, nodeId, (schema) => {
    const newSchema: Record<string, RelationSchema> = {};
    
    // Preserve all existing relations and their columns
    for (const [relationName, relation] of Object.entries(schema)) {
      newSchema[relationName] = {
        name: relation.name,
        columns: [...relation.columns]
      };
    }
    
    return newSchema;
  });
};

export const applyGroupByTransformation = (ctx: ConversionContext, nodeId: string, groupByColumns: any): void => {
  applySchemaTransformation(ctx, nodeId, (schema) => {
    const newSchema: Record<string, RelationSchema> = {};
    
    // After GROUP BY, only grouped columns and aggregates are available
    const groupedRelation: RelationSchema = {
      name: '_grouped',
      columns: []
    };
    
    // Add grouped columns - groupByColumns.columns contains the actual column list
    const columns = groupByColumns?.columns || [];
    for (const col of columns) {
      // Handle different GROUP BY formats
      let colName: string;
      if (typeof col === 'object') {
        if (col.type === 'column_ref') {
          // Extract column name from column_ref
          colName = col.column?.expr?.value || col.column || 'expr';
        } else {
          colName = col.column || 'expr';
        }
      } else {
        colName = col;
      }
      
      // Find the source column
      let sourceColumn: ColumnSchema | undefined;
      for (const relation of Object.values(schema)) {
        sourceColumn = relation.columns.find(c => c.name === colName);
        if (sourceColumn) break;
      }
      
      if (!sourceColumn) {
        // Infer column if not found
        sourceColumn = {
          id: colName,
          name: colName,
          type: undefined,
          source: '_inferred'
        };
      }
      
      groupedRelation.columns.push({
        ...sourceColumn,
        id: `_grouped.${colName}`
      });
    }
    
    newSchema['_grouped'] = groupedRelation;
    return newSchema;
  });
};

// Extract column references from WHERE/ON expressions and add to schema
export const inferColumnsFromExpression = (ctx: ConversionContext, expr: any): void => {
  if (!expr) return;
  
  if (expr.type === 'binary_expr') {
    inferColumnsFromExpression(ctx, expr.left);
    inferColumnsFromExpression(ctx, expr.right);
  } else if (expr.type === 'column_ref') {
    const tableName = expr.table;
    // Extract column name from nested structure
    const columnName = expr.column?.expr?.value || expr.column;
    
    if (columnName && typeof columnName === 'string') {
      // Find the relation to add the column to
      let targetRelation: string | undefined;
      
      if (tableName) {
        targetRelation = tableName;
      } else {
        // No table specified, try to find any non-special relation
        targetRelation = Object.keys(ctx.currentSchema).find(key => 
          !key.startsWith('_') && ctx.currentSchema[key]
        );
      }
      
      if (targetRelation && ctx.currentSchema[targetRelation]) {
        // Check if column already exists
        const exists = ctx.currentSchema[targetRelation].columns.some(
          c => c.name === columnName
        );
        
        if (!exists) {
          // Add inferred column
          ctx.currentSchema[targetRelation].columns.push({
            id: `${targetRelation}.${columnName}`,
            name: columnName,
            type: undefined,
            source: targetRelation
          });
        }
      }
    }
  } else if (expr.type === 'function') {
    // Process function arguments
    if (expr.args && expr.args.value) {
      for (const arg of expr.args.value) {
        inferColumnsFromExpression(ctx, arg);
      }
    }
  }
};