import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { readFileSync, unlinkSync, existsSync } from 'fs';

const cliPath = './src/cli.ts';

describe('CLI', () => {
  it('should show help with --help flag', () => {
    const result = spawnSync('npx', ['tsx', cliPath, '--help'], {
      encoding: 'utf8'
    });
    
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('sqloflow - SQL visualization tool');
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('Options:');
  });

  it('should show help with -h flag', () => {
    const result = spawnSync('npx', ['tsx', cliPath, '-h'], {
      encoding: 'utf8'
    });
    
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('sqloflow - SQL visualization tool');
  });

  it('should output mermaid by default', () => {
    const sql = 'SELECT id, name FROM users';
    const result = spawnSync('npx', ['tsx', cliPath, sql], {
      encoding: 'utf8'
    });
    
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('flowchart LR');
    expect(result.stdout).toContain('users');
    expect(result.stdout).toContain('SELECT');
  });

  it('should output JSON with -f json', () => {
    const sql = 'SELECT id, name FROM users';
    const result = spawnSync('npx', ['tsx', cliPath, '-f', 'json', sql], {
      encoding: 'utf8'
    });
    
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.nodes).toBeDefined();
    expect(json.edges).toBeDefined();
  });


  it('should read from stdin', () => {
    const sql = 'SELECT * FROM products WHERE price > 100';
    const result = spawnSync('npx', ['tsx', cliPath], {
      encoding: 'utf8',
      input: sql
    });
    
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('flowchart LR');
    expect(result.stdout).toContain('products');
  });

  it('should output to file with -o', () => {
    const sql = 'SELECT id FROM users';
    const outputFile = './test-output.md';
    
    // Remove file if exists
    if (existsSync(outputFile)) {
      unlinkSync(outputFile);
    }
    
    const result = spawnSync('npx', ['tsx', cliPath, '-o', outputFile, sql], {
      encoding: 'utf8'
    });
    
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`Output written to ${outputFile}`);
    
    const content = readFileSync(outputFile, 'utf8');
    expect(content).toContain('flowchart LR');
    
    // Clean up
    unlinkSync(outputFile);
  });

  it('should error on invalid SQL', () => {
    const sql = 'INVALID SQL QUERY';
    const result = spawnSync('npx', ['tsx', cliPath, sql], {
      encoding: 'utf8'
    });
    
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Error:');
  });

  it('should error on invalid format', () => {
    const sql = 'SELECT * FROM users';
    const result = spawnSync('npx', ['tsx', cliPath, '-f', 'invalid', sql], {
      encoding: 'utf8'
    });
    
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid format: invalid');
  });

  it('should error when no SQL provided', () => {
    const result = spawnSync('npx', ['tsx', cliPath], {
      encoding: 'utf8'
    });
    
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No SQL provided');
  });

  it('should use different dialect with -d', () => {
    const sql = 'SELECT * FROM users LIMIT 10';
    const result = spawnSync('npx', ['tsx', cliPath, '-d', 'mysql', sql], {
      encoding: 'utf8'
    });
    
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('flowchart LR');
  });
});