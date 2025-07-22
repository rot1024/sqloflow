import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { convert } from '../converter/index.js';
import { render } from './index.js';
import type { RenderOptions } from '../types/renderer.js';

describe('render', () => {
  it('should delegate to JSON renderer with json format', () => {
    const sql = 'SELECT id FROM users';
    const ast = parse(sql);
    const ir = convert(ast);
    
    const options: RenderOptions = {
      format: 'json',
      jsonViewType: 'operation'
    };
    
    const result = render(ir, options);
    const json = JSON.parse(result);
    
    expect(json.view).toBe('operation');
    expect(json.nodes).toBeDefined();
    expect(json.edges).toBeDefined();
  });

  it('should delegate to Mermaid renderer with mermaid format', () => {
    const sql = 'SELECT id FROM users';
    const ast = parse(sql);
    const ir = convert(ast);
    
    const options: RenderOptions = {
      format: 'mermaid'
    };
    
    const result = render(ir, options);
    
    expect(result).toContain('flowchart LR');
    expect(result).toContain('SELECT');
  });

  it('should throw error for unsupported format', () => {
    const sql = 'SELECT id FROM users';
    const ast = parse(sql);
    const ir = convert(ast);
    
    const options = {
      format: 'unknown'
    } as any;
    
    expect(() => render(ir, options)).toThrow('Unsupported render format');
  });
});