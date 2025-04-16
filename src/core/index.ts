import { CheckraOptions } from '../types';
import { FloatingMenu } from '../ui/floating-menu';
import { settingsViewer } from '../ui/settings-modal';

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
  // Default configuration
  const config: Required<CheckraOptions> = {
    isVisible: options?.isVisible ?? true,
    style: options?.style ?? {}
  };

  let feedbackMenuInstance: FloatingMenu | null = null;

  try {
    // Only initialize UI components if isVisible is true
    if (config.isVisible) {
      feedbackMenuInstance = new FloatingMenu(config); // Create the floating menu
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
    return null; // Return null on initialization failure
  }
}