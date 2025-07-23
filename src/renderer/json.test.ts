import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { convert } from '../converter/index.js';
import { renderJson } from './json.js';
import type { Graph } from '../types/ir.js';

describe('JSON renderer', () => {
  it('should output the graph as JSON', () => {
    const sql = 'SELECT id, name FROM users WHERE country = \'JP\'';
    const ast = parse(sql);
    const ir = convert(ast);
    
    const result = renderJson(ir);
    const json: Graph = JSON.parse(result);
    
    expect(json.nodes).toBeDefined();
    expect(json.edges).toBeDefined();
    expect(json.nodes.length).toBeGreaterThan(0);
    expect(json.edges.length).toBeGreaterThan(0);
  });

  it('should include all node types', () => {
    const sql = `
      CREATE TABLE users (id INT, name VARCHAR(100));
      SELECT id, name FROM users;
    `;
    const ast = parse(sql);
    const ir = convert(ast);
    
    const result = renderJson(ir);
    const json: Graph = JSON.parse(result);
    
    // Should include nodes
    const nodeTypes = new Set(json.nodes.map(n => n.kind));
    expect(nodeTypes.size).toBeGreaterThanOrEqual(1);
    expect(json.nodes.length).toBeGreaterThan(0);
  });

  it('should include snapshots when available', () => {
    const sql = `
      SELECT u.name, o.total
      FROM users u
      JOIN orders o ON u.id = o.user_id
    `;
    const ast = parse(sql);
    const ir = convert(ast);
    
    // Make sure we have snapshots in the IR
    expect(ir.snapshots).toBeDefined();
    expect(ir.snapshots!.length).toBeGreaterThan(0);
    
    const result = renderJson(ir);
    const json: Graph = JSON.parse(result);
    
    // JSON output includes snapshots when they exist
    expect(json.snapshots).toBeDefined();
    expect(json.snapshots!.length).toBe(ir.snapshots!.length);
  });

  it('should be valid JSON with proper formatting', () => {
    const sql = 'SELECT * FROM users';
    const ast = parse(sql);
    const ir = convert(ast);
    
    const result = renderJson(ir);
    
    // Should be properly formatted with 2-space indentation
    expect(result).toContain('\n  ');
    
    // Should be valid JSON
    expect(() => JSON.parse(result)).not.toThrow();
  });
});