import { CheckraOptions } from '../types';
import { FloatingMenu } from '../ui/floating-menu';
import { settingsViewer } from '../ui/settings-modal';

// --- Key Management ---
let effectiveApiKey: string | null = null;
const LOCAL_STORAGE_KEY = 'checkra_anonymous_id';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Retrieves the effective API key (provided or anonymous UUID) for use in API calls.
 * @returns The key string or null if not initialized.
 */
export function getEffectiveApiKey(): string | null {
    return effectiveApiKey;
}
// --- End Key Management ---

/**
 * Defines the public API returned by initCheckra.
 */
export interface CheckraAPI {
  /**
   * Programmatically triggers the feedback capture UI flow.
   * Does nothing if the UI was initialized with isVisible: false.
   */
  showFeedback: () => void;
  /**
   * Programmatically shows the settings modal.
   * Does nothing if the UI was initialized with isVisible: false.
   */
  showSettings: () => void;
  /**
   * Removes the Checkra UI elements and cleans up resources.
   */
  destroy: () => void;
}

/**
 * Initializes the Checkra feedback UI components and returns an API object.
 *
 * @param options - Optional configuration for the feedback module.
 * @returns A CheckraAPI object to interact with the library, or null if initialization fails.
 */
export function initCheckra(options?: CheckraOptions): CheckraAPI | null {
  const config = {
    apiKey: options?.apiKey ?? undefined, // Keep undefined if not provided
    isVisible: options?.isVisible ?? true, // Default for isVisible
    style: options?.style ?? {}           // Default for style
  };

  // --- Determine Effective API Key ---
  if (config.apiKey && typeof config.apiKey === 'string' && config.apiKey.trim() !== '') {
    effectiveApiKey = config.apiKey.trim();
  } else {
    try {
      let anonymousId = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (anonymousId) {
        effectiveApiKey = anonymousId;
      } else {
        anonymousId = generateUUID();
        localStorage.setItem(LOCAL_STORAGE_KEY, anonymousId);
        effectiveApiKey = anonymousId;
      }
    } catch (error) {
      effectiveApiKey = generateUUID(); // Generate one for this session only
    }
  }

  let feedbackMenuInstance: FloatingMenu | null = null;

  try {
    // Only initialize UI components if isVisible is true
    if (config.isVisible) {
      feedbackMenuInstance = new FloatingMenu(config);
      // --- ADDED: Explicitly create the menu DOM ---
      const created = feedbackMenuInstance.create();
      if (!created) {
          // Handle case where menu creation failed (e.g., body wasn't ready - shouldn't happen if called after DOMContentLoaded)
          console.error("[Checkra] Failed to create FloatingMenu DOM.");
          // Depending on desired behavior, you might nullify the instance or throw error
          feedbackMenuInstance = null;
      }
      // --- End Added Call ---
    }

    console.log(`[Checkra] Initialized. UI Visible: ${config.isVisible}`);

    // Define the API object
    const api: CheckraAPI = {
      showFeedback: () => {
        if (feedbackMenuInstance) {
          feedbackMenuInstance.triggerFeedbackCapture();
        } else if (config.isVisible) {
          console.warn('[Checkra API] Feedback menu instance not found or creation failed, cannot show feedback.');
        } else {
          console.log('[Checkra API] UI is hidden, showFeedback() ignored.');
        }
      },
      showSettings: () => {
        if (config.isVisible) {
          // Lazy creation happens inside showModal now
          settingsViewer.showModal();
        } else {
           console.log('[Checkra API] UI is hidden, showSettings() ignored.');
        }
      },
      destroy: () => {
        console.log('[Checkra API] Destroy called.');
        if (feedbackMenuInstance) {
          feedbackMenuInstance.destroy();
          feedbackMenuInstance = null;
        }
        // No need to call destroy on singletons like settingsViewer here,
        // unless you want to provide a way to fully reset the library state.
        console.log('[Checkra API] Cleanup complete.');
      }
    };

    return api;

  } catch (error) {
    console.error('[Checkra] Failed to initialize:', error);
    effectiveApiKey = null; // Clear key on init failure
    return null; // Return null on initialization failure
  }
}