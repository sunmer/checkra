import { initCheckra } from './core/index';
import './core/shortcut-handler';
import { CheckraOptions } from './types';

// Re-export core functions and types
export { initCheckra } from './core/index';
export type { CheckraOptions } from './types';

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

// Check if running in a browser environment
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const initialize = () => {
    // Check if already initialized
    if (!(window as any).CheckraInitialized) {
      try {
        const options = getGlobalConfig();
        console.log('[Checkra] DOM ready, auto-initializing...');
        initCheckra(options);
        (window as any).CheckraInitialized = true;
      } catch (e) {
        console.error("[Checkra] Failed to auto-initialize:", e);
      }
    } else {
      console.log("[Checkra] Already initialized, skipping auto-init.");
    }
  };

  // Check if DOM is already loaded (e.g., script loaded async defer or at end of body)
  if (document.readyState === 'loading') {
    // Loading hasn't finished yet
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    // `DOMContentLoaded` has already fired
    initialize();
  }
}