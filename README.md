# sqloflow

A library and CLI tool for SQL visualization. Parse SQL strings and visualize data flow.

## Features

- 🎯 Comprehensive schema view with column-level data flow
- 📦 Available as both library and CLI
- 🌐 Works in both browser and Node.js
- 📸 Schema snapshot generation to track transformations

## Installation

```bash
npm install sqloflow
```

## CLI Usage

### Basic Usage

```bash
# Output Mermaid diagram to stdout
sqloflow "SELECT * FROM users"

# Output in JSON format
sqloflow -f json "SELECT * FROM users"

# Output as ASCII art
sqloflow -f ascii "SELECT * FROM users"

# Output as DOT format for Graphviz
sqloflow -f dot "SELECT * FROM users"

# Save to file
sqloflow -o diagram.md "SELECT * FROM users"

# Read from stdin
cat query.sql | sqloflow -f mermaid
```

### Options

```
-f, --format <format>     Output format: json, mermaid, ascii, dot (default: mermaid)
-o, --output <file>       Output to file instead of stdout
-d, --dialect <dialect>   SQL dialect: postgresql, mysql, sqlite, mariadb, transactsql
                         (default: postgresql)
-h, --help               Show help message
```

### Examples

```bash
# Output JSON with MySQL syntax
sqloflow -d mysql -f json "SELECT u.id, u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id"

# Generate DOT file and convert to PNG
sqloflow -f dot "SELECT * FROM users" > query.dot
dot -Tpng query.dot -o query.png

# Quick ASCII visualization in terminal
sqloflow -f ascii "SELECT name, COUNT(*) FROM users GROUP BY name"

# Visualize complex query with Mermaid
sqloflow "
  WITH recent_orders AS (
    SELECT user_id, SUM(amount) as total
    FROM orders
    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY user_id
  )
  SELECT u.name, r.total
  FROM users u
  JOIN recent_orders r ON u.id = r.user_id
  ORDER BY r.total DESC
  LIMIT 10
"
```

## Library Usage

### Basic Usage

```typescript
import { parse, convert, render } from 'sqloflow';

// Parse SQL and convert to IR (Intermediate Representation)
const sql = 'SELECT id, name FROM users WHERE active = true';
const ast = parse(sql);
const ir = convert(ast);

// Render as Mermaid diagram
const mermaid = render(ir, { format: 'mermaid' });
console.log(mermaid);

// Render as JSON
const json = render(ir, { format: 'json' });
console.log(json);

// Render as DOT format
const dot = render(ir, { format: 'dot' });
console.log(dot);

// Render as ASCII art
const ascii = render(ir, { format: 'ascii' });
console.log(ascii);
```

### Using Different SQL Dialects

```typescript
import { parse, convert, render } from 'sqloflow';

// Parse with MySQL syntax
const ast = parse(sql, 'mysql');
const ir = convert(ast);
const result = render(ir, { format: 'mermaid' });
```

### API Reference

#### `parse(sql: string, dialect?: Dialect): AST[]`

Parses SQL string into Abstract Syntax Tree (AST).

- `sql`: SQL string to parse
- `dialect`: SQL dialect (optional)
  - `'postgresql'` (default)
  - `'mysql'`
  - `'sqlite'`
  - `'mariadb'`
  - `'transactsql'`

#### `convert(ast: AST[]): Graph`

Converts AST to Intermediate Representation (IR) graph structure.

#### `render(graph: Graph, options: RenderOptions): string`

Renders graph in specified format.

- `options.format`: Output format
  - `'json'`: Complete graph structure as JSON
  - `'mermaid'`: Mermaid flowchart diagram
  - `'dot'`: GraphViz DOT format with enhanced schema view
  - `'ascii'`: ASCII art diagram

## Output Examples

### Mermaid

```mermaid
flowchart LR
    node_0[users]
    node_1[FROM]
    node_2[WHERE]
    node_3[SELECT]
    node_0 --> node_1
    node_1 --> node_2
    node_2 --> node_3
```

### ASCII Art

```
┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐
│ users  │───▶│  FROM  │───▶│ WHERE  │───▶│ SELECT │
└────────┘    └────────┘    └────────┘    └────────┘
```

### DOT (Graphviz) - Enhanced Schema View

```dot
digraph schema_flow {
  rankdir=LR;
  node [shape=record];

  node_0 [label="FROM users|id\nname\nemail", style=filled, fillcolor=lightgreen];
  node_1 [label="WHERE|active = true", style=filled, fillcolor=lightyellow];
  node_2 [label="SELECT|id\nname", style=filled, fillcolor=lightyellow];

  node_0 -> node_1;
  node_1 -> node_2;
}
```

### JSON

```json
{
  "nodes": [
    {
      "id": "node_0",
      "kind": "op",
      "label": "FROM",
      "sql": "FROM users"
    },
    {
      "id": "node_1",
      "kind": "clause",
      "label": "WHERE",
      "sql": "active = true"
    },
    {
      "id": "node_2",
      "kind": "op",
      "label": "SELECT",
      "sql": "id, name"
    }
  ],
  "edges": [
    {
      "id": "edge_0",
      "kind": "flow",
      "from": {"node": "node_0"},
      "to": {"node": "node_1"}
    },
    {
      "id": "edge_1",
      "kind": "flow",
      "from": {"node": "node_1"},
      "to": {"node": "node_2"}
    }
  ],
  "snapshots": [
    {
      "stepId": "node_0",
      "relations": {
        "users": {
          "name": "users",
          "columns": [
            {"id": "c1", "name": "id", "type": "INT"},
            {"id": "c2", "name": "name", "type": "VARCHAR"},
            {"id": "c3", "name": "email", "type": "VARCHAR"},
            {"id": "c4", "name": "active", "type": "BOOLEAN"}
          ]
        }
      }
    }
  ]
}
```

## Examples

See the `examples/` directory for sample SQL queries and their visualizations:

```bash
cd examples
node generate.js  # Regenerate all examples
```

Generated files:
- `*.sql` - Source SQL queries
- `*.dot` - DOT format files
- `*.png` - Rendered images
- `*.mmd` - Mermaid diagrams
- `*.txt` - ASCII art visualizations
- `*.json` - JSON output of graph structure

## Supported SQL Statements

- SELECT statements (with JOIN, subqueries, CTEs)
- INSERT statements
- UPDATE statements
- DELETE statements
- CREATE TABLE statements (with schema extraction)
- ALTER TABLE statements
- Other basic SQL statements

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type checking
npm run type

# Development mode
npm run dev
```

## License

MIT

## Author

rot1024
