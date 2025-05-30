import { CheckraOptions } from '../types';
import { AiSettings as CoreAiSettings } from '../ui/settings-modal';
import { SettingsModal } from '../ui/settings-modal';
import Checkra from '../ui/Checkra';
import { EventEmitter } from './event-emitter';
import * as Auth from '../auth/auth'; // Import auth functions
import { customWarn, customError } from '../utils/logger';

// Module-level instance variables
let settingsModalInstance: SettingsModal | null = null;
let feedbackViewerInstance: Checkra | null = null; // Keep a ref to the viewer instance

// Key Management
let effectiveApiKey: string | null = null;
const LOCAL_STORAGE_KEY = 'checkra_anonymous_id';

// Cache latest settings to avoid instance mismatch issues
let latestAiSettings: CoreAiSettings = { model: 'gpt-4.1', temperature: 0.7 };

// Global event emitter instance
export const eventEmitter = new EventEmitter();

// Listen for settingsChanged event to keep cache updated
eventEmitter.on('settingsChanged', (settings: CoreAiSettings) => {
  latestAiSettings = { ...settings };
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
    return settings;
  } else {
    customWarn('[Checkra Core] SettingsModal instance not available; returning cached or default settings.');
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
  /**
   * Starts the Google OAuth login flow.
   */
  startLogin: () => Promise<void>;
  /**
   * Handles the OAuth callback. The Supabase client typically handles the code exchange automatically.
   * This function can be used to confirm session status post-redirect.
   * Typically called on the redirect URI page.
   */
  handleAuthCallback: () => Promise<boolean>;
  /**
   * Clears the current session and reloads the page.
   */
  logout: () => Promise<void>;
  /**
   * Checks if a user is currently logged in (has a valid or refreshable token).
   */
  isLoggedIn: () => Promise<boolean>;

  /**
   * Utility to get a valid auth token, attempts refresh if needed.
   * Exposed mainly for debugging or advanced scenarios; fetchProtected is preferred.
   */
  getAuthToken: () => Promise<string | null>;
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
      customWarn('[Checkra Core] localStorage access error for anonymous ID. Using session-only ID.');
      effectiveApiKey = generateUUID(); // Generate one for this session only
    }
  }

  try {
    if (!settingsModalInstance) {
      settingsModalInstance = new SettingsModal();
    }

    // Get/create the FeedbackViewer singleton instance, passing initial visibility
    // The FeedbackViewer.getInstance method needs to be adapted to accept initialVisibility
    if (!feedbackViewerInstance) {
      feedbackViewerInstance = Checkra.getInstance(settingsModalInstance, finalOptions.isVisible);
    }


    const api: CheckraAPI = {
      show: () => {
        eventEmitter.emit('showViewerRequest');
      },
      hide: () => {
        eventEmitter.emit('hideViewerRequest');
      },
      showSettings: () => {
        if (settingsModalInstance) {
          settingsModalInstance.showModal();
        } else {
          customWarn('[Checkra API] Settings modal instance not found for showSettings().');
        }
      },
      destroy: () => {
        if (feedbackViewerInstance) {
          feedbackViewerInstance.destroy();
          feedbackViewerInstance = null;
        }
        if (settingsModalInstance) {
          settingsModalInstance.destroy();
          settingsModalInstance = null;
        }
      },
      // Auth methods
      startLogin: Auth.startLogin,
      handleAuthCallback: Auth.handleAuthCallback,
      logout: Auth.logout,
      isLoggedIn: Auth.isLoggedIn,
      getAuthToken: Auth.getToken // Exposing getToken as getAuthToken on the API
    };

    return api;

  } catch (error) {
    customError('[Checkra Core] Failed to initialize:', error);
    // Ensure cleanup on error
    if (feedbackViewerInstance) feedbackViewerInstance.destroy();
    if (settingsModalInstance) settingsModalInstance.destroy();
    feedbackViewerInstance = null;
    settingsModalInstance = null;
    effectiveApiKey = null;
    return null;
  }
}