import type { Graph, Node, Edge, SubqueryNode } from '../types/ir.js';
import { findSubqueryResultNode, getSubqueryResultLabel } from '../converter/subquery.js';
import {
  inferSchemaFromGraph,
  getJoinColumns,
  type TableInfo
} from './utils/schema-inference.js';
import { formatWhereExpression } from './utils/expression-formatter.js';
import { buildNodeSchemas, extractSelectColumns } from './utils/node-schemas.js';
import { 
  extractCTENodes, 
  findCTERelatedNodes, 
  isCTERelatedNode,
  getCTEInternalEdges,
  processCTEConnections
} from './utils/cte.js';

export const renderMermaid = (graph: Graph): string => {
  const lines: string[] = ['flowchart LR'];

  // Infer schema information from the graph
  const { tables, tableAliases } = inferSchemaFromGraph(graph);

  // Build node schemas map for display using the shared utility
  const nodeSchemas = buildNodeSchemas(graph, tables);

  // Extract CTE nodes using the shared utility
  const cteNodesMap = extractCTENodes(graph);
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

    // Collect nodes related to the CTE using the shared utility
    const cteRelatedNodes = findCTERelatedNodes(graph, cteNode);

    // Render CTE nodes
    for (const node of cteRelatedNodes) {
      lines.push(`        ${formatNode(node, nodeSchemas, graph, tables, tableAliases)}`);
    }

    // Render edges within the CTE using the shared utility
    const cteEdges = getCTEInternalEdges(graph, cteRelatedNodes);

    for (const edge of cteEdges) {
      lines.push(`        ${formatEdge(edge, graph)}`);
    }

    lines.push('    end');
    lines.push('');
  }

  // Filter out CTE result nodes (they are just intermediate nodes)
  const cteResultNodes = new Set<string>();
  for (const cteNode of cteNodes) {
    cteResultNodes.add(cteNode.id);
  }

  // Render main query nodes and subqueries
  for (const node of mainNodes) {
    if (!isCTERelatedNode(graph, node, cteNodes) && !cteResultNodes.has(node.id)) {
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

    // Skip edges involving hidden CTE result nodes
    if (cteResultNodes.has(edge.from.node) || cteResultNodes.has(edge.to.node)) {
      return false;
    }

    // At least one side is a main query node
    return (fromNode && !isCTERelatedNode(graph, fromNode, cteNodes)) ||
           (toNode && !isCTERelatedNode(graph, toNode, cteNodes));
  });

  // Handle CTE connections using the shared utility
  const cteConnections = processCTEConnections(graph, cteNodesMap);
  for (const connection of cteConnections) {
    lines.push(`    ${sanitizeId(connection.from)} --> ${sanitizeId(connection.to)}`);
  }

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
      
      // Extract ON clause from node.sql if available
      let onClause = '';
      if (node.sql) {
        const onMatch = node.sql.match(/ON\s+(.+)$/i);
        if (onMatch) {
          onClause = `<br/>---<br/>ON ${escapeLabel(onMatch[1])}`;
        }
      }
      
      return `${nodeId}["${joinType} JOIN<br/>---<br/>${columns}${onClause}"]`;
    }
  }

  // Format node with schema information if available
  if (schemaColumns && schemaColumns.length > 0) {
    const columns = schemaColumns.map(col => escapeLabel(col)).join('<br/>');

    if (node.kind === 'op' && node.label === 'SELECT' && node.sql) {
      // For SELECT nodes, show the SQL expressions formatted on separate lines
      const selectItems = extractSelectColumns(node.sql);
      return `${nodeId}["${label}<br/>---<br/>${selectItems.map(item => escapeLabel(item)).join('<br/>')}"]`;
    } else if (node.kind === 'op' && node.label === 'GROUP BY') {
      // For GROUP BY, show operation and columns
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
  if (node.sql && node.kind === 'clause') {
    // Format WHERE expressions with line breaks for AND/OR
    if (node.label === 'WHERE') {
      // Format WHERE expressions with line breaks for AND/OR
      const formattedSql = formatWhereExpression(node.sql);
      // In Mermaid, use <br/> for line breaks and escape after formatting
      const mermaidSql = formattedSql.replace(/\n/g, '<br/>');
      const escapedSql = escapeLabel(mermaidSql);
      return `${nodeId}["${label}<br/>---<br/>${escapedSql}"]`;
    }
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
        // For JOIN nodes, the SQL already contains the JOIN type
        if (node.label.includes('JOIN')) {
          return `${nodeId}["${sql}"]`;
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
    return `${fromId} --> ${toId}`;
  }

  // Handle subquery result edges
  if (edge.kind === 'subqueryResult') {
    const subqueryType = fromNode?.label.match(/\((\w+)\)/)?.[1] || 'subquery';
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
  // Don't escape <br/> tags that we've added for formatting
  // Don't escape single quotes since they're safe inside double quotes in Mermaid
  return label
    .replace(/<(?!br\/>)/g, '&lt;')  // Escape < except in <br/>
    .replace(/>(?!$)/g, (match, offset, str) => {
      // Don't escape > that's part of <br/>
      if (str.substring(offset - 4, offset + 1) === '<br/>') {
        return '>';
      }
      return '&gt;';
    })
    .replace(/"/g, '&quot;')
    // Don't escape single quotes - they're safe inside double quotes in Mermaid
    .replace(/\|/g, '&#124;');
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
      // Use the edge's label if it exists, otherwise fall back to default
      const label = edge.label || getSubqueryResultLabel(subqueryNode.subqueryType);
      lines.push(`    ${sanitizeId(resultNode.id)} -->|${label}| ${sanitizeId(edge.to.node)}`);
    }
  }

  return lines;
};
