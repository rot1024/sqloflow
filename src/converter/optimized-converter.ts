/**
 * Optimized version of convertSelectStatement that uses a single AST traversal
 */

import type { Node, Edge, SubqueryNode, ColumnSchema } from '../types/ir.js';
import type { ConversionContext } from './types.js';
import type { Select, From } from 'node-sql-parser';
import { ConversionError } from '../errors.js';
import {
  createNode,
  createEdge,
  selectListToSQL,
  tableToSQL,
  joinToSQL,
  expressionToSQL,
  groupByToSQL,
  orderByToSQL,
  limitToSQL
} from './helpers.js';
import { createSnapshot, applySchemaTransformation, inferColumnsFromExpression } from './schema-transformations.js';
import { convertSubquery } from './subquery-converter.js';
import { visitExpression, visitSelectList, visitWhereClause, type VisitorCallbacks } from './ast-visitor.js';

interface SubqueryInfo {
  ast: Select;
  type: 'scalar' | 'in' | 'exists';
  location: string;
}

export const convertSelectStatementOptimized = (
  ctx: ConversionContext,
  stmt: Select
): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let lastNodeId: string | null = null;

  // Collect all subqueries in a single pass
  const subqueries: SubqueryInfo[] = [];
  const subqueryVisitor: VisitorCallbacks = {
    onSubquery: (ast, context) => {
      // Determine subquery type from context
      let type: 'scalar' | 'in' | 'exists' = 'scalar';
      if (context.path.includes('EXISTS')) {
        type = 'exists';
      } else if (context.path.includes('IN') || context.path.includes('NOT IN')) {
        type = 'in';
      }
      
      subqueries.push({
        ast: ast as Select,
        type,
        location: context.path.join('.')
      });
    }
  };

  // Analyze the entire SELECT statement for subqueries
  if (stmt.where) {
    visitWhereClause(stmt.where, subqueryVisitor);
  }
  if (stmt.having) {
    visitWhereClause(stmt.having, subqueryVisitor);
  }
  if (stmt.columns) {
    visitSelectList(stmt.columns, subqueryVisitor);
  }

  // Get parent table references for correlation detection
  const parentTableRefs: From[] = [];
  if (stmt.from) {
    if (Array.isArray(stmt.from)) {
      stmt.from.forEach((table: From) => {
        parentTableRefs.push(table);
      });
    } else {
      parentTableRefs.push(stmt.from);
    }
  }

  // Process FROM clause
  if (stmt.from) {
    const tables = Array.isArray(stmt.from) ? stmt.from : [stmt.from];
    for (const table of tables) {
      const fromNode = createNode(ctx, 'op', 'FROM', tableToSQL(table));
      nodes.push(fromNode);

      if (lastNodeId) {
        edges.push(createEdge(ctx, 'flow', lastNodeId, fromNode.id));
      }
      lastNodeId = fromNode.id;

      // Handle joins
      if ('join' in table && table.join) {
        const joinNode = createNode(ctx, 'op', table.join, joinToSQL(table));
        nodes.push(joinNode);
        edges.push(createEdge(ctx, 'flow', fromNode.id, joinNode.id));
        lastNodeId = joinNode.id;
      }

      // Add table to schema
      if (typeof table === 'object' && 'table' in table && table.table) {
        const tableName = table.table as string;
        applySchemaTransformation(ctx, fromNode.id, (columns) => {
          // Add columns from table if available
          if (ctx.schema.tables[tableName]) {
            const newColumns = ctx.schema.tables[tableName].columns.map(col => ({
              id: `${tableName}.${col.name}`,
              name: col.name,
              type: col.type,
              source: tableName,
              table: tableName
            }));
            return [...columns, ...newColumns];
          }
          return columns;
        });
      }
    }

    // Create snapshot after FROM
    createSnapshot(ctx, lastNodeId!);
  }

  // Process WHERE clause
  if (stmt.where) {
    const whereNode = createNode(ctx, 'clause', 'WHERE', expressionToSQL(stmt.where));
    nodes.push(whereNode);

    if (lastNodeId) {
      edges.push(createEdge(ctx, 'flow', lastNodeId, whereNode.id));
    }
    lastNodeId = whereNode.id;

    // Process WHERE subqueries
    const whereSubqueries = subqueries.filter(sq => sq.location.startsWith('WHERE') || !sq.location.includes('.'));
    for (const subqueryInfo of whereSubqueries) {
      const subqueryNode = convertSubquery(ctx, subqueryInfo.ast, subqueryInfo.type, parentTableRefs);
      nodes.push(subqueryNode);
      edges.push(createEdge(ctx, 'subqueryResult', subqueryNode.id, whereNode.id));
    }

    createSnapshot(ctx, whereNode.id);
  }

  // Process GROUP BY
  if (stmt.groupby) {
    const groupByNode = createNode(ctx, 'op', 'GROUP BY', groupByToSQL(stmt.groupby));
    nodes.push(groupByNode);

    if (lastNodeId) {
      edges.push(createEdge(ctx, 'flow', lastNodeId, groupByNode.id));
    }
    lastNodeId = groupByNode.id;
    createSnapshot(ctx, groupByNode.id);
  }

  // Process HAVING clause
  if (stmt.having) {
    const havingNode = createNode(ctx, 'clause', 'HAVING', expressionToSQL(stmt.having));
    nodes.push(havingNode);

    if (lastNodeId) {
      edges.push(createEdge(ctx, 'flow', lastNodeId, havingNode.id));
    }
    lastNodeId = havingNode.id;

    // Process HAVING subqueries
    const havingSubqueries = subqueries.filter(sq => sq.location.startsWith('HAVING'));
    for (const subqueryInfo of havingSubqueries) {
      const subqueryNode = convertSubquery(ctx, subqueryInfo.ast, subqueryInfo.type, parentTableRefs);
      nodes.push(subqueryNode);
      edges.push(createEdge(ctx, 'subqueryResult', subqueryNode.id, havingNode.id));
    }

    createSnapshot(ctx, havingNode.id);
  }

  // Process SELECT columns
  const selectNode = createNode(ctx, 'op', 'SELECT', selectListToSQL(stmt.columns));
  nodes.push(selectNode);

  if (lastNodeId) {
    edges.push(createEdge(ctx, 'flow', lastNodeId, selectNode.id));
  }
  lastNodeId = selectNode.id;

  // Process SELECT subqueries
  const selectSubqueries = subqueries.filter(sq => sq.location.startsWith('column'));
  for (const subqueryInfo of selectSubqueries) {
    const subqueryNode = convertSubquery(ctx, subqueryInfo.ast, subqueryInfo.type, parentTableRefs);
    nodes.push(subqueryNode);
    edges.push(createEdge(ctx, 'subqueryResult', subqueryNode.id, selectNode.id));
  }

  // Apply SELECT transformation to schema
  applySchemaTransformation(ctx, selectNode.id, (columns) => {
    // Add derived columns
    const newColumns = [...columns];
    stmt.columns.forEach(col => {
      if (col.as) {
        const alias = typeof col.as === 'string' ? col.as : col.as.value;
        const columnSchema: ColumnSchema = {
          id: alias,
          name: alias,
          type: 'unknown'
          // No source for derived columns
        };
        newColumns.push(columnSchema);
      }
    });
    return newColumns;
  });

  createSnapshot(ctx, selectNode.id);

  // Process ORDER BY
  if (stmt.orderby && stmt.orderby.length > 0) {
    const orderByNode = createNode(ctx, 'op', 'ORDER BY', orderByToSQL(stmt.orderby));
    nodes.push(orderByNode);

    if (lastNodeId) {
      edges.push(createEdge(ctx, 'flow', lastNodeId, orderByNode.id));
    }
    lastNodeId = orderByNode.id;
  }

  // Process LIMIT/OFFSET
  if (stmt.limit) {
    const limitNode = createNode(ctx, 'op', 'LIMIT', limitToSQL(stmt.limit));
    nodes.push(limitNode);

    if (lastNodeId) {
      edges.push(createEdge(ctx, 'flow', lastNodeId, limitNode.id));
    }
    lastNodeId = limitNode.id;

    if (stmt.limit.value && Array.isArray(stmt.limit.value) && stmt.limit.value[1]) {
      const offsetNode = createNode(ctx, 'op', 'OFFSET', stmt.limit.value[1].value?.toString() || '');
      nodes.push(offsetNode);
      edges.push(createEdge(ctx, 'flow', limitNode.id, offsetNode.id));
    }
  }

  return { nodes, edges };
};