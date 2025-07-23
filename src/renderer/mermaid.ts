import type { Graph, Node, Edge, SubqueryNode } from '../types/ir.js';
import { findSubqueryResultNode, getSubqueryResultLabel } from '../converter/subquery-converter.js';
import { 
  inferSchemaFromGraph, 
  getJoinColumns,
  type TableInfo 
} from './utils/schema-inference.js';

export const renderMermaid = (graph: Graph): string => {
  const lines: string[] = ['flowchart LR'];
  
  // Infer schema information from the graph
  const { tables, tableAliases } = inferSchemaFromGraph(graph);
  
  // Build node schemas map for display
  const nodeSchemas = new Map<string, string[]>();
  
  // Process nodes to populate nodeSchemas based on their operation type
  graph.nodes.forEach(node => {
    if (node.kind === 'op' && node.label === 'FROM' && node.sql) {
      // For FROM nodes, show all columns from the table
      const aliasInfo = node.sql.match(/FROM\s+(\w+)(?:\s+AS\s+(\w+))?/i);
      if (aliasInfo) {
        const tableName = aliasInfo[1];
        const table = tables.get(tableName);
        if (table && table.columns.length > 0) {
          nodeSchemas.set(node.id, table.columns.map(col => `${tableName}.${col}`));
        }
      }
    }
  });
  
  // Also use snapshots for nodes where we have them
  if (graph.snapshots) {
    graph.snapshots.forEach(snapshot => {
      const stepNode = graph.nodes.find(n => n.id === snapshot.nodeId);
      if (stepNode && snapshot.schema) {
        const columns: string[] = [];
        snapshot.schema.columns.forEach(col => {
          const qualifiedName = col.source ? `${col.source}.${col.name}` : col.name;
          columns.push(qualifiedName);
        });
        if (columns.length > 0) {
          // Override with snapshot data if available
          nodeSchemas.set(stepNode.id, columns);
        }
      }
    });
  }
  
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
      lines.push(`        ${formatNode(node, nodeSchemas, graph, tables, tableAliases)}`);
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
        lines.push(...renderSubquery(node as SubqueryNode, graph, nodeSchemas, tables, tableAliases));
      } else {
        lines.push(`    ${formatNode(node, nodeSchemas, graph, tables, tableAliases)}`);
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

const formatNode = (node: Node, nodeSchemas: Map<string, string[]>, graph: Graph, tables: Map<string, TableInfo>, tableAliases: Map<string, string>): string => {
  const nodeId = sanitizeId(node.id);
  const label = escapeLabel(node.label);
  const sql = node.sql ? escapeLabel(node.sql) : '';
  
  // Get schema information for this node
  const schemaColumns = nodeSchemas.get(node.id);
  
  // For JOIN nodes, get all columns from joined tables
  if (node.kind === 'op' && node.label.includes('JOIN')) {
    // Use the shared utility to get all columns from joined tables
    const joinColumns = getJoinColumns(node, graph, tables, tableAliases);
    if (joinColumns.length > 0) {
      const joinType = node.label.split(' ')[0]; // Extract just "INNER", "LEFT", etc.
      const columns = joinColumns.map(col => escapeLabel(col)).join('<br/>');
      return `${nodeId}["${joinType} JOIN<br/>---<br/>${columns}"]`;
    }
  }
  
  // Format node with schema information if available
  if (schemaColumns && schemaColumns.length > 0) {
    const columns = schemaColumns.map(col => escapeLabel(col)).join('<br/>');
    
    if (node.kind === 'op' && (node.label === 'SELECT' || node.label === 'GROUP BY')) {
      // For SELECT and GROUP BY, show operation and columns
      return `${nodeId}["${label}<br/>---<br/>${columns}"]`;
    } else if (node.kind === 'relation') {
      // For table nodes, show table name and columns
      return `${nodeId}["${label}<br/>---<br/>${columns}"]`;
    } else if (node.kind === 'op' && node.label.includes('UNION')) {
      // For UNION, show operation and columns
      return `${nodeId}["${label}<br/>---<br/>${columns}"]`;
    } else if (node.kind === 'op' && node.label === 'FROM') {
      // For FROM nodes with schema, show table and columns
      return `${nodeId}["${label}<br/>---<br/>${columns}"]`;
    }
  }
  
  // Add SQL parameter if available (for WHERE, HAVING, etc.)
  if (sql && node.kind === 'clause') {
    return `${nodeId}["${label}<br/>---<br/>${sql}"]`;
  }
  
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
      // Already handled above
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

const renderSubquery = (subqueryNode: SubqueryNode, parentGraph: Graph, nodeSchemas: Map<string, string[]>, tables: Map<string, TableInfo>, tableAliases: Map<string, string>): string[] => {
  const lines: string[] = [];
  
  if (!subqueryNode.innerGraph) {
    // Phase 1: Simple subquery node without inner graph
    lines.push(`    ${formatNode(subqueryNode, nodeSchemas, parentGraph, tables, tableAliases)}`);
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
    if (node.kind === 'subquery' && subqueryNode.innerGraph) {
      // Recursively render nested subqueries
      const nestedLines = renderSubquery(node as SubqueryNode, subqueryNode.innerGraph, nodeSchemas, tables, tableAliases);
      // Add extra indentation for nested subgraph
      lines.push(...nestedLines.map(line => '    ' + line));
    } else {
      lines.push(`        ${formatNode(node, nodeSchemas, subqueryNode.innerGraph, tables, tableAliases)}`);
    }
  }
  
  // Render inner edges (excluding those from nested subqueries)
  for (const edge of subqueryNode.innerGraph.edges) {
    // Skip edges from nested subquery nodes (they're handled in the nested subgraph)
    const fromNode = subqueryNode.innerGraph?.nodes.find(n => n.id === edge.from.node);
    if (fromNode?.kind === 'subquery' && edge.kind === 'subqueryResult') {
      continue;
    }
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