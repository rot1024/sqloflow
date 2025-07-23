import { describe, it, expect, vi } from 'vitest';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { parseArgs, runCli } from './cli.js';

describe('CLI', () => {
  describe('parseArgs', () => {
    it('should parse help flags', () => {
      const { options: options1 } = parseArgs(['--help']);
      expect(options1.help).toBe(true);
      
      const { options: options2 } = parseArgs(['-h']);
      expect(options2.help).toBe(true);
    });
    
    it('should parse format option', () => {
      const { options } = parseArgs(['-f', 'json', 'SELECT * FROM users']);
      expect(options.format).toBe('json');
    });
    
    it('should parse output option', () => {
      const { options } = parseArgs(['-o', 'output.md', 'SELECT * FROM users']);
      expect(options.output).toBe('output.md');
    });
    
    it('should parse dialect option', () => {
      const { options } = parseArgs(['-d', 'mysql', 'SELECT * FROM users']);
      expect(options.dialect).toBe('mysql');
    });
    
    it('should parse SQL argument', () => {
      const { sql } = parseArgs(['SELECT * FROM users']);
      expect(sql).toBe('SELECT * FROM users');
    });
    
    it('should throw on invalid format', () => {
      expect(() => parseArgs(['-f', 'invalid'])).toThrow('Invalid format: invalid');
    });
    
    it('should throw on invalid dialect', () => {
      expect(() => parseArgs(['-d', 'invalid'])).toThrow('Invalid dialect: invalid');
    });
  });
  
  describe('runCli', () => {
    it('should show help with --help flag', async () => {
      const log = vi.fn();
      const exit = vi.fn();
      
      await runCli(['--help'], { log, exit });
      
      expect(exit).toHaveBeenCalledWith(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('sqloflow - SQL visualization tool'));
    });
    
    it('should show help with -h flag', async () => {
      const log = vi.fn();
      const exit = vi.fn();
      
      await runCli(['-h'], { log, exit });
      
      expect(exit).toHaveBeenCalledWith(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('sqloflow - SQL visualization tool'));
    });
    
    it('should output mermaid by default', async () => {
      const log = vi.fn();
      const error = vi.fn();
      const exit = vi.fn();
      
      await runCli(['SELECT id, name FROM users'], { log, error, exit });
      
      expect(exit).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('flowchart LR'));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('users'));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('SELECT'));
    });
    
    it('should output JSON with -f json', async () => {
      const log = vi.fn();
      const error = vi.fn();
      const exit = vi.fn();
      
      await runCli(['-f', 'json', 'SELECT id, name FROM users'], { log, error, exit });
      
      expect(exit).not.toHaveBeenCalled();
      const output = log.mock.calls[0][0];
      const json = JSON.parse(output);
      expect(json.nodes).toBeDefined();
      expect(json.edges).toBeDefined();
    });
    
    it('should read from stdin', async () => {
      const log = vi.fn();
      const error = vi.fn();
      const exit = vi.fn();
      const stdin = 'SELECT * FROM products WHERE price > 100';
      
      await runCli([], { stdin, log, error, exit });
      
      expect(exit).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('flowchart LR'));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('products'));
    });
    
    it('should output to file with -o', async () => {
      const log = vi.fn();
      const error = vi.fn();
      const exit = vi.fn();
      const outputFile = './test-output.md';
      
      // Remove file if exists
      if (existsSync(outputFile)) {
        unlinkSync(outputFile);
      }
      
      await runCli(['-o', outputFile, 'SELECT id FROM users'], { log, error, exit });
      
      expect(exit).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(`Output written to ${outputFile}`);
      expect(log).not.toHaveBeenCalled();
      
      const content = readFileSync(outputFile, 'utf8');
      expect(content).toContain('flowchart LR');
      
      // Clean up
      unlinkSync(outputFile);
    });
    
    it('should error on invalid SQL', async () => {
      const log = vi.fn();
      const error = vi.fn();
      const exit = vi.fn();
      
      await runCli(['INVALID SQL QUERY'], { log, error, exit });
      
      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Error:'));
    });
    
    it('should error on invalid format', async () => {
      const log = vi.fn();
      const error = vi.fn();
      const exit = vi.fn();
      
      try {
        await runCli(['-f', 'invalid', 'SELECT * FROM users'], { log, error, exit });
      } catch (err) {
        // parseArgs throws before runCli can handle it
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('Invalid format: invalid');
      }
    });
    
    it('should error when no SQL provided', async () => {
      const log = vi.fn();
      const error = vi.fn();
      const exit = vi.fn();
      
      await runCli([], { log, error, exit, isTTY: true });
      
      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledWith('Error: No SQL provided. Use -h for help.');
    });
    
    it('should error when empty SQL provided', async () => {
      const log = vi.fn();
      const error = vi.fn();
      const exit = vi.fn();
      
      await runCli(['  '], { log, error, exit });
      
      expect(exit).toHaveBeenCalledWith(1);
      expect(error).toHaveBeenCalledWith('Error: No SQL provided. Use -h for help.');
    });
    
    it('should use different dialect with -d', async () => {
      const log = vi.fn();
      const error = vi.fn();
      const exit = vi.fn();
      
      await runCli(['-d', 'mysql', 'SELECT * FROM users LIMIT 10'], { log, error, exit });
      
      expect(exit).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('flowchart LR'));
    });
  });
});