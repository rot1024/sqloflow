import { describe, it, expect } from 'vitest';
import { selectListToSQL, expressionToSQL } from './helpers';
import type { Column } from 'node-sql-parser';

describe('helpers', () => {
  describe('selectListToSQL', () => {
    it('should convert simple column references', () => {
      const columns: Column[] = [
        {
          expr: { type: 'column_ref', table: null, column: 'id' },
          as: null
        },
        {
          expr: { type: 'column_ref', table: 'users', column: 'name' },
          as: null
        }
      ];
      
      const result = selectListToSQL(columns);
      expect(result).toBe('id, users.name');
    });

    it('should handle column aliases', () => {
      const columns: Column[] = [
        {
          expr: { type: 'column_ref', table: null, column: 'id' },
          as: 'user_id'
        },
        {
          expr: { type: 'column_ref', table: null, column: 'name' },
          as: 'full_name'
        }
      ];
      
      const result = selectListToSQL(columns);
      expect(result).toBe('id AS user_id, name AS full_name');
    });

    it('should convert aggregate functions', () => {
      const columns: Column[] = [
        {
          expr: {
            type: 'aggr_func',
            name: 'COUNT',
            args: { expr: { type: 'star', value: '*' } }
          },
          as: null
        },
        {
          expr: {
            type: 'aggr_func',
            name: 'MAX',
            args: {
              expr: { type: 'column_ref', table: null, column: 'total_amount' }
            }
          },
          as: 'max_total'
        }
      ];
      
      const result = selectListToSQL(columns);
      expect(result).toBe('COUNT(*), MAX(total_amount) AS max_total');
    });

    it('should handle complex expressions without showing JSON', () => {
      const columns: Column[] = [
        {
          expr: {
            type: 'function',
            name: 'COALESCE',
            args: [
              { type: 'column_ref', table: null, column: 'name' },
              { type: 'string', value: 'Unknown' }
            ]
          },
          as: 'display_name'
        }
      ];
      
      const result = selectListToSQL(columns);
      expect(result).toBe("COALESCE(name, 'Unknown') AS display_name");
    });
  });

  describe('expressionToSQL', () => {
    it('should convert binary expressions', () => {
      const expr = {
        type: 'binary_expr',
        operator: '+',
        left: { type: 'column_ref', table: null, column: 'price' },
        right: { type: 'number', value: 10 }
      };
      
      const result = expressionToSQL(expr);
      expect(result).toBe('price + 10');
    });

    it('should handle INTERVAL expressions', () => {
      const expr = {
        type: 'interval',
        expr: { type: 'string', value: '30' },
        unit: 'DAY'
      };
      
      const result = expressionToSQL(expr);
      expect(result).toBe("INTERVAL '30' DAY");
    });

    it('should handle unknown expression types gracefully', () => {
      const expr = {
        type: 'unknown_type',
        value: 'test_value'
      };
      
      const result = expressionToSQL(expr);
      expect(result).toBe('test_value');
    });

    it('should return "expr" for unknown types without value', () => {
      const expr = {
        type: 'completely_unknown',
        some_field: 'data'
      };
      
      const result = expressionToSQL(expr);
      expect(result).toBe('expr');
    });
  });
});