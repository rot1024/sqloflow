import { describe, it, expect } from 'vitest';
import {
  formatWhereExpression,
  formatWhereExpressionMermaid,
  formatWhereExpressionDot
} from './expression-formatter.js';

describe('Expression Formatter', () => {
  describe('formatWhereExpression', () => {
    it('should not format short expressions', () => {
      const expr = 'id = 1';
      expect(formatWhereExpression(expr)).toBe(expr);
    });

    it('should format simple AND expressions', () => {
      const expr = 'status = "active" AND created_at > "2023-01-01" AND deleted = false';
      const formatted = formatWhereExpression(expr);
      expect(formatted).toBe(
        'status = "active"\n' +
        'AND\n' +
        'created_at > "2023-01-01"\n' +
        'AND\n' +
        'deleted = false'
      );
    });

    it('should format simple OR expressions', () => {
      const expr = 'category = "electronics" OR category = "computers" OR category = "phones"';
      const formatted = formatWhereExpression(expr);
      expect(formatted).toBe(
        'category = "electronics"\n' +
        'OR\n' +
        'category = "computers"\n' +
        'OR\n' +
        'category = "phones"'
      );
    });

    it('should format mixed AND/OR expressions', () => {
      const expr = 'status = "active" AND (category = "electronics" OR category = "computers") AND price > 100';
      const formatted = formatWhereExpression(expr);
      expect(formatted).toBe(
        'status = "active"\n' +
        'AND\n' +
        '( category = "electronics"\n' +
        '  OR\n' +
        'category = "computers" )\n' +
        'AND\n' +
        'price > 100'
      );
    });

    it('should handle nested parentheses', () => {
      const expr = '(status = "active" AND (price > 100 OR discount > 0.2)) OR featured = true';
      const formatted = formatWhereExpression(expr);
      expect(formatted).toBe(
        '( status = "active"\n' +
        '  AND\n' +
        '  ( price > 100\n' +
        '    OR\n' +
        'discount > 0.2 ))\n' +
        'OR\n' +
        'featured = true'
      );
    });

    it('should preserve string literals with spaces', () => {
      const expr = 'name = "John Doe" AND city = "New York"';
      const formatted = formatWhereExpression(expr, { lineBreakThreshold: 0 });
      expect(formatted).toBe(
        'name = "John Doe"\n' +
        'AND\n' +
        'city = "New York"'
      );
    });

    it('should handle single quotes in strings', () => {
      const expr = "name = 'John Doe' AND city = 'New York'";
      const formatted = formatWhereExpression(expr, { lineBreakThreshold: 0 });
      expect(formatted).toBe(
        "name = 'John Doe'\n" +
        'AND\n' +
        "city = 'New York'"
      );
    });

    it('should respect custom indent', () => {
      const expr = 'a = 1 AND b = 2';
      const formatted = formatWhereExpression(expr, { indent: 2, lineBreakThreshold: 0 });
      expect(formatted).toBe(
        '    a = 1\n' +
        '    AND\n' +
        '    b = 2'
      );
    });

    it('should respect custom threshold', () => {
      const expr = 'a = 1 AND b = 2';
      const formatted = formatWhereExpression(expr, { lineBreakThreshold: 5 });
      expect(formatted).toBe(
        'a = 1\n' +
        'AND\n' +
        'b = 2'
      );
    });

  });

  describe('formatWhereExpressionMermaid', () => {
    it('should convert newlines to <br/> for Mermaid', () => {
      const expr = 'status = "active" AND created_at > "2023-01-01"';
      const formatted = formatWhereExpressionMermaid(expr);
      expect(formatted).toBe(
        'status = "active"<br/>' +
        'AND<br/>' +
        'created_at > "2023-01-01"'
      );
    });
  });

  describe('formatWhereExpressionDot', () => {
    it('should convert newlines to \\l for DOT', () => {
      const expr = 'status = "active" AND created_at > "2023-01-01"';
      const formatted = formatWhereExpressionDot(expr);
      expect(formatted).toBe(
        'status = "active"\\l' +
        'AND\\l' +
        'created_at > "2023-01-01"'
      );
    });
  });
});