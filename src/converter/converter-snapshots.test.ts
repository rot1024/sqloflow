import { describe, it, expect } from 'vitest';
import { convert } from './index.js';
import { parse } from '../parser.js';
import type { Graph } from '../types/ir.js';

describe('convert with snapshots', () => {
  it('should generate snapshots for SELECT with minimal schema', () => {
    const sql = `
      SELECT u.name, u.email, o.total
      FROM users u
      JOIN orders o ON u.id = o.user_id
      WHERE o.status = 'completed'
      GROUP BY u.name, u.email
    `;
    
    const ast = parse(sql);
    const graph: Graph = convert(ast);
    
    expect(graph.snapshots).toBeDefined();
    expect(graph.snapshots!.length).toBeGreaterThan(0);
    
    
    // Find snapshots by content rather than node ID
    const fromSnapshot = graph.snapshots![0]; // First snapshot after FROM
    expect(fromSnapshot).toBeDefined();
    expect(fromSnapshot!.relations).toHaveProperty('u');
    
    // Find JOIN snapshot - should have both u and o relations
    const joinSnapshot = graph.snapshots!.find(s => 
      s.relations['u'] && s.relations['o']
    );
    expect(joinSnapshot).toBeDefined();
    
    // Check that columns were inferred from ON clause
    const usersRelation = joinSnapshot!.relations['u'];
    const ordersRelation = joinSnapshot!.relations['o'];
    expect(usersRelation?.columns.some(c => c.name === 'id')).toBe(true);
    expect(ordersRelation?.columns.some(c => c.name === 'user_id')).toBe(true);
    
    // Find WHERE snapshot - check if status column was inferred
    const whereSnapshot = graph.snapshots!.find((s, idx) => 
      idx > 1 && s.relations['o']?.columns.some(c => c.name === 'status')
    );
    expect(whereSnapshot).toBeDefined();
    
    // Check snapshot after GROUP BY
    const groupBySnapshot = graph.snapshots!.find(s => s.relations['_grouped']);
    expect(groupBySnapshot).toBeDefined();
    expect(groupBySnapshot!.relations['_grouped']).toBeDefined();
    
    // Check final SELECT snapshot
    const selectSnapshot = graph.snapshots!.find(s => s.relations['_result']);
    expect(selectSnapshot).toBeDefined();
    expect(selectSnapshot!.relations['_result']).toBeDefined();
    expect(selectSnapshot!.relations['_result'].columns).toHaveLength(3);
  });

  it('should infer columns from WHERE clause', () => {
    const sql = `
      SELECT *
      FROM products
      WHERE price > 100 AND category = 'electronics'
    `;
    
    const ast = parse(sql);
    const graph: Graph = convert(ast);
    
    // Find WHERE snapshot that has the inferred columns
    const whereSnapshot = graph.snapshots!.find(s => 
      s.relations['products']?.columns.some(c => c.name === 'price')
    );
    expect(whereSnapshot).toBeDefined();
    
    const productsColumns = whereSnapshot!.relations['products'].columns;
    expect(productsColumns.some(c => c.name === 'price')).toBe(true);
    expect(productsColumns.some(c => c.name === 'category')).toBe(true);
  });

  it('should handle CREATE TABLE with snapshots', () => {
    const sql = `
      CREATE TABLE users (
        id INT PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(255)
      );
      
      SELECT id, name FROM users WHERE email LIKE '%@example.com';
    `;
    
    const ast = parse(sql);
    const graph: Graph = convert(ast);
    
    expect(graph.snapshots).toBeDefined();
    
    // Initial schema should have users table with columns
    const firstSnapshot = graph.snapshots![0];
    expect(firstSnapshot.relations['users']).toBeDefined();
    expect(firstSnapshot.relations['users'].columns).toHaveLength(3);
    
    // Check that SELECT transformation creates result
    const selectSnapshot = graph.snapshots!.find(s => s.relations['_result']);
    expect(selectSnapshot).toBeDefined();
    expect(selectSnapshot!.relations['_result'].columns).toHaveLength(2);
  });

  it('should track schema through aggregations', () => {
    const sql = `
      SELECT 
        category,
        COUNT(*) as total,
        AVG(price) as avg_price
      FROM products
      GROUP BY category
    `;
    
    const ast = parse(sql);
    const graph: Graph = convert(ast);
    
    // Check GROUP BY snapshot
    const groupBySnapshot = graph.snapshots!.find(s => s.relations['_grouped']);
    expect(groupBySnapshot).toBeDefined();
    
    // GROUP BY should have the grouped column
    const groupedColumns = groupBySnapshot!.relations['_grouped'].columns;
    expect(groupedColumns.length).toBeGreaterThan(0);
    expect(groupedColumns.some(c => c.name === 'category')).toBe(true);
    
    // Check SELECT snapshot with aggregations
    const selectSnapshot = graph.snapshots!.find(s => s.relations['_result']);
    expect(selectSnapshot).toBeDefined();
    const resultColumns = selectSnapshot!.relations['_result'].columns;
    expect(resultColumns).toHaveLength(3);
    expect(resultColumns.some(c => c.name === 'category')).toBe(true);
    expect(resultColumns.some(c => c.name === 'total')).toBe(true);
    expect(resultColumns.some(c => c.name === 'avg_price')).toBe(true);
  });
});