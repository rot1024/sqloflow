import sqlParser, { type AST } from 'node-sql-parser';
import { ParseError } from './errors.js';

export type Dialect = 'postgresql' | 'mysql' | 'sqlite' | 'mariadb' | 'transactsql';

const { Parser } = sqlParser;
const parser = new Parser();

export const parse = (sql: string, dialect: Dialect = 'postgresql') => {
  if (!sql || sql.trim().length === 0) {
    throw new ParseError('SQL string cannot be empty', sql);
  }

  try {
    const ast = parser.astify(sql, { database: dialect });
    return Array.isArray(ast) ? ast : [ast];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ParseError(`Failed to parse SQL: ${message}`, sql);
  }
};
