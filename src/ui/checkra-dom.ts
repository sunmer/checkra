import './checkra.css';
import { marked } from 'marked';
import { eventEmitter } from '../core/index';

const DEFAULT_WIDTH = 450;
const MIN_WIDTH = 300;
const MAX_WIDTH_VW = 80;
const LOCALSTORAGE_PANEL_WIDTH_KEY = 'checkra_panel_width';

// Define the settings SVG icon as a constant
const SETTINGS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l-.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;

// Loader SVG reused inside submit button
const BUTTON_LOADER_SVG = `
<svg class="checkra-button-loader" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;

interface ConversationItem {
  type: 'user' | 'ai' | 'usermessage' | 'error';
  content: string;
  isStreaming?: boolean;
  fix?: any;
}

export interface CheckraViewerElements {
  viewer: HTMLDivElement;
  promptTextarea: HTMLTextAreaElement;
  submitButton: HTMLButtonElement;
  textareaContainer: HTMLDivElement;
  promptTitle: HTMLHeadingElement;
  responseContent: HTMLDivElement;
  loadingIndicator: HTMLDivElement;
  loadingIndicatorText: HTMLSpanElement;
  actionButtonsContainer: HTMLDivElement;
  responseHeader: HTMLDivElement;
  contentWrapper: HTMLDivElement;
  userMessageContainer: HTMLDivElement;
  closeViewerButton?: HTMLButtonElement;
  onboardingContainer?: HTMLDivElement;
  footerCTAContainer?: HTMLDivElement;
  miniSelectButton?: HTMLButtonElement;
  settingsButton: HTMLButtonElement;
  imageGenerationStatusElement?: HTMLDivElement;
  availabilityToast?: HTMLDivElement;
  copyToast?: HTMLDivElement;
}

export const SUBMIT_SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 -2 26 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-send-icon lucide-send"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>`;
export const SELECT_SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-crosshair-icon lucide-crosshair"><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>`;

/**
 * Manages the DOM elements, styling, positioning, dragging, and resizing
 * of the feedback viewer.
 */
export class CheckraDOM {
  private elements: CheckraViewerElements | null = null;
  private readonly originalPromptTitleText = '';
  private closeButtonCallback: (() => void) | null = null;

  // --- Resizing State ---
  private isResizing: boolean = false;
  private resizeStartX: number = 0;
  private initialWidth: number = 0;

  // Track loading state so we don't constantly reset spinner animation
  private isLoading: boolean = false;

  // --- Helper to keep CSS variable in sync with actual panel width ---
  private updateCssPanelWidth(widthPx: number): void {
    const widthVal = Math.round(widthPx);
    document.documentElement.style.setProperty('--checkra-panel-width', `${widthVal}px`);
  }

  constructor() {
    // Bind resize handlers
    this.handleResizeStart = this.handleResizeStart.bind(this);
    this.handleResizeMove = this.handleResizeMove.bind(this);
    this.handleResizeEnd = this.handleResizeEnd.bind(this);
    this.handleCloseClick = this.handleCloseClick.bind(this); // Bind close handler
  }

  // Define the handler method
  private handleCloseClick(): void {
    this.closeButtonCallback?.();
  }

  public create(onCloseButtonClick: () => void): CheckraViewerElements {
    if (this.elements) return this.elements;
    this.closeButtonCallback = onCloseButtonClick;

    const viewer = document.createElement('div');
    viewer.id = 'checkra-feedback-viewer';
    // Hide initially; becomes visible via show()
    viewer.classList.add('hidden');

    // Add resize event listeners
    viewer.addEventListener('mousedown', this.handleResizeStart);

    // Remove width/height setting since it's handled by CSS
    // viewer.style.width = '450px'; // Default handled by CSS now
    // viewer.style.height = '100vh'; // Default handled by CSS

    let effectiveWidth = DEFAULT_WIDTH;
    try {
      const storedWidth = localStorage.getItem(LOCALSTORAGE_PANEL_WIDTH_KEY);
      if (storedWidth) {
        const width = parseInt(storedWidth, 10);
        if (width >= MIN_WIDTH && width <= (window.innerWidth * MAX_WIDTH_VW / 100)) {
          effectiveWidth = width;
        }
      }
    } catch (e) {
      console.warn('[FeedbackViewerDOM] Error reading panel width from localStorage:', e);
    }
    viewer.style.width = `${effectiveWidth}px`;
    // Sync the CSS variable for margin pushing
    this.updateCssPanelWidth(effectiveWidth);

    // --- Header ---
    const responseHeader = document.createElement('div');
    responseHeader.id = 'checkra-feedback-response-header';

    const loadingIndicator = document.createElement('div');
    loadingIndicator.id = 'checkra-feedback-loading-indicator';
    loadingIndicator.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="loading-spinner"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
          <span id="feedback-loading-indicator-text">Loading...</span>
        `;
    const loadingIndicatorText = loadingIndicator.querySelector<HTMLSpanElement>('#feedback-loading-indicator-text')!;
    responseHeader.appendChild(loadingIndicator);

    // --- Action Buttons (in Header) --- (Container remains for now, but buttons removed)
    const actionButtonsContainer = document.createElement('div');
    actionButtonsContainer.id = 'checkra-feedback-action-buttons';
    actionButtonsContainer.classList.add('hidden'); // Keep it hidden by default

    // Add Settings Button (before close button)
    const settingsButton = document.createElement('button');
    settingsButton.id = 'checkra-header-settings-btn';
    settingsButton.innerHTML = SETTINGS_SVG;
    settingsButton.title = 'Open Settings';
    responseHeader.appendChild(settingsButton); // Add to header

    // Add Close Button
    const closeViewerButton = document.createElement('button');
    closeViewerButton.id = 'checkra-close-viewer-btn';
    closeViewerButton.innerHTML = '&times;'; // Simple multiplication sign for X
    closeViewerButton.title = 'Close Panel (Press Shift key twice)';
    responseHeader.appendChild(closeViewerButton);

    responseHeader.appendChild(actionButtonsContainer);
    viewer.appendChild(responseHeader);

    // --- Content Wrapper ---
    const contentWrapper = document.createElement('div');
    contentWrapper.id = 'checkra-feedback-content-wrapper';

    // Add Onboarding Container (initially hidden)
    const onboardingContainer = document.createElement('div');
    onboardingContainer.id = 'checkra-onboarding-container';
    onboardingContainer.classList.add('hidden'); // Start hidden
    contentWrapper.appendChild(onboardingContainer);

    const promptTitle = document.createElement('h4');
    promptTitle.textContent = this.originalPromptTitleText;
    if (!this.originalPromptTitleText) {
      promptTitle.classList.add('hidden');
    }
    contentWrapper.appendChild(promptTitle);

    // --- Textarea Container - Created here, but appended to viewer LATER ---
    const textareaContainer = document.createElement('div');
    textareaContainer.id = 'checkra-textarea-container';
    const promptTextarea = document.createElement('textarea');
    promptTextarea.id = 'checkra-prompt-textarea';
    promptTextarea.rows = 4;
    promptTextarea.placeholder = 'e.g., "How can I improve the UX or conversion of this section?"';
    const buttonRow = document.createElement('div');
    buttonRow.id = 'checkra-button-row';
    const miniSelectButton = document.createElement('button');
    miniSelectButton.id = 'checkra-mini-select-btn';
    miniSelectButton.title = 'Select element on page';
    miniSelectButton.innerHTML = SELECT_SVG_ICON;
    buttonRow.appendChild(miniSelectButton);
    const submitButton = this.createSubmitButton();
    buttonRow.appendChild(submitButton);
    textareaContainer.appendChild(promptTextarea);
    textareaContainer.appendChild(buttonRow);

    // --- User Message & Response Area (Children of contentWrapper) ---
    const userMessageContainer = document.createElement('div');
    userMessageContainer.id = 'checkra-user-message-container';
    contentWrapper.appendChild(userMessageContainer);

    const responseContent = document.createElement('div');
    responseContent.id = 'checkra-feedback-response-content';
    contentWrapper.appendChild(responseContent);

    // Add Footer CTA Container (initially hidden) to contentWrapper
    const footerCTAContainer = document.createElement('div');
    footerCTAContainer.id = 'checkra-footer-cta-container';
    footerCTAContainer.classList.add('hidden');
    // Basic styling for stickiness
    footerCTAContainer.style.position = 'sticky';
    contentWrapper.appendChild(footerCTAContainer);

    viewer.appendChild(contentWrapper); // contentWrapper is now above textarea container
    viewer.appendChild(textareaContainer); // Textarea container appended last to viewer

    document.body.appendChild(viewer);

    // Ensure CSS var matches after insertion (in case styles affect computed width)
    this.updateCssPanelWidth(viewer.offsetWidth);

    this.elements = {
      viewer,
      promptTextarea,
      submitButton,
      textareaContainer,
      promptTitle,
      responseContent,
      loadingIndicator,
      loadingIndicatorText,
      actionButtonsContainer,
      responseHeader,
      contentWrapper,
      userMessageContainer,
      closeViewerButton,
      onboardingContainer,
      footerCTAContainer,
      miniSelectButton,
      settingsButton,
      availabilityToast: this.createAvailabilityToast(),
      copyToast: this.createCopyToast()
    };

    // Use the bound method for the listener
    this.elements.closeViewerButton?.addEventListener('click', this.handleCloseClick);

    // Attach event delegation for onboarding suggestion clicks
    if (onboardingContainer) {
      onboardingContainer.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target && target.classList.contains('checkra-onboarding-suggestion')) {
          const promptText = target.dataset.prompt || target.textContent || '';
          if (promptText.trim()) {
            eventEmitter.emit('onboardingSuggestionClicked', promptText.trim());
          }
        }
      });
    }

    return this.elements;
  }

  public destroy(): void {
    if (this.elements) {
      // Remove resize listeners
      this.elements.viewer.removeEventListener('mousedown', this.handleResizeStart);
      document.removeEventListener('mousemove', this.handleResizeMove);
      document.removeEventListener('mouseup', this.handleResizeEnd);

      // Use the bound method for removal
      this.elements.closeViewerButton?.removeEventListener('click', this.handleCloseClick);

      // Remove the viewer element
      this.elements.viewer.remove();
    }
    this.elements = null;
    this.closeButtonCallback = null;
  }

  // --- Resizing Handlers ---
  private handleResizeStart(e: MouseEvent): void {
    if (!this.elements) return;

    // Only handle clicks on the left edge (first 4px)
    const rect = this.elements.viewer.getBoundingClientRect();
    if (e.clientX > rect.left + 4) return;

    e.preventDefault();
    e.stopPropagation();
    this.isResizing = true;
    this.resizeStartX = e.clientX;
    this.initialWidth = this.elements.viewer.offsetWidth;
    document.addEventListener('mousemove', this.handleResizeMove);
    document.addEventListener('mouseup', this.handleResizeEnd);
    this.elements.viewer.classList.add('resizing');
    // Disable pointer events on content during resize
    this.elements.contentWrapper.style.pointerEvents = 'none';
  }

  private handleResizeMove(e: MouseEvent): void {
    if (!this.isResizing || !this.elements) return;

    const dx = this.resizeStartX - e.clientX; // Negative because we're resizing from right edge
    let newWidth = this.initialWidth + dx;

    // Clamp width between min and max
    newWidth = Math.max(300, Math.min(newWidth, 450));

    this.elements.viewer.style.width = `${newWidth}px`;
    // Update CSS variable in real time for smoother layout shift
    this.updateCssPanelWidth(newWidth);
  }

  private handleResizeEnd(): void {
    if (!this.isResizing || !this.elements) return;

    this.isResizing = false;
    document.removeEventListener('mousemove', this.handleResizeMove);
    document.removeEventListener('mouseup', this.handleResizeEnd);
    this.elements.contentWrapper.style.pointerEvents = '';
    this.elements.viewer.classList.remove('resizing');
    try {
      const currentWidth = this.elements.viewer.offsetWidth;
      // Final sync of CSS variable
      this.updateCssPanelWidth(currentWidth);
      localStorage.setItem(LOCALSTORAGE_PANEL_WIDTH_KEY, String(currentWidth));
    } catch (e) {
      console.warn('[FeedbackViewerDOM] Error saving panel width to localStorage:', e);
    }
  }

  // --- Visibility and Content ---

  public show(): void {
    if (!this.elements) return;
    const { viewer, promptTextarea } = this.elements;

    this.showPromptInputArea(true);
    this.updateLoaderVisibility(false);

    viewer.classList.remove('hidden');
    viewer.classList.add('visible-flex');
    // Ensure margin matches actual width each time panel is shown
    this.updateCssPanelWidth(viewer.offsetWidth);
    document.documentElement.classList.add('checkra-panel-open'); // Add class to html element
    promptTextarea.focus();
  }

  public hide(): void {
    if (!this.elements) return;
    this.elements.viewer.classList.add('hidden');
    this.elements.viewer.classList.remove('visible-flex');
    document.documentElement.classList.remove('checkra-panel-open'); // Remove class from html element
  }

  public updateLoaderVisibility(visible: boolean, text?: string): void {
    if (!this.elements) return;

    // Prevent unnecessary DOM churn (and animation reset) if state unchanged
    if (visible === this.isLoading) {
      return;
    }

    this.isLoading = visible;

    // Always hide the old header loader (kept for backward-compatibility but unused)
    if (this.elements.loadingIndicator) {
      this.elements.loadingIndicator.style.display = 'none';
    }

    const submitBtn = this.elements.submitButton;
    if (visible) {
      submitBtn.disabled = true;
      submitBtn.classList.add('loading');
      submitBtn.innerHTML = BUTTON_LOADER_SVG;
      submitBtn.title = text || 'Processing...';
    } else {
      submitBtn.disabled = false;
      submitBtn.classList.remove('loading');
      submitBtn.innerHTML = SUBMIT_SVG_ICON;
      submitBtn.title = 'Submit Feedback (Ctrl/Cmd + Enter)';
    }
  }

  public updateSubmitButtonState(enabled: boolean): void {
    if (!this.elements) return;
    this.elements.submitButton.disabled = !enabled;
  }

  public clearAIResponseContent(): void {
    if (!this.elements) return;
    this.elements.responseContent.innerHTML = ''; // Clear all children
    this.elements.responseContent.classList.add('hidden');
    this.elements.responseContent.classList.remove('visible');
  }

  public clearUserMessage(): void {
    if (!this.elements) return;
    this.elements.userMessageContainer.innerHTML = '';
    this.elements.userMessageContainer.classList.add('hidden');
    this.elements.userMessageContainer.classList.remove('visible');
  }

  public setPromptState(enabled: boolean, value?: string): void {
    if (!this.elements) return;
    this.elements.promptTextarea.disabled = !enabled;
    if (value !== undefined) {
      this.elements.promptTextarea.value = value;
    }
  }

  /**
   * Shows or hides the prompt textarea/button container, and updates
   * the text content of the prompt title element accordingly.
   * NOTE: With sticky textarea, this mostly just updates the title now.
   */
  public showPromptInputArea(show: boolean, submittedPromptText?: string): void {
    if (!this.elements?.promptTitle || !this.elements.textareaContainer) return;

    // Always keep textarea container visible now due to sticky positioning
    this.elements.textareaContainer.classList.remove('hidden');
    this.elements.textareaContainer.classList.add('visible'); // Or 'visible-flex' if needed later

    // Update the title text and visibility using class
    if (show) {
      // Restore original title (which is now empty)
      this.elements.promptTitle.textContent = this.originalPromptTitleText;
      if (this.originalPromptTitleText) {
        this.elements.promptTitle.classList.remove('hidden');
        this.elements.promptTitle.classList.add('visible');
      } else {
        this.elements.promptTitle.classList.add('hidden');
        this.elements.promptTitle.classList.remove('visible');
      }
    } else {
      // Hide the title if input is hidden (irrespective of submittedPromptText)
      this.elements.promptTitle.classList.add('hidden');
      this.elements.promptTitle.classList.remove('visible');
    }
  }

  /**
   * Renders HTML content into the dedicated user message container.
   * This will be adapted for history: append a new usermessage bubble.
   */
  public renderUserMessage(html: string): void {
    if (!this.elements) return;
    // For history, this will append a new message bubble
    // For now, it still uses the dedicated userMessageContainer, which Impl saves to history
    const { userMessageContainer } = this.elements;
    userMessageContainer.innerHTML = html;
    userMessageContainer.classList.toggle('hidden', !html);
    userMessageContainer.classList.toggle('visible', !!html);
  }

  /**
   * Shows or hides the onboarding container and populates its content.
   * Also manages visibility of other components based on onboarding state.
   */
  public showOnboardingView(show: boolean): void {
    if (!this.elements?.onboardingContainer) return;
    if (show) {
      this.elements.onboardingContainer.classList.remove('hidden');
      this.elements.onboardingContainer.classList.add('visible-flex');
      // Update content when showing
      this.elements.onboardingContainer.innerHTML = this.createOnboardingView();
    } else {
      this.elements.onboardingContainer.classList.add('hidden');
      this.elements.onboardingContainer.classList.remove('visible-flex');
    }
  }

  public isOnboardingVisible(): boolean {
    return !!this.elements?.onboardingContainer &&
           !this.elements.onboardingContainer.classList.contains('hidden');
  }

  // Updated onboarding content to be Markdown within an AI bubble
  private createOnboardingView(): string {
    const markdownContent = `
### Welcome to Checkra!
Use this panel to edit your website with AI, ship variations, and analyze what works.

**How to get started:**
* Click any prompt below and then select a part of your website:

* <span class="checkra-onboarding-suggestion" data-prompt="Audit the conversion potential of this section">Audit the conversion potential of this section</span>
* <span class="checkra-onboarding-suggestion" data-prompt="Help me drive more clicks to this section">Help me drive more clicks to this section</span>
* <span class="checkra-onboarding-suggestion" data-prompt="Improve the copywriting here">Improve the copywriting here</span>

* Type <kbd style="background: #333; padding: 1px 4px; border-radius: 3px; border: 1px solid #555; color: #fff;">/publish</kbd> to get a shareable url for your changes
* Open this panel anytime by pressing <kbd style="background: #333; padding: 1px 4px; border-radius: 3px; border: 1px solid #555; color: #fff;">Shift</kbd> twice quickly. Type <kbd style="background: #333; padding: 1px 4px; border-radius: 3px; border: 1px solid #555; color: #fff;">/help</kbd> for all commands.
    `;

    return `
      <div class="checkra-message-bubble message-ai" style="margin-left: 0; margin-right: 0; max-width: 100%;">
        ${marked.parse(markdownContent) as string}
      </div>
    `;
  }

  /**
   * Shows or hides the footer CTA container and populates it.
   */
  public showFooterCTA(show: boolean): void {
    if (!this.elements?.footerCTAContainer) return;

    if (show) {
      this.elements.footerCTAContainer.classList.remove('hidden');
      this.elements.footerCTAContainer.classList.add('visible');
    } else {
      this.elements.footerCTAContainer.classList.add('hidden');
      this.elements.footerCTAContainer.classList.remove('visible');
      this.elements.footerCTAContainer.innerHTML = ''; // Clear content
    }
  }
  private createMessageElement(item: ConversationItem): HTMLDivElement {
    const messageDiv = document.createElement('div');
    let contentToRender = item.content;
    let isHtmlContent = false;

    if (item.type === 'ai') {
      const lines = item.content.split('\n');
      const hasBulletPoints = lines.some(line => /^\s*[-*•]/.test(line));

      if (hasBulletPoints) {
        contentToRender = '<ul>\n' + lines.map(line => {
          const match = line.match(/^(\s*[-*•])(.*)/);
          if (match) {
            return `<li>${match[2].trim()}</li>`;
          }
          return line.trim() ? `<li>${line.trim()}</li>` : ''; // Wrap non-empty, non-bullet lines too
        }).filter(line => line).join('\n') + '\n</ul>';
        isHtmlContent = true;
      } else {
        contentToRender = marked.parse(item.content) as string;
        isHtmlContent = true;
      }
    } else if (item.type === 'usermessage' || item.type === 'error') {
      // These types are expected to be HTML (usermessage can be, error is plain but rendered as HTML)
      contentToRender = item.content; 
      isHtmlContent = true; // Assume error messages are HTML-safe or will be escaped by browser
    } else {
      // This covers item.type === 'user' (plain text prompt)
      // contentToRender remains item.content (plain text)
      isHtmlContent = false;
    }

    if (isHtmlContent) {
      messageDiv.innerHTML = contentToRender;
    } else {
      messageDiv.textContent = contentToRender;
    }

    if (item.type === 'ai' && item.isStreaming) {
      messageDiv.classList.add('streaming');
    }
    messageDiv.classList.add('checkra-message-bubble', `checkra-message-${item.type}`);
    return messageDiv;
  }

  public renderFullHistory(history: ConversationItem[]): void {
    if (!this.elements) return;
    this.clearAIResponseContent();
    this.elements.responseContent.classList.remove('hidden');
    this.elements.responseContent.classList.add('visible');

    history.forEach(item => {
      // createMessageElement will handle all necessary parsing/formatting for AI messages.
      // User messages (type: 'usermessage') might already be HTML.
      const messageEl = this.createMessageElement(item);
      this.elements!.responseContent.appendChild(messageEl);
    });
    // Scroll to bottom
    this.elements.contentWrapper.scrollTop = this.elements.contentWrapper.scrollHeight;
  }

  public appendHistoryItem(item: ConversationItem): void {
    if (!this.elements) return;
    console.warn(`[CheckraDOM] appendHistoryItem called for type=${item.type}. Current responseContent classes: ${this.elements.responseContent.className}`);

    this.elements.responseContent.classList.remove('checkra-hidden');
    this.elements.responseContent.classList.add('checkra-visible');
    console.warn(`[CheckraDOM] After ensuring visibility, responseContent classes: ${this.elements.responseContent.className}`);

    // createMessageElement will handle all necessary parsing/formatting for AI messages.
    // User messages (type: 'usermessage') might already be HTML.
    const messageEl = this.createMessageElement(item);
    this.elements.responseContent.appendChild(messageEl);
    this.elements.contentWrapper.scrollTop = this.elements.contentWrapper.scrollHeight;
  }

  public updateLastAIMessage(newContent: string, isStreaming: boolean): void {
    if (!this.elements) return;
    const { responseContent } = this.elements;
    const lastAiMessageBubble = responseContent.querySelector('.checkra-message-bubble.checkra-message-ai:last-child');

    if (lastAiMessageBubble) {
      let contentToRender = newContent;
      const lines = newContent.split('\n');
      const hasBulletPoints = lines.some(line => /^\s*[-*•]/.test(line));

      if (hasBulletPoints) {
        contentToRender = '<ul>\n' + lines.map(line => {
          const match = line.match(/^(\s*[-*•])(.*)/);
          if (match) {
            return `<li>${match[2].trim()}</li>`;
          }
          return line.trim() ? `<li>${line.trim()}</li>` : '';
        }).filter(line => line).join('\n') + '\n</ul>';
      } else {
        contentToRender = marked.parse(newContent) as string;
      }
      
      lastAiMessageBubble.innerHTML = contentToRender;
      lastAiMessageBubble.classList.toggle('streaming', isStreaming);
      this.attachCodeCopyButtonsTo(lastAiMessageBubble as HTMLElement);
      // Access contentWrapper via this.elements if needed for scrolling
      if (isStreaming || this.elements.contentWrapper.scrollHeight - this.elements.contentWrapper.scrollTop - this.elements.contentWrapper.clientHeight < 20) {
        this.elements.contentWrapper.scrollTop = this.elements.contentWrapper.scrollHeight;
      }
    } else {
      console.warn('[DOM] updateLastAIMessage called but no last AI message bubble found. This might indicate an issue with initial AI message append.');
    }
  }

  // Helper to attach code copy buttons, to be called after innerHTML changes
  private attachCodeCopyButtonsTo(parentElement: HTMLElement): void {
    const preElements = parentElement.querySelectorAll('.checkra-streamed-content pre');
    preElements.forEach(pre => {
      // ... (copy button logic from setResponseContent, slightly refactored) ...
      const preElement = pre as HTMLPreElement;
      if (preElement.querySelector('.checkra-code-copy-btn')) {
        return; // Already has one
      }
      (preElement as HTMLElement).style.position = 'relative';
      const copyButton = document.createElement('button');
      copyButton.className = 'checkra-code-copy-btn';
      copyButton.innerHTML = `
            <svg class="copy-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <svg class="check-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        `;
      copyButton.title = 'Copy code';
      copyButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        const codeElement = preElement.querySelector('code');
        if (codeElement && codeElement.textContent) {
          try {
            await navigator.clipboard.writeText(codeElement.textContent);
            copyButton.classList.add('copied');
            copyButton.title = 'Copied!';
            setTimeout(() => {
              copyButton.classList.remove('copied');
              copyButton.title = 'Copy code';
            }, 1500);
          } catch (err) {
            console.error('[Copy Code] Failed:', err);
            alert(`Error copying: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      });
      preElement.appendChild(copyButton);
    });
  }

  private createSubmitButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.id = 'checkra-feedback-submit-button';
    button.title = 'Submit Feedback (Ctrl/Cmd + Enter)';
    button.type = 'button'; // Prevent form submission if nested
    button.innerHTML = SUBMIT_SVG_ICON;

    return button;
  }

  private createAvailabilityToast(): HTMLDivElement {
    const toast = document.createElement('div');
    toast.id = 'checkra-availability-toast';
    toast.textContent = 'Press Shift twice to open Checkra';
    // CSS handles initial hidden state
    document.body.appendChild(toast);
    return toast;
  }

  public showAvailabilityToast(): void {
    if (!this.elements?.availabilityToast) return;
    const toast = this.elements.availabilityToast;
    console.warn('[Checkra DOM] Showing availability toast');
    // Ensure toast exists and is not detached
    if (!document.body.contains(toast)) {
      document.body.appendChild(toast);
    }
    // Reset any previous state so animation can replay
    toast.classList.remove('visible', 'hiding');
    // Force reflow to restart transition
    void toast.offsetWidth;

    toast.classList.add('visible');

    // Fallback inline styles (in case CSS classes fail to apply due to specificity)
    toast.style.opacity = '1';
    toast.style.visibility = 'visible';

    // Automatically hide after a few seconds
    setTimeout(() => {
      toast.classList.add('hiding');
      toast.style.opacity = '0';
      toast.style.visibility = 'hidden';
    }, 4000);
  }

  private createCopyToast(): HTMLDivElement {
    const toast = document.createElement('div');
    toast.id = 'checkra-copy-toast';
    toast.textContent = 'Prompt copied to clipboard';
    // CSS handles initial hidden state
    document.body.appendChild(toast);
    return toast;
  }

  public showCopyPromptToast(): void {
    if (!this.elements?.copyToast) return;
    const toast = this.elements.copyToast;
    console.warn('[Checkra DOM] Showing copy prompt toast');
    // Ensure toast exists and is not detached
    if (!document.body.contains(toast)) {
      document.body.appendChild(toast);
    }
    // Reset any previous state so animation can replay
    toast.classList.remove('visible', 'hiding');
    // Force reflow to restart transition
    void toast.offsetWidth;

    toast.classList.add('visible');

    // Fallback inline styles (in case CSS classes fail to apply due to specificity)
    toast.style.opacity = '1';
    toast.style.visibility = 'visible';

    // Automatically hide after a few seconds
    setTimeout(() => {
      toast.classList.add('hiding');
      toast.style.opacity = '0';
      toast.style.visibility = 'hidden';
    }, 1500);
  }

  public getElements(): CheckraViewerElements | null {
    return this.elements;
  }
}