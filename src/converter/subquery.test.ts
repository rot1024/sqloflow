import { expect, test, describe } from 'vitest';
import sqlParser from 'node-sql-parser';
import { convert } from './index.js';

describe('Subquery Support - Phase 1', () => {
  const parser = new sqlParser.Parser();

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
    const subqueryNode = result.nodes.find(n => n.kind === 'subquery');
    expect(subqueryNode).toBeDefined();
    expect(subqueryNode?.label).toBe('Subquery (scalar)');
    
    // Should have subqueryResult edge connecting to WHERE
    const whereNode = result.nodes.find(n => n.label === 'WHERE');
    const subqueryEdge = result.edges.find(e => 
      e.kind === 'subqueryResult' && 
      e.from.node === subqueryNode?.id &&
      e.to.node === whereNode?.id
    );
    expect(subqueryEdge).toBeDefined();
  });

  test('should detect IN subquery in WHERE clause', () => {
    const sql = `
      SELECT u.id, u.name
      FROM users u
      WHERE u.id IN (
        SELECT o.user_id
        FROM orders o
        WHERE o.total_amount > 100000
      )
    `;
    
    const ast = parser.astify(sql);
    const result = convert([ast] as sqlParser.AST[]);
    
    const subqueryNode = result.nodes.find(n => n.kind === 'subquery');
    expect(subqueryNode).toBeDefined();
    expect(subqueryNode?.label).toBe('Subquery (in)');
  });

  test('should detect EXISTS subquery in WHERE clause', () => {
    const sql = `
      SELECT c.customer_id, c.name
      FROM customers c
      WHERE EXISTS (
        SELECT 1
        FROM orders o
        WHERE o.customer_id = c.customer_id
          AND o.status = 'pending'
      )
    `;
    
    const ast = parser.astify(sql);
    const result = convert([ast] as sqlParser.AST[]);
    
    const subqueryNode = result.nodes.find(n => n.kind === 'subquery');
    expect(subqueryNode).toBeDefined();
    expect(subqueryNode?.label).toBe('Subquery (exists)');
  });

  test('should detect scalar subquery in SELECT clause', () => {
    const sql = `
      SELECT 
        c.name,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) as order_count
      FROM customers c
    `;
    
    const ast = parser.astify(sql);
    const result = convert([ast] as sqlParser.AST[]);
    
    // Should have a subquery node
    const subqueryNode = result.nodes.find(n => n.kind === 'subquery');
    expect(subqueryNode).toBeDefined();
    expect(subqueryNode?.label).toBe('Subquery (scalar)');
    
    // Should have subqueryResult edge connecting to SELECT
    const selectNode = result.nodes.find(n => n.label === 'SELECT');
    const subqueryEdge = result.edges.find(e => 
      e.kind === 'subqueryResult' && 
      e.from.node === subqueryNode?.id &&
      e.to.node === selectNode?.id
    );
    expect(subqueryEdge).toBeDefined();
  });

  test('should handle multiple subqueries in same query', () => {
    const sql = `
      SELECT 
        c.name,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) as order_count
      FROM customers c
      WHERE c.total_revenue > (
        SELECT AVG(total_revenue) FROM customers
      )
    `;
    
    const ast = parser.astify(sql);
    const result = convert([ast] as sqlParser.AST[]);
    
    // Should have two subquery nodes
    const subqueryNodes = result.nodes.filter(n => n.kind === 'subquery');
    expect(subqueryNodes).toHaveLength(2);
    
    // Both should be scalar subqueries
    expect(subqueryNodes.every(n => n.label === 'Subquery (scalar)')).toBe(true);
  });
});