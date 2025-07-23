import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { convert } from './index.js';
import type { Graph } from '../types/ir.js';

describe('Schema transformations', () => {
  describe('with CREATE TABLE schema', () => {
    it('should create schema snapshots when schema is available', () => {
      const sql = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name VARCHAR(100),
          email VARCHAR(255)
        );
        SELECT id, name FROM users;
      `;
      
      const ast = parse(sql);
      const ir = convert(ast);
      
      // Find the FROM node
      const fromNode = ir.nodes.find(n => n.kind === 'op' && n.label === 'FROM');
      expect(fromNode).toBeDefined();
      
      // Check schema snapshot for FROM node
      const fromSnapshot = ir.snapshots?.find(s => s.nodeId === fromNode?.id);
      expect(fromSnapshot).toBeDefined();
      expect(fromSnapshot?.schema).toBeDefined();
      
      // Check columns in snapshot
      const columns = fromSnapshot?.schema.columns || [];
      expect(columns).toHaveLength(3);
      
      const columnNames = columns.map(c => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('email');
      
      // Check column types
      const idColumn = columns.find(c => c.name === 'id');
      expect(idColumn?.type).toBe('integer');
      
      const nameColumn = columns.find(c => c.name === 'name');
      expect(nameColumn?.type).toBe('varchar(100)');
    });

    it('should track schema information in snapshots', () => {
      const sql = `
        CREATE TABLE products (
          id INTEGER,
          name VARCHAR(200)
        );
        SELECT * FROM products;
      `;
      
      const ast = parse(sql);
      const ir = convert(ast);
      
      // Find the FROM node that contains the table info
      const fromNode = ir.nodes.find(n => n.kind === 'op' && n.label === 'FROM');
      expect(fromNode).toBeDefined();
      expect(fromNode?.sql).toContain('products');
      
      // Check schema snapshot
      const snapshot = ir.snapshots?.find(s => s.nodeId === fromNode?.id);
      expect(snapshot).toBeDefined();
      expect(snapshot?.schema).toBeDefined();
      
      // Check columns in snapshot
      const columns = snapshot?.schema.columns || [];
      expect(columns).toHaveLength(2); // Two columns
      
      const columnNames = columns.map(c => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
    });

    it('should include source information in schema snapshots', () => {
      const sql = `
        CREATE TABLE categories (
          id INTEGER,
          name VARCHAR(50)
        );
        SELECT * FROM categories;
      `;
      
      const ast = parse(sql);
      const ir = convert(ast);
      
      const fromNode = ir.nodes.find(n => n.kind === 'op' && n.label === 'FROM');
      const snapshot = ir.snapshots?.find(s => s.nodeId === fromNode?.id);
      
      // All columns should have source set to 'categories'
      const columns = snapshot?.schema.columns || [];
      expect(columns.every(c => c.source === 'categories')).toBe(true);
    });

    it('should handle multiple tables with joins', () => {
      const sql = `
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name VARCHAR(100)
        );
        
        CREATE TABLE orders (
          id INTEGER PRIMARY KEY,
          user_id INTEGER,
          total DECIMAL(10,2)
        );
        
        SELECT u.name, o.total
        FROM users u
        JOIN orders o ON u.id = o.user_id;
      `;
      
      const ast = parse(sql);
      const ir = convert(ast);
      
      // Find JOIN node
      const joinNode = ir.nodes.find(n => n.kind === 'op' && n.label.includes('JOIN'));
      expect(joinNode).toBeDefined();
      
      // Check schema snapshot after JOIN
      const joinSnapshot = ir.snapshots?.find(s => s.nodeId === joinNode?.id);
      expect(joinSnapshot).toBeDefined();
      
      // Should have columns from both tables
      const columns = joinSnapshot?.schema.columns || [];
      
      // Check column counts
      const userColumns = columns.filter(c => c.source === 'u');
      const orderColumns = columns.filter(c => c.source === 'o');
      
      expect(userColumns).toHaveLength(2); // users columns
      expect(orderColumns).toHaveLength(3); // orders columns
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
  });

  describe('without CREATE TABLE schema', () => {
    it('should work when no schema is available', () => {
      const sql = 'SELECT * FROM unknown_table';
      
      const ast = parse(sql);
      const ir = convert(ast);
      
      // Should still have FROM operation node
      const fromNode = ir.nodes.find(n => n.kind === 'op' && n.label === 'FROM');
      expect(fromNode).toBeDefined();
      expect(fromNode?.sql).toContain('unknown_table');
      
      // Schema snapshot should exist but with minimal info
      const snapshot = ir.snapshots?.find(s => s.nodeId === fromNode?.id);
      expect(snapshot).toBeDefined();
      expect(snapshot?.schema).toBeDefined();
      // Columns might be empty or inferred from usage
    });

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
});