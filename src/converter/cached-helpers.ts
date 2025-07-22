/**
 * Cached version of expression conversion helpers
 */

import { ExpressionCache } from './expression-cache.js';
import { expressionToSQL as originalExpressionToSQL } from './helpers.js';

// Global cache instance (can be cleared between conversions if needed)
const expressionCache = new ExpressionCache();

/**
 * Cached version of expressionToSQL
 */
export const expressionToSQL = (expr: any): string => {
  if (!expr) return '';
  
  // Check cache first
  const cached = expressionCache.get(expr);
  if (cached !== undefined) {
    return cached;
  }
  
  // Not in cache, compute and cache
  const result = originalExpressionToSQL(expr);
  expressionCache.set(expr, result);
  return result;
};

/**
 * Clear the expression cache (useful between different SQL conversions)
 */
export const clearExpressionCache = (): void => {
  expressionCache.clear();
};

/**
 * Get cache statistics for performance monitoring
 */
export const getExpressionCacheStats = () => {
  return expressionCache.getStats();
};

// Re-export other helpers that don't need caching
export {
  createNode,
  createEdge,
  getTableLabel,
  getTableName,
  selectListToSQL,
  getColumnName,
  groupByToSQL,
  orderByToSQL,
  limitToSQL,
  tableToSQL,
  joinToSQL,
  detectSubqueryInExpression
} from './helpers.js';