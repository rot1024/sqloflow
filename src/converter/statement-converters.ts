import type { Node, Edge } from '../types/ir.js';
import type { ConversionContext } from './types.js';
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
  limitToSQL
} from './helpers.js';
import {
  createSnapshot,
  applySelectTransformation,
  applyGroupByTransformation,
  applyJoinTransformation,
  inferColumnsFromExpression
} from './schema-transformations.js';

export const convertStatement = (ctx: ConversionContext, stmt: any): { nodes: Node[]; edges: Edge[] } => {
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
      // Skip CREATE statements - they are already processed for schema extraction
      return { nodes: [], edges: [] };
    default:
      throw new Error(`Unsupported statement type: ${stmt.type}`);
  }
};

export const convertSelectStatement = (ctx: ConversionContext, stmt: any): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let lastNodeId: string | null = null;

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
    const fromResult = convertFromClause(ctx, stmt.from);
    nodes.push(...fromResult.nodes);
    edges.push(...fromResult.edges);
    lastNodeId = fromResult.rootNodeId;
  }

  // WHERE clause
  if (stmt.where) {
    // Infer columns from WHERE expression
    inferColumnsFromExpression(ctx, stmt.where);
    
    const whereNode = createNode(ctx, 'clause', 'WHERE', expressionToSQL(stmt.where));
    nodes.push(whereNode);
    
    if (lastNodeId) {
      edges.push(createEdge(ctx, 'flow', lastNodeId, whereNode.id));
    }
    lastNodeId = whereNode.id;
    
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
    
    // Apply GROUP BY transformation
    applyGroupByTransformation(ctx, groupByNode.id, stmt.groupby);
  }

  // HAVING clause
  if (stmt.having) {
    const havingNode = createNode(ctx, 'clause', 'HAVING', expressionToSQL(stmt.having));
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

  return { nodes, edges };
};

const convertFromClause = (ctx: ConversionContext, from: any[]): { nodes: Node[]; edges: Edge[]; rootNodeId: string } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let rootNodeId = '';

  for (let i = 0; i < from.length; i++) {
    const table = from[i];
    const tableName = getTableName(table);
    const tableAlias = table.as || tableName;
    const tableNode = createNode(ctx, 'relation', getTableLabel(table), tableToSQL(table));
    nodes.push(tableNode);

    // Add column nodes if schema is available
    if (ctx.schema.tables[tableName]) {
      const tableSchema = ctx.schema.tables[tableName];
      for (const column of tableSchema.columns) {
        const columnNode = createNode(ctx, 'column', column.name, column.type);
        columnNode.parent = tableNode.id;
        nodes.push(columnNode);
        
        // Add defines edge from table to column
        edges.push(createEdge(ctx, 'defines', tableNode.id, columnNode.id));
      }
    }

    if (i === 0) {
      const fromNode = createNode(ctx, 'op', 'FROM', `FROM ${getTableLabel(table)}`);
      nodes.push(fromNode);
      edges.push(createEdge(ctx, 'flow', tableNode.id, fromNode.id));
      rootNodeId = fromNode.id;
      
      // Initialize schema with first table (even if unknown)
      if (!ctx.schema.tables[tableName]) {
        // Table not in schema, create minimal entry
        ctx.currentSchema[tableAlias] = {
          name: tableAlias,
          columns: [] // Will be inferred from usage
        };
      }
      
      // Create initial snapshot with the first table
      createSnapshot(ctx, fromNode.id);
    } else {
      // Handle JOINs
      const joinType = table.join || 'INNER JOIN';
      const joinNode = createNode(ctx, 'op', joinType, joinToSQL(table));
      nodes.push(joinNode);
      
      edges.push(createEdge(ctx, 'flow', rootNodeId, joinNode.id));
      edges.push(createEdge(ctx, 'flow', tableNode.id, joinNode.id));
      rootNodeId = joinNode.id;
      
      // Ensure table exists in current schema before JOIN
      if (!ctx.schema.tables[tableName]) {
        ctx.currentSchema[tableAlias] = {
          name: tableAlias,
          columns: [] // Will be inferred from usage
        };
      }
      
      // Infer columns from JOIN ON clause
      if (table.on) {
        inferColumnsFromExpression(ctx, table.on);
      }
      
      // Apply JOIN transformation - merge all available relations
      applyJoinTransformation(ctx, joinNode.id, Object.keys(ctx.currentSchema));
    }
  }

  return { nodes, edges, rootNodeId };
};

const convertCTE = (ctx: ConversionContext, cte: any): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  
  const cteResult = convertSelectStatement(ctx, cte.stmt);
  nodes.push(...cteResult.nodes);
  edges.push(...cteResult.edges);
  
  const cteName = typeof cte.name === 'object' ? cte.name.value : cte.name;
  const cteNode = createNode(ctx, 'relation', `CTE: ${cteName}`, `WITH ${cteName} AS (...)`);
  nodes.push(cteNode);
  
  if (cteResult.nodes.length > 0) {
    const lastNode = cteResult.nodes[cteResult.nodes.length - 1];
    edges.push(createEdge(ctx, 'defines', lastNode.id, cteNode.id));
  }
  
  return { nodes, edges };
};

const convertUpdateStatement = (ctx: ConversionContext, stmt: any): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  
  const updateNode = createNode(ctx, 'op', 'UPDATE', `UPDATE ${getTableName(stmt.table)}`);
  nodes.push(updateNode);
  
  let lastNodeId = updateNode.id;
  
  if (stmt.where) {
    const whereNode = createNode(ctx, 'clause', 'WHERE', expressionToSQL(stmt.where));
    nodes.push(whereNode);
    edges.push(createEdge(ctx, 'flow', lastNodeId, whereNode.id));
  }
  
  return { nodes, edges };
};

const convertInsertStatement = (ctx: ConversionContext, stmt: any): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  
  const insertNode = createNode(ctx, 'op', 'INSERT', `INSERT INTO ${getTableName(stmt.table)}`);
  nodes.push(insertNode);
  
  return { nodes, edges };
};

const convertDeleteStatement = (ctx: ConversionContext, stmt: any): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  
  const deleteNode = createNode(ctx, 'op', 'DELETE', `DELETE FROM ${getTableName(stmt.table)}`);
  nodes.push(deleteNode);
  
  let lastNodeId = deleteNode.id;
  
  if (stmt.where) {
    const whereNode = createNode(ctx, 'clause', 'WHERE', expressionToSQL(stmt.where));
    nodes.push(whereNode);
    edges.push(createEdge(ctx, 'flow', lastNodeId, whereNode.id));
  }
  
  return { nodes, edges };
};