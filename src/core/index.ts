import { CheckraOptions } from '../types';
import { FloatingMenu } from '../ui/floating-menu';
import { feedbackViewer } from '../ui/feedback-viewer';

/**
 * Initializes the Checkra feedback UI components.
 *
 * This function sets up the necessary UI elements for the feedback feature,
 * including the feedback button and the feedback submission viewer, if enabled.
 *
 * @param options - Optional configuration for the feedback module.
 */
export function initCheckra(options?: CheckraOptions): void {
  // Default configuration
  const config: Required<CheckraOptions> = {
    isVisible: options?.isVisible ?? true, // Use isVisible, default to true
    style: options?.style ?? {} // Keep style option for future use
  };

  // @ts-ignore
  let feedbackMenu: FloatingMenu | null = null;

  // Only initialize UI if isVisible is true
  if (config.isVisible) {
    feedbackViewer.create();
    // Pass the config object to the constructor
    feedbackMenu = new FloatingMenu(config);
  }

  // No need to return a module object or cleanup function directly for this simplified approach.
  // Cleanup might need to be handled differently if required (e.g., a separate exported function).
  // For now, we assume the UI elements are removed if the script is removed or page navigates.
  // If explicit cleanup is needed later, we can add a separate `destroyCheckra()` function.

  console.log(`[Checkra] Initialized. UI Visible: ${config.isVisible}`);
}