import { CheckraDOM } from './checkra-dom';
import { CheckraImplementation } from './checkra-impl';
import { SettingsModal } from './settings-modal';
import { eventEmitter } from '../core/index'; // Corrected: eventEmitter is exported from core/index.ts


export default class Checkra {
  private checkraDOM: CheckraDOM;
  private checkraImplementation: CheckraImplementation;
  private settingsModal: SettingsModal;
  private static instance: Checkra | null = null;
  private initialVisibility: boolean; // Store initial visibility

  private constructor(settingsModal: SettingsModal, initialVisibility: boolean = false) {
    this.settingsModal = settingsModal;
    this.initialVisibility = initialVisibility;
    this.checkraDOM = new CheckraDOM();
    // Pass initialVisibility to FeedbackViewerImpl constructor
    this.checkraImplementation = new CheckraImplementation(this.handleToggle.bind(this), this.initialVisibility);
    
    // Listen for core requests to show/hide
    eventEmitter.on('showViewerRequest', this.boundShowRequested);
    eventEmitter.on('hideViewerRequest', this.boundHideRequested);

    // Initialize FeedbackViewerImpl AFTER setting up the listener
    // The Impl will decide based on its initialVisibility and localStorage if it should show itself.
    this.checkraImplementation.initialize(this.checkraDOM, this.settingsModal);

  }

  // Bound methods for event listeners
  private boundShowRequested = () => this.showPanel();
  private boundHideRequested = () => this.hidePanel();

  public static getInstance(settingsModal: SettingsModal, initialVisibility: boolean = false): Checkra {
    if (!Checkra.instance) {
      if (!settingsModal) {
          console.error('[FeedbackViewer] getInstance called without settingsModal for new instance creation!');
          throw new Error('SettingsModal instance is required to create a new FeedbackViewer instance.');
      }
      Checkra.instance = new Checkra(settingsModal, initialVisibility);
    }
    // If instance exists, should we update its visibility or warn if initialVisibility differs?
    // For now, it returns the existing instance. The initial visibility is set at creation.
    return Checkra.instance;
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
    this.checkraImplementation.showFromApi(false); // false indicates not user-initiated (e.g. from shortcut or API)
  }

  /**
   * Hides the feedback viewer panel by calling the implementation's method.
   */
  public hidePanel(): void {
    this.checkraImplementation.hide(false); // Programmatic hide, not initiated by user interaction on close button
  }

  /**
   * Destroys the feedback viewer instance, removing elements and listeners.
   */
  public destroy(): void {
    eventEmitter.off('showViewerRequest', this.boundShowRequested);
    eventEmitter.off('hideViewerRequest', this.boundHideRequested);
    this.checkraImplementation.cleanup(); 
    this.checkraDOM.destroy();   
    Checkra.instance = null;
  }
} 