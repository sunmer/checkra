import html2canvas from 'html2canvas';

const MIN_HEIGHT_FOR_INSERT_ZONES = 50; // Minimum element height in pixels for top/bottom 10% zones

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
    effectiveBackgroundColor: string | null,
    insertionMode: 'replace' | 'insertBefore' | 'insertAfter'
  ) => void) | null = null;
  private clickListener: ((event: MouseEvent) => Promise<void>) | null = null;
  private escapeListener: ((event: KeyboardEvent) => void) | null = null;
  private mouseMoveListener: ((event: MouseEvent) => void) | null = null;
  private isCapturing: boolean = false;
  private overlay: HTMLDivElement | null = null;
  private currentHighlight: HTMLElement | null = null;
  private viewerHoverListener: (() => void) | null = null;
  private viewerLeaveListener: (() => void) | null = null;
  private ignoreElement: HTMLElement | null = null;
  private plusIconElement: HTMLDivElement | null = null;
  private currentInsertionMode: 'replace' | 'insertBefore' | 'insertAfter' = 'replace';

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

    // Remove overlay - this.overlay seems unused, but cleanup is harmless
    if (this.overlay && this.overlay.parentNode) {
      document.body.removeChild(this.overlay);
      this.overlay = null;
    }
    
    // Ensure any active highlight is cleared
    this.clearHighlightAndIcon();

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

    if (this.plusIconElement && this.plusIconElement.parentNode) {
      this.plusIconElement.parentNode.removeChild(this.plusIconElement);
      this.plusIconElement = null;
    }

    this.isCapturing = false;
    this.captureCallback = null;
    this.ignoreElement = null;
  }

  private clearHighlightAndIcon(): void {
    if (this.currentHighlight) {
      this.currentHighlight.classList.remove('checkra-hover-top', 'checkra-hover-bottom', 'checkra-hover-middle', 'checkra-highlight-container');
      // Restore original styles if they were explicitly set and stored
      // For now, assuming classes handle everything. If direct style manipulation was done:
      // if (this.originalPosition !== null) this.currentHighlight.style.position = this.originalPosition; else this.currentHighlight.style.removeProperty('position');
      // if (this.originalZIndex !== null) this.currentHighlight.style.zIndex = this.originalZIndex; else this.currentHighlight.style.removeProperty('z-index');
      this.currentHighlight = null;
    }
    if (this.plusIconElement && this.plusIconElement.parentNode) {
      this.plusIconElement.parentNode.removeChild(this.plusIconElement);
      this.plusIconElement = null;
    }
  }

  private highlightElement(element: HTMLElement | null, event?: MouseEvent): void {
    if (this.currentHighlight === element && element && event) {
      const rect = element.getBoundingClientRect();
      const mouseYRelative = event.clientY - rect.top;
      const elementHeight = rect.height;
      let newMode: 'replace' | 'insertBefore' | 'insertAfter' = 'replace';

      if (elementHeight >= MIN_HEIGHT_FOR_INSERT_ZONES) {
        if (mouseYRelative < elementHeight * 0.1) {
          newMode = 'insertBefore';
        } else if (mouseYRelative > elementHeight * 0.9) {
          newMode = 'insertAfter';
        }
      } // If too short, newMode remains 'replace'

      if (this.currentInsertionMode !== newMode) {
        this.currentInsertionMode = newMode;
        // Update classes and icon
        element.classList.remove('checkra-hover-top', 'checkra-hover-bottom', 'checkra-hover-middle');
        if (this.plusIconElement && this.plusIconElement.parentNode) this.plusIconElement.remove();
        this.plusIconElement = null;

        if (newMode === 'insertBefore') {
          element.classList.add('checkra-hover-top');
          this.createPlusIcon('top', element);
        } else if (newMode === 'insertAfter') {
          element.classList.add('checkra-hover-bottom');
          this.createPlusIcon('bottom', element);
        } else {
          element.classList.add('checkra-hover-middle');
        }
      }
      return;
    }
    
    // Different element or no event, clear previous and highlight new
    this.clearHighlightAndIcon();

    if (!element || !event) { 
      this.currentInsertionMode = 'replace'; 
      return;
    }

    this.currentHighlight = element;
    element.classList.add('checkra-highlight-container');

    const rect = element.getBoundingClientRect();
    const mouseYRelative = event.clientY - rect.top;
    const elementHeight = rect.height;
    this.currentInsertionMode = 'replace'; // Default to replace

    if (elementHeight >= MIN_HEIGHT_FOR_INSERT_ZONES) {
      if (mouseYRelative < elementHeight * 0.1) {
        this.currentInsertionMode = 'insertBefore';
        element.classList.add('checkra-hover-top');
        this.createPlusIcon('top', element);
      } else if (mouseYRelative > elementHeight * 0.9) {
        this.currentInsertionMode = 'insertAfter';
        element.classList.add('checkra-hover-bottom');
        this.createPlusIcon('bottom', element);
      } else {
        // Middle 80% or too short for insert zones
        element.classList.add('checkra-hover-middle');
      }
    } else {
      // Element is too short, force middle/replace styling
      element.classList.add('checkra-hover-middle');
    }
  }
  
  private createPlusIcon(position: 'top' | 'bottom', parentElement: HTMLElement): void {
    if (!this.plusIconElement) {
      this.plusIconElement = document.createElement('div');
      this.plusIconElement.className = 'checkra-insert-indicator';
      this.plusIconElement.textContent = '+';
      document.body.appendChild(this.plusIconElement); // Append to body to ensure visibility
    }
    this.plusIconElement.classList.remove('top', 'bottom');
    this.plusIconElement.classList.add(position);

    const parentRect = parentElement.getBoundingClientRect();
    if (position === 'top') {
      this.plusIconElement.style.top = `${parentRect.top + window.scrollY - 11}px`; // 11 is half icon height
    } else { // bottom
      this.plusIconElement.style.top = `${parentRect.bottom + window.scrollY - 11}px`;
    }
    this.plusIconElement.style.left = `${parentRect.left + window.scrollX + parentRect.width / 2 - 11}px`; // 11 is half icon width
    this.plusIconElement.style.display = 'flex';
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
    effectiveBackgroundColor: string | null,
    insertionMode: 'replace' | 'insertBefore' | 'insertAfter'
  ) => void,
  elementToIgnore?: HTMLElement): void {
    if (this.isCapturing) {
      console.warn('[ScreenCapture] Capture already in progress. Ignoring request.');
      return;
    }

    this.captureCallback = callback;
    this.ignoreElement = elementToIgnore || null;
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
        const elementAtPoint = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        if (this.ignoreElement && elementAtPoint && this.ignoreElement.contains(elementAtPoint)) {
          if (this.currentHighlight && !this.ignoreElement.contains(this.currentHighlight)) {
            this.clearHighlightAndIcon(); 
          }
          return; 
        }

        // Pass event to highlightElement
        this.highlightElement(elementAtPoint, event);
      };
      document.addEventListener('mousemove', this.mouseMoveListener);

      // Define the click listener function
      this.clickListener = async (event: MouseEvent) => {
        const clickedElement = event.target as HTMLElement;

        if (this.ignoreElement && this.ignoreElement.contains(clickedElement)) {
          return; 
        }

        // Prevent default browser action and stop event bubbling *now* for non-ignored elements
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
          // No longer removing outline/position/zIndex here, clearHighlightAndIcon handles class removal
          // selectedElement.style.removeProperty('outline');
          // ... (keep removal of explicit styles if any were set, but rely on class removal mainly)
        } else {
          // console.warn('[ScreenCapture] No element was selected/highlighted at click time.');
        }
        // --- End explicit restoration ---

        // Store callback before cleanup
        const callbackToExecute = this.captureCallback;
        
        // Cleanup now removes highlight and icon
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
          // Pass all 8 arguments now
          callbackToExecute(imageDataUrl, selectedHtml, selectedElementBounds, selectedElement, clickX, clickY, effectiveBackgroundColor, this.currentInsertionMode);
        } catch (callbackError) {
          console.error('[ScreenCapture] Error executing the capture callback:', callbackError);
          // Pass all 8 arguments now
          callbackToExecute(null, null, null, null, 0, 0, null, 'replace'); // Default to replace on error
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
          document.body.classList.remove('capturing-mode');
        };
        this.viewerLeaveListener = () => {
          // Re-apply crosshair only if capture is still active
          if (this.isCapturing) {
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
          // Pass all 8 arguments now
          this.captureCallback(null, null, null, null, 0, 0, null, 'replace'); // Default to replace on error
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
          // Pass all 8 arguments now
          callback(null, null, null, null, 0, 0, null, 'replace'); // Default to replace on cancel
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

    /* New styles for insertion indicators */
    .checkra-highlight-container {
      position: relative !important; /* Ensure this is applied */
      /* outline: none !important; /* May not be needed if specific borders are used */
    }

    .checkra-insert-indicator {
      position: absolute !important;
      background-color: #007bff !important;
      color: white !important;
      width: 22px !important;
      height: 22px !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 18px !important;
      font-weight: bold !important;
      z-index: 2147483647 !important; /* Max z-index */
      pointer-events: none !important;
      box-shadow: 0 0 5px rgba(0,0,0,0.5) !important;
    }

    /* The JS sets exact top coordinate; the classes are kept for identification only */
    .checkra-insert-indicator.top {
    }

    .checkra-insert-indicator.bottom {
    }
    
    /* Transient hover effects from screenCapture.ts */
    .checkra-hover-top {
      outline: none !important;
      border-top: 2px dashed #007bff !important;
    }

    .checkra-hover-bottom {
      outline: none !important;
      border-bottom: 2px dashed #007bff !important;
    }

    .checkra-hover-middle {
      outline: 2px solid #0095ff !important; /* Original blue outline for replace hover */
    }

    /* Persistent selection highlight styles from FeedbackViewerImpl.ts */
    .checkra-selected-insert-before {
      outline: none !important;
      border-top: 2px solid #007bff !important; /* Solid line for selection */
    }

    .checkra-selected-insert-after {
      outline: none !important;
      border-bottom: 2px solid #007bff !important; /* Solid line for selection */
    }

    .checkra-selected-replace {
      outline: 2px solid #0095ff !important; /* Consistent with middle hover */
    }
  `;
  document.head.appendChild(style);
}

export const screenCapture = new ScreenCapture();