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
  if (!expr) return '';
  
  switch (expr.type) {
    case 'binary_expr':
      const left = expressionToSQL(expr.left);
      const right = expressionToSQL(expr.right);
      return `${left} ${expr.operator} ${right}`;
      
    case 'column_ref':
      return getColumnName(expr);
      
    case 'number':
      return expr.value.toString();
      
    case 'string':
    case 'single_quote_string':
      return `'${expr.value}'`;
      
    case 'double_quote_string':
      return `"${expr.value}"`;
      
    case 'bool':
      return expr.value ? 'TRUE' : 'FALSE';
      
    case 'null':
      return 'NULL';
      
    case 'function':
    case 'aggr_func':
      // Handle function names that can be string or object with nested structure
      let funcName: string;
      if (typeof expr.name === 'string') {
        funcName = expr.name;
      } else if (expr.name?.name && Array.isArray(expr.name.name)) {
        // Handle nested name structure like CURRENT_DATE
        funcName = expr.name.name.map((n: any) => n.value || n).join('_');
      } else if (expr.name?.value) {
        funcName = expr.name.value;
      } else {
        funcName = 'UNKNOWN';
      }
      
      let args = '';
      if (expr.args) {
        // Special handling for EXISTS function
        if (funcName === 'EXISTS' && expr.args.type === 'expr_list' && expr.args.value?.[0]?.ast) {
          args = 'subquery';
        } else if (Array.isArray(expr.args)) {
          args = expr.args.map((a: any) => expressionToSQL(a)).join(', ');
        } else if (expr.args.expr && expr.args.expr.type === 'star') {
          args = '*';
        } else {
          args = expressionToSQL(expr.args);
        }
      }
      return `${funcName}(${args})`;
      
    case 'expr_list':
      return expr.value.map((e: any) => expressionToSQL(e)).join(', ');
      
    case 'case':
      let caseStr = 'CASE';
      if (expr.expr) caseStr += ` ${expressionToSQL(expr.expr)}`;
      if (expr.when) {
        expr.when.forEach((w: any) => {
          caseStr += ` WHEN ${expressionToSQL(w.when)} THEN ${expressionToSQL(w.then)}`;
        });
      }
      if (expr.else) caseStr += ` ELSE ${expressionToSQL(expr.else)}`;
      caseStr += ' END';
      return caseStr;
      
    case 'in':
    case 'not_in':
      const inExpr = expressionToSQL(expr.left);
      const inList = expr.right.map((r: any) => expressionToSQL(r)).join(', ');
      return `${inExpr} ${expr.type === 'not_in' ? 'NOT IN' : 'IN'} (${inList})`;
      
    case 'between':
    case 'not_between':
      const betweenExpr = expressionToSQL(expr.left);
      const lower = expressionToSQL(expr.right.left);
      const upper = expressionToSQL(expr.right.right);
      return `${betweenExpr} ${expr.type === 'not_between' ? 'NOT BETWEEN' : 'BETWEEN'} ${lower} AND ${upper}`;
      
    case 'is':
    case 'is_not':
      const isExpr = expressionToSQL(expr.left);
      const isValue = expressionToSQL(expr.right);
      return `${isExpr} ${expr.type === 'is_not' ? 'IS NOT' : 'IS'} ${isValue}`;
      
    case 'like':
    case 'not_like':
      const likeExpr = expressionToSQL(expr.left);
      const pattern = expressionToSQL(expr.right);
      return `${likeExpr} ${expr.type === 'not_like' ? 'NOT LIKE' : 'LIKE'} ${pattern}`;
      
    case 'unary_expr':
      return `${expr.operator}${expressionToSQL(expr.expr)}`;
      
    case 'interval':
      // Handle INTERVAL expressions from node-sql-parser
      // Format 1: INTERVAL '30 days' -> expr.value contains full string, unit is empty
      // Format 2: INTERVAL '30' DAY -> expr.value contains number, unit contains unit
      if (expr.expr && expr.expr.value !== undefined) {
        const value = expr.expr.value;
        const unit = expr.unit || '';
        return unit ? `INTERVAL '${value}' ${unit.toUpperCase()}` : `INTERVAL '${value}'`;
      }
      // Fallback for unexpected format
      return `INTERVAL '${expr.value || ''}'`;
      
    case 'identifier':
      return expr.value;
      
    case 'select':
      // For subqueries, return a placeholder
      return '(subquery)';
      
    case 'exists':
      return 'EXISTS (subquery)';
      
    default:
      // Fallback for unknown expression types
      return JSON.stringify(expr);
  }
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
    return groupby.map(g => {
      if (g.type === 'column_ref') {
        return getColumnName(g);
      }
      return g.column || expressionToSQL(g) || 'expr';
    }).join(', ');
  }
  return '';
};

export const orderByToSQL = (orderby: any[]): string => {
  return orderby.map(o => {
    const expr = o.expr ? expressionToSQL(o.expr) : 'expr';
    const direction = o.type || 'ASC';
    return `${expr} ${direction}`;
  }).join(', ');
};

export const limitToSQL = (limit: any): string => {
  if (limit && limit.value) {
    if (Array.isArray(limit.value)) {
      // Handle LIMIT and OFFSET
      const limitValue = limit.value[0]?.value?.toString() || '';
      const offsetValue = limit.value[1]?.value?.toString() || '';
      if (offsetValue) {
        return `${limitValue} OFFSET ${offsetValue}`;
      }
      return limitValue;
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