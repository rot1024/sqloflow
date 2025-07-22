import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { convert } from './index.js';

describe('convert', () => {

  it('should convert basic SELECT statement', () => {
    const sql = 'SELECT id, name FROM users';
    const ast = parse(sql);
    const ir = convert(ast);
    
    // FROM users creates: relation node + FROM op node + SELECT op node = 3 nodes
    expect(ir.nodes).toHaveLength(3);
    expect(ir.edges).toHaveLength(2);
    
    const relationNode = ir.nodes.find(n => n.kind === 'relation');
    const fromNode = ir.nodes.find(n => n.kind === 'op' && n.label === 'FROM');
    const selectNode = ir.nodes.find(n => n.kind === 'op' && n.label === 'SELECT');
    
    expect(relationNode).toBeDefined();
    expect(relationNode?.label).toBe('users');
    expect(fromNode).toBeDefined();
    expect(selectNode).toBeDefined();
    expect(selectNode?.sql).toBe('id, name');
  });

  it('should convert SELECT with WHERE clause', () => {
    const sql = "SELECT id, name FROM users WHERE country = 'JP'";
    const ast = parse(sql);
    const ir = convert(ast);
    
    // FROM users creates: relation + FROM op + WHERE clause + SELECT op = 4 nodes
    expect(ir.nodes).toHaveLength(4);
    expect(ir.edges).toHaveLength(3);
    
    const whereNode = ir.nodes.find(n => n.kind === 'clause' && n.label === 'WHERE');
    expect(whereNode).toBeDefined();
  });

  it('should convert SELECT with JOIN', () => {
    const sql = `
      SELECT u.id, u.name, o.total_amount
      FROM users AS u
      JOIN orders AS o ON o.user_id = u.id
    `;
    const ast = parse(sql);
    const ir = convert(ast);
    
    const joinNode = ir.nodes.find(n => n.kind === 'op' && n.label.includes('JOIN'));
    expect(joinNode).toBeDefined();
    
    const relationNodes = ir.nodes.filter(n => n.kind === 'relation');
    expect(relationNodes).toHaveLength(2);
  });

  it('should convert SELECT with GROUP BY and ORDER BY', () => {
    const sql = `
      SELECT category, COUNT(*) AS cnt
      FROM products
      GROUP BY category
      ORDER BY cnt DESC
      LIMIT 10
    `;
    const ast = parse(sql);
    const ir = convert(ast);
    
    const groupByNode = ir.nodes.find(n => n.label === 'GROUP BY');
    const orderByNode = ir.nodes.find(n => n.label === 'ORDER BY');
    const limitNode = ir.nodes.find(n => n.label === 'LIMIT');
    
    expect(groupByNode).toBeDefined();
    expect(orderByNode).toBeDefined();
    expect(limitNode).toBeDefined();
    
    // Check flow order
    const flowEdges = ir.edges.filter(e => e.kind === 'flow');
    expect(flowEdges.length).toBeGreaterThan(0);
  });

  it('should convert UPDATE statement', () => {
    const sql = "UPDATE users SET vip = TRUE WHERE id = 1";
    const ast = parse(sql);
    const ir = convert(ast);
    
    const updateNode = ir.nodes.find(n => n.kind === 'op' && n.label === 'UPDATE');
    const whereNode = ir.nodes.find(n => n.kind === 'clause' && n.label === 'WHERE');
    
    expect(updateNode).toBeDefined();
    expect(whereNode).toBeDefined();
    
    const flowEdge = ir.edges.find(e => 
      e.from.node === updateNode?.id && e.to.node === whereNode?.id
    );
    expect(flowEdge).toBeDefined();
  });
});