import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { convert } from '../converter/index.js';
import { renderJson, type JsonOutput } from './json.js';

describe('JSON renderer', () => {
  it('should render operation view', () => {
    const sql = 'SELECT id, name FROM users WHERE country = \'JP\'';
    const ast = parse(sql);
    const ir = convert(ast);
    
    const result = renderJson(ir, 'operation');
    const json = JSON.parse(result);
    
    expect(json.view).toBe('operation');
    expect(json.nodes).toBeDefined();
    expect(json.edges).toBeDefined();
    
    // Operation view includes op/clause nodes
    const nodeTypes = (json as JsonOutput).nodes.map(n => n.type);
    expect(nodeTypes).toContain('op');
    expect(nodeTypes).toContain('clause');
  });

  it('should render schema view', () => {
    const sql = 'SELECT id, name FROM users';
    const ast = parse(sql);
    const ir = convert(ast);
    
    const result = renderJson(ir, 'schema');
    const json = JSON.parse(result);
    
    expect(json.view).toBe('schema');
    expect(json.nodes).toBeDefined();
    expect(json.edges).toBeDefined();
  });

  it('should filter nodes by view type', () => {
    const sql = `
      CREATE TABLE users (id INT, name VARCHAR(100));
      SELECT id, name FROM users;
    `;
    const ast = parse(sql);
    const ir = convert(ast);
    
    const operationResult = renderJson(ir, 'operation');
    const schemaResult = renderJson(ir, 'schema');
    
    const operationJson = JSON.parse(operationResult);
    const schemaJson = JSON.parse(schemaResult);
    
    // Operation view should have op nodes
    const operationNodeTypes = (operationJson as JsonOutput).nodes.map(n => n.type);
    expect(operationNodeTypes).toContain('op');
    
    // Schema view should have column nodes (relation nodes are now integrated into FROM/JOIN nodes)
    const schemaNodeTypes = (schemaJson as JsonOutput).nodes.map(n => n.type);
    expect(schemaNodeTypes).toContain('column');
    
    // Schema view with column nodes should not have op/clause in filtered result
    const schemaOpNodes = (schemaJson as JsonOutput).nodes.filter(n => n.type === 'op' || n.type === 'clause');
    expect(schemaOpNodes.length).toBe(0);
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
    const json = JSON.parse(result);
    
    // JSON renderer includes snapshots when they exist
    expect(json.snapshots).toBeDefined();
    expect(json.snapshots.length).toBe(ir.snapshots!.length);
  });
});