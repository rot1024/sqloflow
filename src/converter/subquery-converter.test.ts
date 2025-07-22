import { expect, test, describe } from 'vitest';
import sqlParser from 'node-sql-parser';
import { convert } from './index.js';
import type { SubqueryNode } from '../types/ir.js';

describe('Subquery Converter - Phase 2', () => {
  const parser = new sqlParser.Parser();

  test('should create SubqueryNode with innerGraph', () => {
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
    
    // Find the subquery node
    const subqueryNode = result.nodes.find(n => n.kind === 'subquery') as SubqueryNode;
    expect(subqueryNode).toBeDefined();
    expect(subqueryNode.subqueryType).toBe('scalar');
    
    // Check that innerGraph exists
    expect(subqueryNode.innerGraph).toBeDefined();
    expect(subqueryNode.innerGraph?.nodes.length).toBeGreaterThan(0);
    expect(subqueryNode.innerGraph?.edges.length).toBeGreaterThan(0);
    
    // Check that innerGraph contains expected nodes
    const innerNodes = subqueryNode.innerGraph!.nodes;
    const fromNode = innerNodes.find(n => n.label === 'FROM');
    const whereNode = innerNodes.find(n => n.label === 'WHERE');
    const selectNode = innerNodes.find(n => n.label === 'SELECT');
    
    expect(fromNode).toBeDefined();
    expect(whereNode).toBeDefined();
    expect(selectNode).toBeDefined();
    
    // Check that SELECT node contains MAX function
    expect(selectNode?.sql).toContain('MAX');
  });

  test('should create proper node IDs for subquery nodes', () => {
    const sql = `
      SELECT 
        c.name,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) as order_count
      FROM customers c
    `;
    
    const ast = parser.astify(sql);
    const result = convert([ast] as sqlParser.AST[]);
    
    // Find the subquery node
    const subqueryNode = result.nodes.find(n => n.kind === 'subquery') as SubqueryNode;
    expect(subqueryNode).toBeDefined();
    
    // Check that all inner nodes have IDs that start with subquery prefix
    const innerNodes = subqueryNode.innerGraph!.nodes;
    innerNodes.forEach(node => {
      expect(node.id).toMatch(/^subq_\d+_node_\d+$/);
    });
  });

  test('should handle IN subquery with innerGraph', () => {
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
    
    const subqueryNode = result.nodes.find(n => n.kind === 'subquery') as SubqueryNode;
    expect(subqueryNode).toBeDefined();
    expect(subqueryNode.subqueryType).toBe('in');
    
    // Check inner graph
    const innerNodes = subqueryNode.innerGraph!.nodes;
    const whereNode = innerNodes.find(n => n.label === 'WHERE');
    expect(whereNode?.sql).toContain('> 100000');
  });

  test('should handle EXISTS subquery with innerGraph', () => {
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
    
    const subqueryNode = result.nodes.find(n => n.kind === 'subquery') as SubqueryNode;
    expect(subqueryNode).toBeDefined();
    expect(subqueryNode.subqueryType).toBe('exists');
    
    // Check inner graph contains the complex WHERE condition
    const innerNodes = subqueryNode.innerGraph!.nodes;
    const whereNode = innerNodes.find(n => n.label === 'WHERE');
    expect(whereNode?.sql).toContain('AND');
    expect(whereNode?.sql).toContain('pending');
  });
});