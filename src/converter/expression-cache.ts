/**
 * Expression SQL conversion cache to avoid redundant conversions
 */

export class ExpressionCache {
  private cache = new Map<string, string>();
  private hits = 0;
  private misses = 0;

  /**
   * Get cached SQL for an expression
   */
  get(expr: any): string | undefined {
    const key = this.getKey(expr);
    const result = this.cache.get(key);
    if (result) {
      this.hits++;
    } else {
      this.misses++;
    }
    return result;
  }

  /**
   * Set cached SQL for an expression
   */
  set(expr: any, sql: string): void {
    const key = this.getKey(expr);
    this.cache.set(key, sql);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits / (this.hits + this.misses) || 0
    };
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Generate a unique key for an expression
   */
  private getKey(expr: any): string {
    if (!expr) return 'null';
    
    // Simple expressions
    if (typeof expr === 'string') return `str:${expr}`;
    if (typeof expr === 'number') return `num:${expr}`;
    if (typeof expr === 'boolean') return `bool:${expr}`;
    
    // Complex expressions - create a deterministic key
    if (expr.type) {
      switch (expr.type) {
        case 'column_ref':
          return `col:${expr.table || ''}.${expr.column}`;
        case 'number':
        case 'string':
        case 'bool':
          return `${expr.type}:${expr.value}`;
        case 'binary_expr':
          return `bin:${this.getKey(expr.left)}${expr.operator}${this.getKey(expr.right)}`;
        case 'function':
        case 'aggr_func':
          const funcName = typeof expr.name === 'string' ? expr.name : 'func';
          return `${expr.type}:${funcName}`;
        default:
          // For other types, use JSON serialization as fallback
          try {
            return `json:${JSON.stringify(expr)}`;
          } catch {
            return `unknown:${expr.type || 'no-type'}`;
          }
      }
    }
    
    return 'unknown';
  }
}