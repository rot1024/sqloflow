#!/usr/bin/env node

import { writeFileSync } from 'fs';
import { parse, convert, render } from './index.js';
import type { RenderOptions, Dialect } from './index.js';
import { ParseError, ConversionError, RenderError } from './errors.js';

interface CliOptions {
  format: 'json' | 'mermaid' | 'ascii' | 'dot';
  output?: string;
  dialect: Dialect;
  help: boolean;
}

export const getHelpText = () => `
sqloflow - SQL visualization tool

Usage:
  sqloflow [options] [sql]
  echo "SELECT * FROM users" | sqloflow [options]

Options:
  -f, --format <format>     Output format: json, mermaid, ascii, dot (default: mermaid)
  -o, --output <file>       Output to file instead of stdout
  -d, --dialect <dialect>   SQL dialect: postgresql, mysql, sqlite, mariadb, transactsql
                           (default: postgresql)
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
`;

export const showHelp = () => {
  console.log(getHelpText());
};

export const parseArgs = (args: string[]): { options: CliOptions; sql?: string } => {
  const options: CliOptions = {
    format: 'mermaid',
    dialect: 'postgresql',
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

export const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  
  return new Promise((resolve, reject) => {
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString()));
    process.stdin.on('error', reject);
  });
};

export const runCli = async (args: string[], options?: {
  stdin?: string;
  exit?: (code: number) => void;
  log?: (message: string) => void;
  error?: (message: string) => void;
  isTTY?: boolean;
}) => {
  const {
    stdin,
    exit = process.exit,
    log = console.log,
    error = console.error,
    isTTY = process.stdin.isTTY
  } = options || {};

  try {
    const { options: cliOptions, sql: argSql } = parseArgs(args);
    
    if (cliOptions.help) {
      log(getHelpText());
      exit(0);
      return;
    }
    
    // Get SQL (from argument or stdin)
    let sql: string;
    if (argSql) {
      sql = argSql;
    } else if (stdin !== undefined) {
      sql = stdin;
    } else if (!isTTY) {
      sql = await readStdin();
    } else {
      error('Error: No SQL provided. Use -h for help.');
      exit(1);
      return;
    }
    
    // 空文字列チェック
    const trimmedSql = sql.trim();
    if (!trimmedSql) {
      error('Error: No SQL provided. Use -h for help.');
      exit(1);
      return;
    }
    
    // Process SQL
    const ast = parse(trimmedSql, cliOptions.dialect);
    const ir = convert(ast);
    
    const renderOptions: RenderOptions = {
      format: cliOptions.format
    };
    
    const result = render(ir, renderOptions);
    
    // Output
    if (cliOptions.output) {
      writeFileSync(cliOptions.output, result, 'utf-8');
      error(`Output written to ${cliOptions.output}`);
    } else {
      log(result);
    }
    
  } catch (err) {
    if (err instanceof ParseError) {
      error('Parse Error: ' + err.message);
      if (process.env.DEBUG) {
        error('SQL: ' + err.sql);
      }
    } else if (err instanceof ConversionError) {
      error('Conversion Error: ' + err.message);
    } else if (err instanceof RenderError) {
      error('Render Error: ' + err.message);
    } else {
      error('Error: ' + (err instanceof Error ? err.message : String(err)));
    }
    exit(1);
  }
};

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2));
}