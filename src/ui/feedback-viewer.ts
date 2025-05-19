import { FeedbackViewerDOM } from './feedback-viewer-dom';
import { FeedbackViewerImpl } from './feedback-viewer-impl';
import { SettingsModal } from './settings-modal';
import { eventEmitter } from '../core/index'; // Ensure this path is correct

const PANEL_CLOSED_BY_USER_KEY = 'checkra_panel_explicitly_closed'; // Keep this key

export default class FeedbackViewer {
  private feedbackViewerDOM: FeedbackViewerDOM;
  private feedbackViewerImpl: FeedbackViewerImpl;
  private settingsModal: SettingsModal;
  private static instance: FeedbackViewer | null = null;

  private constructor(settingsModal: SettingsModal) {
    
    console.log('[FeedbackViewer] Constructor called.');
    this.feedbackViewerDOM = new FeedbackViewerDOM();
    this.settingsModal = settingsModal;
    this.feedbackViewerImpl = new FeedbackViewerImpl(this.handleToggle.bind(this));
    this.feedbackViewerImpl.initialize(this.feedbackViewerDOM, this.settingsModal);

    // Toast Logic
    try {
      const panelWasClosed = localStorage.getItem(PANEL_CLOSED_BY_USER_KEY);
      console.log(`[FeedbackViewer] Checked PANEL_CLOSED_BY_USER_KEY: ${panelWasClosed}`);
      if (panelWasClosed === 'true') {
        // Delay toast slightly to ensure page has settled
        setTimeout(() => this.showAvailabilityToast(), 250);
      }
    } catch (e) {
      console.warn('[FeedbackViewer] Failed to check localStorage for panel state:', e);
    }

    console.log('[FeedbackViewer] Initialized.');
  }

  public static getInstance(settingsModal: SettingsModal): FeedbackViewer {
    if (!FeedbackViewer.instance) {
      if (!settingsModal) {
          console.error('[FeedbackViewer] getInstance called without settingsModal for new instance creation!');
          throw new Error('SettingsModal instance is required to create a new FeedbackViewer instance.');
      }
      FeedbackViewer.instance = new FeedbackViewer(settingsModal);
    }
    return FeedbackViewer.instance;
  }

  private handleToggle(isVisible: boolean): void {
    // This callback can be used for other components to react to visibility changes
    console.log(`[FeedbackViewer] Panel visibility changed to: ${isVisible}`);
    if (isVisible) {
      eventEmitter.emit('viewerDidShow');
    } else {
      eventEmitter.emit('viewerDidHide');
    }
  }

  // Toast Method
  private showAvailabilityToast(): void {
    const toastId = 'checkra-availability-toast';
    if (document.getElementById(toastId)) return; // Prevent multiple toasts

    const toast = document.createElement('div');
    toast.id = toastId;
    // const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0; // No longer needed for specific OS keys
    // const shortcutText = isMac ? '⌘ L' : 'Ctrl L'; // Old shortcut
    const shortcutText = 'Shift twice quickly'; // New shortcut text
    toast.textContent = `Checkra is available. Press ${shortcutText} to open.`; // Updated phrasing

    document.body.appendChild(toast);

    // Force a reflow for the animation to apply correctly on add
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    toast.offsetHeight;

    toast.classList.add('visible');

    setTimeout(() => {
      toast.classList.remove('visible');
      toast.classList.add('hiding');
      // Remove after fade out animation (e.g., 0.5s)
      setTimeout(() => {
        toast.remove();
      }, 500); 
    }, 2000); // Toast visible for 4.5s, then starts fading out
  }

  /**
   * Shows the feedback viewer panel.
   * This method might be called externally if direct control is needed.
   */
  public showPanel(): void {
    if (!this.feedbackViewerImpl.getIsVisible()) {
        this.feedbackViewerImpl.toggle(); // This will call showFromApi internally
    }
  }

  /**
   * Hides the feedback viewer panel.
   * This method might be called externally if direct control is needed.
   */
  public hidePanel(): void {
    if (this.feedbackViewerImpl.getIsVisible()) {
        this.feedbackViewerImpl.hide(false); // Programmatic hide
    }
  }

  /**
   * Destroys the feedback viewer instance, removing elements and listeners.
   * Added to match the public API expected by src/core/index.ts
   */
  public destroy(): void {
    this.feedbackViewerImpl.cleanup(); 
    this.feedbackViewerDOM.destroy();   
    FeedbackViewer.instance = null;
    console.log('[FeedbackViewer] Destroyed.');
  }
} 