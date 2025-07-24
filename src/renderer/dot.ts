/**
 * Enhanced schema view renderer that shows column-level details
 * 
 * Color scheme:
 * - lightgreen: Source tables (FROM nodes, base tables)
 * - salmon: Operations that transform schema (JOIN, UNION, SELECT with transformations)
 * - lightyellow: Operations that filter but don't change schema (WHERE, HAVING, simple SELECT)
 * - lightblue: CTE subgraph backgrounds
 * - lightgrey: Subquery subgraph backgrounds
 */

import type { Graph, Node, Edge, SubqueryNode, SchemaSnapshot } from '../types/ir.js';
import { findSubqueryResultNode, getSubqueryResultLabel } from '../converter/subquery.js';
import {
  inferSchemaFromGraph,
  extractColumnReferences,
  extractTableAndAlias,
  getJoinColumns,
  type TableInfo
} from './utils/schema-inference.js';
import { buildNodeSchemas, extractSelectColumns } from './utils/node-schemas.js';
import { 
  extractCTENodes, 
  findCTERelatedNodes, 
  getCTEInternalEdges,
  findLastCTENode
} from './utils/cte.js';

interface OperationNode {
  id: string;
  operation: string;
  sql?: string;
  inputColumns: { table: string; column: string }[];
  outputColumns: string[];
}

export const renderDot = (graph: Graph): string => {
  const lines: string[] = [];
  lines.push('digraph schema_flow {');
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=record];');
  lines.push('');

  // Infer schema information from the graph
  const { tables, tableAliases } = inferSchemaFromGraph(graph);

  const operations: OperationNode[] = [];
  const fromNodeToTable = new Map<string, string>(); // FROM node ID -> table name
  const incomingEdgeCount = new Map<string, number>(); // Node ID -> incoming edge count

  // Count incoming edges for each node
  graph.edges.forEach(edge => {
    if (edge.kind === 'flow') {
      const count = incomingEdgeCount.get(edge.to.node) || 0;
      incomingEdgeCount.set(edge.to.node, count + 1);
    }
  });

  // Process FROM nodes to map them to tables
  graph.nodes.forEach(node => {
    if (node.kind === 'op' && node.label === 'FROM' && node.sql) {
      const aliasInfo = extractTableAndAlias(node.sql);
      if (aliasInfo) {
        fromNodeToTable.set(node.id, `${aliasInfo.table}_${node.id}`);
      }
    }
  });

  // Process nodes to identify operations
  graph.nodes.forEach(node => {
    if (node.kind === 'op' || node.kind === 'clause') {
      // Skip FROM nodes as they will be replaced by table nodes
      if (node.label === 'FROM') return;

      const operation: OperationNode = {
        id: node.id,
        operation: node.label,
        sql: node.sql,
        inputColumns: [],
        outputColumns: []
      };

      // Try to determine input/output columns from the node context
      // This is simplified - in a real implementation, we'd track this during conversion
      if (node.label === 'SELECT') {
        // Extract columns from SQL if available
        if (node.sql) {
          const columns = extractSelectColumns(node.sql);
          operation.outputColumns = columns;
        }
      }

      operations.push(operation);
    } else if (node.kind === 'subquery') {
      // Handle subquery nodes - will be rendered as subgraphs
      // Don't add to operations list, they'll be handled separately
    } else if (node.kind === 'relation' && !node.label.startsWith('CTE:')) {
      // Handle non-CTE relation nodes (e.g., tables in JOIN)
      // These will be rendered as table nodes
    }
  });

  // Track which tables are used in JOINs
  const joinedTables = new Map<string, string>(); // table name -> JOIN node ID
  graph.nodes.forEach(node => {
    if (node.kind === 'op' && node.label.includes('JOIN') && node.sql) {
      const aliasInfo = extractTableAndAlias(node.sql);
      if (aliasInfo) {
        joinedTables.set(aliasInfo.table, node.id);
      }
    }
  });

  // Track CTE nodes and their associated nodes using the shared utility
  const cteNodes = extractCTENodes(graph);
  const processedNodes = new Set<string>();

  // Render table nodes (replacing FROM nodes)
  lines.push('  // Source tables');

  // First, render all FROM nodes that have been mapped
  fromNodeToTable.forEach((tableKey, fromNodeId) => {
    // Skip nodes already rendered in CTE subgraphs
    if (processedNodes.has(fromNodeId)) return;

    // Extract actual table name by removing the node ID suffix
    const lastUnderscore = tableKey.lastIndexOf('_node_');
    const tableName = lastUnderscore > -1 ? tableKey.substring(0, lastUnderscore) : tableKey.split('_')[0];
    
    // Find the FROM node to get alias information
    const fromNode = graph.nodes.find(n => n.id === fromNodeId);
    
    // Check if this is a CTE reference by checking values in the cteNodes map
    let isCTE = false;
    cteNodes.forEach((cteName) => {
      if (tableName === cteName) {
        isCTE = true;
      }
    });
    
    if (isCTE) {
      // This is a CTE reference, render it as a FROM node without columns
      let displayName = tableName;
      
      if (fromNode && fromNode.sql) {
        const aliasInfo = extractTableAndAlias(fromNode.sql);
        if (aliasInfo && aliasInfo.alias !== aliasInfo.table) {
          displayName = `${tableName} AS ${aliasInfo.alias}`;
        }
      }
      
      const label = escapeLabelPart(`FROM ${displayName}`);
      lines.push(`  ${escapeId(fromNodeId)} [label="${label}", style=filled, fillcolor=lightgreen];`);
    } else {
      // Check if it's a regular table
      const table = tables.get(tableName);
      if (table) {
        let displayName = tableName;

        if (fromNode && fromNode.sql) {
          const aliasInfo = extractTableAndAlias(fromNode.sql);
          if (aliasInfo && aliasInfo.alias !== aliasInfo.table) {
            displayName = `${tableName} AS ${aliasInfo.alias}`;
          }
        }

        const columns = table.columns.join('\\n');
        const label = columns ? buildRecordLabel(`FROM ${displayName}`, columns) : escapeLabelPart(`FROM ${displayName}`);
        // Source tables are always green
        lines.push(`  ${escapeId(fromNodeId)} [label="${label}", style=filled, fillcolor=lightgreen];`);
      }
    }
  });

  // Then render any tables that don't have FROM nodes
  tables.forEach(table => {
    // Skip CTE tables as they're rendered as subgraphs
    let isCTE = false;
    cteNodes.forEach((cteName) => {
      if (table.tableName === cteName) {
        isCTE = true;
      }
    });
    if (isCTE) return;

    // Check if this table has already been rendered as a FROM node
    let alreadyRendered = false;
    for (const tableKey of fromNodeToTable.values()) {
      if (tableKey.startsWith(table.tableName + '_')) {
        alreadyRendered = true;
        break;
      }
    }

    if (!alreadyRendered) {
      const columns = table.columns.join('\\n');
      const label = columns ? buildRecordLabel(`FROM ${table.tableName}`, columns) : escapeLabelPart(`FROM ${table.tableName}`);
      // Source tables are always green
      lines.push(`  ${table.id} [label="${label}", style=filled, fillcolor=lightgreen];`);
    }
  });

  lines.push('');
  
  // Render standalone relation nodes (e.g., tables in JOIN operations)
  graph.nodes.forEach(node => {
    if (node.kind === 'relation' && !node.label.startsWith('CTE:')) {
      // Skip if already processed
      if (processedNodes.has(node.id)) return;
      
      // This is a table node from a JOIN operation
      const label = escapeLabelPart(node.label);
      // Source tables are always green
      lines.push(`  ${escapeId(node.id)} [label="${label}", style=filled, fillcolor=lightgreen];`);
    }
  });
  
  lines.push('  // Operations');

  // Render CTEs as subgraphs
  cteNodes.forEach((cteName, cteNodeId) => {
    // Find nodes related to the CTE using the shared utility
    const cteNode = graph.nodes.find(n => n.id === cteNodeId);
    if (!cteNode) return;
    
    const cteRelatedNodes = findCTERelatedNodes(graph, cteNode);
    const cteSubgraphNodes = new Set(cteRelatedNodes.map(n => n.id));

    // Render CTE as subgraph
    if (cteSubgraphNodes.size > 0) {
      lines.push('');
      lines.push(`  subgraph cluster_${cteNodeId} {`);
      lines.push(`    label="CTE: ${cteName}";`);
      lines.push('    style=filled;');
      lines.push('    color=lightblue;');

      // Render nodes in the CTE
      cteSubgraphNodes.forEach(nodeId => {
        const node = graph.nodes.find(n => n.id === nodeId);
        if (node) {
          processedNodes.add(nodeId);

          // Render the node based on its type
          if (node.label === 'FROM' && fromNodeToTable.has(node.id)) {
            // FROM nodes are handled separately
            const tableKey = fromNodeToTable.get(node.id)!;
            const tableName = tableKey.split('_')[0];
            const table = tables.get(tableName);
            if (table) {
              let displayName = tableName;

              if (node.sql) {
                const aliasInfo = extractTableAndAlias(node.sql);
                if (aliasInfo && aliasInfo.alias !== aliasInfo.table) {
                  displayName = `${tableName} AS ${aliasInfo.alias}`;
                }
              }

              const columns = table.columns.join('\\n');
              const label = columns ? buildRecordLabel(`FROM ${displayName}`, columns) : escapeLabelPart(`FROM ${displayName}`);
              // Source tables in CTEs are green
              lines.push(`    ${escapeId(node.id)} [label="${label}", style=filled, fillcolor=lightgreen];`);
            }
          } else if (operations.find(op => op.id === node.id)) {
            // Operation node
            const op = operations.find(op => op.id === node.id)!;
            const labelParts: string[] = [op.operation];

            // Add SQL parameter if available (except for UNION operations)
            if (op.sql && !op.operation.includes('UNION')) {
              // For SELECT, use the shared utility to extract columns
              if (op.operation === 'SELECT') {
                const selectItems = extractSelectColumns(op.sql);
                const selectItemsStr = selectItems.join('\\n');
                labelParts.push(selectItemsStr);
              } else {
                labelParts.push(op.sql);
              }
            } else if (op.outputColumns.length > 0) {
              // Only use output columns if SQL is not available
              const outputCols = op.outputColumns.join('\\n');
              labelParts.push(outputCols);
            }

            const label = buildRecordLabel(...labelParts);
            const color = getOperationColor(op.operation, op.sql);
            lines.push(`    ${escapeId(node.id)} [label="${label}", style=filled, fillcolor=${color}];`);
          } else {
            // Other nodes
            lines.push(`    ${escapeId(node.id)} [label="${escapeLabelPart(node.label)}", style=filled, fillcolor=lightyellow];`);
          }
        }
      });

      // Render edges within the CTE using the shared utility
      const cteInternalEdges = getCTEInternalEdges(graph, cteRelatedNodes);
      cteInternalEdges.forEach(edge => {
        lines.push(`    ${escapeId(edge.from.node)} -> ${escapeId(edge.to.node)};`);
      });

      lines.push('  }');
    }

    // Don't render the CTE node itself as it's represented by the subgraph
    processedNodes.add(cteNodeId);
  });

  // Render operation nodes
  operations.forEach(op => {
    // Skip JOIN operations as they'll be rendered separately with table info
    if (op.operation.includes('JOIN')) return;

    // Skip nodes already rendered in CTE subgraphs
    if (processedNodes.has(op.id)) return;

    // Check if this node has multiple incoming edges (schema change)
    const hasMultipleInputs = (incomingEdgeCount.get(op.id) || 0) >= 2;

    // For nodes with multiple inputs, try to find schema information
    let schemaInfo: string[] = [];
    if (hasMultipleInputs && graph.snapshots) {
      // Find the snapshot for this node
      const snapshot = graph.snapshots.find(s => s.nodeId === op.id);
      if (snapshot?.schema) {
        // Extract column names from the snapshot
        schemaInfo = snapshot.schema.columns.map(col => col.name);
      }
    }

    const labelParts: string[] = [op.operation];

    // Add SQL parameter if available (except for UNION operations)
    if (op.sql && !op.operation.includes('UNION')) {
      // For SELECT, use the shared utility to extract columns
      if (op.operation === 'SELECT') {
        const selectItems = extractSelectColumns(op.sql);
        const selectItemsStr = selectItems.join('\\n');
        labelParts.push(selectItemsStr);
      } else {
        labelParts.push(op.sql);
      }
    } else {
      // Only use output columns if SQL is not available
      const outputCols = op.outputColumns.length > 0 ? op.outputColumns : schemaInfo;
      if (outputCols.length > 0) {
        const colsStr = outputCols.join('\\n');
        labelParts.push(colsStr);
      }
    }

    const label = buildRecordLabel(...labelParts);
    const color = getOperationColor(op.operation, op.sql);
    lines.push(`  ${escapeId(op.id)} [label="${label}", style=filled, fillcolor=${color}];`);
  });

  lines.push('');
  lines.push('  // Data flow edges');

  // Render JOIN nodes that need to show table info
  lines.push('');
  lines.push('  // JOIN operations with table info');
  graph.nodes.forEach(node => {
    if (node.kind === 'op' && node.label.includes('JOIN') && node.sql) {
      // Use the shared utility to get JOIN columns
      const schemaInfo = getJoinColumns(node, graph, tables, tableAliases);

      const columns = schemaInfo.join('\\n');
      // Remove table name from label - just show the JOIN type
      const joinType = node.label.split(' ')[0]; // Extract just "INNER", "LEFT", etc.
      
      // Extract ON clause from node.sql if available
      const labelParts = [`${joinType} JOIN`];
      if (columns) {
        labelParts.push(columns);
      }
      
      // Add ON clause if present
      const onMatch = node.sql.match(/ON\s+(.+)$/i);
      if (onMatch) {
        labelParts.push(`ON ${onMatch[1]}`);
      }
      
      const label = buildRecordLabel(...labelParts);
      lines.push(`  ${escapeId(node.id)} [label="${label}", style=filled, fillcolor=salmon];`);
    }
  });

  // Render regular edges between operations
  graph.edges.forEach(edge => {
    const fromNode = graph.nodes.find(n => n.id === edge.from.node);
    const toNode = graph.nodes.find(n => n.id === edge.to.node);

    if (fromNode && toNode && edge.kind === 'flow') {
      // Skip edges that are internal to CTE subgraphs
      let fromInCTE = false;
      let toInCTE = false;
      let fromCTEId = '';
      let toCTEId = '';

      cteNodes.forEach((cteName, cteNodeId) => {
        // Check if this edge involves the CTE
        if (edge.from.node === cteNodeId) {
          fromInCTE = true;
          fromCTEId = cteNodeId;
        }
        if (edge.to.node === cteNodeId) {
          toInCTE = true;
          toCTEId = cteNodeId;
        }
      });

      // Skip edges to/from FROM nodes that have been replaced
      if (fromNode.label === 'FROM' && fromNodeToTable.has(fromNode.id)) {
        // Edge is from a FROM node that's been replaced by a table node
        // The table node will use the same ID
      }

      // Skip edges that are internal to CTE subgraphs
      let skipEdge = false;
      cteNodes.forEach((cteName, cteNodeId) => {
        // Check if both nodes are in the same CTE
        const fromInThisCTE = processedNodes.has(edge.from.node) && edge.from.node !== cteNodeId;
        const toInThisCTE = processedNodes.has(edge.to.node) && edge.to.node !== cteNodeId;
        if (fromInThisCTE && toInThisCTE) {
          skipEdge = true;
        }
      });

      if (skipEdge) return;

      // Handle CTE connections specially
      if (fromInCTE) {
        // Find the last node in the CTE subgraph to connect from using the shared utility
        const lastCTENode = findLastCTENode(graph, fromCTEId);

        if (lastCTENode) {
          lines.push(`  ${escapeId(lastCTENode)} -> ${escapeId(edge.to.node)};`);
        }
      } else if (toInCTE) {
        // Skip edges to CTE nodes as they're handled by the subgraph
      } else {
        lines.push(`  ${escapeId(edge.from.node)} -> ${escapeId(edge.to.node)};`);
      }
    }
  });

  // Add edges from tables to their JOIN nodes
  joinedTables.forEach((joinNodeId, tableName) => {
    // Skip if this is a CTE
    let isCTE = false;
    cteNodes.forEach((cteName) => {
      if (tableName === cteName) {
        isCTE = true;
      }
    });
    if (isCTE) return;

    // Find the table node ID
    let tableNodeId: string | undefined;

    // Check if it's a FROM node table
    for (const [fromId, tableKey] of fromNodeToTable.entries()) {
      const tName = tableKey.split('_')[0];
      if (tName === tableName) {
        tableNodeId = fromId;
        break;
      }
    }

    // If not found in FROM nodes, use the table's own ID
    if (!tableNodeId && tables.has(tableName)) {
      tableNodeId = tables.get(tableName)!.id;
    }

    // Add edge from table to JOIN node if not already connected
    if (tableNodeId) {
      // Check if edge already exists in the flow
      const edgeExists = graph.edges.some(e =>
        e.from.node === tableNodeId && e.to.node === joinNodeId && e.kind === 'flow'
      );
      if (!edgeExists) {
        lines.push(`  ${escapeId(tableNodeId)} -> ${escapeId(joinNodeId)};`);
      }
    }
  });

  // Render subqueries as subgraphs
  graph.nodes.forEach(node => {
    if (node.kind === 'subquery') {
      const subqueryNode = node as SubqueryNode;
      if (subqueryNode.innerGraph) {
        renderSubquerySubgraph(subqueryNode, lines, graph);
      }
    }
  });

  lines.push('}');
  return lines.join('\n');
};

// Helper functions

/**
 * Determine if an operation changes the schema (columns/structure) of the data
 * 
 * Schema-changing operations:
 * - JOIN: Combines columns from multiple tables
 * - UNION: Combines rows, may change column names/types
 * - DISTINCT: Removes duplicate rows, changes cardinality
 * - GROUP BY: Aggregates data, produces new column structure
 * - SELECT (except SELECT *): Projects specific columns or expressions
 * 
 * Non-schema-changing operations:
 * - WHERE: Filters rows but keeps same columns
 * - HAVING: Filters grouped rows but keeps same columns
 * - ORDER BY: Sorts rows but keeps same columns
 * - LIMIT: Limits row count but keeps same columns
 * - OFFSET: Skips rows but keeps same columns
 */
function isSchemaChangingOperation(operation: string, sql?: string): boolean {
  // Operations that always change schema
  if (operation.includes('JOIN')) return true;
  if (operation.includes('UNION')) return true;
  if (operation === 'DISTINCT') return true;
  if (operation === 'GROUP BY') return true;
  
  // SELECT changes schema unless it's SELECT *
  if (operation === 'SELECT') {
    return sql !== '*';
  }
  
  // These operations filter but don't change schema
  if (operation === 'WHERE') return false;
  if (operation === 'HAVING') return false;
  if (operation === 'ORDER BY') return false;
  if (operation === 'LIMIT') return false;
  if (operation === 'OFFSET') return false;
  
  // Default to assuming schema change for unknown operations
  return true;
}

/**
 * Get the color for an operation node based on whether it changes schema
 * - salmon: Operations that transform schema (JOIN, UNION, SELECT with transformations)
 * - lightyellow: Operations that filter but don't change schema (WHERE, HAVING, simple SELECT)
 */
function getOperationColor(operation: string, sql?: string): string {
  return isSchemaChangingOperation(operation, sql) ? 'salmon' : 'lightyellow';
}

function escapeId(id: string): string {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
    return id;
  }
  return `"${id.replace(/"/g, '\\"')}"`;
}

function escapeLabel(label: string): string {
  return label
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\|/g, '\\|')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>');
}

function escapeLabelPart(part: string): string {
  // Escape individual parts of a label (before joining with pipes)
  // Don't escape backslashes that are part of \n sequences
  return part
    .replace(/\\(?!n)/g, '\\\\')  // Escape backslashes except when followed by 'n'
    .replace(/"/g, '\\"')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\|/g, '\\|')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>');
}

function buildRecordLabel(...parts: string[]): string {
  // Build a record label by escaping parts and joining with unescaped pipes
  return parts.map(part => escapeLabelPart(part)).join('|');
}

function buildHtmlLabel(title: string, ...parts: string[]): string {
  // Build an HTML-like label for better formatting support
  // Use BORDER="0" to avoid double borders (node already has a border)
  let html = '<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="4">';
  
  // Title row with bottom border
  html += `<TR><TD><B>${escapeHtml(title)}</B></TD></TR>`;
  
  // Add horizontal line
  html += '<HR/>';
  
  // Content rows
  for (const part of parts) {
    html += `<TR><TD ALIGN="LEFT">${part}</TD></TR>`;
  }
  
  html += '</TABLE>';
  return html;
}

function buildMinimalHtmlLabel(title: string, content: string): string {
  // Build a minimal HTML label that looks like a record label
  // but supports left-aligned text with line breaks
  return `<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0">
    <TR><TD><B>${escapeHtml(title)}</B> | ${content}</TD></TR>
  </TABLE>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}




// Render subquery as a subgraph
function renderSubquerySubgraph(subqueryNode: SubqueryNode, lines: string[], parentGraph: Graph): void {
  const subgraphId = `cluster_${subqueryNode.id}`;
  const subqueryType = subqueryNode.subqueryType.toUpperCase();
  const correlatedLabel = subqueryNode.correlatedFields && subqueryNode.correlatedFields.length > 0
    ? ` (correlated: ${subqueryNode.correlatedFields.join(', ')})`
    : '';

  lines.push('');
  lines.push(`  subgraph ${subgraphId} {`);
  lines.push(`    label="${subqueryType} Subquery${correlatedLabel}";`);
  lines.push('    style=filled;');
  lines.push('    color=lightgrey;');

  if (!subqueryNode.innerGraph) {
    lines.push('  }');
    return;
  }

  // Recursively render the inner graph using renderDot
  const innerLines = renderDot(subqueryNode.innerGraph).split('\n');

  // Extract only the node and edge definitions from the inner graph
  let inSubgraph = false;
  let subgraphDepth = 0;
  for (const line of innerLines) {
    const trimmedLine = line.trim();

    // Skip the outer digraph declaration and closing brace
    if (trimmedLine.startsWith('digraph') || (trimmedLine === '}' && subgraphDepth === 0)) continue;
    if (trimmedLine.startsWith('rankdir') || trimmedLine.startsWith('node [shape')) continue;
    if (trimmedLine === '' && subgraphDepth === 0) continue;

    // Track nested subgraph depth
    if (trimmedLine.startsWith('subgraph')) {
      subgraphDepth++;
    } else if (trimmedLine === '}' && subgraphDepth > 0) {
      subgraphDepth--;
    }

    // Add proper indentation
    if (trimmedLine) {
      lines.push(`    ${trimmedLine}`);
    }
  }

  lines.push('  }');

  // Connect subquery result to parent nodes if needed
  const resultNode = findSubqueryResultNode(subqueryNode.innerGraph);
  if (resultNode) {
    // Find edges in parent graph that connect from this subquery
    const outgoingEdges = parentGraph.edges.filter(e => e.from.node === subqueryNode.id);
    for (const edge of outgoingEdges) {
      // Use the edge's label if it exists, otherwise fall back to default
      const resultLabel = edge.label || getSubqueryResultLabel(subqueryNode.subqueryType);
      lines.push(`  ${escapeId(resultNode.id)} -> ${escapeId(edge.to.node)} [label="${resultLabel}"];`);
    }
  }

  // Note: Edges between nested subqueries are already handled by the recursive
  // renderDot call above, so we don't need to add them again
}
