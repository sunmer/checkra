import { customWarn } from '../utils/logger';

const OVERLAY_ID = 'checkra-controls-overlay';
const CONTROLS_CONTAINER_CLASS = 'checkra-fix-controls-container';

// SVG Icons for controls
const CLOSE_SVG = '&times;';
const TOGGLE_SHOW_ORIGINAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
const TOGGLE_SHOW_FIX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const RATE_SVG = '★';

export interface ControlButtonCallbacks {
  onClose: () => void;
  onToggle: () => void;
  onCopy: () => void;
  onRate?: (anchorElement: HTMLElement) => void; // Anchor for positioning rating UI
}

interface FixControlElements {
  closeButton: HTMLButtonElement;
  toggleButton: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  rateButton?: HTMLButtonElement;
}

interface OverlayManagerFixData {
  controlsContainer: HTMLDivElement;
  targetElement: HTMLElement;
  buttons: FixControlElements;
  scrollUpdateHandler: () => void;
  debouncedResizeUpdateHandler: () => void;
  debounceTimer: number | null;
}

export class OverlayManager {
  private overlayElement: HTMLDivElement | null = null;
  private activeFixes: Map<string, OverlayManagerFixData> = new Map();
  private debounceDelay: number;

  constructor(debounceDelay: number = 50) {
    this.debounceDelay = debounceDelay;
    this.initializeOverlay();
  }

  private initializeOverlay(): void {
    if (document.getElementById(OVERLAY_ID)) {
      this.overlayElement = document.getElementById(OVERLAY_ID) as HTMLDivElement;
    } else {
      this.overlayElement = document.createElement('div');
      this.overlayElement.id = OVERLAY_ID;
      document.body.appendChild(this.overlayElement);
    }
    Object.assign(this.overlayElement.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '2147483646', // High z-index
      display: 'block',
    });
  }

  private createAndGetButtons(fixId: string, callbacks: ControlButtonCallbacks): FixControlElements {
    const closeButton = document.createElement('button');
    closeButton.innerHTML = CLOSE_SVG;
    closeButton.title = 'Discard Fix (Revert to Original)';
    closeButton.className = 'feedback-fix-btn checkra-close-btn';
    closeButton.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onClose(); });

    const toggleButton = document.createElement('button');
    toggleButton.innerHTML = TOGGLE_SHOW_ORIGINAL_SVG; // Initial: Fix is shown, button toggles to original
    toggleButton.title = 'Toggle Original Version';
    toggleButton.className = 'feedback-fix-btn checkra-toggle-btn toggled-on';
    toggleButton.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onToggle(); });

    const copyButton = document.createElement('button');
    copyButton.innerHTML = COPY_SVG;
    copyButton.title = 'Copy Prompt for This Fix';
    copyButton.className = 'feedback-fix-btn checkra-copy-btn';
    copyButton.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onCopy(); });

    let rateButton: HTMLButtonElement | undefined;
    if (callbacks.onRate) {
      rateButton = document.createElement('button');
      rateButton.innerHTML = RATE_SVG;
      rateButton.title = 'Rate This Fix';
      rateButton.className = 'feedback-fix-btn checkra-rate-btn';
      // Store callback in a variable to ensure correct closure capture
      const onRateCallback = callbacks.onRate;
      rateButton.addEventListener('click', (e) => {
        e.stopPropagation();
        onRateCallback(rateButton as HTMLButtonElement);
      });
    }
    return { closeButton, toggleButton, copyButton, rateButton };
  }

  private positionControls(fixId: string): void {
    const fixData = this.activeFixes.get(fixId);
    if (!fixData || !this.overlayElement) return;

    const { targetElement, controlsContainer } = fixData;
    const targetRect = targetElement.getBoundingClientRect();
    
    // Ensure controlsContainer is part of the overlay to get offsetHeight
    if (!controlsContainer.parentNode) {
        this.overlayElement.appendChild(controlsContainer); 
    }
    controlsContainer.style.display = 'flex'; // Make visible to measure

    const controlsHeight = controlsContainer.offsetHeight;
    const controlsWidth = controlsContainer.offsetWidth; // Get width for centering

    // Position relative to viewport
    let top = targetRect.top - controlsHeight - 8; // 8px margin above
    let left = targetRect.left + (targetRect.width / 2) - (controlsWidth / 2); // Centered

    // If too high (less than 5px from viewport top), position below target
    if (targetRect.top - controlsHeight - 8 < 5) {
      top = targetRect.bottom + 8; // 8px margin below
    }
    
    // Set fixed position
    controlsContainer.style.top = `${top}px`;
    controlsContainer.style.left = `${left}px`;

    customWarn(`[OverlayManager] positionControls for ${fixId}: TargetRectTop=${targetRect.top}, CalcTop=${top}, CalcLeft=${left}`);
  }

  public showControlsForFix(fixId: string, targetElement: HTMLElement, callbacks: ControlButtonCallbacks): void {
    if (!this.overlayElement) {
        customWarn('[OverlayManager] Overlay not initialized. Cannot show controls.');
        return;
    }

    let fixData = this.activeFixes.get(fixId);

    if (fixData) {
      // Controls already exist, update target and reposition
      fixData.targetElement = targetElement;
      this.positionControls(fixId); // Position immediately
      fixData.controlsContainer.style.display = 'flex';
      customWarn(`[OverlayManager] Controls for fixId ${fixId} already exist. Updated target and repositioned.`);
    } else {
      // Create new controls
      const controlsContainer = document.createElement('div');
      controlsContainer.className = CONTROLS_CONTAINER_CLASS;
      controlsContainer.setAttribute('data-checkra-fix-id', fixId);
      Object.assign(controlsContainer.style, {
        position: 'fixed', 
        display: 'none', 
        pointerEvents: 'auto',
      });

      const buttons = this.createAndGetButtons(fixId, callbacks);
      
      if (buttons.rateButton) controlsContainer.appendChild(buttons.rateButton);
      controlsContainer.appendChild(buttons.copyButton);
      controlsContainer.appendChild(buttons.toggleButton);
      controlsContainer.appendChild(buttons.closeButton);
      
      this.overlayElement.appendChild(controlsContainer);

      const newFixData: OverlayManagerFixData = {
        controlsContainer,
        targetElement,
        buttons,
        debounceTimer: null,
        scrollUpdateHandler: () => { // Direct call for scroll
          this.positionControls(fixId);
        },
        debouncedResizeUpdateHandler: () => { // Debounced call for resize
          if (newFixData.debounceTimer) {
            window.clearTimeout(newFixData.debounceTimer);
          }
          newFixData.debounceTimer = window.setTimeout(() => {
            this.positionControls(fixId);
          }, this.debounceDelay);
        },
      };
      this.activeFixes.set(fixId, newFixData);
      fixData = newFixData; 
      
      this.positionControls(fixId); 
      controlsContainer.style.display = 'flex'; 
      customWarn(`[OverlayManager] New controls created and shown for fixId: ${fixId}`);
    }
    
    // Add/ensure event listeners are active
    window.removeEventListener('scroll', fixData.scrollUpdateHandler, true); // Remove old one if any before adding
    window.addEventListener('scroll', fixData.scrollUpdateHandler, true);
    window.removeEventListener('resize', fixData.debouncedResizeUpdateHandler, true); // Remove old one if any before adding
    window.addEventListener('resize', fixData.debouncedResizeUpdateHandler, true);
  }

  public hideControlsForFix(fixId: string): void {
    const fixData = this.activeFixes.get(fixId);
    if (fixData) {
      window.removeEventListener('scroll', fixData.scrollUpdateHandler, true);
      window.removeEventListener('resize', fixData.debouncedResizeUpdateHandler, true);
      if (fixData.debounceTimer) {
        window.clearTimeout(fixData.debounceTimer);
      }
      fixData.controlsContainer.remove();
      this.activeFixes.delete(fixId);
      customWarn(`[OverlayManager] Controls hidden and cleaned up for fixId: ${fixId}`);
    } else {
      customWarn(`[OverlayManager] No active controls found for fixId ${fixId} to hide.`);
    }
  }

  public removeAllControlsAndOverlay(): void {
    this.activeFixes.forEach((fixData, fixId) => {
      window.removeEventListener('scroll', fixData.scrollUpdateHandler, true);
      window.removeEventListener('resize', fixData.debouncedResizeUpdateHandler, true);
      if (fixData.debounceTimer) {
        window.clearTimeout(fixData.debounceTimer);
      }
      fixData.controlsContainer.remove();
    });
    this.activeFixes.clear();

    if (this.overlayElement) {
      this.overlayElement.remove();
      this.overlayElement = null;
    }
    customWarn('[OverlayManager] All controls and overlay removed.');
  }

  public updateControlsPositionForFix(fixId: string, newTargetElement: HTMLElement): void {
    const fixData = this.activeFixes.get(fixId);
    if (fixData) {
      fixData.targetElement = newTargetElement;
      this.positionControls(fixId);
      customWarn(`[OverlayManager] Position updated for fixId ${fixId}`);
    } else {
      customWarn(`[OverlayManager] updateControlsPositionForFix: No active controls for fixId ${fixId}`);
    }
  }

  public isControlsVisible(fixId: string): boolean {
    const fixData = this.activeFixes.get(fixId);
    return !!(fixData && fixData.controlsContainer && fixData.controlsContainer.style.display !== 'none');
  }

  public updateToggleButtonVisuals(fixId: string, isCurrentlyFixed: boolean): void {
    const fixData = this.activeFixes.get(fixId);
    if (fixData && fixData.buttons.toggleButton) {
      const button = fixData.buttons.toggleButton;
      if (isCurrentlyFixed) {
        button.innerHTML = TOGGLE_SHOW_ORIGINAL_SVG;
        button.title = 'Toggle Original Version';
        button.classList.add('toggled-on');
      } else {
        button.innerHTML = TOGGLE_SHOW_FIX_SVG;
        button.title = 'Toggle Fixed Version';
        button.classList.remove('toggled-on');
      }
      customWarn(`[OverlayManager] Toggle button visuals updated for fixId ${fixId} to: ${isCurrentlyFixed ? 'Show Original (Fix ON)' : 'Show Fix (Fix OFF)'}`);
    } else {
      customWarn(`[OverlayManager] updateToggleButtonVisuals: Could not find toggle button for fixId ${fixId}`);
    }
  }

  // Getter for the main overlay element, e.g., for other UI components to avoid it
  public getOverlayElement(): HTMLDivElement | null {
    return this.overlayElement;
  }
}