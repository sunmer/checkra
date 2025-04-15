import html2canvas from 'html2canvas';
import { finder } from '@medv/finder';

/**
 * Handles capturing a selected DOM element.
 */
class ScreenCapture {
  private captureCallback: ((
    imageDataUrl: string | null,
    selectedHtml: string | null,
    bounds: DOMRect | null
  ) => void) | null = null;
  private clickListener: ((event: MouseEvent) => void) | null = null;
  private escapeListener: ((event: KeyboardEvent) => void) | null = null;
  private mouseMoveListener: ((event: MouseEvent) => void) | null = null;
  private isCapturing: boolean = false;
  private overlay: HTMLDivElement | null = null;
  private currentHighlight: HTMLElement | null = null;

  private cleanup(): void {
    console.log('[ScreenCapture] Cleaning up...');
    document.body.style.cursor = 'default';

    // Remove event listeners
    if (this.clickListener) {
      document.removeEventListener('click', this.clickListener);
      this.clickListener = null;
    }

    if (this.escapeListener) {
      document.removeEventListener('keydown', this.escapeListener);
      this.escapeListener = null;
    }

    if (this.mouseMoveListener) {
      document.removeEventListener('mousemove', this.mouseMoveListener);
      this.mouseMoveListener = null;
    }

    // Remove overlay if it exists
    if (this.overlay && this.overlay.parentNode) {
      document.body.removeChild(this.overlay);
      this.overlay = null;
    }

    this.currentHighlight = null;
    this.isCapturing = false;
    this.captureCallback = null; // Clear callback reference
    console.log('[ScreenCapture] Cleanup complete.');
  }

  private createOverlay(): void {
    // Create overlay div
    this.overlay = document.createElement('div');
    this.overlay.style.position = 'fixed';
    this.overlay.style.top = '0';
    this.overlay.style.left = '0';
    this.overlay.style.width = '100%';
    this.overlay.style.height = '100%';
    this.overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'; // Semi-transparent dark overlay
    this.overlay.style.zIndex = '2147483646'; // Very high z-index
    this.overlay.style.pointerEvents = 'none'; // Allow clicks to pass through
    document.body.appendChild(this.overlay);
  }

  private highlightElement(element: HTMLElement | null): void {
    // Remove previous highlight if it exists
    if (this.currentHighlight) {
      this.currentHighlight.style.removeProperty('outline');
      this.currentHighlight.style.removeProperty('position');
      this.currentHighlight.style.removeProperty('z-index');
      this.currentHighlight = null; // Clear the reference *before* potentially setting it again
    }

    // If a new, valid element is provided, highlight it
    // Ensure the element is not the overlay itself
    if (element && element !== this.overlay) {
        // Set the current element as the highlighted one
        this.currentHighlight = element;

        // Apply highlighting styles - bring element above overlay
        element.style.outline = '2px solid #0095ff';
        // Store original position/zIndex before changing? Maybe too complex for now.
        // Let's stick with applying relative/high zIndex for highlighting.
        element.style.position = 'relative';
        element.style.zIndex = '2147483647'; // Higher than overlay
    }
  }

  /**
   * Finds the effective background color of an element, traversing up the DOM if necessary.
   * @param element The starting element.
   * @returns The CSS background color string, or a default color (e.g., white) if none is found.
   */
  private getEffectiveBackgroundColor(element: HTMLElement | null): string {
    let currentElement = element;
    const defaultBackgroundColor = '#ffffff'; // Default to white

    while (currentElement) {
      const computedStyle = window.getComputedStyle(currentElement);
      const bgColor = computedStyle.backgroundColor;

      // Check if the background color is effectively transparent
      // Browsers might return 'transparent' or 'rgba(0, 0, 0, 0)'
      if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
        return bgColor;
      }

      // Stop if we reach the body or html element without finding a color
      if (currentElement === document.body || currentElement === document.documentElement) {
          break;
      }

      // Move up to the parent element
      currentElement = currentElement.parentElement;
    }

    // If no color found up the tree, try the body's background explicitly
    const bodyBgColor = window.getComputedStyle(document.body).backgroundColor;
    if (bodyBgColor && bodyBgColor !== 'rgba(0, 0, 0, 0)' && bodyBgColor !== 'transparent') {
        return bodyBgColor;
    }

    // Fallback to default if the body is also transparent or check failed
    return defaultBackgroundColor;
  }

  public startCapture(callback: (
    imageDataUrl: string | null,
    selectedHtml: string | null,
    bounds: DOMRect | null
  ) => void): void {
    console.log('[ScreenCapture] startCapture called.');
    if (this.isCapturing) {
      console.warn('[ScreenCapture] Capture already in progress. Ignoring request.');
      return; // Prevent multiple captures
    }

    this.captureCallback = callback;
    this.isCapturing = true;
    document.body.style.cursor = 'crosshair'; // Indicate selection mode

    try {
      console.log('[ScreenCapture] Setting up element selection...');

      // Create overlay
      this.createOverlay();

      // Set up escape key handler
      this.escapeListener = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          console.log('[ScreenCapture] Escape key pressed, cancelling capture.');
          this.cancelCapture();
        }
      };
      document.addEventListener('keydown', this.escapeListener);

      // Set up mousemove handler to highlight elements under cursor
      this.mouseMoveListener = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const floatingMenu = document.getElementById('floating-menu-container'); // Get reference to the menu

        // Prevent highlighting the overlay itself or the floating menu container and its children
        if (!target || target === this.overlay || (floatingMenu && floatingMenu.contains(target))) {
            // If hovering over ignored elements, ensure any previous highlight is cleared
            if (this.currentHighlight) {
                this.highlightElement(null); // Clear highlight
            }
            return; // Do not highlight these elements
        }

        // Only update highlight if the target is different
        if (target !== this.currentHighlight) {
          this.highlightElement(target);
        }
      };
      document.addEventListener('mousemove', this.mouseMoveListener);

      // Set up click handler
      this.clickListener = async (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const floatingMenu = document.getElementById('floating-menu-container'); // Get reference to the menu

        // **New Check:** Prevent capture if clicking on the floating menu or its children
        if (floatingMenu && floatingMenu.contains(target)) {
            console.log('[ScreenCapture] Clicked on floating menu, ignoring capture.');
            // Don't prevent default or stop propagation, let the menu click behave normally.
            // Crucially, don't clean up or proceed with capture.
            return;
        }

        // Don't interfere with normal clicks on inputs, buttons, etc.
        const tagName = target.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || tagName === 'button' || tagName === 'a') {
          // We might still want to prevent capture even on these if they are inside the floating menu,
          // but the check above already handles that.
          return; // Let the normal click proceed
        }

        // Otherwise, capture the element
        event.preventDefault();
        event.stopPropagation();
        console.log('[ScreenCapture] Element clicked:', target);

        // Store callback, target, and bounds before cleanup
        const callbackToExecute = this.captureCallback;
        const selectedElement = target;
        const selectedElementBounds = selectedElement?.getBoundingClientRect() ?? null; // Get bounds

        // Cleanup will reset cursor, remove event listeners and overlay
        this.cleanup();

        if (!callbackToExecute) {
          return;
        }

        let imageDataUrl: string | null = null;
        let selectedHtml: string | null = null;

        if (selectedElement) {
          // 1. Get HTML
          selectedHtml = selectedElement.outerHTML;
          console.log('[ScreenCapture] Captured HTML:', selectedHtml.substring(0, 100) + '...');

          // 2. Get CSS selector for the element (this is what finder is actually for)
          const selector = finder(selectedElement);
          console.log('[ScreenCapture] Generated CSS selector:', selector);

          // 3. Capture Image using html2canvas
          console.log('[ScreenCapture] Attempting html2canvas capture of selected element...');
          try {
            // Remove any temporary styles that were added for highlighting
            selectedElement.style.removeProperty('outline');
            selectedElement.style.removeProperty('position');
            selectedElement.style.removeProperty('z-index');

            // Determine the effective background color
            const effectiveBackgroundColor = this.getEffectiveBackgroundColor(selectedElement);
            console.log('[ScreenCapture] Using effective background color:', effectiveBackgroundColor);

            const canvas = await html2canvas(selectedElement, {
              backgroundColor: effectiveBackgroundColor, // Use the determined color
              useCORS: true,
              logging: true, // Keep logging for debugging
            });
            console.log('[ScreenCapture] html2canvas capture successful.');
            imageDataUrl = canvas.toDataURL('image/png');
            console.log('[ScreenCapture] Generated image data URL.');
          } catch (error) {
            console.error('[ScreenCapture] html2canvas capture failed:', error);
            // imageDataUrl remains null
          }
        } else {
          console.log('[ScreenCapture] No element selected.');
        }

        // Execute callback with results (including bounds)
        console.log('[ScreenCapture] Executing capture callback...');
        try {
          // Pass bounds to the callback
          callbackToExecute(imageDataUrl, selectedHtml, selectedElementBounds);
        } catch (callbackError) {
          console.error('[ScreenCapture] Error executing the capture callback:', callbackError);
        }
      };

      document.addEventListener('click', this.clickListener);
      console.log('[ScreenCapture] Click listener initialized and waiting for selection.');

    } catch (error) {
      console.error('[ScreenCapture] Error initializing capture:', error);
      this.cleanup(); // Attempt cleanup if setup fails
      if (this.captureCallback) {
        this.captureCallback(null, null, null); // Callback with nulls on error
      }
    }
  }

  // Add a method to cancel the capture externally if needed
  public cancelCapture(): void {
    console.log('[ScreenCapture] cancelCapture called.');
    if (this.isCapturing) {
      const callback = this.captureCallback;
      this.cleanup();

      // Optionally call the callback with nulls to indicate cancellation
      if (callback) {
        callback(null, null, null); // Pass null for bounds on cancel
      }
    }
  }
}

export const screenCapture = new ScreenCapture();