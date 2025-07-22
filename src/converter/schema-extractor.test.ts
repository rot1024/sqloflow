import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { extractSchema } from './schema-extractor.js';

describe('extractSchema', () => {
  it('should extract schema from CREATE TABLE statement', () => {
    const sql = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE,
        age INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    
    const ast = parse(sql);
    const schema = extractSchema(ast);
    
    expect(schema.tables.users).toBeDefined();
    expect(schema.tables.users.name).toBe('users');
    expect(schema.tables.users.columns).toHaveLength(5);
    
    const columns = schema.tables.users.columns;
    
    // Check id column
    const idCol = columns.find(c => c.name === 'id');
    expect(idCol).toBeDefined();
    expect(idCol?.type).toBe('integer');
    expect(idCol?.primary_key).toBe(true);
    
    // Check name column
    const nameCol = columns.find(c => c.name === 'name');
    expect(nameCol).toBeDefined();
    expect(nameCol?.type).toBe('varchar(100)');
    expect(nameCol?.nullable).toBe(false);
    
    // Check email column
    const emailCol = columns.find(c => c.name === 'email');
    expect(emailCol).toBeDefined();
    expect(emailCol?.type).toBe('varchar(255)');
    expect(emailCol?.unique).toBe(true);
    
    // Check created_at column
    const createdCol = columns.find(c => c.name === 'created_at');
    expect(createdCol).toBeDefined();
    expect(createdCol?.type).toBe('timestamp');
  });

  it('should extract schema from multiple CREATE TABLE statements', () => {
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
    `;
    
    const ast = parse(sql);
    const schema = extractSchema(ast);
    
    expect(Object.keys(schema.tables)).toHaveLength(2);
    expect(schema.tables.users).toBeDefined();
    expect(schema.tables.orders).toBeDefined();
    
    expect(schema.tables.users.columns).toHaveLength(2);
    expect(schema.tables.orders.columns).toHaveLength(3);
  });

  it('should handle CREATE TABLE with IF NOT EXISTS', () => {
    const sql = `
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        name VARCHAR(200),
        price DECIMAL(8,2)
      )
    `;
    
    const ast = parse(sql);
    const schema = extractSchema(ast);
    
    expect(schema.tables.products).toBeDefined();
    expect(schema.tables.products.columns).toHaveLength(3);
  });

  it('should ignore non-CREATE TABLE statements', () => {
    const sql = `
      CREATE TABLE users (id INTEGER);
      SELECT * FROM users;
      INSERT INTO users VALUES (1);
    `;
    
    const ast = parse(sql);
    const schema = extractSchema(ast);
    
    expect(Object.keys(schema.tables)).toHaveLength(1);
    expect(schema.tables.users).toBeDefined();
  });
});