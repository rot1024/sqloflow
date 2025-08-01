import type { Node, Edge } from '../types/ir.js';
import type { ConversionContext } from './types.js';
import { ConversionError } from '../errors.js';
import type {
  AST,
  Select,
  Update,
  Delete,
  Insert_Replace,
  From,
  With,
  Join,
  Create
} from 'node-sql-parser';
import type { TableRef } from '../types/sql-parser.js';
import {
  createNode,
  createEdge,
  getTableName,
  getTableLabel,
  tableToSQL,
  joinToSQL,
  expressionToSQL,
  selectListToSQL,
  groupByToSQL,
  orderByToSQL,
  limitToSQL,
  detectSubqueryInExpression
} from './helpers.js';
import {
  createSnapshot,
  applySelectTransformation,
  applyGroupByTransformation,
  applyJoinTransformation,
  applyUnionTransformation,
  inferColumnsFromExpression
} from './schema-transformations.js';
import { convertSubquery, getSubqueryResultLabel } from './subquery.js';

// Type guard for Select statements (used in CTE processing)
function isSelect(stmt: AST): stmt is Select {
  return stmt.type === 'select';
}

export const convertStatement = (ctx: ConversionContext, stmt: AST): { nodes: Node[]; edges: Edge[] } => {
  switch (stmt.type) {
    case 'select':
      return convertSelectStatement(ctx, stmt);
    case 'update':
      return convertUpdateStatement(ctx, stmt);
    case 'insert':
      return convertInsertStatement(ctx, stmt);
    case 'delete':
      return convertDeleteStatement(ctx, stmt);
    case 'create':
      return convertCreateStatement(ctx, stmt);
    default:
      throw new ConversionError(`Unsupported statement type: ${stmt.type}`, stmt.type);
  }
};

export const convertSelectStatement = (ctx: ConversionContext, stmt: Select): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let lastNodeId: string | null = null;
  let parentTableRefs: From[] = [];

  // WITH clause (CTEs)
  if (stmt.with) {
    for (const cte of stmt.with) {
      const cteResult = convertCTE(ctx, cte);
      nodes.push(...cteResult.nodes);
      edges.push(...cteResult.edges);
    }
  }

  // FROM clause
  if (stmt.from) {
    // Ensure from is always an array
    const fromArray = Array.isArray(stmt.from) ? stmt.from : [stmt.from];
    parentTableRefs = fromArray; // Store for subquery correlation detection
    const fromResult = convertFromClause(ctx, fromArray);
    nodes.push(...fromResult.nodes);
    edges.push(...fromResult.edges);
    lastNodeId = fromResult.rootNodeId;
  }

  // WHERE clause
  if (stmt.where) {
    const whereNode = createNode(ctx, 'clause', 'WHERE', expressionToSQL(stmt.where, ctx));
    nodes.push(whereNode);

    // Set current node ID before inferring columns
    ctx.currentNodeId = whereNode.id;

    // Infer columns from WHERE expression
    inferColumnsFromExpression(ctx, stmt.where);

    if (lastNodeId) {
      edges.push(createEdge(ctx, 'flow', lastNodeId, whereNode.id));
    }
    lastNodeId = whereNode.id;

    // Detect and create subquery nodes
    const subqueryInfo = detectSubqueryInExpression(stmt.where);
    if (subqueryInfo.hasSubquery && subqueryInfo.subqueryType && subqueryInfo.ast) {
      const subqueryNode = convertSubquery(ctx, subqueryInfo.ast, subqueryInfo.subqueryType, parentTableRefs);
      nodes.push(subqueryNode);
      
      // Get the placeholder name from the map
      let edgeLabel = getSubqueryResultLabel(subqueryInfo.subqueryType); // default based on type
      
      // For better consistency, if the WHERE clause contains "expr", use "expr" as the label
      if (whereNode.sql && whereNode.sql.includes('expr')) {
        // Count how many "expr" are already in the WHERE clause to determine the placeholder number
        const existingExprs = (whereNode.sql.match(/expr\d*/g) || []).length;
        if (existingExprs === 1) {
          edgeLabel = 'expr';
        } else if (existingExprs > 1) {
          // If there are multiple, we need to figure out which one this is
          // For now, just use "expr" for consistency
          edgeLabel = 'expr';
        }
      }
      
      // Try to get from placeholder map if available
      if (ctx.placeholderMap) {
        // Find the placeholder name used for this subquery
        for (const [ast, placeholder] of ctx.placeholderMap.entries()) {
          if (ast === subqueryInfo.ast) {
            edgeLabel = placeholder;
            break;
          }
        }
      }
      
      // Connect subquery to WHERE clause with the placeholder as label
      const edge = createEdge(ctx, 'subqueryResult', subqueryNode.id, whereNode.id);
      edge.label = edgeLabel;
      edges.push(edge);
    }

    // Create snapshot after WHERE (schema might have new inferred columns)
    createSnapshot(ctx, whereNode.id);
  }

  // GROUP BY clause
  if (stmt.groupby) {
    const groupByNode = createNode(ctx, 'op', 'GROUP BY', groupByToSQL(stmt.groupby));
    nodes.push(groupByNode);

    if (lastNodeId) {
      edges.push(createEdge(ctx, 'flow', lastNodeId, groupByNode.id));
    }
    lastNodeId = groupByNode.id;

    // Set current node ID
    ctx.currentNodeId = groupByNode.id;

    // Apply GROUP BY transformation
    applyGroupByTransformation(ctx, groupByNode.id, stmt.groupby);
  }

  // HAVING clause
  if (stmt.having) {
    const havingNode = createNode(ctx, 'clause', 'HAVING', expressionToSQL(stmt.having, ctx));
    nodes.push(havingNode);

    if (lastNodeId) {
      edges.push(createEdge(ctx, 'flow', lastNodeId, havingNode.id));
    }
    lastNodeId = havingNode.id;
  }

  // SELECT clause
  const selectNode = createNode(ctx, 'op', 'SELECT', selectListToSQL(stmt.columns));
  nodes.push(selectNode);

  if (lastNodeId) {
    edges.push(createEdge(ctx, 'flow', lastNodeId, selectNode.id));
  }
  lastNodeId = selectNode.id;

  // Set current node ID
  ctx.currentNodeId = selectNode.id;

  // Detect subqueries in SELECT columns
  for (const col of stmt.columns) {
    if (col.expr) {
      const subqueryInfo = detectSubqueryInExpression(col.expr);
      if (subqueryInfo.hasSubquery && subqueryInfo.subqueryType && subqueryInfo.ast) {
        const subqueryNode = convertSubquery(ctx, subqueryInfo.ast, subqueryInfo.subqueryType, parentTableRefs);
        nodes.push(subqueryNode);
        
        // For SELECT clauses, we typically don't show placeholders in output
        // but we can still use a descriptive label based on the subquery type
        let edgeLabel = getSubqueryResultLabel(subqueryInfo.subqueryType);
        
        // Connect subquery to SELECT clause
        const edge = createEdge(ctx, 'subqueryResult', subqueryNode.id, selectNode.id);
        edge.label = edgeLabel;
        edges.push(edge);
      }
    }
  }

  // Apply SELECT transformation to track schema changes
  applySelectTransformation(ctx, selectNode.id, stmt.columns);

  // ORDER BY clause
  if (stmt.orderby) {
    const orderByNode = createNode(ctx, 'op', 'ORDER BY', orderByToSQL(stmt.orderby));
    nodes.push(orderByNode);
    edges.push(createEdge(ctx, 'flow', lastNodeId, orderByNode.id));
    lastNodeId = orderByNode.id;
  }

  // LIMIT clause
  if (stmt.limit && stmt.limit.value && stmt.limit.value.length > 0) {
    const limitNode = createNode(ctx, 'op', 'LIMIT', limitToSQL(stmt.limit));
    nodes.push(limitNode);
    edges.push(createEdge(ctx, 'flow', lastNodeId, limitNode.id));
    lastNodeId = limitNode.id;
  }

  // Handle UNION/UNION ALL
  if (stmt._next && stmt.set_op) {
    const unionType = stmt.set_op.toUpperCase();
    const unionNode = createNode(ctx, 'op', unionType, unionType);
    nodes.push(unionNode);

    // Connect first SELECT to UNION
    edges.push(createEdge(ctx, 'flow', lastNodeId, unionNode.id));

    // Process the next SELECT statement
    const nextResult = convertSelectStatement(ctx, stmt._next);
    nodes.push(...nextResult.nodes);
    edges.push(...nextResult.edges);

    // Find the last node of the second SELECT
    if (nextResult.nodes.length > 0) {
      const secondSelectLastNode = nextResult.nodes[nextResult.nodes.length - 1];
      edges.push(createEdge(ctx, 'flow', secondSelectLastNode.id, unionNode.id));
    }

    // Track the UNION node as the last node
    lastNodeId = unionNode.id;

    // Apply UNION transformation to merge schemas
    applyUnionTransformation(ctx, unionNode.id);
  }

  return { nodes, edges };
};

const convertFromClause = (ctx: ConversionContext, from: From[]): { nodes: Node[]; edges: Edge[]; rootNodeId: string } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let rootNodeId = '';

  for (let i = 0; i < from.length; i++) {
    const table = from[i];
    const tableName = getTableName(table);
    const tableAlias = ('as' in table && table.as) ? table.as : tableName;

    if (i === 0) {
      // For the first table, create FROM node with table information
      const fromNode = createNode(ctx, 'op', 'FROM', `FROM ${getTableLabel(table)}`);
      nodes.push(fromNode);
      rootNodeId = fromNode.id;

      // Set current node ID
      ctx.currentNodeId = fromNode.id;

      // Track that this node introduced this table alias
      if (ctx.tableSourceNodes) {
        ctx.tableSourceNodes[tableAlias] = fromNode.id;
      }

      // Check if this is a CTE reference
      if (ctx.cteNodes && ctx.cteNodes[tableName]) {
        // Connect the CTE node to this FROM node
        edges.push(createEdge(ctx, 'flow', ctx.cteNodes[tableName], fromNode.id));
      }

      // Schema information is now tracked via snapshots instead of column nodes

      // Initialize columns for the first table
      if (ctx.currentRelations[tableName]) {
        // Add columns from known table
        const relation = ctx.currentRelations[tableName];
        ctx.currentColumns = relation.columns.map(col => ({
          ...col,
          source: tableAlias,
          id: `${tableAlias}.${col.name}`,
          table: relation.name,
          // Preserve existing sourceNodeId if it exists, otherwise set to fromNode.id
          sourceNodeId: col.sourceNodeId || fromNode.id
        }));
      } else if (ctx.cteNodes && ctx.cteNodes[tableName]) {
        // This is a CTE but we don't have its schema yet
        // Initialize empty - columns will be inferred
        ctx.currentRelations[tableAlias] = {
          name: tableName,
          alias: tableAlias,
          columns: []
        };
        ctx.currentColumns = [];
      } else {
        // Unknown table - initialize empty
        ctx.currentRelations[tableAlias] = {
          name: tableName,
          alias: tableAlias,
          columns: []
        };
        ctx.currentColumns = [];
      }

      // Create initial snapshot with the first table
      createSnapshot(ctx, fromNode.id);
    } else {
      // Handle JOINs
      if ('join' in table) {
        const joinType = table.join || 'INNER JOIN';
        
        // Create a separate table node for the joined table
        let tableLabel = getTableLabel(table);
        
        // If this is a CTE reference, use a more descriptive label
        if (ctx.cteNodes && ctx.cteNodes[tableName]) {
          tableLabel = `WITH ${tableName}`;
        }
        
        const tableNode = createNode(ctx, 'relation', tableLabel, getTableLabel(table));
        nodes.push(tableNode);
        
        // Create the JOIN operation node (without table info in label)
        const joinNode = createNode(ctx, 'op', joinType, `${joinType}${table.on ? ` ON ${expressionToSQL(table.on, ctx)}` : ''}`);
        nodes.push(joinNode);

        // Connect: previous node -> JOIN node
        edges.push(createEdge(ctx, 'flow', rootNodeId, joinNode.id));
        
        // Connect: table node -> JOIN node
        edges.push(createEdge(ctx, 'flow', tableNode.id, joinNode.id));
        
        rootNodeId = joinNode.id;

        // Set current node ID
        ctx.currentNodeId = joinNode.id;

        // Track that this node introduced this table alias
        if (ctx.tableSourceNodes) {
          ctx.tableSourceNodes[tableAlias] = tableNode.id;
        }

        // Check if this is a CTE reference
        if (ctx.cteNodes && ctx.cteNodes[tableName]) {
          // Connect the CTE node to the table node instead of JOIN node
          edges.push(createEdge(ctx, 'flow', ctx.cteNodes[tableName], tableNode.id));
        }

        // Schema information is now tracked via snapshots instead of column nodes

        // Add columns from joined table to current schema
        if (ctx.currentRelations[tableName]) {
          const relation = ctx.currentRelations[tableName];
          const newColumns = relation.columns.map(col => ({
            ...col,
            source: tableAlias,
            id: `${tableAlias}.${col.name}`,
            table: relation.name,
            // Preserve existing sourceNodeId if it exists, otherwise set to joinNode.id
            sourceNodeId: col.sourceNodeId || joinNode.id
          }));
          ctx.currentColumns.push(...newColumns);
        } else {
          // Unknown table
          ctx.currentRelations[tableAlias] = {
            name: tableName,
            alias: tableAlias,
            columns: []
          };
        }

        // Infer columns from JOIN ON clause
        if (table.on) {
          inferColumnsFromExpression(ctx, table.on);
        }

        // Apply JOIN transformation - merge all available relations
        applyJoinTransformation(ctx, joinNode.id, Object.keys(ctx.currentRelations));
      } else {
        // Handle other FROM types (TableExpr, etc.)
        const fromNode = createNode(ctx, 'op', 'FROM', `FROM ${getTableLabel(table)}`);
        nodes.push(fromNode);
        edges.push(createEdge(ctx, 'flow', rootNodeId, fromNode.id));
        rootNodeId = fromNode.id;
      }

    }
  }

  return { nodes, edges, rootNodeId };
};

const convertCTE = (ctx: ConversionContext, cte: With): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Extract the Select AST from the With type structure
  // The actual runtime structure has stmt directly as a Select
  const stmt = (cte.stmt as any).ast || cte.stmt as any;
  const cteName = cte.name.value;

  if (stmt && isSelect(stmt)) {
    const cteResult = convertSelectStatement(ctx, stmt);
    nodes.push(...cteResult.nodes);
    edges.push(...cteResult.edges);

    const cteNode = createNode(ctx, 'relation', `CTE: ${cteName}`, `WITH ${cteName} AS (...)`);
    nodes.push(cteNode);

    if (cteResult.nodes.length > 0) {
      const lastNode = cteResult.nodes[cteResult.nodes.length - 1];
      edges.push(createEdge(ctx, 'defines', lastNode.id, cteNode.id));
    }

    // Track the CTE node for later reference
    if (ctx.cteNodes) {
      ctx.cteNodes[cteName] = cteNode.id;
    }

    // Add CTE to current schema with the output columns from the SELECT
    if (cteResult.nodes.length > 0) {
      // Get the columns from the last snapshot of the CTE
      const lastNode = cteResult.nodes[cteResult.nodes.length - 1];
      const lastSnapshot = ctx.snapshots.find(s => s.nodeId === lastNode.id);

      if (lastSnapshot) {
        // Create CTE columns based on the output columns
        const columnsList = lastSnapshot.schema.columns.map(col => ({
          id: `${cteName}.${col.name}`,
          name: col.name,
          type: col.type,
          source: cteName,
          table: cteName,
          sourceNodeId: cteNode.id
        }));

        // Add CTE to current relations
        ctx.currentRelations[cteName] = {
          name: cteName,
          alias: cteName,
          columns: columnsList
        };
      }
    }
  }

  return { nodes, edges };
};

const convertUpdateStatement = (ctx: ConversionContext, stmt: Update): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Get table name from the array of tables
  const tableName = stmt.table && stmt.table.length > 0 ? getTableName(stmt.table[0]) : 'unknown';
  const updateNode = createNode(ctx, 'op', 'UPDATE', `UPDATE ${tableName}`);
  nodes.push(updateNode);

  let lastNodeId = updateNode.id;

  if (stmt.where) {
    const whereNode = createNode(ctx, 'clause', 'WHERE', expressionToSQL(stmt.where, ctx));
    nodes.push(whereNode);
    edges.push(createEdge(ctx, 'flow', lastNodeId, whereNode.id));
  }

  return { nodes, edges };
};

const convertInsertStatement = (ctx: ConversionContext, stmt: Insert_Replace): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const insertNode = createNode(ctx, 'op', 'INSERT', `INSERT INTO ${getTableName(stmt.table)}`);
  nodes.push(insertNode);

  return { nodes, edges };
};

const convertDeleteStatement = (ctx: ConversionContext, stmt: Delete): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const deleteNode = createNode(ctx, 'op', 'DELETE', `DELETE FROM ${getTableName(stmt.table)}`);
  nodes.push(deleteNode);

  let lastNodeId = deleteNode.id;

  if (stmt.where) {
    const whereNode = createNode(ctx, 'clause', 'WHERE', expressionToSQL(stmt.where, ctx));
    nodes.push(whereNode);
    edges.push(createEdge(ctx, 'flow', lastNodeId, whereNode.id));
  }

  return { nodes, edges };
};

const convertCreateStatement = (ctx: ConversionContext, stmt: Create): { nodes: Node[]; edges: Edge[] } => {
  // Only process CREATE TABLE AS SELECT
  if (stmt.keyword !== 'table' || !stmt.query_expr) {
    return { nodes: [], edges: [] };
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Convert the SELECT query first
  const selectResult = convertSelectStatement(ctx, stmt.query_expr);
  nodes.push(...selectResult.nodes);
  edges.push(...selectResult.edges);

  // Create the CREATE TABLE node and add it at the end
  const tableName = stmt.table && stmt.table.length > 0 ? getTableName(stmt.table[0]) : 'unknown';
  const createTableNode = createNode(ctx, 'op', 'CREATE TABLE', tableName);
  nodes.push(createTableNode);

  // Find the last node of the SELECT query to connect to CREATE TABLE
  if (selectResult.nodes.length > 0) {
    // Find the node with no outgoing edges (the final node in the flow)
    let lastSelectNode = selectResult.nodes[selectResult.nodes.length - 1];
    
    // Check if there's an ORDER BY or other final operation
    for (const node of selectResult.nodes) {
      const hasOutgoing = selectResult.edges.some(edge => edge.from.node === node.id);
      if (!hasOutgoing) {
        lastSelectNode = node;
        break;
      }
    }
    
    edges.push(createEdge(ctx, 'flow', lastSelectNode.id, createTableNode.id));
  }

  return { nodes, edges };
};
