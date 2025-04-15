// Export types
export type { LoggerOptions, Logger, ErrorInfo } from './types';

// Export main functionality
export { initLogger } from './core/index';

// Export UI components for direct access if needed
export { sourceViewer } from './ui/source-viewer';
export { codeFixViewer } from './ui/code-fix-viewer';
export { tooltip } from './ui/tooltip';

// Import the actual initialization function and types
// (You might need to adjust the path if initLogger is defined elsewhere)
import { initLogger as initializeLogger } from './core'; // Assuming './logger' holds the core logic
import { LoggerOptions } from './types'; // Assuming './logger' holds the core logic

// --- Auto-initialization logic ---

/**
 * Default options for auto-initialization.
 * Customize these as needed for the default behavior when the script is dropped in.
 */
const defaultAutoInitOptions: LoggerOptions = {
  renderErrorLogDiv: true, // Example: Show the log div by default
  attachToWindow: true,    // Example: Override window.console by default
  // Add other default options here
};

/**
 * Reads configuration from a global variable if it exists.
 * Allows users to configure the logger *before* the script tag.
 * Example: <script>window.AdvancedLoggerConfig = { renderErrorLogDiv: false };</script>
 *          <script src="http://localhost:8080/logger.js"></script>
 */
function getGlobalConfig(): LoggerOptions | undefined {
  if (typeof window !== 'undefined' && (window as any).AdvancedLoggerConfig) {
    // Merge global config with defaults, letting global config override
    return {
        ...defaultAutoInitOptions,
        ...(window as any).AdvancedLoggerConfig
    };
  }
  // Return only defaults if no global config is found
  return defaultAutoInitOptions;
}

// Check if running in a browser environment and automatically initialize
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // We are in a browser
  try {
    const options = getGlobalConfig();
    console.log('Auto-initializing Advanced Frontend Logger...'); // Optional: for debugging
    initializeLogger(options);
    // You could add a flag to prevent double initialization if initLogger is also called manually
    (window as any).AdvancedLoggerInitialized = true;
  } catch (e) {
    // Fallback to basic console if logger init fails
    console.error("Failed to auto-initialize Advanced Frontend Logger:", e);
  }
}

// You might want to export other things from your library as well
// export * from './ui';
// export * from './utils';