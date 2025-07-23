import type { SchemaInfo } from '../types/schema.js';
import type { SchemaSnapshot, ColumnSchema } from '../types/ir.js';

export interface RelationInfo {
  name: string;
  alias: string;
  columns: ColumnSchema[];
}

export interface ConversionContext {
  nodeCounter: number;
  edgeCounter: number;
  subqueryCounter: number;
  schema: SchemaInfo;
  currentRelations: Record<string, RelationInfo>; // Maps alias to relation info
  currentColumns: ColumnSchema[]; // Current unified schema
  snapshots: SchemaSnapshot[];
  cteNodes?: Record<string, string>; // Maps CTE name to its last node ID
  currentNodeId?: string; // Current node being processed
  tableSourceNodes?: Record<string, string>; // Maps table alias to the node that introduced it
  placeholderCounter?: number; // Counter for generating unique placeholder names
  placeholderMap?: Map<object, string>; // Maps subquery AST to placeholder name
}