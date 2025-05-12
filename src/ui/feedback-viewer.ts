import { FeedbackViewerDOM } from './feedback-viewer-dom';
import { FeedbackViewerImpl } from './feedback-viewer-impl';

/**
 * Main class coordinating the Feedback Viewer's DOM and Logic.
 */
class FeedbackViewerCoordinator {
  private domManager: FeedbackViewerDOM;
  private logicManager: FeedbackViewerImpl;
  private isInitialized = false;

  constructor() {
    this.domManager = new FeedbackViewerDOM();
    this.logicManager = new FeedbackViewerImpl();
  }

  private initializeIfNeeded(): void {
    if (!this.isInitialized) {
      const elements = this.domManager.create(); // Create DOM elements
      this.logicManager.initialize(elements, this.domManager); // Initialize logic with elements and DOM manager ref
      this.isInitialized = true;
      console.log('[FeedbackViewerCoordinator] Initialized.');
    }
  }

  /**
   * Toggles the visibility of the feedback viewer.
   */
  public toggle(): void {
    this.initializeIfNeeded(); // Ensure initialized before toggling

    if (this.logicManager.isVisible()) {
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
    this.initializeIfNeeded();
    console.log('[Coordinator.showOnboarding] Calling logicManager.showOnboarding.');
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
    this.initializeIfNeeded();
    console.log('[Coordinator.showInputArea] Calling logicManager.prepareForInput.');
    this.logicManager.prepareForInput(imageDataUrl, selectedHtml, targetRect, targetElement);
  }

  /**
   * Updates the response area with a chunk of streamed text.
   * @param chunk - The text chunk received from the stream.
   */
  public updateResponse(chunk: string): void {
    if (!this.isInitialized) {
      console.warn("[FeedbackViewerCoordinator] updateResponse called before initialization.");
      return;
    }
    this.logicManager.updateResponse(chunk);
  }

  /**
   * Renders a prepended HTML message (e.g., warning, info) in a dedicated area.
   * @param html - The HTML string to render.
   */
  public renderUserMessage(html: string): void {
    if (!this.isInitialized) {
      console.warn("[FeedbackViewerCoordinator] renderUserMessage called before initialization.");
      // Initialize if needed, as this might be the first visible output
      this.initializeIfNeeded();
    }
    this.logicManager.renderUserMessage(html);
  }

  /**
   * Finalizes the response stream, enabling inputs and showing action buttons if applicable.
   */
  public finalizeResponse(): void {
    if (!this.isInitialized) {
      console.warn("[FeedbackViewerCoordinator] finalizeResponse called before initialization.");
      return;
    }
    this.logicManager.finalizeResponse();
  }

  /**
   * Displays an error message in the response area.
   * @param error - The error message string or Error object.
   */
  public showError(error: Error | string): void {
    // Allow showing errors even if initialization didn't fully complete via showInputArea
    this.initializeIfNeeded();
    this.logicManager.showError(error);
  }

  /**
   * Hides the feedback viewer panel and resets its state.
   */
  public hide(): void {
    if (!this.isInitialized) return; // Nothing to hide if not initialized
    this.logicManager.hide();
  }

  /**
   * Destroys the feedback viewer instance, removing elements and listeners.
   */
  public destroy(): void {
    if (!this.isInitialized) return;
    this.logicManager.cleanup(); // Clean up logic listeners first
    this.domManager.destroy();   // Then destroy DOM elements
    this.isInitialized = false;
    console.log('[FeedbackViewerCoordinator] Destroyed.');
  }
}

// Export a single instance
export const feedbackViewer = new FeedbackViewerCoordinator();