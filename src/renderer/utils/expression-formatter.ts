/**
 * Formats SQL expressions with line breaks and indentation for better readability
 */

interface FormatOptions {
  indent?: number;
  lineBreakThreshold?: number;
  indentString?: string;
}

interface Token {
  type: 'operator' | 'paren' | 'text';
  value: string;
}

/**
 * Tokenizes a SQL expression while preserving structure
 */
function tokenizeExpression(expr: string): Token[] {
  const tokens: Token[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let i = 0;

  while (i < expr.length) {
    const char = expr[i];

    // Handle string literals
    if ((char === '"' || char === "'") && !inString) {
      // Start of string
      inString = true;
      stringChar = char;
      current += char;
    } else if (char === stringChar && inString) {
      // End of string
      current += char;
      inString = false;
    } else if (inString) {
      // Inside string
      current += char;
    } else if (char === '(') {
      // Found opening paren
      if (current.trim()) {
        // Process accumulated text for operators
        processText(current, tokens);
        current = '';
      }
      tokens.push({ type: 'paren', value: '(' });
    } else if (char === ')') {
      // Found closing paren
      if (current.trim()) {
        // Process accumulated text for operators
        processText(current, tokens);
        current = '';
      }
      tokens.push({ type: 'paren', value: ')' });
    } else {
      current += char;
    }
    
    i++;
  }

  // Process any remaining text
  if (current.trim()) {
    processText(current, tokens);
  }

  return tokens;
}

/**
 * Process text to extract AND/OR operators
 */
function processText(text: string, tokens: Token[]): void {
  // Split by word boundaries to find AND/OR
  const regex = /\b(AND|OR)\b/gi;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before operator
    const before = text.substring(lastIndex, match.index).trim();
    if (before) {
      tokens.push({ type: 'text', value: before });
    }
    
    // Add operator
    tokens.push({ type: 'operator', value: match[1].toUpperCase() });
    
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  const remaining = text.substring(lastIndex).trim();
  if (remaining) {
    tokens.push({ type: 'text', value: remaining });
  }
}

/**
 * Formats a WHERE expression with line breaks and indentation
 */
export function formatWhereExpression(
  expr: string,
  options: FormatOptions = {}
): string {
  const {
    indent = 0,
    lineBreakThreshold = 40,
    indentString = '  '
  } = options;

  // If expression is short enough, return as-is
  if (expr.length <= lineBreakThreshold) {
    return expr;
  }

  const tokens = tokenizeExpression(expr);
  const lines: string[] = [];
  let currentLine = '';
  let parenDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const prevToken = tokens[i - 1];
    const nextToken = tokens[i + 1];

    if (token.type === 'paren' && token.value === '(') {
      // Opening paren stays on the same line
      currentLine += currentLine ? ' (' : '(';
      parenDepth++;
      // If there's content after the paren, add a space
      if (nextToken && nextToken.type === 'text') {
        currentLine += ' ';
      }
    } else if (token.type === 'paren' && token.value === ')') {
      // Add space before closing paren if needed
      if (prevToken && prevToken.type === 'text' && currentLine && !currentLine.endsWith(' ')) {
        currentLine += ' ';
      }
      currentLine += ')';
      parenDepth--;
    } else if (token.type === 'operator') {
      // Finish current line
      if (currentLine.trim()) {
        // Use parent depth for line before operator (since paren was already opened)
        const lineIndent = currentLine.trim().startsWith('(') && parenDepth > 0 ? parenDepth - 1 : parenDepth;
        lines.push(indentString.repeat(indent + lineIndent) + currentLine.trim());
      }
      // Add operator on its own line
      lines.push(indentString.repeat(indent + parenDepth) + token.value);
      currentLine = '';
    } else if (token.type === 'text') {
      currentLine += token.value;
    }
  }

  // Add any remaining content
  if (currentLine.trim()) {
    lines.push(indentString.repeat(indent + parenDepth) + currentLine.trim());
  }

  return lines.join('\n');
}

/**
 * Formats expressions for Mermaid diagrams (uses HTML line breaks)
 */
export function formatWhereExpressionMermaid(
  expr: string,
  options: FormatOptions = {}
): string {
  const formatted = formatWhereExpression(expr, options);
  // In Mermaid, use <br/> for line breaks
  return formatted.replace(/\n/g, '<br/>');
}

/**
 * Formats expressions for DOT/Graphviz (uses \n or \l for left-aligned text)
 */
export function formatWhereExpressionDot(
  expr: string,
  options: FormatOptions = {}
): string {
  const formatted = formatWhereExpression(expr, options);
  // In DOT, use \l for left-aligned lines
  return formatted.replace(/\n/g, '\\l');
}

/**
 * Formats expressions for DOT/Graphviz HTML labels
 */
export function formatWhereExpressionDotHtml(
  expr: string,
  options: FormatOptions = {}
): string {
  const formatted = formatWhereExpression(expr, options);
  // For HTML labels in DOT, use <BR ALIGN="LEFT"/> for left-aligned line breaks
  return formatted
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<BR ALIGN="LEFT"/>');
}