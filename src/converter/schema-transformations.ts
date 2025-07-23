import type { ConversionContext } from './types.js';
import type { SchemaSnapshot, ColumnSchema } from '../types/ir.js';
import type { Column, ExpressionValue, ColumnRef, Select } from 'node-sql-parser';
import { getColumnName } from './helpers.js';

export const createSnapshot = (ctx: ConversionContext, nodeId: string): void => {
  // Deep copy columns and omit sourceNodeId if it matches the current nodeId
  const columns = ctx.currentColumns.map(col => {
    const columnCopy = JSON.parse(JSON.stringify(col));
    if (columnCopy.sourceNodeId === nodeId) {
      delete columnCopy.sourceNodeId;
    }
    return columnCopy;
  });
  
  const snapshot: SchemaSnapshot = {
    nodeId,
    schema: {
      columns
    }
  };
  ctx.snapshots.push(snapshot);
};

export const applySchemaTransformation = (
  ctx: ConversionContext,
  nodeId: string,
  transformation: (columns: ColumnSchema[]) => ColumnSchema[]
): void => {
  ctx.currentColumns = transformation(ctx.currentColumns);
  createSnapshot(ctx, nodeId);
};

export const applySelectTransformation = (ctx: ConversionContext, nodeId: string, columns: Column[]): void => {
  applySchemaTransformation(ctx, nodeId, (currentColumns) => {
    const resultColumns: ColumnSchema[] = [];
    
    // Handle SELECT *
    if (columns.length === 1 && columns[0].expr?.type === 'star') {
      // Copy all columns from current schema
      for (const col of currentColumns) {
        resultColumns.push({
          id: col.name,
          name: col.name,
          type: col.type,
          source: col.source,
          table: col.table
        });
      }
    } else {
      // Handle specific columns
      for (const col of columns) {
        if (col.expr) {
          if (col.expr.type === 'column_ref') {
            const colName = getColumnName(col.expr);
            const alias = typeof col.as === 'string' ? col.as : col.as?.value || colName;
            const tableName = 'table' in col.expr ? col.expr.table : null;
            
            // Find the source column in current schema
            let sourceColumn: ColumnSchema | undefined = currentColumns.find(c => {
              if (tableName) {
                // If table is specified, match by source (alias)
                const columnValue = 'column' in col.expr && typeof col.expr.column === 'string' 
                  ? col.expr.column 
                  : colName;
                return c.source === tableName && c.name === columnValue;
              }
              return c.name === colName;
            });
            
            // If column not found in schema, infer it
            if (!sourceColumn) {
              let columnValue = colName;
              if ('column' in col.expr) {
                columnValue = typeof col.expr.column === 'string' ? col.expr.column : colName;
              }
              sourceColumn = {
                id: tableName ? `${tableName}.${columnValue}` : columnValue,
                name: columnValue,
                type: undefined, // Unknown type
                source: tableName || undefined,
                table: ctx.currentRelations[tableName || '']?.name
                // Don't set sourceNodeId - this is a reference to an unknown column
              };
            }
            
            resultColumns.push({
              id: alias,
              name: alias,
              type: sourceColumn.type,
              source: sourceColumn.source,
              table: sourceColumn.table,
              sourceNodeId: sourceColumn.sourceNodeId
            });
          } else if (col.expr.type === 'aggr_func' && 'name' in col.expr) {
            const funcName = typeof col.expr.name === 'string' ? col.expr.name.toUpperCase() : 'UNKNOWN';
            const alias = typeof col.as === 'string' ? col.as : col.as?.value || funcName;
            
            resultColumns.push({
              id: alias,
              name: alias,
              type: 'numeric' // Simplified type inference
              // No source for aggregate functions
            });
          } else {
            // Handle other expression types (constants, functions, etc.)
            const alias = typeof col.as === 'string' ? col.as : col.as?.value || 'expr';
            resultColumns.push({
              id: alias,
              name: alias,
              type: undefined
              // No source for expressions
            });
          }
        }
      }
    }
    
    return resultColumns;
  });
};

export const applyJoinTransformation = (ctx: ConversionContext, nodeId: string, tableNames: string[]): void => {
  // When joining, we simply preserve all columns from both tables
  // The columns are already in ctx.currentColumns from FROM and previous JOINs
  createSnapshot(ctx, nodeId);
};

export const applyGroupByTransformation = (ctx: ConversionContext, nodeId: string, groupByColumns: Select['groupby']): void => {
  applySchemaTransformation(ctx, nodeId, (currentColumns) => {
    const groupedColumns: ColumnSchema[] = [];
    
    // Add grouped columns - groupByColumns.columns contains the actual column list
    const columns = groupByColumns?.columns || [];
    for (const col of columns) {
      // Handle different GROUP BY formats
      let colName: string;
      if (col && typeof col === 'object' && 'type' in col && col.type === 'column_ref') {
        // Extract column name from column_ref
        const columnRef = col as ColumnRef;
        if ('column' in columnRef) {
          colName = typeof columnRef.column === 'string' 
            ? columnRef.column 
            : (columnRef.column as any)?.expr?.value || 'expr';
        } else {
          // ColumnRefExpr
          colName = 'expr';
        }
      } else {
        colName = 'expr';
      }
      
      // Find the source column
      let sourceColumn = currentColumns.find(c => c.name === colName);
      
      if (!sourceColumn) {
        // Infer column if not found
        sourceColumn = {
          id: colName,
          name: colName,
          type: undefined
          // Don't set sourceNodeId - this is a reference to an unknown column
        };
      }
      
      groupedColumns.push({
        ...sourceColumn,
        id: colName
      });
    }
    
    return groupedColumns;
  });
};

// Extract column references from WHERE/ON expressions and add to schema
export const inferColumnsFromExpression = (ctx: ConversionContext, expr: ExpressionValue | null): void => {
  if (!expr) return;
  
  if (expr.type === 'binary_expr' && 'left' in expr && 'right' in expr) {
    inferColumnsFromExpression(ctx, expr.left as ExpressionValue);
    inferColumnsFromExpression(ctx, expr.right as ExpressionValue);
  } else if (expr.type === 'column_ref') {
    let tableName: string | null = null;
    let columnName: string | undefined;
    
    if ('table' in expr) {
      // ColumnRefItem
      tableName = expr.table;
      columnName = typeof expr.column === 'string' 
        ? expr.column 
        : (expr.column as any)?.expr?.value;
    } else if ('expr' in expr && expr.expr) {
      // ColumnRefExpr
      const item = expr.expr as any; // ColumnRefItem inside ColumnRefExpr
      tableName = item.table || null;
      columnName = typeof item.column === 'string' 
        ? item.column 
        : item.column?.expr?.value;
    }
    
    if (columnName && typeof columnName === 'string') {
      // Check if column already exists in current schema
      const exists = ctx.currentColumns.some(c => 
        c.name === columnName && (!tableName || c.source === tableName)
      );
      
      if (!exists) {
        // Add inferred column - these are references discovered in WHERE/ON clauses
        const relationInfo = tableName ? ctx.currentRelations[tableName] : undefined;
        // If we know which node introduced this table alias, use that as sourceNodeId
        const sourceNodeId = tableName && ctx.tableSourceNodes ? ctx.tableSourceNodes[tableName] : undefined;
        
        ctx.currentColumns.push({
          id: tableName ? `${tableName}.${columnName}` : columnName,
          name: columnName,
          type: undefined,
          source: tableName || undefined,
          table: relationInfo?.name,
          sourceNodeId
        });
      }
    }
  } else if (expr.type === 'function' && 'args' in expr) {
    // Process function arguments
    if (expr.args && 'value' in expr.args && Array.isArray(expr.args.value)) {
      for (const arg of expr.args.value) {
        inferColumnsFromExpression(ctx, arg);
      }
    }
  }
};

export const applyUnionTransformation = (ctx: ConversionContext, nodeId: string): void => {
  // For UNION, we keep the columns from the first SELECT
  // The columns should already be in ctx.currentColumns from the SELECT transformation
  createSnapshot(ctx, nodeId);
};