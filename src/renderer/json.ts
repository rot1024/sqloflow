import type { Graph } from '../types/ir.js';

export const renderJson = (graph: Graph): string => {
  return JSON.stringify(graph, null, 2);
};