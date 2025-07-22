#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { parse, convert, render } from '../dist/index.js';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

async function generateVisualizations() {
  try {
    // Check if graphviz is installed
    try {
      await execAsync('which dot');
    } catch (error) {
      console.error('Error: graphviz is not installed.');
      console.error('  macOS: brew install graphviz');
      console.error('  Ubuntu: sudo apt-get install graphviz');
      process.exit(1);
    }

    // Get all SQL files in the directory
    const files = await readdir(__dirname);
    const sqlFiles = files.filter(file => file.endsWith('.sql'));

    for (const sqlFile of sqlFiles) {
      const filePath = join(__dirname, sqlFile);
      const baseName = basename(sqlFile, '.sql');
      
      console.log(`Processing ${sqlFile}...`);
      
      // Read SQL content
      const sql = await readFile(filePath, 'utf-8');
      
      try {
        // Parse and convert SQL
        const ast = parse(sql);
        const graph = convert(ast);
        
        // Generate DOT format - operation view
        console.log('  Generating DOT operation view...');
        const dotOperation = render(graph, { format: 'dot', jsonViewType: 'operation' });
        await writeFile(join(__dirname, `${baseName}_operation.dot`), dotOperation);
        
        // Generate PNG from DOT
        await execAsync(`dot -Tpng "${join(__dirname, `${baseName}_operation.dot`)}" -o "${join(__dirname, `${baseName}_operation.png`)}"`);
        
        // Generate DOT format - schema view
        console.log('  Generating DOT schema view...');
        const dotSchema = render(graph, { format: 'dot', jsonViewType: 'schema' });
        await writeFile(join(__dirname, `${baseName}_schema.dot`), dotSchema);
        
        // Generate PNG from DOT
        await execAsync(`dot -Tpng "${join(__dirname, `${baseName}_schema.dot`)}" -o "${join(__dirname, `${baseName}_schema.png`)}"`);
        
        // Generate Mermaid format
        console.log('  Generating Mermaid diagram...');
        const mermaid = render(graph, { format: 'mermaid' });
        await writeFile(join(__dirname, `${baseName}.mmd`), mermaid);
        
        // Generate ASCII format
        console.log('  Generating ASCII diagram...');
        const ascii = render(graph, { format: 'ascii' });
        await writeFile(join(__dirname, `${baseName}.txt`), ascii);
        
        console.log('  Done!');
      } catch (error) {
        console.error(`  Error processing ${sqlFile}:`, error.message);
      }
    }
    
    console.log('All visualizations generated successfully!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

generateVisualizations();