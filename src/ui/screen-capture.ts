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
  private originalPosition: string | null = null;
  private originalZIndex: string | null = null;
  private viewerHoverListener: (() => void) | null = null;
  private viewerLeaveListener: (() => void) | null = null;

  private cleanup(): void {
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

    // Remove viewer hover/leave listeners
    const viewerElement = document.getElementById('checkra-feedback-viewer');
    if (this.viewerHoverListener && viewerElement) {
      viewerElement.removeEventListener('mouseenter', this.viewerHoverListener);
      this.viewerHoverListener = null;
    }
    if (this.viewerLeaveListener && viewerElement) {
      viewerElement.removeEventListener('mouseleave', this.viewerLeaveListener);
      this.viewerLeaveListener = null;
    }

    this.isCapturing = false;
    this.captureCallback = null;
  }

  private highlightElement(element: HTMLElement | null): void {
    if (this.currentHighlight) {
      const targetElement = this.currentHighlight;

      targetElement.style.removeProperty('outline');

      const positionToRestore = this.originalPosition; // Capture value for logging
      if (positionToRestore !== null) {
        targetElement.style.position = positionToRestore;
      } else {
        targetElement.style.removeProperty('position');
      }

      // --- Restore Z-Index ---
      const zIndexToRestore = this.originalZIndex; // Capture value for logging
      if (zIndexToRestore !== null) {
        targetElement.style.zIndex = zIndexToRestore;
      } else {
        targetElement.style.removeProperty('z-index');
      }

      // --- Reset ---
      this.currentHighlight = null;
      this.originalPosition = null;
      this.originalZIndex = null;
    }
    // --- End remove previous highlight ---

    // If the new element is null, just return
    if (!element) {
      return;
    }

    // --- Apply new highlight ---
    this.currentHighlight = element;

    // --- Store original styles BEFORE applying highlight ---
    this.originalPosition = element.style.position || null;
    this.originalZIndex = element.style.zIndex || null;

    // --- Apply highlighting styles ---
    element.style.outline = '2px solid #0095ff';
    element.style.position = 'relative';
    element.style.zIndex = '101';
    // --- End apply new highlight ---
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
    bounds: DOMRect | null,
    targetElement: Element | null,
    clickX: number,
    clickY: number,
    effectiveBackgroundColor: string | null
  ) => void): void {
    if (this.isCapturing) {
      console.warn('[ScreenCapture] Capture already in progress. Ignoring request.');
      return;
    }

    this.captureCallback = callback;
    this.isCapturing = true;
    document.body.classList.add('capturing-mode');

    try {

      // Set up escape key handler
      this.escapeListener = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          this.cancelCapture();
        }
      };
      document.addEventListener('keydown', this.escapeListener);

      // Set up mousemove handler to highlight elements under cursor
      this.mouseMoveListener = (event: MouseEvent) => {
        // Use elementFromPoint for better accuracy in complex layouts
        const elementAtPoint = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        const target = elementAtPoint;
        if (target && target !== this.currentHighlight) {
          this.highlightElement(target);
        }
      };
      document.addEventListener('mousemove', this.mouseMoveListener);

      // Define the click listener function
      this.clickListener = async (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const floatingMenu = document.getElementById('checkra-floating-menu-container');

        // Ignore clicks on the floating menu (overlay check removed)
        if (floatingMenu && floatingMenu.contains(target)) {
          return;
        }

        // Prevent default browser action and stop event bubbling *now*
        event.preventDefault();
        event.stopPropagation();

        // Capture coordinates and the highlighted element
        const clickX = event.clientX;
        const clickY = event.clientY;
        const selectedElement = this.currentHighlight; // Use the highlighted element


        // --- Get effective background color BEFORE removing highlight ---
        let effectiveBackgroundColor: string | null = null;
        if (selectedElement) {
          effectiveBackgroundColor = this.getEffectiveBackgroundColor(selectedElement);
        }
        // --- End get background color ---

        // --- Explicitly restore styles BEFORE cleanup and outerHTML ---
        if (selectedElement) {
          const targetId = selectedElement.id || selectedElement.tagName;
          if (targetId === 'checkra-floating-menu-container') {
            console.warn('[ScreenCapture Click] !!! Restoring styles for floating menu container in click listener !!!');
          }

          selectedElement.style.removeProperty('outline');

          // --- Restore Position ---
          const positionToRestore = this.originalPosition;
          if (positionToRestore !== null) {
            selectedElement.style.position = positionToRestore;
          } else {
            selectedElement.style.removeProperty('position');
          }

          // --- Restore Z-Index ---
          const zIndexToRestore = this.originalZIndex;
          if (zIndexToRestore !== null) {
            selectedElement.style.zIndex = zIndexToRestore;
          } else {
            selectedElement.style.removeProperty('z-index');
          }

          // --- Reset stored originals ---
          this.originalPosition = null;
          this.originalZIndex = null;
        } else {
        }
        // --- End explicit restoration ---

        // Store callback before cleanup
        const callbackToExecute = this.captureCallback;

        this.cleanup(); 

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
          } catch (e) {
            console.error('[ScreenCapture] Error getting outerHTML:', e);
            selectedHtml = null;
          }

          // 2. Capture Image using html2canvas
          try {
            const effectiveBackgroundColor = this.getEffectiveBackgroundColor(selectedElement);
            // html2canvas uses a clone, so the original element's state (styles removed) is fine.
            // The onclone callback is still good practice for the image generation itself.
            const canvas = await html2canvas(selectedElement, {
              backgroundColor: effectiveBackgroundColor,
              useCORS: true,
              logging: false,
              onclone: (_clonedDoc, clonedElement) => {
                if (clonedElement) {
                  // Ensure clone definitely doesn't have styles for screenshot
                  clonedElement.style.removeProperty('outline');
                  clonedElement.style.removeProperty('position');
                  clonedElement.style.removeProperty('z-index');
                }
              }
            });
            imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
          } catch (error) {
            console.error('[ScreenCapture] html2canvas capture failed:', error);
            imageDataUrl = null;
          }
        } else {
        }

        // Execute callback with results (including bounds, element, coordinates, and background color)
        try {
          // Pass all 7 arguments now
          callbackToExecute(imageDataUrl, selectedHtml, selectedElementBounds, selectedElement, clickX, clickY, effectiveBackgroundColor);
        } catch (callbackError) {
          console.error('[ScreenCapture] Error executing the capture callback:', callbackError);
        }

        // Call cleanup AFTER restoring styles
        this.cleanup();
      };

      // Add the click listener with capture: true
      document.addEventListener('click', this.clickListener, { capture: true });

      // Add listeners for mouse entering/leaving the feedback viewer panel
      const viewerElement = document.getElementById('checkra-feedback-viewer');
      if (viewerElement) {
        this.viewerHoverListener = () => {
          console.log('[ScreenCapture] Mouse entered viewer, removing crosshair.');
          document.body.classList.remove('capturing-mode');
        };
        this.viewerLeaveListener = () => {
          // Re-apply crosshair only if capture is still active
          if (this.isCapturing) {
            console.log('[ScreenCapture] Mouse left viewer, restoring crosshair.');
            document.body.classList.add('capturing-mode');
          }
        };

        viewerElement.addEventListener('mouseenter', this.viewerHoverListener);
        viewerElement.addEventListener('mouseleave', this.viewerLeaveListener);
      } else {
        console.warn('[ScreenCapture] Could not find viewer element to attach hover listeners.');
      }

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
  style.id = 'checkra-screen-capture-styles'; // Give it an ID to check for existence
  style.textContent = `
    body.capturing-mode, body.capturing-mode * {
      cursor: crosshair !important;
    }
  `;
  document.head.appendChild(style);
}

export const screenCapture = new ScreenCapture();