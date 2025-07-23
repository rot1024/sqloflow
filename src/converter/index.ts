import type { Graph, Node, Edge } from '../types/ir.js';
import type { AST } from 'node-sql-parser';
import { extractSchema } from './schema-extractor.js';
import { createContext } from './context.js';
import { convertStatement } from './statement.js';

export const convert = (ast: AST[]): Graph => {
  // First extract schema from CREATE TABLE statements
  const schema = extractSchema(ast);
  const ctx = createContext(schema);
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const statement of ast) {
    const result = convertStatement(ctx, statement);
    nodes.push(...result.nodes);
    edges.push(...result.edges);
  }

  return { nodes, edges, snapshots: ctx.snapshots };
};
