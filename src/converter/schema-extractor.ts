import type { SchemaInfo, TableSchema, ColumnSchema } from '../types/schema.js';

export const extractSchema = (ast: any[]): SchemaInfo => {
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

const extractTableSchema = (createStmt: any): TableSchema | null => {
  if (!createStmt.table || !createStmt.create_definitions) {
    return null;
  }

  const tableName = getTableName(createStmt.table);
  const columns: ColumnSchema[] = [];

  for (const def of createStmt.create_definitions) {
    if (def.resource === 'column') {
      const column = extractColumnSchema(def);
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

const extractColumnSchema = (colDef: any): ColumnSchema | null => {
  if (!colDef.column || !colDef.definition) {
    return null;
  }

  // Extract column name from nested structure
  const columnName = colDef.column.column?.expr?.value || colDef.column.column || 'unknown';

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

const extractDataType = (dataType: any): string => {
  if (!dataType) return 'unknown';

  let type = dataType.dataType || 'unknown';
  
  // Add length/precision if available
  if (dataType.length) {
    type += `(${dataType.length})`;
  } else if (dataType.precision && dataType.scale) {
    type += `(${dataType.precision},${dataType.scale})`;
  }

  return type.toLowerCase();
};

const getTableName = (table: any): string => {
  if (!table || table.length === 0) return 'unknown';
  
  const tableInfo = Array.isArray(table) ? table[0] : table;
  return tableInfo.table || tableInfo.name || 'unknown';
};