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
  private outsideClickHandler: (e: MouseEvent) => void;
  private currentImageDataUrl: string | null = null;
  private currentSelectedHtml: string | null = null;
  private initialCursorX: number | null = null;
  private initialCursorY: number | null = null;
  private accumulatedResponseText: string = '';

  constructor() {
    this.outsideClickHandler = (e: MouseEvent) => {
      if (this.element &&
        this.element.style.display !== 'none' &&
        e.target instanceof Node &&
        !this.element.contains(e.target)) {
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
    clickX: number,
    clickY: number
  ): void {
    if (!this.element) this.create();
    if (!this.element || !this.promptTextarea || !this.submitButton || !this.responseContentElement || !this.submitButtonTextSpan) return;

    this.currentImageDataUrl = imageDataUrl;
    this.currentSelectedHtml = selectedHtml;
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
    this.element = null;
    this.promptTextarea = null;
    this.submitButton = null;
    this.responseContentElement = null;
    this.currentImageDataUrl = null;
    this.currentSelectedHtml = null;
    this.submitButtonTextSpan = null;
  }
}

export const feedbackViewer = new FeedbackViewer();
