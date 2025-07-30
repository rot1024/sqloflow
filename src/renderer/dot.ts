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

export const renderDot = (graph: Graph, parentTables?: Map<string, TableInfo>): string => {
  const lines: string[] = [];
  lines.push('digraph schema_flow {');
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=record];');
  lines.push('');

  // Infer schema information from the graph
  let tables: Map<string, TableInfo>;
  let tableAliases: Map<string, string>;
  
  if (parentTables) {
    // For subqueries, merge parent tables with locally inferred tables
    const localData = inferSchemaFromGraph(graph);
    tables = new Map(parentTables);
    // Add any tables found in this subquery that aren't in parent
    localData.tables.forEach((tableInfo, tableName) => {
      if (!tables.has(tableName)) {
        tables.set(tableName, tableInfo);
      } else {
        // Merge columns from local inference into existing table
        const existingTable = tables.get(tableName)!;
        const mergedColumns = new Set([...existingTable.columns, ...tableInfo.columns]);
        tables.set(tableName, {
          ...existingTable,
          columns: Array.from(mergedColumns)
        });
      }
    });
    tableAliases = localData.tableAliases;
  } else {
    // First, collect tables from the main graph
    const inferredData = inferSchemaFromGraph(graph);
    tables = inferredData.tables;
    tableAliases = inferredData.tableAliases;
    
    // Also collect tables from all subqueries recursively
    const collectSubqueryTables = (g: Graph) => {
      g.nodes.forEach(node => {
        if (node.kind === 'subquery') {
          const subqueryNode = node as SubqueryNode;
          if (subqueryNode.innerGraph) {
            const subqueryData = inferSchemaFromGraph(subqueryNode.innerGraph);
            // Merge subquery tables into main tables map
            subqueryData.tables.forEach((tableInfo, tableName) => {
              if (!tables.has(tableName)) {
                tables.set(tableName, tableInfo);
              } else {
                // Merge columns from subquery inference
                const existingTable = tables.get(tableName)!;
                const mergedColumns = new Set([...existingTable.columns, ...tableInfo.columns]);
                tables.set(tableName, {
                  ...existingTable,
                  columns: Array.from(mergedColumns)
                });
              }
            });
            // Also merge aliases
            subqueryData.tableAliases.forEach((table, alias) => {
              tableAliases.set(alias, table);
            });
            // Recursively collect from nested subqueries
            collectSubqueryTables(subqueryNode.innerGraph);
          }
        }
      });
    };
    
    collectSubqueryTables(graph);
  }

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
      // Skip FROM nodes only if they are mapped to table nodes
      if (node.label === 'FROM' && fromNodeToTable.has(node.id)) return;

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
    // Handle both regular nodes (e.g., "orders_node_1") and subquery nodes (e.g., "orders_subq_0_node_0")
    const nodeIdMatch = tableKey.match(/^(.+?)_(subq_\d+_)?node_\d+$/);
    const tableName = nodeIdMatch ? nodeIdMatch[1] : tableKey.split('_')[0];
    
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
      let table = tables.get(tableName);
      
      // If not found by exact name, try to find by alias
      if (!table && fromNode && fromNode.sql) {
        const aliasInfo = extractTableAndAlias(fromNode.sql);
        if (aliasInfo) {
          // Try the actual table name from the SQL
          table = tables.get(aliasInfo.table);
        }
      }
      
      if (table && table.columns.length > 0) {
        let displayName = tableName;

        if (fromNode && fromNode.sql) {
          const aliasInfo = extractTableAndAlias(fromNode.sql);
          if (aliasInfo && aliasInfo.alias !== aliasInfo.table) {
            displayName = `${aliasInfo.table} AS ${aliasInfo.alias}`;
          }
        }

        const columns = table.columns.join('\\n');
        const label = buildRecordLabel(`FROM ${displayName}`, columns);
        // Source tables are always green
        lines.push(`  ${escapeId(fromNodeId)} [label="${label}", style=filled, fillcolor=lightgreen];`);
      } else if (fromNode) {
        // No table info found, but we still need to render the FROM node
        const label = fromNode.sql ? escapeLabelPart(fromNode.sql) : escapeLabelPart(`FROM ${tableName}`);
        lines.push(`  ${escapeId(fromNodeId)} [label="${label}", style=filled, fillcolor=lightgreen];`);
      }
    }
  });

  // Then render any tables that don't have FROM nodes
  // Skip this section when rendering subqueries to avoid showing parent tables
  if (!parentTables) {
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
        // Extract table name from the key
        const nodeIdMatch = tableKey.match(/^(.+?)_(subq_\d+_)?node_\d+$/);
        const keyTableName = nodeIdMatch ? nodeIdMatch[1] : tableKey.split('_')[0];
        if (keyTableName === table.tableName) {
          alreadyRendered = true;
          break;
        }
      }
      
      // Also check if this table is only used in subqueries
      let onlyInSubquery = true;
      graph.nodes.forEach(node => {
        if (node.kind === 'op' && node.label === 'FROM' && node.sql) {
          const aliasInfo = extractTableAndAlias(node.sql);
          if (aliasInfo && aliasInfo.table === table.tableName) {
            onlyInSubquery = false;
          }
        }
      });

      if (!alreadyRendered && !onlyInSubquery) {
        const columns = table.columns.join('\\n');
        const label = columns ? buildRecordLabel(`FROM ${table.tableName}`, columns) : escapeLabelPart(`FROM ${table.tableName}`);
        // Source tables are always green
        lines.push(`  ${table.id} [label="${label}", style=filled, fillcolor=lightgreen];`);
      }
    });
  }

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

    // Handle unmapped FROM nodes specially
    if (op.operation === 'FROM') {
      // Try to extract table info and columns
      if (op.sql) {
        const aliasInfo = extractTableAndAlias(op.sql);
        if (aliasInfo) {
          // First try exact table name
          let table = tables.get(aliasInfo.table);
          
          // If not found, try looking through aliases
          if (!table) {
            for (const [alias, tableName] of tableAliases.entries()) {
              if (alias === aliasInfo.table || tableName === aliasInfo.table) {
                table = tables.get(tableName);
                if (table) break;
              }
            }
          }
          
          if (table && table.columns.length > 0) {
            // Show FROM with columns
            const displayName = aliasInfo.alias !== aliasInfo.table ? 
              `${aliasInfo.table} AS ${aliasInfo.alias}` : aliasInfo.table;
            const columns = table.columns.join('\\n');
            const label = buildRecordLabel(`FROM ${displayName}`, columns);
            lines.push(`  ${escapeId(op.id)} [label="${label}", style=filled, fillcolor=lightgreen];`);
            return;
          }
        }
      }
      // Final fallback to simple label
      const label = op.sql ? escapeLabelPart(op.sql) : escapeLabelPart('FROM');
      lines.push(`  ${escapeId(op.id)} [label="${label}", style=filled, fillcolor=lightgreen];`);
      return;
    }

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
        renderSubquerySubgraph(subqueryNode, lines, graph, tables);
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
 * - APPLY: Combines columns from table-valued functions or subqueries
 * - PIVOT: Transforms rows into columns
 * - UNPIVOT: Transforms columns into rows
 * - SELECT (except SELECT *): Projects specific columns or expressions
 * 
 * Non-schema-changing operations:
 * - WHERE: Filters rows but keeps same columns
 * - HAVING: Filters grouped rows but keeps same columns
 * - ORDER BY: Sorts rows but keeps same columns
 * - LIMIT: Limits row count but keeps same columns
 * - OFFSET: Skips rows but keeps same columns
 * - FETCH: Limits row count but keeps same columns
 * - DISTINCT: Removes duplicate rows but keeps same columns
 * - GROUP BY: Aggregates data but doesn't change schema structure
 * - UNION/INTERSECT/EXCEPT: Set operations that preserve schema
 */
function isSchemaChangingOperation(operation: string, sql?: string): boolean {
  // Operations that change schema
  if (operation.includes('JOIN')) return true;
  if (operation.includes('APPLY')) return true;
  if (operation.includes('PIVOT')) return true;
  if (operation.includes('UNPIVOT')) return true;
  if (operation.includes('UNION')) return true;  // UNION/UNION ALL change schema
  if (operation === 'GROUP BY') return true;  // GROUP BY aggregates data, changing schema
  
  // SELECT changes schema unless it's SELECT *
  if (operation === 'SELECT') {
    return sql !== '*';
  }
  
  // All other operations don't change schema
  return false;
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
function renderSubquerySubgraph(subqueryNode: SubqueryNode, lines: string[], parentGraph: Graph, parentTables: Map<string, TableInfo>): void {
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

  // Recursively render the inner graph using renderDot with parent table information
  const innerLines = renderDot(subqueryNode.innerGraph, parentTables).split('\n');

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
