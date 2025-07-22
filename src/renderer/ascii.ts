import type { Graph, Node, Edge } from '../types/ir.js';

interface Position {
  x: number;
  y: number;
}

interface LayoutNode {
  node: Node;
  pos: Position;
  width: number;
  height: number;
}

export const renderAscii = (graph: Graph): string => {
  // Handle empty graph
  if (graph.nodes.length === 0) {
    return '';
  }
  
  // Simple left-to-right layout for now
  const layout = calculateLayout(graph);
  const canvas = renderToCanvas(layout, graph.edges);
  return canvas;
};

const calculateLayout = (graph: Graph): Map<string, LayoutNode> => {
  const layout = new Map<string, LayoutNode>();
  const nodesByLevel = groupNodesByLevel(graph);
  
  let currentX = 0;
  const levelSpacing = 4;
  const nodeSpacing = 2;
  
  nodesByLevel.forEach((nodes, level) => {
    let currentY = 0;
    nodes.forEach(node => {
      const width = Math.max(node.label.length + 4, 10);
      const height = 3;
      
      layout.set(node.id, {
        node,
        pos: { x: currentX, y: currentY },
        width,
        height
      });
      
      currentY += height + nodeSpacing;
    });
    
    currentX += Math.max(...nodes.map(n => Math.max(n.label.length + 4, 10))) + levelSpacing;
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

const renderToCanvas = (layout: Map<string, LayoutNode>, edges: Edge[]): string => {
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
  const { pos, width, height, node } = layoutNode;
  const { x, y } = pos;
  
  // Top border
  canvas[y][x] = '┌';
  for (let i = 1; i < width - 1; i++) {
    canvas[y][x + i] = '─';
  }
  canvas[y][x + width - 1] = '┐';
  
  // Middle with text
  canvas[y + 1][x] = '│';
  const text = node.label.substring(0, width - 4);
  const padding = Math.floor((width - 2 - text.length) / 2);
  for (let i = 0; i < width - 2; i++) {
    if (i >= padding && i < padding + text.length) {
      canvas[y + 1][x + 1 + i] = text[i - padding];
    } else {
      canvas[y + 1][x + 1 + i] = ' ';
    }
  }
  canvas[y + 1][x + width - 1] = '│';
  
  // Bottom border
  canvas[y + 2][x] = '└';
  for (let i = 1; i < width - 1; i++) {
    canvas[y + 2][x + i] = '─';
  }
  canvas[y + 2][x + width - 1] = '┘';
};

const drawEdge = (canvas: string[][], from: LayoutNode, to: LayoutNode) => {
  // Simple arrow from right side of 'from' to left side of 'to'
  const fromX = from.pos.x + from.width;
  const fromY = from.pos.y + 1;
  const toX = to.pos.x - 1;
  const toY = to.pos.y + 1;
  
  // Draw horizontal line
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