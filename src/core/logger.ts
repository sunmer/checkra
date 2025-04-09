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
 * @returns A Logger object exposing error count and logged error messages, with cleanup function.
 */
export function initLogger(options?: LoggerOptions): Logger & { cleanup: () => void } {
  const config = { ...defaultOptions, ...options };
  // Store the original style config to ensure we can fully restore it
  const originalStyle = { ...config.style };
  const errors: string[] = [];
  const sourceMap = new Map<string, ErrorInfo>();
  let errorLog: ErrorLog | null = null;

  // Save original console methods
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  
  // Keep reference to the error handler for later removal
  const errorHandler = (event: ErrorEvent) => {
    const msg = event.error ? (event.error.stack || event.error.toString()) : event.message;
    const errorInfo = event.error ? extractErrorInfo(event.error) : { 
      message: event.message, 
      fileName: event.filename, 
      lineNumber: event.lineno, 
      columnNumber: event.colno 
    };
    
    if (errorLog) {
      errorLog.addError(msg, errorInfo);
    }
    errors.push(msg);
  };

  // Initialize UI components if enabled
  if (config.renderErrorLogDiv) {
    // Initialize tooltip
    tooltip.create();
    // Initialize source viewer
    sourceViewer.create();
    // Initialize error log
    errorLog = new ErrorLog(config, originalStyle);
  }

  // Override console.warn
  console.warn = function (...args: any[]): void {
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
    originalConsoleWarn.apply(console, args);
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
  window.addEventListener('error', errorHandler, { passive: true });

  // Create the logger object to return with cleanup function
  const loggerObj: Logger & { cleanup: () => void } = {
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
    },
    // Add cleanup function
    cleanup: () => {
      // Restore original console methods
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      
      // Remove event listener
      window.removeEventListener('error', errorHandler);
      
      // Remove from window if attached
      if (config.attachToWindow) {
        delete (window as any).logger;
      }
      
      // Cleanup UI components
      if (errorLog) {
        errorLog.destroy();
      }
      
      if (config.renderErrorLogDiv) {
        tooltip.destroy();
        sourceViewer.destroy();
      }
    }
  };

  // Attach to window if requested
  if (config.attachToWindow) {
    (window as any).logger = loggerObj;
  }

  return loggerObj;
}