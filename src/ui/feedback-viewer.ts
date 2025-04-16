import { escapeHTML } from './utils';
import { fetchFeedback } from '../services/ai-service';
import { marked } from 'marked';
import { copyViewportToClipboard } from '../utils/clipboard-utils';

/**
 * Class for managing the feedback response viewer modal.
 */
export class FeedbackViewer {
  private element: HTMLDivElement | null = null;
  private promptTextarea: HTMLTextAreaElement | null = null;
  private submitButton: HTMLButtonElement | null = null;
  private submitButtonTextSpan: HTMLSpanElement | null = null;
  private responseContentElement: HTMLElement | null = null;
  private renderedHtmlPreview: HTMLDivElement | null = null;
  private outsideClickHandler: (e: MouseEvent) => void;
  private currentImageDataUrl: string | null = null;
  private currentSelectedHtml: string | null = null;
  private originalElementBounds: DOMRect | null = null;
  private originalElementRef: Element | null = null;
  private insertedFixWrapper: HTMLDivElement | null = null;
  private accumulatedResponseText: string = '';
  private fixWrapperCloseButtonListener: (() => void) | null = null;
  private originalElementDisplayStyle: string | null = null;
  private fixWrapperMouseLeaveListener: (() => void) | null = null;
  private originalElementMouseEnterListener: (() => void) | null = null;
  private closeButton: HTMLButtonElement | null = null;
  private previewButton: HTMLButtonElement | null = null;
  private isStreamStarted: boolean = false;

  constructor() {
    this.outsideClickHandler = (e: MouseEvent) => {
      if (this.element &&
        this.element.style.display !== 'none' &&
        e.target instanceof Node &&
        !this.element.contains(e.target) &&
        !this.renderedHtmlPreview?.contains(e.target)) {
        if (!this.closeButton || !this.closeButton.contains(e.target as Node)) {
             this.hide();
        }
      }
    };
  }

  public create(): void {
    if (this.element) return;

    const styleElement = document.createElement('style');
    styleElement.textContent = `
      #feedback-response-content .streamed-content h1,
      #feedback-response-content .streamed-content h2,
      #feedback-response-content .streamed-content h3,
      #feedback-response-content .streamed-content h4,
      #feedback-response-content .streamed-content h5,
      #feedback-response-content .streamed-content h6 {
        color: #fff;
        margin-top: 1em;
        margin-bottom: 0.5em;
        font-weight: 600;
      }

      #feedback-response-content .streamed-content p {
        margin-bottom: 0.8em;
        line-height: 1.6;
      }

      #feedback-response-content .streamed-content code {
        background-color: #3a3a3a;
        padding: 0.2em 0.4em;
        border-radius: 3px;
        font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
        font-size: 0.9em;
      }

      #feedback-response-content .streamed-content pre {
        background-color: #2a2a2a;
        padding: 10px;
        border-radius: 4px;
        overflow-x: auto;
        margin-bottom: 1em;
      }

      #feedback-response-content .streamed-content pre code {
        background-color: transparent;
        padding: 0;
        border-radius: 0;
        font-size: 1em;
      }

      #feedback-response-content .streamed-content ul,
      #feedback-response-content .streamed-content ol {
        padding-left: 20px;
        margin-bottom: 1em;
      }

      #feedback-response-content .streamed-content li {
        margin-bottom: 0.4em;
      }

      /* --- CSS Animation Keyframes --- */
      @keyframes blinkOutline3TimesThenHold {
        /* Define 3 blinks (ON-OFF cycles) then hold ON */
        /* Each ON/OFF segment is ~16.6% for a 1.2s total duration */
        0%, 33.2%, 66.5% { outline-color: rgba(0, 122, 204, 1); } /* ON */
        16.6%, 49.9% { outline-color: transparent; } /* OFF */
        /* From 83.3% to 100%, stay ON */
        83.3%, 100% { outline-color: rgba(0, 122, 204, 1); } /* Hold ON */
      }

      /* Removed fadeInElement keyframe */
      /* --- End Keyframes --- */

      .feedback-injected-fix {
        position: relative;
        /* opacity: 0; */ /* Content is visible immediately */
        opacity: 1; /* Ensure content is visible */
        outline: 1px dashed transparent; /* Start with transparent outline */
        /* Apply only the outline blink animation */
        animation:
          /* Blink the outline color 3 times sharply, hold solid (1.2s) */
          blinkOutline3TimesThenHold 1.2s steps(1, end) 1 forwards;
          /* Removed fadeInElement animation */
      }

      .feedback-fix-close-btn {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 18px;
        height: 18px;
        background-color: rgba(80, 80, 80, 0.7);
        color: #ddd;
        border: 1px solid #555;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
        line-height: 1;
        z-index: 11;
        pointer-events: auto;
        transition: background-color 0.2s, color 0.2s;
        font-family: sans-serif;
      }

      .feedback-fix-close-btn:hover {
        background-color: rgba(200, 50, 50, 0.8);
        color: white;
      }

      /* --- New Copy Button Styles --- */
      .feedback-fix-copy-btn {
        position: absolute;
        top: 2px;
        right: 24px; /* Position next to the close button */
        width: 18px;
        height: 18px;
        background-color: rgba(80, 80, 80, 0.7);
        color: #ddd;
        border: 1px solid #555;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2px; /* Add padding for the SVG */
        box-sizing: border-box; /* Include padding in width/height */
        z-index: 11;
        pointer-events: auto;
        transition: background-color 0.2s, color 0.2s;
      }

      .feedback-fix-copy-btn svg {
        width: 10px; /* Adjust SVG size */
        height: 10px;
        stroke: currentColor; /* Inherit color */
      }

      .feedback-fix-copy-btn:hover {
        background-color: rgba(80, 120, 200, 0.8); /* Different hover color */
        color: white;
      }
      /* --- End Copy Button Styles --- */

      #feedback-viewer button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background-color: rgba(255, 255, 255, 0.1) !important;
      }
      #feedback-viewer button:not(:disabled):hover {
         background-color: rgba(255, 255, 255, 0.2);
      }

      #feedback-viewer #feedback-submit-button {
        position: absolute;
        bottom: 10px;
        right: 10px;
        justify-content: center;
        align-items: center;
        gap: 6px;
        text-align: center;
        background: #2563eb;
        color: white;
        font-size: 0.875rem;
        font-weight: 500;
        border-radius: 0.375rem;
        padding: 6px 8px;
        cursor: pointer;
      }

      #feedback-viewer #feedback-submit-button:focus {
        outline: none;
        box-shadow: 0 0 0 1px #4b5563;
      }

      #feedback-viewer #feedback-submit-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      #feedback-viewer #feedback-submit-button span:last-child {
        margin-left: 0;
        color: #e5e7eb;
      }

      #feedback-viewer #feedback-preview-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background-color: rgba(255, 255, 255, 0.1) !important;
      }
      #feedback-viewer #feedback-preview-button:not(:disabled):hover {
         background-color: rgba(255, 255, 255, 0.2);
      }

      /* Loading Spinner Animation */
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .loading-spinner {
        display: inline-block; /* Or block, depending on desired layout */
        animation: spin 1s linear infinite;
        width: 1.2em; /* Adjust size as needed */
        height: 1.2em;
        vertical-align: middle; /* Align with text if needed */
        margin-right: 8px; /* Space between spinner and text if any */
      }
    `;

    document.head.appendChild(styleElement);

    this.element = document.createElement('div');
    this.element.id = 'feedback-viewer';

    this.element.style.position = 'fixed';
    this.element.style.top = '50%';
    this.element.style.left = '50%';
    this.element.style.transform = 'translate(-50%, -50%)';
    this.element.style.backgroundColor = 'rgba(35, 45, 75, 0.95)';
    this.element.style.color = 'white';
    this.element.style.padding = '0';
    this.element.style.borderRadius = '8px';
    this.element.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.4)';
    this.element.style.zIndex = '1002';
    this.element.style.maxHeight = '80vh';
    this.element.style.width = 'clamp(350px, 50vw, 500px)';
    this.element.style.overflow = 'hidden';
    this.element.style.display = 'none';
    this.element.style.fontFamily = 'sans-serif';
    this.element.style.lineHeight = '1.5';
    this.element.style.flexDirection = 'column';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.padding = '10px 20px';
    header.style.borderBottom = '1px solid rgba(255, 255, 255, 0.2)';
    header.style.flexShrink = '0';

    const title = document.createElement('h2');
    title.textContent = 'Ask for improvements';
    title.style.margin = '0';
    title.style.fontSize = '1.2em';

    this.closeButton = document.createElement('button');
    this.closeButton.innerHTML = '&times;';
    this.closeButton.style.background = 'none';
    this.closeButton.style.border = 'none';
    this.closeButton.style.color = 'white';
    this.closeButton.style.fontSize = '1.8em';
    this.closeButton.style.lineHeight = '1';
    this.closeButton.style.cursor = 'pointer';
    this.closeButton.style.padding = '0 5px';
    this.closeButton.title = 'Close Feedback';
    this.closeButton.addEventListener('click', () => this.hide());

    header.appendChild(title);
    header.appendChild(this.closeButton);
    this.element.appendChild(header);

    const contentWrapper = document.createElement('div');
    contentWrapper.style.padding = '15px 20px 20px 20px';
    contentWrapper.style.overflowY = 'auto';
    contentWrapper.style.flexGrow = '1';

    const promptTitle = document.createElement('h4');
    promptTitle.textContent = 'Describe what you need help with';
    promptTitle.style.color = '#a0c8ff';
    promptTitle.style.marginBottom = '8px';
    promptTitle.style.marginTop = '0';
    promptTitle.style.fontSize = '1em';
    promptTitle.style.fontWeight = '600';
    promptTitle.style.paddingBottom = '0';
    contentWrapper.appendChild(promptTitle);

    const textareaContainer = document.createElement('div');
    textareaContainer.style.position = 'relative';

    this.promptTextarea = document.createElement('textarea');
    this.promptTextarea.rows = 4;
    this.promptTextarea.placeholder = 'e.g., "How can I improve the conversion of this page?"';
    this.promptTextarea.style.width = '100%';
    this.promptTextarea.style.padding = '10px';
    this.promptTextarea.style.backgroundColor = '#fff';
    this.promptTextarea.style.color = '#333';
    this.promptTextarea.style.border = '1px solid #ccc';
    this.promptTextarea.style.borderRadius = '4px';
    this.promptTextarea.style.fontFamily = 'inherit';
    this.promptTextarea.style.fontSize = '1em';
    this.promptTextarea.style.resize = 'vertical';
    this.promptTextarea.style.boxSizing = 'border-box';
    this.promptTextarea.addEventListener('keydown', this.handleTextareaKeydown);
    textareaContainer.appendChild(this.promptTextarea);

    this.submitButton = document.createElement('button');
    this.submitButton.id = 'feedback-submit-button';
    this.submitButton.style.display = 'flex';

    const buttonText = document.createElement('span');
    buttonText.textContent = 'Get Feedback';
    this.submitButton.appendChild(buttonText);
    this.submitButtonTextSpan = buttonText;

    const shortcutHint = document.createElement('span');
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    shortcutHint.textContent = isMac ? '(Cmd + ⏎)' : '(Ctrl + ⏎)';
    shortcutHint.style.fontSize = '10px';

    this.submitButton.appendChild(buttonText);
    this.submitButton.appendChild(shortcutHint);

    this.submitButton.addEventListener('click', this.handleSubmit);
    textareaContainer.appendChild(this.submitButton);

    contentWrapper.appendChild(textareaContainer);

    // --- Create Response Header (Container for Title and Button) ---
    const responseHeader = document.createElement('div');
    responseHeader.style.display = 'none'; // Initially hidden
    responseHeader.style.justifyContent = 'space-between';
    responseHeader.style.alignItems = 'center';
    responseHeader.style.marginBottom = '10px';
    responseHeader.style.marginTop = '15px';
    responseHeader.style.borderBottom = '1px solid rgba(255, 255, 255, 0.15)';
    responseHeader.style.paddingBottom = '6px';

    const responseTitle = document.createElement('h4');
    responseTitle.textContent = 'Feedback Response';
    responseTitle.style.color = '#a0c8ff';
    responseTitle.style.fontSize = '1em';
    responseTitle.style.fontWeight = '600';
    responseTitle.style.margin = '0'; // Remove default margins

    // --- Create Preview Button ---
    this.previewButton = document.createElement('button');
    this.previewButton.id = 'feedback-preview-button';
    this.previewButton.disabled = true; // Start disabled
    this.previewButton.style.display = 'flex';
    this.previewButton.style.alignItems = 'center';
    this.previewButton.style.gap = '4px';
    this.previewButton.style.padding = '4px 8px';
    this.previewButton.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    this.previewButton.style.color = '#a0c8ff';
    this.previewButton.style.border = '1px solid rgba(255, 255, 255, 0.3)';
    this.previewButton.style.borderRadius = '4px';
    this.previewButton.style.cursor = 'pointer';
    this.previewButton.style.fontSize = '0.85em';
    this.previewButton.title = 'Preview suggested changes directly on the page';
    this.previewButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>
      <span>Preview result</span>
    `;
    // Add listener to hide the modal when clicked (if enabled)
    this.previewButton.addEventListener('click', () => {
        if (!this.previewButton?.disabled) {
            this.hide();
        }
    });

    // --- Append Title and Button to Header ---
    responseHeader.appendChild(responseTitle);
    responseHeader.appendChild(this.previewButton);

    // --- Append Header and Content Area ---
    this.responseContentElement = document.createElement('div');
    this.responseContentElement.id = 'feedback-response-content';
    this.responseContentElement.style.wordWrap = 'break-word';
    this.responseContentElement.style.fontFamily = 'inherit';
    this.responseContentElement.style.fontSize = '0.95em';
    this.responseContentElement.style.marginTop = '10px';
    this.responseContentElement.style.display = 'none'; // Content area also starts hidden

    contentWrapper.appendChild(responseHeader); // Add the header container
    contentWrapper.appendChild(this.responseContentElement); // Add the content area below the header

    this.element.appendChild(contentWrapper);

    this.renderedHtmlPreview = document.createElement('div');
    this.renderedHtmlPreview.id = 'feedback-rendered-html-preview';
    this.renderedHtmlPreview.style.position = 'fixed';
    this.renderedHtmlPreview.style.display = 'none';
    this.renderedHtmlPreview.style.opacity = '0';
    this.renderedHtmlPreview.style.border = '1px dashed #007acc';
    this.renderedHtmlPreview.style.color = '#d4d4d4';
    this.renderedHtmlPreview.style.zIndex = '1001';
    this.renderedHtmlPreview.style.padding = '8px';
    this.renderedHtmlPreview.style.borderRadius = '4px';
    this.renderedHtmlPreview.style.maxWidth = '450px';
    this.renderedHtmlPreview.style.maxHeight = '350px';
    this.renderedHtmlPreview.style.overflow = 'auto';
    this.renderedHtmlPreview.style.transition = 'opacity 0.2s ease-in-out';
    this.renderedHtmlPreview.style.pointerEvents = 'none';
    this.renderedHtmlPreview.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.4)';

    this.renderedHtmlPreview.addEventListener('mouseover', () => {
        if (this.renderedHtmlPreview && this.renderedHtmlPreview.style.display !== 'none') {
            this.renderedHtmlPreview.style.opacity = '1';
        }
    });
    this.renderedHtmlPreview.addEventListener('mouseout', () => {
        if (this.renderedHtmlPreview) {
            this.renderedHtmlPreview.style.opacity = '0';
        }
    });

    document.body.appendChild(this.renderedHtmlPreview);
    document.body.appendChild(this.element);
    document.addEventListener('mousedown', this.outsideClickHandler);
  }

  public showInputArea(
    imageDataUrl: string | null,
    selectedHtml: string | null,
    targetRect: DOMRect | null,
    targetElement: Element | null
  ): void {
    if (!this.element) this.create();
    if (!this.element || !this.promptTextarea || !this.submitButton || !this.responseContentElement || !this.submitButtonTextSpan || !this.renderedHtmlPreview || !this.previewButton) return;

    this.currentImageDataUrl = imageDataUrl;
    this.currentSelectedHtml = selectedHtml;
    this.originalElementBounds = targetRect;
    this.originalElementRef = targetElement;

    this.promptTextarea.value = '';
    this.promptTextarea.disabled = false;
    this.submitButton.disabled = false;
    this.submitButtonTextSpan.textContent = 'Get Feedback';
    this.responseContentElement.innerHTML = '';
    this.accumulatedResponseText = '';
    this.responseContentElement.style.display = 'none';
    // Find the response header (parent of responseContentElement) and hide it
    const responseHeader = this.responseContentElement.previousElementSibling as HTMLElement;
    if (responseHeader) responseHeader.style.display = 'none'; // Hide header too
    this.previewButton.disabled = true; // Ensure preview button is disabled

    this.renderedHtmlPreview.innerHTML = '';
    this.renderedHtmlPreview.style.display = 'none';
    this.renderedHtmlPreview.style.opacity = '0';
    this.renderedHtmlPreview.style.pointerEvents = 'none';

    console.log('[FeedbackViewer DEBUG] Calling removeInjectedFix from showInputArea (start).');
    this.removeInjectedFix();

    this.promptTextarea.style.display = 'block';
    this.submitButton.style.display = 'flex';

    this.element.style.display = 'flex';

    this.promptTextarea.focus();
  }

  private handleTextareaKeydown = (e: KeyboardEvent): void => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      this.handleSubmit();
    }
  };

  private handleSubmit = (): void => {
    if (!this.promptTextarea || !this.submitButton || !this.responseContentElement || !this.submitButtonTextSpan || !this.previewButton) return;
    if (!this.currentImageDataUrl && !this.currentSelectedHtml) {
      console.warn('[Feedback] Cannot submit feedback without captured image or HTML.');
      this.showError('Could not capture image or HTML structure.');
      return;
    }

    const promptText = this.promptTextarea.value.trim();

    console.log('[Feedback] Submitting feedback...');
    console.log('[Feedback] Image Data:', this.currentImageDataUrl ? 'Present' : 'Absent');
    console.log('[Feedback] Selected HTML:', this.currentSelectedHtml ? 'Present' : 'Absent');

    this.promptTextarea.disabled = true;
    this.submitButton.disabled = true;
    this.submitButtonTextSpan.textContent = 'Sending...';
    this.isStreamStarted = false;

    // --- Replace emoji with SVG spinner ---
    this.responseContentElement.innerHTML = ''; // Clear previous content
    const spinner = document.createElement('div'); // Use a div wrapper for easier styling/removal if needed
    spinner.style.textAlign = 'center'; // Center the spinner
    spinner.style.padding = '10px 0'; // Add some padding
    spinner.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="loading-spinner"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
      <span style="margin-left: 8px; vertical-align: middle; color: #a0c8ff;">Getting feedback...</span>
    `;
    this.responseContentElement.appendChild(spinner);
    // --- End spinner replacement ---

    this.accumulatedResponseText = ''; // Reset accumulated text
    this.responseContentElement.style.display = 'block';
    this.previewButton.disabled = true;
    const responseHeader = this.responseContentElement.previousElementSibling as HTMLElement;
    if (responseHeader) {
        responseHeader.style.display = 'flex';
    }

    fetchFeedback(this.currentImageDataUrl, promptText, this.currentSelectedHtml);
  };

  public updateResponse(chunk: string): void {
    if (this.responseContentElement && this.element) {
      const contentWrapper = this.element.querySelector<HTMLDivElement>(':scope > div:last-child');
      if (!contentWrapper) return;

      const scrollThreshold = 10;
      const isScrolledToBottom = contentWrapper.scrollHeight - contentWrapper.scrollTop - contentWrapper.clientHeight < scrollThreshold;

      // If this is the first chunk, clear the loading spinner/message
      if (!this.isStreamStarted) {
        this.responseContentElement.innerHTML = ''; // Clear previous content (spinner)
        this.isStreamStarted = true; // Mark stream as started
      }

      this.accumulatedResponseText += chunk;
      const parsedHtml = marked.parse(this.accumulatedResponseText) as string;
      // Wrap parsed HTML to ensure consistent structure for scrolling/styling
      this.responseContentElement.innerHTML = `<div class="streamed-content">${parsedHtml}</div>`;

      if (isScrolledToBottom) {
        contentWrapper.scrollTop = contentWrapper.scrollHeight;
      }

      this.tryRenderHtmlPreview();
      // Only try to inject if we have accumulated text
      if (this.accumulatedResponseText.trim()) {
          console.log('[FeedbackViewer DEBUG] Calling tryInjectHtmlFix from updateResponse.');
          this.tryInjectHtmlFix();
      }
    }
  }

  private tryRenderHtmlPreview(): void {
    if (!this.renderedHtmlPreview || !this.originalElementBounds) return;

    const htmlPreviewRegex = /# Complete HTML with All Fixes\s*```(?:html)?\n([\s\S]*?)\n```/i;
    const match = this.accumulatedResponseText.match(htmlPreviewRegex);

    if (match && match[1]) {
      const extractedHtml = match[1].trim();

      if (this.renderedHtmlPreview.innerHTML !== extractedHtml) {
        console.log('[FeedbackViewer] Found updated HTML preview content.');
        this.renderedHtmlPreview.innerHTML = extractedHtml;

        this.renderedHtmlPreview.style.display = 'block';
        this.renderedHtmlPreview.style.opacity = '0';
        this.renderedHtmlPreview.style.pointerEvents = 'auto';

        requestAnimationFrame(() => {
            if (!this.renderedHtmlPreview || !this.originalElementBounds) return;

            this.renderedHtmlPreview.style.visibility = 'hidden';
            this.renderedHtmlPreview.style.opacity = '1';
            const previewRect = this.renderedHtmlPreview.getBoundingClientRect();
            this.renderedHtmlPreview.style.opacity = '0';
            this.renderedHtmlPreview.style.visibility = 'visible';

            const margin = 8;
            const viewportMargin = 10;

            let previewTop = this.originalElementBounds.top - previewRect.height - margin;
            let previewLeft = this.originalElementBounds.left;

            if (previewTop < viewportMargin) {
                previewTop = this.originalElementBounds.bottom + margin;
            }

            if (previewLeft < viewportMargin) {
                previewLeft = viewportMargin;
            }
            else if (previewLeft + previewRect.width > window.innerWidth - viewportMargin) {
                previewLeft = window.innerWidth - previewRect.width - viewportMargin;
            }

            if (previewTop + previewRect.height > window.innerHeight - viewportMargin) {
                 previewTop = window.innerHeight - previewRect.height - viewportMargin;
                 if (previewTop < viewportMargin) {
                     previewTop = viewportMargin;
                 }
            }

            this.renderedHtmlPreview.style.top = `${previewTop}px`;
            this.renderedHtmlPreview.style.left = `${previewLeft}px`;
            console.log(`[FeedbackViewer] Positioned HTML preview at top: ${previewTop}px, left: ${previewLeft}px`);
        });
      }
    } else {
      if (this.renderedHtmlPreview.style.display !== 'none') {
          console.log('[FeedbackViewer] HTML preview pattern not found in response, hiding preview.');
          this.renderedHtmlPreview.style.display = 'none';
          this.renderedHtmlPreview.style.opacity = '0';
          this.renderedHtmlPreview.style.pointerEvents = 'none';
          this.renderedHtmlPreview.innerHTML = '';
      }
    }
  }

  private tryInjectHtmlFix(): void {
    console.log('[FeedbackViewer DEBUG] Entering tryInjectHtmlFix.');

    if (!this.originalElementRef || !document.body.contains(this.originalElementRef)) {
        console.log('[FeedbackViewer DEBUG] tryInjectHtmlFix aborted: originalElementRef invalid or not in DOM.');
        console.log('[FeedbackViewer DEBUG] Calling removeInjectedFix from tryInjectHtmlFix (invalid originalElementRef).');
        this.removeInjectedFix();
        return;
    }

    const specificHtmlRegex = /# Complete HTML with All Fixes\s*```(?:html)?\n([\s\S]*?)\n```/i;
    const genericHtmlRegex = /```(?:html)?\n([\s\S]*?)\n```/i;

    let match = this.accumulatedResponseText.match(specificHtmlRegex);
    if (!match) {
      match = this.accumulatedResponseText.match(genericHtmlRegex);
    }

    if (match && match[1]) {
      const extractedHtml = match[1].trim();
      console.log('[FeedbackViewer DEBUG] Regex matched. Extracted HTML:', extractedHtml.substring(0, 200) + '...');

      let newContentSourceElement: HTMLElement | null = null;
      let newContentHtml = '';
      let attributesToCopy: { name: string; value: string }[] = [];

      try {
        const parser = new DOMParser();
        const parsedDoc = parser.parseFromString(extractedHtml, 'text/html');

        if (parsedDoc.body && extractedHtml.toLowerCase().startsWith('<body')) {
            console.log('[FeedbackViewer DEBUG] Detected <BODY> tag as root. Replacing with <DIV>.');
            const replacementDiv = document.createElement('div');

            attributesToCopy = Array.from(parsedDoc.body.attributes)
                .filter(attr => attr.name.toLowerCase() !== 'style');
            console.log(`[FeedbackViewer DEBUG] Stored ${attributesToCopy.length} attributes from suggested <body> to copy to wrapper.`);

            while (parsedDoc.body.firstChild) {
                replacementDiv.appendChild(parsedDoc.body.firstChild);
            }
            newContentSourceElement = replacementDiv;
            newContentHtml = replacementDiv.innerHTML;
            console.log('[FeedbackViewer DEBUG] Created replacement DIV. innerHTML:', newContentHtml.substring(0, 200) + '...');
        } else {
            const tempContentContainer = document.createElement('div');
            while (parsedDoc.body.firstChild) {
                tempContentContainer.appendChild(parsedDoc.body.firstChild);
            }
            newContentSourceElement = tempContentContainer;
            newContentHtml = tempContentContainer.innerHTML;
            console.log('[FeedbackViewer DEBUG] Using parsed content directly. innerHTML:', newContentHtml.substring(0, 200) + '...');
        }

      } catch (parseError) {
        console.error('[FeedbackViewer DEBUG] Error processing extracted HTML:', parseError);
        return;
      }

      if (!newContentSourceElement) {
          console.error('[FeedbackViewer DEBUG] Failed to create content source element.');
          return;
      }

      const needsUpdate = !this.insertedFixWrapper || this.insertedFixWrapper.innerHTML !== newContentHtml;
      
      if (needsUpdate) {
          console.log('[FeedbackViewer DEBUG] Content changed or wrapper missing. Proceeding with update.');
          console.log('[FeedbackViewer DEBUG] Calling removeInjectedFix from tryInjectHtmlFix (before injecting new fix).');
          this.removeInjectedFix();

          this.insertedFixWrapper = document.createElement('div');
          this.insertedFixWrapper.classList.add('feedback-injected-fix');
          
          this.insertedFixWrapper.style.display = '';

          this.insertedFixWrapper.style.backgroundColor = 'transparent';
          console.log('[FeedbackViewer DEBUG] Set wrapper background to transparent.');

          // Outline is handled by CSS animation now
          // this.insertedFixWrapper.style.outline = '1px dashed #007acc';

          if (attributesToCopy.length > 0) {
              attributesToCopy.forEach(attr => {
                  this.insertedFixWrapper!.setAttribute(attr.name, attr.value);
                  console.log(`[FeedbackViewer DEBUG] Copied attribute to wrapper: ${attr.name}="${attr.value}"`);
              });
          }

          try {
            while (newContentSourceElement.firstChild) {
                this.insertedFixWrapper.appendChild(newContentSourceElement.firstChild);
            }
            console.log('[FeedbackViewer DEBUG] Appended processed content to wrapper.');
          } catch (appendError) {
             console.error('[FeedbackViewer DEBUG] Error appending processed content to wrapper:', appendError);
             this.insertedFixWrapper = null;
             return;
          }

          this.fixWrapperCloseButtonListener = () => {
              console.log('[FeedbackViewer DEBUG] Close button clicked on injected fix.');
              this.removeInjectedFix();
          };
          
          const closeButton = document.createElement('span');
          closeButton.classList.add('feedback-fix-close-btn');
          closeButton.textContent = '✕';
          closeButton.title = 'Dismiss fix suggestion';

          closeButton.addEventListener('click', this.fixWrapperCloseButtonListener);
          this.insertedFixWrapper.appendChild(closeButton);
          
          // --- Add Copy Button ---
          const copyButton = document.createElement('span'); // Use span like the close button
          copyButton.classList.add('feedback-fix-copy-btn');
          copyButton.title = 'Copy viewport to clipboard';
          copyButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`; // Add SVG
          copyButton.addEventListener('click', (e) => {
              e.stopPropagation(); // Prevent triggering other listeners if needed
              console.log('[FeedbackViewer DEBUG] Copy button clicked.');
              copyViewportToClipboard().catch(err => {
                  console.error("Error copying viewport:", err);
                  // Optionally show an error message to the user here
              });
          });
          this.insertedFixWrapper.appendChild(copyButton);
          // --- End Add Copy Button ---

          this.fixWrapperMouseLeaveListener = () => {
              console.log('[FeedbackViewer DEBUG] Mouse left injected fix wrapper.');
              if (this.insertedFixWrapper) {
                  this.insertedFixWrapper.style.display = 'none';
              }
              
              if (this.originalElementRef instanceof HTMLElement) {
                  this.originalElementRef.style.display = this.originalElementDisplayStyle || '';
              }
          };
          
          this.originalElementMouseEnterListener = () => {
              console.log('[FeedbackViewer DEBUG] Mouse entered original element area.');
              if (this.insertedFixWrapper && this.originalElementRef instanceof HTMLElement) {
                  this.insertedFixWrapper.style.display = '';
                  this.originalElementRef.style.display = 'none';
              }
          };

          this.insertedFixWrapper.addEventListener('mouseleave', this.fixWrapperMouseLeaveListener);
          
          if (this.originalElementRef instanceof HTMLElement) {
              this.originalElementRef.addEventListener('mouseenter', this.originalElementMouseEnterListener);
              console.log('[FeedbackViewer DEBUG] Added mouseleave listener to wrapper and mouseenter listener to original element.');
              
              this.originalElementDisplayStyle = window.getComputedStyle(this.originalElementRef).display;
              if (this.originalElementDisplayStyle === 'none') {
                  this.originalElementDisplayStyle = 'block';
              }
              
              this.originalElementRef.style.display = 'none';
          }

          if (this.originalElementRef && this.originalElementRef.parentNode) {
            this.originalElementRef.parentNode.insertBefore(
              this.insertedFixWrapper,
              this.originalElementRef.nextSibling
            );
            console.log('[FeedbackViewer DEBUG] Inserted fix wrapper into DOM after original element.');

            requestAnimationFrame(() => {
                if (this.insertedFixWrapper) {
                    // Opacity is handled by CSS animation now
                    // this.insertedFixWrapper.style.opacity = '1';
                    console.log('[FeedbackViewer DEBUG] Injected fix is now visible (via CSS animation).');
                }
            });

          } else {
            console.error('[FeedbackViewer DEBUG] Cannot insert fix: Original element or its parent not found.');
            this.insertedFixWrapper = null; // Ensure wrapper is nullified if insertion fails
            return; // Exit early if insertion failed
          }
      } else {
         console.log('[FeedbackViewer DEBUG] No update needed (wrapper exists and content matches).');
      }
    } else {
      console.log('[FeedbackViewer DEBUG] Regex did not match. Ensuring fix is removed.');
      console.log('[FeedbackViewer DEBUG] Calling removeInjectedFix from tryInjectHtmlFix (regex mismatch).');
      this.removeInjectedFix();
    }
    console.log('[FeedbackViewer DEBUG] Exiting tryInjectHtmlFix.');
  }

  private removeInjectedFix(): void {
    console.log('[FeedbackViewer DEBUG] >>> Entering removeInjectedFix <<<');
    // Log the call stack to see who called this function
    console.trace('[FeedbackViewer DEBUG] removeInjectedFix call stack:');

    // Remove specific listeners first
    if (this.insertedFixWrapper && this.fixWrapperMouseLeaveListener) {
        console.log('[FeedbackViewer DEBUG] Removing mouseleave listener from fix wrapper.');
        this.insertedFixWrapper.removeEventListener('mouseleave', this.fixWrapperMouseLeaveListener);
        this.fixWrapperMouseLeaveListener = null;
    }
    // Note: Copy button listener is removed implicitly when the wrapper is removed.
    // Close button listener reference is nullified below.

    if (this.originalElementRef instanceof HTMLElement && this.originalElementMouseEnterListener) {
        console.log('[FeedbackViewer DEBUG] Removing mouseenter listener from original element.');
        this.originalElementRef.removeEventListener('mouseenter', this.originalElementMouseEnterListener);
        this.originalElementMouseEnterListener = null;
    }

    // Restore original element display *before* removing the wrapper if possible
    if (this.originalElementRef instanceof HTMLElement) {
        console.log(`[FeedbackViewer DEBUG] Restoring original element display: ${this.originalElementDisplayStyle || 'default'}`);
        // Check if the element is still in the DOM before trying to change its style
        if (document.body.contains(this.originalElementRef)) {
            this.originalElementRef.style.display = this.originalElementDisplayStyle || '';
        } else {
            console.log('[FeedbackViewer DEBUG] Original element no longer in DOM, skipping style restoration.');
        }
    }

    // Remove the wrapper from the DOM
    if (this.insertedFixWrapper) {
        console.log('[FeedbackViewer DEBUG] Removing insertedFixWrapper from DOM.');
        this.insertedFixWrapper.remove(); // This also removes the buttons and their listeners
        this.insertedFixWrapper = null;
    }

    // Nullify remaining references
    this.originalElementDisplayStyle = null;
    if (this.fixWrapperCloseButtonListener) {
        console.log('[FeedbackViewer DEBUG] Nullifying close button listener reference.');
        this.fixWrapperCloseButtonListener = null; // Listener itself is gone with the button
    }
    console.log('[FeedbackViewer DEBUG] <<< Exiting removeInjectedFix >>>');
  }

  public finalizeResponse(): void {
    if (this.responseContentElement && this.accumulatedResponseText === '') {
      this.responseContentElement.textContent = 'Received empty response.';
    }
    console.log("Feedback stream finalized in viewer.");

    if (this.promptTextarea) this.promptTextarea.disabled = false;
    if (this.submitButton && this.submitButtonTextSpan) {
      this.submitButton.disabled = false;
      this.submitButtonTextSpan.textContent = 'Get Feedback';
    }
    // Enable the preview button only if a fix was likely generated
    if (this.previewButton && this.insertedFixWrapper) { // <<< Enable only if fix exists
        this.previewButton.disabled = false;
    }

    this.tryRenderHtmlPreview();
    console.log('[FeedbackViewer DEBUG] Calling tryInjectHtmlFix from finalizeResponse.');
    this.tryInjectHtmlFix();
  }

  public showError(error: Error | string): void {
    if (!this.element || !this.responseContentElement || !this.submitButtonTextSpan || !this.previewButton) return;

    this.element.style.display = 'flex';
    const errorMessage = error instanceof Error ? error.message : String(error);

    this.responseContentElement.innerHTML = '';
    this.accumulatedResponseText = '';

    // Find the response header and show it
    const responseHeader = this.responseContentElement.previousElementSibling as HTMLElement;
    if (responseHeader) {
        responseHeader.style.display = 'flex'; // Show header
    }
    this.previewButton.disabled = true; // Keep preview button disabled on error

    this.responseContentElement.style.display = 'block';
    this.responseContentElement.innerHTML = `<div style="color:#ff8a8a; white-space: pre-wrap;"><strong>Error:</strong> ${escapeHTML(errorMessage)}</div>`;

    if (this.promptTextarea) this.promptTextarea.disabled = false;
    if (this.submitButton && this.submitButtonTextSpan) {
      this.submitButton.disabled = false;
      this.submitButtonTextSpan.textContent = 'Get Feedback';
    }
  }

  public hide(): void {
    if (this.element) {
      this.element.style.display = 'none';
      this.currentImageDataUrl = null;
      this.currentSelectedHtml = null;
      if (this.promptTextarea) this.promptTextarea.value = '';
      if (this.responseContentElement) {
        this.responseContentElement.innerHTML = '';
        // Find the response header and hide it
        const responseHeader = this.responseContentElement.previousElementSibling as HTMLElement;
        if (responseHeader) responseHeader.style.display = 'none'; // Hide header
      }
      this.accumulatedResponseText = '';

      console.log('[FeedbackViewer] Main viewer panel hidden.');
    }
    if (this.renderedHtmlPreview) {
        this.renderedHtmlPreview.style.display = 'none';
        this.renderedHtmlPreview.style.opacity = '0';
        this.renderedHtmlPreview.style.pointerEvents = 'none';
        this.renderedHtmlPreview.innerHTML = '';
        console.log('[FeedbackViewer] Rendered HTML preview hidden.');
    }
  }

  public destroy(): void {
    const styleElement = document.head.querySelector('style');
    if (styleElement && styleElement.textContent?.includes('#feedback-response-content .streamed-content')) {
        document.head.removeChild(styleElement);
    }
    document.removeEventListener('mousedown', this.outsideClickHandler);
    this.promptTextarea?.removeEventListener('keydown', this.handleTextareaKeydown);
    this.closeButton?.removeEventListener('click', () => this.hide());
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    if (this.renderedHtmlPreview && this.renderedHtmlPreview.parentNode) {
        document.body.removeChild(this.renderedHtmlPreview);
    }
    console.log('[FeedbackViewer DEBUG] Calling removeInjectedFix from destroy().');
    this.removeInjectedFix();
    this.element = null;
    this.promptTextarea = null;
    this.submitButton = null;
    this.responseContentElement = null;
    this.currentImageDataUrl = null;
    this.currentSelectedHtml = null;
    this.submitButtonTextSpan = null;
    this.renderedHtmlPreview = null;
    this.originalElementBounds = null;
    this.originalElementRef = null;
    this.insertedFixWrapper = null;
    this.fixWrapperCloseButtonListener = null;
    this.originalElementDisplayStyle = null;
    this.fixWrapperMouseLeaveListener = null;
    this.originalElementMouseEnterListener = null;
    this.closeButton = null;
    this.previewButton = null;
    this.isStreamStarted = false;
    console.log('[FeedbackViewer] Instance destroyed.');
  }
}

export const feedbackViewer = new FeedbackViewer();
