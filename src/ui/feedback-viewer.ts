import { escapeHTML } from './utils';
import { fetchFeedback } from '../services/ai-service';
import { marked } from 'marked';

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
  private originalElementMouseEnterListener: (() => void) | null = null;
  private originalElementMouseLeaveListener: (() => void) | null = null;
  private initialCursorX: number | null = null;
  private initialCursorY: number | null = null;
  private accumulatedResponseText: string = '';
  private fixWrapperCloseButtonListener: (() => void) | null = null;

  constructor() {
    this.outsideClickHandler = (e: MouseEvent) => {
      if (this.element &&
        this.element.style.display !== 'none' &&
        e.target instanceof Node &&
        !this.element.contains(e.target) &&
        !this.renderedHtmlPreview?.contains(e.target)) {
        this.hide();
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
        font-size: 1em; /* Reset font size for code blocks */
      }

      #feedback-response-content .streamed-content ul,
      #feedback-response-content .streamed-content ol {
        padding-left: 20px;
        margin-bottom: 1em;
      }

      #feedback-response-content .streamed-content li {
        margin-bottom: 0.4em;
      }

      /* Style for the inline injected fix */
      .feedback-injected-fix {
        position: absolute;
        opacity: 0;
        transition: opacity 0.2s ease-in-out;
        pointer-events: none; /* Wrapper ignores mouse by default */
        z-index: 10;
        margin: 0;
        padding: 0; /* Padding will be handled by content or specific rules */
        box-sizing: border-box;
        max-width: 80vw;
        max-height: 70vh;
        overflow: auto;
        border: 1px dashed #007acc;
        border-radius: 4px;
        color: #abb2bf;
      }

      /* Style for the close button inside the fix wrapper */
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
        z-index: 11; /* Above the fix content */
        pointer-events: auto; /* Make the button clickable */
        transition: background-color 0.2s, color 0.2s;
        font-family: sans-serif; /* Ensure 'X' looks consistent */
      }

      .feedback-fix-close-btn:hover {
        background-color: rgba(200, 50, 50, 0.8);
        color: white;
      }
    `;

    document.head.appendChild(styleElement);

    this.element = document.createElement('div');
    this.element.id = 'feedback-viewer';

    this.element.style.position = 'fixed';
    this.element.style.backgroundColor = '#1e1e1e';
    this.element.style.color = '#d4d4d4';
    this.element.style.padding = '15px';
    this.element.style.borderRadius = '5px';
    this.element.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.5)';
    this.element.style.zIndex = '1002';
    this.element.style.maxHeight = '300px';
    this.element.style.width = '400px';
    this.element.style.overflowY = 'auto';
    this.element.style.fontSize = '13px';
    this.element.style.display = 'none';
    this.element.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    this.element.style.lineHeight = '1.5';

    const contentWrapper = document.createElement('div');

    const promptTitle = document.createElement('h4');
    promptTitle.textContent = 'Describe what you need help with';
    promptTitle.style.color = '#88c0ff';
    promptTitle.style.marginBottom = '5px';
    promptTitle.style.marginTop = '5px';
    promptTitle.style.paddingBottom = '4px';
    contentWrapper.appendChild(promptTitle);

    const textareaContainer = document.createElement('div');
    textareaContainer.style.position = 'relative';
    textareaContainer.style.marginBottom = '20px';

    this.promptTextarea = document.createElement('textarea');
    this.promptTextarea.rows = 4;
    this.promptTextarea.placeholder = 'e.g., "This button alignment looks off."';
    this.promptTextarea.style.width = 'calc(100% - 16px)';
    this.promptTextarea.style.padding = '8px';
    this.promptTextarea.style.paddingBottom = '20px';
    this.promptTextarea.style.backgroundColor = '#2a2a2a';
    this.promptTextarea.style.color = '#d4d4d4';
    this.promptTextarea.style.border = '1px solid #555';
    this.promptTextarea.style.borderRadius = '3px';
    this.promptTextarea.style.fontFamily = 'inherit';
    this.promptTextarea.style.fontSize = '13px';
    this.promptTextarea.style.resize = 'vertical';
    this.promptTextarea.addEventListener('keydown', this.handleTextareaKeydown);
    textareaContainer.appendChild(this.promptTextarea);

    this.submitButton = document.createElement('button');
    this.submitButton.style.position = 'absolute';
    this.submitButton.style.bottom = '8px';
    this.submitButton.style.right = '8px';
    this.submitButton.style.display = 'flex';
    this.submitButton.style.alignItems = 'baseline';
    this.submitButton.style.padding = '5px 10px';
    this.submitButton.style.backgroundColor = '#007acc';
    this.submitButton.style.color = 'white';
    this.submitButton.style.border = 'none';
    this.submitButton.style.borderRadius = '3px';
    this.submitButton.style.cursor = 'pointer';
    this.submitButton.style.fontSize = '13px';

    const buttonText = document.createElement('span');
    buttonText.textContent = 'Get Feedback';
    this.submitButton.appendChild(buttonText);
    this.submitButtonTextSpan = buttonText;

    const shortcutHint = document.createElement('span');
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    shortcutHint.textContent = isMac ? '(Cmd+⏎)' : '(Ctrl+⏎)';
    shortcutHint.style.fontSize = '10px';
    shortcutHint.style.color = '#e0e0e0';
    shortcutHint.style.marginLeft = '6px';
    this.submitButton.appendChild(shortcutHint);

    this.submitButton.addEventListener('click', this.handleSubmit);
    textareaContainer.appendChild(this.submitButton);

    contentWrapper.appendChild(textareaContainer);

    const responseTitle = document.createElement('h4');
    responseTitle.textContent = 'Feedback Response';
    responseTitle.style.color = '#88c0ff';
    responseTitle.style.marginBottom = '10px';
    responseTitle.style.marginTop = '15px';
    responseTitle.style.paddingBottom = '4px';
    responseTitle.style.display = 'none';
    this.responseContentElement = document.createElement('div');
    this.responseContentElement.id = 'feedback-response-content';
    this.responseContentElement.style.wordWrap = 'break-word';
    this.responseContentElement.style.fontFamily = 'inherit';
    this.responseContentElement.style.fontSize = '13px';
    this.responseContentElement.style.marginTop = '15px';
    this.responseContentElement.style.display = 'none';

    contentWrapper.appendChild(responseTitle);
    contentWrapper.appendChild(this.responseContentElement);
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

  private positionViewer(): void {
    if (!this.element) return;

    const viewerRect = this.element.getBoundingClientRect();
    const margin = 10;

    const cursorRect: DOMRect = this.initialCursorX !== null && this.initialCursorY !== null
      ? new DOMRect(this.initialCursorX, this.initialCursorY, 0, 0)
      : new DOMRect(window.innerWidth / 2 - viewerRect.width / 2, window.innerHeight / 2 - viewerRect.height / 2, 0, 0);

    const targetRect = cursorRect;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spaceTop = targetRect.top - margin;
    const spaceBottom = vh - targetRect.top - margin;
    const spaceLeft = targetRect.left - margin;
    const spaceRight = vw - targetRect.left - margin;

    let bestTop = targetRect.top + margin;
    let bestLeft = targetRect.left + margin;

    if (spaceBottom >= viewerRect.height && spaceRight >= viewerRect.width) {
        bestTop = targetRect.top + margin;
        bestLeft = targetRect.left + margin;
    } else if (spaceTop >= viewerRect.height && spaceRight >= viewerRect.width) {
        bestTop = targetRect.top - viewerRect.height - margin;
        bestLeft = targetRect.left + margin;
    } else if (spaceBottom >= viewerRect.height && spaceLeft >= viewerRect.width) {
        bestTop = targetRect.top + margin;
        bestLeft = targetRect.left - viewerRect.width - margin;
    } else if (spaceTop >= viewerRect.height && spaceLeft >= viewerRect.width) {
        bestTop = targetRect.top - viewerRect.height - margin;
        bestLeft = targetRect.left - viewerRect.width - margin;
    } else {
        if (spaceBottom >= viewerRect.height) {
            bestTop = targetRect.top + margin;
            bestLeft = targetRect.left - viewerRect.width / 2;
        } else if (spaceTop >= viewerRect.height) {
            bestTop = targetRect.top - viewerRect.height - margin;
            bestLeft = targetRect.left - viewerRect.width / 2;
        }
    }

    if (bestLeft < margin) {
      bestLeft = margin;
    } else if (bestLeft + viewerRect.width > vw - margin) {
      bestLeft = vw - viewerRect.width - margin;
    }

    if (bestTop < margin) {
      bestTop = margin;
    } else if (bestTop + viewerRect.height > vh - margin) {
      bestTop = vh - viewerRect.height - margin;
    }

    this.element.style.top = `${bestTop}px`;
    this.element.style.left = `${bestLeft}px`;
    this.element.style.transform = 'none';
  }

  public showInputArea(
    imageDataUrl: string | null,
    selectedHtml: string | null,
    targetRect: DOMRect | null,
    targetElement: Element | null,
    clickX: number,
    clickY: number
  ): void {
    if (!this.element) this.create();
    if (!this.element || !this.promptTextarea || !this.submitButton || !this.responseContentElement || !this.submitButtonTextSpan || !this.renderedHtmlPreview) return;

    this.currentImageDataUrl = imageDataUrl;
    this.currentSelectedHtml = selectedHtml;
    this.originalElementBounds = targetRect;
    this.originalElementRef = targetElement;
    this.initialCursorX = clickX;
    this.initialCursorY = clickY;

    this.promptTextarea.value = '';
    this.promptTextarea.disabled = false;
    this.submitButton.disabled = false;
    this.submitButtonTextSpan.textContent = 'Get Feedback';
    this.responseContentElement.innerHTML = '';
    this.accumulatedResponseText = '';
    this.responseContentElement.style.display = 'none';
    const responseTitle = this.responseContentElement.previousElementSibling as HTMLElement;
    if (responseTitle) responseTitle.style.display = 'none';

    this.renderedHtmlPreview.innerHTML = '';
    this.renderedHtmlPreview.style.display = 'none';
    this.renderedHtmlPreview.style.opacity = '0';
    this.renderedHtmlPreview.style.pointerEvents = 'none';

    this.removeInjectedFix();

    this.promptTextarea.style.display = 'block';
    this.submitButton.style.display = 'flex';

    this.element.style.display = 'block';
    this.positionViewer();

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
    if (!this.promptTextarea || !this.submitButton || !this.responseContentElement || !this.submitButtonTextSpan) return;
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
    this.responseContentElement.textContent = '⏳ Getting feedback...';
    this.accumulatedResponseText = '';
    this.responseContentElement.style.display = 'block';
    this.responseContentElement.previousElementSibling?.setAttribute('style', 'display: block; color: #88c0ff; margin-bottom: 10px; margin-top: 15px; border-bottom: 1px solid #444; padding-bottom: 4px;');

    fetchFeedback(this.currentImageDataUrl, promptText, this.currentSelectedHtml);
  };

  public prepareForStream(): void {
    if (this.responseContentElement) {
      this.responseContentElement.innerHTML = '';
      this.accumulatedResponseText = '';
    }
  }

  public updateResponse(chunk: string): void {
    if (this.responseContentElement && this.element) {
      const scrollThreshold = 10;
      const isScrolledToBottom = this.element.scrollHeight - this.element.scrollTop - this.element.clientHeight < scrollThreshold;

      if (this.accumulatedResponseText === '' && this.responseContentElement.textContent?.startsWith('⏳')) {
        this.responseContentElement.innerHTML = '';
      }
      this.accumulatedResponseText += chunk;
      const parsedHtml = marked.parse(this.accumulatedResponseText) as string;
      this.responseContentElement.innerHTML = `<div class="streamed-content">${parsedHtml}</div>`;

      if (isScrolledToBottom) {
        this.element.scrollTop = this.element.scrollHeight;
      }

      this.tryRenderHtmlPreview();
      console.log('[FeedbackViewer DEBUG] Calling tryInjectHtmlFix from updateResponse.');
      this.tryInjectHtmlFix();
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

    if (!this.originalElementRef) {
      console.log('[FeedbackViewer DEBUG] tryInjectHtmlFix aborted: originalElementRef is null.');
      this.removeInjectedFix(); // Ensure cleanup if ref is lost
      return;
    }
    if (!document.body.contains(this.originalElementRef)) {
      console.log('[FeedbackViewer DEBUG] tryInjectHtmlFix aborted: originalElementRef is no longer in the DOM.');
      this.removeInjectedFix(); // Clean up if original element is gone
      return;
    }
    console.log('[FeedbackViewer DEBUG] Original element reference is valid and in DOM:', this.originalElementRef);

    // Regex specifically looking for the marked complete HTML
    const specificHtmlRegex = /# Complete HTML with All Fixes\s*```(?:html)?\n([\s\S]*?)\n```/i;
    // Generic regex looking for the first HTML code block
    const genericHtmlRegex = /```(?:html)?\n([\s\S]*?)\n```/i;

    // Try the specific regex first
    let match = this.accumulatedResponseText.match(specificHtmlRegex);

    // If the specific heading isn't found, try the generic regex
    if (!match) {
      console.log('[FeedbackViewer DEBUG] Specific "# Complete HTML..." heading not found. Trying generic HTML block regex.');
      match = this.accumulatedResponseText.match(genericHtmlRegex);
    }

    if (match && match[1]) {
      const extractedHtml = match[1].trim();
      console.log('[FeedbackViewer DEBUG] Regex matched. Extracted HTML:', extractedHtml.substring(0, 200) + '...'); // Log start of HTML

      let contentChanged = false;

      // --- Use DOMParser ---
      const parser = new DOMParser();
      let parsedDoc;
      let newContentHtml = '';
      try {
        parsedDoc = parser.parseFromString(extractedHtml, 'text/html');
        const tempContentContainer = document.createElement('div');
        while (parsedDoc.body.firstChild) {
            tempContentContainer.appendChild(parsedDoc.body.firstChild);
        }
        newContentHtml = tempContentContainer.innerHTML;
        console.log('[FeedbackViewer DEBUG] Parsed HTML successfully. Parsed content innerHTML:', newContentHtml.substring(0, 200) + '...');
      } catch (parseError) {
        console.error('[FeedbackViewer DEBUG] Error parsing extracted HTML:', parseError);
        this.removeInjectedFix(); // Clean up on parse error
        return;
      }


      // --- Check if update is needed ---
      const needsUpdate = !this.insertedFixWrapper || this.insertedFixWrapper.innerHTML !== newContentHtml;
      console.log(`[FeedbackViewer DEBUG] Needs update? ${needsUpdate}. Current wrapper exists: ${!!this.insertedFixWrapper}`);
      if (this.insertedFixWrapper) {
        console.log('[FeedbackViewer DEBUG] Current wrapper innerHTML:', this.insertedFixWrapper.innerHTML.substring(0, 200) + '...');
      }


      if (needsUpdate) {
          console.log('[FeedbackViewer DEBUG] Content changed or wrapper missing. Proceeding with update.');
          contentChanged = true; // Though not strictly used later, indicates update happened

          // --- Remove existing fix, its listeners, AND original element hover listeners ---
          console.log('[FeedbackViewer DEBUG] Calling removeInjectedFix before creating new wrapper.');
          this.removeInjectedFix(); // This now also removes original element listeners

          // --- Create and style the new wrapper ---
          this.insertedFixWrapper = document.createElement('div');
          this.insertedFixWrapper.classList.add('feedback-injected-fix');

          // --- Append parsed content ---
          try {
            const freshParsedDoc = parser.parseFromString(extractedHtml, 'text/html');
            while (freshParsedDoc.body.firstChild) {
                this.insertedFixWrapper.appendChild(freshParsedDoc.body.firstChild);
            }
            console.log('[FeedbackViewer DEBUG] Appended parsed content to wrapper.');
          } catch (appendError) {
             console.error('[FeedbackViewer DEBUG] Error appending parsed content to wrapper:', appendError);
             this.insertedFixWrapper = null;
             return;
          }

          // --- Create and add the close button ---
          const closeButton = document.createElement('span');
          closeButton.classList.add('feedback-fix-close-btn');
          closeButton.textContent = '✕'; // Multiplication sign for 'X'
          closeButton.title = 'Dismiss fix suggestion';

          // Define the listener for the close button
          this.fixWrapperCloseButtonListener = () => {
              console.log('[FeedbackViewer DEBUG] Close button clicked on injected fix.');
              this.removeInjectedFix(); // Call remove to clean up everything related to the fix
          };
          closeButton.addEventListener('click', this.fixWrapperCloseButtonListener);
          this.insertedFixWrapper.appendChild(closeButton);
          console.log('[FeedbackViewer DEBUG] Added close button to wrapper.');


          // --- Calculate position (Top/Left only) ---
          const rect = this.originalElementRef.getBoundingClientRect();
          const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
          const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
          const topPos = rect.top + scrollTop;
          const leftPos = rect.left + scrollLeft;

          this.insertedFixWrapper.style.top = `${topPos}px`;
          this.insertedFixWrapper.style.left = `${leftPos}px`;
          console.log(`[FeedbackViewer DEBUG] Calculated position: top=${topPos}px, left=${leftPos}px`);

          // --- Append wrapper to body ---
          document.body.appendChild(this.insertedFixWrapper);
          console.log('[FeedbackViewer DEBUG] Appended insertedFixWrapper to document.body.');

          // --- Add hover listeners TO THE ORIGINAL ELEMENT ---
          // Clear any potentially lingering listeners first (should be handled by removeInjectedFix, but belt-and-suspenders)
          if (this.originalElementMouseEnterListener) {
              this.originalElementRef.removeEventListener('mouseenter', this.originalElementMouseEnterListener);
          }
          if (this.originalElementMouseLeaveListener) {
              this.originalElementRef.removeEventListener('mouseleave', this.originalElementMouseLeaveListener);
          }

          this.originalElementMouseEnterListener = () => {
            console.log('[FeedbackViewer DEBUG] MouseEnter on original element triggered.');
            if (this.insertedFixWrapper) {
              this.insertedFixWrapper.style.opacity = '1';
              this.insertedFixWrapper.style.pointerEvents = 'auto'; // Allow interaction when visible
              console.log('[FeedbackViewer DEBUG] Set wrapper opacity to 1 and pointerEvents to auto.');
            } else {
              console.log('[FeedbackViewer DEBUG] MouseEnter: Wrapper was null.');
            }
          };
          this.originalElementMouseLeaveListener = () => {
            console.log('[FeedbackViewer DEBUG] MouseLeave on original element triggered.');
            // Check if the mouse is moving TO the fix wrapper itself before hiding
            // This requires the wrapper to have pointer-events: auto when visible
            if (this.insertedFixWrapper && !this.insertedFixWrapper.matches(':hover')) {
                this.insertedFixWrapper.style.opacity = '0';
                this.insertedFixWrapper.style.pointerEvents = 'none'; // Disable interaction when hidden
                console.log('[FeedbackViewer DEBUG] Set wrapper opacity to 0 and pointerEvents to none.');
            } else if (this.insertedFixWrapper) {
                console.log('[FeedbackViewer DEBUG] MouseLeave: Mouse moved onto the fix wrapper, keeping visible.');
            } else {
               console.log('[FeedbackViewer DEBUG] MouseLeave: Wrapper was null.');
            }
          };

          this.originalElementRef.addEventListener('mouseenter', this.originalElementMouseEnterListener);
          this.originalElementRef.addEventListener('mouseleave', this.originalElementMouseLeaveListener);
          console.log('[FeedbackViewer DEBUG] Added hover listeners to original element.');

          // Add a listener to the wrapper itself to handle mouse leaving IT
          // This prevents flickering when moving from original element onto the fix
          this.insertedFixWrapper.addEventListener('mouseleave', () => {
              console.log('[FeedbackViewer DEBUG] MouseLeave from fix wrapper triggered.');
              // Check if the mouse moved back to the original element
              if (this.originalElementRef && !this.originalElementRef.matches(':hover')) {
                  if (this.insertedFixWrapper) {
                      this.insertedFixWrapper.style.opacity = '0';
                      this.insertedFixWrapper.style.pointerEvents = 'none';
                      console.log('[FeedbackViewer DEBUG] Set wrapper opacity to 0 and pointerEvents to none after leaving wrapper.');
                  }
              } else {
                   console.log('[FeedbackViewer DEBUG] MouseLeave from fix wrapper: Mouse moved back onto original element.');
              }
          });

      } else {
         console.log('[FeedbackViewer DEBUG] No update needed (wrapper exists and content matches).');
      }
    } else {
      // If pattern not found, ensure fix is removed (including listeners)
      console.log('[FeedbackViewer DEBUG] Regex did not match (neither specific nor generic). Ensuring fix is removed.');
      this.removeInjectedFix();
    }
    console.log('[FeedbackViewer DEBUG] Exiting tryInjectHtmlFix.');
  }

  private removeInjectedFix(): void {
    console.log('[FeedbackViewer DEBUG] Entering removeInjectedFix.');
    let listenersRemoved = false;
    let elementRemoved = false;

    // Remove hover listeners from the original element
    if (this.originalElementRef) {
      if (this.originalElementMouseEnterListener) {
        this.originalElementRef.removeEventListener('mouseenter', this.originalElementMouseEnterListener);
        this.originalElementMouseEnterListener = null;
        listenersRemoved = true;
        console.log('[FeedbackViewer DEBUG] Removed mouseenter listener from original element.');
      }
      if (this.originalElementMouseLeaveListener) {
        this.originalElementRef.removeEventListener('mouseleave', this.originalElementMouseLeaveListener);
        this.originalElementMouseLeaveListener = null;
        listenersRemoved = true;
        console.log('[FeedbackViewer DEBUG] Removed mouseleave listener from original element.');
      }
    } else {
       console.log('[FeedbackViewer DEBUG] originalElementRef is null, cannot remove hover listeners.');
    }

    // Remove the wrapper element and its close button listener
    if (this.insertedFixWrapper) {
      // No need to explicitly remove the close button listener if the element is removed
      // but good practice to nullify our reference to the listener function
      this.fixWrapperCloseButtonListener = null;
      this.insertedFixWrapper.remove();
      this.insertedFixWrapper = null;
      elementRemoved = true;
      console.log('[FeedbackViewer DEBUG] Removed insertedFixWrapper element from DOM.');
    } else {
       console.log('[FeedbackViewer DEBUG] insertedFixWrapper is null, nothing to remove from DOM.');
    }

    if (listenersRemoved || elementRemoved) {
        console.log('[FeedbackViewer DEBUG] removeInjectedFix completed actions.');
    } else {
        console.log('[FeedbackViewer DEBUG] removeInjectedFix completed, no actions needed.');
    }
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

    this.tryRenderHtmlPreview();
    console.log('[FeedbackViewer DEBUG] Calling tryInjectHtmlFix from finalizeResponse.');
    this.tryInjectHtmlFix(); // Final check
  }

  public showError(error: Error | string): void {
    if (!this.element || !this.responseContentElement || !this.submitButtonTextSpan) return;

    this.element.style.display = 'block';
    const errorMessage = error instanceof Error ? error.message : String(error);

    this.responseContentElement.innerHTML = '';
    this.accumulatedResponseText = '';

    this.responseContentElement.previousElementSibling?.setAttribute('style', 'display: block; color: #88c0ff; margin-bottom: 10px; margin-top: 15px; border-bottom: 1px solid #444; padding-bottom: 4px;');

    this.responseContentElement.innerHTML = `<div style="color:#ff6b6b; white-space: pre-wrap;"><strong>Error:</strong> ${escapeHTML(errorMessage)}</div>`;

    if (this.promptTextarea) this.promptTextarea.disabled = false;
    if (this.submitButton) {
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
      }
      this.accumulatedResponseText = '';
      console.log('[FeedbackViewer] Main viewer panel hidden.');
    }
    if (this.renderedHtmlPreview) {
        this.renderedHtmlPreview.style.display = 'none';
        this.renderedHtmlPreview.style.opacity = '0';
        this.renderedHtmlPreview.style.pointerEvents = 'none';
        this.renderedHtmlPreview.innerHTML = '';
        console.log('[FeedbackViewer] HTML preview overlay hidden.');
    }
    this.initialCursorX = null;
    this.initialCursorY = null;
  }

  public destroy(): void {
    const styleElement = document.head.querySelector('style');
    if (styleElement && styleElement.textContent?.includes('#feedback-response-content .streamed-content')) {
        document.head.removeChild(styleElement);
    }
    document.removeEventListener('mousedown', this.outsideClickHandler);
    this.promptTextarea?.removeEventListener('keydown', this.handleTextareaKeydown);
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    if (this.renderedHtmlPreview && this.renderedHtmlPreview.parentNode) {
        this.renderedHtmlPreview.replaceWith(this.renderedHtmlPreview.cloneNode(true));
        document.body.removeChild(this.renderedHtmlPreview);
    }
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
    this.originalElementMouseEnterListener = null;
    this.originalElementMouseLeaveListener = null;
    this.fixWrapperCloseButtonListener = null;
    console.log('[FeedbackViewer] Instance destroyed.');
  }
}

export const feedbackViewer = new FeedbackViewer();
