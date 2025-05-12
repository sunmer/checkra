import './feedback-viewer.css';
import { escapeHTML } from './utils';

const DEFAULT_WIDTH = 450;
const DEFAULT_HEIGHT = 220;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 220;
const MAX_WIDTH_VW = 80;

// Define the crosshair SVG icon as a constant
const CROSSHAIR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-crosshair-icon lucide-crosshair"><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>';

export interface FeedbackViewerElements {
  viewer: HTMLDivElement;
  promptTextarea: HTMLTextAreaElement;
  submitButton: HTMLButtonElement;
  submitButtonTextSpan: HTMLSpanElement;
  textareaContainer: HTMLDivElement;
  promptTitle: HTMLHeadingElement;
  responseContent: HTMLDivElement;
  loadingIndicator: HTMLDivElement;
  loadingIndicatorText: HTMLSpanElement;
  resizeHandle: HTMLDivElement | null;
  actionButtonsContainer: HTMLDivElement;
  previewApplyButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  responseHeader: HTMLDivElement;
  contentWrapper: HTMLDivElement;
  userMessageContainer: HTMLDivElement;
  closeViewerButton?: HTMLButtonElement;
  onboardingContainer?: HTMLDivElement;
  footerCTAContainer?: HTMLDivElement;
  miniSelectButton?: HTMLButtonElement;
}

/**
 * Manages the DOM elements, styling, positioning, dragging, and resizing
 * of the feedback viewer.
 */
export class FeedbackViewerDOM {
  private elements: FeedbackViewerElements | null = null;
  private readonly originalPromptTitleText = 'Describe what you need help with';

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
    this.hide();
  }

  public create(): FeedbackViewerElements {
    if (this.elements) return this.elements;

    const viewer = document.createElement('div');
    viewer.id = 'checkra-feedback-viewer';

    // Add resize event listeners
    viewer.addEventListener('mousedown', this.handleResizeStart);

    // Remove width/height setting since it's handled by CSS
    viewer.style.width = '450px';
    viewer.style.height = '100vh';

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

    // --- Action Buttons (in Header) ---
    const actionButtonsContainer = document.createElement('div');
    actionButtonsContainer.id = 'checkra-feedback-action-buttons';

    const previewApplyButton = document.createElement('button');
    previewApplyButton.innerHTML = `
          <span class="button-text">Preview Fix</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
        `;
    previewApplyButton.classList.add('preview-apply-fix');
    actionButtonsContainer.appendChild(previewApplyButton);

    const cancelButton = document.createElement('button');
    cancelButton.innerHTML = `
          <span class="button-text">Undo fix</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-undo2-icon lucide-undo-2"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
        `;
    cancelButton.classList.add('cancel-fix');
    // cancelButton.style.display = 'none'; // Initial state handled by CSS
    actionButtonsContainer.appendChild(cancelButton);

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
    promptTitle.textContent = '"' + this.originalPromptTitleText + '"';
    contentWrapper.appendChild(promptTitle);

    const textareaContainer = document.createElement('div');
    textareaContainer.id = 'checkra-textarea-container';

    // Mini Select Button (Crosshair)
    const miniSelectButton = document.createElement('button');
    miniSelectButton.id = 'checkra-mini-select-btn';
    miniSelectButton.title = 'Select element on page';
    miniSelectButton.innerHTML = CROSSHAIR_SVG;
    textareaContainer.appendChild(miniSelectButton);

    const promptTextarea = document.createElement('textarea');
    promptTextarea.id = 'checkra-prompt-textarea';
    promptTextarea.rows = 4;
    promptTextarea.placeholder = 'e.g., "How can I improve the UX or conversion of this section?"';
    textareaContainer.appendChild(promptTextarea);

    const submitButton = document.createElement('button');
    submitButton.id = 'checkra-feedback-submit-button';
    const submitButtonTextSpan = document.createElement('span');
    submitButtonTextSpan.textContent = 'Get Feedback';
    submitButton.appendChild(submitButtonTextSpan);
    const shortcutHint = document.createElement('span');
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    shortcutHint.textContent = isMac ? '(Cmd + ⏎)' : '(Ctrl + ⏎)';
    submitButton.appendChild(shortcutHint);
    textareaContainer.appendChild(submitButton);

    contentWrapper.appendChild(textareaContainer);

    // --- BEGIN EDIT ---
    // Create user message container *before* response content container
    const userMessageContainer = document.createElement('div');
    userMessageContainer.id = 'checkra-user-message-container';
    // Style handled by CSS: #checkra-user-message-container
    // userMessageContainer.style.marginBottom = '10px';
    // userMessageContainer.style.display = 'none'; // Initially hidden
    contentWrapper.appendChild(userMessageContainer); // Append to contentWrapper
    // --- END EDIT ---

    // --- Response Area (Now only for AI content) ---
    const responseContent = document.createElement('div');
    responseContent.id = 'checkra-feedback-response-content';
    // Style handled by CSS: #checkra-feedback-response-content
    // responseContent.style.wordWrap = 'break-word';
    // responseContent.style.fontSize = '14px';
    // responseContent.style.display = 'none';

    contentWrapper.appendChild(responseContent); // Append responseContent to contentWrapper

    // Add Footer CTA Container (initially hidden)
    const footerCTAContainer = document.createElement('div');
    footerCTAContainer.id = 'checkra-footer-cta-container';
    footerCTAContainer.classList.add('hidden'); // Start hidden
    // Basic styling for stickiness
    footerCTAContainer.style.position = 'sticky';
    footerCTAContainer.style.bottom = '0';
    footerCTAContainer.style.background = 'rgba(35, 45, 75, 0.9)'; // Match panel background
    footerCTAContainer.style.padding = '10px 20px';
    footerCTAContainer.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
    contentWrapper.appendChild(footerCTAContainer);

    viewer.appendChild(contentWrapper);

    document.body.appendChild(viewer);

    this.elements = {
      viewer,
      promptTextarea,
      submitButton,
      submitButtonTextSpan,
      textareaContainer,
      promptTitle,
      responseContent,
      loadingIndicator,
      loadingIndicatorText,
      resizeHandle: null, // Set to null since we removed it
      actionButtonsContainer,
      previewApplyButton,
      cancelButton,
      responseHeader,
      contentWrapper,
      userMessageContainer,
      closeViewerButton,
      onboardingContainer,
      footerCTAContainer,
      miniSelectButton
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
  }

  // --- Visibility and Content ---

  public show(): void {
    if (!this.elements) return;
    const { viewer, promptTextarea } = this.elements;

    // Reset visibility states using classes
    this.showPromptInputArea(true);
    this.updateLoaderVisibility(false);
    this.updateActionButtonsVisibility(false);
    this.elements.responseHeader.classList.add('hidden');
    this.elements.responseHeader.classList.remove('visible-flex');
    this.elements.contentWrapper.style.paddingTop = '15px';

    // Show the viewer with transform animation
    viewer.classList.remove('hidden');
    viewer.classList.add('visible-flex');

    // Focus the textarea
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
    const { loadingIndicator, loadingIndicatorText, responseHeader, contentWrapper, actionButtonsContainer } = this.elements;
    if (visible) {
      loadingIndicatorText.textContent = text || 'Processing...';
      // loadingIndicator.style.display = 'flex'; // Use class
      loadingIndicator.classList.remove('hidden');
      loadingIndicator.classList.add('visible-flex');
      responseHeader.classList.remove('hidden');
      responseHeader.classList.add('visible-flex');
      requestAnimationFrame(() => {
        const headerHeight = responseHeader.offsetHeight;
        contentWrapper.style.paddingTop = `${headerHeight + 10}px`;
      });
    } else {
      loadingIndicator.classList.add('hidden');
      loadingIndicator.classList.remove('visible-flex');
      if (actionButtonsContainer.classList.contains('hidden')) {
        responseHeader.classList.add('hidden');
        responseHeader.classList.remove('visible-flex');
        contentWrapper.style.paddingTop = '15px';
      } else {
        responseHeader.classList.remove('hidden');
        responseHeader.classList.add('visible-flex');
        requestAnimationFrame(() => {
          const headerHeight = responseHeader.offsetHeight;
          contentWrapper.style.paddingTop = `${headerHeight + 10}px`;
        });
      }
    }
  }

  public updateActionButtonsVisibility(visible: boolean): void {
    if (!this.elements) return;
    const { actionButtonsContainer, responseHeader, contentWrapper, loadingIndicator } = this.elements;
    actionButtonsContainer.classList.toggle('hidden', !visible);
    actionButtonsContainer.classList.toggle('visible-flex', visible);

    if (visible) {
      responseHeader.classList.remove('hidden');
      responseHeader.classList.add('visible-flex');
      requestAnimationFrame(() => {
        const headerHeight = responseHeader.offsetHeight;
        contentWrapper.style.paddingTop = `${headerHeight + 10}px`;
      });
    } else {
      if (loadingIndicator.classList.contains('hidden')) {
        responseHeader.classList.add('hidden');
        responseHeader.classList.remove('visible-flex');
        contentWrapper.style.paddingTop = '15px';
      } else {
        responseHeader.classList.remove('hidden');
        responseHeader.classList.add('visible-flex');
        requestAnimationFrame(() => {
          const headerHeight = responseHeader.offsetHeight;
          contentWrapper.style.paddingTop = `${headerHeight + 10}px`;
        });
      }
    }
  }

  public updateSubmitButtonState(enabled: boolean, text: string): void {
    if (!this.elements) return;
    this.elements.submitButton.disabled = !enabled;
    this.elements.submitButtonTextSpan.textContent = text;
  }

  public setResponseContent(html: string, scrollToBottom: boolean): void {
    if (!this.elements) return;
    const { responseContent, contentWrapper } = this.elements;

    const scrollThreshold = 10;
    const isScrolledToBottom = contentWrapper.scrollHeight - contentWrapper.scrollTop - contentWrapper.clientHeight < scrollThreshold;

    // responseContent.style.display = 'block'; // Use class
    responseContent.classList.remove('hidden');
    responseContent.classList.add('visible');
    responseContent.innerHTML = `<div class="checkra-streamed-content">${html}</div>`;

    const preElements = responseContent.querySelectorAll('.checkra-streamed-content pre');

    preElements.forEach(pre => {
      const preElement = pre as HTMLPreElement;
      if (preElement.querySelector('.checkra-code-copy-btn')) {
        return;
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
        console.log('[Copy Code] Button clicked.');

        const codeElement = preElement.querySelector('code.language-html');

        if (codeElement) {
          console.log('[Copy Code] Found code element:', codeElement);
          const codeToCopy = codeElement.textContent;
          console.log('[Copy Code] Text content to copy (length):', codeToCopy?.length);

          if (codeToCopy) {
            try {
              if (!navigator.clipboard) {
                console.warn('[Copy Code] navigator.clipboard API not available.');
                alert('Cannot copy code: Clipboard API not supported or not available in this context (e.g., non-HTTPS).');
                return;
              }

              await navigator.clipboard.writeText(codeToCopy);
              console.log('[Copy Code] Code successfully copied to clipboard.');

              copyButton.classList.add('copied');
              copyButton.title = 'Copied!';
              setTimeout(() => {
                copyButton.classList.remove('copied');
                copyButton.title = 'Copy code';
              }, 1500);

            } catch (err) {
              console.error('[Copy Code] Failed to copy code to clipboard:', err);
              alert(`Error copying code: ${err instanceof Error ? err.message : String(err)}`);
            }
          } else {
            console.warn('[Copy Code] Code element (language-html) found, but its textContent is empty or null.');
            alert('Cannot copy code: No text content found inside the HTML code block.');
          }
        } else {
          console.warn('[Copy Code] Could not find <code class="language-html"> element inside the <pre> block.');
        }
      });

      preElement.appendChild(copyButton);
    });

    if (scrollToBottom && isScrolledToBottom) {
      contentWrapper.scrollTop = contentWrapper.scrollHeight;
    }
  }

  public clearAIResponseContent(): void {
    if (!this.elements) return;
    console.log('[DOM.clearAIResponseContent] Clearing AI messages.');
    this.elements.responseContent.innerHTML = '';
    // this.elements.responseContent.style.display = 'none'; // Use class
    this.elements.responseContent.classList.add('hidden');
    this.elements.responseContent.classList.remove('visible');
  }

  public clearUserMessage(): void {
    if (!this.elements) return;
    console.log('[DOM.clearUserMessage] Clearing user message.');
    this.elements.userMessageContainer.innerHTML = '';
    // this.elements.userMessageContainer.style.display = 'none'; // Use class
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
      // Restore original title
      this.elements.promptTitle.textContent = this.originalPromptTitleText;
      this.elements.promptTitle.classList.remove('hidden');
      this.elements.promptTitle.classList.add('visible');
    } else if (submittedPromptText) {
      // Show submitted prompt in the title element
      this.elements.promptTitle.textContent = submittedPromptText;
      this.elements.promptTitle.classList.remove('hidden');
      this.elements.promptTitle.classList.add('visible');
    } else {
      // Hide the title if no text is provided (e.g., during initial loading)
      this.elements.promptTitle.classList.add('hidden');
      this.elements.promptTitle.classList.remove('visible');
    }
  }

  /**
   * Updates the content (text and icon) of the Preview/Apply button.
   */
  public updatePreviewApplyButtonContent(text: string, svgIcon: string): void {
    if (!this.elements) return;
    this.elements.previewApplyButton.innerHTML = `
            <span class="button-text">${escapeHTML(text)}</span>
            ${svgIcon}
        `;
  }

  /**
   * Renders HTML content into the dedicated user message container.
   * Ensures the response area is visible.
   */
  public renderUserMessage(html: string): void {
    if (!this.elements) return;
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
    if (!this.elements?.onboardingContainer || !this.elements.promptTitle || !this.elements.textareaContainer || !this.elements.responseHeader || !this.elements.responseContent) return;

    if (show) {
      // Populate onboarding content
      this.elements.onboardingContainer.innerHTML = `
        <h3>Welcome to Checkra 🚀</h3>
        <p>Get rapid UX, CRO & copywriting feedback.</p>
        <ul>
          <li><b>Run audit</b> – overview of SEO & above-the-fold.</li>
          <li><b>Select section</b> – click any part of the page for targeted feedback.</li>
        </ul>
        <p style="font-size: 0.8em; opacity: 0.8;"><em>Tip: press ⌘ + L (Mac) or Ctrl + L (Windows/Linux) anytime to open / close this panel.</em></p>
        <div class="onboard-buttons" style="margin-top: 15px; display: flex; gap: 10px;">
          <button id="checkra-btn-run-audit" class="preview-apply-fix" style="flex-grow: 1;">Run Quick Audit</button>
          <button id="checkra-btn-select-section" class="cancel-fix" style="flex-grow: 1; display: inline-flex; border-color: #999;">Select Section</button>
        </div>
      `;
      this.elements.onboardingContainer.classList.remove('hidden');
      this.elements.onboardingContainer.classList.add('visible');

      // Hide other elements
      this.elements.promptTitle.classList.add('hidden');
      this.elements.textareaContainer.classList.add('hidden');
      this.elements.responseHeader.classList.add('hidden'); // Hide header during onboarding
      this.elements.responseContent.classList.add('hidden');

    } else {
      this.elements.onboardingContainer.classList.add('hidden');
      this.elements.onboardingContainer.classList.remove('visible');
      this.elements.onboardingContainer.innerHTML = ''; // Clear content

      // Show prompt elements (they might be hidden again later by logic)
      this.elements.promptTitle.classList.remove('hidden');
      this.elements.textareaContainer.classList.remove('hidden');
      // Don't explicitly show header here, let updateLoader/ActionButtons handle it
    }
  }

  /**
   * Shows or hides the footer CTA container and populates it.
   */
  public showFooterCTA(show: boolean): void {
    if (!this.elements?.footerCTAContainer) return;

    if (show) {
      this.elements.footerCTAContainer.innerHTML = `
        <p style="margin: 0 0 5px 0; font-size: 0.9em; opacity: 0.9;">Need deeper fixes?</p>
        <button id="checkra-btn-footer-select-section" class="cancel-fix" style="width: 100%; display: inline-flex; border-color: #999;">Select Another Section</button>
      `;
      this.elements.footerCTAContainer.classList.remove('hidden');
      this.elements.footerCTAContainer.classList.add('visible');
    } else {
      this.elements.footerCTAContainer.classList.add('hidden');
      this.elements.footerCTAContainer.classList.remove('visible');
      this.elements.footerCTAContainer.innerHTML = ''; // Clear content
    }
  }
}