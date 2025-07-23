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
    // Without CREATE TABLE, columns will be empty initially
    expect(fromSnapshot!.schema.columns).toBeDefined();
    
    // Find JOIN snapshot - should have columns from both tables
    const joinSnapshot = graph.snapshots!.find(s => 
      s.schema.columns.some(c => c.source === 'u') && 
      s.schema.columns.some(c => c.source === 'o')
    );
    expect(joinSnapshot).toBeDefined();
    
    // Check that columns were inferred from ON clause
    const userColumns = joinSnapshot!.schema.columns.filter(c => c.source === 'u');
    const orderColumns = joinSnapshot!.schema.columns.filter(c => c.source === 'o');
    expect(userColumns.some(c => c.name === 'id')).toBe(true);
    expect(orderColumns.some(c => c.name === 'user_id')).toBe(true);
    
    // Find WHERE snapshot - check if status column was inferred
    const whereSnapshot = graph.snapshots!.find((s, idx) => 
      idx > 1 && s.schema.columns.some(c => c.name === 'status' && c.source === 'o')
    );
    expect(whereSnapshot).toBeDefined();
    
    // Check snapshot after GROUP BY
    const groupBySnapshot = graph.snapshots!.find((s, idx) => 
      idx > 2 && s.schema.columns.some(c => c.name === 'name')
    );
    expect(groupBySnapshot).toBeDefined();
    
    // Check final SELECT snapshot
    const selectSnapshot = graph.snapshots![graph.snapshots!.length - 1];
    expect(selectSnapshot).toBeDefined();
    expect(selectSnapshot!.schema.columns).toHaveLength(3);
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
      s.schema.columns.some(c => c.name === 'price')
    );
    expect(whereSnapshot).toBeDefined();
    
    const columns = whereSnapshot!.schema.columns;
    expect(columns.some(c => c.name === 'price')).toBe(true);
    expect(columns.some(c => c.name === 'category')).toBe(true);
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
    expect(firstSnapshot.schema.columns).toHaveLength(3);
    expect(firstSnapshot.schema.columns.every(c => c.source === 'users')).toBe(true);
    
    // Check that SELECT transformation creates result
    const selectSnapshot = graph.snapshots![graph.snapshots!.length - 1];
    expect(selectSnapshot).toBeDefined();
    expect(selectSnapshot!.schema.columns).toHaveLength(2);
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
    const groupBySnapshot = graph.snapshots!.find((s, idx) => 
      idx > 0 && s.schema.columns.some(c => c.name === 'category')
    );
    expect(groupBySnapshot).toBeDefined();
    
    // GROUP BY should have the grouped column
    const groupedColumns = groupBySnapshot!.schema.columns;
    expect(groupedColumns.length).toBeGreaterThan(0);
    expect(groupedColumns.some(c => c.name === 'category')).toBe(true);
    
    // Check SELECT snapshot with aggregations
    const selectSnapshot = graph.snapshots![graph.snapshots!.length - 1];
    expect(selectSnapshot).toBeDefined();
    const resultColumns = selectSnapshot!.schema.columns;
    expect(resultColumns).toHaveLength(3);
    expect(resultColumns.some(c => c.name === 'category')).toBe(true);
    expect(resultColumns.some(c => c.name === 'total')).toBe(true);
    expect(resultColumns.some(c => c.name === 'avg_price')).toBe(true);
  });
});