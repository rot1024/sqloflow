import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { convert } from '../converter/index.js';
import { renderMermaid } from './mermaid.js';

describe('Mermaid renderer', () => {
  it('should render basic SELECT as mermaid', () => {
    const sql = 'SELECT id, name FROM users';
    const ast = parse(sql);
    const ir = convert(ast);
    
    const result = renderMermaid(ir);
    
    expect(result).toContain('flowchart LR');
    expect(result).toContain('FROM');
    expect(result).toContain('SELECT');
    expect(result).toContain('users');
  });

  it('should render JOIN query as mermaid', () => {
    const sql = `
      SELECT u.id, u.name, o.total_amount
      FROM users AS u
      JOIN orders AS o ON o.user_id = u.id
    `;
    const ast = parse(sql);
    const ir = convert(ast);
    
    const result = renderMermaid(ir);
    
    expect(result).toContain('flowchart LR');
    expect(result).toContain('users AS u');
    expect(result).toContain('orders AS o');
    expect(result).toContain('INNER JOIN');
  });

  it('should render CTE as subgraph', () => {
    const sql = `
      WITH recent_orders AS (
        SELECT user_id, amount
        FROM orders
        WHERE created_at >= '2025-01-01'
      )
      SELECT u.id, u.name
      FROM users u
      JOIN recent_orders r ON r.user_id = u.id
    `;
    const ast = parse(sql);
    const ir = convert(ast);
    
    const result = renderMermaid(ir);
    
    expect(result).toContain('subgraph');
    expect(result).toContain('CTE: recent_orders');
    expect(result).toContain('CTE result');
  });

  it('should escape special characters in mermaid', () => {
    const sql = "SELECT id, name FROM users WHERE email = 'test@example.com'";
    const ast = parse(sql);
    const ir = convert(ast);
    
    // Manually add a label with special characters for testing
    ir.edges.push({
      id: 'test_edge',
      kind: 'flow',
      from: { node: 'node_0' },
      to: { node: 'node_1' },
      label: 'filter: amount > 100 & status < "active"'
    });
    
    const result = renderMermaid(ir);
    
    // Verify that special characters are escaped
    expect(result).toContain('&gt;');
    expect(result).toContain('&lt;');
    expect(result).toContain('&quot;');
  });

  it('should render complex query with multiple operations', () => {
    const sql = `
      SELECT 
        category,
        COUNT(*) as total,
        AVG(price) as avg_price
      FROM products
      WHERE status = 'active'
      GROUP BY category
      HAVING COUNT(*) > 5
      ORDER BY total DESC
      LIMIT 10
    `;
    const ast = parse(sql);
    const ir = convert(ast);
    
    const result = renderMermaid(ir);
    
    expect(result).toContain('flowchart LR');
    expect(result).toContain('FROM');
    expect(result).toContain('WHERE');
    expect(result).toContain('GROUP BY');
    expect(result).toContain('HAVING');
    expect(result).toContain('SELECT');
    expect(result).toContain('ORDER BY');
    expect(result).toContain('LIMIT');
  });

  it('should handle column nodes with parent relationships', () => {
    const sql = `
      CREATE TABLE users (
        id INT PRIMARY KEY,
        name VARCHAR(100)
      );
      SELECT id, name FROM users;
    `;
    const ast = parse(sql);
    const ir = convert(ast);
    
    const result = renderMermaid(ir);
    
    // Check for table and column nodes
    expect(result).toContain('users');
    expect(result).toContain('id');
    expect(result).toContain('name');
    
    // Mermaid format includes column nodes with proper syntax
    expect(result).toContain('node_');
    expect(result).toContain('-->');
  });

  it('should render UNION ALL query', () => {
    const sql = `
      SELECT id, name, 'user' AS source
      FROM users
      UNION ALL
      SELECT id, company_name AS name, 'org' AS source
      FROM organizations
    `;
    
    const ast = parse(sql);
    const ir = convert(ast);
    const result = renderMermaid(ir);
    
    // Expected structure
    expect(result).toContain('flowchart LR');
    expect(result).toContain('FROM users');
    expect(result).toContain('FROM organizations');
    expect(result).toContain('UNION ALL');
  });
});