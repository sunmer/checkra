import { FeedbackViewerDOM } from './feedback-viewer-dom';
import { FeedbackViewerImpl } from './feedback-viewer-impl';
import { SettingsModal } from './settings-modal';

/**
 * Main class coordinating the Feedback Viewer's DOM and Logic.
 */
class FeedbackViewer {
  private domManager: FeedbackViewerDOM;
  private logicManager: FeedbackViewerImpl;
  private isInitialized: boolean = false;
  private static instance: FeedbackViewer | null = null;

  private constructor(
    settingsModal: SettingsModal
  ) {
    this.domManager = new FeedbackViewerDOM();
    this.logicManager = new FeedbackViewerImpl(this.handleToggle.bind(this));
    
    // Pass domManager and settingsModal to initialize
    // Impl.initialize will call domManager.create() internally
    this.logicManager.initialize(this.domManager, settingsModal);
    
    this.isInitialized = true;
    console.log('[FeedbackViewerCoordinator] Initialized.');
  }

  /**
   * Gets the singleton instance of the Coordinator.
   */
  public static getInstance(settingsModal: SettingsModal): FeedbackViewer {
    if (!FeedbackViewer.instance) {
      if (!settingsModal) {
        console.error('[FeedbackViewerCoordinator] Cannot create instance without SettingsModal.');
        throw new Error('SettingsModal instance is required to initialize FeedbackViewerCoordinator');
      }
      FeedbackViewer.instance = new FeedbackViewer(settingsModal);
    }
    return FeedbackViewer.instance;
  }

  /**
   * Toggles the visibility of the feedback viewer.
   */
  public toggle(): void {
    if (this.logicManager.getIsVisible()) {
      console.log('[Coordinator.toggle] Panel is visible, calling hide.');
      this.logicManager.hide();
    } else {
      console.log('[Coordinator.toggle] Panel is hidden, deciding how to show.');
      const firstRun = !localStorage.getItem('checkra_onboarded');
      if (firstRun) {
        console.log('[Coordinator.toggle] First run, showing onboarding.');
        // showOnboarding in Impl will call domManager.show() and set its state
        this.logicManager.showOnboarding(); 
        // localStorage.setItem('checkra_onboarded', '1'); // This is now set inside Impl.showOnboarding
      } else {
        console.log('[Coordinator.toggle] Not first run, calling prepareForInput.');
        // prepareForInput in Impl will call domManager.show() and set its state
        this.logicManager.prepareForInput(null, null, null, null); 
      }
    }
  }

  /**
   * Shows the onboarding view.
   */
  public showOnboarding(): void {
    this.logicManager.showOnboarding();
  }

  /**
   * Shows the feedback input area, positioned relative to the target element.
   * @param imageDataUrl - Base64 encoded image data URL or null.
   * @param selectedHtml - The HTML string of the selected element or null.
   * @param targetRect - The DOMRect of the target element for positioning.
   * @param targetElement - The target DOM element itself.
   */
  public showInputArea(
    imageDataUrl: string | null,
    selectedHtml: string | null,
    targetRect: DOMRect | null,
    targetElement: Element | null
  ): void {
    this.logicManager.prepareForInput(imageDataUrl, selectedHtml, targetRect, targetElement);
  }

  /**
   * Updates the response area with a chunk of streamed text.
   * @param chunk - The text chunk received from the stream.
   */
  public updateResponse(chunk: string): void {
    this.logicManager.updateResponse(chunk);
  }

  /**
   * Renders a prepended HTML message (e.g., warning, info) in a dedicated area.
   * @param html - The HTML string to render.
   */
  public renderUserMessage(html: string): void {
    this.logicManager.renderUserMessage(html);
  }

  /**
   * Finalizes the response stream, enabling inputs and showing action buttons if applicable.
   */
  public finalizeResponse(): void {
    this.logicManager.finalizeResponse();
  }

  /**
   * Displays an error message in the response area.
   * @param error - The error message string or Error object.
   */
  public showError(error: Error | string): void {
    this.logicManager.showError(error);
  }

  /**
   * Hides the feedback viewer panel and resets its state.
   */
  public hide(): void {
    this.logicManager.hide();
  }

  /**
   * Destroys the feedback viewer instance, removing elements and listeners.
   */
  public destroy(): void {
    this.logicManager.cleanup(); // Clean up logic listeners first
    this.domManager.destroy();   // Then destroy DOM elements
    this.isInitialized = false;
    console.log('[FeedbackViewerCoordinator] Destroyed.');
  }

  // Add a handler that can be passed to the logic manager
  private handleToggle(isVisible: boolean): void {
    console.log(`[Coordinator] Toggle requested. New visibility: ${isVisible}`);
    // This callback might be used for notifying other parts of the system
    // or could directly call logicManager.toggle() if needed, 
    // but logicManager handles its own toggle logic internally.
  }
}

// Export the class itself so getInstance can be called externally
export default FeedbackViewer;