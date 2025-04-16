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
    console.log('[Checkra] Using provided API key.');
  } else {
    console.log('[Checkra] No API key provided, using anonymous ID.');
    try {
      let anonymousId = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (anonymousId) {
        effectiveApiKey = anonymousId;
        console.log('[Checkra] Using stored anonymous ID from localStorage.');
      } else {
        anonymousId = generateUUID();
        localStorage.setItem(LOCAL_STORAGE_KEY, anonymousId);
        effectiveApiKey = anonymousId;
        console.log('[Checkra] Generated and stored new anonymous ID in localStorage.');
      }
    } catch (error) {
      // localStorage might be unavailable (e.g., private browsing)
      console.warn('[Checkra] localStorage access failed. Generating ephemeral anonymous ID.', error);
      effectiveApiKey = generateUUID(); // Generate one for this session only
    }
  }
  // --- End Determine Effective API Key ---

  let feedbackMenuInstance: FloatingMenu | null = null;

  try {
    // Only initialize UI components if isVisible is true
    if (config.isVisible) {
      feedbackMenuInstance = new FloatingMenu(config); // Assuming FloatingMenu constructor accepts CheckraOptions
    }

    console.log(`[Checkra] Initialized. UI Visible: ${config.isVisible}`);

    // Define the API object
    const api: CheckraAPI = {
      showFeedback: () => {
        if (feedbackMenuInstance) {
          feedbackMenuInstance.triggerFeedbackCapture();
        } else if (config.isVisible) {
          console.warn('[Checkra API] Feedback menu instance not found, cannot show feedback.');
        } else {
          console.log('[Checkra API] UI is hidden, showFeedback() ignored.');
        }
      },
      showSettings: () => {
        if (config.isVisible) {
          // Assuming settingsViewer has a global/singleton showModal method
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
        // Also destroy other global/singleton UI components if they exist
        // feedbackViewer.destroy(); // REMOVED: Assume singleton handles destruction internally
        // settingsViewer.destroy(); // REMOVED: Assume singleton handles destruction internally
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