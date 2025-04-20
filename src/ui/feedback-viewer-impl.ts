import { escapeHTML } from './utils';
import { fetchFeedback } from '../services/ai-service';
import { marked } from 'marked';
import { copyViewportToClipboard } from '../utils/clipboard-utils';
import type { FeedbackViewerElements } from './feedback-viewer-dom'; // Use type import
import type { FeedbackViewerDOM } from './feedback-viewer-dom';

// Regex patterns for extracting HTML
const SPECIFIC_HTML_REGEX = /# Complete HTML with All Fixes\s*```(?:html)?\n([\s\S]*?)\n```/i;
const GENERIC_HTML_REGEX = /```(?:html)?\n([\s\S]*?)\n```/i;
// Regex for finding SVG placeholders during restoration - UPDATED
const SVG_PLACEHOLDER_REGEX = /<svg\s+data-checkra-id="([^"]+)"[^>]*>[\s\S]*?<\/svg>/g;

// ADDED: SVG Icon Constants
const EYE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>`;
const UNDO_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-undo2-icon lucide-undo-2"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>`; // Added for completeness, though cancel button isn't dynamic
const TOGGLE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-refresh-cw"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`;

// --- Interface for Applied Fix Data ---
interface AppliedFixInfo {
  originalElementId: string; // Unique ID assigned to the element
  originalOuterHTML: string; // Store the full outerHTML
  fixedOuterHTML: string; // Store the full outerHTML suggested by AI
  appliedWrapperElement: HTMLDivElement | null; // Reference to the '.checkra-feedback-applied-fix' wrapper
  isCurrentlyFixed: boolean; // Tracks if the displayed version in the wrapper is the fix
}

/**
 * Handles the logic, state, and interactions for the feedback viewer.
 */
export class FeedbackViewerImpl {
  private domElements: FeedbackViewerElements | null = null;
  private domManager: FeedbackViewerDOM | null = null; // Use the imported type

  // --- State ---
  private currentImageDataUrl: string | null = null;
  private originalElementRef: Element | null = null; // The element *currently* in the DOM for the cycle
  private originalOuterHTMLForCurrentCycle: string | null = null; // Store the initial HTML
  private fixedOuterHTMLForCurrentCycle: string | null = null; // Store the AI's suggested HTML
  private currentFixId: string | null = null; // Unique ID for the element being worked on
  private fixIdCounter: number = 0; // Counter for generating unique IDs
  private accumulatedResponseText: string = '';
  private isStreamStarted: boolean = false;
  private originalElementDisplayStyle: string | null = null; // For restoring after fix preview
  private isFixPermanentlyApplied: boolean = false; // Added: Tracks if the current fix is permanent
  private isPreviewActive: boolean = false; // Tracks if preview (direct replacement) is active
  private hasPreviewBeenShown: boolean = false; // Tracks if preview has been shown
  private originalSvgsMap: Map<string, string> = new Map();
  private svgPlaceholderCounter: number = 0;

  // --- Global Tracking for Applied Fixes ---
  private appliedFixes: Map<string, AppliedFixInfo> = new Map();
  // Store listeners for applied fixes to clean them up later
  private appliedFixListeners: Map<string, { close: EventListener; copy: EventListener; toggle: EventListener }> = new Map();

  // --- Listeners ---
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  private fixWrapperCloseButtonListener: ((event: MouseEvent) => void) | null = null;
  private fixWrapperCopyButtonListener: ((e: MouseEvent) => void) | null = null;

  constructor() {
    // Bind methods used as event handlers
    this.handleTextareaKeydown = this.handleTextareaKeydown.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handlePreviewApplyClick = this.handlePreviewApplyClick.bind(this);
    this.handleCancelFixClick = this.handleCancelFixClick.bind(this); // Keep binding
    // Bind new handlers for applied fix buttons
    this.handleAppliedFixClose = this.handleAppliedFixClose.bind(this);
    this.handleAppliedFixCopy = this.handleAppliedFixCopy.bind(this);
    this.handleAppliedFixToggle = this.handleAppliedFixToggle.bind(this);
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
        !this.domElements.viewer.contains(e.target)) {
        // UPDATED: Check if the click target is part of an applied fix wrapper
        const appliedWrapper = (e.target as Element).closest('.checkra-feedback-applied-fix');
        if (!appliedWrapper) { // Only hide if the click is outside the viewer AND outside any applied fix
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

    // --- Clean up listeners on applied fixes ---
    this.appliedFixListeners.forEach((listeners, fixId) => {
        const fixInfo = this.appliedFixes.get(fixId);
        if (fixInfo?.appliedWrapperElement) {
            const closeBtn = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-close-btn');
            const copyBtn = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-copy-btn');
            const toggleBtn = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-toggle');
            closeBtn?.removeEventListener('click', listeners.close);
            copyBtn?.removeEventListener('click', listeners.copy);
            toggleBtn?.removeEventListener('click', listeners.toggle);
        }
    });
    this.appliedFixListeners.clear();
    // We don't clear this.appliedFixes itself, as the fixes might persist beyond the viewer's lifecycle if not closed.
    // The user might close the viewer and expect applied fixes to remain toggleable/closable.

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
    this.originalElementRef = targetElement;
    this.originalOuterHTMLForCurrentCycle = targetElement?.outerHTML || ''; // Store initial outerHTML
    this.currentFixId = `checkra-fix-${this.fixIdCounter++}`;
    this.originalElementRef?.setAttribute('data-checkra-fix-id', this.currentFixId);
    console.log(`[FeedbackViewerLogic] Preparing for input. Assigned ID ${this.currentFixId}`);

    // Reset state
    this.accumulatedResponseText = '';
    this.isStreamStarted = false;
    this.isPreviewActive = false;
    this.hasPreviewBeenShown = false;
    this.fixedOuterHTMLForCurrentCycle = null; // Reset fixed HTML for the new cycle
    this.originalSvgsMap.clear();
    this.svgPlaceholderCounter = 0;
    // Don't clear appliedFixes map here

    // Reset UI
    this.domManager.setPromptState(true, '');
    this.domManager.updateSubmitButtonState(true, 'Get Feedback');
    this.domManager.clearResponseContent();
    this.domManager.showPromptInputArea(true);
    this.domManager.updateLoaderVisibility(false);
    this.domManager.updateActionButtonsVisibility(false); // Hide container initially
    // Reset button states explicitly using the new helper
    if (this.domManager && this.domElements) {
      this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG);
      this.domElements.cancelButton.style.display = 'none'; // Keep hiding cancel button
    }

    // Calculate position and show viewer
    let position: { top: number; left: number; mode: 'fixed' | 'absolute' } | null = null;
    if (this.originalElementRef && targetRect) {
      position = this.domManager.calculateOptimalPosition(targetRect);
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

    // NEW: Attempt to extract the fix HTML as it comes in, but don't inject/replace yet
    this.extractAndStoreFixHtml();
  }

  public finalizeResponse(): void {
    console.log("[FeedbackViewerLogic] Feedback stream finalized.");
    if (!this.domManager) return;

    this.domManager.updateLoaderVisibility(false);
    this.domManager.setPromptState(true);
    this.domManager.updateSubmitButtonState(true, 'Get Feedback');

    // Ensure fix extraction happens on final response
    this.extractAndStoreFixHtml();

    this.updateActionButtonsVisibility(); // Show/hide based on whether fixed HTML was extracted
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
    this.fixedOuterHTMLForCurrentCycle = null;
    // Should we revert preview if an error occurs *after* preview started? Yes.
    this.revertPreviewIfNeeded(); // Add this helper call
  }

  public hide(): void {
    if (!this.domManager || !this.domElements) return; // Added check for elements

    // Revert any active preview *before* hiding
    this.revertPreviewIfNeeded();

    // Hide the viewer UI
    this.domManager.hide();

    // Reset transient state for the next cycle
    this.currentImageDataUrl = null;
    this.originalElementRef = null;
    this.originalOuterHTMLForCurrentCycle = null;
    this.fixedOuterHTMLForCurrentCycle = null;
    this.currentFixId = null;
    this.accumulatedResponseText = '';
    this.isStreamStarted = false;
    this.isPreviewActive = false; // Ensure false
    this.hasPreviewBeenShown = false;

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
    if (!this.domManager || !this.domElements || !this.originalOuterHTMLForCurrentCycle || !this.currentFixId) {
        this.showError('Missing context for submission (original HTML or Fix ID). Please select an element again.');
      return;
    }

    const promptText = this.domElements.promptTextarea.value.trim();
    if (!promptText) {
      this.showError('Please enter a description or question.');
      return;
    }

    console.log(`[FeedbackViewerLogic] Submitting feedback for Fix ID: ${this.currentFixId}...`);

    // --- Preprocess HTML ---
    let processedHtmlForAI = this.originalOuterHTMLForCurrentCycle; // Start with the stored outerHTML
    this.originalSvgsMap.clear();
    this.svgPlaceholderCounter = 0;
        try {
             console.log('[FeedbackViewerLogic] Preprocessing HTML to replace SVGs...');
             processedHtmlForAI = this.preprocessHtmlForAI(processedHtmlForAI);
             console.log(`[FeedbackViewerLogic] Preprocessing complete. Stored ${this.originalSvgsMap.size} SVGs.`);
        } catch(e) {
             console.error('[FeedbackViewerLogic] Error preprocessing HTML for AI:', e);
             this.showError('Failed to process HTML before sending.');
             return;
    }
    // --- End Preprocessing ---

    // --- Update UI ---
    this.domManager.setPromptState(false);
    this.domManager.updateSubmitButtonState(false, 'Sending...');
    this.domManager.updateLoaderVisibility(true, 'Getting feedback...');
    this.domManager.updateActionButtonsVisibility(false); // Hide during request
    this.domManager.clearResponseContent();
    this.domManager.showPromptInputArea(false, promptText);

    // --- Reset response/fix state for *this* request ---
    this.accumulatedResponseText = '';
    this.isStreamStarted = false;
    this.fixedOuterHTMLForCurrentCycle = null; // Clear any previously extracted fix
    this.revertPreviewIfNeeded(); // Revert any lingering preview from a previous interaction

    // --- Call API ---
    fetchFeedback(this.currentImageDataUrl, promptText, processedHtmlForAI);
  }

  private handlePreviewApplyClick(): void {
    console.log('[FeedbackViewerLogic] Preview/Apply button clicked.');
    if (!this.domManager || !this.domElements || !this.originalElementRef || !this.currentFixId || !this.originalOuterHTMLForCurrentCycle) {
      console.warn('[FeedbackViewerLogic] Cannot preview/apply: Missing refs, ID, or original HTML.');
      return;
    }
    if (!this.fixedOuterHTMLForCurrentCycle) {
      console.warn('[FeedbackViewerLogic] Cannot preview/apply: Fixed HTML not extracted yet.');
      // Maybe show a message to the user?
      return;
    }

    if (!this.isPreviewActive) {
      // --- ACTION: Start Preview (Replace Element) ---
      console.log(`[FeedbackViewerLogic] Starting preview for Fix ID: ${this.currentFixId}`);
      try {
        const currentElement = document.querySelector(`[data-checkra-fix-id="${this.currentFixId}"]`);
        if (!currentElement) {
            throw new Error(`Element with ID ${this.currentFixId} not found in DOM for preview.`);
        }
        this.originalElementRef = currentElement; // Ensure ref is current

        const newElement = this.createElementFromHTML(this.fixedOuterHTMLForCurrentCycle);
        if (!newElement) {
             throw new Error('Failed to parse fixed HTML string into an element.');
        }

        newElement.setAttribute('data-checkra-fix-id', this.currentFixId); // Carry over the ID
        newElement.classList.add('checkra-fix-previewing'); // Add preview style indicator

        currentElement.replaceWith(newElement);
        this.originalElementRef = newElement; // Update ref to the new element

        // Update button states
        this.domManager.updatePreviewApplyButtonContent('Apply Fix', CHECK_ICON_SVG);
        this.domElements.cancelButton.style.display = 'inline-flex';
        this.isPreviewActive = true;
        this.hasPreviewBeenShown = true;
        console.log(`[FeedbackViewerLogic] Preview active for ${this.currentFixId}. Element replaced.`);

      } catch (error) {
         console.error('[FeedbackViewerLogic] Error starting preview:', error);
         this.showError(`Failed to start preview: ${error instanceof Error ? error.message : String(error)}`);
         this.revertPreviewIfNeeded(); // Attempt to clean up if replacement failed partially
      }

    } else {
      // --- ACTION: Apply Permanently (Create Wrapper) ---
      console.log(`[FeedbackViewerLogic] Applying fix permanently for Fix ID: ${this.currentFixId}`);
      try {
           const previewElement = document.querySelector(`[data-checkra-fix-id="${this.currentFixId}"]`);
           if (!previewElement) {
               throw new Error(`Preview element with ID ${this.currentFixId} not found in DOM for applying.`);
           }
           this.originalElementRef = previewElement; // Ensure ref is current

           // 1. Create the persistent wrapper
           const wrapper = document.createElement('div');
           wrapper.className = 'checkra-feedback-applied-fix';
           wrapper.setAttribute('data-checkra-fix-id', this.currentFixId);

           // 2. Create the content container inside
           const contentContainer = document.createElement('div');
           contentContainer.className = 'checkra-applied-fix-content';
           // IMPORTANT: Use the *fixedOuterHTML* to populate the content.
           // We need to parse it again to avoid inserting the wrapper into itself if fixedOuterHTML was already a div.
           const fixedContentElement = this.createElementFromHTML(this.fixedOuterHTMLForCurrentCycle);
            if (!fixedContentElement) {
                throw new Error('Failed to parse fixed HTML for content container.');
            }
           contentContainer.appendChild(fixedContentElement); // Append the actual fixed element
           wrapper.appendChild(contentContainer);

           // --- CAPTURE FIX ID VALUE ---
           const fixIdForListener = this.currentFixId; // Capture the *value* of currentFixId
           if (!fixIdForListener) {
               // Defensive check - this really shouldn't happen here, but safety first.
               throw new Error("Critical error: currentFixId became null unexpectedly during fix application.");
           }
           // --- END CAPTURE ---

           // 3. Add Buttons (Close, Copy, Toggle) - Pass the captured value
           const closeBtn = this.createAppliedFixButton('close', fixIdForListener);
           const copyBtn = this.createAppliedFixButton('copy', fixIdForListener);
           const toggleBtn = this.createAppliedFixButton('toggle', fixIdForListener);
           wrapper.appendChild(closeBtn);
           wrapper.appendChild(copyBtn);
           wrapper.appendChild(toggleBtn);

           // 4. Replace the preview element with the wrapper
           previewElement.replaceWith(wrapper);

           // 5. Store fix information - Use the captured value
           const fixInfo: AppliedFixInfo = {
               originalElementId: fixIdForListener, // Use captured value
               originalOuterHTML: this.originalOuterHTMLForCurrentCycle!, // Add non-null assertion
               fixedOuterHTML: this.fixedOuterHTMLForCurrentCycle!,   // Add non-null assertion
               appliedWrapperElement: wrapper,
               isCurrentlyFixed: true
           };
           this.appliedFixes.set(fixIdForListener, fixInfo); // Use captured value
           console.log(`[FeedbackViewerLogic] Stored applied fix info for ${fixIdForListener}`);

           // 6. Store listeners for cleanup - Use the captured value in handlers
           const listeners = {
               close: (e: Event) => this.handleAppliedFixClose(fixIdForListener, e), // Use captured value
               copy: (e: Event) => this.handleAppliedFixCopy(fixIdForListener, e),   // Use captured value
               toggle: (e: Event) => this.handleAppliedFixToggle(fixIdForListener, e) // Use captured value
           };
           this.appliedFixListeners.set(fixIdForListener, listeners); // Use captured value
           closeBtn.addEventListener('click', listeners.close);
           copyBtn.addEventListener('click', listeners.copy);
           toggleBtn.addEventListener('click', listeners.toggle);


           // 7. Reset viewer state for this cycle & hide
           this.isPreviewActive = false;
           this.hide(); // Close the viewer panel

      } catch (error) {
           console.error('[FeedbackViewerLogic] Error applying fix:', error);
           this.showError(`Failed to apply fix: ${error instanceof Error ? error.message : String(error)}`);
           this.revertPreviewIfNeeded();
      }
    }
  }

  private handleCancelFixClick(): void {
    console.log('[FeedbackViewerLogic] Revert (during preview) button clicked.');
    if (!this.isPreviewActive || !this.currentFixId) {
      console.warn('[FeedbackViewerLogic] Cannot revert: Preview not active or Fix ID missing.');
      return;
    }

    this.revertPreview(); // Use the common revert logic
  }

  // --- Applied Fix Button Handlers ---

  private handleAppliedFixClose(fixId: string, event: Event): void {
      event.stopPropagation();
      console.log(`[FeedbackViewerLogic] Close button clicked for applied Fix ID: ${fixId}`);
      const fixInfo = this.appliedFixes.get(fixId);
      const wrapperElement = document.querySelector(`.checkra-feedback-applied-fix[data-checkra-fix-id="${fixId}"]`);

      if (fixInfo && wrapperElement) {
          try {
              const originalElement = this.createElementFromHTML(fixInfo.originalOuterHTML);
              if (!originalElement) throw new Error('Failed to parse original HTML for reverting.');

              originalElement.setAttribute('data-checkra-fix-id', fixId); // Re-add ID temporarily? Might not be needed.

              wrapperElement.replaceWith(originalElement);
              console.log(`[FeedbackViewerLogic] Replaced wrapper ${fixId} with original element.`);

              // Clean up listeners and map entry
              const listeners = this.appliedFixListeners.get(fixId);
              if (listeners) {
                  // Buttons are gone with the wrapper, just remove map entry
                  this.appliedFixListeners.delete(fixId);
              }
              this.appliedFixes.delete(fixId);
              console.log(`[FeedbackViewerLogic] Removed fix info and listeners for ${fixId}.`);

          } catch (error) {
              console.error(`[FeedbackViewerLogic] Error closing/reverting fix ${fixId}:`, error);
              // Optionally show an error to the user?
          }
      } else {
          console.warn(`[FeedbackViewerLogic] Could not find fix info or wrapper element for Fix ID: ${fixId} during close.`);
          // Attempt cleanup if possible
          if (wrapperElement) wrapperElement.remove();
          if (this.appliedFixes.has(fixId)) this.appliedFixes.delete(fixId);
          if (this.appliedFixListeners.has(fixId)) this.appliedFixListeners.delete(fixId);
      }
  }

   private async handleAppliedFixCopy(fixId: string, event: Event): Promise<void> {
        event.stopPropagation();
        console.log(`[FeedbackViewerLogic] Copy button clicked for applied Fix ID: ${fixId}`);
        // The copy logic likely needs the wrapper element, find it.
        const wrapperElement = document.querySelector(`.checkra-feedback-applied-fix[data-checkra-fix-id="${fixId}"]`);
        if (wrapperElement) {
             // UPDATED: Call copyViewportToClipboard without arguments
             try {
                 await copyViewportToClipboard();
             } catch (err) {
                  console.error(`Error copying viewport for fix ${fixId}:`, err);
             }
        } else {
            console.warn(`[FeedbackViewerLogic] Wrapper element not found for copy: ${fixId}`);
        }
    }

    private handleAppliedFixToggle(fixId: string, event: Event): void {
        event.stopPropagation();
        console.log(`[FeedbackViewerLogic] Toggle button clicked for applied Fix ID: ${fixId}`);
        const fixInfo = this.appliedFixes.get(fixId);
        const wrapperElement = document.querySelector(`.checkra-feedback-applied-fix[data-checkra-fix-id="${fixId}"]`);
        const contentContainer = wrapperElement?.querySelector('.checkra-applied-fix-content');

        if (fixInfo && wrapperElement && contentContainer) {
            try {
                 const htmlToInsert = fixInfo.isCurrentlyFixed
                     ? fixInfo.originalOuterHTML
                     : fixInfo.fixedOuterHTML;

                 const newContentElement = this.createElementFromHTML(htmlToInsert);
                 if (!newContentElement) throw new Error('Failed to parse HTML for toggle.');

                 // Replace content *inside* the container
                 contentContainer.innerHTML = ''; // Clear existing content
                 contentContainer.appendChild(newContentElement);

                 // Update state
                 fixInfo.isCurrentlyFixed = !fixInfo.isCurrentlyFixed;
                 console.log(`[FeedbackViewerLogic] Toggled ${fixId}. Currently showing fixed: ${fixInfo.isCurrentlyFixed}`);

                 // Optionally update toggle button appearance (e.g., add/remove class)
                 const toggleButton: HTMLButtonElement | null = wrapperElement.querySelector('.feedback-fix-toggle');
                 if (toggleButton) {
                     toggleButton.classList.toggle('showing-original', !fixInfo.isCurrentlyFixed);
                     toggleButton.title = fixInfo.isCurrentlyFixed ? "Toggle Original Version" : "Toggle Fixed Version";
                 }

            } catch (error) {
                console.error(`[FeedbackViewerLogic] Error toggling fix ${fixId}:`, error);
                // Attempt to restore a known state? Maybe revert to fixed?
                if (!fixInfo.isCurrentlyFixed) { // If failed going back to fixed
                    try {
                       const fixedElem = this.createElementFromHTML(fixInfo.fixedOuterHTML);
                       if (fixedElem) {
                           contentContainer.innerHTML = '';
                           contentContainer.appendChild(fixedElem);
                           fixInfo.isCurrentlyFixed = true;
                       }
                    } catch (restoreError) {
                        console.error(`[FeedbackViewerLogic] Failed to restore fixed state for ${fixId} after toggle error.`);
                    }
                }
            }
        } else {
            console.warn(`[FeedbackViewerLogic] Could not find fix info, wrapper, or content container for Fix ID: ${fixId} during toggle.`);
        }
    }

  // --- HTML Processing & Injection Logic ---

  /**
   * Parses HTML, finds SVGs, replaces them with placeholders, stores originals.
   */
  private preprocessHtmlForAI(htmlString: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const svgs = doc.querySelectorAll('svg');
    this.svgPlaceholderCounter = 0; // Ensure counter starts at 0

    svgs.forEach(svg => {
      const placeholderId = `checkra-svg-${this.svgPlaceholderCounter++}`;
      this.originalSvgsMap.set(placeholderId, svg.outerHTML);

      // Create placeholder element
      const placeholder = doc.createElement('svg');
      placeholder.setAttribute('data-checkra-id', placeholderId);
      // Add potentially useful but low-token attributes if needed by LLM?
      // placeholder.setAttribute('viewBox', svg.getAttribute('viewBox') || '');
      // placeholder.setAttribute('role', svg.getAttribute('role') || 'img');

      svg.parentNode?.replaceChild(placeholder, svg);
    });

    // Return the modified HTML. Use body.innerHTML if the original was a fragment,
    // or outerHTML of the root element if it was a full element.
    // Assuming the original selection is likely a single element or fragment within body.
    // If htmlString represents a full document fragment, doc.body.innerHTML is best.
    // If htmlString is outerHTML of a single element, need to get that element.
    // Let's default to body.innerHTML for simplicity, assuming fragments are common.
    // If the input was outerHTML of a single node, this might add an extra container.
    // A safer approach might be needed depending on exact `selectedHtml` content.
    return doc.body.innerHTML;
  }

  /**
   * Parses AI-generated HTML, finds placeholders, and replaces them with stored SVGs.
   * Uses the updated regex to match non-self-closing placeholder tags.
   */
  private postprocessHtmlFromAI(aiHtmlString: string): string {
    if (this.originalSvgsMap.size === 0) {
        console.log('[FeedbackViewerLogic] No original SVGs stored, skipping postprocessing.');
        return aiHtmlString; // No SVGs were replaced initially
    }
    console.log(`[FeedbackViewerLogic] Postprocessing AI HTML to restore ${this.originalSvgsMap.size} SVGs...`);

    // Use the UPDATED SVG_PLACEHOLDER_REGEX
    let restoredHtml = aiHtmlString.replace(SVG_PLACEHOLDER_REGEX, (match, placeholderId) => {
        const originalSvg = this.originalSvgsMap.get(placeholderId);
        if (originalSvg) {
            console.log(`[FeedbackViewerLogic] Restoring SVG for ID: ${placeholderId}`);
            return originalSvg;
        } else {
            console.warn(`[FeedbackViewerLogic] Original SVG not found for placeholder ID: ${placeholderId}. Leaving placeholder.`);
            return match; // Keep the placeholder if original is missing
        }
    });

    console.log('[FeedbackViewerLogic] Postprocessing complete.');
    return restoredHtml;
  }

  /**
   * Extracts HTML from the accumulated response, postprocesses it,
   * and stores it in `fixedOuterHTMLForCurrentCycle`.
   * Does NOT modify the DOM.
   */
  private extractAndStoreFixHtml(): void {
      if (!this.accumulatedResponseText) return;

    let match = this.accumulatedResponseText.match(SPECIFIC_HTML_REGEX);
    if (!match) {
      match = this.accumulatedResponseText.match(GENERIC_HTML_REGEX);
    }

    if (match && match[1]) {
      let extractedHtml = match[1].trim();
      console.log('[FeedbackViewerLogic] Regex matched HTML from AI response.');

      try {
        extractedHtml = this.postprocessHtmlFromAI(extractedHtml);
              // Attempt to parse and re-serialize to ensure it's valid outerHTML
              const tempElement = this.createElementFromHTML(extractedHtml);
              if (tempElement) {
                  this.fixedOuterHTMLForCurrentCycle = tempElement.outerHTML;
                  console.log(`[FeedbackViewerLogic] Stored postprocessed fixed HTML for Fix ID: ${this.currentFixId}`);
        } else {
                   console.warn('[FeedbackViewerLogic] Failed to parse extracted HTML into a valid element. Fix may not be applicable.');
                   this.fixedOuterHTMLForCurrentCycle = null; // Ensure it's null if invalid
              }

          } catch (e) {
              console.error('[FeedbackViewerLogic] Error postprocessing/validating HTML from AI:', e);
              this.fixedOuterHTMLForCurrentCycle = null; // Ensure it's null on error
          }
      } else {
         // No HTML found in this chunk or final response
         // If called from finalize and still no HTML, fixedOuterHTMLForCurrentCycle remains null.
         if (this.isStreamStarted && !GENERIC_HTML_REGEX.test(this.accumulatedResponseText)) {
              console.log('[FeedbackViewerLogic] No HTML block found in the final AI response.');
         }
      }
      // Update button visibility based on whether we have valid fixed HTML now
      this.updateActionButtonsVisibility();
  }

  /**
   * Helper to revert an active preview back to the original element.
   * Returns true if revert was performed, false otherwise.
   */
   private revertPreviewIfNeeded(): boolean {
       if (this.isPreviewActive && this.currentFixId) {
           return this.revertPreview();
       }
       return false;
   }

   private revertPreview(): boolean {
        console.log(`[FeedbackViewerLogic] Reverting preview for Fix ID: ${this.currentFixId}`);
        if (!this.originalOuterHTMLForCurrentCycle || !this.currentFixId || !this.domManager || !this.domElements) {
             console.warn(`[FeedbackViewerLogic] Cannot revert preview: Missing original HTML, Fix ID, or DOM elements.`);
             return false;
        }

        try {
            const currentElement = document.querySelector(`[data-checkra-fix-id="${this.currentFixId}"]`);
            if (!currentElement) {
                // Maybe already reverted or element removed? Log warning but don't throw.
                console.warn(`[FeedbackViewerLogic] Element ${this.currentFixId} not found in DOM during revert. Assuming already reverted.`);
                this.isPreviewActive = false; // Ensure state is correct
                 this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG);
                 this.domElements.cancelButton.style.display = 'none';
                return false; // Indicate no action taken now
            }

            const originalRestoredElement = this.createElementFromHTML(this.originalOuterHTMLForCurrentCycle);
             if (!originalRestoredElement) {
                throw new Error('Failed to parse original HTML string for revert.');
             }
            originalRestoredElement.setAttribute('data-checkra-fix-id', this.currentFixId); // Re-apply ID

            currentElement.replaceWith(originalRestoredElement);
            this.originalElementRef = originalRestoredElement; // Update ref

            console.log(`[FeedbackViewerLogic] Preview reverted for ${this.currentFixId}.`);

            // Update state and UI
            this.isPreviewActive = false;
            this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG);
            this.domElements.cancelButton.style.display = 'none';
             // Should we reset hasPreviewBeenShown? No, keep it true if preview was ever shown.

            return true; // Indicate revert happened

        } catch (error) {
            console.error('[FeedbackViewerLogic] Error reverting preview:', error);
            this.showError(`Failed to revert preview: ${error instanceof Error ? error.message : String(error)}`);
            // State might be inconsistent here, but resetting flags is safest
            this.isPreviewActive = false;
            if (this.domManager && this.domElements) {
      this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG);
      this.domElements.cancelButton.style.display = 'none';
    }
            return false;
        }
   }

  // --- Helpers ---

  /** Creates an element from an HTML string. Returns the first element child. */
  private createElementFromHTML(htmlString: string): Element | null {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString.trim(), 'text/html');
        // Return the first element in the body, assuming the string represents a single element or fragment
        return doc.body.firstElementChild;
      } catch (e) {
          console.error("Error parsing HTML string:", e, htmlString);
          return null;
      }
  }

   /** Creates a button for the applied fix wrapper */
    private createAppliedFixButton(type: 'close' | 'copy' | 'toggle', fixId: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.setAttribute('data-fix-id', fixId); // Associate button with fix ID

        switch (type) {
            case 'close':
                button.className = 'feedback-fix-close-btn';
                button.innerHTML = '&times;';
                button.title = 'Discard Fix (Revert to Original)';
                break;
            case 'copy':
                button.className = 'feedback-fix-copy-btn';
                button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
                button.title = 'Copy Screenshot';
                break;
            case 'toggle':
                button.className = 'feedback-fix-toggle';
                button.innerHTML = TOGGLE_ICON_SVG;
                button.title = 'Toggle Original/Fixed Version';
                break;
        }
        return button;
    }


  private updateActionButtonsVisibility(): void {
    if (!this.domManager || !this.domElements) return;
    // Visibility depends on whether valid *fixed* HTML has been extracted for the current cycle
    const showContainer = !!this.fixedOuterHTMLForCurrentCycle;

    console.log(`[FeedbackViewerLogic] updateActionButtonsVisibility: showContainer=${showContainer}, isPreviewActive=${this.isPreviewActive}`);
    this.domManager.updateActionButtonsVisibility(showContainer);

    // Show Revert button only if Preview is currently active
    if (showContainer) {
      this.domElements.cancelButton.style.display = this.isPreviewActive ? 'inline-flex' : 'none';
    } else {
      this.domElements.cancelButton.style.display = 'none'; // Hide if container hidden
    }
  }

}