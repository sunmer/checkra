import { LoggerOptions, Logger, ErrorInfo } from '../types';
import { defaultOptions } from '../config';
import { ErrorLog } from '../ui/error-log';
import { tooltip } from '../ui/tooltip';
import { sourceViewer } from '../ui/source-viewer';
import { formatError, extractErrorInfo } from './error-handler';

/**
 * Initializes the logger.
 *
 * This function overrides console methods, sets up a global error listener, and (optionally)
 * renders a fixed error log div that can be toggled between expanded and collapsed states.
 *
 * @param options - Optional configuration for the logger.
 * @returns A Logger object exposing error count and logged error messages.
 */
export function initLogger(options?: LoggerOptions): Logger {
  const config = { ...defaultOptions, ...options };

  // Store the original style config to ensure we can fully restore it
  const originalStyle = { ...config.style };

  const errors: string[] = [];
  const sourceMap = new Map<string, ErrorInfo>();
  let errorLog: ErrorLog | null = null;

  // Initialize UI components if enabled
  if (config.renderErrorLogDiv) {
    // Initialize tooltip
    tooltip.create();
    
    // Initialize source viewer
    sourceViewer.create();
    
    // Initialize error log
    errorLog = new ErrorLog(config, originalStyle);
  }

  // Save original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  // Override console.log
  console.log = function (...args: any[]): void {
    for (const arg of args) {
      if (arg instanceof Error && errorLog) {
        const msg = formatError(arg);
        const errorInfo = extractErrorInfo(arg);
        errorLog.addError(msg, errorInfo);
        errors.push(msg);
      }
    }
    originalConsoleLog.apply(console, args);
  };

  // Override console.error
  console.error = function (...args: any[]): void {
    const msg = formatError(...args);

    // Extract error information if there's an Error object
    let errorInfo: ErrorInfo = { message: msg };
    for (const arg of args) {
      if (arg instanceof Error) {
        errorInfo = extractErrorInfo(arg);
        break;
      }
    }

    if (errorLog) {
      errorLog.addError(msg, errorInfo);
    }
    errors.push(msg);
    originalConsoleError.apply(console, args);
  };

  // Global error listener - use passive event listener for better performance
  window.addEventListener('error', event => {
    const msg = event.error
      ? (event.error.stack || event.error.toString())
      : event.message;

    const errorInfo = event.error
      ? extractErrorInfo(event.error)
      : {
        message: event.message,
        fileName: event.filename,
        lineNumber: event.lineno,
        columnNumber: event.colno
      };

    if (errorLog) {
      errorLog.addError(msg, errorInfo);
    }
    errors.push(msg);
  }, { passive: true });

  // Create the logger object to return
  const loggerObj: Logger = {
    get errorCount() {
      return errorLog ? errorLog.getErrorCount() : 0;
    },
    get errors() {
      return errors;
    },
    get sourceMap() {
      return errorLog ? errorLog.getSourceMap() : sourceMap;
    },
    showSource(errorId: string) {
      if (errorLog) {
        errorLog.showSource(errorId);
      }
    }
  };

  // Attach to window if requested
  if (config.attachToWindow) {
    (window as any).logger = loggerObj;
  }

  return loggerObj;
}