import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { convert } from './index.js';

describe('convert with schema', () => {
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
});