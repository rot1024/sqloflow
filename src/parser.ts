import sqlParser, { type AST } from 'node-sql-parser';

export type Dialect = 'postgresql' | 'mysql' | 'sqlite' | 'mariadb' | 'transactsql';

const { Parser } = sqlParser;
const parser = new Parser();

export const parse = (sql: string, dialect: Dialect = 'postgresql') => {
  try {
    const ast = parser.astify(sql, { database: dialect });
    return Array.isArray(ast) ? ast : [ast];
  } catch (error) {
    throw new Error(`Failed to parse SQL: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const toSQL = (ast: AST[], dialect: Dialect = 'postgresql') => {
  return parser.sqlify(ast, { database: dialect });
};
