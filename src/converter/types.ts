import type { SchemaInfo } from '../types/schema.js';
import type { RelationSchema, SchemaSnapshot } from '../types/ir.js';

export interface ConversionContext {
  nodeCounter: number;
  edgeCounter: number;
  subqueryCounter: number;
  schema: SchemaInfo;
  currentSchema: Record<string, RelationSchema>;
  snapshots: SchemaSnapshot[];
  cteNodes?: Record<string, string>; // Maps CTE name to its last node ID
}