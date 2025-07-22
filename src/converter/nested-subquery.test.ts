import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { convert } from './index.js';
import type { SubqueryNode } from '../types/ir.js';

describe('Nested subquery support', () => {
  it('should handle nested scalar subqueries', () => {
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
    
    // The outer subquery should have an inner graph containing another subquery
    expect(outerSubquery?.innerGraph).toBeDefined();
    const innerSubqueryNodes = outerSubquery?.innerGraph?.nodes.filter(n => n.kind === 'subquery') || [];
    expect(innerSubqueryNodes).toHaveLength(1);
    
    // The inner subquery should be an IN subquery
    const innerSubquery = innerSubqueryNodes[0] as SubqueryNode;
    expect(innerSubquery.subqueryType).toBe('in');
  });

  it('should handle triple-nested subqueries', () => {
    const sql = `
      SELECT * 
      FROM products p
      WHERE p.price > (
        SELECT AVG(price) 
        FROM products 
        WHERE category_id = (
          SELECT category_id 
          FROM categories 
          WHERE parent_id = (
            SELECT id 
            FROM categories 
            WHERE name = 'Electronics'
          )
          LIMIT 1
        )
      )
    `;
    
    const ast = parse(sql);
    const ir = convert(ast);
    
    // Should have three subquery nodes total
    const allSubqueryNodes: SubqueryNode[] = [];
    
    // Recursive function to find all subquery nodes
    const findAllSubqueries = (nodes: any[]): void => {
      for (const node of nodes) {
        if (node.kind === 'subquery') {
          allSubqueryNodes.push(node);
          if (node.innerGraph?.nodes) {
            findAllSubqueries(node.innerGraph.nodes);
          }
        }
      }
    };
    
    findAllSubqueries(ir.nodes);
    expect(allSubqueryNodes).toHaveLength(3);
  });

  it('should handle nested EXISTS with IN subquery', () => {
    const sql = `
      SELECT c.customer_id, c.name
      FROM customers c
      WHERE EXISTS (
        SELECT 1
        FROM orders o
        WHERE o.customer_id = c.customer_id
          AND o.product_id IN (
            SELECT p.id
            FROM products p
            WHERE p.category = 'Electronics'
              AND p.price > 1000
          )
      )
    `;
    
    const ast = parse(sql);
    const ir = convert(ast);
    
    // Find the EXISTS subquery
    const existsSubquery = ir.nodes.find(n => 
      n.kind === 'subquery' && (n as SubqueryNode).subqueryType === 'exists'
    ) as SubqueryNode;
    expect(existsSubquery).toBeDefined();
    
    // Check if it's correlated
    expect(existsSubquery.correlatedFields).toBeDefined();
    expect(existsSubquery.correlatedFields).toContain('c.customer_id');
    
    // The EXISTS subquery should contain an IN subquery
    const inSubquery = existsSubquery.innerGraph?.nodes.find(n => 
      n.kind === 'subquery' && (n as SubqueryNode).subqueryType === 'in'
    ) as SubqueryNode;
    expect(inSubquery).toBeDefined();
    expect(inSubquery.subqueryType).toBe('in');
  });
});