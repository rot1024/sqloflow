/**
 * Utilities for inferring schema information from SQL statements
 */

import type { Graph, Node, SchemaSnapshot } from '../../types/ir.js';

export interface TableInfo {
  id: string;
  tableName: string;
  columns: string[];
  type: 'source' | 'result' | 'intermediate';
}

export interface ColumnReference {
  table: string;
  column: string;
}

export interface TableAlias {
  table: string;
  alias: string;
}

/**
 * Extract column references from SQL string
 * Matches patterns like "table.column" or "alias.column"
 */
export function extractColumnReferences(sql: string): ColumnReference[] {
  const refs: ColumnReference[] = [];
  
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

/**
 * Extract table name and alias from SQL string
 * Handles patterns like "table AS alias" or "table alias"
 */
export function extractTableAndAlias(sql: string): TableAlias | null {
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
  
  // Handle "table alias" pattern (without AS)
  const spaceMatch = cleanSql.match(/^(\w+)\s+(\w+)$/);
  if (spaceMatch) {
    return { table: spaceMatch[1], alias: spaceMatch[2] };
  }
  
  // Just table name, no alias
  const tableMatch = cleanSql.match(/^(\w+)$/);
  if (tableMatch) {
    return { table: tableMatch[1], alias: tableMatch[1] };
  }
  
  return null;
}

/**
 * Infer schema information from SQL statements in the graph
 */
export function inferSchemaFromGraph(graph: Graph): {
  tables: Map<string, TableInfo>;
  tableAliases: Map<string, string>;
} {
  const tables = new Map<string, TableInfo>();
  const tableAliases = new Map<string, string>();
  
  // First, extract schema from snapshots (if available from CREATE TABLE)
  if (graph.snapshots) {
    const schemaSnapshot = graph.snapshots.find(s => s.relations && Object.keys(s.relations).length > 0);
    if (schemaSnapshot?.relations) {
      Object.entries(schemaSnapshot.relations).forEach(([aliasName, schema]) => {
        if (!aliasName.startsWith('_')) {
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
          tableAliases.set(aliasInfo.alias, aliasInfo.table);
          
          // If table doesn't exist in our collection, create a placeholder
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
      const columnRefs = extractColumnReferences(node.sql);
      columnRefs.forEach(ref => {
        const actualTable = tableAliases.get(ref.table) || ref.table;
        const table = tables.get(actualTable);
        if (table && !table.columns.includes(ref.column)) {
          table.columns.push(ref.column);
        }
      });
    }
    
    if (node.kind === 'clause' && node.label === 'WHERE' && node.sql) {
      const columnRefs = extractColumnReferences(node.sql);
      columnRefs.forEach(ref => {
        const actualTable = tableAliases.get(ref.table) || ref.table;
        const table = tables.get(actualTable);
        if (table && !table.columns.includes(ref.column)) {
          table.columns.push(ref.column);
        }
      });
    }
    
    if (node.kind === 'op' && node.label.includes('JOIN') && node.sql) {
      const columnRefs = extractColumnReferences(node.sql);
      columnRefs.forEach(ref => {
        const actualTable = tableAliases.get(ref.table) || ref.table;
        const table = tables.get(actualTable);
        if (table && !table.columns.includes(ref.column)) {
          table.columns.push(ref.column);
        }
      });
    }
  });
  
  return { tables, tableAliases };
}

/**
 * Get all columns for a JOIN node by looking at all involved tables
 */
export function getJoinColumns(
  node: Node,
  graph: Graph,
  tables: Map<string, TableInfo>,
  tableAliases: Map<string, string>
): string[] {
  const schemaInfo: string[] = [];
  const joinedTables = new Set<string>();
  
  // Find all edges coming into this JOIN node
  graph.edges.forEach(edge => {
    if (edge.to.node === node.id && edge.kind === 'flow') {
      const fromNode = graph.nodes.find(n => n.id === edge.from.node);
      if (fromNode && fromNode.label.startsWith('FROM')) {
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
  if (node.sql) {
    // The SQL might be "orders o ON u.id = o.user_id" or "orders AS o ON..."
    const tableInfo = extractTableAndAlias(node.sql);
    if (tableInfo) {
      joinedTables.add(tableInfo.table);
      tableAliases.set(tableInfo.alias, tableInfo.table);
    }
  }
  
  // Get ALL columns from ALL joined tables
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
  
  return schemaInfo;
}