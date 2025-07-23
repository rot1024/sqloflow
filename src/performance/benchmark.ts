import { parse } from '../parser.js';
import { convert } from '../converter/index.js';
import { render } from '../renderer/index.js';

export interface BenchmarkResult {
  name: string;
  totalTime: number;
  parseTime: number;
  convertTime: number;
  renderTime: number;
  memoryUsed: number;
}

export function benchmark(sql: string, name: string): BenchmarkResult {
  const startMemory = process.memoryUsage().heapUsed;
  const startTotal = performance.now();
  
  // Parse phase
  const startParse = performance.now();
  const ast = parse(sql);
  const parseTime = performance.now() - startParse;
  
  // Convert phase
  const startConvert = performance.now();
  const ir = convert(ast);
  const convertTime = performance.now() - startConvert;
  
  // Render phase
  const startRender = performance.now();
  render(ir, { format: 'dot' });
  const renderTime = performance.now() - startRender;
  
  const totalTime = performance.now() - startTotal;
  const memoryUsed = process.memoryUsage().heapUsed - startMemory;
  
  return {
    name,
    totalTime,
    parseTime,
    convertTime,
    renderTime,
    memoryUsed
  };
}

export function formatBenchmarkResult(result: BenchmarkResult): string {
  return `
Benchmark: ${result.name}
--------------------------
Total Time: ${result.totalTime.toFixed(2)}ms
  Parse:    ${result.parseTime.toFixed(2)}ms (${((result.parseTime / result.totalTime) * 100).toFixed(1)}%)
  Convert:  ${result.convertTime.toFixed(2)}ms (${((result.convertTime / result.totalTime) * 100).toFixed(1)}%)
  Render:   ${result.renderTime.toFixed(2)}ms (${((result.renderTime / result.totalTime) * 100).toFixed(1)}%)
Memory:     ${(result.memoryUsed / 1024 / 1024).toFixed(2)}MB
`;
}

export const TEST_CASES = [
  {
    name: 'Simple SELECT',
    sql: 'SELECT * FROM users WHERE id = 1'
  },
  {
    name: 'Complex JOIN',
    sql: `
      SELECT u.name, o.total, p.name as product
      FROM users u
      JOIN orders o ON u.id = o.user_id
      JOIN order_items oi ON o.id = oi.order_id
      JOIN products p ON oi.product_id = p.id
      WHERE o.created_at > '2024-01-01'
      GROUP BY u.id, p.id
      HAVING SUM(oi.quantity) > 10
      ORDER BY o.total DESC
      LIMIT 100
    `
  },
  {
    name: 'Nested Subqueries',
    sql: `
      SELECT * FROM orders o
      WHERE o.total > (
        SELECT AVG(total) FROM orders
        WHERE customer_id IN (
          SELECT id FROM customers
          WHERE country = 'US'
          AND created_at > (
            SELECT MAX(created_at) - INTERVAL '1 year'
            FROM customers
          )
        )
      )
    `
  },
  {
    name: 'CTE with Multiple References',
    sql: `
      WITH regional_sales AS (
        SELECT region, SUM(amount) as total
        FROM orders
        GROUP BY region
      ),
      top_regions AS (
        SELECT region
        FROM regional_sales
        WHERE total > (SELECT AVG(total) FROM regional_sales)
      )
      SELECT r.region, r.total, t.region as is_top
      FROM regional_sales r
      LEFT JOIN top_regions t ON r.region = t.region
    `
  }
];