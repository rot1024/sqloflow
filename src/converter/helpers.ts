import type { Node, Edge, NodeKind, EdgeKind } from '../types/ir.js';
import type { ConversionContext } from './types.js';
import type {
  Column,
  OrderBy,
  Limit,
  Function as FunctionExpr,
  TableExpr,
  BaseFrom,
  Join,
  Select,
  Dual
} from 'node-sql-parser';
import type { Expression, TableRef } from '../types/sql-parser.js';

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

// Type guard for table-like objects
type TableLike = string | BaseFrom | Join | TableExpr | Dual;

// Helper functions for SQL generation
export const getTableLabel = (table: TableLike): string => {
  const name = getTableName(table);
  if (typeof table === 'object' && 'as' in table && table.as) {
    return `${name} AS ${table.as}`;
  }
  return name;
};

export const getTableName = (table: TableLike): string => {
  if (typeof table === 'string') return table;
  if (typeof table === 'object') {
    if ('type' in table && table.type === 'dual') return 'dual';
    if ('table' in table && table.table) return table.table;
    if ('expr' in table) return 'subquery';
  }
  return 'unknown';
};

export const expressionToSQL = (expr: any, ctx?: ConversionContext): string => {
  if (!expr) return '';

  try {
    switch (expr.type) {
    case 'binary_expr':
      const left = expressionToSQL(expr.left, ctx);
      const right = expressionToSQL(expr.right, ctx);
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
        funcName = expr.name.name.map((n: { value?: string }) => n.value || n).join('_');
      } else if (expr.name?.value) {
        funcName = expr.name.value;
      } else {
        funcName = 'UNKNOWN';
      }

      let args = '';
      if (expr.args) {
        // Special handling for EXISTS function
        if (funcName === 'EXISTS' && expr.args.type === 'expr_list' && expr.args.value?.[0]?.ast) {
          args = '...';
        } else if (Array.isArray(expr.args)) {
          args = expr.args.map((a: Expression) => expressionToSQL(a, ctx)).join(', ');
        } else if (expr.args.expr) {
          // Handle args wrapped in expr property (common for aggr_func)
          args = expressionToSQL(expr.args.expr, ctx);
        } else {
          args = expressionToSQL(expr.args, ctx);
        }
      }
      return `${funcName}(${args})`;

    case 'expr_list':
      return expr.value.map((e: any) => {
        // If this is a subquery wrapped in expr_list, handle it specially
        if (e.ast && ctx && ctx.placeholderMap && ctx.placeholderCounter !== undefined) {
          let placeholder = ctx.placeholderMap.get(e.ast);
          if (!placeholder) {
            placeholder = `expr${ctx.placeholderCounter > 1 ? ctx.placeholderCounter : ''}`;
            ctx.placeholderMap.set(e.ast, placeholder);
            ctx.placeholderCounter++;
          }
          return placeholder;
        }
        return expressionToSQL(e, ctx);
      }).join(', ');

    case 'case':
      let caseStr = 'CASE';
      if (expr.expr) caseStr += ` ${expressionToSQL(expr.expr, ctx)}`;
      if (expr.when) {
        expr.when.forEach((w: { when: Expression; then: Expression }) => {
          caseStr += ` WHEN ${expressionToSQL(w.when, ctx)} THEN ${expressionToSQL(w.then, ctx)}`;
        });
      }
      if (expr.else) caseStr += ` ELSE ${expressionToSQL(expr.else, ctx)}`;
      caseStr += ' END';
      return caseStr;

    case 'in':
    case 'not_in':
      const inExpr = expressionToSQL(expr.left, ctx);
      const inList = expr.right.map((r: Expression) => expressionToSQL(r, ctx)).join(', ');
      return `${inExpr} ${expr.type === 'not_in' ? 'NOT IN' : 'IN'} (${inList})`;

    case 'between':
    case 'not_between':
      const betweenExpr = expressionToSQL(expr.left, ctx);
      const lower = expressionToSQL(expr.right.left, ctx);
      const upper = expressionToSQL(expr.right.right, ctx);
      return `${betweenExpr} ${expr.type === 'not_between' ? 'NOT BETWEEN' : 'BETWEEN'} ${lower} AND ${upper}`;

    case 'is':
    case 'is_not':
      const isExpr = expressionToSQL(expr.left, ctx);
      const isValue = expressionToSQL(expr.right, ctx);
      return `${isExpr} ${expr.type === 'is_not' ? 'IS NOT' : 'IS'} ${isValue}`;

    case 'like':
    case 'not_like':
      const likeExpr = expressionToSQL(expr.left, ctx);
      const pattern = expressionToSQL(expr.right, ctx);
      return `${likeExpr} ${expr.type === 'not_like' ? 'NOT LIKE' : 'LIKE'} ${pattern}`;

    case 'unary_expr':
      return `${expr.operator}${expressionToSQL(expr.expr, ctx)}`;

    case 'interval':
      // Handle INTERVAL expressions from node-sql-parser
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
      if (ctx && ctx.placeholderMap && ctx.placeholderCounter !== undefined) {
        let placeholder = ctx.placeholderMap.get(expr);
        if (!placeholder) {
          placeholder = `expr${ctx.placeholderCounter > 1 ? ctx.placeholderCounter : ''}`;
          ctx.placeholderMap.set(expr, placeholder);
          ctx.placeholderCounter++;
        }
        return placeholder;
      }
      return '(subquery)';

    case 'exists':
      return 'EXISTS (...)';

    default:
      // Fallback for unknown expression types
      if (expr.value !== undefined) {
        return String(expr.value);
      }
      return 'expr';
    }
  } catch (error) {
    console.warn(`Failed to convert expression to SQL: ${error instanceof Error ? error.message : error}`);
    return 'expr';
  }
};

export const selectListToSQL = (columns: Column[]): string => {
  return columns.map(col => {
    if (col.expr) {
      const exprStr = expressionToSQL(col.expr, undefined);
      const alias = typeof col.as === 'string' ? col.as : col.as?.value;
      return alias ? `${exprStr} AS ${alias}` : exprStr;
    }
    return 'expr';
  }).join(', ');
};

export const getColumnName = (expr: any): string => {
  if (!expr) return '';
  if (expr.type === 'column_ref') {
    const colName = expr.column?.expr?.value || expr.column || '';
    const tableName = expr.table;
    return tableName ? `${tableName}.${colName}` : colName;
  }
  if (expr.column) {
    return expr.column;
  }
  return '';
};

export const groupByToSQL = (groupby: Select['groupby'] | null): string => {
  if (groupby && groupby.columns && Array.isArray(groupby.columns)) {
    return groupby.columns.map(g => {
      if (g.type === 'column_ref') {
        return getColumnName(g);
      }
      return expressionToSQL(g, undefined) || 'expr';
    }).join(', ');
  }
  return '';
};

export const orderByToSQL = (orderby: OrderBy[]): string => {
  return orderby.map(o => {
    const expr = o.expr ? expressionToSQL(o.expr, undefined) : 'expr';
    const direction = o.type || 'ASC';
    return `${expr} ${direction}`;
  }).join(', ');
};

export const limitToSQL = (limit: Limit | null): string => {
  if (limit && limit.value && Array.isArray(limit.value)) {
    // Handle LIMIT and OFFSET
    const limitValue = limit.value[0]?.value?.toString() || '';
    const offsetValue = limit.value[1]?.value?.toString() || '';
    if (offsetValue) {
      return `${limitValue} OFFSET ${offsetValue}`;
    }
    return limitValue;
  }
  return '';
};

export const tableToSQL = (table: TableLike): string => {
  return getTableLabel(table);
};

export const joinToSQL = (table: Join): string => {
  const tableName = getTableLabel(table);
  const onClause = table.on ? ` ON ${expressionToSQL(table.on, undefined)}` : '';
  return `${tableName}${onClause}`;
};

// Subquery detection helpers
export const detectSubqueryInExpression = (expr: any): { hasSubquery: boolean; subqueryType?: 'scalar' | 'in' | 'exists'; ast?: Select } => {
  if (!expr) return { hasSubquery: false };

  switch (expr.type) {
    case 'expr_list':
      // Scalar subquery in expression list
      if (expr.value?.[0]?.ast) {
        return { hasSubquery: true, subqueryType: 'scalar', ast: expr.value[0].ast };
      }
      break;

    case 'function':
      // EXISTS subquery
      const funcName = typeof expr.name === 'string' ? expr.name : 
                      expr.name?.name?.[0]?.value || '';
      if (funcName === 'EXISTS' && expr.args?.type === 'expr_list' && expr.args.value?.[0]?.ast) {
        return { hasSubquery: true, subqueryType: 'exists', ast: expr.args.value[0].ast };
      }
      break;

    case 'binary_expr':
      // Check for IN operator first
      if (expr.operator === 'IN' || expr.operator === 'NOT IN') {
        if (expr.right?.type === 'expr_list' && expr.right.value?.[0]?.ast) {
          return { hasSubquery: true, subqueryType: 'in', ast: expr.right.value[0].ast };
        }
      }
      
      // Check if right side is a direct subquery (scalar subquery)
      if (expr.right?.ast) {
        return { hasSubquery: true, subqueryType: 'scalar', ast: expr.right.ast };
      }
      
      // Check if right side is directly a select statement (scalar subquery)
      if (expr.right?.type === 'select') {
        return { hasSubquery: true, subqueryType: 'scalar', ast: expr.right };
      }
      
      // Recursively check both sides
      const leftResult = detectSubqueryInExpression(expr.left);
      if (leftResult.hasSubquery) return leftResult;
      const rightResult = detectSubqueryInExpression(expr.right);
      if (rightResult.hasSubquery) return rightResult;
      break;

    case 'select':
      // Direct subquery reference
      return { hasSubquery: true, subqueryType: 'scalar', ast: expr };
    
    default:
      // Check if the expression itself has an ast property (direct subquery)
      if (expr.ast) {
        return { hasSubquery: true, subqueryType: 'scalar', ast: expr.ast };
      }
  }

  return { hasSubquery: false };
};

