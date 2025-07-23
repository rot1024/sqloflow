import { expect, test, describe } from 'vitest';
import sqlParser from 'node-sql-parser';
import { parse } from '../parser.js';
import { convert } from './index.js';
import type { SubqueryNode } from '../types/ir.js';

describe('Subquery Integration Tests', () => {
  const parser = new sqlParser.Parser();

  describe('Basic subquery support', () => {
    test('should detect scalar subquery in WHERE clause', () => {
      const sql = `
        SELECT o.id, o.total_amount
        FROM orders o
        WHERE o.total_amount = (
          SELECT MAX(total_amount)
          FROM orders
          WHERE customer_id = o.customer_id
        )
      `;
      
      const ast = parser.astify(sql);
      const result = convert([ast] as sqlParser.AST[]);
      
      // Should have a subquery node
      const subqueryNodes = result.nodes.filter(n => n.kind === 'subquery');
      expect(subqueryNodes).toHaveLength(1);
      expect(subqueryNodes[0].label).toBe('Subquery (scalar)');
    });

    test('should detect IN subquery', () => {
      const sql = `
        SELECT * 
        FROM users 
        WHERE id IN (
          SELECT user_id 
          FROM orders 
          WHERE total > 1000
        )
      `;
      
      const ast = parser.astify(sql);
      const result = convert([ast] as sqlParser.AST[]);
      
      const subqueryNodes = result.nodes.filter(n => n.kind === 'subquery');
      expect(subqueryNodes).toHaveLength(1);
      expect(subqueryNodes[0].label).toBe('Subquery (in)');
    });

    test('should detect EXISTS subquery', () => {
      const sql = `
        SELECT u.* 
        FROM users u 
        WHERE EXISTS (
          SELECT 1 
          FROM orders o 
          WHERE o.user_id = u.id
        )
      `;
      
      const ast = parser.astify(sql);
      const result = convert([ast] as sqlParser.AST[]);
      
      const subqueryNodes = result.nodes.filter(n => n.kind === 'subquery');
      expect(subqueryNodes).toHaveLength(1);
      expect(subqueryNodes[0].label).toBe('Subquery (exists)');
    });

    test('should detect scalar subquery in SELECT list', () => {
      const sql = `
        SELECT 
          u.name,
          (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) as order_count
        FROM users u
      `;
      
      const ast = parser.astify(sql);
      const result = convert([ast] as sqlParser.AST[]);
      
      const subqueryNodes = result.nodes.filter(n => n.kind === 'subquery');
      expect(subqueryNodes).toHaveLength(1);
      expect(subqueryNodes[0].label).toBe('Subquery (scalar)');
    });

    test('should handle NOT IN subquery', () => {
      const sql = `
        SELECT * 
        FROM products 
        WHERE category_id NOT IN (
          SELECT id 
          FROM categories 
          WHERE status = 'discontinued'
        )
      `;
      
      const ast = parser.astify(sql);
      const result = convert([ast] as sqlParser.AST[]);
      
      const subqueryNodes = result.nodes.filter(n => n.kind === 'subquery') as SubqueryNode[];
      expect(subqueryNodes).toHaveLength(1);
      expect(subqueryNodes[0].subqueryType).toBe('in');
    });
  });

  describe('Correlated subquery detection', () => {
    test('should detect correlation in EXISTS subquery', () => {
      const sql = `
        SELECT c.customer_id, c.name
        FROM customers c
        WHERE EXISTS (
          SELECT 1
          FROM orders o
          WHERE o.customer_id = c.customer_id
        )
      `;
      
      const ast = parse(sql);
      const ir = convert(ast);
      
      const subqueryNode = ir.nodes.find(n => n.kind === 'subquery') as SubqueryNode;
      expect(subqueryNode).toBeDefined();
      expect(subqueryNode.correlatedFields).toBeDefined();
      expect(subqueryNode.correlatedFields).toHaveLength(1);
      expect(subqueryNode.correlatedFields![0]).toBe('c.customer_id');
    });

    test('should detect multiple correlations', () => {
      const sql = `
        SELECT p.*
        FROM products p
        WHERE p.price > (
          SELECT AVG(price)
          FROM products
          WHERE category = p.category
          AND brand = p.brand
        )
      `;
      
      const ast = parse(sql);
      const ir = convert(ast);
      
      const subqueryNode = ir.nodes.find(n => n.kind === 'subquery') as SubqueryNode;
      expect(subqueryNode).toBeDefined();
      expect(subqueryNode.correlatedFields).toBeDefined();
      expect(subqueryNode.correlatedFields).toHaveLength(2);
      expect(subqueryNode.correlatedFields).toContain('p.category');
      expect(subqueryNode.correlatedFields).toContain('p.brand');
    });

    test('should detect correlation in scalar subquery in SELECT', () => {
      const sql = `
        SELECT 
          u.name,
          (
            SELECT COUNT(*)
            FROM orders o
            WHERE o.user_id = u.id
            AND o.status = 'completed'
          ) as completed_orders
        FROM users u
      `;
      
      const ast = parse(sql);
      const ir = convert(ast);
      
      const subqueryNode = ir.nodes.find(n => n.kind === 'subquery') as SubqueryNode;
      expect(subqueryNode).toBeDefined();
      expect(subqueryNode.correlatedFields).toBeDefined();
      expect(subqueryNode.correlatedFields).toContain('u.id');
    });

    test('should handle non-correlated subqueries', () => {
      const sql = `
        SELECT *
        FROM products
        WHERE price > (
          SELECT AVG(price)
          FROM products
        )
      `;
      
      const ast = parse(sql);
      const ir = convert(ast);
      
      const subqueryNode = ir.nodes.find(n => n.kind === 'subquery') as SubqueryNode;
      expect(subqueryNode).toBeDefined();
      expect(subqueryNode.correlatedFields || []).toEqual([]);
    });
  });

  describe('Nested subquery support', () => {
    test('should handle nested scalar subqueries', () => {
      const sql = `
        SELECT * 
        FROM orders 
        WHERE amount > (
          SELECT AVG(amount) 
          FROM orders 
          WHERE customer_id IN (
            SELECT id 
            FROM customers 
            WHERE country = 'JP'
          )
        )
      `;
      
      const ast = parse(sql);
      const ir = convert(ast);
      
      // Should have one subquery node at the top level
      const subqueryNodes = ir.nodes.filter(n => n.kind === 'subquery') as SubqueryNode[];
      expect(subqueryNodes).toHaveLength(1);
      
      // The top-level subquery should be scalar
      const outerSubquery = subqueryNodes[0];
      expect(outerSubquery.subqueryType).toBe('scalar');
      expect(outerSubquery.label).toBe('Subquery (scalar)');
    });

    test('should handle EXISTS with nested IN subquery', () => {
      const sql = `
        SELECT c.*
        FROM customers c
        WHERE EXISTS (
          SELECT 1
          FROM orders o
          WHERE o.customer_id = c.id
          AND o.product_id IN (
            SELECT id
            FROM products
            WHERE category = 'Electronics'
          )
        )
      `;
      
      const ast = parse(sql);
      const ir = convert(ast);
      
      // Should have one EXISTS subquery at top level
      const subqueryNodes = ir.nodes.filter(n => n.kind === 'subquery') as SubqueryNode[];
      expect(subqueryNodes).toHaveLength(1);
      
      const existsSubquery = subqueryNodes[0];
      expect(existsSubquery.subqueryType).toBe('exists');
      expect(existsSubquery.correlatedFields).toContain('c.id');
    });

    test('should handle deeply nested subqueries', () => {
      const sql = `
        SELECT *
        FROM employees
        WHERE department_id IN (
          SELECT id
          FROM departments
          WHERE budget > (
            SELECT AVG(budget)
            FROM departments
            WHERE region_id IN (
              SELECT id
              FROM regions
              WHERE country = 'US'
            )
          )
        )
      `;
      
      const ast = parse(sql);
      const ir = convert(ast);
      
      // Top level graph should have one IN subquery
      const subqueryNodes = ir.nodes.filter(n => n.kind === 'subquery') as SubqueryNode[];
      expect(subqueryNodes).toHaveLength(1);
      expect(subqueryNodes[0].subqueryType).toBe('in');
    });
  });
});