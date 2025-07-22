/**
 * Type definitions for node-sql-parser AST nodes
 * These are based on the actual runtime structures from the parser
 */

import type { Select } from 'node-sql-parser';

export interface TableRef {
  db?: string | null;
  table?: string;
  as?: string;
  type?: string;
  expr?: Expression;
  join?: string;
  on?: Expression;
  using?: string[];
}

export interface ColumnRef {
  type: 'column_ref';
  table?: string | null;
  column: {
    expr?: {
      type: string;
      value: string;
    };
    value?: string;
  };
  collate?: any;
}

export interface BinaryExpression {
  type: 'binary_expr';
  operator: string;
  left: Expression;
  right: Expression;
}

export interface UnaryExpression {
  type: 'unary_expr';
  operator: string;
  expr: Expression;
}

export interface FunctionExpression {
  type: 'function' | 'aggr_func';
  name: string | {
    name?: Array<{ type: string; value: string }>;
    value?: string;
  };
  args?: Expression | Expression[] | {
    type: string;
    value?: Expression[];
    expr?: Expression;
  };
  over?: any;
}

export interface CaseExpression {
  type: 'case';
  expr?: Expression;
  when: Array<{
    when: Expression;
    then: Expression;
  }>;
  else?: Expression;
}

export interface ExpressionList {
  type: 'expr_list';
  value: Expression[];
}

export interface NumberLiteral {
  type: 'number';
  value: number;
}

export interface StringLiteral {
  type: 'string' | 'single_quote_string' | 'double_quote_string';
  value: string;
}

export interface BooleanLiteral {
  type: 'bool';
  value: boolean;
}

export interface NullLiteral {
  type: 'null';
  value: null;
}

export interface IntervalExpression {
  type: 'interval';
  expr: {
    type: string;
    value: string | number;
  };
  unit: string;
}

export interface SubqueryExpression {
  ast?: Select;
  type?: string;
  value?: any;
  tableList?: string[];
  columnList?: string[];
}

export type Expression = 
  | ColumnRef
  | BinaryExpression
  | UnaryExpression
  | FunctionExpression
  | CaseExpression
  | ExpressionList
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | NullLiteral
  | IntervalExpression
  | SubqueryExpression
  | { type: 'identifier'; value: string }
  | { type: 'select'; [key: string]: any }
  | { type: 'exists'; [key: string]: any }
  | { type: string; value?: any; expr?: Expression };

export interface Column {
  type?: string;
  expr: Expression;
  as?: string | { value: string };
}

// Re-export Select from node-sql-parser
export type { Select, From } from 'node-sql-parser';