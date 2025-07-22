import { describe, it, expect } from 'vitest';
import { parse } from './parser';
import type { Select, Update, Insert_Replace, Delete } from 'node-sql-parser';

describe('parse', () => {

  it('should parse basic SELECT statement', () => {
    const sql = 'SELECT id, name FROM users';
    const ast = parse(sql);

    expect(ast).toHaveLength(1);
    expect(ast[0].type).toBe('select');
    const selectAst = ast[0] as Select;
    expect(selectAst.columns).toHaveLength(2);
    expect(selectAst.from).toHaveLength(1);
  });

  it('should parse SELECT with WHERE clause', () => {
    const sql = "SELECT id, name FROM users WHERE country = 'JP'";
    const ast = parse(sql);

    expect(ast).toHaveLength(1);
    expect(ast[0].type).toBe('select');
    const selectAst = ast[0] as Select;
    expect(selectAst.where).toBeDefined();
  });

  it('should parse SELECT with JOIN', () => {
    const sql = `
      SELECT u.id, u.name, o.total_amount
      FROM users AS u
      JOIN orders AS o ON o.user_id = u.id
    `;
    const ast = parse(sql);

    expect(ast).toHaveLength(1);
    const selectAst = ast[0] as Select;
    expect(selectAst.from).toHaveLength(2);
    expect(selectAst.from[1].join).toBe('INNER JOIN');
  });

  it('should parse SELECT with GROUP BY and HAVING', () => {
    const sql = `
      SELECT category, COUNT(*) AS cnt
      FROM products
      GROUP BY category
      HAVING COUNT(*) > 10
    `;
    const ast = parse(sql);

    expect(ast).toHaveLength(1);
    const selectAst = ast[0] as Select;
    expect(selectAst.groupby).toBeDefined();
    expect(selectAst.having).toBeDefined();
  });

  it('should parse CTE (WITH clause)', () => {
    const sql = `
      WITH recent_orders AS (
        SELECT user_id, amount
        FROM orders
        WHERE created_at >= '2025-01-01'
      )
      SELECT u.id, u.name
      FROM users u
      JOIN recent_orders r ON r.user_id = u.id
    `;
    const ast = parse(sql);

    expect(ast).toHaveLength(1);
    const selectAst = ast[0] as Select;
    expect(selectAst.with).toBeDefined();
    expect(selectAst.with).toHaveLength(1);
    expect(selectAst.with[0].name.value).toBe('recent_orders');
  });

  it('should parse UPDATE statement', () => {
    const sql = "UPDATE users SET vip = TRUE WHERE id = 1";
    const ast = parse(sql);

    expect(ast).toHaveLength(1);
    expect(ast[0].type).toBe('update');
    const updateAst = ast[0] as Update;
    expect(updateAst.table).toHaveLength(1);
    expect(updateAst.where).toBeDefined();
  });

  it('should throw error for invalid SQL', () => {
    const sql = 'SELECT FROM WHERE';

    expect(() => parse(sql)).toThrow('Failed to parse SQL');
  });
});