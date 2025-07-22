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
    
    // Find the products table node
    const tableNode = ir.nodes.find(n => n.kind === 'relation' && n.label === 'products');
    expect(tableNode).toBeDefined();
    
    // Find defines edges from table
    const definesEdges = ir.edges.filter(e => 
      e.kind === 'defines' && e.from.node === tableNode?.id
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
    
    const tableNode = ir.nodes.find(n => n.kind === 'relation' && n.label === 'categories');
    const columnNodes = ir.nodes.filter(n => n.kind === 'column');
    
    // All column nodes should have the table as parent
    expect(columnNodes.every(n => n.parent === tableNode?.id)).toBe(true);
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
    const usersTable = ir.nodes.find(n => n.kind === 'relation' && n.label.includes('users'));
    const ordersTable = ir.nodes.find(n => n.kind === 'relation' && n.label.includes('orders'));
    
    const userColumns = columnNodes.filter(n => n.parent === usersTable?.id);
    const orderColumns = columnNodes.filter(n => n.parent === ordersTable?.id);
    
    expect(userColumns).toHaveLength(2);
    expect(orderColumns).toHaveLength(3);
  });

  it('should work when no schema is available', () => {
    const sql = 'SELECT * FROM unknown_table';
    
    const ast = parse(sql);
    const ir = convert(ast);
    
    // Should not have any column nodes
    const columnNodes = ir.nodes.filter(n => n.kind === 'column');
    expect(columnNodes).toHaveLength(0);
    
    // Should still have table and operation nodes
    const tableNode = ir.nodes.find(n => n.kind === 'relation');
    expect(tableNode).toBeDefined();
  });
});