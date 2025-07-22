export type Graph = {
  nodes: Node[];
  edges: Edge[];
  snapshots?: SchemaSnapshot[];
};

export type NodeKind =
  | "op"
  | "clause"
  | "relation"
  | "column";

export type Node = {
  id: string;
  kind: NodeKind;
  label: string;
  sql?: string;
  parent?: string;
  handles?: Handle[];
  meta?: Record<string, any>;
};

export type Handle = {
  id: string;
  dir: "in" | "out";
  role?: string;
};

export type EdgeKind =
  | "flow"
  | "uses"
  | "defines"
  | "mapsTo";

export type Edge = {
  id: string;
  kind: EdgeKind;
  from: { node: string; handle?: string };
  to: { node: string; handle?: string };
  label?: string;
  meta?: Record<string, any>;
};

export type SchemaSnapshot = {
  stepId: string;
  relations: Record<string, RelationSchema>;
};

export type RelationSchema = {
  name: string;
  columns: ColumnSchema[];
};

export type ColumnSchema = {
  id: string;
  name: string;
  type?: string;
  source?: string;
};