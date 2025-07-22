import type { Graph } from '../types/ir.js';
import type { RenderOptions } from '../types/renderer.js';
import { RenderError } from '../errors.js';
import { renderJson } from './json.js';
import { renderMermaid } from './mermaid.js';
import { renderAscii } from './ascii.js';
import { renderDot } from './dot.js';

export const render = (graph: Graph, options: RenderOptions): string => {
  switch (options.format) {
    case 'json':
      return renderJson(graph);
    case 'mermaid':
      return renderMermaid(graph);
    case 'ascii':
      return renderAscii(graph);
    case 'dot':
      return renderDot(graph);
    default:
      throw new RenderError(`Unsupported render format: ${options.format}`, options.format);
  }
};