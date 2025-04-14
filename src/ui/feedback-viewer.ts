import { escapeHTML } from './utils';
import { fetchFeedback } from '../services/ai-service';
import { marked } from 'marked'; 

// Flag to track if styles have been injected
let feedbackViewerStylesInjected = false;

/**
 * Injects CSS rules for tighter spacing within the feedback response area.
 */
function injectFeedbackViewerStyles(): void {
    if (feedbackViewerStylesInjected) return;

    const styleId = 'feedback-viewer-styles';
    if (document.getElementById(styleId)) {
        feedbackViewerStylesInjected = true; // Already exists somehow
        return;
    }

    const css = `
#feedback-response-content p,
#feedback-response-content ul,
#feedback-response-content ol,
#feedback-response-content blockquote,
#feedback-response-content pre {
    margin-top: 0.3em;
    margin-bottom: 0.3em;
    margin-block-start: 0;
    margin-block-end: 0;
}

#feedback-response-content ul,
#feedback-response-content ol, {
    margin-top: -20px !important;
}

#feedback-response-content li {
    margin-top: -20px !important;
    margin-bottom: 0.1em;
}

#feedback-response-content li > p {
    margin-top: -10px;
    margin-bottom: 0;
    margin-block-start: 0;
    margin-block-end: 0;
}

#feedback-response-content h1 {
}

#feedback-response-content h1,
#feedback-response-content h2,
#feedback-response-content h3,
#feedback-response-content h4,
#feedback-response-content h5,
#feedback-response-content h6 {
    margin-bottom: 0.3em;
    color: #fff;
    margin-top: -10px;
}
    `;

    const styleElement = document.createElement('style');
    styleElement.id = styleId;
    styleElement.textContent = css;
    document.head.appendChild(styleElement);
    feedbackViewerStylesInjected = true;
    console.log('[FeedbackViewer] Injected custom styles for response content.');
}

/**
 * Class for managing the feedback response viewer modal.
 */
export class FeedbackViewer {
    private element: HTMLDivElement | null = null;
    private capturedImageElement: HTMLImageElement | null = null;
    private promptTextarea: HTMLTextAreaElement | null = null;
    private submitButton: HTMLButtonElement | null = null;
    private submitButtonTextSpan: HTMLSpanElement | null = null;
    private responseContentElement: HTMLElement | null = null;
    private outsideClickHandler: (e: MouseEvent) => void;
    private currentImageDataUrl: string | null = null;
    private accumulatedResponseText: string = '';

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

        // --- Inject styles if not already done ---
        injectFeedbackViewerStyles();
        // --- End style injection ---

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

        // Create a relative container for the textarea and the overlapping button
        const textareaContainer = document.createElement('div');
        textareaContainer.style.position = 'relative'; // Context for absolute positioning
        textareaContainer.style.marginBottom = '20px'; // Space below the textarea/button group

        this.promptTextarea = document.createElement('textarea');
        this.promptTextarea.rows = 4; // Increase rows slightly?
        this.promptTextarea.placeholder = 'e.g., "This button alignment looks off."';
        this.promptTextarea.style.width = 'calc(100% - 16px)'; // Account for padding
        this.promptTextarea.style.padding = '8px';
        // Add padding-bottom to ensure text doesn't go under the button
        this.promptTextarea.style.paddingBottom = '20px';
        this.promptTextarea.style.backgroundColor = '#2a2a2a';
        this.promptTextarea.style.color = '#d4d4d4';
        this.promptTextarea.style.border = '1px solid #555';
        this.promptTextarea.style.borderRadius = '3px';
        this.promptTextarea.style.fontFamily = 'inherit';
        this.promptTextarea.style.fontSize = '13px';
        this.promptTextarea.style.resize = 'vertical'; // Allow vertical resize
        this.promptTextarea.addEventListener('keydown', this.handleTextareaKeydown);
        textareaContainer.appendChild(this.promptTextarea); // Add textarea to its container

        // Submit Button - Positioned absolutely, horizontal internal layout
        this.submitButton = document.createElement('button');
        this.submitButton.style.position = 'absolute'; // Position relative to textareaContainer
        this.submitButton.style.bottom = '8px'; // Position from bottom edge of container
        this.submitButton.style.right = '8px'; // Position from right edge of container
        // Use flexbox for horizontal layout inside the button
        this.submitButton.style.display = 'flex';
        // this.submitButton.style.flexDirection = 'column'; // REMOVED: Default is row
        this.submitButton.style.alignItems = 'baseline'; // Align text baselines
        // this.submitButton.style.justifyContent = 'center'; // REMOVED: Not needed for row layout
        this.submitButton.style.padding = '5px 10px'; // Adjust padding for horizontal layout
        this.submitButton.style.backgroundColor = '#007acc';
        this.submitButton.style.color = 'white';
        this.submitButton.style.border = 'none';
        this.submitButton.style.borderRadius = '3px';
        this.submitButton.style.cursor = 'pointer';
        this.submitButton.style.fontSize = '13px'; // Main text size
        // REMOVED: Margins not needed for absolute positioning
        // this.submitButton.style.marginTop = '10px';
        // this.submitButton.style.marginBottom = '20px';
        // this.submitButton.style.textAlign = 'center'; // REMOVED: Flex handles alignment

        // Main button text ("Get Feedback")
        const buttonText = document.createElement('span');
        buttonText.textContent = 'Get Feedback';
        this.submitButton.appendChild(buttonText);
        this.submitButtonTextSpan = buttonText; // Store reference

        // Shortcut hint text ("(Cmd + ⏎)" or "(Ctrl + ⏎)") - Now side-by-side
        const shortcutHint = document.createElement('span');
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        shortcutHint.textContent = isMac ? '(Cmd+⏎)' : '(Ctrl+⏎)'; // Slightly shorter text
        shortcutHint.style.fontSize = '10px'; // Smaller font size
        shortcutHint.style.color = '#e0e0e0'; // Slightly dimmer color
        // REMOVED: shortcutHint.style.marginTop = '2px';
        shortcutHint.style.marginLeft = '6px'; // Space between main text and hint
        this.submitButton.appendChild(shortcutHint);

        this.submitButton.addEventListener('click', this.handleSubmit);
        // Append the button directly to the textarea container for absolute positioning
        textareaContainer.appendChild(this.submitButton);

        // Append the textarea container (which now includes the button) to the main content wrapper
        contentWrapper.appendChild(textareaContainer);

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
        if (!this.element || !this.capturedImageElement || !this.promptTextarea || !this.submitButton || !this.responseContentElement || !this.submitButtonTextSpan) return;

        this.currentImageDataUrl = imageDataUrl;

        // Reset state
        this.promptTextarea.value = '';
        this.promptTextarea.disabled = false;
        this.submitButton.disabled = false;
        this.submitButtonTextSpan.textContent = 'Get Feedback';
        this.responseContentElement.innerHTML = '';
        this.accumulatedResponseText = '';
        this.responseContentElement.style.display = 'none';
        this.responseContentElement.previousElementSibling?.setAttribute('style', 'display: none');

        // Show image and input elements
        this.capturedImageElement.src = imageDataUrl;
        this.capturedImageElement.style.display = 'block';
        this.promptTextarea.style.display = 'block';
        this.submitButton.style.display = 'flex';

        this.element.style.display = 'block';
        this.promptTextarea.focus();
    }

    private handleTextareaKeydown = (e: KeyboardEvent): void => {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
            e.preventDefault(); // Prevent newline in textarea
            this.handleSubmit();
        }
    };

    private handleSubmit = (): void => {
        if (!this.currentImageDataUrl || !this.promptTextarea || !this.submitButton || !this.responseContentElement || !this.submitButtonTextSpan) return;

        const promptText = this.promptTextarea.value.trim();

        console.log('[Feedback] Submitting feedback...');

        // Disable inputs and show loading state
        this.promptTextarea.disabled = true;
        this.submitButton.disabled = true;
        this.submitButtonTextSpan.textContent = 'Sending...';
        this.responseContentElement.textContent = '⏳ Sending feedback and waiting for response...';
        this.accumulatedResponseText = '';
        this.responseContentElement.style.display = 'block';
        this.responseContentElement.previousElementSibling?.setAttribute('style', 'display: block; color: #88c0ff; margin-bottom: 10px; margin-top: 15px; border-bottom: 1px solid #444; padding-bottom: 4px;');

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
        if (!this.element || !this.responseContentElement || !this.submitButtonTextSpan) return;

        this.element.style.display = 'block'; // Ensure visible
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Clear any loading message or previous content
        this.responseContentElement.innerHTML = '';
        this.accumulatedResponseText = '';

        // Show response title if hidden
        this.responseContentElement.previousElementSibling?.setAttribute('style', 'display: block; color: #88c0ff; margin-bottom: 10px; margin-top: 15px; border-bottom: 1px solid #444; padding-bottom: 4px;');

        // Render error message using innerHTML, escaping the dynamic part
        this.responseContentElement.innerHTML = `<div style="color:#ff6b6b; white-space: pre-wrap;"><strong>Error:</strong> ${escapeHTML(errorMessage)}</div>`;

        // Re-enable input fields on error
        if (this.promptTextarea) this.promptTextarea.disabled = false;
        if (this.submitButton) {
            this.submitButton.disabled = false;
            this.submitButtonTextSpan.textContent = 'Get Feedback';
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
                 this.responseContentElement.innerHTML = '';
            }
            this.accumulatedResponseText = '';
        }
    }

    public destroy(): void {
        document.removeEventListener('mousedown', this.outsideClickHandler);
        this.promptTextarea?.removeEventListener('keydown', this.handleTextareaKeydown);
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.element = null;
        this.capturedImageElement = null;
        this.promptTextarea = null;
        this.submitButton = null;
        this.responseContentElement = null;
        this.currentImageDataUrl = null;
        this.submitButtonTextSpan = null;

        // Note: We don't typically remove the injected styles on destroy,
        // as they are lightweight and might be needed if the viewer is recreated.
        // If you absolutely wanted to remove them, you could do:
        // const styleElement = document.getElementById('feedback-viewer-styles');
        // if (styleElement) styleElement.remove();
        // feedbackViewerStylesInjected = false; // Allow re-injection
    }
}

export const feedbackViewer = new FeedbackViewer();
