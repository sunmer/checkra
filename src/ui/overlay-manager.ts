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
  onRate?: (anchorElement: HTMLElement) => void;
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
  appliedFixWrapperElement: HTMLElement;
  buttons: FixControlElements;
}

export class OverlayManager {
  private overlayElement: HTMLDivElement | null = null;
  private activeFixes: Map<string, OverlayManagerFixData> = new Map();

  constructor() {
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
      width: '0',
      height: '0',
      pointerEvents: 'none',
      zIndex: '2147483640',
      display: 'block',
    });
  }

  private createAndGetButtons(fixId: string, callbacks: ControlButtonCallbacks): FixControlElements {
    const closeButton = document.createElement('button');
    closeButton.innerHTML = CLOSE_SVG;
    closeButton.title = 'Discard Fix (Revert to Original)';
    closeButton.className = 'checkra-feedback-fix-btn checkra-close-btn';
    closeButton.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onClose(); });

    const toggleButton = document.createElement('button');
    toggleButton.innerHTML = TOGGLE_SHOW_ORIGINAL_SVG;
    toggleButton.title = 'Toggle Original Version';
    toggleButton.className = 'checkra-feedback-fix-btn checkra-toggle-btn toggled-on';
    toggleButton.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onToggle(); });

    const copyButton = document.createElement('button');
    copyButton.innerHTML = COPY_SVG;
    copyButton.title = 'Copy Prompt for This Fix';
    copyButton.className = 'checkra-feedback-fix-btn checkra-copy-btn';
    copyButton.addEventListener('click', (e) => { e.stopPropagation(); callbacks.onCopy(); });

    let rateButton: HTMLButtonElement | undefined;
    if (callbacks.onRate) {
      rateButton = document.createElement('button');
      rateButton.innerHTML = RATE_SVG;
      rateButton.title = 'Rate This Fix';
      rateButton.className = 'checkra-feedback-fix-btn checkra-rate-btn';
      const onRateCallback = callbacks.onRate;
      rateButton.addEventListener('click', (e) => {
        e.stopPropagation();
        onRateCallback(rateButton as HTMLButtonElement);
      });
    }
    return { closeButton, toggleButton, copyButton, rateButton };
  }

  private positionControlsOnce(controlsContainer: HTMLDivElement, appliedFixWrapperElement: HTMLElement): void {
    controlsContainer.style.display = 'flex'; 
    const controlsHeight = controlsContainer.offsetHeight;

    const wrapperRect = appliedFixWrapperElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceAbove = wrapperRect.top;
    const spaceBelow = viewportHeight - wrapperRect.bottom;
    const margin = 8;

    let topStyle: string;
    let transformStyle = 'translateX(-50%)';

    if (spaceAbove > controlsHeight + margin || (spaceAbove > spaceBelow && spaceBelow < controlsHeight + margin)) {
      topStyle = `-${margin + controlsHeight}px`;
    } else {
      topStyle = `${wrapperRect.height + margin}px`;
    }
    
    controlsContainer.style.left = '50%';
    controlsContainer.style.top = topStyle;
    controlsContainer.style.transform = transformStyle;
  }

  public showControlsForFix(
    fixId: string,
    targetElement: HTMLElement,
    appliedFixWrapperElement: HTMLElement,
    callbacks: ControlButtonCallbacks
  ): void {
    if (!appliedFixWrapperElement) {
        customWarn('[OverlayManager] Applied fix wrapper element not provided. Cannot show controls.');
        return;
    }
    if (getComputedStyle(appliedFixWrapperElement).position === 'static') {
        appliedFixWrapperElement.style.position = 'relative';
    }

    let fixData = this.activeFixes.get(fixId);

    if (fixData) {
      fixData.targetElement = targetElement;
      fixData.appliedFixWrapperElement = appliedFixWrapperElement;
      
      if (fixData.controlsContainer.parentElement !== appliedFixWrapperElement) {
          appliedFixWrapperElement.appendChild(fixData.controlsContainer);
      }
      this.positionControlsOnce(fixData.controlsContainer, appliedFixWrapperElement);
      fixData.controlsContainer.style.display = 'flex';
      customWarn(`[OverlayManager] Controls for fixId ${fixId} re-targeted and repositioned.`);
    } else {
      const controlsContainer = document.createElement('div');
      controlsContainer.className = CONTROLS_CONTAINER_CLASS;
      controlsContainer.setAttribute('data-checkra-fix-id', fixId);
      Object.assign(controlsContainer.style, {
        position: 'absolute',
        pointerEvents: 'auto',
      });

      const buttons = this.createAndGetButtons(fixId, callbacks);
      
      if (buttons.rateButton) controlsContainer.appendChild(buttons.rateButton);
      controlsContainer.appendChild(buttons.copyButton);
      controlsContainer.appendChild(buttons.toggleButton);
      controlsContainer.appendChild(buttons.closeButton);
      
      appliedFixWrapperElement.appendChild(controlsContainer);

      const newFixData: OverlayManagerFixData = {
        controlsContainer,
        targetElement,
        appliedFixWrapperElement,
        buttons,
      };
      this.activeFixes.set(fixId, newFixData);
      fixData = newFixData;
      
      this.positionControlsOnce(controlsContainer, appliedFixWrapperElement);
      controlsContainer.style.display = 'flex'; 
      customWarn(`[OverlayManager] New controls created and shown for fixId: ${fixId}`);
    }
  }

  public hideControlsForFix(fixId: string): void {
    const fixData = this.activeFixes.get(fixId);
    if (fixData) {
      fixData.controlsContainer.remove();
      this.activeFixes.delete(fixId);
      customWarn(`[OverlayManager] Controls hidden and cleaned up for fixId: ${fixId}`);
    } else {
      customWarn(`[OverlayManager] No active controls found for fixId ${fixId} to hide.`);
    }
  }

  public removeAllControlsAndOverlay(): void {
    this.activeFixes.forEach((fixData) => {
      fixData.controlsContainer.remove();
    });
    this.activeFixes.clear();

    if (this.overlayElement) {
      this.overlayElement.remove();
      this.overlayElement = null;
    }
    customWarn('[OverlayManager] All controls removed. Global overlay (if any) also removed.');
  }

  public isControlsVisible(fixId: string): boolean {
    const fixData = this.activeFixes.get(fixId);
    return !!(fixData && fixData.controlsContainer && fixData.controlsContainer.offsetParent !== null);
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

  public getOverlayElement(): HTMLDivElement | null {
    return this.overlayElement;
  }
}