import { ConversionError } from '../errors.js';
import type { ConversionContext } from './types.js';

/**
 * Safely execute a conversion operation with error handling
 */
export function safeConvert<T>(
  operation: () => T,
  errorMessage: string,
  context?: any
): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof ConversionError) {
      throw error;
    }
    
    const message = error instanceof Error ? error.message : String(error);
    throw new ConversionError(`${errorMessage}: ${message}`, context);
  }
}

/**
 * Validate required fields exist
 */
export function validateRequired<T>(
  obj: T,
  fields: (keyof T)[],
  context: string
): void {
  for (const field of fields) {
    if (obj[field] === undefined || obj[field] === null) {
      throw new ConversionError(`Missing required field '${String(field)}' in ${context}`);
    }
  }
}

/**
 * Get a safe value with a default fallback
 */
export function getSafeValue<T>(
  getValue: () => T,
  defaultValue: T,
  warnOnFallback = false
): T {
  try {
    const value = getValue();
    return value !== undefined && value !== null ? value : defaultValue;
  } catch (error) {
    if (warnOnFallback) {
      console.warn(`Using default value due to error: ${error instanceof Error ? error.message : error}`);
    }
    return defaultValue;
  }
}