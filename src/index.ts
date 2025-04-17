import { initCheckra } from './core/index';
import { CheckraOptions } from './types';

// Re-export core functions and types
export { initCheckra } from './core/index';
export type{ CheckraOptions } from './types';

// --- Auto-initialization logic ---

/**
 * Default options for auto-initialization.
 */
const defaultAutoInitOptions: CheckraOptions = {
  isVisible: true, // Use isVisible
  // Add other default options here if needed in the future
};

/**
 * Reads configuration from a global variable if it exists.
 * Allows users to configure Checkra *before* the script tag.
 * Example: <script>window.CheckraConfig = { isVisible: false };</script>
 *          <script src="path/to/logger.js"></script>
 */
function getGlobalConfig(): CheckraOptions | undefined {
  const globalConfig = (window as any).CheckraConfig; // Use CheckraConfig for clarity
  if (typeof window !== 'undefined' && globalConfig) {
    // Merge global config with defaults, letting global config override
    return {
        ...defaultAutoInitOptions,
        ...globalConfig // Spread the global config object
    };
  }
  // Return only defaults if no global config is found
  return defaultAutoInitOptions;
}

// Check if running in a browser environment and automatically initialize
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // We are in a browser
  // Check if already initialized (optional, prevents double init)
  if (!(window as any).CheckraInitialized) {
    try {
      const options = getGlobalConfig();
      console.log('[Checkra] Auto-initializing...'); // Optional: for debugging
      initCheckra(options); // Call the updated initCheckra
      (window as any).CheckraInitialized = true; // Set initialization flag
    } catch (e) {
      // Fallback to basic console if init fails
      console.error("[Checkra] Failed to auto-initialize:", e);
    }
  }
}

// You might want to export other things from your library as well
// export * from './ui';
// export * from './utils';