import { escapeHTML } from './utils';
import { fetchFeedback } from '../services/ai-service';
import { marked } from 'marked';
import { copyViewportToClipboard } from '../utils/clipboard-utils';
import type { FeedbackViewerElements } from './feedback-viewer-dom'; // Use type import
import type { FeedbackViewerDOM } from './feedback-viewer-dom';

// Regex patterns for extracting HTML
const SPECIFIC_HTML_REGEX = /# Complete HTML with All Fixes\s*```(?:html)?\n([\s\S]*?)\n```/i;
const GENERIC_HTML_REGEX = /```(?:html)?\n([\s\S]*?)\n```/i;

/**
 * Handles the logic, state, and interactions for the feedback viewer.
 */
export class FeedbackViewerLogic {
    private domElements: FeedbackViewerElements | null = null;
    private domManager: FeedbackViewerDOM | null = null; // Use the imported type

    // --- State ---
    private currentImageDataUrl: string | null = null;
    private currentSelectedHtml: string | null = null;
    private originalElementBounds: DOMRect | null = null;
    private originalElementRef: Element | null = null;
    private accumulatedResponseText: string = '';
    private isStreamStarted: boolean = false;
    private originalElementDisplayStyle: string | null = null; // For restoring after fix preview
    private isFixPermanentlyApplied: boolean = false; // Added: Tracks if the current fix is permanent

    // --- Listeners ---
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private fixWrapperCloseButtonListener: (() => void) | null = null;
    private fixWrapperCopyButtonListener: ((e: MouseEvent) => void) | null = null;
    private fixWrapperApplyButtonListener: ((e: MouseEvent) => void) | null = null; // Added
    private fixWrapperMouseLeaveListener: (() => void) | null = null;
    private originalElementMouseEnterListener: (() => void) | null = null;

    constructor() {
        // Bind methods used as event handlers
        this.handleTextareaKeydown = this.handleTextareaKeydown.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
        this.handleApplyFixClick = this.handleApplyFixClick.bind(this);
        this.handleShowHtmlClick = this.handleShowHtmlClick.bind(this);
    }

    public initialize(elements: FeedbackViewerElements, domManager: FeedbackViewerDOM): void {
        this.domElements = elements;
        this.domManager = domManager; // Store reference to DOM manager

        // --- Setup Listeners ---
        this.domElements.promptTextarea.addEventListener('keydown', this.handleTextareaKeydown);
        this.domElements.submitButton.addEventListener('click', this.handleSubmit);
        this.domElements.applyFixButton.addEventListener('click', this.handleApplyFixClick);
        this.domElements.showHtmlButton.addEventListener('click', this.handleShowHtmlClick);

        // Outside click handler
        this.outsideClickHandler = (e: MouseEvent) => {
            if (this.domElements && this.domManager &&
                this.domElements.viewer.style.display !== 'none' &&
                e.target instanceof Node &&
                !this.domElements.viewer.contains(e.target) &&
                !this.domElements.renderedHtmlPreview?.contains(e.target))
            {
                // Check if the click target is part of the injected fix wrapper
                // Access via getter or public property if available, otherwise direct access (carefully)
                const fixWrapper = this.domManager['injectedFixWrapper']; // Assuming direct access for example
                if (!fixWrapper || !fixWrapper.contains(e.target)) {
                    this.hide();
                }
            }
        };
        document.addEventListener('mousedown', this.outsideClickHandler);

        console.log('[FeedbackViewerLogic] Initialized.');
    }

    public cleanup(): void {
        if (!this.domElements || !this.outsideClickHandler) return;

        // Remove general listeners
        this.domElements.promptTextarea.removeEventListener('keydown', this.handleTextareaKeydown);
        this.domElements.submitButton.removeEventListener('click', this.handleSubmit);
        this.domElements.applyFixButton.removeEventListener('click', this.handleApplyFixClick);
        this.domElements.showHtmlButton.removeEventListener('click', this.handleShowHtmlClick);
        document.removeEventListener('mousedown', this.outsideClickHandler);

        // Ensure fix-related listeners are removed, but don't touch DOM during full cleanup
        this.removeInjectedFixLogic(false);

        this.domElements = null;
        this.domManager = null;
        this.outsideClickHandler = null;
        console.log('[FeedbackViewerLogic] Cleaned up listeners.');
    }

    // --- Public API ---

    public prepareForInput(
        imageDataUrl: string | null,
        selectedHtml: string | null,
        targetRect: DOMRect | null,
        targetElement: Element | null
    ): void {
        if (!this.domManager || !this.domElements) {
            console.error("[FeedbackViewerLogic] Cannot prepare for input: DOM Manager or elements not initialized.");
            return;
        }

        // Store data
        this.currentImageDataUrl = imageDataUrl;
        this.currentSelectedHtml = selectedHtml;
        this.originalElementBounds = targetRect;
        this.originalElementRef = targetElement;

        // Reset state for the new cycle
        this.accumulatedResponseText = '';
        this.isStreamStarted = false;
        // isFixPermanentlyApplied is reset within removeInjectedFixLogic

        console.log('[FeedbackViewerLogic] Calling removeInjectedFixLogic from prepareForInput to clear previous state.');
        // Remove any previous fix injection AND reset state like isFixPermanentlyApplied
        this.removeInjectedFixLogic(true); // Attempt to remove DOM from previous cycle

        // Reset UI
        this.domManager.setPromptState(true, ''); // Enable textarea and clear value
        this.domManager.updateSubmitButtonState(true, 'Get Feedback');
        this.domManager.clearResponseContent();
        this.domManager.updateLoaderVisibility(false);
        this.domManager.updateActionButtonsVisibility(false);
        this.domManager.showPromptArea(true); // Ensure prompt area is visible
        this.domManager.hidePreview();
        this.domManager.setFixAppliedStyles(false); // Ensure new cycle doesn't start with applied styles


        // Calculate position and show viewer
        let position: { top: number; left: number; mode: 'fixed' | 'absolute' } | null = null;
        if (this.originalElementBounds) {
            position = this.domManager.calculateOptimalPosition(this.originalElementBounds);
        }

        if (position) {
            this.domManager.show(position);
        } else {
            console.warn('[FeedbackViewerLogic] Could not calculate position, showing centered.');
            this.domManager.show(); // Show centered as fallback
        }
    }

    public updateResponse(chunk: string): void {
        if (!this.domManager || !this.domElements) return;

        if (!this.isStreamStarted) {
            this.domManager.clearResponseContent();
            this.isStreamStarted = true;
        }

        this.accumulatedResponseText += chunk;
        const parsedHtml = marked.parse(this.accumulatedResponseText) as string;
        this.domManager.setResponseContent(parsedHtml, true);

        const hasHtmlCode = GENERIC_HTML_REGEX.test(this.accumulatedResponseText);
        this.domManager.updateLoaderVisibility(true, hasHtmlCode ? 'Creating new version...' : 'Getting feedback...');

        this.tryRenderHtmlPreview(); // Keep the small preview logic

        // Try to create/update the *hidden* fix wrapper as HTML comes in
        if (this.accumulatedResponseText.trim()) {
            console.log('[FeedbackViewerLogic] Calling tryInjectHtmlFix from updateResponse.');
            this.tryInjectHtmlFix();
        }
    }

    public finalizeResponse(): void {
        console.log("[FeedbackViewerLogic] Feedback stream finalized.");
        if (!this.domManager) return;

        this.domManager.updateLoaderVisibility(false);
        this.domManager.setPromptState(true);
        this.domManager.updateSubmitButtonState(true, 'Get Feedback');

        this.tryRenderHtmlPreview(); // Ensure preview is up-to-date
        console.log('[FeedbackViewerLogic] Calling tryInjectHtmlFix from finalizeResponse.');
        this.tryInjectHtmlFix(); // Ensure fix injection is created/updated

        this.updateActionButtonsVisibility(); // Show/hide viewer buttons based on final content
    }

    public showError(error: Error | string): void {
        if (!this.domManager) return;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error("[FeedbackViewerLogic] Error:", errorMessage);

        this.domManager.updateLoaderVisibility(false);
        this.domManager.updateActionButtonsVisibility(false);
        this.domManager.setResponseContent(`<div style="color:#ff8a8a; white-space: pre-wrap;"><strong>Error:</strong> ${escapeHTML(errorMessage)}</div>`, false);
        this.domManager.setPromptState(true);
        this.domManager.updateSubmitButtonState(true, 'Get Feedback');
        this.accumulatedResponseText = '';
        this.isStreamStarted = false;
        // Also clean up any potentially half-created fix on error
        this.removeInjectedFixLogic(true);
    }

    public hide(): void {
        if (!this.domManager) return;
        this.domManager.hide(); // Hide the viewer UI

        // Clean up the logic/state/listeners associated with the cycle that is ending.
        // removeInjectedFixLogic will decide whether to remove the DOM wrapper based on isFixPermanentlyApplied.
        console.log(`[FeedbackViewerLogic] Calling removeInjectedFixLogic from hide.`);
        this.removeInjectedFixLogic(true); // Pass true to attempt DOM removal if not permanent

        // Reset general state for the next potential cycle
        this.currentImageDataUrl = null;
        this.currentSelectedHtml = null;
        this.originalElementBounds = null;
        this.originalElementRef = null; // Detach from the previous element
        this.accumulatedResponseText = '';
        this.isStreamStarted = false;
        // isFixPermanentlyApplied is reset inside removeInjectedFixLogic

        console.log('[FeedbackViewerLogic] Viewer hidden and state reset.');
    }


    // --- Event Handlers ---

    private handleTextareaKeydown(e: KeyboardEvent): void {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
            e.preventDefault();
            this.handleSubmit();
        }
    }

    private handleSubmit(): void {
        if (!this.domManager || !this.domElements) return;
        if (!this.currentImageDataUrl && !this.currentSelectedHtml) {
            this.showError('Could not capture image or HTML structure.');
            return;
        }

        const promptText = this.domElements.promptTextarea.value.trim();
        console.log('[FeedbackViewerLogic] Submitting feedback...');

        this.domManager.setPromptState(false);
        this.domManager.updateSubmitButtonState(false, 'Sending...');
        this.domManager.updateLoaderVisibility(true, 'Getting feedback...');
        this.domManager.updateActionButtonsVisibility(false);
        this.domManager.clearResponseContent();
        this.domManager.showPromptArea(false);

        this.accumulatedResponseText = '';
        this.isStreamStarted = false;

        fetchFeedback(this.currentImageDataUrl, promptText, this.currentSelectedHtml);
    }

    private handleApplyFixClick(): void {
        console.log('[FeedbackViewerLogic] Apply Fix button clicked.');
        if (!this.domManager || !(this.originalElementRef instanceof HTMLElement)) {
             console.warn('[FeedbackViewerLogic] Cannot apply fix: DOM Manager or original element ref invalid.');
             return;
        }

        // Ensure the fix wrapper exists (it should have been created by tryInjectHtmlFix)
        // Access via getter or public property if available, otherwise direct access (carefully)
        const fixWrapper = this.domManager['injectedFixWrapper'];
        if (!fixWrapper) {
            console.warn('[FeedbackViewerLogic] Cannot apply fix: Injected fix wrapper not found.');
            return;
        }

        // Store original display style *before* hiding it, if not already stored
        if (this.originalElementDisplayStyle === null) {
            this.originalElementDisplayStyle = window.getComputedStyle(this.originalElementRef).display;
            if (this.originalElementDisplayStyle === 'none') {
                this.originalElementDisplayStyle = 'block'; // Default fallback
            }
            console.log(`[FeedbackViewerLogic] Stored original display style: ${this.originalElementDisplayStyle}`);
        }

        // Use DOM Manager to show the *existing hidden* fix wrapper and hide original
        this.domManager.setInjectedFixWrapperVisibility(true);
        this.originalElementRef.style.display = 'none';
        console.log('[FeedbackViewerLogic] Displayed fix wrapper, hid original element.');

        // Add mouse enter listener to original element *after* applying fix for hover effect
        this.addOriginalElementMouseEnterListener();
    }

    private handleShowHtmlClick(): void {
        console.log('[FeedbackViewerLogic] Show HTML button clicked.');
        if (!this.domElements) return;
        const preElement = this.domElements.responseContent.querySelector('.streamed-content pre') as HTMLPreElement | null;
        if (preElement) {
            preElement.style.display = 'block';
            console.log('[FeedbackViewerLogic] Set pre element display to block.');
            preElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            console.warn('[FeedbackViewerLogic] Could not find pre element within response content.');
        }
    }

    // --- HTML Preview and Injection Logic ---

    private tryRenderHtmlPreview(): void {
        if (!this.domManager || !this.originalElementBounds) return;

        const match = this.accumulatedResponseText.match(SPECIFIC_HTML_REGEX);
        if (match && match[1]) {
            const extractedHtml = match[1].trim();
            const position = this.domManager.calculatePreviewPosition(this.originalElementBounds);
            if (position) {
                console.log('[FeedbackViewerLogic] Rendering HTML preview.');
                this.domManager.showPreview(extractedHtml, position);
            } else {
                console.warn('[FeedbackViewerLogic] Could not calculate position for HTML preview.');
                this.domManager.hidePreview();
            }
        } else {
            this.domManager.hidePreview();
        }
    }

    private tryInjectHtmlFix(): void {
        console.log('[FeedbackViewerLogic] Entering tryInjectHtmlFix.');
        if (!this.domManager || !this.originalElementRef || !document.body.contains(this.originalElementRef)) {
            console.log('[FeedbackViewerLogic] tryInjectHtmlFix aborted: DOM Manager, originalElementRef invalid or not in DOM.');
            // Don't remove logic here, might be called during stream before element is ready
            return;
        }

        let match = this.accumulatedResponseText.match(SPECIFIC_HTML_REGEX);
        if (!match) {
            match = this.accumulatedResponseText.match(GENERIC_HTML_REGEX);
        }

        if (match && match[1]) {
            const extractedHtml = match[1].trim();
            console.log('[FeedbackViewerLogic] Regex matched HTML for injection.');

            let newContentHtml = '';
            let attributesToCopy: { name: string; value: string }[] = [];

            try {
                const parser = new DOMParser();
                const parsedDoc = parser.parseFromString(extractedHtml, 'text/html');
                const firstElement = parsedDoc.body.firstElementChild;

                if (firstElement && (firstElement.tagName === 'BODY' || firstElement.tagName === 'HTML')) {
                     console.log(`[FeedbackViewerLogic] Detected <${firstElement.tagName}> tag as root. Extracting content and attributes.`);
                     attributesToCopy = Array.from(firstElement.attributes)
                         .filter(attr => attr.name.toLowerCase() !== 'style'); // Exclude style attribute
                     newContentHtml = firstElement.innerHTML;
                } else {
                    newContentHtml = parsedDoc.body.innerHTML;
                }
                console.log('[FeedbackViewerLogic] Processed HTML for injection.');

            } catch (parseError) {
                console.error('[FeedbackViewerLogic] Error processing extracted HTML:', parseError);
                // Don't remove logic here, let error handling manage cleanup
                return;
            }

            // Check if wrapper needs creation or update
            // This now creates it hidden by default
            const fixElements = this.domManager.createInjectedFixWrapper(newContentHtml, attributesToCopy, this.originalElementRef);

            if (fixElements) {
                // New wrapper created (or recreated), attach listeners
                this.attachFixWrapperListeners(
                    fixElements.wrapper,
                    fixElements.closeButton,
                    fixElements.copyButton,
                    fixElements.applyButton // Pass the new button
                );
                // Ensure content is up-to-date (create should handle initial)
                this.domManager.updateInjectedFixContent(newContentHtml);
                // DO NOT SHOW IT HERE - wait for handleApplyFixClick
                console.log('[FeedbackViewerLogic] Created/updated hidden fix wrapper and attached listeners.');

            } else {
                 // Wrapper might already exist (e.g., from previous stream chunk), try updating content
                 console.log('[FeedbackViewerLogic] Fix wrapper already exists, updating content.');
                 this.domManager.updateInjectedFixContent(newContentHtml);
            }

        } else {
            // If no HTML match found *after* streaming, ensure any old/stale fix wrapper is gone
            // Check if stream is finished? Or rely on finalizeResponse?
            // Let's assume finalizeResponse handles the final state.
             console.log('[FeedbackViewerLogic] Regex did not match HTML in current chunk.');
        }
        // Don't update action buttons here, wait for finalizeResponse
        console.log('[FeedbackViewerLogic] Exiting tryInjectHtmlFix.');
    }

    private removeInjectedFixLogic(removeFromDOM: boolean = true): void {
        // Modified logic to handle isFixPermanentlyApplied state
        console.log(`[FeedbackViewerLogic] >>> Entering removeInjectedFixLogic (removeFromDOM: ${removeFromDOM}, isFixPermanentlyApplied: ${this.isFixPermanentlyApplied}) <<<`);

        // --- Remove Listeners ---
        // Always remove listeners associated with the *current* cycle's potential wrapper
        this.removeFixWrapperListeners(); // Includes close, copy, apply, mouseleave
        this.removeOriginalElementMouseEnterListener();

        // --- Restore Original Element ---
        // Only restore if the fix for *this cycle* was NOT permanently applied
        if (!this.isFixPermanentlyApplied && this.originalElementRef instanceof HTMLElement && this.originalElementDisplayStyle !== null) {
            if (document.body.contains(this.originalElementRef)) {
                console.log(`[FeedbackViewerLogic] Restoring original element display to: ${this.originalElementDisplayStyle}`);
                this.originalElementRef.style.display = this.originalElementDisplayStyle;
            } else {
                 console.log('[FeedbackViewerLogic] Original element no longer in DOM, skipping style restoration.');
            }
        }
        // Always reset the stored style for the *next* cycle
        this.originalElementDisplayStyle = null;

        // --- Remove Wrapper from DOM (if requested AND fix wasn't permanent) ---
        // This assumes domManager.removeInjectedFixWrapper() removes the wrapper associated with the *current* logic instance state
        if (removeFromDOM && !this.isFixPermanentlyApplied && this.domManager) {
            console.log('[FeedbackViewerLogic] Attempting to remove wrapper from DOM.');
            this.domManager.removeInjectedFixWrapper();
        } else {
             console.log(`[FeedbackViewerLogic] Skipping wrapper removal from DOM (removeFromDOM: ${removeFromDOM}, isFixPermanentlyApplied: ${this.isFixPermanentlyApplied}).`);
        }

        // --- Reset Listener State ---
        // Always reset listener function references for the next cycle
        this.fixWrapperCloseButtonListener = null;
        this.fixWrapperCopyButtonListener = null;
        this.fixWrapperApplyButtonListener = null; // Added reset
        this.fixWrapperMouseLeaveListener = null;
        // originalElementMouseEnterListener is reset by its own remover

        // --- Reset Permanent Fix Flag ---
        // Reset the flag *after* using its value for cleanup decisions above.
        // This prepares the state for the *next* feedback cycle.
        if (this.isFixPermanentlyApplied) {
             console.log('[FeedbackViewerLogic] Resetting isFixPermanentlyApplied flag.');
             this.isFixPermanentlyApplied = false;
        }


        this.updateActionButtonsVisibility(); // Update viewer buttons

        console.log('[FeedbackViewerLogic] <<< Exiting removeInjectedFixLogic >>>');
    }


    // --- Listener Management for Fix Wrapper ---

    private attachFixWrapperListeners(
        wrapper: HTMLElement,
        closeButton: HTMLElement,
        copyButton: HTMLElement,
        applyButton: HTMLElement // Added apply button
    ): void {
        // Remove any existing listeners first to prevent duplicates
        this.removeFixWrapperListeners();

        // Close Button (Discard)
        this.fixWrapperCloseButtonListener = () => {
            console.log('[FeedbackViewerLogic] Close (discard) button clicked on injected fix.');
            // This should just remove the fix and restore original, without closing the main viewer
            this.isFixPermanentlyApplied = false; // Ensure it's not marked as applied
            this.removeInjectedFixLogic(true); // Remove wrapper, restore original
        };
        closeButton.addEventListener('click', this.fixWrapperCloseButtonListener);

        // Copy Button
        this.fixWrapperCopyButtonListener = (e: MouseEvent) => {
             e.stopPropagation();
             console.log('[FeedbackViewerLogic] Copy button clicked.');
             copyViewportToClipboard().catch(err => {
                 console.error("Error copying viewport:", err);
             });
        };
        copyButton.addEventListener('click', this.fixWrapperCopyButtonListener);

        // Apply Button (Checkmark) - Added
        this.fixWrapperApplyButtonListener = (e: MouseEvent) => {
            e.stopPropagation();
            console.log('[FeedbackViewerLogic] Apply (check) button clicked.');
            if (!this.domManager) return;

            // 1. Set flag *before* cleanup starts in hide()
            this.isFixPermanentlyApplied = true;
            console.log('[FeedbackViewerLogic] Set isFixPermanentlyApplied = true.');

            // 2. Apply permanent styles
            this.domManager.setFixAppliedStyles(true);

            // 3. Release the DOM manager's reference to this wrapper
            this.domManager.releaseAppliedFixWrapper();

            // 4. Close the main feedback viewer
            // hide() will call removeInjectedFixLogic, which will now respect the flag
            // and removeInjectedFixWrapper won't find the (now released) wrapper reference.
            this.hide();
        };
        applyButton.addEventListener('click', this.fixWrapperApplyButtonListener as EventListener);


        // MouseLeave on Wrapper (to hide fix *temporarily* after Apply Fix is clicked, but before checkmark)
        this.fixWrapperMouseLeaveListener = () => {
            // Only hide if 'Apply Fix' was clicked BUT checkmark was NOT yet clicked
            if (!this.isFixPermanentlyApplied && this.originalElementDisplayStyle !== null && this.domManager && this.originalElementRef instanceof HTMLElement) {
                 console.log('[FeedbackViewerLogic] Mouse left injected fix wrapper (temporarily hiding).');
                this.domManager.setInjectedFixWrapperVisibility(false);
                // Restore original element display when hiding the fix temporarily
                this.originalElementRef.style.display = this.originalElementDisplayStyle;
                console.log(`[FeedbackViewerLogic] Hid fix wrapper, restored original element display to: ${this.originalElementDisplayStyle}`);
            } else {
                 console.log('[FeedbackViewerLogic] MouseLeave: Skipping hide/restore (Fix applied or Apply Fix not clicked).');
            }
        };
        wrapper.addEventListener('mouseleave', this.fixWrapperMouseLeaveListener);
        console.log('[FeedbackViewerLogic] Added mouseleave listener to fix wrapper.');

        // Note: MouseEnter listener for the *original* element is added separately
        // in handleApplyFixClick, because we only want that behavior *after* apply is clicked.
    }

    private removeFixWrapperListeners(): void {
        // Use the DOM manager to get button references if needed, or rely on stored refs
        const fixWrapper = this.domManager?.['injectedFixWrapper'];
        const closeButton = this.domManager?.['fixCloseButton'];
        const copyButton = this.domManager?.['fixCopyButton'];
        const applyButton = this.domManager?.['fixApplyButton']; // Added

        if (closeButton && this.fixWrapperCloseButtonListener) {
            closeButton.removeEventListener('click', this.fixWrapperCloseButtonListener);
            this.fixWrapperCloseButtonListener = null;
        }
         if (copyButton && this.fixWrapperCopyButtonListener) {
            copyButton.removeEventListener('click', this.fixWrapperCopyButtonListener as EventListener);
            this.fixWrapperCopyButtonListener = null;
        }
        // Remove Apply button listener - Added
        if (applyButton && this.fixWrapperApplyButtonListener) {
            applyButton.removeEventListener('click', this.fixWrapperApplyButtonListener as EventListener);
            this.fixWrapperApplyButtonListener = null;
        }
        if (fixWrapper && this.fixWrapperMouseLeaveListener) {
            fixWrapper.removeEventListener('mouseleave', this.fixWrapperMouseLeaveListener);
            this.fixWrapperMouseLeaveListener = null;
        }
         console.log('[FeedbackViewerLogic] Removed fix wrapper listeners.');
    }

    private addOriginalElementMouseEnterListener(): void {
         if (!(this.originalElementRef instanceof HTMLElement)) return;

         // Remove existing first
         this.removeOriginalElementMouseEnterListener();

         this.originalElementMouseEnterListener = () => {
             // Show the fix ONLY if 'Apply Fix' has been clicked BUT checkmark has NOT
             if (!this.isFixPermanentlyApplied && this.originalElementDisplayStyle !== null && this.domManager && this.originalElementRef instanceof HTMLElement) {
                 console.log('[FeedbackViewerLogic] Mouse entered original element area (showing temp fix).');
                 this.domManager.setInjectedFixWrapperVisibility(true); // Show fix
                 this.originalElementRef.style.display = 'none'; // Hide original
                 console.log('[FeedbackViewerLogic] Showed fix wrapper, hid original element (mouseenter).');
             } else {
                  console.log('[FeedbackViewerLogic] MouseEnter: Skipping show fix (Fix applied or Apply Fix not clicked).');
             }
         };
         this.originalElementRef.addEventListener('mouseenter', this.originalElementMouseEnterListener);
         console.log('[FeedbackViewerLogic] Added mouseenter listener to original element.');
    }

     private removeOriginalElementMouseEnterListener(): void {
         if (this.originalElementRef instanceof HTMLElement && this.originalElementMouseEnterListener) {
             console.log('[FeedbackViewerLogic] Removing mouseenter listener from original element.');
             this.originalElementRef.removeEventListener('mouseenter', this.originalElementMouseEnterListener);
             this.originalElementMouseEnterListener = null; // Reset the stored listener
         }
     }


    // --- Helpers ---

    private updateActionButtonsVisibility(): void {
        if (!this.domManager) return;
        // Visibility depends only on whether HTML was found in the *response*,
        // not whether the fix wrapper is currently visible or applied.
        const hasHtml = SPECIFIC_HTML_REGEX.test(this.accumulatedResponseText) || GENERIC_HTML_REGEX.test(this.accumulatedResponseText);
        console.log(`[FeedbackViewerLogic] updateActionButtonsVisibility: hasHtml=${hasHtml}`);
        this.domManager.updateActionButtonsVisibility(hasHtml);
    }

    /**
     * Handles clicking the 'Preview' button in the viewer header.
     * Shows the injected fix wrapper and hides the original element.
     */
    private handlePreviewFixClick(): void {
        console.log('[FeedbackViewerLogic] Preview button clicked.');
        if (!this.domManager || !(this.originalElementRef instanceof HTMLElement)) {
             console.warn('[FeedbackViewerLogic] Cannot start preview: DOM Manager or original element ref invalid.');
             return;
        }

        // Ensure the fix wrapper exists (it should have been created by tryInjectHtmlFix)
        // Access via getter or public property if available, otherwise direct access (carefully)
        const fixWrapper = this.domManager['injectedFixWrapper'];
        if (!fixWrapper) {
            console.warn('[FeedbackViewerLogic] Cannot start preview: Injected fix wrapper not found.');
            return;
        }

        // Store original display style *before* hiding it, if not already stored
        if (this.originalElementDisplayStyle === null) {
            this.originalElementDisplayStyle = window.getComputedStyle(this.originalElementRef).display;
            if (this.originalElementDisplayStyle === 'none') {
                this.originalElementDisplayStyle = 'block'; // Default fallback
            }
            console.log(`[FeedbackViewerLogic] Stored original display style: ${this.originalElementDisplayStyle}`);
        }

        // Use DOM Manager to show the *existing hidden* fix wrapper and hide original
        this.domManager.setInjectedFixWrapperVisibility(true);
        this.originalElementRef.style.display = 'none';
        console.log('[FeedbackViewerLogic] Displayed fix wrapper (preview), hid original element.');

        // Add mouse enter listener to original element *after* starting preview for hover effect
        this.addOriginalElementMouseEnterListener();
    }
}