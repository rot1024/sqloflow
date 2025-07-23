#!/usr/bin/env node

import { parse } from '../parser.js';
import { benchmark, formatBenchmarkResult, TEST_CASES } from './benchmark.js';
import type { BenchmarkResult } from './benchmark.js';

console.log('Running SQLOFlow Performance Benchmarks...\n');

const results: BenchmarkResult[] = [];

// Warm-up run
parse('SELECT 1');

for (const testCase of TEST_CASES) {
  // Run each benchmark 5 times and take the average
  const runs: BenchmarkResult[] = [];
  
  for (let i = 0; i < 5; i++) {
    runs.push(benchmark(testCase.sql, testCase.name));
  }
  
  // Calculate average
  const avgResult: BenchmarkResult = {
    name: testCase.name,
    totalTime: runs.reduce((sum, r) => sum + r.totalTime, 0) / runs.length,
    parseTime: runs.reduce((sum, r) => sum + r.parseTime, 0) / runs.length,
    convertTime: runs.reduce((sum, r) => sum + r.convertTime, 0) / runs.length,
    renderTime: runs.reduce((sum, r) => sum + r.renderTime, 0) / runs.length,
    memoryUsed: runs.reduce((sum, r) => sum + r.memoryUsed, 0) / runs.length
  };
  
  results.push(avgResult);
  console.log(formatBenchmarkResult(avgResult));
}

// Summary
console.log('\nSummary:');
console.log('--------');
const totalConvertTime = results.reduce((sum, r) => sum + r.convertTime, 0);
const avgConvertTime = totalConvertTime / results.length;
console.log(`Average conversion time: ${avgConvertTime.toFixed(2)}ms`);

// Find slowest phase
const avgParseTime = results.reduce((sum, r) => sum + r.parseTime, 0) / results.length;
const avgRenderTime = results.reduce((sum, r) => sum + r.renderTime, 0) / results.length;

const phases = [
  { name: 'Parse', time: avgParseTime },
  { name: 'Convert', time: avgConvertTime },
  { name: 'Render', time: avgRenderTime }
];

const slowest = phases.sort((a, b) => b.time - a.time)[0];
console.log(`Slowest phase: ${slowest.name} (${slowest.time.toFixed(2)}ms average)`);