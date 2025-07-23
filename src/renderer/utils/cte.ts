/**
 * Utilities for handling CTE (Common Table Expression) nodes in graphs
 */

import type { Graph, Node, Edge } from '../../types/ir.js';

/**
 * Extract CTE nodes from the graph
 * Returns a map of CTE node ID to CTE name
 */
export function extractCTENodes(graph: Graph): Map<string, string> {
  const cteNodes = new Map<string, string>();
  
  graph.nodes.forEach(node => {
    if (node.kind === 'relation' && node.label.startsWith('CTE:')) {
      const cteName = node.label.replace('CTE: ', '');
      cteNodes.set(node.id, cteName);
    }
  });
  
  return cteNodes;
}

/**
 * Find all nodes related to a specific CTE
 * Traverses backwards from the CTE node to find all nodes that contribute to it
 */
export function findCTERelatedNodes(graph: Graph, cteNode: Node): Node[] {
  const related: Node[] = [];
  const visited = new Set<string>();

  // Traverse backward from nodes with defines edges to CTEs
  const definesEdge = graph.edges.find(e =>
    e.kind === 'defines' && e.to.node === cteNode.id
  );

  if (definesEdge) {
    collectRelatedNodes(graph, definesEdge.from.node, related, visited, cteNode.id);
  }

  return related;
}

/**
 * Recursively collect nodes that are part of a CTE definition
 */
function collectRelatedNodes(
  graph: Graph,
  nodeId: string,
  collected: Node[],
  visited: Set<string>,
  stopAtNodeId: string
): void {
  if (visited.has(nodeId) || nodeId === stopAtNodeId) return;
  visited.add(nodeId);

  const node = graph.nodes.find(n => n.id === nodeId);
  if (node) {
    collected.push(node);
  }

  // Find input edges to this node
  const incomingEdges = graph.edges.filter(e =>
    e.to.node === nodeId && e.kind === 'flow'
  );

  for (const edge of incomingEdges) {
    collectRelatedNodes(graph, edge.from.node, collected, visited, stopAtNodeId);
  }
}

/**
 * Check if a node is related to any CTE
 */
export function isCTERelatedNode(graph: Graph, node: Node, cteNodes: Node[]): boolean {
  for (const cteNode of cteNodes) {
    const related = findCTERelatedNodes(graph, cteNode);
    if (related.some(n => n.id === node.id)) {
      return true;
    }
  }
  return false;
}

/**
 * Find the last node in a CTE (the node that connects to the CTE result node)
 */
export function findLastCTENode(graph: Graph, cteNodeId: string): string | null {
  const definesEdge = graph.edges.find(e => 
    e.kind === 'defines' && e.to.node === cteNodeId
  );
  
  return definesEdge ? definesEdge.from.node : null;
}

/**
 * Get edges within a CTE subgraph
 */
export function getCTEInternalEdges(
  graph: Graph, 
  cteRelatedNodes: Node[]
): Edge[] {
  return graph.edges.filter(edge =>
    cteRelatedNodes.some(n => n.id === edge.from.node) &&
    cteRelatedNodes.some(n => n.id === edge.to.node) &&
    edge.kind === 'flow'
  );
}

/**
 * Process CTE connections for rendering
 * Returns direct connections from last CTE node to target nodes
 */
export function processCTEConnections(
  graph: Graph,
  cteNodes: Map<string, string>
): Array<{ from: string; to: string }> {
  const connections: Array<{ from: string; to: string }> = [];
  
  cteNodes.forEach((cteName, cteNodeId) => {
    const lastCteNode = findLastCTENode(graph, cteNodeId);
    if (lastCteNode) {
      // Find edges from CTE result node to other nodes
      const outgoingEdges = graph.edges.filter(e => e.from.node === cteNodeId);
      for (const outEdge of outgoingEdges) {
        connections.push({
          from: lastCteNode,
          to: outEdge.to.node
        });
      }
    }
  });
  
  return connections;
}