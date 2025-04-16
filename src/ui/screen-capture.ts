import html2canvas from 'html2canvas';

/**
 * Handles capturing a selected DOM element.
 */
class ScreenCapture {
  private captureCallback: ((
    imageDataUrl: string | null,
    selectedHtml: string | null,
    bounds: DOMRect | null,
    targetElement: Element | null,
    clickX: number,
    clickY: number,
    effectiveBackgroundColor: string | null
  ) => void) | null = null;
  private clickListener: ((event: MouseEvent) => Promise<void>) | null = null;
  private escapeListener: ((event: KeyboardEvent) => void) | null = null;
  private mouseMoveListener: ((event: MouseEvent) => void) | null = null;
  private isCapturing: boolean = false;
  private overlay: HTMLDivElement | null = null;
  private currentHighlight: HTMLElement | null = null;

  private cleanup(): void {
    console.log('[ScreenCapture] Cleaning up...');
    document.body.classList.remove('capturing-mode');

    // Remove event listeners
    if (this.clickListener) {
      document.removeEventListener('click', this.clickListener, { capture: true });
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

    // Remove overlay if it exists - This check will now likely always be false
    if (this.overlay && this.overlay.parentNode) {
      document.body.removeChild(this.overlay);
      this.overlay = null;
    }

    this.highlightElement(null);

    this.isCapturing = false;
    this.captureCallback = null; // Clear callback reference
    console.log('[ScreenCapture] Cleanup complete.');
  }

  private highlightElement(element: HTMLElement | null): void {
    // Remove previous highlight first
    if (this.currentHighlight) {
      this.currentHighlight.style.removeProperty('outline');
      this.currentHighlight.style.removeProperty('position');
      this.currentHighlight.style.removeProperty('z-index');
      this.currentHighlight = null; // Clear the reference
    }

    // If the new element is null, just return (overlay check removed as it's not added)
    if (!element) {
      return;
    }

    // Set the current element as the highlighted one
    this.currentHighlight = element;

    // Apply highlighting styles - bring element above other page elements
    element.style.outline = '2px solid #0095ff';
    element.style.position = 'relative'; // Needed for z-index to work reliably
    element.style.zIndex = '101'; // High z-index to appear above most elements
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
      // REMOVED: Check for overlay is no longer needed as it's not in the DOM
      // if (currentElement === this.overlay) {
      //     currentElement = currentElement.parentElement;
      //     continue;
      // }

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
    bounds: DOMRect | null,
    targetElement: Element | null,
    clickX: number,
    clickY: number,
    effectiveBackgroundColor: string | null
  ) => void): void {
    console.log('[ScreenCapture] startCapture called.');
    if (this.isCapturing) {
      console.warn('[ScreenCapture] Capture already in progress. Ignoring request.');
      return;
    }

    this.captureCallback = callback;
    this.isCapturing = true;
    document.body.classList.add('capturing-mode');

    try {
      console.log('[ScreenCapture] Setting up element selection...');

      // Create overlay - REMOVED: Don't create/add the overlay anymore
      // this.createOverlay();

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
        if (target && target !== this.currentHighlight) {
          this.highlightElement(target);
        }
      };
      document.addEventListener('mousemove', this.mouseMoveListener);

      // Define the click listener function
      this.clickListener = async (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const floatingMenu = document.getElementById('floating-menu-container');

        // Ignore clicks on the floating menu (overlay check removed)
        if (floatingMenu && floatingMenu.contains(target)) {
          console.log('[ScreenCapture] Clicked on ignored element (menu), ignoring capture.');
          return;
        }

        // Prevent default browser action and stop event bubbling *now*
        event.preventDefault();
        event.stopPropagation();

        // Capture coordinates and the highlighted element
        const clickX = event.clientX;
        const clickY = event.clientY;
        const selectedElement = this.currentHighlight; // Use the highlighted element

        console.log('[ScreenCapture] Element selected:', selectedElement);
        console.log(`[ScreenCapture] Click coordinates: X=${clickX}, Y=${clickY}`);

        // --- Get effective background color BEFORE removing highlight ---
        let effectiveBackgroundColor: string | null = null;
        if (selectedElement) {
            effectiveBackgroundColor = this.getEffectiveBackgroundColor(selectedElement);
            console.log('[ScreenCapture] Effective background color:', effectiveBackgroundColor);
        }
        // --- End get background color ---

        // --- Explicitly remove highlight styles BEFORE cleanup and outerHTML ---
        if (selectedElement) {
            console.log('[ScreenCapture] Explicitly removing highlight styles before capture.');
            selectedElement.style.removeProperty('outline');
            selectedElement.style.removeProperty('position');
            selectedElement.style.removeProperty('z-index');
        }
        // --- End explicit removal ---

        // Store callback before cleanup
        const callbackToExecute = this.captureCallback;

        // Cleanup listeners, overlay, cursor FIRST
        // Note: cleanup will call highlightElement(null) which also tries to remove styles,
        // but doing it explicitly above ensures it happens before outerHTML is read.
        this.cleanup(); // This also calls highlightElement(null) internally

        // Check if callback is still valid
        if (!callbackToExecute) {
          console.warn('[ScreenCapture] Callback became null after cleanup, aborting.');
          return;
        }

        let imageDataUrl: string | null = null;
        let selectedHtml: string | null = null;
        let selectedElementBounds: DOMRect | null = null;

        if (selectedElement) {
          selectedElementBounds = selectedElement.getBoundingClientRect(); // Get bounds

          // 1. Get HTML (Styles should definitely be removed now)
          try {
            selectedHtml = selectedElement.outerHTML;
            console.log('[ScreenCapture] Captured HTML:', selectedHtml ? selectedHtml.substring(0, 100) + '...' : 'null');
          } catch (e) {
            console.error('[ScreenCapture] Error getting outerHTML:', e);
            selectedHtml = null;
          }

          // 2. Capture Image using html2canvas
          console.log('[ScreenCapture] Attempting html2canvas capture of selected element...');
          try {
            const effectiveBackgroundColor = this.getEffectiveBackgroundColor(selectedElement);
            // html2canvas uses a clone, so the original element's state (styles removed) is fine.
            // The onclone callback is still good practice for the image generation itself.
            const canvas = await html2canvas(selectedElement, {
              backgroundColor: effectiveBackgroundColor,
              useCORS: true,
              logging: false,
              onclone: (clonedDoc, clonedElement) => {
                if (clonedElement) {
                    // Ensure clone definitely doesn't have styles for screenshot
                    clonedElement.style.removeProperty('outline');
                    clonedElement.style.removeProperty('position');
                    clonedElement.style.removeProperty('z-index');
                }
              }
            });
            imageDataUrl = canvas.toDataURL('image/png');
            console.log('[ScreenCapture] html2canvas capture successful.');
          } catch (error) {
            console.error('[ScreenCapture] html2canvas capture failed:', error);
            imageDataUrl = null;
          }
        } else {
          console.log('[ScreenCapture] No valid element was highlighted for capture.');
        }

        // Execute callback with results (including bounds, element, coordinates, and background color)
        console.log('[ScreenCapture] Executing capture callback...');
        try {
          // Pass all 7 arguments now
          callbackToExecute(imageDataUrl, selectedHtml, selectedElementBounds, selectedElement, clickX, clickY, effectiveBackgroundColor);
        } catch (callbackError) {
          console.error('[ScreenCapture] Error executing the capture callback:', callbackError);
        }
      };

      // Add the click listener with capture: true
      document.addEventListener('click', this.clickListener, { capture: true });
      console.log('[ScreenCapture] Event listeners initialized and waiting for selection.');

    } catch (error) {
      console.error('[ScreenCapture] Error initializing capture:', error);
      this.cleanup(); // Attempt cleanup if setup fails
      if (this.captureCallback) {
        // Call callback with nulls and default coords (0,0) on setup error
        try {
            // Pass all 7 arguments now
            this.captureCallback(null, null, null, null, 0, 0, null);
        } catch (callbackError) {
            console.error('[ScreenCapture] Error executing the capture callback during setup error:', callbackError);
        }
      }
    }
  }

  public cancelCapture(): void {
    console.log('[ScreenCapture] cancelCapture called.');
    if (this.isCapturing) {
      const callback = this.captureCallback; // Store before cleanup
      this.cleanup();

      // Call the callback with nulls and default coords (0,0) to indicate cancellation
      if (callback) {
        try {
            // Pass all 7 arguments now
            callback(null, null, null, null, 0, 0, null);
        } catch (callbackError) {
            console.error('[ScreenCapture] Error executing the capture callback during cancellation:', callbackError);
        }
      }
    }
  }
}

// Add CSS for the cursor directly to the document head (if not already done)
// Ensure this runs only once or check if style already exists
if (!document.getElementById('screen-capture-styles')) {
  const style = document.createElement('style');
  style.id = 'screen-capture-styles'; // Give it an ID to check for existence
  style.textContent = `
    body.capturing-mode, body.capturing-mode * {
      cursor: crosshair !important;
    }
  `;
  document.head.appendChild(style);
}

export const screenCapture = new ScreenCapture();