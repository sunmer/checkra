import { CheckraOptions } from '../types';
import { AiSettings as CoreAiSettings } from '../ui/settings-modal';
import { SettingsModal } from '../ui/settings-modal';
import FeedbackViewer from '../ui/feedback-viewer';
import { EventEmitter } from './event-emitter';

// Module-level instance variables
let settingsModalInstance: SettingsModal | null = null;
let feedbackViewerInstance: FeedbackViewer | null = null; // Keep a ref to the viewer instance

// Key Management
let effectiveApiKey: string | null = null;
const LOCAL_STORAGE_KEY = 'checkra_anonymous_id';

// Cache latest settings to avoid instance mismatch issues
let latestAiSettings: CoreAiSettings = { model: 'gpt-4o', temperature: 0.7 };

// Global event emitter instance
export const eventEmitter = new EventEmitter();

// Listen for settingsChanged event to keep cache updated
eventEmitter.on('settingsChanged', (settings: CoreAiSettings) => {
  latestAiSettings = { ...settings };
  console.log('[Core] latestAiSettings updated via settingsChanged event:', latestAiSettings);
});

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
    // Prefer cached settings if available
    const settings = { ...latestAiSettings };
    console.log('[Core] getCurrentAiSettings returning cached settings:', settings);
    return settings;
  } else {
    console.warn('[Checkra Core] SettingsModal instance not available; returning cached or default settings.');
    return { ...latestAiSettings };
  }
}

/**
 * Defines the public API returned by initCheckra.
 */
export interface CheckraAPI {
  /**
   * Programmatically shows the Checkra feedback UI.
   */
  show: () => void;
  /**
   * Programmatically hides the Checkra feedback UI.
   */
  hide: () => void;
  /**
   * Programmatically shows the settings modal.
   */
  showSettings: () => void;
  /**
   * Removes the Checkra UI elements and cleans up resources.
   */
  destroy: () => void;
}

// Default options specifically for the core initialization path
// These might differ slightly from src/index.ts auto-init defaults if necessary,
// but for isVisible, they should align.
const coreDefaultOptions: Partial<CheckraOptions> = {
  isVisible: false, // Default to hidden for programmatic init too
};

/**
 * Initializes the Checkra feedback UI components and returns an API object.
 *
 * @param options - Optional configuration for the feedback module.
 * @returns A CheckraAPI object to interact with the library, or null if initialization fails.
 */
export function initCheckra(options?: CheckraOptions): CheckraAPI | null {
  // Merge provided options: incoming options take precedence over core defaults.
  const finalOptions: CheckraOptions = {
    ...coreDefaultOptions, // Start with core defaults
    ...(options || {}),    // Override with explicitly passed options (which might include script/global config from src/index.ts)
  };

  console.log('[Checkra Core] Initializing with final options:', finalOptions);

  // Determine Effective API Key
  if (finalOptions.apiKey && typeof finalOptions.apiKey === 'string' && finalOptions.apiKey.trim() !== '') {
    effectiveApiKey = finalOptions.apiKey.trim();
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
      console.warn('[Checkra Core] localStorage access error for anonymous ID. Using session-only ID.');
      effectiveApiKey = generateUUID(); // Generate one for this session only
    }
  }
  console.log('[Checkra Core] Effective API Key set.');

  try {
    if (!settingsModalInstance) {
      settingsModalInstance = new SettingsModal();
      console.log('[Checkra Core] SettingsModal instance created.');
    }

    // Get/create the FeedbackViewer singleton instance, passing initial visibility
    // The FeedbackViewer.getInstance method needs to be adapted to accept initialVisibility
    if (!feedbackViewerInstance) {
      feedbackViewerInstance = FeedbackViewer.getInstance(settingsModalInstance, finalOptions.isVisible);
      console.log(`[Checkra Core] FeedbackViewer instance created with initial visibility: ${finalOptions.isVisible}.`);
    }

    console.log(`[Checkra Core] UI components initialized.`);

    const api: CheckraAPI = {
      show: () => {
        console.log('[Checkra API] show() called - emitting showViewerRequest event.');
        eventEmitter.emit('showViewerRequest');
      },
      hide: () => {
        console.log('[Checkra API] hide() called - emitting hideViewerRequest event.');
        eventEmitter.emit('hideViewerRequest');
      },
      showSettings: () => {
        if (settingsModalInstance) {
          console.log('[Checkra API] showSettings() called.');
          settingsModalInstance.showModal();
        } else {
          console.warn('[Checkra API] Settings modal instance not found for showSettings().');
        }
      },
      destroy: () => {
        console.log('[Checkra API] destroy() called.');
        if (feedbackViewerInstance) {
          feedbackViewerInstance.destroy();
          feedbackViewerInstance = null;
          console.log('[Checkra Core] FeedbackViewer instance destroyed.');
        }
        if (settingsModalInstance) {
          settingsModalInstance.destroy();
          settingsModalInstance = null;
          console.log('[Checkra Core] SettingsModal instance destroyed.');
        }
        // Potentially unsubscribe all eventEmitter listeners here if appropriate for full cleanup
        console.log('[Checkra API] Cleanup complete.');
      }
    };

    return api;

  } catch (error) {
    console.error('[Checkra Core] Failed to initialize:', error);
    // Ensure cleanup on error
    if (feedbackViewerInstance) feedbackViewerInstance.destroy();
    if (settingsModalInstance) settingsModalInstance.destroy();
    feedbackViewerInstance = null;
    settingsModalInstance = null;
    effectiveApiKey = null;
    return null;
  }
}