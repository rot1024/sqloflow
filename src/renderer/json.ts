import type { Graph, Node, Edge } from '../types/ir.js';
import type { JsonViewType } from '../types/renderer.js';

export interface JsonNode {
  id: string;
  type: string;
  label: string;
  sql?: string;
  parent?: string;
  meta?: Record<string, any>;
}

export interface JsonEdge {
  id: string;
  type: string;
  from: string;
  to: string;
  label?: string;
  meta?: Record<string, any>;
}

export interface JsonOutput {
  nodes: JsonNode[];
  edges: JsonEdge[];
  view: JsonViewType;
  snapshots?: any[];
}

export const renderJson = (graph: Graph, viewType: JsonViewType = 'operation'): string => {
  if (viewType === 'operation') {
    return JSON.stringify(renderOperationView(graph), null, 2);
  } else {
    return JSON.stringify(renderSchemaView(graph), null, 2);
  }
};

const renderOperationView = (graph: Graph): JsonOutput => {
  // Operation-focused view: centered on op/clause nodes and flow edges
  const filteredNodes = graph.nodes.filter(node => 
    node.kind === 'op' || node.kind === 'clause' || node.kind === 'relation'
  );
  
  const filteredEdges = graph.edges.filter(edge => 
    edge.kind === 'flow' || edge.kind === 'defines'
  );

  const output: JsonOutput = {
    view: 'operation',
    nodes: filteredNodes.map(node => ({
      id: node.id,
      type: node.kind,
      label: node.label,
      sql: node.sql,
      parent: node.parent,
      meta: node.meta
    })),
    edges: filteredEdges.map(edge => ({
      id: edge.id,
      type: edge.kind,
      from: edge.from.node,
      to: edge.to.node,
      label: edge.label,
      meta: edge.meta
    }))
  };

  if (graph.snapshots) {
    output.snapshots = graph.snapshots;
  }

  return output;
};

const renderSchemaView = (graph: Graph): JsonOutput => {
  // Schema-focused view: centered on relation and column nodes
  const schemaNodes = graph.nodes.filter(node => 
    node.kind === 'relation' || node.kind === 'column'
  );
  
  const schemaEdges = graph.edges.filter(edge => 
    edge.kind === 'mapsTo' || edge.kind === 'defines' || edge.kind === 'uses'
  );

  const output: JsonOutput = {
    view: 'schema',
    nodes: schemaNodes.map(node => ({
      id: node.id,
      type: node.kind,
      label: node.label,
      sql: node.sql,
      parent: node.parent,
      meta: node.meta
    })),
    edges: schemaEdges.map(edge => ({
      id: edge.id,
      type: edge.kind,
      from: edge.from.node,
      to: edge.to.node,
      label: edge.label,
      meta: edge.meta
    }))
  };

  if (graph.snapshots) {
    output.snapshots = graph.snapshots;
  }

  return output;
};