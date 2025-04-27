import { escapeHTML } from './utils';
import { fetchFeedback } from '../services/ai-service';
import { marked } from 'marked';
import { copyViewportToClipboard } from '../utils/clipboard-utils';
import type { FeedbackViewerElements } from './feedback-viewer-dom';
import type { FeedbackViewerDOM } from './feedback-viewer-dom';

// Regex patterns for extracting HTML
const SPECIFIC_HTML_REGEX = /# Complete HTML with All Fixes\s*```(?:html)?\n([\s\S]*?)\n```/i;
const GENERIC_HTML_REGEX = /```(?:html)?\n([\s\S]*?)\n```/i;
// Regex for finding SVG placeholders during restoration - UPDATED
const SVG_PLACEHOLDER_REGEX = /<svg\s+data-checkra-id="([^"]+)"[^>]*>[\s\S]*?<\/svg>/g;

// ADDED: SVG Icon Constants
const EYE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>`;
const UNDO_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-off-icon lucide-eye-off"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`;
const DISPLAY_FIX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
const HIDE_FIX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-off-icon lucide-eye-off"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`;

// --- Interface for Applied Fix Data ---
interface AppliedFixInfo {
  originalElementId: string; // Unique ID assigned to the element
  originalOuterHTML: string; // Store the full outerHTML (might represent multiple siblings)
  fixedOuterHTML: string; // Store the full outerHTML suggested by AI (might represent multiple siblings)
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
  private initialSelectedElement: Element | null = null; // The element *initially* selected by the user for the cycle
  private originalOuterHTMLForCurrentCycle: string | null = null; // Store the initial HTML of the selected element
  private fixedOuterHTMLForCurrentCycle: string | null = null; // Store the AI's suggested HTML (could be multiple elements)
  private currentFixId: string | null = null; // Unique ID for the element being worked on
  private fixIdCounter: number = 0; // Counter for generating unique IDs
  private accumulatedResponseText: string = '';
  private isStreamStarted: boolean = false;
  private isPreviewActive: boolean = false; // Tracks if preview (direct replacement) is active
  private originalSvgsMap: Map<string, string> = new Map();
  private svgPlaceholderCounter: number = 0;

  // --- EDIT: Add state for tracking preview nodes and insertion point ---
  private previewInsertedNodes: Node[] = []; // Stores references to all top-level nodes inserted during preview
  private previewInsertionParent: Node | null = null; // Parent element where the preview nodes were inserted
  private previewInsertionBeforeNode: Node | null = null; // The node *before* the first preview node (or null if first child)
  // --- END EDIT ---


  // --- Global Tracking for Applied Fixes ---
  private appliedFixes: Map<string, AppliedFixInfo> = new Map();
  // Store listeners for applied fixes to clean them up later
  private appliedFixListeners: Map<string, { close: EventListener; copy: EventListener; toggle: EventListener }> = new Map();

  // --- Listeners ---
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

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
        !this.domElements.viewer.classList.contains('hidden') &&
        e.target instanceof Node &&
        !this.domElements.viewer.contains(e.target)) {
        this.hide();
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
    this.initialSelectedElement = targetElement;
    this.originalOuterHTMLForCurrentCycle = targetElement?.outerHTML || ''; // Store initial outerHTML
    this.currentFixId = `checkra-fix-${this.fixIdCounter++}`;
    this.initialSelectedElement?.setAttribute('data-checkra-fix-id', this.currentFixId);
    console.log(`[FeedbackViewerLogic] Preparing for input. Assigned ID ${this.currentFixId}`);

    // Reset state
    this.accumulatedResponseText = '';
    this.isStreamStarted = false;
    this.isPreviewActive = false;
    this.fixedOuterHTMLForCurrentCycle = null; // Reset fixed HTML for the new cycle
    this.originalSvgsMap.clear();
    this.svgPlaceholderCounter = 0;
    // --- EDIT: Reset preview tracking state ---
    this.previewInsertedNodes = [];
    this.previewInsertionParent = null;
    this.previewInsertionBeforeNode = null;
    // --- END EDIT ---

    // Reset UI
    this.domManager.setPromptState(true, '');
    this.domManager.updateSubmitButtonState(true, 'Get Feedback');
    this.domManager.clearUserMessage();
    this.domManager.clearAIResponseContent();
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
    if (this.initialSelectedElement && targetRect) {
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
      this.isStreamStarted = true;
    }

    this.accumulatedResponseText += chunk;
    const parsedHtml = marked.parse(this.accumulatedResponseText) as string;
    this.domManager.setResponseContent(parsedHtml, true);

    const hasHtmlCode = GENERIC_HTML_REGEX.test(this.accumulatedResponseText);
    this.domManager.updateLoaderVisibility(true, hasHtmlCode ? 'Creating new version...' : 'Getting feedback...');

    // REMOVED: Don't try to extract HTML or show buttons mid-stream
    // this.extractAndStoreFixHtml();
  }

  public finalizeResponse(): void {
    console.log("[FeedbackViewerLogic] Feedback stream finalized.");
    if (!this.domManager) return;

    this.domManager.updateLoaderVisibility(false); // Hide loader first
    this.domManager.setPromptState(true);
    this.domManager.updateSubmitButtonState(true, 'Get Feedback');

    // Ensure fix extraction happens on final response
    this.extractAndStoreFixHtml();

    // Update button visibility *after* loader is hidden and final extraction is attempted
    this.updateActionButtonsVisibility();
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
    this.initialSelectedElement = null;
    this.originalOuterHTMLForCurrentCycle = null;
    this.fixedOuterHTMLForCurrentCycle = null;
    this.currentFixId = null;
    this.accumulatedResponseText = '';
    this.isStreamStarted = false;
    this.isPreviewActive = false; // Ensure false

    this.previewInsertedNodes = [];
    this.previewInsertionParent = null;
    this.previewInsertionBeforeNode = null;
  }

  /**
   * Renders a prepended user message (e.g., warning, info) before the AI response.
   */
  public renderUserMessage(html: string): void {
      if (!this.domManager) return;
      console.log("[FeedbackViewerLogic] Rendering prepended user message.");
      this.domManager.renderUserMessage(html);
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
    this.domManager.clearUserMessage();
    this.domManager.clearAIResponseContent();
    this.domManager.showPromptInputArea(false, promptText);

    // --- Reset response/fix state for *this* request ---
    this.accumulatedResponseText = '';
    this.isStreamStarted = false;
    this.fixedOuterHTMLForCurrentCycle = null; // Clear any previously extracted fix
    this.domManager.clearAIResponseContent();
    this.revertPreviewIfNeeded(); // Revert any lingering preview from a previous interaction

    // --- Call API ---
    fetchFeedback(this.currentImageDataUrl, promptText, processedHtmlForAI);
  }

  private handlePreviewApplyClick(): void {
    console.log('[FeedbackViewerLogic] Preview/Apply button clicked.');
    if (!this.domManager || !this.domElements || !this.currentFixId || !this.originalOuterHTMLForCurrentCycle) {
      console.warn('[FeedbackViewerLogic] Cannot preview/apply: Missing refs, ID, or original HTML.');
      return;
    }
    if (!this.fixedOuterHTMLForCurrentCycle) {
      console.warn('[FeedbackViewerLogic] Cannot preview/apply: Fixed HTML not extracted yet.');
      return;
    }

    if (!this.isPreviewActive) {
      // --- ACTION: Start Preview (Replace Element) ---
      console.log(`[FeedbackViewerLogic] Starting preview for Fix ID: ${this.currentFixId}`);
      try {
        // Find the *original* element that still has the ID
        const elementToReplace = document.querySelector(`[data-checkra-fix-id="${this.currentFixId}"]`);
        if (!elementToReplace) {
            throw new Error(`Original element with ID ${this.currentFixId} not found in DOM for starting preview.`);
        }
        if (!elementToReplace.parentNode) {
            throw new Error(`Original element with ID ${this.currentFixId} has no parent node.`);
        }

        const fragment = this.createFragmentFromHTML(this.fixedOuterHTMLForCurrentCycle);
        if (!fragment || fragment.childNodes.length === 0) {
             throw new Error('Failed to parse fixed HTML string into a non-empty fragment.');
        }

        // --- EDIT: Store insertion point and track nodes ---
        this.previewInsertionParent = elementToReplace.parentNode;
        this.previewInsertionBeforeNode = elementToReplace.nextSibling; // Store the node *after* the original one
        this.previewInsertedNodes = Array.from(fragment.childNodes); // Store nodes *before* inserting
        // --- END EDIT ---

        // Assign ID and class to the *first* element in the fragment for tracking/styling
        const firstPreviewElement = fragment.firstElementChild;
        if (firstPreviewElement) {
            firstPreviewElement.setAttribute('data-checkra-fix-id', this.currentFixId); // Move ID to first preview element
            firstPreviewElement.classList.add('checkra-fix-previewing');
            elementToReplace.removeAttribute('data-checkra-fix-id'); // Remove ID from original element
        } else {
            // If no first element child (e.g., only text nodes), keep ID on original for revert?
            // This case is tricky. Let's assume for now fixes usually involve elements.
            console.warn(`[FeedbackViewerLogic] Fixed HTML fragment for ${this.currentFixId} has no element child. ID remains on original.`);
        }

        // Replace the current element with *all* nodes from the fragment
        elementToReplace.replaceWith(fragment);


        // Update button states
        this.domManager.updatePreviewApplyButtonContent('Apply Fix', CHECK_ICON_SVG);
        this.domElements.cancelButton.style.display = 'inline-flex';
        this.isPreviewActive = true;
        console.log(`[FeedbackViewerLogic] Preview active for ${this.currentFixId}. Element replaced with fragment.`);

      } catch (error) {
         console.error('[FeedbackViewerLogic] Error starting preview:', error);
         this.showError(`Failed to start preview: ${error instanceof Error ? error.message : String(error)}`);
         this.revertPreviewIfNeeded(); // Attempt to clean up if replacement failed partially
      }

    } else {
      // --- ACTION: Apply Permanently (Create Wrapper) ---
      console.log(`[FeedbackViewerLogic] Applying fix permanently for Fix ID: ${this.currentFixId}`);
      try {
           // --- EDIT: Check insertion point validity and remove preview nodes ---
           if (!this.previewInsertionParent) {
               throw new Error("Cannot apply fix: Preview insertion parent node is missing.");
           }
           if (this.previewInsertedNodes.length === 0) {
               console.warn(`[FeedbackViewerLogic] No preview nodes tracked for ${this.currentFixId}. Applying wrapper at original location if possible.`);
               // Fallback logic might be needed here if the original element reference is still valid
           }

           console.log(`[FeedbackViewerLogic] Removing ${this.previewInsertedNodes.length} preview nodes for ${this.currentFixId} during revert...`);
           let firstPreviewNodeParent: Node | null = null;
           this.previewInsertedNodes.forEach(node => {
               if (node.parentNode) {
                   if (!firstPreviewNodeParent) firstPreviewNodeParent = node.parentNode; // Capture parent just in case
                   node.parentNode.removeChild(node);
               }
           });
           // Ensure insertion parent is valid, potentially using the captured parent from removal
           const insertionParent = this.previewInsertionParent || firstPreviewNodeParent;
           if (!insertionParent) {
                throw new Error("Cannot apply fix: Could not determine valid parent node for inserting wrapper.");
           }
           // --- END EDIT ---


           // 1. Create the persistent wrapper
           const wrapper = document.createElement('div');
           wrapper.className = 'checkra-feedback-applied-fix';
           wrapper.setAttribute('data-checkra-fix-id', this.currentFixId);

           // 2. Create the content container inside
           const contentContainer = document.createElement('div');
           contentContainer.className = 'checkra-applied-fix-content';

           const fixedContentFragment = this.createFragmentFromHTML(this.fixedOuterHTMLForCurrentCycle);
            if (!fixedContentFragment || fixedContentFragment.childNodes.length === 0) {
                throw new Error('Failed to parse fixed HTML for content container fragment.');
            }
           contentContainer.appendChild(fixedContentFragment);
           wrapper.appendChild(contentContainer);

           // --- CAPTURE FIX ID VALUE ---
           const fixIdForListener = this.currentFixId;
           if (!fixIdForListener) {
               throw new Error("Critical error: currentFixId became null unexpectedly during fix application.");
           }
           // --- END CAPTURE ---

           // 3. Add Buttons (Close, Copy, Toggle)
           const closeBtn = this.createAppliedFixButton('close', fixIdForListener);
           const copyBtn = this.createAppliedFixButton('copy', fixIdForListener);
           const toggleBtn = this.createAppliedFixButton('toggle', fixIdForListener);
           wrapper.appendChild(closeBtn);
           wrapper.appendChild(copyBtn);
           wrapper.appendChild(toggleBtn);

           // --- EDIT: Insert the wrapper at the stored position ---
           // Insert the wrapper before the 'previewInsertionBeforeNode' (which was the node *after* the original)
           insertionParent.insertBefore(wrapper, this.previewInsertionBeforeNode);
           console.log(`[FeedbackViewerLogic] Inserted permanent wrapper for ${this.currentFixId}.`);
           // --- END EDIT ---


           // 5. Store fix information
           const fixInfo: AppliedFixInfo = {
               originalElementId: fixIdForListener,
               originalOuterHTML: this.originalOuterHTMLForCurrentCycle!,
               fixedOuterHTML: this.fixedOuterHTMLForCurrentCycle!,
               appliedWrapperElement: wrapper,
               isCurrentlyFixed: true
           };
           this.appliedFixes.set(fixIdForListener, fixInfo);
           console.log(`[FeedbackViewerLogic] Stored applied fix info for ${fixIdForListener}`);

           // 6. Store listeners for cleanup
           const listeners = {
               close: (e: Event) => this.handleAppliedFixClose(fixIdForListener, e),
               copy: (e: Event) => this.handleAppliedFixCopy(fixIdForListener, e),
               toggle: (e: Event) => this.handleAppliedFixToggle(fixIdForListener, e)
           };
           this.appliedFixListeners.set(fixIdForListener, listeners);
           closeBtn.addEventListener('click', listeners.close);
           copyBtn.addEventListener('click', listeners.copy);
           toggleBtn.addEventListener('click', listeners.toggle);


           // 7. Reset viewer state for this cycle & hide
           this.isPreviewActive = false;
           // --- EDIT: Clear preview tracking state ---
           this.previewInsertedNodes = [];
           this.previewInsertionParent = null;
           this.previewInsertionBeforeNode = null;
           // --- END EDIT ---
           this.hide(); // Close the viewer panel

      } catch (error) {
           console.error('[FeedbackViewerLogic] Error applying fix:', error);
           this.showError(`Failed to apply fix: ${error instanceof Error ? error.message : String(error)}`);
           this.revertPreviewIfNeeded(); // This will attempt to remove preview nodes and restore original
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
              // --- Use Fragment for Revert (originalOuterHTML might be single element) ---
              const originalFragment = this.createFragmentFromHTML(fixInfo.originalOuterHTML);
              if (!originalFragment || originalFragment.childNodes.length === 0) {
                  throw new Error('Failed to parse original HTML into non-empty fragment for reverting.');
              }

              // Re-add ID to the first element of the fragment if it exists
              const firstOriginalElement = originalFragment.firstElementChild;
              if (firstOriginalElement) {
                firstOriginalElement.setAttribute('data-checkra-fix-id', fixId); // Re-add ID temporarily
              }

              wrapperElement.replaceWith(originalFragment);
              // --- END EDIT ---
              console.log(`[FeedbackViewerLogic] Replaced wrapper ${fixId} with original fragment.`);


              // Clean up listeners and map entry
              const listeners = this.appliedFixListeners.get(fixId);
              if (listeners) {
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
        const wrapperElement = document.querySelector(`.checkra-feedback-applied-fix[data-checkra-fix-id="${fixId}"]`);
        if (wrapperElement) {
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
        const toggleButton = wrapperElement?.querySelector<HTMLButtonElement>('.feedback-fix-toggle');

        if (fixInfo && wrapperElement && contentContainer && toggleButton) {
            try {
                const htmlToInsert = fixInfo.isCurrentlyFixed
                     ? fixInfo.originalOuterHTML // Might be single element
                     : fixInfo.fixedOuterHTML; // Might be multiple

                 // --- Use Fragment for Toggle ---
                 const newContentFragment = this.createFragmentFromHTML(htmlToInsert);
                 if (!newContentFragment || newContentFragment.childNodes.length === 0) {
                     throw new Error('Failed to parse HTML into non-empty fragment for toggle.');
                 }

                 contentContainer.innerHTML = ''; // Clear existing content
                 contentContainer.appendChild(newContentFragment); // Append the fragment
                 // --- END EDIT ---


                 // Update state
                 fixInfo.isCurrentlyFixed = !fixInfo.isCurrentlyFixed;
                 console.log(`[FeedbackViewerLogic] Toggled ${fixId}. Currently showing fixed: ${fixInfo.isCurrentlyFixed}`);

                 // --- Update toggle button appearance ---
                 if (fixInfo.isCurrentlyFixed) {
                     toggleButton.innerHTML = HIDE_FIX_SVG;
                     toggleButton.title = "Toggle Original Version";
                     toggleButton.style.backgroundColor = 'rgba(60, 180, 110, 0.9)'; // Active color
                 } else {
                     toggleButton.innerHTML = DISPLAY_FIX_SVG;
                     toggleButton.title = "Toggle Fixed Version";
                     toggleButton.style.backgroundColor = ''; // Reset to default CSS background
                 }

            } catch (error) {
                console.error(`[FeedbackViewerLogic] Error toggling fix ${fixId}:`, error);
                // Attempt to restore a known state? Maybe revert to fixed?
                if (!fixInfo.isCurrentlyFixed) { // If failed going back to fixed
                    try {
                       // --- Use Fragment for Toggle Error Restore ---
                       const fixedFragment = this.createFragmentFromHTML(fixInfo.fixedOuterHTML);
                       if (fixedFragment && fixedFragment.childNodes.length > 0) {
                           contentContainer.innerHTML = '';
                           contentContainer.appendChild(fixedFragment);
                           fixInfo.isCurrentlyFixed = true;
                           // Restore button state
                           toggleButton.innerHTML = HIDE_FIX_SVG;
                           toggleButton.title = "Toggle Original Version";
                           toggleButton.style.backgroundColor = 'rgba(60, 180, 110, 0.9)';
                       } else {
                           console.error(`[FeedbackViewerLogic] Failed to parse fixed HTML during toggle error restore for ${fixId}.`);
                       }
                       // --- END EDIT ---
                    } catch (restoreError) {
                        console.error(`[FeedbackViewerLogic] Failed to restore fixed state for ${fixId} after toggle error:`, restoreError);
                    }
                }
            }
        } else {
            console.warn(`[FeedbackViewerLogic] Could not find fix info, wrapper, content container, or toggle button for Fix ID: ${fixId} during toggle.`);
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
   */
  private postprocessHtmlFromAI(aiHtmlString: string): string {
    if (this.originalSvgsMap.size === 0) {
        console.log('[FeedbackViewerLogic] No original SVGs stored, skipping postprocessing.');
        return aiHtmlString; // No SVGs were replaced initially
    }
    console.log(`[FeedbackViewerLogic] Postprocessing AI HTML to restore ${this.originalSvgsMap.size} SVGs...`);

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
              const tempFragment = this.createFragmentFromHTML(extractedHtml);
              if (tempFragment && tempFragment.childNodes.length > 0) {
                  this.fixedOuterHTMLForCurrentCycle = extractedHtml;
                  console.log(`[FeedbackViewerLogic] Stored postprocessed fixed HTML (direct) for Fix ID: ${this.currentFixId}`);
              } else {
                   console.warn('[FeedbackViewerLogic] Failed to parse extracted HTML into a valid, non-empty fragment. Fix may not be applicable.');
                   this.fixedOuterHTMLForCurrentCycle = null;
              }
          } catch (e) {
              console.error('[FeedbackViewerLogic] Error postprocessing/validating HTML from AI:', e);
              this.fixedOuterHTMLForCurrentCycle = null;
          }
      } else {
         if (this.isStreamStarted && !GENERIC_HTML_REGEX.test(this.accumulatedResponseText)) {
              console.log('[FeedbackViewerLogic] No HTML block found in the final AI response.');
         }
         // Ensure fixed HTML is null if no match
         this.fixedOuterHTMLForCurrentCycle = null;
      }
      this.updateActionButtonsVisibility();
  }

  /**
   * Helper to revert an active preview back to the original element.
   */
   private revertPreviewIfNeeded(): boolean {
       if (this.isPreviewActive && this.currentFixId) {
           return this.revertPreview();
       }
       // --- EDIT: Clear preview tracking state even if not active (belt-and-suspenders) ---
       this.previewInsertedNodes = [];
       this.previewInsertionParent = null;
       this.previewInsertionBeforeNode = null;
       // --- END EDIT ---
       return false;
   }

   private revertPreview(): boolean {
        console.log(`[FeedbackViewerLogic] Reverting preview for Fix ID: ${this.currentFixId}`);
        if (!this.originalOuterHTMLForCurrentCycle || !this.currentFixId || !this.domManager || !this.domElements) {
             console.warn(`[FeedbackViewerLogic] Cannot revert preview: Missing original HTML, Fix ID, or DOM elements.`);
             return false;
        }

        try {
            // --- EDIT: Remove previously inserted nodes and restore original ---
            if (!this.previewInsertionParent) {
                 throw new Error("Cannot revert preview: Insertion parent node is missing.");
            }
            if (this.previewInsertedNodes.length === 0) {
                console.warn(`[FeedbackViewerLogic] No preview nodes tracked for ${this.currentFixId}. Revert aborted.`);
                // Reset state without modifying DOM further
                this.isPreviewActive = false;
                this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG);
                this.domElements.cancelButton.style.display = 'none';
                this.previewInsertionParent = null;
                this.previewInsertionBeforeNode = null;
                return false;
            }

            console.log(`[FeedbackViewerLogic] Removing ${this.previewInsertedNodes.length} preview nodes for ${this.currentFixId} during revert...`);
            this.previewInsertedNodes.forEach(node => {
                 if (node.parentNode) {
                     node.parentNode.removeChild(node);
                 }
            });


            const originalFragment = this.createFragmentFromHTML(this.originalOuterHTMLForCurrentCycle);
             if (!originalFragment || originalFragment.childNodes.length === 0) {
                throw new Error('Failed to parse original HTML string into non-empty fragment for revert.');
             }
            // Re-apply ID to the first element of the original fragment if it exists
            const firstOriginalElement = originalFragment.firstElementChild;
            if (firstOriginalElement) {
                firstOriginalElement.setAttribute('data-checkra-fix-id', this.currentFixId);
            }

            // Insert the original fragment back at the stored position
            this.previewInsertionParent.insertBefore(originalFragment, this.previewInsertionBeforeNode);
            console.log(`[FeedbackViewerLogic] Preview reverted for ${this.currentFixId} by restoring original fragment.`);
            // --- END EDIT ---

            // Update state and UI
            this.isPreviewActive = false;
            this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG);
            this.domElements.cancelButton.style.display = 'none';
             // Clear tracking state
             this.previewInsertedNodes = [];
             this.previewInsertionParent = null;
             this.previewInsertionBeforeNode = null;

            return true; // Indicate revert happened

        } catch (error) {
            console.error('[FeedbackViewerLogic] Error reverting preview:', error);
            this.showError(`Failed to revert preview: ${error instanceof Error ? error.message : String(error)}`);
            // State might be inconsistent here, but resetting flags is safest
            this.isPreviewActive = false;
            // --- EDIT: Clear preview tracking state on error too ---
            this.previewInsertedNodes = [];
            this.previewInsertionParent = null;
            this.previewInsertionBeforeNode = null;
            // --- END EDIT ---
            if (this.domManager && this.domElements) {
                 this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG);
                 this.domElements.cancelButton.style.display = 'none';
            }
            return false;
        }
   }

  // --- Helpers ---

  /**
   * Creates a DocumentFragment containing nodes parsed from an HTML string.
   */
  private createFragmentFromHTML(htmlString: string): DocumentFragment | null {
      try {
        const template = document.createElement('template');
        template.innerHTML = htmlString.trim();
        return template.content;
      } catch (e) {
          console.error("Error creating fragment from HTML string:", e, htmlString);
          return null;
      }
  }

   /** Creates a button for the applied fix wrapper */
    private createAppliedFixButton(type: 'close' | 'copy' | 'toggle', fixId: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.setAttribute('data-fix-id', fixId);

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
                button.innerHTML = HIDE_FIX_SVG; // Icon to toggle TO original
                button.title = 'Toggle Original Version';
                break;
        }
        return button;
    }


  private updateActionButtonsVisibility(): void {
    if (!this.domManager || !this.domElements) return;
    const showContainer = !!this.fixedOuterHTMLForCurrentCycle;

    console.log(`[FeedbackViewerLogic] updateActionButtonsVisibility: showContainer=${showContainer}, isPreviewActive=${this.isPreviewActive}`);
    this.domManager.updateActionButtonsVisibility(showContainer);

    if (showContainer) {
      this.domElements.cancelButton.style.display = this.isPreviewActive ? 'inline-flex' : 'none';
    } else {
      this.domElements.cancelButton.style.display = 'none';
    }
  }

}