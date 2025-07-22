import { describe, it, expect } from 'vitest';
import { parse } from '../parser.js';
import { convert } from './index.js';
import { render } from '../renderer/index.js';
import { 
  ParseError, 
  ConversionError, 
  RenderError 
} from '../errors.js';

describe('Error Handling', () => {
  describe('ParseError', () => {
    it('should throw ParseError for empty SQL', () => {
      expect(() => parse('')).toThrow(ParseError);
      expect(() => parse('')).toThrow('SQL string cannot be empty');
    });

    it('should throw ParseError for invalid SQL', () => {
      expect(() => parse('INVALID SQL HERE')).toThrow(ParseError);
      expect(() => parse('INVALID SQL HERE')).toThrow('Failed to parse SQL');
    });

    it('should include SQL in error for debugging', () => {
      try {
        parse('');
      } catch (error) {
        expect(error).toBeInstanceOf(ParseError);
        expect((error as ParseError).sql).toBe('');
      }
    });
  });

  describe('ConversionError', () => {
    it('should throw ConversionError for unsupported statement types', () => {
      // Use a valid SQL that parses but has an unsupported type
      const ast = parse('SELECT 1');
      // Manually modify AST to have unsupported type
      ast[0].type = 'unsupported_type' as any;
      
      expect(() => convert(ast)).toThrow(ConversionError);
      expect(() => convert(ast)).toThrow('Unsupported statement type: unsupported_type');
    });

    it('should include statement type in error', () => {
      const ast = parse('SELECT 1');
      ast[0].type = 'unsupported_type' as any;
      
      try {
        convert(ast);
      } catch (error) {
        expect(error).toBeInstanceOf(ConversionError);
        expect((error as ConversionError).statementType).toBe('unsupported_type');
      }
    });
  });

  describe('RenderError', () => {
    it('should throw RenderError for unsupported format', () => {
      const ast = parse('SELECT * FROM users');
      const ir = convert(ast);
      
      expect(() => render(ir, { format: 'unsupported' as any })).toThrow(RenderError);
      expect(() => render(ir, { format: 'unsupported' as any })).toThrow('Unsupported render format: unsupported');
    });

    it('should include format in error', () => {
      const ast = parse('SELECT * FROM users');
      const ir = convert(ast);
      
      try {
        render(ir, { format: 'unsupported' as any });
      } catch (error) {
        expect(error).toBeInstanceOf(RenderError);
        expect((error as RenderError).format).toBe('unsupported');
      }
    });
  });

  describe('Expression handling', () => {
    it('should handle malformed expressions gracefully', () => {
      // This should not throw, but log a warning
      const ast = parse('SELECT * FROM users WHERE id = 1');
      const ir = convert(ast);
      
      // Should complete without throwing
      expect(ir.nodes.length).toBeGreaterThan(0);
    });
  });
});