import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { parse } from '../parser.js';
import { convert } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(__dirname, '../../examples');

/**
 * Integration tests using SQL/JSON examples from the examples directory.
 * 
 * These tests serve as regression tests and snapshots of the converter output.
 * They ensure that the converter produces consistent output for real-world SQL queries.
 * 
 * Note: These tests use the existing JSON files in the examples directory as expected output.
 * If the converter behavior changes intentionally:
 * 1. Run these tests to see what changed
 * 2. Update the examples by running `cd examples && node generate.js`
 * 3. Review the changes in the JSON files
 * 4. Commit both the code changes and updated examples
 * 
 * This approach treats the examples directory as living documentation and snapshot tests.
 */
describe('Converter Examples Integration', () => {
  // Dynamically load all SQL files from the examples directory
  const sqlFiles = readdirSync(examplesDir)
    .filter(file => file.endsWith('.sql'))
    .map(file => basename(file, '.sql'));

  sqlFiles.forEach((fileBase) => {
    it(`should correctly convert ${fileBase}`, () => {
      // Read SQL and expected JSON
      const sqlPath = join(examplesDir, `${fileBase}.sql`);
      const jsonPath = join(examplesDir, `${fileBase}.json`);
      
      const sql = readFileSync(sqlPath, 'utf8').trim();
      const expectedJson = JSON.parse(readFileSync(jsonPath, 'utf8'));
      
      // Parse and convert
      const ast = parse(sql);
      const ir = convert(ast);
      
      // Convert IR to plain object for comparison
      // Note: We filter out undefined properties to match the JSON structure
      const actualJson = {
        nodes: ir.nodes.map(node => {
          const nodeObj: any = {
            id: node.id,
            kind: node.kind,
            label: node.label,
            sql: node.sql,
          };
          
          // Only include properties that are present in the node and not undefined
          if (node.kind === "subquery") {
            const subqueryNode = node as any;
            if (subqueryNode.innerGraph !== undefined) {
              nodeObj.innerGraph = subqueryNode.innerGraph;
            }
            if (subqueryNode.correlatedFields !== undefined && subqueryNode.correlatedFields.length > 0) {
              nodeObj.correlatedFields = subqueryNode.correlatedFields;
            }
            if (subqueryNode.subqueryType !== undefined) {
              nodeObj.subqueryType = subqueryNode.subqueryType;
            }
          }
          
          return nodeObj;
        }),
        edges: ir.edges.map(edge => {
          const edgeObj: any = {
            id: edge.id,
            kind: edge.kind,
            from: edge.from,
            to: edge.to,
          };
          
          // Only include label if it exists
          if (edge.label !== undefined) edgeObj.label = edge.label;
          
          return edgeObj;
        }),
        snapshots: ir.snapshots?.map(snapshot => ({
          nodeId: snapshot.nodeId,
          schema: {
            columns: snapshot.schema.columns.map(col => {
              const colObj: any = {
                id: col.id,
                name: col.name,
              };
              
              // Only include optional properties if they exist
              if (col.type !== undefined) colObj.type = col.type;
              if (col.source !== undefined) colObj.source = col.source;
              if (col.table !== undefined) colObj.table = col.table;
              if (col.sourceNodeId !== undefined) colObj.sourceNodeId = col.sourceNodeId;
              
              return colObj;
            }),
          },
        })),
      };
      
      // Compare the results
      expect(actualJson).toEqual(expectedJson);
    });
  });
  
  describe('Error handling', () => {
    it('should handle missing files gracefully', () => {
      const nonExistentPath = join(examplesDir, 'non_existent.sql');
      expect(() => readFileSync(nonExistentPath, 'utf8')).toThrow();
    });
  });
});