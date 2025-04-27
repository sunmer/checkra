import { CheckraOptions } from '../types';
import { AiSettings as CoreAiSettings } from '../ui/settings-modal';
import { FloatingMenu } from '../ui/floating-menu';
import { SettingsModal } from '../ui/settings-modal';

// --- Module-level instance variable ---
let settingsModalInstance: SettingsModal | null = null;

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

// --- Exported function to get settings ---
/**
 * Gets the current AI settings configured through the UI.
 * Returns default settings if the UI hasn't been initialized or created.
 * Uses CoreAiSettings type alias to avoid name clash.
 */
export function getCurrentAiSettings(): CoreAiSettings {
  if (settingsModalInstance) {
    return settingsModalInstance.getCurrentSettings();
  } else {
    // Return default settings if the instance isn't available
    console.warn('[Checkra Core] SettingsModal instance not available, returning default AI settings.');
    return {
      model: 'gpt-4o-mini', // Default model
      temperature: 0.7     // Default temperature
    };
  }
}

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

  // --- Create instances and assign to module-level variables ---
  let feedbackMenuInstance: FloatingMenu | null = null; // Keep local ref for API object closure

  try {
    if (config.isVisible) {
      // Assign to module-level variable
      settingsModalInstance = new SettingsModal();

      // Pass the instance to FloatingMenu
      feedbackMenuInstance = new FloatingMenu(settingsModalInstance);

      const created = feedbackMenuInstance.create();
      if (!created) {
        console.error("[Checkra] Failed to create FloatingMenu DOM.");
        // If floating menu fails, we might still want settings modal? Or destroy both?
        // For now, just nullify feedback menu instance
        if (feedbackMenuInstance) feedbackMenuInstance.destroy(); // Destroy partially created menu
        feedbackMenuInstance = null;
        // Decide if settings modal should also be destroyed if menu fails
        // if (settingsModalInstance) settingsModalInstance.destroy();
        // settingsModalInstance = null;
      }
    }

    console.log(`[Checkra] Initialized. UI Visible: ${config.isVisible}`);

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
        // Use the module-level instance
        if (settingsModalInstance) {
          settingsModalInstance.showModal();
        } else if (config.isVisible) {
          console.warn('[Checkra API] Settings modal instance not found, cannot show settings.');
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
        // Destroy and nullify the module-level settings instance
        if (settingsModalInstance) {
          settingsModalInstance.destroy();
          settingsModalInstance = null;
        }
        console.log('[Checkra API] Cleanup complete.');
      }
    };

    return api;

  } catch (error) {
    console.error('[Checkra] Failed to initialize:', error);
    effectiveApiKey = null;
    // Ensure cleanup on error
    if (feedbackMenuInstance) feedbackMenuInstance.destroy();
    if (settingsModalInstance) settingsModalInstance.destroy();
    settingsModalInstance = null; // Ensure module-level ref is cleared
    return null;
  }
}