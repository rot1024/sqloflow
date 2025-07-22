import type { SchemaInfo, TableSchema, ColumnSchema } from '../types/schema.js';
import type { AST, Create, ColumnRef } from 'node-sql-parser';

// Local type definitions for unexported types from node-sql-parser
type DataType = {
  dataType?: string;
  length?: number;
  scale?: number;
};

type CreateColumnDefinition = {
  resource: 'column';
  column: ColumnRef;
  definition: DataType;
  nullable?: { value: string };
  primary_key?: 'key' | 'primary key';
  unique?: 'unique' | 'unique key';
  default_val?: { value: any };
  comment?: { value: string };
};

export const extractSchema = (ast: AST[]): SchemaInfo => {
  const schema: SchemaInfo = { tables: {} };

  for (const statement of ast) {
    if (statement.type === 'create' && statement.keyword === 'table') {
      const tableSchema = extractTableSchema(statement);
      if (tableSchema) {
        const tableName = getTableName(statement.table);
        schema.tables[tableName] = tableSchema;
      }
    }
  }

  return schema;
};

const extractTableSchema = (createStmt: Create): TableSchema | null => {
  if (!createStmt.table || !createStmt.create_definitions) {
    return null;
  }

  const tableName = getTableName(createStmt.table);
  const columns: ColumnSchema[] = [];

  for (const def of createStmt.create_definitions) {
    if (def.resource === 'column') {
      const column = extractColumnSchema(def as CreateColumnDefinition);
      if (column) {
        columns.push(column);
      }
    }
  }

  return {
    name: tableName,
    columns
  };
};

const extractColumnSchema = (colDef: CreateColumnDefinition): ColumnSchema | null => {
  if (!colDef.column || !colDef.definition) {
    return null;
  }

  // Extract column name from ColumnRef structure
  let columnName = 'unknown';
  
  if ('type' in colDef.column && colDef.column.type === 'column_ref') {
    // ColumnRefItem
    columnName = typeof colDef.column.column === 'string' 
      ? colDef.column.column 
      : (colDef.column.column as any)?.expr?.value || 'unknown';
  } else if ('type' in colDef.column && colDef.column.type === 'expr') {
    // ColumnRefExpr
    const expr = colDef.column.expr;
    columnName = typeof expr.column === 'string' 
      ? expr.column 
      : (expr.column as any)?.expr?.value || 'unknown';
  }

  const column: ColumnSchema = {
    name: columnName,
    type: extractDataType(colDef.definition)
  };

  // Extract column constraints
  if (colDef.nullable) {
    column.nullable = colDef.nullable.value !== 'not null';
  }

  if (colDef.primary_key) {
    column.primary_key = true;
  }

  if (colDef.unique) {
    column.unique = true;
  }

  if (colDef.default_val) {
    column.default = colDef.default_val.value;
  }

  if (colDef.comment) {
    column.comment = colDef.comment.value;
  }

  return column;
};

const extractDataType = (dataType: DataType): string => {
  if (!dataType) return 'unknown';

  let type = dataType.dataType || 'unknown';

  // Add length/precision if available
  if ('length' in dataType && dataType.length) {
    type += `(${dataType.length})`;
  } else if ('scale' in dataType && dataType.scale !== undefined) {
    type += `(${dataType.length || ''},${dataType.scale})`;
  }

  return type.toLowerCase();
};

const getTableName = (table: { db: string; table: string }[] | undefined): string => {
  if (!table || table.length === 0) return 'unknown';
  return table[0].table || 'unknown';
};
