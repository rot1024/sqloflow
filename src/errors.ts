/**
 * Custom error classes for SQLOFlow
 */

export class SqloflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqloflowError';
  }
}

export class ParseError extends SqloflowError {
  constructor(message: string, public sql?: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export class ConversionError extends SqloflowError {
  constructor(message: string, public statementType?: string) {
    super(message);
    this.name = 'ConversionError';
  }
}

export class RenderError extends SqloflowError {
  constructor(message: string, public format?: string) {
    super(message);
    this.name = 'RenderError';
  }
}

export class ValidationError extends SqloflowError {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}