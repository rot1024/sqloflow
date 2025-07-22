#!/usr/bin/env node

import { parse } from '../parser.js';
import { convertSelectStatement } from '../converter/statement-converters.js';
import { convertSelectStatementOptimized } from '../converter/optimized-converter.js';
import { createContext } from '../converter/context.js';
import type { Select } from 'node-sql-parser';

const testSQL = `
  SELECT u.name, o.total, 
    (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as order_count,
    (SELECT AVG(amount) FROM payments WHERE order_id = o.id) as avg_payment
  FROM users u
  JOIN orders o ON u.id = o.user_id
  WHERE o.total > (
    SELECT AVG(total) FROM orders 
    WHERE created_at > '2024-01-01'
  )
  AND EXISTS (
    SELECT 1 FROM order_items oi
    WHERE oi.order_id = o.id
    AND oi.product_id IN (
      SELECT id FROM products WHERE category = 'Electronics'
    )
  )
  GROUP BY u.id, o.id
  HAVING COUNT(o.id) > 5
  ORDER BY o.total DESC
  LIMIT 10
`;

console.log('Parsing SQL...');
const ast = parse(testSQL);
const selectStmt = ast[0] as Select;

console.log('\nRunning performance comparison...\n');

// Warm up
const warmupCtx = createContext({ tables: {} });
convertSelectStatement(warmupCtx, selectStmt);

// Test original implementation
console.log('Testing original implementation:');
let totalOriginal = 0;
for (let i = 0; i < 1000; i++) {
  const ctx = createContext({ tables: {} });
  const start = performance.now();
  convertSelectStatement(ctx, selectStmt);
  totalOriginal += performance.now() - start;
}
const avgOriginal = totalOriginal / 1000;
console.log(`Average time: ${avgOriginal.toFixed(3)}ms`);

// Test optimized implementation
console.log('\nTesting optimized implementation:');
let totalOptimized = 0;
for (let i = 0; i < 1000; i++) {
  const ctx = createContext({ tables: {} });
  const start = performance.now();
  convertSelectStatementOptimized(ctx, selectStmt);
  totalOptimized += performance.now() - start;
}
const avgOptimized = totalOptimized / 1000;
console.log(`Average time: ${avgOptimized.toFixed(3)}ms`);

// Results
console.log('\n=== Results ===');
console.log(`Original:  ${avgOriginal.toFixed(3)}ms`);
console.log(`Optimized: ${avgOptimized.toFixed(3)}ms`);
const improvement = ((avgOriginal - avgOptimized) / avgOriginal) * 100;
console.log(`Improvement: ${improvement.toFixed(1)}%`);

if (improvement > 0) {
  console.log(`✅ Optimization successful! ${improvement.toFixed(1)}% faster`);
} else {
  console.log(`❌ Optimization did not improve performance`);
}