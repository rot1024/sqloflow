export type RenderFormat = 'json' | 'mermaid' | 'ascii' | 'dot';

export type JsonViewType = 'operation' | 'schema';

export interface RenderOptions {
  format: RenderFormat;
  jsonViewType?: JsonViewType;
}