import type { Graph, Node, Edge } from '../types/ir.js';
import type { JsonViewType } from '../types/renderer.js';

export const renderDot = (graph: Graph, viewType: JsonViewType = 'operation'): string => {
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
  // Group nodes by kind for styling
  const nodesByKind = new Map<string, Node[]>();
  graph.nodes.forEach(node => {
    if (!nodesByKind.has(node.kind)) {
      nodesByKind.set(node.kind, []);
    }
    nodesByKind.get(node.kind)!.push(node);
  });
  
  // Define node styles by kind
  lines.push('  // Node definitions');
  nodesByKind.forEach((nodes, kind) => {
    const style = getNodeStyle(kind);
    nodes.forEach(node => {
      const label = formatNodeLabel(node);
      lines.push(`  ${escapeId(node.id)} [label="${escapeLabel(label)}"${style}];`);
    });
  });
  
  lines.push('');
  lines.push('  // Edges');
  
  // Render edges
  graph.edges.forEach(edge => {
    const style = getEdgeStyle(edge.kind);
    const fromHandle = edge.from.handle ? `:${escapeId(edge.from.handle)}` : '';
    const toHandle = edge.to.handle ? `:${escapeId(edge.to.handle)}` : '';
    const attrs = style ? ` [${style}]` : '';
    lines.push(`  ${escapeId(edge.from.node)}${fromHandle} -> ${escapeId(edge.to.node)}${toHandle}${attrs};`);
  });
};

const renderSchemaView = (graph: Graph, lines: string[]) => {
  lines.push('  // Schema view with snapshots');
  
  // Group nodes by their schema snapshot
  const nodesWithSnapshots = new Map<string, { node: Node; snapshotIndex: number }[]>();
  
  graph.nodes.forEach(node => {
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
  
  lines.push('');
  lines.push('  // Schema transformation edges');
  
  // Render edges with schema transformation indicators
  graph.edges.forEach(edge => {
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
        // For FROM, just show the SQL
        if (label === 'FROM') {
          return sql;
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