import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { convert } from './index.js';

describe('convert with schema', () => {
  it('should create column nodes when schema is available', () => {
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
    
    // Find column nodes
    const columnNodes = ir.nodes.filter(n => n.kind === 'column');
    expect(columnNodes).toHaveLength(3);
    
    // Check column names
    const columnNames = columnNodes.map(n => n.label);
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('name');
    expect(columnNames).toContain('email');
    
    // Check column types in sql field
    const idNode = columnNodes.find(n => n.label === 'id');
    expect(idNode?.sql).toBe('integer');
    
    const nameNode = columnNodes.find(n => n.label === 'name');
    expect(nameNode?.sql).toBe('varchar(100)');
  });

  it('should create defines edges from table to columns', () => {
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
    
    // Find defines edges from FROM node
    const definesEdges = ir.edges.filter(e => 
      e.kind === 'defines' && e.from.node === fromNode?.id
    );
    
    expect(definesEdges).toHaveLength(2); // Two columns
    
    // Check that edges point to column nodes
    const targetNodes = definesEdges.map(e => 
      ir.nodes.find(n => n.id === e.to.node)
    );
    
    expect(targetNodes.every(n => n?.kind === 'column')).toBe(true);
  });

  it('should set parent relationship for column nodes', () => {
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
    const columnNodes = ir.nodes.filter(n => n.kind === 'column');
    
    // All column nodes should have the FROM node as parent
    expect(columnNodes.every(n => n.parent === fromNode?.id)).toBe(true);
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
    
    // Should have columns for both tables
    const columnNodes = ir.nodes.filter(n => n.kind === 'column');
    expect(columnNodes).toHaveLength(5); // 2 from users + 3 from orders
    
    // Check that each table's columns have correct parent
    const fromNode = ir.nodes.find(n => n.kind === 'op' && n.label === 'FROM');
    const joinNode = ir.nodes.find(n => n.kind === 'op' && n.label.includes('JOIN'));
    
    const fromColumns = columnNodes.filter(n => n.parent === fromNode?.id);
    const joinColumns = columnNodes.filter(n => n.parent === joinNode?.id);
    
    expect(fromColumns).toHaveLength(2); // users columns
    expect(joinColumns).toHaveLength(3); // orders columns
  });

  it('should work when no schema is available', () => {
    const sql = 'SELECT * FROM unknown_table';
    
    const ast = parse(sql);
    const ir = convert(ast);
    
    // Should not have any column nodes
    const columnNodes = ir.nodes.filter(n => n.kind === 'column');
    expect(columnNodes).toHaveLength(0);
    
    // Should still have FROM operation node
    const fromNode = ir.nodes.find(n => n.kind === 'op' && n.label === 'FROM');
    expect(fromNode).toBeDefined();
    expect(fromNode?.sql).toContain('unknown_table');
  });
});