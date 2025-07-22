export type RenderFormat = 'json' | 'mermaid' | 'ascii' | 'dot';

export interface RenderOptions {
  format: RenderFormat;
}