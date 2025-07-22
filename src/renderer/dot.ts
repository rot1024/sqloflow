/**
 * Enhanced schema view renderer that shows column-level details
 */

import type { Graph, Node, Edge, SubqueryNode, SchemaSnapshot, RelationSchema } from '../types/ir.js';
import { findSubqueryResultNode, getSubqueryResultLabel } from '../converter/subquery-converter.js';

interface TableNode {
  id: string;
  tableName: string;
  columns: string[];
  type: 'source' | 'result' | 'intermediate';
}

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
  
  // Collect all tables from snapshots
  const tables = new Map<string, TableNode>();
  const tableAliases = new Map<string, string>(); // alias -> actual table name
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
  
  // Process snapshots to extract schema information
  if (graph.snapshots) {
    // Use the first snapshot that contains schema information (after CREATE TABLE)
    const schemaSnapshot = graph.snapshots.find(s => s.relations && Object.keys(s.relations).length > 0);
    if (schemaSnapshot?.relations) {
      Object.entries(schemaSnapshot.relations).forEach(([aliasName, schema]) => {
        // Skip internal tables like _result
        if (!aliasName.startsWith('_')) {
          // Use the actual table name from the schema, not the alias
          const actualTableName = schema.name;
          tables.set(actualTableName, {
            id: `table_${actualTableName}`,
            tableName: actualTableName,
            columns: schema.columns.map(col => col.name),
            type: 'source'
          });
        }
      });
    }
  }
  
  // Process FROM and JOIN nodes to build alias mapping and infer tables
  graph.nodes.forEach(node => {
    if ((node.kind === 'op' && node.label === 'FROM') || 
        (node.kind === 'op' && node.label.includes('JOIN'))) {
      if (node.sql) {
        const aliasInfo = extractTableAndAlias(node.sql);
        if (aliasInfo) {
          // Always map alias to table name
          tableAliases.set(aliasInfo.alias, aliasInfo.table);
          
          // Map FROM node to table for later replacement
          if (node.label === 'FROM') {
            fromNodeToTable.set(node.id, `${aliasInfo.table}_${node.id}`);
          }
          
          // If table doesn't exist in our collection (no CREATE TABLE), 
          // create a placeholder with inferred columns
          if (!tables.has(aliasInfo.table)) {
            tables.set(aliasInfo.table, {
              id: `table_${aliasInfo.table}`,
              tableName: aliasInfo.table,
              columns: [], // Will be populated from SELECT/WHERE clauses
              type: 'source'
            });
          }
        }
      }
    }
  });
  
  // Infer columns from SELECT, WHERE, and JOIN clauses
  graph.nodes.forEach(node => {
    if (node.kind === 'op' && node.label === 'SELECT' && node.sql) {
      // Extract column references from SELECT
      const columnRefs = extractColumnReferences(node.sql);
      columnRefs.forEach(ref => {
        const actualTable = tableAliases.get(ref.table) || ref.table;
        const table = tables.get(actualTable);
        if (table && !table.columns.includes(ref.column)) {
          table.columns.push(ref.column);
        } else if (!table && !tables.has(ref.table)) {
          // Don't create a table for an alias that we couldn't resolve
          console.warn(`Could not resolve table for reference: ${ref.table}.${ref.column}`);
        }
      });
    }
    
    if (node.kind === 'clause' && node.label === 'WHERE' && node.sql) {
      // Extract column references from WHERE
      const columnRefs = extractColumnReferences(node.sql);
      columnRefs.forEach(ref => {
        const actualTable = tableAliases.get(ref.table) || ref.table;
        const table = tables.get(actualTable);
        if (table && !table.columns.includes(ref.column)) {
          table.columns.push(ref.column);
        } else if (!table && !tables.has(ref.table)) {
          // Don't create a table for an alias that we couldn't resolve
          console.warn(`Could not resolve table for reference: ${ref.table}.${ref.column}`);
        }
      });
    }
    
    if (node.kind === 'op' && node.label.includes('JOIN') && node.sql) {
      // Extract column references from JOIN ON clause
      const columnRefs = extractColumnReferences(node.sql);
      columnRefs.forEach(ref => {
        const actualTable = tableAliases.get(ref.table) || ref.table;
        const table = tables.get(actualTable);
        if (table && !table.columns.includes(ref.column)) {
          table.columns.push(ref.column);
        } else if (!table && !tables.has(ref.table)) {
          // Don't create a table for an alias that we couldn't resolve
          console.warn(`Could not resolve table for reference: ${ref.table}.${ref.column}`);
        }
      });
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
          const columns = extractColumnsFromSelectSQL(node.sql);
          operation.outputColumns = columns;
        }
      }
      
      operations.push(operation);
    } else if (node.kind === 'subquery') {
      // Handle subquery nodes - will be rendered as subgraphs
      // Don't add to operations list, they'll be handled separately
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
  
  // Track CTE nodes and their associated nodes
  const cteNodes = new Map<string, string>(); // CTE node ID -> CTE name
  const processedNodes = new Set<string>();
  
  // First pass: identify CTE nodes
  graph.nodes.forEach(node => {
    if (node.kind === 'relation' && node.label.startsWith('CTE:')) {
      const cteName = node.label.replace('CTE: ', '');
      cteNodes.set(node.id, cteName);
    }
  });
  
  // Render table nodes (replacing FROM nodes)
  lines.push('  // Source tables');
  
  // First, render all FROM nodes that have been mapped
  fromNodeToTable.forEach((tableKey, fromNodeId) => {
    // Skip nodes already rendered in CTE subgraphs
    if (processedNodes.has(fromNodeId)) return;
    
    const tableName = tableKey.split('_')[0]; // Extract actual table name
    const table = tables.get(tableName);
    if (table) {
      // Find the FROM node to get alias information
      const fromNode = graph.nodes.find(n => n.id === fromNodeId);
      let displayName = tableName;
      
      if (fromNode && fromNode.sql) {
        const aliasInfo = extractTableAndAlias(fromNode.sql);
        if (aliasInfo && aliasInfo.alias !== aliasInfo.table) {
          displayName = `${tableName} AS ${aliasInfo.alias}`;
        }
      }
      
      const columns = table.columns.join('\\n');
      const label = columns ? buildRecordLabel(`FROM ${displayName}`, columns) : escapeLabelPart(`FROM ${displayName}`);
      const color = table.type === 'source' ? 'lightgreen' : 
                    table.type === 'result' ? 'lightcoral' : 'lightblue';
      lines.push(`  ${escapeId(fromNodeId)} [label="${label}", style=filled, fillcolor=${color}];`);
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
      const color = table.type === 'source' ? 'lightgreen' : 
                    table.type === 'result' ? 'lightcoral' : 'lightblue';
      lines.push(`  ${table.id} [label="${label}", style=filled, fillcolor=${color}];`);
    }
  });
  
  lines.push('');
  lines.push('  // Operations');
  
  // Render CTEs as subgraphs
  cteNodes.forEach((cteName, cteNodeId) => {
    // Find all nodes that lead to this CTE node
    const cteSubgraphNodes = new Set<string>();
    
    // Traverse backwards from the CTE node to find all nodes in the CTE
    const findCTENodes = (nodeId: string) => {
      if (cteSubgraphNodes.has(nodeId)) return;
      cteSubgraphNodes.add(nodeId);
      
      // Find edges that lead to this node
      graph.edges.forEach(edge => {
        if (edge.to.node === nodeId && edge.kind === 'flow') {
          findCTENodes(edge.from.node);
        }
      });
    };
    
    // Start from edges that define the CTE
    graph.edges.forEach(edge => {
      if (edge.to.node === cteNodeId && edge.kind === 'defines') {
        findCTENodes(edge.from.node);
      }
    });
    
    // Render CTE as subgraph
    if (cteSubgraphNodes.size > 0) {
      lines.push('');
      lines.push(`  subgraph cluster_${cteNodeId} {`);
      lines.push(`    label="CTE: ${cteName}";`);
      lines.push('    style=filled;');
      lines.push('    color=lightblue;');
      lines.push('    node [style=filled,color=white];');
      
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
              lines.push(`    ${escapeId(node.id)} [label="${label}", style=filled, fillcolor=lightgreen];`);
            }
          } else if (operations.find(op => op.id === node.id)) {
            // Operation node
            const op = operations.find(op => op.id === node.id)!;
            const labelParts: string[] = [op.operation];
            
            // Add SQL parameter if available (except for SELECT, UNION, and Result operations)
            if (op.sql && op.operation !== 'SELECT' && !op.operation.includes('UNION') && op.operation !== 'Result') {
              labelParts.push(op.sql);
            }
            
            // Add output columns if available
            if (op.outputColumns.length > 0) {
              const outputCols = op.outputColumns.join('\\n');
              labelParts.push(outputCols);
            }
            
            const label = buildRecordLabel(...labelParts);
            lines.push(`    ${escapeId(node.id)} [label="${label}", style=filled, fillcolor=lightyellow];`);
          } else {
            // Other nodes
            lines.push(`    ${escapeId(node.id)} [label="${escapeLabelPart(node.label)}", style=filled, fillcolor=lightyellow];`);
          }
        }
      });
      
      // Render edges within the CTE
      graph.edges.forEach(edge => {
        if (cteSubgraphNodes.has(edge.from.node) && cteSubgraphNodes.has(edge.to.node) && edge.kind === 'flow') {
          lines.push(`    ${escapeId(edge.from.node)} -> ${escapeId(edge.to.node)};`);
        }
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
      const snapshot = graph.snapshots.find(s => s.stepId === op.id);
      if (snapshot?.relations) {
        // Extract column information from the snapshot
        const resultRelation = snapshot.relations._result || snapshot.relations._grouped;
        if (resultRelation) {
          schemaInfo = resultRelation.columns.map(col => col.name);
        } else if (op.operation === 'UNION' || op.operation === 'UNION ALL') {
          // For UNION, collect all unique columns from all input relations
          const uniqueColumns = new Set<string>();
          Object.entries(snapshot.relations).forEach(([relName, rel]) => {
            if (!relName.startsWith('_')) {
              rel.columns.forEach(col => {
                uniqueColumns.add(col.name);
              });
            }
          });
          // Add all columns without table prefixes since they're unified
          schemaInfo = Array.from(uniqueColumns);
        } else {
          // Collect all columns from all relations
          const allColumns = new Set<string>();
          Object.values(snapshot.relations).forEach(rel => {
            if (!rel.name.startsWith('_')) {
              rel.columns.forEach(col => allColumns.add(col.name));
            }
          });
          schemaInfo = Array.from(allColumns);
        }
      }
    }
    
    const labelParts: string[] = [op.operation];
    
    // Add SQL parameter if available (except for SELECT, UNION, and Result operations)
    if (op.sql && op.operation !== 'SELECT' && !op.operation.includes('UNION') && op.operation !== 'Result') {
      labelParts.push(op.sql);
    }
    
    // Add output columns if available
    const outputCols = op.outputColumns.length > 0 ? op.outputColumns : schemaInfo;
    if (outputCols.length > 0) {
      const colsStr = outputCols.join('\\n');
      labelParts.push(colsStr);
    }
    
    const label = buildRecordLabel(...labelParts);
    lines.push(`  ${escapeId(op.id)} [label="${label}", style=filled, fillcolor=lightyellow];`);
  });
  
  lines.push('');
  lines.push('  // Data flow edges');
  
  // Render JOIN nodes that need to show table info
  lines.push('');
  lines.push('  // JOIN operations with table info');
  graph.nodes.forEach(node => {
    if (node.kind === 'op' && node.label.includes('JOIN') && node.sql) {
      // JOINs always have multiple inputs (at least 2 tables), so show schema
      let schemaInfo: string[] = [];
      
      // Instead of relying on snapshots which may only have referenced columns,
      // we need to find all tables involved in the JOIN and get ALL their columns
      const joinedTables = new Set<string>();
      
      // Find all edges coming into this JOIN node
      graph.edges.forEach(edge => {
        if (edge.to.node === node.id && edge.kind === 'flow') {
          const fromNode = graph.nodes.find(n => n.id === edge.from.node);
          if (fromNode && fromNode.label.startsWith('FROM')) {
            // Extract table name from FROM node
            const tableMatch = fromNode.sql?.match(/FROM\s+(\w+)(?:\s+AS\s+(\w+))?/i);
            if (tableMatch) {
              const tableName = tableMatch[1];
              const alias = tableMatch[2] || tableName;
              joinedTables.add(tableName);
              tableAliases.set(alias, tableName);
            }
          }
        }
      });
      
      // Also check for the table mentioned in the JOIN clause itself
      const joinTableMatch = node.sql.match(/JOIN\s+(\w+)(?:\s+AS\s+(\w+))?/i);
      if (joinTableMatch) {
        const tableName = joinTableMatch[1];
        const alias = joinTableMatch[2] || tableName;
        joinedTables.add(tableName);
        tableAliases.set(alias, tableName);
      }
      
      // Now get ALL columns from ALL joined tables
      joinedTables.forEach(tableName => {
        const table = tables.get(tableName);
        if (table) {
          table.columns.forEach(colName => {
            schemaInfo.push(`${tableName}.${colName}`);
          });
        } else if (graph.snapshots) {
          // Check if it's a CTE by looking at snapshots
          for (const snapshot of graph.snapshots) {
            if (snapshot.relations[tableName]) {
              snapshot.relations[tableName].columns.forEach(col => {
                schemaInfo.push(`${tableName}.${col.name}`);
              });
              break;
            }
          }
        }
      });
      
      const columns = schemaInfo.join('\\n');
      // Remove table name from label - just show the JOIN type
      const joinType = node.label.split(' ')[0]; // Extract just "INNER", "LEFT", etc.
      const label = columns ? buildRecordLabel(`${joinType} JOIN`, columns) : escapeLabelPart(`${joinType} JOIN`);
      lines.push(`  ${escapeId(node.id)} [label="${label}", style=filled, fillcolor=lightyellow];`);
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
        // Find the last node in the CTE subgraph to connect from
        let lastCTENode: string | null = null;
        
        // Find the node that has an edge TO the CTE node with 'defines' kind
        graph.edges.forEach(e => {
          if (e.to.node === fromCTEId && e.kind === 'defines') {
            lastCTENode = e.from.node;
          }
        });
        
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

function extractColumnsFromSelectSQL(sql: string): string[] {
  // Simple extraction - in real implementation, we'd parse the SQL properly
  if (sql === '*') return ['*'];
  
  // Try to extract column names from SELECT list
  const columns: string[] = [];
  const parts = sql.split(',').map(s => s.trim());
  
  parts.forEach(part => {
    // Handle "column AS alias" pattern
    const asMatch = part.match(/(.+?)\s+AS\s+(\w+)/i);
    if (asMatch) {
      let expression = asMatch[1].trim();
      // Remove quotes from string literals
      if ((expression.startsWith("'") && expression.endsWith("'")) ||
          (expression.startsWith('"') && expression.endsWith('"'))) {
        expression = expression.slice(1, -1);
      }
      // Show the full expression with AS clause
      columns.push(`${expression} AS ${asMatch[2]}`);
    } else {
      // For simple columns, remove quotes if it's a string literal
      let cleaned = part;
      if ((cleaned.startsWith("'") && cleaned.endsWith("'")) ||
          (cleaned.startsWith('"') && cleaned.endsWith('"'))) {
        cleaned = cleaned.slice(1, -1);
      }
      columns.push(cleaned);
    }
  });
  
  return columns;
}

function extractTableAndAlias(sql: string): { table: string; alias: string } | null {
  if (!sql) return null;
  
  // Clean the SQL
  let cleanSql = sql.trim();
  
  // Remove "FROM " or "JOIN " prefix if present, including INNER/LEFT/RIGHT/OUTER
  cleanSql = cleanSql.replace(/^(FROM|(INNER|LEFT|RIGHT|OUTER|FULL)?\s*JOIN)\s+/i, '').trim();
  
  // Also remove everything after ON for JOIN statements
  const onIndex = cleanSql.search(/\s+ON\s+/i);
  if (onIndex > -1) {
    cleanSql = cleanSql.substring(0, onIndex).trim();
  }
  
  // Handle "table AS alias" or "table alias" patterns
  const asMatch = cleanSql.match(/^(\w+)\s+AS\s+(\w+)/i);
  if (asMatch) {
    return { table: asMatch[1], alias: asMatch[2] };
  }
  
  // Handle "table alias" without AS
  const parts = cleanSql.split(/\s+/);
  if (parts.length >= 2 && /^\w+$/.test(parts[0]) && /^\w+$/.test(parts[1])) {
    // Check if the second part is not a SQL keyword
    const keywords = ['ON', 'WHERE', 'ORDER', 'GROUP', 'HAVING', 'LIMIT'];
    if (!keywords.includes(parts[1].toUpperCase())) {
      return { table: parts[0], alias: parts[1] };
    }
  }
  
  // Just table name, use it as both table and alias
  if (parts.length > 0 && /^\w+$/.test(parts[0])) {
    return { table: parts[0], alias: parts[0] };
  }
  
  return null;
}

function extractColumnReferences(sql: string): { table: string; column: string }[] {
  const refs: { table: string; column: string }[] = [];
  
  if (!sql) return refs;
  
  // Match patterns like "table.column" or "alias.column"
  const columnPattern = /(\w+)\.(\w+)/g;
  let match;
  
  while ((match = columnPattern.exec(sql)) !== null) {
    refs.push({
      table: match[1],
      column: match[2]
    });
  }
  
  return refs;
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
  lines.push('    node [style=filled,color=white];');
  
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
      const resultLabel = getSubqueryResultLabel(subqueryNode.subqueryType);
      lines.push(`  ${escapeId(resultNode.id)} -> ${escapeId(edge.to.node)} [label="${resultLabel}"];`);
    }
  }
  
  // Note: Edges between nested subqueries are already handled by the recursive
  // renderDot call above, so we don't need to add them again
}

