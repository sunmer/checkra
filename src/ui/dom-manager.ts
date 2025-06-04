import { customWarn, customError } from '../utils/logger';
import { type ConversationItem } from './conversation-history';
import Settings from '../settings';

export const CLOSE_SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
export const SELECT_SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-mouse-pointer-click"><path d="m9 9 5 12 1.8-5.2L21 14Z"/><path d="M7.2 2.2 8 9.4l-5.1 1.4Z"/></svg>`;
export const SETTINGS_SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;
export const SUBMIT_SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-corner-down-left"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>`;

export interface CheckraViewerElements {
  viewer: HTMLDivElement;
  header: HTMLDivElement;
  contentWrapper: HTMLDivElement;
  responseContent: HTMLDivElement;
  promptTextarea: HTMLTextAreaElement;
  submitButton: HTMLButtonElement;
  submitButtonIcon: HTMLSpanElement;
  submitButtonLoader: HTMLDivElement;
  userMessageContainer: HTMLDivElement;
  userMessageTextElement: HTMLParagraphElement;
  loadingIndicator: HTMLDivElement;
  loadingTextElement: HTMLSpanElement;
  closeButton: HTMLButtonElement;
  actionButtonsContainer?: HTMLDivElement; 
  previewApplyButton?: HTMLButtonElement;
  cancelFixButton?: HTMLButtonElement;
  onboardingContainer: HTMLDivElement;
  conversationHistoryContainer: HTMLDivElement;
  miniSelectButton: HTMLButtonElement;
  settingsButton: HTMLButtonElement; 
  buttonRow: HTMLDivElement;
  resizeHandle?: HTMLDivElement;
}

export class CheckraDOM {
  private viewer: HTMLDivElement | null = null;
  private header: HTMLDivElement | null = null;
  private contentWrapper: HTMLDivElement | null = null;
  private responseContent: HTMLDivElement | null = null;
  private promptTextarea: HTMLTextAreaElement | null = null;
  private submitButton: HTMLButtonElement | null = null;
  private submitButtonIcon: HTMLSpanElement | null = null;
  private submitButtonLoader: HTMLDivElement | null = null;
  private userMessageContainer: HTMLDivElement | null = null;
  private userMessageTextElement: HTMLParagraphElement | null = null;
  private loadingIndicator: HTMLDivElement | null = null;
  private loadingTextElement: HTMLSpanElement | null = null;
  private closeButton: HTMLButtonElement | null = null;
  private actionButtonsContainer: HTMLDivElement | null = null;
  private previewApplyButton: HTMLButtonElement | null = null;
  private cancelFixButton: HTMLButtonElement | null = null;
  private onboardingContainer: HTMLDivElement | null = null;
  private conversationHistoryContainer: HTMLDivElement | null = null;
  private miniSelectButton: HTMLButtonElement | null = null;
  private settingsButton: HTMLButtonElement | null = null;
  private buttonRow: HTMLDivElement | null = null;
  private resizeHandle: HTMLDivElement | null = null;

  public show(): void {
    if (!this.viewer) return;
    this.viewer.classList.remove('checkra-hidden');
    this.viewer.classList.add('checkra-visible-flex');
  }

  public hide(): void {
    if (!this.viewer) return;
    this.viewer.classList.add('checkra-hidden');
    this.viewer.classList.remove('checkra-visible-flex');
  }

  public updateLoaderVisibility(visible: boolean, text?: string): void {
    if (!this.loadingIndicator || !this.loadingTextElement) return;
    if (visible) {
      this.loadingIndicator.classList.remove('checkra-hidden');
      this.loadingIndicator.classList.add('checkra-visible-flex');
      this.loadingTextElement.textContent = text || 'Loading...';
    } else {
      this.loadingIndicator.classList.add('checkra-hidden');
      this.loadingIndicator.classList.remove('checkra-visible-flex');
    }
  }

  public showOnboardingView(show: boolean): void {
    if (!this.onboardingContainer || !this.responseContent) return;
    if (show) {
      this.onboardingContainer.classList.remove('checkra-hidden');
      this.onboardingContainer.classList.add('checkra-visible');
      this.responseContent.classList.add('checkra-hidden');
      this.responseContent.classList.remove('checkra-visible');
    } else {
      this.onboardingContainer.classList.add('checkra-hidden');
      this.onboardingContainer.classList.remove('checkra-visible');
    }
  }

  public showPromptInputArea(show: boolean, userMessageToShow?: string): void {
    if (!this.promptTextarea || !this.userMessageContainer || !this.userMessageTextElement) return;
    if (show) {
      this.promptTextarea.classList.remove('checkra-hidden');
      this.userMessageContainer.classList.add('checkra-hidden');
      this.userMessageContainer.classList.remove('checkra-visible');
      this.promptTextarea.focus();
    } else {
      this.promptTextarea.classList.add('checkra-hidden');
      if (userMessageToShow) {
        this.userMessageTextElement.textContent = userMessageToShow;
        this.userMessageContainer.classList.remove('checkra-hidden');
        this.userMessageContainer.classList.add('checkra-visible');
      }
    }
  }

  public createMessageBubble(item: ConversationItem): HTMLDivElement {
    const bubble = document.createElement('div');
    bubble.classList.add('checkra-message-bubble');
    let typeClass = '';
    switch (item.type) {
        case 'user': typeClass = 'checkra-message-user'; break;
        case 'ai': typeClass = 'message-ai'; break; 
        case 'error': typeClass = 'checkra-message-error'; break;
        case 'usermessage': typeClass = 'checkra-message-usermessage'; break;
    }
    if (typeClass) bubble.classList.add(typeClass);
    // ... (rest of createMessageBubble, ensure classList changes use prefixed names if they were generic)
    return bubble;
  }

  public setSubmitButtonLoading(isLoading: boolean): void {
    if (!this.submitButton || !this.submitButtonIcon || !this.submitButtonLoader) return;
    if (isLoading) {
        this.submitButton.classList.add('loading');
        this.submitButtonIcon.classList.add('checkra-hidden');
        this.submitButtonLoader.classList.remove('checkra-hidden');
        this.submitButton.disabled = true;
    } else {
        this.submitButton.classList.remove('loading');
        this.submitButtonIcon.classList.remove('checkra-hidden');
        this.submitButtonLoader.classList.add('checkra-hidden');
        this.submitButton.disabled = false;
    }
  }

  private createOnboardingContent(): HTMLDivElement {
    const container = document.createElement('div');
    container.id = 'checkra-onboarding-container';
    container.innerHTML = `
        <h4>Welcome to Checkra!</h4>
        <p>To get started:</p>
        <ul>
            <li>Click the <span class="checkra-onboarding-button-representation">${SELECT_SVG_ICON}</span> button (or press S).</li>
            <li>Select any element on your page.</li>
            <li>Describe what you want to change or analyze.</li>
        </ul>
        <p>For example, you can try these on the current page (if applicable):</p>
        <div class="checkra-message-bubble message-ai">
         <ul>
          <li><span class="checkra-onboarding-suggestion" data-suggestion="Make this text bolder and blue.">Make this text bolder and blue.</span></li>
          <li><span class="checkra-onboarding-suggestion" data-suggestion="Rewrite this section to be more concise.">Rewrite this section to be more concise.</span></li>
          <li><span class="checkra-onboarding-suggestion" data-suggestion="Add a call to action button here saying 'Sign Up'.">Add a call to action button here saying 'Sign Up'.</span></li>
         </ul>
        </div>
        <button class="checkra-onboarding-button" id="checkra-onboarding-got-it">Got it!</button>
        <button class="checkra-onboarding-link-button" id="checkra-onboarding-audit-page">Or, run a full page audit</button>
    `;
    // ... (event listener for got it button)
    return container;
  }

  public create(onCloseCallback: () => void): CheckraViewerElements {
    this.viewer = document.createElement('div');
    // ... (assign all other this.property values)
    const loadingIndicator = document.createElement('div'); // This was a local var, should be this.loadingIndicator
    this.loadingIndicator = loadingIndicator; // Assign to class property
    this.loadingIndicator.id = 'checkra-feedback-loading-indicator';
    this.loadingIndicator.classList.add('checkra-hidden');
    const loadingSpinner = document.createElement('div');
    loadingSpinner.className = 'checkra-loading-spinner';
    this.loadingIndicator.appendChild(loadingSpinner);
    this.loadingTextElement = document.createElement('span'); // Assuming this was also missing a this.
    this.loadingIndicator.appendChild(this.loadingTextElement);

    // Example for submitButton if it wasn't being assigned to this.submitButton
    const submitButton = document.createElement('button'); 
    this.submitButton = submitButton; // Assign to class property
    this.submitButton.id = 'checkra-feedback-submit-button';
    // ... other submitButton setups

    const submitButtonLoader = document.createElement('div');
    this.submitButtonLoader = submitButtonLoader; // Assign to class property
    this.submitButtonLoader.className = 'checkra-button-loader checkra-hidden';
    this.submitButtonLoader.innerHTML = '&nbsp;'; 
    this.submitButton.appendChild(this.submitButtonLoader);
    
    // Similar assignments for other elements like submitButtonIcon, viewer, header, etc.
    // Ensure all elements accessed via `this.` in other methods are initialized and assigned to `this.` here.

    // Construct and return the CheckraViewerElements object using `this.` properties
    return {
        viewer: this.viewer!, // Use non-null assertion if sure they are assigned
        header: this.header!,
        contentWrapper: this.contentWrapper!,
        responseContent: this.responseContent!,
        promptTextarea: this.promptTextarea!,
        submitButton: this.submitButton!,
        submitButtonIcon: this.submitButtonIcon!,
        submitButtonLoader: this.submitButtonLoader!,
        userMessageContainer: this.userMessageContainer!,
        userMessageTextElement: this.userMessageTextElement!,
        loadingIndicator: this.loadingIndicator!,
        loadingTextElement: this.loadingTextElement!,
        closeButton: this.closeButton!,
        actionButtonsContainer: this.actionButtonsContainer || undefined,
        previewApplyButton: this.previewApplyButton || undefined,
        cancelFixButton: this.cancelFixButton || undefined,
        onboardingContainer: this.onboardingContainer!,
        conversationHistoryContainer: this.conversationHistoryContainer!,
        miniSelectButton: this.miniSelectButton!,
        settingsButton: this.settingsButton!,
        buttonRow: this.buttonRow!,
        resizeHandle: this.resizeHandle || undefined
    };
  }
} 