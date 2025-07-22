# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

sqloflow is a TypeScript library and CLI tool for SQL visualization that parses SQL queries and generates visual representations in multiple formats (Mermaid, ASCII, DOT, JSON).

## Commands

### Development
- `npm run dev` - Start development in watch mode
- `npm run type` - Run TypeScript type checking

### Building
- `npm run build` - Build both library and CLI
- `npm run build:lib` - Build library only (uses Vite)
- `npm run build:cli` - Build CLI only

### Testing
- `npm test` - Run all tests with Vitest
- `npm run test:watch` - Run tests in watch mode

### Examples
- `cd examples && node generate.js` - Regenerate all example outputs

## Architecture

The codebase follows a clean pipeline architecture:

1. **Parser** (`src/parser.ts`): Uses `node-sql-parser` to convert SQL strings into AST
2. **Converter** (`src/converter/`): Transforms AST into an Intermediate Representation (IR) graph
   - `context.ts` - Manages conversion state and node creation
   - `statement-converters.ts` - Handles different SQL statement types
   - `schema-extractor.ts` - Extracts schema information from DDL statements
3. **Renderers** (`src/renderer/`): Convert IR to output formats
   - Each renderer implements the `Renderer` interface from `types/renderer.ts`
   - Supports: Mermaid, ASCII, DOT (Graphviz), and JSON formats

## Key Design Patterns

- **Two visualization perspectives**:
  - Operation-focused: Shows SQL operations flow (SELECT, FROM, WHERE, etc.)
  - Schema-focused: Tracks schema transformations and column-level data flow
- **Intermediate Representation (IR)**: All SQL is converted to a common graph structure before rendering
- **Modular renderers**: Each output format is a separate module implementing a common interface
- **Dual build targets**: Library (ES/CJS modules) and CLI executable

## TypeScript Configuration

- Strict mode enabled
- Target: ES2020 with ESNext modules
- Separate configs for library (`tsconfig.json`) and CLI (`tsconfig.cli.json`)
- All imports must include `.js` extension (even for `.ts` files)

## Testing Approach

- Test framework: Vitest
- Test files alongside source files (`*.test.ts`)
- Tests cover all major components: parser, converter, and renderers
- Each renderer has comprehensive tests for different SQL scenarios