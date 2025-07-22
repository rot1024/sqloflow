#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { parse, convert, render } from './index.js';
import type { RenderOptions, JsonViewType, Dialect } from './index.js';

interface CliOptions {
  format: 'json' | 'mermaid' | 'ascii' | 'dot';
  output?: string;
  dialect: Dialect;
  jsonView: JsonViewType;
  help: boolean;
}

const showHelp = () => {
  console.log(`
sqloflow - SQL visualization tool

Usage:
  sqloflow [options] [sql]
  echo "SELECT * FROM users" | sqloflow [options]

Options:
  -f, --format <format>     Output format: json, mermaid, ascii, dot (default: mermaid)
  -o, --output <file>       Output to file instead of stdout
  -d, --dialect <dialect>   SQL dialect: postgresql, mysql, sqlite, mariadb, transactsql
                           (default: postgresql)
  -v, --view <view>         View type for json/dot: operation, schema (default: operation)
  -h, --help               Show this help message

Examples:
  # Output Mermaid diagram to stdout
  sqloflow "SELECT * FROM users"
  
  # Output JSON to file
  sqloflow -f json -o output.json "SELECT * FROM users"
  
  # Read from stdin
  cat query.sql | sqloflow -f mermaid -o diagram.md
  
  # Use different SQL dialect
  sqloflow -d mysql "SELECT * FROM users"
`);
};

const parseArgs = (args: string[]): { options: CliOptions; sql?: string } => {
  const options: CliOptions = {
    format: 'mermaid',
    dialect: 'postgresql',
    jsonView: 'operation',
    help: false
  };
  
  let sql: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '-f':
      case '--format':
        const format = args[++i];
        if (format !== 'json' && format !== 'mermaid' && format !== 'ascii' && format !== 'dot') {
          throw new Error(`Invalid format: ${format}. Must be 'json', 'mermaid', 'ascii', or 'dot'`);
        }
        options.format = format;
        break;
        
      case '-o':
      case '--output':
        options.output = args[++i];
        break;
        
      case '-d':
      case '--dialect':
        const dialect = args[++i] as Dialect;
        if (!['postgresql', 'mysql', 'sqlite', 'mariadb', 'transactsql'].includes(dialect)) {
          throw new Error(`Invalid dialect: ${dialect}`);
        }
        options.dialect = dialect;
        break;
        
      case '-v':
      case '--view':
        const view = args[++i] as JsonViewType;
        if (view !== 'operation' && view !== 'schema') {
          throw new Error(`Invalid view: ${view}. Must be 'operation' or 'schema'`);
        }
        options.jsonView = view;
        break;
        
      case '-h':
      case '--help':
        options.help = true;
        break;
        
      default:
        if (!arg.startsWith('-')) {
          sql = arg;
        }
        break;
    }
  }
  
  return { options, sql };
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  
  return new Promise((resolve, reject) => {
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString()));
    process.stdin.on('error', reject);
  });
};

const main = async () => {
  try {
    const args = process.argv.slice(2);
    const { options, sql: argSql } = parseArgs(args);
    
    if (options.help) {
      showHelp();
      process.exit(0);
    }
    
    // Get SQL (from argument or stdin)
    let sql: string;
    if (argSql) {
      sql = argSql;
    } else if (!process.stdin.isTTY) {
      sql = await readStdin();
    } else {
      console.error('Error: No SQL provided. Use -h for help.');
      process.exit(1);
    }
    
    // 空文字列チェック
    const trimmedSql = sql.trim();
    if (!trimmedSql) {
      console.error('Error: No SQL provided. Use -h for help.');
      process.exit(1);
    }
    
    // Process SQL
    const ast = parse(trimmedSql, options.dialect);
    const ir = convert(ast);
    
    const renderOptions: RenderOptions = {
      format: options.format,
      jsonViewType: options.jsonView
    };
    
    const result = render(ir, renderOptions);
    
    // Output
    if (options.output) {
      writeFileSync(options.output, result, 'utf-8');
      console.error(`Output written to ${options.output}`);
    } else {
      console.log(result);
    }
    
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

main();