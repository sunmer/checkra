import { createCloseButton, escapeHTML } from './utils';
import { fetchFeedback } from '../services/ai-service';
import { marked } from 'marked'; 

/**
 * Class for managing the feedback response viewer modal.
 */
export class FeedbackViewer {
    private element: HTMLDivElement | null = null;
    private capturedImageElement: HTMLImageElement | null = null;
    private promptTextarea: HTMLTextAreaElement | null = null; // Added
    private submitButton: HTMLButtonElement | null = null; // Added
    private shortcutLabel: HTMLSpanElement | null = null; // Added
    private responseContentElement: HTMLElement | null = null;
    private outsideClickHandler: (e: MouseEvent) => void;
    private currentImageDataUrl: string | null = null; // Store image data
    private accumulatedResponseText: string = ''; // <-- Add accumulator for raw text

    constructor() {
        this.outsideClickHandler = (e: MouseEvent) => {
            // Allow clicks on textarea/button without closing
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

        this.element = document.createElement('div');
        this.element.id = 'feedback-viewer';

        // Style similarly to contentViewer
        this.element.style.position = 'fixed';
        this.element.style.top = '50%';
        this.element.style.left = '50%';
        this.element.style.transform = 'translate(-50%, -50%)';
        this.element.style.backgroundColor = '#1e1e1e'; // Match contentViewer
        this.element.style.color = '#d4d4d4';
        this.element.style.padding = '20px';
        this.element.style.borderRadius = '5px';
        this.element.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
        this.element.style.zIndex = '1002'; // Same as contentViewer
        this.element.style.maxWidth = '70%'; // Adjust as needed
        this.element.style.maxHeight = '70%';
        this.element.style.overflowY = 'auto';
        this.element.style.fontSize = '13px'; // Slightly larger?
        this.element.style.display = 'none';
        this.element.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif'; // Use default UI font
        this.element.style.lineHeight = '1.5'; // Improve readability

        // Add close button
        const closeButton = createCloseButton(() => this.hide());
        this.element.appendChild(closeButton);

        // Content structure
        const contentWrapper = document.createElement('div');

        // Captured Image Area
        const imageTitle = document.createElement('h4');
        imageTitle.textContent = 'Captured Feedback Area';
        imageTitle.style.color = '#88c0ff'; // Lighter blue
        imageTitle.style.marginBottom = '5px';
        imageTitle.style.marginTop = '0'; // Remove default top margin
        imageTitle.style.borderBottom = '1px solid #444';
        imageTitle.style.paddingBottom = '4px';
        this.capturedImageElement = document.createElement('img');
        this.capturedImageElement.style.maxWidth = '100%';
        this.capturedImageElement.style.maxHeight = '400px'; // Increased max height for larger preview
        this.capturedImageElement.style.border = '1px solid #444';
        this.capturedImageElement.style.marginBottom = '15px';
        this.capturedImageElement.style.display = 'none'; // Hide initially

        // Prompt Input Area
        const promptTitle = document.createElement('h4');
        promptTitle.textContent = 'Describe what you need help with';
        promptTitle.style.color = '#88c0ff';
        promptTitle.style.marginBottom = '5px';
        promptTitle.style.marginTop = '5px';
        promptTitle.style.paddingBottom = '4px';
        contentWrapper.appendChild(promptTitle);

        this.promptTextarea = document.createElement('textarea');
        this.promptTextarea.rows = 3;
        this.promptTextarea.placeholder = 'e.g., "This button alignment looks off."';
        this.promptTextarea.style.width = 'calc(100% - 16px)'; // Account for padding
        this.promptTextarea.style.padding = '8px';
        this.promptTextarea.style.marginBottom = '5px';
        this.promptTextarea.style.backgroundColor = '#2a2a2a';
        this.promptTextarea.style.color = '#d4d4d4';
        this.promptTextarea.style.border = '1px solid #555';
        this.promptTextarea.style.borderRadius = '3px';
        this.promptTextarea.style.fontFamily = 'inherit';
        this.promptTextarea.style.fontSize = '13px';
        this.promptTextarea.addEventListener('keydown', this.handleTextareaKeydown);
        contentWrapper.appendChild(this.promptTextarea);

        // Shortcut Label
        this.shortcutLabel = document.createElement('span');
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        this.shortcutLabel.textContent = isMac ? 'Cmd + Enter to submit' : 'Ctrl + Enter to submit';
        this.shortcutLabel.style.fontSize = '11px';
        this.shortcutLabel.style.color = '#888';
        this.shortcutLabel.style.display = 'block'; // Place below textarea
        this.shortcutLabel.style.textAlign = 'right';
        this.shortcutLabel.style.marginBottom = '10px';
        contentWrapper.appendChild(this.shortcutLabel);

        // Submit Button
        this.submitButton = document.createElement('button');
        this.submitButton.textContent = 'Get Feedback';
        this.submitButton.style.padding = '8px 15px';
        this.submitButton.style.backgroundColor = '#007acc';
        this.submitButton.style.color = 'white';
        this.submitButton.style.border = 'none';
        this.submitButton.style.borderRadius = '3px';
        this.submitButton.style.cursor = 'pointer';
        this.submitButton.style.fontSize = '13px';
        this.submitButton.style.marginBottom = '20px';
        this.submitButton.addEventListener('click', this.handleSubmit);
        contentWrapper.appendChild(this.submitButton);

        // Response Area
        const responseTitle = document.createElement('h4');
        responseTitle.textContent = 'Feedback Response';
        responseTitle.style.color = '#88c0ff';
        responseTitle.style.marginBottom = '10px';
        responseTitle.style.marginTop = '15px'; // Add space above response title
        responseTitle.style.borderBottom = '1px solid #444';
        responseTitle.style.paddingBottom = '4px';
        responseTitle.style.display = 'none'; // Hide initially
        this.responseContentElement = document.createElement('div');
        this.responseContentElement.id = 'feedback-response-content';
        this.responseContentElement.style.whiteSpace = 'pre-wrap'; // Crucial for markdown line breaks
        this.responseContentElement.style.wordWrap = 'break-word'; // Ensure long lines wrap
        this.responseContentElement.style.fontFamily = 'inherit'; // Inherit from modal
        this.responseContentElement.style.fontSize = '13px';
        this.responseContentElement.style.marginTop = '15px'; // Add space above response
        this.responseContentElement.style.display = 'none'; // Hide initially

        contentWrapper.appendChild(imageTitle);
        contentWrapper.appendChild(this.capturedImageElement);
        contentWrapper.appendChild(responseTitle);
        contentWrapper.appendChild(this.responseContentElement);
        this.element.appendChild(contentWrapper);

        document.body.appendChild(this.element);
        document.addEventListener('mousedown', this.outsideClickHandler);
    }

    public showInputArea(imageDataUrl: string): void {
        if (!this.element) this.create();
        if (!this.element || !this.capturedImageElement || !this.promptTextarea || !this.submitButton || !this.responseContentElement) return;

        this.currentImageDataUrl = imageDataUrl; // Store for submission

        // Reset state
        this.promptTextarea.value = '';
        this.promptTextarea.disabled = false;
        this.submitButton.disabled = false;
        this.submitButton.textContent = 'Get Feedback';
        this.responseContentElement.innerHTML = ''; // <-- Use innerHTML
        this.accumulatedResponseText = ''; // <-- Reset accumulator
        this.responseContentElement.style.display = 'none';
        this.responseContentElement.previousElementSibling?.setAttribute('style', 'display: none'); // Hide response title

        // Show image and input elements
        this.capturedImageElement.src = imageDataUrl;
        this.capturedImageElement.style.display = 'block';
        this.promptTextarea.style.display = 'block';
        this.submitButton.style.display = 'block';
        this.shortcutLabel!.style.display = 'block'; // Show shortcut label

        this.element.style.display = 'block';
        this.promptTextarea.focus(); // Focus textarea for immediate typing
    }

    private handleTextareaKeydown = (e: KeyboardEvent): void => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
            e.preventDefault(); // Prevent newline in textarea
            this.handleSubmit();
        }
    };

    private handleSubmit = (): void => {
        if (!this.currentImageDataUrl || !this.promptTextarea || !this.submitButton || !this.responseContentElement) return;

        const promptText = this.promptTextarea.value.trim();

        console.log('[Feedback] Submitting feedback...');

        // Disable inputs and show loading state
        this.promptTextarea.disabled = true;
        this.submitButton.disabled = true;
        this.submitButton.textContent = 'Sending...';
        // Use textContent for the initial loading message, as it's not markdown
        this.responseContentElement.textContent = '⏳ Sending feedback and waiting for response...';
        this.accumulatedResponseText = ''; // Clear accumulator before new request
        this.responseContentElement.style.display = 'block';
        this.responseContentElement.previousElementSibling?.setAttribute('style', 'display: block; color: #88c0ff; margin-bottom: 10px; margin-top: 15px; border-bottom: 1px solid #444; padding-bottom: 4px;'); // Show response title

        // Call the service function
        fetchFeedback(this.currentImageDataUrl, promptText);
    };

    // Called by ai-service when stream starts
    public prepareForStream(): void {
         if (this.responseContentElement) {
             // Clear the "Sending..." message using innerHTML
             this.responseContentElement.innerHTML = '';
             this.accumulatedResponseText = ''; // Ensure accumulator is clear
         }
    }

    public updateResponse(chunk: string): void {
        if (this.responseContentElement) {
            // If it was showing the initial "Sending..." message, clear it first
            // (prepareForStream should handle this, but double-check doesn't hurt)
            if (this.accumulatedResponseText === '' && this.responseContentElement.textContent?.startsWith('⏳')) {
                 this.responseContentElement.innerHTML = '';
            }
            // Append raw chunk to accumulator
            this.accumulatedResponseText += chunk;
            // Parse the entire accumulated text and render as HTML
            // Note: marked.parse() is synchronous in v4+
            this.responseContentElement.innerHTML = marked.parse(this.accumulatedResponseText) as string;
            // Scroll to bottom
            this.element?.scrollTo(0, this.element.scrollHeight);
        }
    }

     public finalizeResponse(): void {
        // Check the accumulated raw text for emptiness
        if (this.responseContentElement && this.accumulatedResponseText === '') {
             // Use textContent for simple messages
             this.responseContentElement.textContent = 'Received empty response.';
        }
        // No need to parse again here if updateResponse parses every time
        console.log("Feedback stream finalized in viewer.");
     }

    public showError(error: Error | string): void {
        if (!this.element || !this.responseContentElement) return;

        this.element.style.display = 'block'; // Ensure visible
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Clear any loading message or previous content
        this.responseContentElement.innerHTML = ''; // <-- Use innerHTML
        this.accumulatedResponseText = ''; // <-- Reset accumulator

        // Show response title if hidden
        this.responseContentElement.previousElementSibling?.setAttribute('style', 'display: block; color: #88c0ff; margin-bottom: 10px; margin-top: 15px; border-bottom: 1px solid #444; padding-bottom: 4px;');

        // Render error message using innerHTML, escaping the dynamic part
        this.responseContentElement.innerHTML = `<div style="color:#ff6b6b; white-space: pre-wrap;"><strong>Error:</strong> ${escapeHTML(errorMessage)}</div>`;

        // Re-enable input fields on error
        if (this.promptTextarea) this.promptTextarea.disabled = false;
        if (this.submitButton) {
            this.submitButton.disabled = false;
            this.submitButton.textContent = 'Get Feedback';
        }
    }

    public hide(): void {
        if (this.element) {
            this.element.style.display = 'none';
            // Clear sensitive data when hiding
            this.currentImageDataUrl = null;
            if (this.capturedImageElement) this.capturedImageElement.src = '';
            if (this.promptTextarea) this.promptTextarea.value = '';
            if (this.responseContentElement) {
                 this.responseContentElement.innerHTML = ''; // <-- Use innerHTML
            }
            this.accumulatedResponseText = ''; // <-- Reset accumulator
        }
    }

    public destroy(): void {
        document.removeEventListener('mousedown', this.outsideClickHandler);
        // Remove specific listener if textarea exists
        this.promptTextarea?.removeEventListener('keydown', this.handleTextareaKeydown);
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
        this.capturedImageElement = null;
        this.promptTextarea = null;
        this.submitButton = null;
        this.shortcutLabel = null;
        this.responseContentElement = null;
        this.currentImageDataUrl = null;
    }
}

export const feedbackViewer = new FeedbackViewer();
