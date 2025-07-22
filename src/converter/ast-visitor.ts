/**
 * Optimized AST visitor that combines multiple traversals into one
 */

type Expression = any; // Using any for flexibility with node-sql-parser types

export interface VisitorCallbacks {
  onSubquery?: (expr: Expression, context: VisitorContext) => void;
  onColumnRef?: (expr: Expression, context: VisitorContext) => void;
  onFunction?: (expr: Expression, context: VisitorContext) => void;
  onExpression?: (expr: Expression, context: VisitorContext) => void;
}

export interface VisitorContext {
  path: string[];
  parent?: Expression;
  depth: number;
}

/**
 * Visit all expressions in an AST node with a single traversal
 */
export function visitExpression(
  expr: Expression | any,
  callbacks: VisitorCallbacks,
  context: VisitorContext = { path: [], depth: 0 }
): void {
  if (!expr) return;

  // Call general expression callback first
  if (callbacks.onExpression) {
    callbacks.onExpression(expr, context);
  }

  // Handle specific node types
  switch (expr.type) {
    case 'column_ref':
      if (callbacks.onColumnRef) {
        callbacks.onColumnRef(expr, context);
      }
      break;

    case 'function':
    case 'aggr_func':
      if (callbacks.onFunction) {
        callbacks.onFunction(expr, context);
      }
      // Special handling for EXISTS
      if (expr.name === 'EXISTS' && expr.args?.type === 'expr_list' && expr.args.value?.[0]?.ast) {
        if (callbacks.onSubquery) {
          callbacks.onSubquery(expr.args.value[0].ast, {
            ...context,
            path: [...context.path, 'EXISTS'],
            parent: expr
          });
        }
      }
      // Process function arguments
      if (expr.args) {
        visitExpression(expr.args, callbacks, {
          ...context,
          path: [...context.path, 'args'],
          parent: expr,
          depth: context.depth + 1
        });
      }
      break;

    case 'binary_expr':
      // Check for IN with subquery
      if ((expr.operator === 'IN' || expr.operator === 'NOT IN') && 
          expr.right?.type === 'expr_list' && 
          expr.right.value?.[0]?.ast) {
        if (callbacks.onSubquery) {
          callbacks.onSubquery(expr.right.value[0].ast, {
            ...context,
            path: [...context.path, expr.operator],
            parent: expr
          });
        }
      }
      // Check for scalar subquery
      if (expr.right?.ast) {
        if (callbacks.onSubquery) {
          callbacks.onSubquery(expr.right.ast, {
            ...context,
            path: [...context.path, 'scalar'],
            parent: expr
          });
        }
      }
      // Visit both sides
      visitExpression(expr.left, callbacks, {
        ...context,
        path: [...context.path, 'left'],
        parent: expr,
        depth: context.depth + 1
      });
      visitExpression(expr.right, callbacks, {
        ...context,
        path: [...context.path, 'right'],
        parent: expr,
        depth: context.depth + 1
      });
      break;

    case 'expr_list':
      // Check for scalar subquery
      if (expr.value?.[0]?.ast) {
        if (callbacks.onSubquery) {
          callbacks.onSubquery(expr.value[0].ast, {
            ...context,
            path: [...context.path, 'scalar'],
            parent: expr
          });
        }
      }
      // Visit all expressions in the list
      if (Array.isArray(expr.value)) {
        expr.value.forEach((e: any, index: number) => {
          visitExpression(e, callbacks, {
            ...context,
            path: [...context.path, `[${index}]`],
            parent: expr,
            depth: context.depth + 1
          });
        });
      }
      break;

    case 'case':
      if (expr.expr) {
        visitExpression(expr.expr, callbacks, {
          ...context,
          path: [...context.path, 'expr'],
          parent: expr,
          depth: context.depth + 1
        });
      }
      if (expr.when) {
        expr.when.forEach((w: any, index: number) => {
          visitExpression(w.when, callbacks, {
            ...context,
            path: [...context.path, `when[${index}]`],
            parent: expr,
            depth: context.depth + 1
          });
          visitExpression(w.then, callbacks, {
            ...context,
            path: [...context.path, `then[${index}]`],
            parent: expr,
            depth: context.depth + 1
          });
        });
      }
      if (expr.else) {
        visitExpression(expr.else, callbacks, {
          ...context,
          path: [...context.path, 'else'],
          parent: expr,
          depth: context.depth + 1
        });
      }
      break;

    case 'select':
      // Direct subquery reference
      if (callbacks.onSubquery) {
        callbacks.onSubquery(expr, context);
      }
      break;

    default:
      // Check if expression has ast property (subquery)
      if (expr.ast) {
        if (callbacks.onSubquery) {
          callbacks.onSubquery(expr.ast, {
            ...context,
            path: [...context.path, 'subquery'],
            parent: expr
          });
        }
      }
      // Visit common properties
      if (expr.expr) {
        visitExpression(expr.expr, callbacks, {
          ...context,
          path: [...context.path, 'expr'],
          parent: expr,
          depth: context.depth + 1
        });
      }
      break;
  }
}

/**
 * Visit all expressions in a WHERE clause, HAVING clause, etc.
 */
export function visitWhereClause(
  whereExpr: Expression | any,
  callbacks: VisitorCallbacks
): void {
  visitExpression(whereExpr, callbacks);
}

/**
 * Visit all expressions in a SELECT list
 */
export function visitSelectList(
  columns: any[],
  callbacks: VisitorCallbacks
): void {
  columns.forEach((col, index) => {
    if (col.expr) {
      visitExpression(col.expr, callbacks, {
        path: [`column[${index}]`],
        depth: 0
      });
    }
  });
}