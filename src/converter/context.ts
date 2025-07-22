import type { ConversionContext } from './types.js';
import type { SchemaInfo } from '../types/schema.js';
import type { RelationSchema } from '../types/ir.js';

export const createContext = (schema: SchemaInfo): ConversionContext => {
  const currentSchema: Record<string, RelationSchema> = {};
  // Initialize current schema from extracted tables
  for (const [tableName, tableSchema] of Object.entries(schema.tables)) {
    currentSchema[tableName] = {
      name: tableName,
      columns: tableSchema.columns.map(col => ({
        id: `${tableName}.${col.name}`,
        name: col.name,
        type: col.type,
        source: tableName
      }))
    };
  }
  
  return {
    nodeCounter: 0,
    edgeCounter: 0,
    subqueryCounter: 0,
    schema,
    currentSchema,
    snapshots: []
  };
};