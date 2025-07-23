import type { ConversionContext, RelationInfo } from './types.js';
import type { SchemaInfo } from '../types/schema.js';
import type { ColumnSchema } from '../types/ir.js';

export const createContext = (schema: SchemaInfo): ConversionContext => {
  const currentRelations: Record<string, RelationInfo> = {};
  const currentColumns: ColumnSchema[] = [];
  
  // Initialize relations from extracted tables
  for (const [tableName, tableSchema] of Object.entries(schema.tables)) {
    const relationInfo: RelationInfo = {
      name: tableName,
      alias: tableName,
      columns: tableSchema.columns.map(col => ({
        id: `${tableName}.${col.name}`,
        name: col.name,
        type: col.type,
        source: tableName,
        table: tableName
      }))
    };
    currentRelations[tableName] = relationInfo;
    // Don't add to currentColumns yet - that happens when table is used in FROM
  }
  
  return {
    nodeCounter: 0,
    edgeCounter: 0,
    subqueryCounter: 0,
    schema,
    currentRelations,
    currentColumns,
    snapshots: [],
    cteNodes: {},
    tableSourceNodes: {}
  };
};