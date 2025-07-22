import type { Graph, Node, Edge, SubqueryNode } from '../types/ir.js';
import { findSubqueryResultNode, getSubqueryResultLabel } from '../converter/subquery-converter.js';

export const renderMermaid = (graph: Graph): string => {
  const lines: string[] = ['flowchart LR'];
  
  // Group nodes (e.g., CTEs)
  const cteNodes = graph.nodes.filter(n => n.label.startsWith('CTE:'));
  const mainNodes = graph.nodes.filter(n => !n.label.startsWith('CTE:'));
  
  // Process subgraphs containing CTEs first
  const processedCtes = new Set<string>();
  
  for (const cteNode of cteNodes) {
    const cteName = cteNode.label.replace('CTE: ', '');
    if (processedCtes.has(cteName)) continue;
    processedCtes.add(cteName);
    
    lines.push(`    subgraph cte_${sanitizeId(cteName)} [CTE: ${cteName}]`);
    lines.push('        direction TB');
    
    // Collect nodes related to the CTE
    const cteRelatedNodes = findCteRelatedNodes(graph, cteNode);
    
    // Render CTE nodes
    for (const node of cteRelatedNodes) {
      lines.push(`        ${formatNode(node)}`);
    }
    
    // Render edges within the CTE
    const cteEdges = graph.edges.filter(edge => 
      cteRelatedNodes.some(n => n.id === edge.from.node) &&
      cteRelatedNodes.some(n => n.id === edge.to.node)
    );
    
    for (const edge of cteEdges) {
      lines.push(`        ${formatEdge(edge, graph)}`);
    }
    
    lines.push('    end');
    lines.push('');
  }
  
  // Render main query nodes and subqueries
  for (const node of mainNodes) {
    if (!isCteRelatedNode(graph, node, cteNodes)) {
      if (node.kind === 'subquery') {
        // Render subquery as subgraph
        lines.push(...renderSubquery(node as SubqueryNode, graph));
      } else {
        lines.push(`    ${formatNode(node)}`);
      }
    }
  }
  
  // Render main query edges and connections to CTEs
  const mainEdges = graph.edges.filter(edge => {
    const fromNode = graph.nodes.find(n => n.id === edge.from.node);
    const toNode = graph.nodes.find(n => n.id === edge.to.node);
    
    // Skip edges from subquery nodes (they're handled in renderSubquery)
    if (fromNode?.kind === 'subquery' && edge.kind === 'subqueryResult') {
      return false;
    }
    
    // At least one side is a main query node
    return (fromNode && !isCteRelatedNode(graph, fromNode, cteNodes)) ||
           (toNode && !isCteRelatedNode(graph, toNode, cteNodes));
  });
  
  for (const edge of mainEdges) {
    lines.push(`    ${formatEdge(edge, graph)}`);
  }
  
  return lines.join('\n');
};

const formatNode = (node: Node): string => {
  const nodeId = sanitizeId(node.id);
  const label = escapeLabel(node.label);
  const sql = node.sql ? escapeLabel(node.sql) : '';
  
  switch (node.kind) {
    case 'relation':
      return `${nodeId}[${label}]`;
    case 'subquery':
      return `${nodeId}[["${label}"]]`;  // Double brackets for subquery styling
    case 'op':
      // Always show SQL details if available
      if (sql && (
        node.label === 'FROM' || 
        node.label === 'SELECT' || 
        node.label === 'ORDER BY' || 
        node.label === 'GROUP BY' || 
        node.label === 'LIMIT' ||
        node.label === 'OFFSET' ||
        node.label.includes('JOIN')
      )) {
        // For FROM, just show the SQL
        if (node.label === 'FROM') {
          return `${nodeId}[${sql}]`;
        }
        // For others, show both label and SQL
        return `${nodeId}["${label} ${sql}"]`;
      }
      return `${nodeId}[${label}]`;
    case 'clause':
      // Always show SQL details for clauses if available
      if (sql && (node.label === 'WHERE' || node.label === 'HAVING')) {
        return `${nodeId}["${label} ${sql}"]`;
      }
      return `${nodeId}[${label}]`;
    default:
      return `${nodeId}[${label}]`;
  }
};

const formatEdge = (edge: Edge, graph: Graph): string => {
  const fromId = sanitizeId(edge.from.node);
  const toId = sanitizeId(edge.to.node);
  
  // Special edge indicating CTE result
  const fromNode = graph.nodes.find(n => n.id === edge.from.node);
  const toNode = graph.nodes.find(n => n.id === edge.to.node);
  
  if (fromNode?.kind === 'op' && toNode?.label.startsWith('CTE:')) {
    const cteName = toNode.label.replace('CTE: ', '');
    return `${fromId} -->|CTE result| ${toId}`;
  }
  
  // Handle subquery result edges
  if (edge.kind === 'subqueryResult') {
    const subqueryType = fromNode?.label.match(/\((\w+)\)/)?.[1] || 'result';
    return `${fromId} -->|${subqueryType}| ${toId}`;
  }
  
  // Regular edge
  if (edge.label) {
    return `${fromId} -->|${escapeLabel(edge.label)}| ${toId}`;
  }
  
  return `${fromId} --> ${toId}`;
};

const sanitizeId = (id: string): string => {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
};

const escapeLabel = (label: string): string => {
  // Escape Mermaid special characters
  return label
    .replace(/>/g, '&gt;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\|/g, '&#124;');
};

const findCteRelatedNodes = (graph: Graph, cteNode: Node): Node[] => {
  const related: Node[] = [];
  const visited = new Set<string>();
  
  // Traverse backward from nodes with defines edges to CTEs
  const definesEdge = graph.edges.find(e => 
    e.kind === 'defines' && e.to.node === cteNode.id
  );
  
  if (definesEdge) {
    collectRelatedNodes(graph, definesEdge.from.node, related, visited, cteNode.id);
  }
  
  return related;
};

const collectRelatedNodes = (
  graph: Graph, 
  nodeId: string, 
  collected: Node[], 
  visited: Set<string>,
  stopAtNodeId: string
): void => {
  if (visited.has(nodeId) || nodeId === stopAtNodeId) return;
  visited.add(nodeId);
  
  const node = graph.nodes.find(n => n.id === nodeId);
  if (node) {
    collected.push(node);
  }
  
  // Find input edges to this node
  const incomingEdges = graph.edges.filter(e => 
    e.to.node === nodeId && e.kind === 'flow'
  );
  
  for (const edge of incomingEdges) {
    collectRelatedNodes(graph, edge.from.node, collected, visited, stopAtNodeId);
  }
};

const isCteRelatedNode = (graph: Graph, node: Node, cteNodes: Node[]): boolean => {
  for (const cteNode of cteNodes) {
    const related = findCteRelatedNodes(graph, cteNode);
    if (related.some(n => n.id === node.id)) {
      return true;
    }
  }
  return false;
};

const renderSubquery = (subqueryNode: SubqueryNode, parentGraph: Graph): string[] => {
  const lines: string[] = [];
  
  if (!subqueryNode.innerGraph) {
    // Phase 1: Simple subquery node without inner graph
    lines.push(`    ${formatNode(subqueryNode)}`);
    return lines;
  }
  
  // Phase 2: Render subquery as subgraph
  const subgraphId = `subquery_${sanitizeId(subqueryNode.id)}`;
  
  // Update label to show correlation information
  let label = subqueryNode.label;
  if (subqueryNode.correlatedFields && subqueryNode.correlatedFields.length > 0) {
    label += ` - correlated`;
  }
  
  lines.push(`    subgraph ${subgraphId} ["${escapeLabel(label)}"]`);
  lines.push('        direction TB');
  
  // Render inner nodes
  for (const node of subqueryNode.innerGraph.nodes) {
    lines.push(`        ${formatNode(node)}`);
  }
  
  // Render inner edges
  for (const edge of subqueryNode.innerGraph.edges) {
    lines.push(`        ${formatEdge(edge, subqueryNode.innerGraph)}`);
  }
  
  lines.push('    end');
  
  // Find the result node and create connection to parent
  const resultNode = findSubqueryResultNode(subqueryNode.innerGraph);
  if (resultNode) {
    // Find edges in parent graph that connect to this subquery
    const outgoingEdges = parentGraph.edges.filter(e => e.from.node === subqueryNode.id);
    for (const edge of outgoingEdges) {
      const label = getSubqueryResultLabel(subqueryNode.subqueryType);
      lines.push(`    ${sanitizeId(resultNode.id)} -->|${label}| ${sanitizeId(edge.to.node)}`);
    }
  }
  
  return lines;
};