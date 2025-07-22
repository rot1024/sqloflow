import type { Graph, Node, Edge, SubqueryNode } from '../types/ir.js';
import type { JsonViewType } from '../types/renderer.js';
import { findSubqueryResultNode, getSubqueryResultLabel } from '../converter/subquery-converter.js';
import { renderSchemaViewEnhanced } from './schema-dot.js';

export const renderDot = (graph: Graph, viewType: JsonViewType = 'operation'): string => {
  // Use enhanced schema view if enabled
  const useEnhancedSchemaView = true; // Feature flag
  
  if (viewType === 'schema' && useEnhancedSchemaView) {
    return renderSchemaViewEnhanced(graph);
  }
  
  const lines: string[] = [];
  lines.push('digraph sqloflow {');
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box, style=rounded];');
  lines.push('');
  
  if (viewType === 'operation') {
    renderOperationView(graph, lines);
  } else {
    renderSchemaView(graph, lines);
  }
  
  lines.push('}');
  return lines.join('\n');
};

const renderOperationView = (graph: Graph, lines: string[]) => {
  // Separate subquery nodes from regular nodes
  const subqueryNodes = graph.nodes.filter(n => n.kind === 'subquery') as SubqueryNode[];
  const regularNodes = graph.nodes.filter(n => n.kind !== 'subquery');
  
  // Track CTE nodes and their associated nodes
  const cteNodes = new Map<string, string>(); // CTE node ID -> CTE name
  const processedNodes = new Set<string>();
  
  // First pass: identify CTE nodes
  graph.nodes.forEach(node => {
    if (node.kind === 'relation' && node.label.startsWith('CTE:')) {
      const cteName = node.label.replace('CTE: ', '');
      cteNodes.set(node.id, cteName);
    }
  });
  
  // Render CTEs as subgraphs first
  cteNodes.forEach((cteName, cteNodeId) => {
    // Find all nodes that lead to this CTE node
    const cteSubgraphNodes = new Set<string>();
    
    // Traverse backwards from the CTE node to find all nodes in the CTE
    const findCTENodes = (nodeId: string) => {
      if (cteSubgraphNodes.has(nodeId)) return;
      cteSubgraphNodes.add(nodeId);
      
      // Find edges that lead to this node
      graph.edges.forEach(edge => {
        if (edge.to.node === nodeId && edge.kind === 'flow') {
          findCTENodes(edge.from.node);
        }
      });
    };
    
    // Start from edges that define the CTE
    graph.edges.forEach(edge => {
      if (edge.to.node === cteNodeId && edge.kind === 'defines') {
        findCTENodes(edge.from.node);
      }
    });
    
    // Render CTE as subgraph
    if (cteSubgraphNodes.size > 0) {
      lines.push('');
      lines.push(`  subgraph cluster_${cteNodeId} {`);
      lines.push(`    label="CTE: ${cteName}";`);
      lines.push('    style=filled;');
      lines.push('    fillcolor=lightblue;');
      lines.push('    color=blue;');
      lines.push('    penwidth=2;');
      
      // Render nodes in the CTE
      cteSubgraphNodes.forEach(nodeId => {
        const node = graph.nodes.find(n => n.id === nodeId);
        if (node) {
          processedNodes.add(nodeId);
          const style = getNodeStyle(node.kind);
          const label = formatNodeLabel(node);
          lines.push(`    ${escapeId(node.id)} [label="${escapeLabel(label)}"${style}];`);
        }
      });
      
      // Render edges within the CTE
      graph.edges.forEach(edge => {
        if (cteSubgraphNodes.has(edge.from.node) && cteSubgraphNodes.has(edge.to.node) && edge.kind === 'flow') {
          const style = getEdgeStyle(edge.kind);
          const attrs = style ? ` [${style}]` : '';
          lines.push(`    ${escapeId(edge.from.node)} -> ${escapeId(edge.to.node)}${attrs};`);
        }
      });
      
      lines.push('  }');
    }
    
    // Don't render the CTE node itself as it's represented by the subgraph
    processedNodes.add(cteNodeId);
  });
  
  // Group regular nodes by kind for styling (excluding already processed CTE nodes)
  const nodesByKind = new Map<string, Node[]>();
  regularNodes.forEach(node => {
    if (processedNodes.has(node.id)) return;
    if (!nodesByKind.has(node.kind)) {
      nodesByKind.set(node.kind, []);
    }
    nodesByKind.get(node.kind)!.push(node);
  });
  
  // Define regular node styles by kind
  lines.push('  // Node definitions');
  nodesByKind.forEach((nodes, kind) => {
    const style = getNodeStyle(kind);
    nodes.forEach(node => {
      const label = formatNodeLabel(node);
      lines.push(`  ${escapeId(node.id)} [label="${escapeLabel(label)}"${style}];`);
    });
  });
  
  // Render subqueries as subgraphs
  subqueryNodes.forEach((subqueryNode, index) => {
    lines.push('');
    lines.push(`  // Subquery ${index + 1}`);
    renderSubquerySubgraph(subqueryNode, lines, graph);
  });
  
  lines.push('');
  lines.push('  // Edges');
  
  // Render edges (excluding those from subquery nodes which are handled in subgraphs)
  graph.edges.forEach(edge => {
    // Skip edges from subquery nodes
    const fromNode = graph.nodes.find(n => n.id === edge.from.node);
    if (fromNode?.kind === 'subquery' && edge.kind === 'subqueryResult') {
      return;
    }
    
    // Skip edges that are internal to CTE subgraphs
    let skipEdge = false;
    cteNodes.forEach((cteName, cteNodeId) => {
      // Check if both nodes are in the same CTE
      const fromInThisCTE = processedNodes.has(edge.from.node) && edge.from.node !== cteNodeId;
      const toInThisCTE = processedNodes.has(edge.to.node) && edge.to.node !== cteNodeId;
      if (fromInThisCTE && toInThisCTE) {
        skipEdge = true;
      }
    });
    
    if (skipEdge) return;
    
    // Check if this edge involves a CTE
    let fromInCTE = false;
    let toInCTE = false;
    let fromCTEId = '';
    
    cteNodes.forEach((cteName, cteNodeId) => {
      if (edge.from.node === cteNodeId) {
        fromInCTE = true;
        fromCTEId = cteNodeId;
      }
      if (edge.to.node === cteNodeId) {
        toInCTE = true;
      }
    });
    
    const style = getEdgeStyle(edge.kind);
    const fromHandle = edge.from.handle ? `:${escapeId(edge.from.handle)}` : '';
    const toHandle = edge.to.handle ? `:${escapeId(edge.to.handle)}` : '';
    const attrs = style ? ` [${style}]` : '';
    
    // For edges from CTE nodes, find the last node in the CTE to connect from
    if (fromInCTE) {
      // Find the last node in the CTE subgraph to connect from
      let lastCTENode: string | null = null;
      
      // Find the node that has an edge TO the CTE node with 'defines' kind
      graph.edges.forEach(e => {
        if (e.to.node === fromCTEId && e.kind === 'defines') {
          lastCTENode = e.from.node;
        }
      });
      
      if (lastCTENode) {
        lines.push(`  ${escapeId(lastCTENode)}${fromHandle} -> ${escapeId(edge.to.node)}${toHandle}${attrs};`);
      }
    } else if (toInCTE) {
      // Skip edges to CTE nodes as they're handled by the subgraph
    } else {
      lines.push(`  ${escapeId(edge.from.node)}${fromHandle} -> ${escapeId(edge.to.node)}${toHandle}${attrs};`);
    }
  });
};

const renderSchemaView = (graph: Graph, lines: string[]) => {
  lines.push('  // Schema view with snapshots');
  
  // Separate subquery nodes from regular nodes
  const subqueryNodes = graph.nodes.filter(n => n.kind === 'subquery') as SubqueryNode[];
  const regularNodes = graph.nodes.filter(n => n.kind !== 'subquery');
  
  // Group regular nodes by their schema snapshot
  const nodesWithSnapshots = new Map<string, { node: Node; snapshotIndex: number }[]>();
  
  regularNodes.forEach(node => {
    // Find snapshot for this node
    const snapshotIndex = graph.snapshots?.findIndex(s => s.stepId === node.id) ?? -1;
    const key = snapshotIndex >= 0 ? `snapshot_${snapshotIndex}` : 'no_snapshot';
    
    if (!nodesWithSnapshots.has(key)) {
      nodesWithSnapshots.set(key, []);
    }
    nodesWithSnapshots.get(key)!.push({ node, snapshotIndex });
  });
  
  // Render subgraphs for each snapshot
  let clusterIndex = 0;
  nodesWithSnapshots.forEach((nodes, key) => {
    if (key !== 'no_snapshot') {
      lines.push(`  subgraph cluster_${clusterIndex} {`);
      lines.push(`    label="Schema Snapshot ${nodes[0].snapshotIndex + 1}";`);
      lines.push('    style=filled;');
      lines.push('    fillcolor=lightgray;');
      
      // Add schema information if available
      const snapshot = graph.snapshots?.[nodes[0].snapshotIndex];
      if (snapshot?.relations) {
        lines.push(`    // Relations: ${Object.keys(snapshot.relations).join(', ')}`);
      }
      
      nodes.forEach(({ node }) => {
        const style = getNodeStyle(node.kind);
        const label = formatNodeLabel(node);
        lines.push(`    ${escapeId(node.id)} [label="${escapeLabel(label)}"${style}];`);
      });
      
      lines.push('  }');
      clusterIndex++;
    } else {
      // Nodes without snapshots
      nodes.forEach(({ node }) => {
        const style = getNodeStyle(node.kind);
        const label = formatNodeLabel(node);
        lines.push(`  ${escapeId(node.id)} [label="${escapeLabel(label)}"${style}];`);
      });
    }
  });
  
  // Render subqueries as subgraphs
  subqueryNodes.forEach((subqueryNode, index) => {
    lines.push('');
    lines.push(`  // Subquery ${index + 1}`);
    renderSubquerySubgraph(subqueryNode, lines, graph);
  });
  
  lines.push('');
  lines.push('  // Schema transformation edges');
  
  // Render edges with schema transformation indicators
  graph.edges.forEach(edge => {
    // Skip edges from subquery nodes which are handled in subgraphs
    const fromNode = graph.nodes.find(n => n.id === edge.from.node);
    if (fromNode?.kind === 'subquery' && edge.kind === 'subqueryResult') {
      return;
    }
    
    const style = getEdgeStyle(edge.kind);
    const fromHandle = edge.from.handle ? `:${escapeId(edge.from.handle)}` : '';
    const toHandle = edge.to.handle ? `:${escapeId(edge.to.handle)}` : '';
    
    // Check if this edge represents a schema transformation
    const fromSnapshot = graph.snapshots?.find(s => s.stepId === edge.from.node);
    const toSnapshot = graph.snapshots?.find(s => s.stepId === edge.to.node);
    
    let edgeLabel = '';
    if (fromSnapshot && toSnapshot && fromSnapshot !== toSnapshot) {
      edgeLabel = ', label="schema change"';
    }
    
    const attrs = style || edgeLabel ? ` [${style}${edgeLabel}]` : '';
    lines.push(`  ${escapeId(edge.from.node)}${fromHandle} -> ${escapeId(edge.to.node)}${toHandle}${attrs};`);
  });
};

const getNodeStyle = (kind: string): string => {
  switch (kind) {
    case 'relation':
      return ', fillcolor=lightblue, style="filled,rounded"';
    case 'op':
      return ', fillcolor=lightgreen, style="filled,rounded"';
    case 'clause':
      return ', fillcolor=lightyellow, style="filled,rounded"';
    case 'column':
      return ', fillcolor=lightcoral, style="filled,rounded", shape=ellipse';
    case 'subquery':
      return ', fillcolor=lavender, style="filled,rounded,dashed", shape=box3d';
    default:
      return '';
  }
};

const getEdgeStyle = (kind: string): string => {
  switch (kind) {
    case 'flow':
      return 'color=black';
    case 'uses':
      return 'color=blue, style=dashed';
    case 'defines':
      return 'color=green, style=dotted';
    case 'mapsTo':
      return 'color=red, style=dashed';
    case 'subqueryResult':
      return 'color=purple, style=bold, label="subquery result"';
    case 'correlation':
      return 'color=orange, style=dashed, constraint=false';
    default:
      return '';
  }
};

const escapeId = (id: string): string => {
  // Escape special characters for DOT identifiers
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
    return id;
  }
  return `"${id.replace(/"/g, '\\"')}"`;
};

const escapeLabel = (label: string): string => {
  // Escape special characters for DOT labels
  return label
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
};

const formatNodeLabel = (node: Node): string => {
  const { label, sql, kind } = node;
  
  switch (kind) {
    case 'op':
      // Always show SQL details if available
      if (sql && (
        label === 'FROM' || 
        label === 'SELECT' || 
        label === 'ORDER BY' || 
        label === 'GROUP BY' || 
        label === 'LIMIT' ||
        label === 'OFFSET' ||
        label.includes('JOIN')
      )) {
        // For FROM and JOIN, handle table aliases
        if (label === 'FROM') {
          return sql;
        }
        if (label.includes('JOIN')) {
          return `${label} ${sql}`;
        }
        // For others, show both label and SQL
        return `${label} ${sql}`;
      }
      return label;
    case 'clause':
      // Always show SQL details for clauses if available
      if (sql && (label === 'WHERE' || label === 'HAVING')) {
        return `${label} ${sql}`;
      }
      return label;
    default:
      return label;
  }
};

const renderSubquerySubgraph = (subqueryNode: SubqueryNode, lines: string[], parentGraph: Graph) => {
  if (!subqueryNode.innerGraph) {
    // Phase 1: Simple subquery node without inner graph
    const style = getNodeStyle('subquery');
    const label = formatNodeLabel(subqueryNode);
    lines.push(`  ${escapeId(subqueryNode.id)} [label="${escapeLabel(label)}"${style}];`);
    return;
  }
  
  // Phase 2: Render subquery as subgraph
  lines.push(`  subgraph cluster_${escapeId(subqueryNode.id)} {`);
  
  // Update label to show correlation information
  let label = subqueryNode.label;
  if (subqueryNode.correlatedFields && subqueryNode.correlatedFields.length > 0) {
    label += ` - correlated on: ${subqueryNode.correlatedFields.join(', ')}`;
  }
  
  lines.push(`    label="${escapeLabel(label)}";`);
  lines.push('    style=filled;');
  lines.push('    fillcolor=lavender;');
  lines.push('    color=purple;');
  
  // Add thicker border for correlated subqueries
  if (subqueryNode.correlatedFields && subqueryNode.correlatedFields.length > 0) {
    lines.push('    penwidth=2;');
  }
  
  // Render inner nodes
  subqueryNode.innerGraph.nodes.forEach(node => {
    if (node.kind === 'subquery' && subqueryNode.innerGraph) {
      // Recursively render nested subqueries
      const nestedLines: string[] = [];
      renderSubquerySubgraph(node as SubqueryNode, nestedLines, subqueryNode.innerGraph);
      // Indent the nested subgraph
      lines.push(...nestedLines.map(line => '  ' + line));
    } else {
      const style = getNodeStyle(node.kind);
      const label = formatNodeLabel(node);
      lines.push(`    ${escapeId(node.id)} [label="${escapeLabel(label)}"${style}];`);
    }
  });
  
  // Render inner edges (excluding those from nested subqueries)
  subqueryNode.innerGraph.edges.forEach(edge => {
    // Skip edges from nested subquery nodes (they're handled in the nested subgraph)
    const fromNode = subqueryNode.innerGraph?.nodes.find(n => n.id === edge.from.node);
    if (fromNode?.kind === 'subquery' && edge.kind === 'subqueryResult') {
      return;
    }
    
    const style = getEdgeStyle(edge.kind);
    const attrs = style ? ` [${style}]` : '';
    lines.push(`    ${escapeId(edge.from.node)} -> ${escapeId(edge.to.node)}${attrs};`);
  });
  
  lines.push('  }');
  
  // Find the result node and create connection to parent
  const resultNode = findSubqueryResultNode(subqueryNode.innerGraph);
  if (resultNode) {
    // Find edges in parent graph that connect from this subquery
    const outgoingEdges = parentGraph.edges.filter(e => e.from.node === subqueryNode.id);
    for (const edge of outgoingEdges) {
      const resultLabel = getSubqueryResultLabel(subqueryNode.subqueryType);
      const style = getEdgeStyle('subqueryResult');
      // Remove the duplicate label from edge style
      const cleanStyle = style.replace(/, label="[^"]*"/, '');
      lines.push(`  ${escapeId(resultNode.id)} -> ${escapeId(edge.to.node)} [${cleanStyle}, label="${resultLabel}"];`);
    }
  }
};