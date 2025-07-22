import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { convert } from './index.js';
import type { SubqueryNode } from '../types/ir.js';

describe('Correlated subquery detection', () => {
  it('should detect correlation in EXISTS subquery', () => {
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
    
    // Find the subquery node
    const subqueryNode = ir.nodes.find(n => n.kind === 'subquery') as SubqueryNode;
    expect(subqueryNode).toBeDefined();
    expect(subqueryNode.subqueryType).toBe('exists');
    
    // Check correlation detection
    expect(subqueryNode.correlatedFields).toBeDefined();
    expect(subqueryNode.correlatedFields).toContain('c.customer_id');
  });

  it('should detect correlation in scalar subquery', () => {
    const sql = `
      SELECT o.id, o.total_amount
      FROM orders o
      WHERE o.total_amount = (
        SELECT MAX(total_amount)
        FROM orders
        WHERE customer_id = o.customer_id
      )
    `;
    
    const ast = parse(sql);
    const ir = convert(ast);
    
    // Find the subquery node
    const subqueryNode = ir.nodes.find(n => n.kind === 'subquery') as SubqueryNode;
    expect(subqueryNode).toBeDefined();
    expect(subqueryNode.subqueryType).toBe('scalar');
    
    // Check correlation detection
    expect(subqueryNode.correlatedFields).toBeDefined();
    expect(subqueryNode.correlatedFields).toContain('o.customer_id');
  });

  it('should detect multiple correlations', () => {
    const sql = `
      SELECT p.product_id, p.name
      FROM products p
      WHERE p.price > (
        SELECT AVG(price)
        FROM products p2
        WHERE p2.category_id = p.category_id
          AND p2.launch_date > p.launch_date
      )
    `;
    
    const ast = parse(sql);
    const ir = convert(ast);
    
    // Find the subquery node
    const subqueryNode = ir.nodes.find(n => n.kind === 'subquery') as SubqueryNode;
    expect(subqueryNode).toBeDefined();
    
    // Check multiple correlations
    expect(subqueryNode.correlatedFields).toBeDefined();
    expect(subqueryNode.correlatedFields).toHaveLength(2);
    expect(subqueryNode.correlatedFields).toContain('p.category_id');
    expect(subqueryNode.correlatedFields).toContain('p.launch_date');
  });

  it('should not detect correlation for independent subqueries', () => {
    const sql = `
      SELECT *
      FROM orders
      WHERE total_amount > (
        SELECT AVG(total_amount)
        FROM orders
      )
    `;
    
    const ast = parse(sql);
    const ir = convert(ast);
    
    // Find the subquery node
    const subqueryNode = ir.nodes.find(n => n.kind === 'subquery') as SubqueryNode;
    expect(subqueryNode).toBeDefined();
    
    // Should not have correlated fields
    expect(subqueryNode.correlatedFields).toBeUndefined();
  });
});