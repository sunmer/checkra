import { ErrorInfo } from '../types';

// Helper to format error messages - memoize for performance
const formatErrorCache = new WeakMap<Error, string>();

/**
 * Formats error objects and other arguments into a string representation.
 */
export const formatError = (...args: any[]): string => {
  const result = args.map(arg => {
    if (arg instanceof Error) {
      // Check cache first
      if (formatErrorCache.has(arg)) {
        return formatErrorCache.get(arg);
      }
      const formatted = arg.stack || arg.toString();
      formatErrorCache.set(arg, formatted);
      return formatted;
    }
    return String(arg);
  }).join(' ');

  return result;
};

// Extract error information from error objects - memoize for performance
const errorInfoCache = new WeakMap<Error, ErrorInfo>();

/**
 * Extracts useful information from an error object, ErrorEvent, or string.
 */
export const extractErrorInfo = (error: Error | ErrorEvent | string): ErrorInfo => {
  if (typeof error === 'string') {
    return { message: error };
  }

  if (error instanceof Error) {
    // Check cache first
    if (errorInfoCache.has(error)) {
      return errorInfoCache.get(error)!;
    }

    // For JS Error objects
    const info: ErrorInfo = {
      message: error.message,
      stack: error.stack
    };

    // Try to parse filename and line number from stack trace
    if (error.stack) {
      const stackLines = error.stack.split('\n');
      for (const line of stackLines) {
        const match = line.match(/at\s+.*\s+\((.*):(\d+):(\d+)\)/);
        if (match) {
          info.fileName = match[1];
          info.lineNumber = parseInt(match[2], 10);
          info.columnNumber = parseInt(match[3], 10);
          break;
        }
      }
    }

    // Cache the result
    errorInfoCache.set(error, info);
    return info;
  } else {
    // For ErrorEvent objects
    return {
      message: error.message,
      fileName: error.filename,
      lineNumber: error.lineno,
      columnNumber: error.colno
    };
  }
};