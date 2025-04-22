import './feedback-viewer.css';
import { escapeHTML } from './utils';

// --- LocalStorage Keys & Defaults ---
const DEFAULT_WIDTH = 450;
const DEFAULT_HEIGHT = 220;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 220;
const MAX_WIDTH_VW = 80;
// const MAX_HEIGHT_VH = 60; // << REMOVE or comment out (no longer used)

// --- Helper to detect mobile/touch devices ---
function isMobileDevice(): boolean {
    // Check for touch events OR max-touch-points (more modern check)
    // Consider also navigator.userAgentData.mobile for future proofing if needed
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}

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
    resizeHandle: HTMLDivElement;
    actionButtonsContainer: HTMLDivElement;
    previewApplyButton: HTMLButtonElement;
    cancelButton: HTMLButtonElement;
    responseHeader: HTMLDivElement;
    contentWrapper: HTMLDivElement;
}

/**
 * Manages the DOM elements, styling, positioning, dragging, and resizing
 * of the feedback viewer.
 */
export class FeedbackViewerDOM {
    private elements: FeedbackViewerElements | null = null;
    private readonly originalPromptTitleText = 'Describe what you need help with';

    // --- Dragging State ---
    private isDragging: boolean = false;
    private dragStartX: number = 0;
    private dragStartY: number = 0;
    private dragInitialLeft: number = 0;
    private dragInitialTop: number = 0;

    // --- Resizing State ---
    private isResizing: boolean = false;
    private resizeStartX: number = 0;
    private resizeStartY: number = 0;
    private initialWidth: number = 0;
    private initialHeight: number = 0;

    constructor() {
        // Bind methods that will be used as event listeners
        this.handleDragStart = this.handleDragStart.bind(this);
        this.handleDragMove = this.handleDragMove.bind(this);
        this.handleDragEnd = this.handleDragEnd.bind(this);
        this.handleResizeStart = this.handleResizeStart.bind(this);
        this.handleResizeMove = this.handleResizeMove.bind(this);
        this.handleResizeEnd = this.handleResizeEnd.bind(this);
    }

    // --- Initialization and Cleanup ---

    public create(): FeedbackViewerElements {
        if (this.elements) return this.elements;

        const viewer = document.createElement('div');
        viewer.id = 'checkra-feedback-viewer';

        const initialWidth = DEFAULT_WIDTH;
        const initialHeight = DEFAULT_HEIGHT;

        viewer.style.width = `${initialWidth}px`;
        viewer.style.height = `${initialHeight}px`;
        viewer.style.minWidth = `${MIN_WIDTH}px`;
        viewer.style.minHeight = `${MIN_HEIGHT}px`;
        viewer.style.maxWidth = `${MAX_WIDTH_VW}vw`;
        // viewer.style.maxHeight = `${MAX_HEIGHT_VH}vh`; // << REMOVE or comment out this line
        viewer.style.display = 'none'; // Initial state

        // Add listener regardless, handler will check device type
        // viewer.addEventListener('mousedown', this.handleDragStart);

        // --- BEGIN EDIT ---
        // Only attach drag listener on non-mobile devices
        if (!isMobileDevice()) {
            viewer.addEventListener('mousedown', this.handleDragStart);
        }
        // --- END EDIT ---

        // --- Header ---
        const responseHeader = document.createElement('div');
        responseHeader.id = 'checkra-feedback-response-header';

        const responseTitle = document.createElement('h4');
        responseTitle.textContent = 'Feedback Response';
        responseTitle.style.color = '#a0c8ff';
        responseTitle.style.fontSize = '14px';
        responseTitle.style.fontWeight = '600';
        responseTitle.style.margin = '0';
        responseHeader.appendChild(responseTitle);

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
        cancelButton.style.display = 'none';
        actionButtonsContainer.appendChild(cancelButton);

        responseHeader.appendChild(actionButtonsContainer);
        viewer.appendChild(responseHeader);

        // --- Content Wrapper ---
        const contentWrapper = document.createElement('div');
        contentWrapper.id = 'checkra-feedback-content-wrapper';

        const promptTitle = document.createElement('h4');
        promptTitle.textContent = '"' + this.originalPromptTitleText + '"';
        promptTitle.style.color = '#a0c8ff';
        promptTitle.style.marginBottom = '8px';
        promptTitle.style.marginTop = '0';
        promptTitle.style.fontSize = '14px';
        promptTitle.style.fontWeight = '600';
        promptTitle.style.whiteSpace = 'pre-wrap';
        promptTitle.style.wordWrap = 'break-word';
        contentWrapper.appendChild(promptTitle);

        const textareaContainer = document.createElement('div');
        textareaContainer.id = 'checkra-textarea-container';

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

        // --- Response Area ---
        const responseContent = document.createElement('div');
        responseContent.id = 'checkra-feedback-response-content';
        responseContent.style.wordWrap = 'break-word';
        responseContent.style.fontFamily = 'inherit';
        responseContent.style.fontSize = '14px';
        responseContent.style.marginTop = '15px';
        responseContent.style.display = 'none';
        contentWrapper.appendChild(responseContent);

        viewer.appendChild(contentWrapper);

        // --- Resize Handle ---
        const resizeHandle = document.createElement('div');
        resizeHandle.id = 'checkra-feedback-viewer-resize-handle';
        resizeHandle.addEventListener('mousedown', this.handleResizeStart);
        viewer.appendChild(resizeHandle);

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
            resizeHandle,
            actionButtonsContainer,
            previewApplyButton,
            cancelButton,
            responseHeader,
            contentWrapper
        };

        return this.elements;
    }

    public destroy(): void {
        if (this.elements) {
            this.elements.viewer.removeEventListener('mousedown', this.handleDragStart);
            this.elements.resizeHandle.removeEventListener('mousedown', this.handleResizeStart);
            // Remove document listeners if they might be active
            document.removeEventListener('mousemove', this.handleDragMove);
            document.removeEventListener('mouseup', this.handleDragEnd);
            document.removeEventListener('mousemove', this.handleResizeMove);
            document.removeEventListener('mouseup', this.handleResizeEnd);

            this.elements.viewer.remove();
        }
        this.elements = null;
        console.log('[FeedbackViewerDOM] Instance destroyed.');
    }

    // --- Visibility and Content ---

    public show(position?: { top: number; left: number; mode: 'fixed' | 'absolute' }): void {
        if (!this.elements) return;
        const { viewer, promptTextarea } = this.elements;
        // Apply persisted size or defaults
        viewer.style.width = `${DEFAULT_WIDTH}px`;
        viewer.style.height = `${DEFAULT_HEIGHT}px`;

        // Reset visibility states
        this.showPromptInputArea(true);
        this.updateLoaderVisibility(false);
        this.updateActionButtonsVisibility(false);
        this.elements.responseHeader.style.display = 'none';
        this.elements.contentWrapper.style.paddingTop = '15px'; // Reset padding

        if (position) {
            viewer.style.position = position.mode;
            viewer.style.top = `${position.top}px`;
            viewer.style.left = `${position.left}px`;
            viewer.style.transform = 'none'; // Ensure no transform interferes
            viewer.style.marginTop = '';
            viewer.style.marginLeft = '';
        } else {
            // Fallback to center (fixed)
            viewer.style.position = 'fixed';
            viewer.style.top = '50%';
            viewer.style.left = '50%';
            // Use margins for centering after setting explicit width/height
            viewer.style.marginTop = `-${viewer.offsetHeight / 2}px`;
            viewer.style.marginLeft = `-${viewer.offsetWidth / 2}px`;
            viewer.style.transform = 'none';
        }

        viewer.style.display = 'flex';

        // --- BEGIN EDIT ---
        // Attempt to focus the textarea
        if (isMobileDevice()) {
            // On mobile, delay focus slightly as browsers might ignore immediate programmatic focus
            setTimeout(() => {
                if (this.elements) { // Check if elements still exist after delay
                    this.elements.promptTextarea.focus();
                }
            }, 100); // 100ms delay, adjust if needed
        } else {
            // On desktop, focus immediately
            promptTextarea.focus();
        }
        // --- END EDIT ---
    }

    public hide(): void {
        if (!this.elements) return;
        this.elements.viewer.style.display = 'none';
        console.log('[FeedbackViewerDOM] Viewer hidden.');
    }

    public updateLoaderVisibility(visible: boolean, text?: string): void {
        if (!this.elements) return;
        const { loadingIndicator, loadingIndicatorText, responseHeader, contentWrapper, actionButtonsContainer } = this.elements;
        if (visible) {
            loadingIndicatorText.textContent = text || 'Processing...';
            loadingIndicator.style.display = 'flex';
            responseHeader.style.display = 'flex'; // Show header when loader is visible
            requestAnimationFrame(() => {
                const headerHeight = responseHeader.offsetHeight;
                contentWrapper.style.paddingTop = `${headerHeight + 10}px`;
            });
        } else {
            loadingIndicator.style.display = 'none';
            // Keep header visible if action buttons are shown, otherwise hide
            if (actionButtonsContainer.style.display === 'none') {
                 responseHeader.style.display = 'none';
                 contentWrapper.style.paddingTop = '15px'; // Reset padding
            } else {
                 responseHeader.style.display = 'flex'; // Keep header visible
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
        actionButtonsContainer.style.display = visible ? 'flex' : 'none';

        if (visible) {
            responseHeader.style.display = 'flex'; // Show header if buttons are shown
            requestAnimationFrame(() => {
                const headerHeight = responseHeader.offsetHeight;
                contentWrapper.style.paddingTop = `${headerHeight + 10}px`;
            });
        } else {
             // Hide header only if loader is also hidden
             if (loadingIndicator.style.display === 'none') {
                 responseHeader.style.display = 'none';
                 contentWrapper.style.paddingTop = '15px'; // Reset padding
             } else {
                  responseHeader.style.display = 'flex'; // Keep header visible if loader is active
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

        responseContent.style.display = 'block';
        responseContent.innerHTML = `<div class="checkra-streamed-content">${html}</div>`;

        const preElements = responseContent.querySelectorAll('.checkra-streamed-content pre');

        preElements.forEach(pre => {
            if (pre.querySelector('.checkra-code-copy-btn')) {
                return;
            }
            (pre as HTMLElement).style.position = 'relative';

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

                const codeElement = pre.querySelector('code.language-html');

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

            pre.appendChild(copyButton);
        });

        if (scrollToBottom && isScrolledToBottom) {
            contentWrapper.scrollTop = contentWrapper.scrollHeight;
        }
    }

    public clearResponseContent(): void {
        if (!this.elements) return;
        this.elements.responseContent.innerHTML = '';
        this.elements.responseContent.style.display = 'none';
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
     * @param show True to show input area and original title, false to hide input area and show submitted text.
     * @param submittedPromptText The user's prompt text (only used when show is false).
     */
    public showPromptInputArea(show: boolean, submittedPromptText?: string): void {
         if (!this.elements) return;
         // Toggle textarea container visibility
         this.elements.textareaContainer.style.display = show ? 'block' : 'none';

         // Update the title text
         if (show) {
            // Restore original title
            this.elements.promptTitle.textContent = this.originalPromptTitleText;
            this.elements.promptTitle.style.display = 'block'; // Ensure title is visible
         } else if (submittedPromptText) {
            // Show submitted prompt in the title element
            this.elements.promptTitle.textContent = submittedPromptText;
            this.elements.promptTitle.style.display = 'block'; // Ensure title is visible
         } else {
             // Hiding without submitted text (e.g., on error before submit), just hide textarea
             this.elements.promptTitle.style.display = 'none'; // Hide the title too if no text to show
         }
    }

    // --- Positioning ---

    public calculateOptimalPosition(targetRect: DOMRect): { top: number; left: number; mode: 'fixed' | 'absolute' } | null {
        if (!this.elements) return null;
        const viewer = this.elements.viewer;

        // Temporarily show offscreen to measure
        viewer.style.visibility = 'hidden';
        viewer.style.display = 'flex';
        viewer.style.position = 'fixed'; // Use fixed for measurement consistency
        viewer.style.left = '-9999px';
        viewer.style.top = '-9999px';

        const viewerWidth = viewer.offsetWidth;
        const viewerHeight = viewer.offsetHeight;

        // Hide it again immediately
        viewer.style.display = 'none';
        viewer.style.visibility = 'visible';
        viewer.style.left = '';
        viewer.style.top = '';

        if (!viewerWidth || !viewerHeight) {
            console.warn('[FeedbackViewerDOM] Could not determine viewer dimensions for positioning.');
            return null; // Indicate failure to calculate
        }

        const placementMargin = 10;
        const viewportMargin = 10;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const doesOverlap = (rect1: DOMRect, rect2: DOMRect): boolean => {
             return !(rect1.right < rect2.left || rect1.left > rect2.right || rect1.bottom < rect2.top || rect1.top > rect2.bottom);
        };
        const fitsInViewport = (rect: { top: number; left: number; bottom: number; right: number }): boolean => {
             return rect.top >= viewportMargin && rect.left >= viewportMargin && rect.bottom <= viewportHeight - viewportMargin && rect.right <= viewportWidth - viewportMargin;
        };

        const potentialPositions = [
            { top: targetRect.bottom + placementMargin, left: targetRect.left + targetRect.width / 2 - viewerWidth / 2, name: "Below" },
            { top: targetRect.top - viewerHeight - placementMargin, left: targetRect.left + targetRect.width / 2 - viewerWidth / 2, name: "Above" },
            { top: targetRect.top + targetRect.height / 2 - viewerHeight / 2, left: targetRect.right + placementMargin, name: "Right" },
            { top: targetRect.top + targetRect.height / 2 - viewerHeight / 2, left: targetRect.left - viewerWidth - placementMargin, name: "Left" }
        ];

        for (const pos of potentialPositions) {
            let clampedTop = Math.max(viewportMargin, Math.min(pos.top, viewportHeight - viewerHeight - viewportMargin));
            let clampedLeft = Math.max(viewportMargin, Math.min(pos.left, viewportWidth - viewerWidth - viewportMargin));
            const potentialRect = DOMRect.fromRect({ x: clampedLeft, y: clampedTop, width: viewerWidth, height: viewerHeight });

            if (!doesOverlap(potentialRect, targetRect) && fitsInViewport(potentialRect)) {
                // Found a good spot - use absolute positioning relative to document
                const finalTop = potentialRect.top + window.scrollY;
                const finalLeft = potentialRect.left + window.scrollX;
                console.log(`[FeedbackViewerDOM] Found valid ABSOLUTE position: ${pos.name}`);
                return { top: finalTop, left: finalLeft, mode: 'absolute' };
            }
        }

        // Fallback: Place below and clamp using FIXED positioning
        console.warn('[FeedbackViewerDOM] No ideal non-overlapping position found. Falling back to placing below (fixed, clamped).');
        let fallbackTop = targetRect.bottom + placementMargin;
        let fallbackLeft = targetRect.left + targetRect.width / 2 - viewerWidth / 2;
        fallbackTop = Math.max(viewportMargin, Math.min(fallbackTop, viewportHeight - viewerHeight - viewportMargin));
        fallbackLeft = Math.max(viewportMargin, Math.min(fallbackLeft, viewportWidth - viewerWidth - viewportMargin));
        return { top: fallbackTop, left: fallbackLeft, mode: 'fixed' };
    }

    // --- Dragging Handlers ---
    private handleDragStart(e: MouseEvent): void {
        // --- BEGIN EDIT ---
        // Disable dragging entirely on mobile/touch devices
        if (isMobileDevice()) {
            return; // Exit early, allow default touch behavior (like focusing textarea)
        }
        // --- END EDIT ---

        // --- Desktop-Only Drag Logic ---
        if (this.isResizing || !this.elements || (this.elements.resizeHandle && this.elements.resizeHandle.contains(e.target as Node))) return;

        // Check if the click target is within an interactive element that shouldn't start drag
        const target = e.target as Element;
        const nonDraggableSelectors = [
            'textarea',
            'button',
            'pre',
            'code',
            'a',
            'input', // Add other potential interactive elements if needed
            'select'
        ];
        if (target.closest(nonDraggableSelectors.join(','))) {
            return; // Don't start drag if clicking inside these elements
        }

        // If the click is not on an explicitly non-draggable element, start the drag
        e.preventDefault();
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragInitialLeft = this.elements.viewer.offsetLeft;
        this.dragInitialTop = this.elements.viewer.offsetTop;
        this.elements.viewer.style.transform = 'none'; // Reset transform if applied for centering
        this.elements.viewer.style.marginTop = '';
        this.elements.viewer.style.marginLeft = '';
        this.elements.viewer.classList.add('dragging');
        document.addEventListener('mousemove', this.handleDragMove);
        document.addEventListener('mouseup', this.handleDragEnd);
    }

    private handleDragMove(e: MouseEvent): void {
        // --- BEGIN EDIT ---
        // Also prevent move updates on mobile (safety check)
        if (isMobileDevice() || !this.isDragging || !this.elements) return;
        // --- END EDIT ---

        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        this.elements.viewer.style.left = `${this.dragInitialLeft + dx}px`;
        this.elements.viewer.style.top = `${this.dragInitialTop + dy}px`;
    }

    private handleDragEnd(): void {
        // --- BEGIN EDIT ---
        // Also prevent end logic on mobile (safety check)
        if (isMobileDevice() || !this.isDragging || !this.elements) return;
        // --- END EDIT ---

        this.isDragging = false;
        this.elements.viewer.classList.remove('dragging');
        document.removeEventListener('mousemove', this.handleDragMove);
        document.removeEventListener('mouseup', this.handleDragEnd);
    }

    // --- Resizing Handlers ---
    private handleResizeStart(e: MouseEvent): void {
        // --- Optional Edit: Consider disabling resizing on mobile too? ---
        // if (isMobileDevice()) {
        //     return;
        // }
        // --- End Optional Edit ---

        if (!this.elements) return;
        e.preventDefault();
        e.stopPropagation();
        this.isResizing = true;
        this.resizeStartX = e.clientX;
        this.resizeStartY = e.clientY;
        this.initialWidth = this.elements.viewer.offsetWidth;
        this.initialHeight = this.elements.viewer.offsetHeight;
        document.addEventListener('mousemove', this.handleResizeMove);
        document.addEventListener('mouseup', this.handleResizeEnd);
        this.elements.viewer.classList.add('resizing');
        // Disable pointer events on content during resize
        this.elements.contentWrapper.style.pointerEvents = 'none';
    }

    private handleResizeMove(e: MouseEvent): void {
        // --- Optional Edit: Consider disabling resizing on mobile too? ---
        // if (isMobileDevice() || !this.isResizing || !this.elements) return;
        // --- End Optional Edit ---
        if (!this.isResizing || !this.elements) return; // Keep original check

        const dx = e.clientX - this.resizeStartX;
        const dy = e.clientY - this.resizeStartY;
        let newWidth = this.initialWidth + dx;
        let newHeight = this.initialHeight + dy;
        const maxWidthPx = (window.innerWidth * MAX_WIDTH_VW) / 100;
        // const maxHeightPx = (window.innerHeight * MAX_HEIGHT_VH) / 100; // << REMOVE or comment out

        // Clamp width, but only clamp height to the minimum
        newWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidthPx));
        newHeight = Math.max(MIN_HEIGHT, newHeight); // << REMOVE Math.min(..., maxHeightPx) clamping

        this.elements.viewer.style.width = `${newWidth}px`;
        this.elements.viewer.style.height = `${newHeight}px`;
    }

    private handleResizeEnd(): void {
        // --- Optional Edit: Consider disabling resizing on mobile too? ---
        // if (isMobileDevice() || !this.isResizing || !this.elements) return;
        // --- End Optional Edit ---
        if (!this.isResizing || !this.elements) return; // Keep original check

        this.isResizing = false;
        document.removeEventListener('mousemove', this.handleResizeMove);
        document.removeEventListener('mouseup', this.handleResizeEnd);
        this.elements.contentWrapper.style.pointerEvents = '';
        this.elements.viewer.classList.remove('resizing');
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
}