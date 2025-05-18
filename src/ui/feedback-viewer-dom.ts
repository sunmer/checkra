import './feedback-viewer.css';
import { marked } from 'marked';

const DEFAULT_WIDTH = 450;
const MIN_WIDTH = 300;
const MAX_WIDTH_VW = 80;
const LOCALSTORAGE_PANEL_WIDTH_KEY = 'checkra_panel_width';

// Define the settings SVG icon as a constant
const SETTINGS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l-.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.72l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;

const IMAGE_GENERATION_LOADER_SVG = `
<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <circle cx="4" cy="12" r="3" fill="currentColor">
    <animate id="svgload1" attributeName="r" from="3" to="3" begin="0s;svgload3.end" dur="0.8s" values="3;1;3" calcMode="linear"/>
  </circle>
  <circle cx="12" cy="12" r="1" fill="currentColor">
    <animate id="svgload2" attributeName="r" from="1" to="1" begin="svgload1.end" dur="0.8s" values="3;1;3" calcMode="linear"/>
  </circle>
  <circle cx="20" cy="12" r="1" fill="currentColor">
    <animate id="svgload3" attributeName="r" from="1" to="1" begin="svgload2.end" dur="0.8s" values="3;1;3" calcMode="linear"/>
  </circle>
</svg>`;

interface ConversationItem {
  type: 'user' | 'ai' | 'usermessage' | 'error';
  content: string;
  isStreaming?: boolean;
  fix?: any;
}

export interface FeedbackViewerElements {
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
}

const SUBMIT_SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 -2 26 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-send-icon lucide-send"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>`;
const SELECT_SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px;"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><circle cx="12" cy="12" r="4"></circle><path d="m16 16-1.5-1.5"></path></svg>`;

/**
 * Manages the DOM elements, styling, positioning, dragging, and resizing
 * of the feedback viewer.
 */
export class FeedbackViewerDOM {
  private elements: FeedbackViewerElements | null = null;
  private readonly originalPromptTitleText = '';
  private closeButtonCallback: (() => void) | null = null;

  // --- Resizing State ---
  private isResizing: boolean = false;
  private resizeStartX: number = 0;
  private initialWidth: number = 0;

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

  public create(onCloseButtonClick: () => void): FeedbackViewerElements {
    if (this.elements) return this.elements;
    this.closeButtonCallback = onCloseButtonClick;

    const viewer = document.createElement('div');
    viewer.id = 'checkra-feedback-viewer';

    // Add resize event listeners
    viewer.addEventListener('mousedown', this.handleResizeStart);

    // Remove width/height setting since it's handled by CSS
    // viewer.style.width = '450px'; // Default handled by CSS now
    // viewer.style.height = '100vh'; // Default handled by CSS

    try {
      const storedWidth = localStorage.getItem(LOCALSTORAGE_PANEL_WIDTH_KEY);
      if (storedWidth) {
        const width = parseInt(storedWidth, 10);
        if (width >= MIN_WIDTH && width <= (window.innerWidth * MAX_WIDTH_VW / 100)) {
          viewer.style.width = `${width}px`;
        } else {
          viewer.style.width = `${DEFAULT_WIDTH}px`; // Fallback to default if stored is invalid
        }
      } else {
        viewer.style.width = `${DEFAULT_WIDTH}px`; // Default if not stored
      }
    } catch (e) {
      console.warn('[FeedbackViewerDOM] Error reading panel width from localStorage:', e);
      viewer.style.width = `${DEFAULT_WIDTH}px`; // Fallback on error
    }

    // --- Header ---
    const responseHeader = document.createElement('div');
    responseHeader.id = 'checkra-feedback-response-header';

    const loadingIndicator = document.createElement('div');
    loadingIndicator.id = 'checkra-feedback-loading-indicator';
    loadingIndicator.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="loading-spinner"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
          <span id="feedback-loading-indicator-text">Getting feedback...</span>
        `;
    const loadingIndicatorText = loadingIndicator.querySelector<HTMLSpanElement>('#feedback-loading-indicator-text')!;
    responseHeader.appendChild(loadingIndicator);

    const imageGenerationStatusElement = document.createElement('div');
    imageGenerationStatusElement.id = 'checkra-image-generation-status';
    imageGenerationStatusElement.classList.add('hidden'); // Hidden by default
    imageGenerationStatusElement.innerHTML = `
      <div class="image-gen-loader">${IMAGE_GENERATION_LOADER_SVG}</div>
      <span class="image-gen-text">Generating image...</span>
    `;
    responseHeader.appendChild(imageGenerationStatusElement);
    // END ADDED

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
    closeViewerButton.title = 'Close Panel (Cmd/Ctrl + L)';
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
      imageGenerationStatusElement
    };

    // Use the bound method for the listener
    this.elements.closeViewerButton?.addEventListener('click', this.handleCloseClick);

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
    console.log('[FeedbackViewerDOM] Instance destroyed.');
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
    promptTextarea.focus();
  }

  public hide(): void {
    if (!this.elements) return;
    this.elements.viewer.classList.add('hidden');
    this.elements.viewer.classList.remove('visible-flex');
    console.log('[FeedbackViewerDOM] Viewer hidden.');
  }

  public updateLoaderVisibility(visible: boolean, text?: string): void {
    if (!this.elements) return;
    const { loadingIndicator, loadingIndicatorText, responseHeader } = this.elements;

    responseHeader.classList.remove('hidden');
    responseHeader.classList.add('visible-flex');

    if (visible) {
      loadingIndicatorText.textContent = text || 'Processing...';
      loadingIndicator.classList.remove('hidden');
      loadingIndicator.classList.add('visible-flex');
    } else {
      loadingIndicator.classList.add('hidden');
      loadingIndicator.classList.remove('visible-flex');
    }
  }

  public updateSubmitButtonState(enabled: boolean): void {
    if (!this.elements) return;
    this.elements.submitButton.disabled = !enabled;
  }

  public clearAIResponseContent(): void {
    if (!this.elements) return;
    console.log('[DOM.clearAIResponseContent] Clearing all messages from AI response area.');
    this.elements.responseContent.innerHTML = ''; // Clear all children
    this.elements.responseContent.classList.add('hidden');
    this.elements.responseContent.classList.remove('visible');
  }

  public clearUserMessage(): void {
    if (!this.elements) return;
    console.log('[DOM.clearUserMessage] Clearing user message container.');
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

  // Updated onboarding content to be Markdown within an AI bubble
  private createOnboardingView(): string {
    const selectButtonRepresentation =
      `<span class="onboarding-button-representation" title="Select Element">${SELECT_SVG_ICON}</span>`;

    const markdownContent = `
### Welcome to Checkra!
Use this panel to edit your website with AI, ship variations, and learn what works.

**How to get started:**
* ${selectButtonRepresentation} Select any element on your page
* Then, type what you want to change or improve, such as:

* <span class="onboarding-suggestion">Change this headline to be more exciting</span>
* <span class="onboarding-suggestion">Add an abstract background image</span>
* <span class="onboarding-suggestion">Rewrite this hero section</span>

* Open this panel anytime by pressing <kbd style="background: #333; padding: 1px 4px; border-radius: 3px; border: 1px solid #555;">Shift</kbd> twice quickly. Type <kbd style="background: #333; padding: 1px 4px; border-radius: 3px; border: 1px solid #555;">/help</kbd> for all commands.
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
    messageDiv.classList.add('checkra-message-bubble', `message-${item.type}`);

    // Sanitize/parse content appropriately
    // For AI, use marked. For others, escapeHTML or handle as plain text.
    if (item.type === 'ai' || item.type === 'usermessage') { // User messages can also contain HTML
      messageDiv.innerHTML = item.content; // Assuming marked.parse happens before calling this for AI
    } else {
      messageDiv.textContent = item.content;
    }

    if (item.type === 'ai' && item.isStreaming) {
      messageDiv.classList.add('streaming');
    }
    // TODO: Add data-id for easier updates if needed
    return messageDiv;
  }

  public renderFullHistory(history: ConversationItem[]): void {
    if (!this.elements) return;
    console.log(`[DOM] renderFullHistory: Rendering ${history.length} items.`);
    this.clearAIResponseContent();
    this.elements.responseContent.classList.remove('hidden');
    this.elements.responseContent.classList.add('visible');

    history.forEach(item => {
      // For AI messages that are not streaming, parse them with marked.
      // Streaming messages will be updated by updateLastAIMessage.
      let displayItem = { ...item };
      if (item.type === 'ai' && !item.isStreaming && item.content) {
        displayItem.content = marked.parse(item.content) as string;
      }
      // User messages (type: 'usermessage') might already be HTML

      const messageEl = this.createMessageElement(displayItem);
      this.elements!.responseContent.appendChild(messageEl);
    });
    // Scroll to bottom
    this.elements.contentWrapper.scrollTop = this.elements.contentWrapper.scrollHeight;
  }

  public appendHistoryItem(item: ConversationItem): void {
    if (!this.elements) return;
    console.log(`[DOM] appendHistoryItem: TYPE=${item.type}, CONTENT_START=${item.content?.substring(0, 30)}`);
    this.elements.responseContent.classList.remove('hidden');
    this.elements.responseContent.classList.add('visible');

    let displayItem = { ...item };
    if (item.type === 'ai' && item.content && !item.isStreaming) { // Parse if not streaming
      displayItem.content = marked.parse(item.content) as string;
    } else if (item.type === 'ai' && item.isStreaming) {
      // For streaming AI, content is initially empty or placeholder, updated by updateLastAIMessage
      // If there's initial content (e.g. "AI is thinking..."), let it pass through createMessageElement
    }
    // User messages (type: 'usermessage') might already be HTML

    const messageEl = this.createMessageElement(displayItem);
    this.elements.responseContent.appendChild(messageEl);
    this.elements.contentWrapper.scrollTop = this.elements.contentWrapper.scrollHeight;
  }

  public updateLastAIMessage(newContent: string, isStreaming: boolean): void {
    if (!this.elements) return;
    const { responseContent } = this.elements;
    const lastAiMessageBubble = responseContent.querySelector('.message-ai:last-child');

    console.log(`[DOM] updateLastAIMessage: Found bubble=${!!lastAiMessageBubble}, CurrentHTML_Len=${lastAiMessageBubble?.innerHTML?.length ?? 0}, NewContent_Len=${newContent.length}, Streaming=${isStreaming}`);

    if (lastAiMessageBubble) {
      lastAiMessageBubble.innerHTML = marked.parse(newContent) as string;
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
  public showImageGenerationStatus(isGenerating: boolean, promptText?: string | null): void {
    if (!this.elements?.imageGenerationStatusElement) return;

    const statusElement = this.elements.imageGenerationStatusElement;
    const textSpan = statusElement.querySelector<HTMLSpanElement>('.image-gen-text');

    if (isGenerating) {
      if (textSpan) {
        textSpan.textContent = promptText
          ? `Generating image for: "${promptText.substring(0, 50)}${promptText.length > 50 ? '...' : ''}"`
          : 'Generating image...';
      }
      statusElement.classList.remove('hidden');
    } else {
      statusElement.classList.add('hidden');
    }
  }
  // END ADDED
}