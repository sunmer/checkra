import { escapeHTML } from './utils';
import { fetchFeedback } from '../services/ai-service';
import { marked } from 'marked';
import { copyViewportToClipboard } from '../utils/clipboard-utils';
import type { FeedbackViewerElements } from './feedback-viewer-dom'; // Use type import
import type { FeedbackViewerDOM } from './feedback-viewer-dom';

// Regex patterns for extracting HTML
const SPECIFIC_HTML_REGEX = /# Complete HTML with All Fixes\s*```(?:html)?\n([\s\S]*?)\n```/i;
const GENERIC_HTML_REGEX = /```(?:html)?\n([\s\S]*?)\n```/i;

// ADDED: SVG Icon Constants
const EYE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>`;
const UNDO_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-undo2-icon lucide-undo-2"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>`; // Added for completeness, though cancel button isn't dynamic

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
    private isPreviewActive: boolean = false; // Added: Tracks if preview is active
    private hasPreviewBeenShown: boolean = false; // Added: Tracks if preview has been activated

    // --- Listeners ---
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private fixWrapperCloseButtonListener: (() => void) | null = null;
    private fixWrapperCopyButtonListener: ((e: MouseEvent) => void) | null = null;
    private cancelButtonListener: (() => void) | null = null; // ADDED

    constructor() {
        // Bind methods used as event handlers
        this.handleTextareaKeydown = this.handleTextareaKeydown.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
        this.handlePreviewApplyClick = this.handlePreviewApplyClick.bind(this);
        this.handleCancelFixClick = this.handleCancelFixClick.bind(this); // Keep binding
    }

    public initialize(elements: FeedbackViewerElements, domManager: FeedbackViewerDOM): void {
        this.domElements = elements;
        this.domManager = domManager; // Store reference to DOM manager

        // --- Setup Listeners ---
        this.domElements.promptTextarea.addEventListener('keydown', this.handleTextareaKeydown);
        this.domElements.submitButton.addEventListener('click', this.handleSubmit);
        this.domElements.previewApplyButton.addEventListener('click', this.handlePreviewApplyClick);
        this.domElements.cancelButton.addEventListener('click', this.handleCancelFixClick);

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

        // Ensure cancel button SVG is correct if DOM didn't set it initially (belt and braces)
        elements.cancelButton.innerHTML = `
            <span class="button-text">Undo fix</span>
            ${UNDO_ICON_SVG}
        `;

        console.log('[FeedbackViewerLogic] Initialized.');
    }

    public cleanup(): void {
        if (!this.domElements || !this.outsideClickHandler) return;

        // Remove general listeners
        this.domElements.promptTextarea.removeEventListener('keydown', this.handleTextareaKeydown);
        this.domElements.submitButton.removeEventListener('click', this.handleSubmit);
        this.domElements.previewApplyButton.removeEventListener('click', this.handlePreviewApplyClick);
        this.domElements.cancelButton.removeEventListener('click', this.handleCancelFixClick);
        document.removeEventListener('mousedown', this.outsideClickHandler);

        // Ensure fix-related listeners are removed, but don't touch DOM during full cleanup
        this.removeInjectedFixLogic(false);

        this.domElements = null;
        this.domManager = null;
        this.outsideClickHandler = null;
        this.cancelButtonListener = null;
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

        // Reset state
        this.accumulatedResponseText = '';
        this.isStreamStarted = false;
        this.isPreviewActive = false; // Reset preview state
        this.hasPreviewBeenShown = false; // Reset new flag
        this.removeInjectedFixLogic(true); // Clears fix state including isFixPermanentlyApplied

        // Reset UI
        this.domManager.setPromptState(true, '');
        this.domManager.updateSubmitButtonState(true, 'Get Feedback');
        this.domManager.clearResponseContent();
        this.domManager.showPromptInputArea(true);
        this.domManager.updateLoaderVisibility(false);
        this.domManager.updateActionButtonsVisibility(false); // Hide container initially
        this.domManager.hidePreview();
        this.domManager.setFixAppliedStyles(false);
        // Reset button states explicitly using the new helper
        if (this.domManager && this.domElements) {
             this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG);
             this.domElements.cancelButton.style.display = 'none'; // Keep hiding cancel button
        }

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
        this.domManager.showPromptInputArea(true);

        this.accumulatedResponseText = '';
        this.isStreamStarted = false;
        this.hasPreviewBeenShown = false;
        this.removeInjectedFixLogic(true);
    }

    public hide(): void {
        if (!this.domManager || !this.domElements) return; // Added check for elements

        // Store preview state *before* calling removeInjectedFixLogic
        const wasPreviewActive = this.isPreviewActive;

        // Hide the viewer UI
        this.domManager.hide();

        // Clean up the logic/state/listeners associated with the cycle that is ending.
        // removeInjectedFixLogic will decide whether to remove the DOM wrapper based on isFixPermanentlyApplied.
        console.log(`[FeedbackViewerLogic] Calling removeInjectedFixLogic from hide.`);
        this.removeInjectedFixLogic(true); // Pass true to attempt DOM removal if not permanent

        // If hiding effectively cancelled an active preview, reset button UI
        if (wasPreviewActive && !this.isFixPermanentlyApplied) {
             console.log('[FeedbackViewerLogic] Resetting button UI after hide cancelled preview.');
             // Use the DOM manager helper to reset content
             this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG);
             this.domElements.cancelButton.style.display = 'none';
             this.isPreviewActive = false; // Ensure flag is false
        }


        // Reset general state for the next potential cycle
        this.currentImageDataUrl = null;
        this.currentSelectedHtml = null;
        this.originalElementBounds = null;
        this.originalElementRef = null;
        this.accumulatedResponseText = '';
        this.isStreamStarted = false;
        this.hasPreviewBeenShown = false;
        // isFixPermanentlyApplied is handled by removeInjectedFixLogic logic (persists if true)
        // isPreviewActive should be false now

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
            this.showError('Could not capture image or HTML structure for context.');
             // Keep input area visible on context error
            return;
        }
        const promptText = this.domElements.promptTextarea.value.trim();
        if (!promptText) {
             this.showError('Please enter a description or question.');
             // Keep input area visible on prompt error
             return;
        }

        console.log('[FeedbackViewerLogic] Submitting feedback...');

        // Update UI for processing state
        this.domManager.setPromptState(false); // Disable textarea
        this.domManager.updateSubmitButtonState(false, 'Sending...');
        this.domManager.updateLoaderVisibility(true, 'Getting feedback...');
        this.domManager.updateActionButtonsVisibility(false);
        this.domManager.clearResponseContent();
        this.domManager.hidePreview(); // Hide any previous HTML preview

        // 1. Hide the textarea container AND update the promptTitle text
        this.domManager.showPromptInputArea(false, promptText);
        // 2. No need to call showUserPromptDisplay anymore

        // Reset response/fix state for this request
        this.accumulatedResponseText = '';
        this.isStreamStarted = false;
        this.isPreviewActive = false; // Ensure preview state is reset
        this.hasPreviewBeenShown = false; // Reset new flag
        this.removeInjectedFixLogic(true); // Clear previous non-permanent fix

        // Call API (using placeholder/actual function)
        fetchFeedback(this.currentImageDataUrl, promptText, this.currentSelectedHtml);
        // Assuming fetchFeedback triggers updateResponse/finalizeResponse/showError calls
        // via the coordinator (feedbackViewer instance)
    }

    private handlePreviewApplyClick(): void {
        console.log('[FeedbackViewerLogic] Preview/Apply button clicked.');
        if (!this.domManager || !this.domElements || !(this.originalElementRef instanceof HTMLElement)) {
             console.warn('[FeedbackViewerLogic] Cannot preview/apply fix: DOM Manager, elements, or original element ref invalid.');
             return;
        }

        if (!this.isPreviewActive) {
            // --- ACTION: Start Preview ---
            console.log('[FeedbackViewerLogic] Starting preview.');

            // Ensure the fix wrapper exists (it should have been created hidden by tryInjectHtmlFix)
            const fixWrapper = this.domManager['injectedFixWrapper'];
            if (!fixWrapper) {
                console.warn('[FeedbackViewerLogic] Cannot start preview: Injected fix wrapper not found.');
                return;
            }

            // Store original display style *before* hiding it
            if (this.originalElementDisplayStyle === null) {
                this.originalElementDisplayStyle = window.getComputedStyle(this.originalElementRef).display;
                if (this.originalElementDisplayStyle === 'none') {
                    this.originalElementDisplayStyle = 'block'; // Default fallback
                }
                console.log(`[FeedbackViewerLogic] Stored original display style: ${this.originalElementDisplayStyle}`);
            }

            // Show the fix wrapper and hide original element
            this.domManager.setInjectedFixWrapperVisibility(true);
            this.originalElementRef.style.display = 'none';
            console.log('[FeedbackViewerLogic] Displayed fix wrapper, hid original element.');

            // Update button states using the new helper
            this.domManager.updatePreviewApplyButtonContent('Apply Fix', CHECK_ICON_SVG); // Change text and icon
            this.domElements.cancelButton.style.display = 'inline-flex'; // Show Revert button (use inline-flex)
            this.isPreviewActive = true;
            this.hasPreviewBeenShown = true; // Mark that preview has been shown at least once

        } else {
            // --- ACTION: Apply Permanently ---
            console.log('[FeedbackViewerLogic] Applying fix permanently.');

            // 1. Set flag *before* cleanup starts in hide()
            this.isFixPermanentlyApplied = true;
            console.log('[FeedbackViewerLogic] Set isFixPermanentlyApplied = true.');

            // 2. Apply permanent styles (removes dashed outline)
            this.domManager.setFixAppliedStyles(true);

            // 3. Release the DOM manager's reference to this wrapper so it persists
            this.domManager.releaseAppliedFixWrapper();

            // 4. Close the main feedback viewer
            this.hide();
        }
    }

    private handleCancelFixClick(): void {
        console.log('[FeedbackViewerLogic] Revert button clicked.');
        // Only revert if preview is currently active and refs are valid
        if (!this.isPreviewActive || !this.domManager || !this.domElements || !(this.originalElementRef instanceof HTMLElement) || this.originalElementDisplayStyle === null) {
             console.warn('[FeedbackViewerLogic] Cannot revert: Preview not active or refs invalid.');
             return;
        }

        // Hide the fix wrapper
        this.domManager.setInjectedFixWrapperVisibility(false);
        // Restore the original element
        this.originalElementRef.style.display = this.originalElementDisplayStyle;
        console.log('[FeedbackViewerLogic] Hid fix wrapper, restored original element.');

        // Update state and button text/icon using helper
        this.isPreviewActive = false; // Preview is no longer showing
        this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG); // Reset button text/icon

        // Keep the Cancel/Undo button visible (it now says "Undo fix")
        // this.domElements.cancelButton.style.display = 'inline-flex'; // Keep visible
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
                    fixElements.copyButton
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
        console.log(`[FeedbackViewerLogic] >>> Entering removeInjectedFixLogic (removeFromDOM: ${removeFromDOM}, isFixPermanentlyApplied: ${this.isFixPermanentlyApplied}) <<<`);

        // --- Remove Listeners ---
        // Remove listeners associated with the fix wrapper (close/copy)
        this.removeFixWrapperListeners(); // Only handles close/copy now

        // --- Restore Original Element ---
        if (!this.isFixPermanentlyApplied && this.originalElementRef instanceof HTMLElement && this.originalElementDisplayStyle !== null) {
            if (document.body.contains(this.originalElementRef)) {
                console.log(`[FeedbackViewerLogic] Restoring original element display to: ${this.originalElementDisplayStyle}`);
                this.originalElementRef.style.display = this.originalElementDisplayStyle;
            } else {
                 console.log('[FeedbackViewerLogic] Original element no longer in DOM, skipping style restoration.');
            }
        }
        this.originalElementDisplayStyle = null;

        // --- Remove Wrapper from DOM (if requested AND fix wasn't permanent) ---
        if (removeFromDOM && !this.isFixPermanentlyApplied && this.domManager) {
            console.log('[FeedbackViewerLogic] Attempting to remove wrapper from DOM.');
            this.domManager.removeInjectedFixWrapper();
            this.isPreviewActive = false; // Reset preview flag when discarding
        } else {
             console.log(`[FeedbackViewerLogic] Skipping wrapper removal from DOM (removeFromDOM: ${removeFromDOM}, isFixPermanentlyApplied: ${this.isFixPermanentlyApplied}).`);
        }

        // --- Reset Listener State ---
        this.fixWrapperCloseButtonListener = null;
        this.fixWrapperCopyButtonListener = null;

        // Reset button state ONLY IF we are discarding (removeFromDOM is true and not permanent)
        if (removeFromDOM && !this.isFixPermanentlyApplied && this.domManager && this.domElements) {
            this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG);
            this.domElements.cancelButton.style.display = 'none';
        }

        // --- Reset Permanent Fix Flag ---
        // Only reset if we are explicitly discarding (called via cancel/hide/new submit when preview was active)
        if (removeFromDOM && !this.isFixPermanentlyApplied && this.isFixPermanentlyApplied) {
             console.log('[FeedbackViewerLogic] Resetting isFixPermanentlyApplied flag (discard scenario).');
             this.isFixPermanentlyApplied = false;
        } else if (!removeFromDOM && this.isFixPermanentlyApplied) {
            // If called from cleanup() during permanent apply, don't reset the flag here.
             console.log('[FeedbackViewerLogic] Keeping isFixPermanentlyApplied flag (permanent apply cleanup).');
        } else if (this.isFixPermanentlyApplied){
             // Reset if called during hide after a permanent apply? No, hide should just close the viewer.
             // Let's simplify: Reset flag ONLY if we are actively discarding a NON-permanent fix.
              if (removeFromDOM && !this.isFixPermanentlyApplied) {
                 // Already handled above when removing wrapper.
              }
        }


        this.updateActionButtonsVisibility(); // Update viewer action button container visibility

        console.log('[FeedbackViewerLogic] <<< Exiting removeInjectedFixLogic >>>');
    }


    // --- Listener Management for Fix Wrapper ---

    private attachFixWrapperListeners(
        wrapper: HTMLElement,
        closeButton: HTMLElement,
        copyButton: HTMLElement
    ): void {
        // Remove any existing listeners first to prevent duplicates
        this.removeFixWrapperListeners();

        // Close Button (Discard)
        this.fixWrapperCloseButtonListener = () => {
            console.log('[FeedbackViewerLogic] Close (discard) button clicked on injected fix.');
            // Reset main viewer button states when fix is discarded via 'x'
            if(this.domManager && this.domElements) {
                this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG);
                this.domElements.cancelButton.style.display = 'none';
            }
            this.isPreviewActive = false;
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

        // Apply Button (Checkmark) - REMOVED listener setup

        // MouseLeave on Wrapper - REMOVED listener setup
        // this.fixWrapperMouseLeaveListener = () => { ... };
        // wrapper.addEventListener('mouseleave', this.fixWrapperMouseLeaveListener);

        // Note: MouseEnter listener for the *original* element is removed entirely
    }

    private removeFixWrapperListeners(): void {
        // Use the DOM manager to get button references if needed, or rely on stored refs
        const fixWrapper = this.domManager?.['injectedFixWrapper']; // Keep for potential future use? Currently unused.
        const closeButton = this.domManager?.['fixCloseButton'];
        const copyButton = this.domManager?.['fixCopyButton'];
        // const applyButton = this.domManager?.['fixApplyButton']; // REMOVED

        if (closeButton && this.fixWrapperCloseButtonListener) {
            closeButton.removeEventListener('click', this.fixWrapperCloseButtonListener);
            this.fixWrapperCloseButtonListener = null;
        }
         if (copyButton && this.fixWrapperCopyButtonListener) {
            copyButton.removeEventListener('click', this.fixWrapperCopyButtonListener as EventListener);
            this.fixWrapperCopyButtonListener = null;
        }
        // Remove Apply button listener - REMOVED
        // if (applyButton && this.fixWrapperApplyButtonListener) { ... }

        // Remove MouseLeave listener - REMOVED
        // if (fixWrapper && this.fixWrapperMouseLeaveListener) { ... }

         console.log('[FeedbackViewerLogic] Removed fix wrapper listeners (close/copy).');
    }

    // REMOVED addOriginalElementMouseEnterListener method
    // private addOriginalElementMouseEnterListener(): void { ... }

    // REMOVED removeOriginalElementMouseEnterListener method
    // private removeOriginalElementMouseEnterListener(): void { ... }


    // --- Helpers ---

    private updateActionButtonsVisibility(): void {
        if (!this.domManager || !this.domElements) return; // Added elements check
        // Visibility depends only on whether HTML was found in the *response*
        const hasHtml = SPECIFIC_HTML_REGEX.test(this.accumulatedResponseText) || GENERIC_HTML_REGEX.test(this.accumulatedResponseText);
        const showContainer = hasHtml; // Determine if container should be visible

        console.log(`[FeedbackViewerLogic] updateActionButtonsVisibility: hasHtml=${hasHtml}, hasPreviewBeenShown=${this.hasPreviewBeenShown}`);
        this.domManager.updateActionButtonsVisibility(showContainer);

        // Ensure cancel button visibility aligns with preview state IF container is visible
         if (showContainer) {
             // Show Revert button only if Preview has been clicked at least once
             // Use inline-flex now for display
             this.domElements.cancelButton.style.display = this.hasPreviewBeenShown ? 'inline-flex' : 'none';
         } else {
            this.domElements.cancelButton.style.display = 'none'; // Hide if container hidden
         }
    }

    // REMOVED handlePreviewFixClick method (logic merged into handlePreviewApplyClick)
    // private handlePreviewFixClick(): void { ... }
}