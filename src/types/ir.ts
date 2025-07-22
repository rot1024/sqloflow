export type Graph = {
  nodes: Node[];
  edges: Edge[];
  snapshots?: SchemaSnapshot[];
};

export type NodeKind =
  | "op"
  | "clause"
  | "relation"
  | "column"
  | "subquery";

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
  | "mapsTo"
  | "subqueryResult";

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

export interface SubqueryNode extends Node {
  kind: "subquery";
  subqueryType: "scalar" | "in" | "exists";
  innerGraph?: Graph;  // サブクエリの内部グラフ (Phase 2で使用)
  correlatedFields?: string[];  // 相関サブクエリの場合の外部参照フィールド
}