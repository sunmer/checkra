import { FeedbackViewerDOM } from './feedback-viewer-dom';
import { FeedbackViewerImpl } from './feedback-viewer-impl';
import { SettingsModal } from './settings-modal';
import { eventEmitter } from '../core/index'; // Corrected: eventEmitter is exported from core/index.ts


export default class FeedbackViewer {
  private feedbackViewerDOM: FeedbackViewerDOM;
  private feedbackViewerImpl: FeedbackViewerImpl;
  private settingsModal: SettingsModal;
  private static instance: FeedbackViewer | null = null;
  private initialVisibility: boolean; // Store initial visibility

  private constructor(settingsModal: SettingsModal, initialVisibility: boolean = false) {
    this.settingsModal = settingsModal;
    this.initialVisibility = initialVisibility;
    this.feedbackViewerDOM = new FeedbackViewerDOM();
    // Pass initialVisibility to FeedbackViewerImpl constructor
    this.feedbackViewerImpl = new FeedbackViewerImpl(this.handleToggle.bind(this), this.initialVisibility);
    
    // Listen for core requests to show/hide
    eventEmitter.on('showViewerRequest', this.boundShowRequested);
    eventEmitter.on('hideViewerRequest', this.boundHideRequested);

    // Initialize FeedbackViewerImpl AFTER setting up the listener
    // The Impl will decide based on its initialVisibility and localStorage if it should show itself.
    this.feedbackViewerImpl.initialize(this.feedbackViewerDOM, this.settingsModal);

  }

  // Bound methods for event listeners
  private boundShowRequested = () => this.showPanel();
  private boundHideRequested = () => this.hidePanel();

  public static getInstance(settingsModal: SettingsModal, initialVisibility: boolean = false): FeedbackViewer {
    if (!FeedbackViewer.instance) {
      if (!settingsModal) {
          console.error('[FeedbackViewer] getInstance called without settingsModal for new instance creation!');
          throw new Error('SettingsModal instance is required to create a new FeedbackViewer instance.');
      }
      FeedbackViewer.instance = new FeedbackViewer(settingsModal, initialVisibility);
    }
    // If instance exists, should we update its visibility or warn if initialVisibility differs?
    // For now, it returns the existing instance. The initial visibility is set at creation.
    return FeedbackViewer.instance;
  }

  private handleToggle(isVisible: boolean): void {
    if (isVisible) {
      eventEmitter.emit('viewerDidShow');
    } else {
      eventEmitter.emit('viewerDidHide');
    }
  }

  /**
   * Shows the feedback viewer panel by calling the implementation's method.
   */
  public showPanel(): void {
    // this.feedbackViewerImpl.showFromApi(); // Let Impl decide if it was user initiated or not
    this.feedbackViewerImpl.showFromApi(false); // false indicates not user-initiated (e.g. from shortcut or API)
  }

  /**
   * Hides the feedback viewer panel by calling the implementation's method.
   */
  public hidePanel(): void {
    this.feedbackViewerImpl.hide(false); // Programmatic hide, not initiated by user interaction on close button
  }

  /**
   * Destroys the feedback viewer instance, removing elements and listeners.
   */
  public destroy(): void {
    eventEmitter.off('showViewerRequest', this.boundShowRequested);
    eventEmitter.off('hideViewerRequest', this.boundHideRequested);
    this.feedbackViewerImpl.cleanup(); 
    this.feedbackViewerDOM.destroy();   
    FeedbackViewer.instance = null;
  }
} 