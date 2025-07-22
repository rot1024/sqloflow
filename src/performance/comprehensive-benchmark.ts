#!/usr/bin/env node

import { parse } from '../parser.js';
import { convert } from '../converter/index.js';
import { render } from '../renderer/index.js';
import { clearExpressionCache, getExpressionCacheStats } from '../converter/cached-helpers.js';

// Test cases of varying complexity
const testCases = {
  simple: 'SELECT * FROM users',
  
  medium: `
    SELECT u.name, u.email, COUNT(o.id) as order_count
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.created_at > '2024-01-01'
    GROUP BY u.id, u.name, u.email
    ORDER BY order_count DESC
    LIMIT 10
  `,
  
  complex: `
    WITH monthly_sales AS (
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        SUM(total) as total_sales,
        COUNT(*) as order_count
      FROM orders
      WHERE status = 'completed'
      GROUP BY DATE_TRUNC('month', created_at)
    ),
    top_products AS (
      SELECT 
        p.id,
        p.name,
        SUM(oi.quantity * oi.unit_price) as revenue
      FROM products p
      JOIN order_items oi ON p.id = oi.product_id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status = 'completed'
      GROUP BY p.id, p.name
      ORDER BY revenue DESC
      LIMIT 10
    )
    SELECT 
      ms.month,
      ms.total_sales,
      ms.order_count,
      tp.name as top_product,
      tp.revenue as top_product_revenue
    FROM monthly_sales ms
    CROSS JOIN top_products tp
    ORDER BY ms.month DESC, tp.revenue DESC
  `,
  
  subqueryHeavy: `
    SELECT 
      u.id,
      u.name,
      (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as order_count,
      (SELECT AVG(total) FROM orders WHERE user_id = u.id) as avg_order_value,
      (SELECT MAX(created_at) FROM orders WHERE user_id = u.id) as last_order_date
    FROM users u
    WHERE EXISTS (
      SELECT 1 FROM orders o
      WHERE o.user_id = u.id
      AND o.total > (
        SELECT AVG(total) * 2 FROM orders
        WHERE created_at > DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY)
      )
    )
    AND u.id IN (
      SELECT DISTINCT user_id 
      FROM user_segments 
      WHERE segment_id IN (
        SELECT id FROM segments WHERE name IN ('Premium', 'VIP')
      )
    )
  `
};

function runBenchmark(name: string, sql: string, iterations: number = 100) {
  console.log(`\n=== ${name} ===`);
  
  // Parse once to get AST
  const ast = parse(sql);
  
  // Warm up
  for (let i = 0; i < 10; i++) {
    convert(ast);
  }
  
  // Clear cache before benchmark
  clearExpressionCache();
  
  // Benchmark conversion
  const startTime = performance.now();
  let memoryStart = process.memoryUsage().heapUsed;
  
  for (let i = 0; i < iterations; i++) {
    convert(ast);
  }
  
  const totalTime = performance.now() - startTime;
  const memoryUsed = process.memoryUsage().heapUsed - memoryStart;
  const avgTime = totalTime / iterations;
  
  // Get cache stats
  const cacheStats = getExpressionCacheStats();
  
  console.log(`Average conversion time: ${avgTime.toFixed(3)}ms`);
  console.log(`Total time for ${iterations} iterations: ${totalTime.toFixed(2)}ms`);
  console.log(`Memory used: ${(memoryUsed / 1024 / 1024).toFixed(2)}MB`);
  console.log(`Cache stats: ${cacheStats.hits} hits, ${cacheStats.misses} misses (${(cacheStats.hitRate * 100).toFixed(1)}% hit rate)`);
  
  // Benchmark full pipeline
  console.log('\nFull pipeline (parse + convert + render):');
  const pipelineStart = performance.now();
  
  for (let i = 0; i < iterations; i++) {
    const ast = parse(sql);
    const ir = convert(ast);
    render(ir, { format: 'dot' });
  }
  
  const pipelineTime = performance.now() - pipelineStart;
  console.log(`Average time: ${(pipelineTime / iterations).toFixed(3)}ms`);
  
  return {
    name,
    avgConversionTime: avgTime,
    avgPipelineTime: pipelineTime / iterations,
    cacheHitRate: cacheStats.hitRate
  };
}

// Run all benchmarks
console.log('SQLOFlow Comprehensive Performance Benchmark');
console.log('==========================================');

const results = Object.entries(testCases).map(([name, sql]) => 
  runBenchmark(name, sql)
);

// Summary
console.log('\n=== Summary ===');
console.log('Query Complexity | Avg Conversion | Avg Pipeline | Cache Hit Rate');
console.log('-----------------|----------------|--------------|----------------');
results.forEach(r => {
  console.log(
    `${r.name.padEnd(16)} | ${r.avgConversionTime.toFixed(3).padStart(11)}ms | ${r.avgPipelineTime.toFixed(3).padStart(10)}ms | ${(r.cacheHitRate * 100).toFixed(1).padStart(13)}%`
  );
});

// Performance recommendations
console.log('\n=== Performance Recommendations ===');
const avgCacheHitRate = results.reduce((sum, r) => sum + r.cacheHitRate, 0) / results.length;
if (avgCacheHitRate > 0.5) {
  console.log('✅ Expression caching is effective (>50% hit rate)');
} else {
  console.log('⚠️  Expression caching shows low hit rate, consider optimizing cache key generation');
}

const complexQueryTime = results.find(r => r.name === 'complex')?.avgConversionTime || 0;
if (complexQueryTime < 1) {
  console.log('✅ Complex query conversion is fast (<1ms)');
} else {
  console.log('⚠️  Complex query conversion is slow (>1ms), consider further optimizations');
}