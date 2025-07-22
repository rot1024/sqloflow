import type { Node, Edge, NodeKind, EdgeKind } from '../types/ir.js';
import type { ConversionContext } from './types.js';

export const createNode = (ctx: ConversionContext, kind: NodeKind, label: string, sql?: string): Node => {
  const node: Node = {
    id: `node_${ctx.nodeCounter++}`,
    kind,
    label,
    sql
  };
  return node;
};

export const createEdge = (ctx: ConversionContext, kind: EdgeKind, fromNodeId: string, toNodeId: string): Edge => {
  return {
    id: `edge_${ctx.edgeCounter++}`,
    kind,
    from: { node: fromNodeId },
    to: { node: toNodeId }
  };
};

// Helper functions for SQL generation
export const getTableLabel = (table: any): string => {
  const name = getTableName(table);
  return table.as ? `${name} AS ${table.as}` : name;
};

export const getTableName = (table: any): string => {
  if (typeof table === 'string') return table;
  if (table.table) return table.table;
  if (table.name) return table.name;
  return 'unknown';
};

export const expressionToSQL = (expr: any): string => {
  // Simplified expression conversion
  return JSON.stringify(expr);
};

export const selectListToSQL = (columns: any[]): string => {
  return columns.map(col => {
    if (col.expr) {
      if (col.expr.type === 'column_ref') {
        const colName = getColumnName(col.expr);
        return col.as ? `${colName} AS ${col.as}` : colName;
      } else if (col.expr.type === 'aggr_func') {
        const funcName = col.expr.name.toUpperCase();
        const args = col.expr.args ? getColumnName(col.expr.args.expr) || '*' : '*';
        const funcCall = `${funcName}(${args})`;
        return col.as ? `${funcCall} AS ${col.as}` : funcCall;
      }
    }
    return 'expr';
  }).join(', ');
};

export const getColumnName = (expr: any): string => {
  if (!expr) return '';
  if (expr.type === 'column_ref') {
    const colName = expr.column?.expr?.value || expr.column;
    const tableName = expr.table;
    return tableName ? `${tableName}.${colName}` : colName;
  }
  if (expr.column) {
    return expr.column;
  }
  return '';
};

export const groupByToSQL = (groupby: any): string => {
  if (Array.isArray(groupby)) {
    return groupby.map(g => g.column || 'expr').join(', ');
  }
  return 'GROUP BY';
};

export const orderByToSQL = (orderby: any[]): string => {
  return orderby.map(o => `${o.expr.column || 'expr'} ${o.type || 'ASC'}`).join(', ');
};

export const limitToSQL = (limit: any): string => {
  if (limit && limit.value) {
    if (Array.isArray(limit.value)) {
      return limit.value[0].value.toString();
    }
    return limit.value.toString();
  }
  return '';
};

export const tableToSQL = (table: any): string => {
  return getTableLabel(table);
};

export const joinToSQL = (table: any): string => {
  const joinType = table.join || 'INNER JOIN';
  const tableName = getTableLabel(table);
  const onClause = table.on ? ` ON ${expressionToSQL(table.on)}` : '';
  return `${joinType} ${tableName}${onClause}`;
};