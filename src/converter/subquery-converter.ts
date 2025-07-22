import type { Node, Edge, SubqueryNode } from '../types/ir.js';
import type { ConversionContext } from './types.js';
import type { Select } from 'node-sql-parser';
import { convertSelectStatement } from './statement-converters.js';

/**
 * Convert a subquery AST into a SubqueryNode with internal graph
 */
export const convertSubquery = (
  ctx: ConversionContext,
  subquery: Select,
  subqueryType: 'scalar' | 'in' | 'exists',
  parentTableRefs?: any[]
): SubqueryNode => {
  // Create subquery context with separate counters
  const subqueryPrefix = `subq_${ctx.nodeCounter}`;
  const subCtx: ConversionContext = {
    ...ctx,
    nodeCounter: 0,  // Reset counter for subquery nodes
    edgeCounter: 0,  // Reset counter for subquery edges
    snapshots: []    // Subqueries don't need snapshots for now
  };

  // Override createNode to add prefix to subquery node IDs
  const originalNodes: Node[] = [];
  const originalEdges: Edge[] = [];
  
  // Convert the subquery as a regular SELECT statement
  const result = convertSelectStatement(subCtx, subquery);
  
  // Add prefix to all node and edge IDs to ensure uniqueness
  const nodes = result.nodes.map(node => ({
    ...node,
    id: `${subqueryPrefix}_${node.id}`
  }));
  
  const edges = result.edges.map(edge => ({
    ...edge,
    id: `${subqueryPrefix}_${edge.id}`,
    from: { ...edge.from, node: `${subqueryPrefix}_${edge.from.node}` },
    to: { ...edge.to, node: `${subqueryPrefix}_${edge.to.node}` }
  }));

  // Detect correlated fields (Phase 3 - placeholder for now)
  const correlatedFields = detectCorrelatedFields(subquery, parentTableRefs);

  // Create the subquery node
  const subqueryNode: SubqueryNode = {
    id: `node_${ctx.nodeCounter++}`,
    kind: 'subquery',
    label: `Subquery (${subqueryType})`,
    sql: '(subquery)',
    subqueryType,
    innerGraph: { nodes, edges },
    correlatedFields
  };

  return subqueryNode;
};

/**
 * Detect correlated fields in a subquery
 * This is a placeholder for Phase 3 implementation
 */
const detectCorrelatedFields = (subquery: Select, parentTableRefs?: any[]): string[] | undefined => {
  // TODO: Implement in Phase 3
  // Need to traverse the subquery AST and find column references
  // that refer to tables from parent query
  return undefined;
};

/**
 * Find the result node in a subquery graph
 * This is typically the last SELECT node
 */
export const findSubqueryResultNode = (innerGraph: { nodes: Node[]; edges: Edge[] }): Node | undefined => {
  // Find SELECT node (usually the last operation)
  const selectNode = innerGraph.nodes.find(n => n.kind === 'op' && n.label === 'SELECT');
  if (selectNode) return selectNode;

  // Fallback to the last node
  return innerGraph.nodes[innerGraph.nodes.length - 1];
};

/**
 * Get appropriate label for subquery result based on type
 */
export const getSubqueryResultLabel = (subqueryType: 'scalar' | 'in' | 'exists'): string => {
  switch (subqueryType) {
    case 'scalar':
      return '1 row, 1 col';
    case 'in':
      return 'set of values';
    case 'exists':
      return 'boolean';
    default:
      return 'result';
  }
};