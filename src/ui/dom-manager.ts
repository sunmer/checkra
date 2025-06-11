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
  private onSuggestionClickCallback: ((suggestionText: string) => void) | null = null;

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
    if (item.type === 'ai' && item.isStreaming) {
      // Current logic might already handle adding a loader or relies on text updates
    } else if (typeof item.content === 'string') {
      bubble.innerHTML = item.content; // Use innerHTML to render HTML content from AI
    }
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

  public create(
    onCloseCallback: () => void, 
    onSuggestionClick: (suggestionText: string) => void
    ): CheckraViewerElements {
    this.onSuggestionClickCallback = onSuggestionClick;
    this.viewer = document.createElement('div');
    this.viewer.id = 'checkra-feedback-viewer';
    this.viewer.classList.add('checkra-hidden');

    this.header = document.createElement('div');
    this.header.id = 'checkra-feedback-response-header';

    this.contentWrapper = document.createElement('div');
    this.contentWrapper.id = 'checkra-feedback-content-wrapper';

    this.responseContent = document.createElement('div');
    this.responseContent.id = 'checkra-feedback-response-content';
    this.responseContent.classList.add('checkra-hidden');

    this.conversationHistoryContainer = document.createElement('div');
    this.conversationHistoryContainer.id = 'checkra-conversation-history';

    this.promptTextarea = document.createElement('textarea');
    this.promptTextarea.id = 'checkra-prompt-textarea';
    this.promptTextarea.placeholder = 'Describe what you want to change or analyze...';
    this.promptTextarea.rows = 3;

    this.userMessageContainer = document.createElement('div');
    this.userMessageContainer.id = 'checkra-user-message-container';
    this.userMessageContainer.classList.add('checkra-hidden');
    this.userMessageTextElement = document.createElement('p');
    this.userMessageContainer.appendChild(this.userMessageTextElement);

    this.loadingIndicator = document.createElement('div');
    this.loadingIndicator.id = 'checkra-feedback-loading-indicator';
    this.loadingIndicator.classList.add('checkra-hidden');
    const loadingSpinner = document.createElement('div');
    loadingSpinner.className = 'checkra-loading-spinner';
    this.loadingIndicator.appendChild(loadingSpinner);
    this.loadingTextElement = document.createElement('span');
    this.loadingIndicator.appendChild(this.loadingTextElement);

    this.closeButton = document.createElement('button');
    this.closeButton.id = 'checkra-close-viewer-btn';
    this.closeButton.innerHTML = CLOSE_SVG_ICON; 
    this.closeButton.title = 'Close Checkra Panel';
    this.closeButton.addEventListener('click', onCloseCallback);
    
    this.buttonRow = document.createElement('div');
    this.buttonRow.id = 'checkra-button-row';

    this.submitButton = document.createElement('button');
    this.submitButton.id = 'checkra-feedback-submit-button';
    this.submitButtonIcon = document.createElement('span');
    this.submitButtonIcon.innerHTML = SUBMIT_SVG_ICON;
    this.submitButton.appendChild(this.submitButtonIcon);
    this.submitButtonLoader = document.createElement('div');
    this.submitButtonLoader.className = 'checkra-button-loader checkra-hidden';
    this.submitButtonLoader.innerHTML = '&nbsp;'; 
    this.submitButton.appendChild(this.submitButtonLoader);
    this.submitButton.title = 'Submit Feedback (Ctrl+Enter or Cmd+Enter)';

    this.miniSelectButton = document.createElement('button');
    this.miniSelectButton.id = 'checkra-mini-select-btn';
    this.miniSelectButton.innerHTML = SELECT_SVG_ICON;
    this.miniSelectButton.title = 'Select Element (S)';

    this.settingsButton = document.createElement('button');
    this.settingsButton.id = 'checkra-header-settings-btn';
    this.settingsButton.innerHTML = SETTINGS_SVG_ICON;
    this.settingsButton.title = 'Settings';

    this.actionButtonsContainer = document.createElement('div');
    this.actionButtonsContainer.id = 'checkra-feedback-action-buttons';
    this.previewApplyButton = document.createElement('button');
    this.previewApplyButton.className = 'preview-apply-fix'; 
    this.previewApplyButton.textContent = 'Apply Fix';
    this.previewApplyButton.classList.add('checkra-hidden');
    this.cancelFixButton = document.createElement('button');
    this.cancelFixButton.className = 'cancel-fix';
    this.cancelFixButton.textContent = 'Cancel';
    this.cancelFixButton.classList.add('checkra-hidden');
    this.actionButtonsContainer.appendChild(this.previewApplyButton);
    this.actionButtonsContainer.appendChild(this.cancelFixButton);
    
    this.header.appendChild(this.settingsButton);
    this.header.appendChild(this.loadingIndicator);
    this.header.appendChild(this.actionButtonsContainer); 
    this.header.appendChild(this.closeButton);

    this.contentWrapper.appendChild(this.responseContent);
    this.contentWrapper.appendChild(this.userMessageContainer);
    this.contentWrapper.appendChild(this.conversationHistoryContainer);

    const textareaContainer = document.createElement('div');
    textareaContainer.id = 'checkra-textarea-container';
    this.buttonRow.appendChild(this.miniSelectButton);
    this.buttonRow.appendChild(this.submitButton);
    textareaContainer.appendChild(this.promptTextarea);
    textareaContainer.appendChild(this.buttonRow);

    this.viewer.appendChild(this.header);
    this.viewer.appendChild(this.contentWrapper);
    this.viewer.appendChild(textareaContainer);
    document.body.appendChild(this.viewer);

    return {
        viewer: this.viewer!,
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