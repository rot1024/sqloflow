/**
 * Utilities for building node schemas map from graph
 */

import type { Graph, Node } from '../../types/ir.js';
import type { TableInfo } from './schema-inference.js';
import { extractTableAndAlias } from './schema-inference.js';

/**
 * Build node schemas map for display
 * This map contains the columns that should be displayed for each node
 */
export function buildNodeSchemas(
  graph: Graph,
  tables: Map<string, TableInfo>
): Map<string, string[]> {
  const nodeSchemas = new Map<string, string[]>();

  // Process nodes to populate nodeSchemas based on their operation type
  graph.nodes.forEach(node => {
    if (node.kind === 'op' && node.label === 'FROM' && node.sql) {
      // For FROM nodes, show all columns from the table
      const aliasInfo = extractTableAndAlias(node.sql);
      if (aliasInfo) {
        const tableName = aliasInfo.table;
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

  return nodeSchemas;
}

/**
 * Extract columns from SELECT SQL
 */
export function extractSelectColumns(sql: string): string[] {
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

/**
 * Get label parts for a node based on its type and content
 */
export function getNodeLabelParts(
  node: Node,
  nodeSchemas: Map<string, string[]>,
  schemaColumns?: string[]
): string[] {
  const parts: string[] = [node.label];
  
  // Get schema information for this node
  const nodeColumns = schemaColumns || nodeSchemas.get(node.id);
  
  if (node.kind === 'op' && node.label === 'SELECT' && node.sql) {
    // For SELECT nodes, show the SQL expressions
    const selectItems = extractSelectColumns(node.sql);
    return [node.label, ...selectItems];
  } else if (nodeColumns && nodeColumns.length > 0) {
    // For nodes with schema info, add columns
    parts.push(...nodeColumns);
  } else if (node.sql) {
    // For other nodes with SQL, add it
    parts.push(node.sql);
  }
  
  return parts;
}