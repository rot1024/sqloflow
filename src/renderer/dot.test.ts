import { describe, it, expect } from 'vitest';
import { renderDot } from './dot.js';
import type { Graph } from '../types/ir.js';

describe('renderDot', () => {
  describe('operation view', () => {
    it('should render a simple graph', () => {
      const graph: Graph = {
        nodes: [
          { id: 'n1', kind: 'relation', label: 'users' },
          { id: 'n2', kind: 'op', label: 'scan' },
          { id: 'n3', kind: 'op', label: 'project' }
        ],
        edges: [
          { id: 'e1', from: { node: 'n1' }, to: { node: 'n2' }, kind: 'flow' },
          { id: 'e2', from: { node: 'n2' }, to: { node: 'n3' }, kind: 'flow' }
        ]
      };

      const result = renderDot(graph, 'operation');
      
      expect(result).toContain('digraph sqloflow');
      expect(result).toContain('rankdir=LR');
      expect(result).toContain('n1 [label="users", fillcolor=lightblue');
      expect(result).toContain('n2 [label="scan", fillcolor=lightgreen');
      expect(result).toContain('n3 [label="project", fillcolor=lightgreen');
      expect(result).toContain('n1 -> n2');
      expect(result).toContain('n2 -> n3');
    });

    it('should handle different edge types', () => {
      const graph: Graph = {
        nodes: [
          { id: 'n1', kind: 'relation', label: 'users' },
          { id: 'n2', kind: 'column', label: 'id' },
          { id: 'n3', kind: 'op', label: 'filter' }
        ],
        edges: [
          { id: 'e1', from: { node: 'n1' }, to: { node: 'n3' }, kind: 'flow' },
          { id: 'e2', from: { node: 'n2' }, to: { node: 'n3' }, kind: 'uses' },
          { id: 'e3', from: { node: 'n1' }, to: { node: 'n2' }, kind: 'defines' }
        ]
      };

      const result = renderDot(graph, 'operation');
      
      expect(result).toContain('n1 -> n3 [color=black]');
      expect(result).toContain('n2 -> n3 [color=blue, style=dashed]');
      expect(result).toContain('n1 -> n2 [color=green, style=dotted]');
    });

    it('should escape special characters in labels', () => {
      const graph: Graph = {
        nodes: [
          { id: 'n1', kind: 'op', label: 'test "quoted" label' }
        ],
        edges: []
      };

      const result = renderDot(graph, 'operation');
      expect(result).toContain('n1 [label="test \\"quoted\\" label"');
    });

    it('should handle empty graph', () => {
      const graph: Graph = {
        nodes: [],
        edges: []
      };

      const result = renderDot(graph, 'operation');
      expect(result).toContain('digraph sqloflow');
      expect(result).toContain('}');
    });
  });

  describe('schema view', () => {
    it('should render enhanced schema view with table and operation nodes', () => {
      const graph: Graph = {
        nodes: [
          { id: 'n1', kind: 'relation', label: 'users' },
          { id: 'n2', kind: 'op', label: 'scan' },
          { id: 'n3', kind: 'op', label: 'project' }
        ],
        edges: [
          { id: 'e1', from: { node: 'n1' }, to: { node: 'n2' }, kind: 'flow' },
          { id: 'e2', from: { node: 'n2' }, to: { node: 'n3' }, kind: 'flow' }
        ],
        snapshots: [
          {
            stepId: 'n2',
            relations: {
              users: {
                name: 'users',
                columns: [
                  { id: 'c1', name: 'id', type: 'INT' },
                  { id: 'c2', name: 'name', type: 'VARCHAR' }
                ]
              }
            }
          }
        ]
      };

      const result = renderDot(graph, 'schema');
      
      // Enhanced schema view shows tables and operations
      expect(result).toContain('digraph schema_flow');
      expect(result).toContain('FROM users');
      expect(result).toContain('fillcolor=lightgreen'); // table color
      expect(result).toContain('fillcolor=lightyellow'); // operation color
    });

    it('should show operations and data flow', () => {
      const graph: Graph = {
        nodes: [
          { id: 'n1', kind: 'op', label: 'FROM', sql: 'FROM users' },
          { id: 'n2', kind: 'op', label: 'WHERE', sql: 'status = active' }
        ],
        edges: [
          { id: 'e1', from: { node: 'n1' }, to: { node: 'n2' }, kind: 'flow' }
        ],
        snapshots: [
          {
            stepId: 'n1',
            relations: {
              users: {
                name: 'users',
                columns: [{ id: 'c1', name: 'id', type: 'INT' }]
              }
            }
          },
          {
            stepId: 'n2',
            relations: {
              users: {
                name: 'users',
                columns: [
                  { id: 'c1', name: 'id', type: 'INT' },
                  { id: 'c2', name: 'calculated', type: 'VARCHAR' }
                ]
              }
            }
          }
        ]
      };

      const result = renderDot(graph, 'schema');
      
      // Enhanced schema view focuses on operations and data flow
      expect(result).toContain('WHERE|status = active');
      expect(result).toContain('n1 -> n2');
    });

    it('should handle nodes without snapshots', () => {
      const graph: Graph = {
        nodes: [
          { id: 'n1', kind: 'relation', label: 'users' },
          { id: 'n2', kind: 'op', label: 'scan' }
        ],
        edges: [
          { id: 'e1', from: { node: 'n1' }, to: { node: 'n2' }, kind: 'flow' }
        ],
        snapshots: [
          {
            stepId: 'n2',
            relations: {
              users: { name: 'users', columns: [] }
            }
          }
        ]
      };

      const result = renderDot(graph, 'schema');
      
      // Enhanced schema view renders all nodes
      expect(result).toContain('n2 [label="scan"');
      expect(result).toContain('digraph schema_flow');
    });
  });

  it('should default to operation view', () => {
    const graph: Graph = {
      nodes: [{ id: 'n1', kind: 'op', label: 'test' }],
      edges: []
    };

    const result = renderDot(graph);
    expect(result).toContain('// Node definitions');
    expect(result).not.toContain('// Schema view');
  });
});