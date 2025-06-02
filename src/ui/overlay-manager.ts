import { customWarn } from '../utils/logger';

const OVERLAY_ID = 'checkra-controls-overlay';
const CONTROLS_CONTAINER_CLASS = 'checkra-fix-controls-container'; // Matches class in checkra.css

// This interface is used by OverlayManager to know what listeners to attach.
// It should ideally match or be compatible with the listeners object structure created in checkra-impl.ts.
interface ControlButtonListeners {
  close: EventListener;
  toggle: EventListener;
  copy: EventListener;
  rate?: EventListener; // Optional rate listener
}

export class OverlayManager {
  private overlayElement: HTMLDivElement | null = null;
  private controlsContainer: HTMLDivElement | null = null;
  private currentTargetElement: HTMLElement | null = null;
  private currentFixId: string | null = null;
  
  // Store direct references to the buttons currently in the controlsContainer for listener removal
  private currentButtons: {
    close?: HTMLButtonElement;
    toggle?: HTMLButtonElement;
    copy?: HTMLButtonElement;
    rate?: HTMLButtonElement;
  } = {};
  private currentListeners: ControlButtonListeners | null = null;

  private debouncedUpdatePosition: () => void;
  private debounceTimer: number | null = null;

  constructor(private debounceDelay: number = 50) {
    this.debouncedUpdatePosition = () => {
      if (this.debounceTimer) {
        window.clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = window.setTimeout(() => {
        if (this.currentTargetElement && this.controlsContainer && this.controlsContainer.style.display !== 'none') {
          customWarn('[OverlayManager] DebouncedUpdatePosition: Calling positionControls.');
          this.positionControls(this.currentTargetElement, this.controlsContainer);
        } else {
          customWarn('[OverlayManager] DebouncedUpdatePosition: Conditions not met to call positionControls.', {
            hasTarget: !!this.currentTargetElement,
            hasControls: !!this.controlsContainer,
            isDisplayed: this.controlsContainer ? this.controlsContainer.style.display !== 'none' : false
          });
        }
      }, this.debounceDelay);
    };
    this.initializeOverlay(); // Ensure overlay is ready on instantiation
  }

  private initializeOverlay(): void {
    if (document.getElementById(OVERLAY_ID)) {
      this.overlayElement = document.getElementById(OVERLAY_ID) as HTMLDivElement;
      Object.assign(this.overlayElement.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: '2147483646', 
        display: 'block',
      });
      return;
    }
    this.overlayElement = document.createElement('div');
    this.overlayElement.id = OVERLAY_ID;
    Object.assign(this.overlayElement.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '2147483646', 
      display: 'block',
    });
    document.body.appendChild(this.overlayElement);
  }

  private getControlsContainer(): HTMLDivElement {
    if (!this.overlayElement) {
      this.initializeOverlay();
    }
    if (!this.controlsContainer) {
        this.controlsContainer = document.createElement('div');
        this.controlsContainer.className = CONTROLS_CONTAINER_CLASS;
        Object.assign(this.controlsContainer.style, {
          position: 'absolute', 
          display: 'none',      
          pointerEvents: 'auto', 
        });
        this.overlayElement!.appendChild(this.controlsContainer);
    }
    return this.controlsContainer;
  }

  private positionControls(targetElement: HTMLElement, controlsEl: HTMLDivElement): void {
    const targetRect = targetElement.getBoundingClientRect();
    controlsEl.style.display = 'flex'; 

    const controlsHeight = controlsEl.offsetHeight;
    const bodyScrollTop = window.scrollY || document.documentElement.scrollTop;
    const bodyScrollLeft = window.scrollX || document.documentElement.scrollLeft;

    let top = targetRect.top + bodyScrollTop - controlsHeight - 8; // 8px margin above
    const left = targetRect.left + bodyScrollLeft + (targetRect.width / 2);

    if (top < bodyScrollTop + 5) { 
      top = targetRect.bottom + bodyScrollTop + 8; // 8px margin below
    }

    customWarn(`[OverlayManager] positionControls: TargetRectTop=${targetRect.top}, ScrollY=${bodyScrollTop}, CalcTop=${top}, CalcLeft=${left}`);

    controlsEl.style.top = `${top}px`;
    controlsEl.style.left = `${left}px`;
  }

  public showControls(
    fixId: string,
    targetElement: HTMLElement | null,
    buttons: {close: HTMLButtonElement, toggle: HTMLButtonElement, copy: HTMLButtonElement, rate?: HTMLButtonElement},
    listeners: ControlButtonListeners
  ): void {
    if (!targetElement) {
      customWarn(`[OverlayManager] No targetElement for fixId ${fixId}. Cannot show controls.`);
      this.hideControls();
      return;
    }

    const controls = this.getControlsContainer();
    controls.innerHTML = ''; 

    if (buttons.rate) controls.appendChild(buttons.rate);
    controls.appendChild(buttons.copy);
    controls.appendChild(buttons.toggle);
    controls.appendChild(buttons.close);
    
    if(this.currentListeners) {
      if(this.currentButtons.close) this.currentButtons.close.removeEventListener('click', this.currentListeners.close);
      if(this.currentButtons.toggle) this.currentButtons.toggle.removeEventListener('click', this.currentListeners.toggle);
      if(this.currentButtons.copy) this.currentButtons.copy.removeEventListener('click', this.currentListeners.copy);
      if(this.currentButtons.rate && this.currentListeners.rate) this.currentButtons.rate.removeEventListener('click', this.currentListeners.rate);
    }

    buttons.close.addEventListener('click', listeners.close);
    buttons.toggle.addEventListener('click', listeners.toggle);
    buttons.copy.addEventListener('click', listeners.copy);
    if (buttons.rate && listeners.rate) {
      buttons.rate.addEventListener('click', listeners.rate);
    }
    
    this.currentFixId = fixId;
    this.currentTargetElement = targetElement;
    this.currentListeners = listeners;
    this.currentButtons = buttons; 

    this.positionControls(targetElement, controls);
    controls.style.display = 'flex';

    customWarn('[OverlayManager] showControls: Adding scroll/resize listeners.');
    window.addEventListener('scroll', this.debouncedUpdatePosition, true);
    window.addEventListener('resize', this.debouncedUpdatePosition, true);
  }

  public hideControls(): void {
    if (this.controlsContainer) {
      this.controlsContainer.style.display = 'none';
      this.controlsContainer.innerHTML = '';
    }
    
    if(this.currentListeners) {
      if(this.currentButtons.close) this.currentButtons.close.removeEventListener('click', this.currentListeners.close);
      if(this.currentButtons.toggle) this.currentButtons.toggle.removeEventListener('click', this.currentListeners.toggle);
      if(this.currentButtons.copy) this.currentButtons.copy.removeEventListener('click', this.currentListeners.copy);
      if(this.currentButtons.rate && this.currentListeners.rate) this.currentButtons.rate.removeEventListener('click', this.currentListeners.rate);
    }

    this.currentTargetElement = null;
    this.currentFixId = null;
    this.currentListeners = null;
    this.currentButtons = {};

    customWarn('[OverlayManager] hideControls: Removing scroll/resize listeners.');
    window.removeEventListener('scroll', this.debouncedUpdatePosition, true);
    window.removeEventListener('resize', this.debouncedUpdatePosition, true);
  }
  
  public removeAllControlsAndOverlay(): void {
    this.hideControls(); 
    
    if (this.controlsContainer) {
      this.controlsContainer.remove();
      this.controlsContainer = null;
    }
    if (this.overlayElement) {
      this.overlayElement.remove();
      this.overlayElement = null;
    }
    if (this.debounceTimer) {
        window.clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
    }
  }

  // ADDED: Public getter for the overlay element itself
  public getOverlayElement(): HTMLDivElement | null {
    if (!this.overlayElement) {
      this.initializeOverlay(); // Should be initialized by constructor, but as a safeguard
    }
    return this.overlayElement;
  }

  // ADDED: Method to check if controls for a specific fix are currently visible
  public isFixControlsVisible(fixId: string): boolean {
    return !!(this.controlsContainer && 
              this.controlsContainer.style.display !== 'none' && 
              this.currentFixId === fixId);
  }

  // ADDED: Method to explicitly update the position of controls for a given fix and target
  public updateControlsPositionForFix(fixId: string, targetElement: HTMLElement): void {
    if (this.currentFixId === fixId && this.controlsContainer && targetElement) {
      this.currentTargetElement = targetElement; // Update the target element reference
      this.positionControls(targetElement, this.controlsContainer);
    } else {
      customWarn(`[OverlayManager] updateControlsPositionForFix called for non-active fixId (${fixId}) or missing elements.`);
    }
  }
} 