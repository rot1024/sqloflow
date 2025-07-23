import { describe, it, expect } from 'vitest';
import { renderDot } from './dot.js';
import type { Graph } from '../types/ir.js';

describe('renderDot', () => {
  it('should render a simple graph', () => {
    const graph: Graph = {
      nodes: [
        { id: 'n1', kind: 'op', label: 'FROM', sql: 'FROM users' },
        { id: 'n2', kind: 'op', label: 'SELECT', sql: 'id, name' }
      ],
      edges: [
        { id: 'e1', from: { node: 'n1' }, to: { node: 'n2' }, kind: 'flow' }
      ]
    };

    const result = renderDot(graph);
    
    expect(result).toContain('digraph schema_flow');
    expect(result).toContain('rankdir=LR');
    expect(result).toContain('node [shape=record]');
    expect(result).toContain('n1 -> n2');
  });

  it('should render table nodes with columns', () => {
    const graph: Graph = {
      nodes: [
        { id: 'n1', kind: 'op', label: 'FROM', sql: 'FROM users' },
        { id: 'n2', kind: 'op', label: 'SELECT', sql: 'id, name' }
      ],
      edges: [
        { id: 'e1', from: { node: 'n1' }, to: { node: 'n2' }, kind: 'flow' }
      ],
      snapshots: [
        {
          nodeId: 'n1',
          schema: {
            columns: [
              { id: 'c1', name: 'id', type: 'INT', source: 'users' },
              { id: 'c2', name: 'name', type: 'VARCHAR', source: 'users' }
            ]
          }
        }
      ]
    };

    const result = renderDot(graph);
    
    expect(result).toContain('FROM users');
    expect(result).toContain('fillcolor=lightgreen'); // table color
  });

  it('should show operations with SQL parameters', () => {
    const graph: Graph = {
      nodes: [
        { id: 'n1', kind: 'op', label: 'FROM', sql: 'FROM users' },
        { id: 'n2', kind: 'clause', label: 'WHERE', sql: 'status = active' }
      ],
      edges: [
        { id: 'e1', from: { node: 'n1' }, to: { node: 'n2' }, kind: 'flow' }
      ]
    };

    const result = renderDot(graph);
    
    // WHERE clause should show SQL parameter
    expect(result).toContain('WHERE|status = active');
  });

  it('should escape special characters in labels', () => {
    const graph: Graph = {
      nodes: [
        { id: 'n1', kind: 'clause', label: 'WHERE', sql: 'price > 100' }
      ],
      edges: []
    };

    const result = renderDot(graph);
    expect(result).toContain('price \\> 100');
  });

  it('should handle empty graph', () => {
    const graph: Graph = {
      nodes: [],
      edges: []
    };

    const result = renderDot(graph);
    expect(result).toContain('digraph schema_flow');
    expect(result).toContain('}');
  });

  it('should handle CTE subgraphs', () => {
    const graph: Graph = {
      nodes: [
        { id: 'n1', kind: 'op', label: 'FROM', sql: 'FROM orders' },
        { id: 'n2', kind: 'op', label: 'SELECT', sql: '*' },
        { id: 'n3', kind: 'relation', label: 'CTE: user_orders' }
      ],
      edges: [
        { id: 'e1', from: { node: 'n1' }, to: { node: 'n2' }, kind: 'flow' },
        { id: 'e2', from: { node: 'n2' }, to: { node: 'n3' }, kind: 'defines' }
      ]
    };

    const result = renderDot(graph);
    
    expect(result).toContain('subgraph cluster_n3');
    expect(result).toContain('label="CTE: user_orders"');
  });

  it('should handle JOIN operations with table columns', () => {
    const graph: Graph = {
      nodes: [
        { id: 'n1', kind: 'op', label: 'FROM', sql: 'FROM users u' },
        { id: 'n2', kind: 'op', label: 'INNER JOIN', sql: 'INNER JOIN orders o ON u.id = o.user_id' }
      ],
      edges: [
        { id: 'e1', from: { node: 'n1' }, to: { node: 'n2' }, kind: 'flow' }
      ],
      snapshots: [
        {
          nodeId: 'n1',
          schema: {
            columns: [
              { id: 'c1', name: 'id', type: 'INT', source: 'users' },
              { id: 'c2', name: 'name', type: 'VARCHAR', source: 'users' }
            ]
          }
        }
      ]
    };

    const result = renderDot(graph);
    
    expect(result).toContain('INNER JOIN|users.id');
  });
});