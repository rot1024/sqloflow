export interface ColumnSchema {
  name: string;
  type: string;
  nullable?: boolean;
  primary_key?: boolean;
  unique?: boolean;
  default?: any;
  comment?: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
}

export interface SchemaInfo {
  tables: Record<string, TableSchema>;
}