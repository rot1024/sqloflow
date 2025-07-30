import type { Graph, Node, Edge, SubqueryNode } from '../types/ir.js';
import { findSubqueryResultNode, getSubqueryResultLabel } from '../converter/subquery.js';
import {
  inferSchemaFromGraph,
  getJoinColumns,
  type TableInfo
} from './utils/schema-inference.js';
import { formatWhereExpression } from './utils/expression-formatter.js';
import { buildNodeSchemas } from './utils/node-schemas.js';

interface Position {
  x: number;
  y: number;
}

interface LayoutNode {
  node: Node;
  pos: Position;
  width: number;
  height: number;
  content: string[];
}

export const renderAscii = (graph: Graph): string => {
  // Handle empty graph
  if (graph.nodes.length === 0) {
    return '';
  }
  
  // Flatten the graph - expand subqueries inline
  const flatGraph = flattenGraph(graph);
  
  // Infer schema information from the flattened graph
  const { tables, tableAliases } = inferSchemaFromGraph(flatGraph);
  
  // Build node schemas map for display using the shared utility
  const nodeSchemas = buildNodeSchemas(flatGraph, tables);
  
  // Simple left-to-right layout
  const layout = calculateLayout(flatGraph, nodeSchemas, tables, tableAliases);
  const canvas = renderToCanvas(layout, flatGraph.edges, flatGraph);
  return canvas;
};

const calculateLayout = (
  graph: Graph,
  nodeSchemas: Map<string, string[]>,
  tables: Map<string, TableInfo>,
  tableAliases: Map<string, string>
): Map<string, LayoutNode> => {
  const layout = new Map<string, LayoutNode>();
  const nodesByLevel = groupNodesByLevel(graph);
  
  let currentX = 0;
  const levelSpacing = 4;
  const nodeSpacing = 2;
  
  nodesByLevel.forEach((nodes, level) => {
    let currentY = 0;
    let maxWidth = 0;
    
    nodes.forEach(node => {
      const content = formatNodeContent(node, nodeSchemas, graph, tables, tableAliases);
      const width = Math.max(...content.map(line => line.length)) + 4;
      const height = content.length + 2; // +2 for top and bottom borders
      
      layout.set(node.id, {
        node,
        pos: { x: currentX, y: currentY },
        width,
        height,
        content
      });
      
      maxWidth = Math.max(maxWidth, width);
      currentY += height + nodeSpacing;
    });
    
    currentX += maxWidth + levelSpacing;
  });
  
  return layout;
};

const groupNodesByLevel = (graph: Graph): Map<number, Node[]> => {
  const levels = new Map<string, number>();
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  
  // Simple topological sort to determine levels
  const visited = new Set<string>();
  const visiting = new Set<string>();
  
  const calculateLevel = (nodeId: string): number => {
    if (levels.has(nodeId)) return levels.get(nodeId)!;
    if (visiting.has(nodeId)) return 0; // Cycle detected
    
    visited.add(nodeId);
    visiting.add(nodeId);
    
    // Find incoming edges
    const incomingEdges = graph.edges.filter(e => e.to.node === nodeId);
    let maxLevel = -1;
    
    for (const edge of incomingEdges) {
      const fromLevel = calculateLevel(edge.from.node);
      maxLevel = Math.max(maxLevel, fromLevel);
    }
    
    visiting.delete(nodeId);
    const level = maxLevel + 1;
    levels.set(nodeId, level);
    return level;
  };
  
  // Calculate levels for all nodes
  graph.nodes.forEach(node => {
    if (!visited.has(node.id)) {
      calculateLevel(node.id);
    }
  });
  
  // Group nodes by level
  const nodesByLevel = new Map<number, Node[]>();
  graph.nodes.forEach(node => {
    const level = levels.get(node.id) || 0;
    if (!nodesByLevel.has(level)) {
      nodesByLevel.set(level, []);
    }
    nodesByLevel.get(level)!.push(node);
  });
  
  return nodesByLevel;
};

const renderToCanvas = (layout: Map<string, LayoutNode>, edges: Edge[], graph: Graph): string => {
  // Calculate canvas size
  let maxX = 0;
  let maxY = 0;
  layout.forEach(layoutNode => {
    maxX = Math.max(maxX, layoutNode.pos.x + layoutNode.width);
    maxY = Math.max(maxY, layoutNode.pos.y + layoutNode.height);
  });
  
  // Create canvas
  const canvas: string[][] = Array(maxY + 1).fill(null).map(() => Array(maxX + 1).fill(' '));
  
  // Draw nodes
  layout.forEach(layoutNode => {
    drawBox(canvas, layoutNode);
  });
  
  // Draw edges
  edges.forEach(edge => {
    const from = layout.get(edge.from.node);
    const to = layout.get(edge.to.node);
    if (from && to) {
      drawEdge(canvas, from, to);
    }
  });
  
  // Convert canvas to string
  return canvas.map(row => row.join('')).join('\n');
};

const drawBox = (canvas: string[][], layoutNode: LayoutNode) => {
  const { pos, width, height, content } = layoutNode;
  const { x, y } = pos;
  
  // Top border
  canvas[y][x] = '┌';
  for (let i = 1; i < width - 1; i++) {
    canvas[y][x + i] = '─';
  }
  canvas[y][x + width - 1] = '┐';
  
  // Content lines
  for (let lineIdx = 0; lineIdx < content.length; lineIdx++) {
    const row = y + 1 + lineIdx;
    canvas[row][x] = '│';
    
    const line = content[lineIdx];
    const padding = Math.floor((width - 2 - line.length) / 2);
    
    for (let i = 0; i < width - 2; i++) {
      if (i >= padding && i < padding + line.length) {
        canvas[row][x + 1 + i] = line[i - padding];
      } else {
        canvas[row][x + 1 + i] = ' ';
      }
    }
    canvas[row][x + width - 1] = '│';
  }
  
  // Bottom border
  const bottomY = y + height - 1;
  canvas[bottomY][x] = '└';
  for (let i = 1; i < width - 1; i++) {
    canvas[bottomY][x + i] = '─';
  }
  canvas[bottomY][x + width - 1] = '┘';
};

const drawEdge = (canvas: string[][], from: LayoutNode, to: LayoutNode) => {
  // Calculate connection points at the middle of each box
  const fromX = from.pos.x + from.width;
  const fromY = from.pos.y + Math.floor(from.height / 2);
  const toX = to.pos.x - 1;
  const toY = to.pos.y + Math.floor(to.height / 2);
  
  // Check if we need to draw backwards (for CREATE TABLE nodes)
  if (toX < fromX) {
    // Draw a line that goes down, left, then up to the target
    const bottomY = Math.max(...Array.from(canvas.keys())) - 2;
    
    // Start from the right edge of source node
    canvas[fromY][fromX] = '┐';
    
    // Draw down from source
    for (let y = fromY + 1; y <= bottomY; y++) {
      if (y === bottomY) {
        canvas[y][fromX] = '┘';
      } else {
        canvas[y][fromX] = '│';
      }
    }
    
    // Draw horizontal line at the bottom
    for (let x = toX + to.width; x < fromX; x++) {
      canvas[bottomY][x] = '─';
    }
    
    // Draw up to target
    for (let y = toY + 1; y <= bottomY; y++) {
      if (y === bottomY) {
        canvas[y][toX + to.width] = '└';
      } else {
        canvas[y][toX + to.width] = '│';
      }
    }
    
    // Draw arrow pointing to target node
    canvas[toY][toX] = '▶';
    
    return;
  }
  
  // Original logic for left-to-right edges
  for (let x = fromX; x <= toX; x++) {
    if (x === fromX) {
      canvas[fromY][x] = '─';
    } else if (x === toX) {
      canvas[toY][x] = '▶';
    } else if (fromY === toY) {
      canvas[fromY][x] = '─';
    } else {
      // Need to draw vertical connector
      if (x === fromX + 2) {
        // Draw vertical line
        const startY = Math.min(fromY, toY);
        const endY = Math.max(fromY, toY);
        for (let y = startY; y <= endY; y++) {
          if (y === fromY) {
            canvas[y][x] = fromY < toY ? '┐' : '┘';
          } else if (y === toY) {
            canvas[y][x] = fromY < toY ? '└' : '┌';
          } else {
            canvas[y][x] = '│';
          }
        }
      }
    }
  }
};

const formatNodeContent = (
  node: Node,
  nodeSchemas: Map<string, string[]>,
  graph: Graph,
  tables: Map<string, TableInfo>,
  tableAliases: Map<string, string>
): string[] => {
  const { label, sql, kind } = node;
  const lines: string[] = [];
  
  // Get schema information for this node
  const schemaColumns = nodeSchemas.get(node.id);
  
  // For JOIN nodes, get all columns from joined tables
  if (node.kind === 'op' && node.label.includes('JOIN')) {
    const joinColumns = getJoinColumns(node, graph, tables, tableAliases);
    if (joinColumns.length > 0) {
      const joinType = node.label.split(' ')[0]; // Extract just "INNER", "LEFT", etc.
      lines.push(joinType + ' JOIN');
      lines.push('─────────');
      joinColumns.forEach(col => lines.push(col));
      
      // Extract ON clause from node.sql if available
      if (node.sql) {
        const onMatch = node.sql.match(/ON\s+(.+)$/i);
        if (onMatch) {
          lines.push('─────────');
          lines.push('ON ' + onMatch[1]);
        }
      }
      return lines;
    }
  }
  
  // Format node with schema information if available
  if (schemaColumns && schemaColumns.length > 0) {
    if (node.kind === 'op' && (node.label === 'SELECT' || node.label === 'GROUP BY')) {
      lines.push(label);
      lines.push('─────────');
      schemaColumns.forEach(col => lines.push(col));
      return lines;
    } else if (node.kind === 'relation') {
      lines.push(label);
      lines.push('─────────');
      schemaColumns.forEach(col => lines.push(col));
      return lines;
    } else if (node.kind === 'op' && node.label.includes('UNION')) {
      lines.push(label);
      lines.push('─────────');
      schemaColumns.forEach(col => lines.push(col));
      return lines;
    } else if (node.kind === 'op' && node.label === 'FROM') {
      lines.push(label);
      lines.push('─────────');
      schemaColumns.forEach(col => lines.push(col));
      return lines;
    }
  }
  
  // Add SQL parameter if available (for WHERE, HAVING, etc.)
  if (node.sql && node.kind === 'clause') {
    if (node.label === 'WHERE') {
      lines.push(label);
      lines.push('─────────');
      // Format WHERE expressions with line breaks for AND/OR
      const formatted = formatWhereExpression(node.sql);
      formatted.split('\n').forEach(line => lines.push(line));
      return lines;
    }
    lines.push(label);
    lines.push('─────────');
    lines.push(sql || '');
    return lines;
  }
  
  switch (kind) {
    case 'subquery':
      lines.push(`[${label}]`);  // Add brackets to indicate subquery
      return lines;
    case 'op':
      // Always show SQL details if available
      if (sql && (
        label === 'FROM' || 
        label === 'SELECT' || 
        label === 'ORDER BY' || 
        label === 'GROUP BY' || 
        label === 'LIMIT' ||
        label === 'OFFSET' ||
        label.includes('JOIN') ||
        label === 'CREATE TABLE'
      )) {
        // For FROM, just show the SQL
        if (label === 'FROM') {
          lines.push(sql);
          return lines;
        }
        // For CREATE TABLE, show label and table name
        if (label === 'CREATE TABLE') {
          lines.push(label);
          lines.push('─────────');
          lines.push(sql);
          return lines;
        }
        // For others, show both label and SQL
        lines.push(`${label} ${sql}`);
        return lines;
      }
      lines.push(label);
      return lines;
    case 'clause':
      // Already handled above
      lines.push(label);
      return lines;
    default:
      lines.push(label);
      return lines;
  }
};

const flattenGraph = (graph: Graph): Graph => {
  const flatNodes: Node[] = [];
  const flatEdges: Edge[] = [];
  const subqueryMapping = new Map<string, string>(); // Maps old subquery node ID to its result node ID
  
  // Process each node
  graph.nodes.forEach(node => {
    if (node.kind === 'subquery') {
      const subqueryNode = node as SubqueryNode;
      if (subqueryNode.innerGraph) {
        // Recursively flatten inner graph
        const innerFlat = flattenGraph(subqueryNode.innerGraph);
        
        // Add inner nodes with prefixed IDs
        innerFlat.nodes.forEach(innerNode => {
          flatNodes.push({
            ...innerNode,
            id: `${node.id}_${innerNode.id}`
          });
        });
        
        // Add inner edges with prefixed IDs
        innerFlat.edges.forEach(innerEdge => {
          flatEdges.push({
            ...innerEdge,
            id: `${node.id}_${innerEdge.id}`,
            from: { ...innerEdge.from, node: `${node.id}_${innerEdge.from.node}` },
            to: { ...innerEdge.to, node: `${node.id}_${innerEdge.to.node}` }
          });
        });
        
        // Find first inner node (node with no incoming edges)
        const firstInnerNode = innerFlat.nodes.find(n => 
          !innerFlat.edges.some(e => e.to.node === n.id)
        );
        
        // Find result node and map it
        const resultNode = findSubqueryResultNode(subqueryNode.innerGraph);
        if (resultNode) {
          subqueryMapping.set(node.id, `${node.id}_${resultNode.id}`);
        }
        
        // Create a mapping for edges that point TO this subquery
        // They should now point to the first inner node
        if (firstInnerNode) {
          subqueryMapping.set(node.id + '_to', `${node.id}_${firstInnerNode.id}`);
        }
      } else {
        // Simple subquery without inner graph
        flatNodes.push(node);
      }
    } else {
      flatNodes.push(node);
    }
  });
  
  // Process edges, updating references to subquery nodes
  graph.edges.forEach(edge => {
    // Skip subquery result edges as they're handled internally
    if (edge.kind === 'subqueryResult') {
      return;
    }
    
    let fromNode = edge.from.node;
    let toNode = edge.to.node;
    
    // Update references if they point to subquery nodes
    if (subqueryMapping.has(fromNode)) {
      fromNode = subqueryMapping.get(fromNode)!;
    }
    // For edges pointing TO a subquery, check if we have a label mapping
    if (subqueryMapping.has(toNode + '_to')) {
      toNode = subqueryMapping.get(toNode + '_to')!;
    } else if (subqueryMapping.has(toNode)) {
      toNode = subqueryMapping.get(toNode)!;
    }
    
    flatEdges.push({
      ...edge,
      from: { ...edge.from, node: fromNode },
      to: { ...edge.to, node: toNode }
    });
  });
  
  return {
    nodes: flatNodes,
    edges: flatEdges,
    snapshots: graph.snapshots
  };
};