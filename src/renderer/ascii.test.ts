import { describe, it, expect } from 'vitest';
import { renderAscii } from './ascii.js';
import type { Graph } from '../types/ir.js';

describe('renderAscii', () => {
  it('should render a simple graph', () => {
    const graph: Graph = {
      nodes: [
        { id: 'n1', kind: 'relation', label: 'users' },
        { id: 'n2', kind: 'op', label: 'scan' },
        { id: 'n3', kind: 'op', label: 'project' }
      ],
      edges: [
        { id: 'e1', kind: 'flow', from: { node: 'n1' }, to: { node: 'n2' } },
        { id: 'e2', kind: 'flow', from: { node: 'n2' }, to: { node: 'n3' } }
      ]
    };

    const result = renderAscii(graph);
    
    // Check that result contains ASCII art
    expect(result).toContain('┌');
    expect(result).toContain('┐');
    expect(result).toContain('└');
    expect(result).toContain('┘');
    expect(result).toContain('│');
    expect(result).toContain('─');
    
    // Check that node labels are present
    expect(result).toContain('users');
    expect(result).toContain('scan');
    expect(result).toContain('project');
  });

  it('should handle parallel nodes', () => {
    const graph: Graph = {
      nodes: [
        { id: 'n1', kind: 'relation', label: 'table1' },
        { id: 'n2', kind: 'relation', label: 'table2' },
        { id: 'n3', kind: 'op', label: 'join' }
      ],
      edges: [
        { id: 'e1', kind: 'flow', from: { node: 'n1' }, to: { node: 'n3' } },
        { id: 'e2', kind: 'flow', from: { node: 'n2' }, to: { node: 'n3' } }
      ]
    };

    const result = renderAscii(graph);
    
    // Check that all tables are rendered
    expect(result).toContain('table1');
    expect(result).toContain('table2');
    expect(result).toContain('join');
    
    // Check for arrow
    expect(result).toContain('▶');
  });

  it('should handle single node', () => {
    const graph: Graph = {
      nodes: [
        { id: 'n1', kind: 'relation', label: 'users' }
      ],
      edges: []
    };

    const result = renderAscii(graph);
    expect(result).toContain('users');
    expect(result).toContain('┌');
    expect(result).toContain('┘');
  });

  it('should handle empty graph', () => {
    const graph: Graph = {
      nodes: [],
      edges: []
    };

    const result = renderAscii(graph);
    expect(result).toBe('');
  });

  it('should truncate long labels', () => {
    const graph: Graph = {
      nodes: [
        { id: 'n1', kind: 'relation', label: 'very_long_table_name_that_should_be_truncated' }
      ],
      edges: []
    };

    const result = renderAscii(graph);
    const lines = result.split('\n');
    
    // Check that box width is reasonable
    const maxLineLength = Math.max(...lines.map(l => l.length));
    expect(maxLineLength).toBeLessThanOrEqual(50);
  });

  it('should handle complex query', () => {
    const graph: Graph = {
      nodes: [
        { id: 'n1', kind: 'relation', label: 'users' },
        { id: 'n2', kind: 'relation', label: 'orders' },
        { id: 'n3', kind: 'op', label: 'scan' },
        { id: 'n4', kind: 'op', label: 'scan' },
        { id: 'n5', kind: 'op', label: 'join' },
        { id: 'n6', kind: 'op', label: 'filter' },
        { id: 'n7', kind: 'op', label: 'project' }
      ],
      edges: [
        { id: 'e1', kind: 'flow', from: { node: 'n1' }, to: { node: 'n3' } },
        { id: 'e2', kind: 'flow', from: { node: 'n2' }, to: { node: 'n4' } },
        { id: 'e3', kind: 'flow', from: { node: 'n3' }, to: { node: 'n5' } },
        { id: 'e4', kind: 'flow', from: { node: 'n4' }, to: { node: 'n5' } },
        { id: 'e5', kind: 'flow', from: { node: 'n5' }, to: { node: 'n6' } },
        { id: 'e6', kind: 'flow', from: { node: 'n6' }, to: { node: 'n7' } }
      ]
    };

    const result = renderAscii(graph);
    
    // Verify all nodes are present
    expect(result).toContain('users');
    expect(result).toContain('orders');
    expect(result).toContain('scan');
    expect(result).toContain('join');
    expect(result).toContain('filter');
    expect(result).toContain('project');
    
    // Check that it forms a valid ASCII diagram
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThan(3);
  });
});