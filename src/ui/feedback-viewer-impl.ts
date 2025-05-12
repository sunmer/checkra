import { escapeHTML } from './utils';
import { fetchFeedback, fetchAudit } from '../services/ai-service';
// import { marked } from 'marked'; // REMOVED - Not used here
import { copyViewportToClipboard } from '../utils/clipboard-utils';
import type { FeedbackViewerElements } from './feedback-viewer-dom';
import type { FeedbackViewerDOM } from './feedback-viewer-dom';
import { screenCapture } from './screen-capture';
import type { SettingsModal } from './settings-modal';
import { eventEmitter } from '../core/index';

// ADDED: Conversation History Types and Constants
interface ConversationItem {
  type: 'user' | 'ai' | 'usermessage' | 'error';
  content: string;
  isStreaming?: boolean; // Optional flag for AI messages
  fix?: { // Optional fix data for AI messages
    originalHtml: string;
    fixedHtml: string;
    fixId: string; 
  };
}
const CONVERSATION_HISTORY_KEY = 'checkra_conversation_history';

// Regex patterns for extracting HTML
const SPECIFIC_HTML_REGEX = /# Complete HTML with All Fixes\s*```(?:html)?\n([\s\S]*?)\n```/i;
const GENERIC_HTML_REGEX = /```(?:html)?\n([\s\S]*?)\n```/i;
// Regex for finding SVG placeholders during restoration - UPDATED
const SVG_PLACEHOLDER_REGEX = /<svg\s+data-checkra-id="([^"]+)"[^>]*>[\s\S]*?<\/svg>/g;

// ADDED: SVG Icon Constants
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

// Helper function to get head metadata (can be moved to a utils file)
const getHeadMetadata = (): Record<string, string | null> => {
  const data: Record<string, string | null> = {};
  data.title = document.title || null;
  const descriptionTag = document.querySelector('meta[name="description"]');
  data.description = descriptionTag ? descriptionTag.getAttribute('content') : null;
  const ogTitleTag = document.querySelector('meta[property="og:title"]');
  data.ogTitle = ogTitleTag ? ogTitleTag.getAttribute('content') : null;
  const ogDescTag = document.querySelector('meta[property="og:description"]');
  data.ogDescription = ogDescTag ? ogDescTag.getAttribute('content') : null;
  const viewportTag = document.querySelector('meta[name="viewport"]');
  data.viewport = viewportTag ? viewportTag.getAttribute('content') : null;
  const canonicalTag = document.querySelector('link[rel="canonical"]');
  data.canonical = canonicalTag ? canonicalTag.getAttribute('href') : null;
  // Add more tags as needed (e.g., robots, keywords)
  return data;
};

/**
 * Handles the logic, state, and interactions for the feedback viewer.
 */
export class FeedbackViewerImpl {
  private domElements: FeedbackViewerElements | null = null;
  private domManager: FeedbackViewerDOM | null = null;
  private settingsModal: SettingsModal | null = null;

  // --- State ---
  private isVisible: boolean = false;
  private currentImageDataUrl: string | null = null;
  private initialSelectedElement: Element | null = null; // The element *initially* selected by the user for the cycle
  private currentlyHighlightedElement: Element | null = null; // << ADDED: Track element with outline
  private originalOuterHTMLForCurrentCycle: string | null = null; // Store the initial HTML of the selected element
  private fixedOuterHTMLForCurrentCycle: string | null = null; // Store the AI's suggested HTML (could be multiple elements)
  private currentFixId: string | null = null; // Unique ID for the element being worked on
  private fixIdCounter: number = 0; // Counter for generating unique IDs
  private originalSvgsMap: Map<string, string> = new Map();
  private svgPlaceholderCounter: number = 0;

  // --- Global Tracking for Applied Fixes ---
  private appliedFixes: Map<string, AppliedFixInfo> = new Map();
  // Store listeners for applied fixes to clean them up later
  private appliedFixListeners: Map<string, { close: EventListener; copy: EventListener; toggle: EventListener }> = new Map();

  // --- Listeners ---
  // REMOVED: private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

  private isQuickAuditRun: boolean = false;
  private footerSelectListener: (() => void) | null = null; // Listener for footer button

  private boundHandleEscapeKey: ((event: KeyboardEvent) => void) | null = null;

  // --- Helpers for binding methods for event listeners ---
  private boundUpdateResponse = this.updateResponse.bind(this);
  private boundRenderUserMessage = this.renderUserMessage.bind(this);
  private boundShowError = this.showError.bind(this);
  private boundFinalizeResponse = this.finalizeResponse.bind(this);
  private boundToggle = this.toggle.bind(this); // ADDED: Bound toggle method
  private boundShowFromApi = this.showFromApi.bind(this); // ADDED: Bound method for API show
  private readonly PANEL_CLOSED_BY_USER_KEY = 'checkra_panel_explicitly_closed'; // ADDED

  // ADDED: Conversation history state
  private conversationHistory: ConversationItem[] = [];

  constructor(private onToggleCallback: (isVisible: boolean) => void) {
    console.log('[FeedbackViewerImpl] Constructor called.');
    this.handleTextareaKeydown = this.handleTextareaKeydown.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleAppliedFixClose = this.handleAppliedFixClose.bind(this);
    this.handleAppliedFixCopy = this.handleAppliedFixCopy.bind(this);
    this.handleAppliedFixToggle = this.handleAppliedFixToggle.bind(this);
    this.handleMiniSelectClick = this.handleMiniSelectClick.bind(this);
    this.handleSettingsClick = this.handleSettingsClick.bind(this);
    this.boundHandleEscapeKey = this.handleEscapeKey.bind(this);
  }

  public initialize(
    domManager: FeedbackViewerDOM,
    settingsModal: SettingsModal
  ): void {
    // Get elements from domManager inside initialize
    const handleClose = () => this.hide(true, true);
    this.domElements = domManager.create(handleClose);
    this.domManager = domManager; // Store reference to DOM manager
    this.settingsModal = settingsModal;

    // ADDED: Load conversation history
    this.loadHistory();
    if (this.domManager && this.conversationHistory.length > 0) {
      this.domManager.renderFullHistory(this.conversationHistory);
    }

    // --- Setup Listeners ---
    this.domElements.promptTextarea.addEventListener('keydown', this.handleTextareaKeydown);
    this.domElements.submitButton.addEventListener('click', this.handleSubmit);

    // Add listener for mini select button
    this.domElements.miniSelectButton?.addEventListener('click', this.handleMiniSelectClick);

    // Add listener for settings button
    this.domElements.settingsButton?.addEventListener('click', this.handleSettingsClick);

    // ADDED: Subscribe to AI service events using BOUND methods
    eventEmitter.on('aiResponseChunk', this.boundUpdateResponse);
    eventEmitter.on('aiUserMessage', this.boundRenderUserMessage);
    eventEmitter.on('aiError', this.boundShowError);
    eventEmitter.on('aiFinalized', this.boundFinalizeResponse);
    eventEmitter.on('toggleViewerShortcut', this.boundToggle); // ADDED: Subscribe to toggle shortcut event
    eventEmitter.on('showViewerApi', this.boundShowFromApi); // ADDED: Listen for API show event

    console.log('[FeedbackViewerLogic] Initialized. Attaching global listeners and subscribing to AI events.');
    this.addGlobalListeners();
  }

  public cleanup(): void {
    if (!this.domElements /* REMOVED: || !this.outsideClickHandler */) return;

    // Remove general listeners
    this.domElements.promptTextarea.removeEventListener('keydown', this.handleTextareaKeydown);
    this.domElements.submitButton.removeEventListener('click', this.handleSubmit);

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

    if (this.domElements && this.footerSelectListener) {
        const footerSelectBtn = this.domElements.viewer.querySelector('#checkra-btn-footer-select-section');
        footerSelectBtn?.removeEventListener('click', this.footerSelectListener);
        this.footerSelectListener = null;
    }

    this.cleanupOnboardingListeners();
    this.isQuickAuditRun = false; // Reset flag on cleanup

    // Remove mini select listener
    this.domElements.miniSelectButton?.removeEventListener('click', this.handleMiniSelectClick);

    // ADDED: Unsubscribe from AI service events using BOUND methods
    eventEmitter.off('aiResponseChunk', this.boundUpdateResponse);
    eventEmitter.off('aiUserMessage', this.boundRenderUserMessage);
    eventEmitter.off('aiError', this.boundShowError);
    eventEmitter.off('aiFinalized', this.boundFinalizeResponse);
    eventEmitter.off('toggleViewerShortcut', this.boundToggle); // ADDED: Unsubscribe from toggle shortcut event
    eventEmitter.off('showViewerApi', this.boundShowFromApi); // ADDED: Unsubscribe from API show event

    this.domElements = null;
    this.domManager = null;
    // REMOVED: this.outsideClickHandler = null;
    this.removeGlobalListeners();

    // Optional: Clear history state if needed on full cleanup?
    // this.conversationHistory = []; 

    // ADDED: Remove highlight on cleanup
    this.removeSelectionHighlight();

    console.log('[FeedbackViewerLogic] Cleaned up listeners and unsubscribed from AI events.');
  }

  // --- Public API ---

  /**
   * Gets the current visibility state of the panel.
   */
  public getIsVisible(): boolean {
    return this.isVisible;
  }

  public prepareForInput(
    imageDataUrl: string | null,
    selectedHtml: string | null,
    targetRect: DOMRect | null,
    targetElement: Element | null
  ): void {
    console.log(`[Impl.prepareForInput] Received selectedHtml length: ${selectedHtml?.length ?? 'null'}, targetElement: ${targetElement?.tagName}`);

    if (!this.domManager || !this.domElements) {
      console.error("[FeedbackViewerLogic] Cannot prepare for input: DOM Manager or elements not initialized.");
      return;
    }

    // Store data for the NEW selection context
    this.currentImageDataUrl = imageDataUrl;
    this.initialSelectedElement = targetElement || document.body; // Fallback to body
    
    if (selectedHtml && targetElement) { 
        this.originalOuterHTMLForCurrentCycle = selectedHtml;
        console.log(`[Impl.prepareForInput] USING specific selectedHtml for ${targetElement.tagName}, length: ${selectedHtml.length}`);
    } else {
        this.originalOuterHTMLForCurrentCycle = document.body.outerHTML;
        console.log(`[Impl.prepareForInput] FALLBACK to document.body.outerHTML, length: ${this.originalOuterHTMLForCurrentCycle.length}`);
    }

    // Generate a NEW fixId for this NEW interaction cycle
    this.currentFixId = `checkra-fix-${this.fixIdCounter++}`;

    // --- ADDED: Manage Highlight --- 
    this.removeSelectionHighlight(); // Remove from previous element
    if (this.initialSelectedElement && this.initialSelectedElement !== document.body) {
        this.initialSelectedElement.classList.add('checkra-selected-element-outline');
        this.currentlyHighlightedElement = this.initialSelectedElement;
        // Add data-checkra-fix-id *after* potentially removing highlight from the previous element
        this.initialSelectedElement?.setAttribute('data-checkra-fix-id', this.currentFixId);
    } else {
        this.currentlyHighlightedElement = null; // No highlight on body
    }
    // --- END ADDED --- 

    console.log(`[FeedbackViewerLogic] Preparing for new input cycle. Assigned ID ${this.currentFixId} to ${this.initialSelectedElement?.tagName ?? 'null'}`); // Handle null element

    // Reset fix-specific state for this NEW cycle, but keep conversation history
    this.fixedOuterHTMLForCurrentCycle = null; 
    this.originalSvgsMap.clear();
    this.svgPlaceholderCounter = 0;

    // --- Update UI elements (assuming panel is already visible) ---
    this.domManager.setPromptState(true, ''); // Clear textarea for new context
    this.domManager.updateSubmitButtonState(true, 'Ask a question');
    this.domManager.updateLoaderVisibility(false);
    this.domManager.showFooterCTA(false); 

    if (this.domElements) { 
        // REMOVED: this.domManager.updatePreviewApplyButtonContent('Preview Fix', EYE_ICON_SVG);
        // REMOVED: if (this.domElements.cancelButton) { this.domElements.cancelButton.style.display = 'none'; }
    }
    
    this.domElements?.promptTextarea.focus();
    console.log('[Impl.prepareForInput] UI reset for new input context.');
  }

  public updateResponse(chunk: string): void {
    if (!this.domManager || !this.domElements) return;

    const lastItem = this.conversationHistory[this.conversationHistory.length - 1];
    if (lastItem && lastItem.type === 'ai' && lastItem.isStreaming) {
      lastItem.content += chunk;
      // Update DOM for the streaming content by calling the new DOM method
      this.domManager.updateLastAIMessage(lastItem.content, true);

      const hasHtmlCode = GENERIC_HTML_REGEX.test(lastItem.content);
      this.domManager.updateLoaderVisibility(true, hasHtmlCode ? 'Creating new version...' : 'Getting feedback...');
      this.saveHistory(); 
    } else {
      console.warn('[FeedbackViewerImpl] updateResponse called but no AI message is streaming.');
    }
  }

  public finalizeResponse(): void {
    console.log("[FeedbackViewerLogic] Feedback stream finalized.");
    if (!this.domManager || !this.domElements) return;

    const lastItem = this.conversationHistory[this.conversationHistory.length - 1];
    if (lastItem && lastItem.type === 'ai' && lastItem.isStreaming) {
      lastItem.isStreaming = false;
      this.extractAndStoreFixHtml(); 
      if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForCurrentCycle && this.currentFixId) {
        lastItem.fix = {
          originalHtml: this.originalOuterHTMLForCurrentCycle,
          fixedHtml: this.fixedOuterHTMLForCurrentCycle,
          fixId: this.currentFixId 
        };
      }
      this.saveHistory(); 
      // Update the DOM for the finalized message (no longer streaming)
      this.domManager.updateLastAIMessage(lastItem.content, false);
    } else {
      console.warn('[FeedbackViewerImpl] finalizeResponse called but no AI message was streaming or found.');
    }

    this.domManager.updateLoaderVisibility(false);
    this.domManager.setPromptState(true);
    this.domManager.updateSubmitButtonState(true, 'Ask a question');

    if (this.isQuickAuditRun) {
        this.showFooterCTALogic();
        this.isQuickAuditRun = false; // Reset flag for next interaction
    }

    // Scroll to bottom if applicable (e.g., if footer was added)
    // Optional: You might only want to scroll if the footer was *just* added
    const contentWrapper = this.domElements.contentWrapper;
    contentWrapper.scrollTop = contentWrapper.scrollHeight;

    // Apply fix if available
    if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForCurrentCycle && this.currentFixId) {
        const lastAiItem = this.conversationHistory.filter(item => item.type === 'ai').pop();
        if (lastAiItem && lastAiItem.fix) { // Ensure fix data is stored with AI message
            this.applyFixToPage(lastAiItem.fix.fixId, lastAiItem.fix.originalHtml, lastAiItem.fix.fixedHtml);
        } else {
            // Fallback or log error if fix data not found with AI message
            console.warn('[FeedbackViewerImpl] Finalized response with fix HTML, but fix data not in history item. Applying from current cycle state.');
            this.applyFixToPage(this.currentFixId, this.originalOuterHTMLForCurrentCycle, this.fixedOuterHTMLForCurrentCycle);
        }
    }
  }

  public showError(error: Error | string): void {
    if (!this.domManager) return;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[FeedbackViewerLogic] Error:", errorMessage);

    this.domManager.updateLoaderVisibility(false);
    this.domManager.setResponseContent(`<div style="color:#ff8a8a; white-space: pre-wrap;"><strong>Error:</strong> ${escapeHTML(errorMessage)}</div>`);
    this.domManager.setPromptState(true);
    this.domManager.updateSubmitButtonState(true, 'Ask a question');
    this.domManager.showPromptInputArea(true);

    this.saveHistory({ type: 'error', content: errorMessage }); // ADDED: Save error to history
  }

  public hide(initiatedByUser: boolean = true, fromCloseButton: boolean = false): void {
    if (!this.isVisible && !initiatedByUser) return; // Don't hide if already hidden, unless user forces it (e.g. from toggle)
    if (!this.domManager || !this.domElements) {
      this.isVisible = false; // Ensure state is false even if DOM elements are missing
      return;
    }

    // Hide the viewer UI
    this.domManager.hide();
    this.isVisible = false; // << SET isVisible to false
    this.onToggleCallback(false); // Notify coordinator/external

    // Reset transient state for the next cycle
    this.currentImageDataUrl = null;
    this.initialSelectedElement = null;
    this.originalOuterHTMLForCurrentCycle = null;
    this.fixedOuterHTMLForCurrentCycle = null;
    this.currentFixId = null;

    this.domManager?.showFooterCTA(false); // Add this line
    this.isQuickAuditRun = false; // Reset flag on hide

    // ADDED: Remove highlight when hiding
    this.removeSelectionHighlight();

    if (initiatedByUser && fromCloseButton) {
      console.log('[FeedbackViewerImpl] Panel hidden by user close button action. Setting flag.');
      try {
        localStorage.setItem(this.PANEL_CLOSED_BY_USER_KEY, 'true');
      } catch (e) {
        console.warn('[FeedbackViewerImpl] Failed to set localStorage item:', e);
      }
    } else if (initiatedByUser) {
      console.log('[FeedbackViewerImpl] Panel hidden by user action (not close button).');
    } else {
      console.log('[FeedbackViewerImpl] Panel hidden programmatically.');
    }
  }

  /**
   * Renders a prepended user message (e.g., warning, info) before the AI response.
   */
  public renderUserMessage(html: string): void {
      if (!this.domManager) return;
      console.log("[FeedbackViewerLogic] Rendering prepended user message.");
      this.saveHistory({ type: 'usermessage', content: html }); // ADDED: Save user message to history
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
    this.domManager.clearUserMessage();
    this.domManager.showPromptInputArea(false, promptText);

    this.saveHistory({ type: 'user', content: promptText });
    // ADDED: Immediately add a placeholder for AI response
    this.saveHistory({ type: 'ai', content: '' }); 

    // --- Call API ---
    fetchFeedback(this.currentImageDataUrl, promptText, processedHtmlForAI);
  }

  // --- Applied Fix Button Handlers --- (These remain for already applied fixes)
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
      // Get the content from the latest AI message
      const lastAiItem = this.conversationHistory.filter(item => item.type === 'ai').pop();
      if (!lastAiItem || !lastAiItem.content) {
          console.log('[FeedbackViewerLogic] extractAndStoreFixHtml: No AI message content found in history to extract from.');
          this.fixedOuterHTMLForCurrentCycle = null; // Ensure reset if no content
          // No need to call updateActionButtonsVisibility here, finalizeResponse will handle it
          return;
      }
      const responseText = lastAiItem.content;

    let match = responseText.match(SPECIFIC_HTML_REGEX);
    if (!match) {
      match = responseText.match(GENERIC_HTML_REGEX);
    }

    if (match && match[1]) {
      let extractedHtml = match[1].trim();
      console.log('[FeedbackViewerLogic] Regex matched HTML from AI response history.');

      try {
        extractedHtml = this.postprocessHtmlFromAI(extractedHtml);
              const tempFragment = this.createFragmentFromHTML(extractedHtml);
              if (tempFragment && tempFragment.childNodes.length > 0) {
                  // Store the latest fix details. These are used when clicking preview/apply.
                  this.fixedOuterHTMLForCurrentCycle = extractedHtml;
                  // We also need the original HTML and the ID that this fix corresponds to.
                  // This should ideally be stored with the AI message itself if possible,
                  // or we assume it relates to the last `prepareForInput` context.
                  console.log(`[FeedbackViewerLogic] Stored latest fixed HTML proposal.`);
              } else {
                   console.warn('[FeedbackViewerLogic] Failed to parse extracted HTML into a valid, non-empty fragment. Fix may not be applicable.');
                   this.fixedOuterHTMLForCurrentCycle = null;
              }
          } catch (e) {
              console.error('[FeedbackViewerLogic] Error postprocessing/validating HTML from AI:', e);
              this.fixedOuterHTMLForCurrentCycle = null;
          }
      } else {
         // Check if the message stream has finished (isStreaming is false)
         if (!lastAiItem.isStreaming && !GENERIC_HTML_REGEX.test(responseText)) {
              console.log('[FeedbackViewerLogic] No HTML block found in the final AI response history item.');
         }
         // Ensure fixed HTML is null if no match
         this.fixedOuterHTMLForCurrentCycle = null;
      }
      // REMOVED: this.updateActionButtonsVisibility(); // Let finalizeResponse handle this
  }

  // --- ADDED: New method to directly apply the fix to the page --- 
  private applyFixToPage(fixId: string, originalHtml: string, fixedHtml: string): void {
    console.log(`[FeedbackViewerLogic] Applying fix directly to page for Fix ID: ${fixId}`);
    if (!this.domManager || !this.domElements) {
      console.warn('[FeedbackViewerLogic] Cannot apply fix: Missing DOM Manager or elements.');
      return;
    }

    try {
        // Find the original element. It should still have the data-checkra-fix-id attribute
        // if this is the first time applying this specific fix, or we need a way to re-target it.
        // For simplicity, assume the ID is still on the original element if it hasn't been wrapped yet.
        let elementToReplace = document.querySelector(`[data-checkra-fix-id="${fixId}"]`);
        let insertionParent: Node | null = null;
        let insertionBeforeNode: Node | null = null;

        if (elementToReplace) {
            if (!elementToReplace.parentNode) {
                 throw new Error(`Original element with ID ${fixId} has no parent node.`);
            }
            insertionParent = elementToReplace.parentNode;
            insertionBeforeNode = elementToReplace.nextSibling;
            elementToReplace.remove(); // Remove the original element before inserting wrapper
        } else {
            // This case is problematic. If the original element is gone (e.g. due to previous UI updates, or if this is a re-apply)
            // we need a robust way to find where to insert it. This was handled by previewInsertionParent before.
            // For now, if elementToReplace is not found, we cannot proceed reliably. This needs more thought for re-application scenarios.
            console.error(`[FeedbackViewerLogic] Original element with ID ${fixId} not found. Cannot apply fix.`);
            // Attempt to show an error to the user, perhaps in the panel?
            this.showError(`Failed to apply fix: Original target element for fix ${fixId} not found.`);
            return;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'checkra-feedback-applied-fix checkra-fix-fade-in'; // ADD fade-in class
        wrapper.setAttribute('data-checkra-fix-id', fixId);

        const contentContainer = document.createElement('div');
        contentContainer.className = 'checkra-applied-fix-content';
        const fixedContentFragment = this.createFragmentFromHTML(fixedHtml);
        if (!fixedContentFragment || fixedContentFragment.childNodes.length === 0) {
            throw new Error('Failed to parse fixed HTML for content container fragment.');
        }
        contentContainer.appendChild(fixedContentFragment);
        wrapper.appendChild(contentContainer);

        const closeBtn = this.createAppliedFixButton('close', fixId);
        const copyBtn = this.createAppliedFixButton('copy', fixId);
        const toggleBtn = this.createAppliedFixButton('toggle', fixId);
        wrapper.appendChild(closeBtn);
        wrapper.appendChild(copyBtn);
        wrapper.appendChild(toggleBtn);

        insertionParent.insertBefore(wrapper, insertionBeforeNode);
        console.log(`[FeedbackViewerLogic] Inserted permanent wrapper for ${fixId}.`);

        const fixInfo: AppliedFixInfo = {
            originalElementId: fixId,
            originalOuterHTML: originalHtml,
            fixedOuterHTML: fixedHtml,
            appliedWrapperElement: wrapper,
            isCurrentlyFixed: true
        };
        this.appliedFixes.set(fixId, fixInfo);
        console.log(`[FeedbackViewerLogic] Stored applied fix info for ${fixId}`);

        const listeners = {
            close: (e: Event) => this.handleAppliedFixClose(fixId, e),
            copy: (e: Event) => this.handleAppliedFixCopy(fixId, e),
            toggle: (e: Event) => this.handleAppliedFixToggle(fixId, e)
        };
        this.appliedFixListeners.set(fixId, listeners);
        closeBtn.addEventListener('click', listeners.close);
        copyBtn.addEventListener('click', listeners.copy);
        toggleBtn.addEventListener('click', listeners.toggle);

        // After successful application, clear the current cycle's fix proposal
        // to prevent re-application on next finalizeResponse without new AI feedback.
        this.fixedOuterHTMLForCurrentCycle = null; 
        // The currentFixId and originalOuterHTMLForCurrentCycle remain as they define the *current context*.

        // Optionally, clear the main prompt and AI response area in the panel after successful application.
        // this.domManager?.setPromptState(true, '');
        // this.domManager?.clearAIResponseContent(); 
        // Consider what should happen in the panel UI after this.

    } catch (error) {
        console.error('[FeedbackViewerLogic] Error applying fix directly to page:', error);
        this.showError(`Failed to apply fix: ${error instanceof Error ? error.message : String(error)}`);
        // If elementToReplace was found and removed, but wrapper insertion failed, we need to restore original.
        // This is complex. For now, an error is shown. A more robust undo for failed apply would be needed.
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

  /**
   * Toggles the visibility of the feedback viewer.
   * Assumes initialization is handled by the coordinator.
   */
  public toggle(): void {
    if (this.isVisible) { // Use the private property
      this.hide(true, false); // User initiated hide via toggle (not from close button)
    } else {
      this.showFromApi(); // MODIFIED: Consolidate show logic
    }
  }

  /**
   * Shows the onboarding state.
   * Assumes initialization is handled by the coordinator.
   */
  public showOnboarding(): void {
    if (!this.domManager || !this.domElements) {
      console.error("[FeedbackViewerLogic] Cannot show onboarding: DOM Manager or elements not initialized.");
      return;
    }
    this.domManager.showOnboardingView(true);
    this.domManager.showPromptInputArea(false);
    this.domManager.clearAIResponseContent();
    this.domManager.updateLoaderVisibility(false);
    this.domManager.show(); // This makes the panel visible
    this.isVisible = true; // << SET isVisible to true
    this.onToggleCallback(true); // Notify coordinator/external
    console.log('[FeedbackViewerLogic] Showing onboarding.');

    const runAuditBtn = this.domElements.viewer.querySelector('#checkra-btn-run-audit');
    const selectSectionBtn = this.domElements.viewer.querySelector('#checkra-btn-select-section');

    // Add listeners only if buttons exist
    if (runAuditBtn && selectSectionBtn) {
        runAuditBtn.addEventListener('click', this.handleOnboardingRunAudit);
        selectSectionBtn.addEventListener('click', this.handleOnboardingSelectSection);

        this.onboardingListeners = {
            runAudit: this.handleOnboardingRunAudit,
            selectSection: this.handleOnboardingSelectSection
        };

        localStorage.setItem('checkra_onboarded', '1');
    } else {
        console.error('[FeedbackViewerLogic] Could not find onboarding buttons to attach listeners.');
    }
  }

  private handleOnboardingRunAudit = (): void => {
    console.log('[FeedbackViewerLogic] Onboarding: Run Audit clicked.');
    this.cleanupOnboardingListeners();
    if (this.domManager) {
        this.domManager.showOnboardingView(false);
    }
    this.quickAudit();
  }

  private handleOnboardingSelectSection = (): void => {
    console.log('[FeedbackViewerLogic] Onboarding: Select Section clicked.');
    this.isQuickAuditRun = false; // Ensure flag is false before starting selection
    this.cleanupOnboardingListeners();
    if (this.domManager) {
        this.domManager.showOnboardingView(false); // Hide onboarding UI
        this.domManager.showPromptInputArea(true); // Show normal prompt area
    }
    // Panel should remain open. Screen capture will overlay.
    if (this.domElements?.viewer) {
      screenCapture.startCapture(
        this.prepareForInput.bind(this),
        this.domElements.viewer // Pass the panel element to ignore
      );
    } else {
      console.error('[FeedbackViewerImpl] Cannot start screen capture from onboarding: domElements.viewer is not available.');
    }
  }

  // Helper to remove onboarding listeners
  private cleanupOnboardingListeners(): void {
    if (this.domElements && this.onboardingListeners) {
        const runAuditBtn = this.domElements.viewer.querySelector('#checkra-btn-run-audit');
        const selectSectionBtn = this.domElements.viewer.querySelector('#checkra-btn-select-section');
        runAuditBtn?.removeEventListener('click', this.onboardingListeners.runAudit);
        selectSectionBtn?.removeEventListener('click', this.onboardingListeners.selectSection);
        this.onboardingListeners = null; // Clear stored listeners
    }
  }

  // Add a placeholder for the quickAudit function
  private quickAudit(): void {
    console.log('[FeedbackViewerLogic] Starting Quick Audit...');
    if (!this.domManager) {
        this.showError('Cannot run quick audit: DOM Manager not available.');
        return;
    }

    try {
      // 1. Collect head data
      const headData = getHeadMetadata();
      const headHtml = `<head>
  <title>${headData.title || ''}</title>
  <meta name="description" content="${headData.description || ''}">
  <meta property="og:title" content="${headData.ogTitle || ''}">
  <meta property="og:description" content="${headData.ogDescription || ''}">
  <meta name="viewport" content="${headData.viewport || ''}">
  <link rel="canonical" href="${headData.canonical || ''}">
</head>`;

      // 2. Collect above-the-fold HTML
      const fold = window.innerHeight;
      const bodyChildren = Array.from(document.body.children);
      const topLevelElementsInFold = bodyChildren.filter(el => {
          if (!(el instanceof HTMLElement)) return false;
          try {
              const rect = el.getBoundingClientRect();
              // Include elements starting above the fold or partially visible
              return rect.top < fold && rect.bottom > 0;
          } catch (e) {
              console.warn('[QuickAudit] Error getting bounding rect for element:', el, e);
              return false;
          }
      });

      // Include first H1 and first interactive element if possible and not already included
      let firstH1: Element | null = document.querySelector('h1');
      let firstCTA: Element | null = document.querySelector('button, a[role="button"], input[type="submit"]');

      const elementsToInclude = [...topLevelElementsInFold];
      if (firstH1 && !elementsToInclude.some(el => el.contains(firstH1))) {
          elementsToInclude.push(firstH1);
      }
      if (firstCTA && !elementsToInclude.some(el => el.contains(firstCTA))) {
          elementsToInclude.push(firstCTA);
      }

      let aboveFoldHtml = elementsToInclude
          .map(el => el.outerHTML)
          .join('\n<!-- Checkra Element Separator -->\n');

      // Limit size (e.g., 8KB)
      const MAX_HTML_LENGTH = 8 * 1024;
      if (aboveFoldHtml.length > MAX_HTML_LENGTH) {
          console.warn(`[QuickAudit] Above-fold HTML truncated from ${aboveFoldHtml.length} to ${MAX_HTML_LENGTH} bytes.`);
          aboveFoldHtml = aboveFoldHtml.substring(0, MAX_HTML_LENGTH);
          // Try to avoid cutting mid-tag
          const lastTagClose = aboveFoldHtml.lastIndexOf('>');
          if (lastTagClose > 0) {
            aboveFoldHtml = aboveFoldHtml.substring(0, lastTagClose + 1);
          }
      }

      // Combine head and body snippets
      const combinedHtml = `${headHtml}

<body>
${aboveFoldHtml}
</body>`;

      // 3. Compose prompt
      const prompt = "Quick audit of head tags and above-the-fold section. Provide SEO/CRO recommendations for <head> as a bullet list (no previews). Provide at least two previewable HTML fixes for the <body> content if issues are found.";

      // --- Update UI for Loading --- 
      this.domManager.setPromptState(false); // Disable prompt area during audit
      this.domManager.updateSubmitButtonState(false, 'Auditing...');
      this.domManager.updateLoaderVisibility(true, 'Running quick audit...'); // This will show the header
      this.domManager.clearUserMessage();
      this.domManager.showPromptInputArea(false, 'Running Quick Audit...'); // Show title

      // Set flag right before fetch
      this.isQuickAuditRun = true;

      // 4. Call fetchAudit
      console.log('[QuickAudit] Sending request...');
      fetchAudit(prompt, combinedHtml);

    } catch (error) {
        console.error('[QuickAudit] Error preparing or running audit:', error);
        this.isQuickAuditRun = false; // Reset flag on error
        this.showError(`Failed to run quick audit: ${error instanceof Error ? error.message : String(error)}`);
        // Reset UI state on error
        if (this.domManager) {
            this.domManager.setPromptState(true);
            this.domManager.updateSubmitButtonState(true, 'Ask a question');
            this.domManager.updateLoaderVisibility(false);
        }
    }
  }

  // Need to add onboardingListeners property to the class
  private onboardingListeners: { runAudit: () => void; selectSection: () => void; } | null = null;

  private showFooterCTALogic(): void {
    if (!this.domManager || !this.domElements?.footerCTAContainer) return;

    this.domManager.showFooterCTA(true);

    const footerSelectBtn = this.domElements.viewer.querySelector('#checkra-btn-footer-select-section');

    // Remove any previous listener first
    if (this.footerSelectListener && footerSelectBtn) {
        footerSelectBtn.removeEventListener('click', this.footerSelectListener);
    }

    // Define the new listener
    this.footerSelectListener = () => {
        console.log('[FeedbackViewerLogic] Footer Select Section clicked.');
        this.domManager?.showFooterCTA(false); // Hide footer
        this.hide(); // Hide panel temporarily
        if (this.domElements?.viewer) {
          screenCapture.startCapture(
              (imageDataUrl: string | null, selectedHtml: string | null, bounds: DOMRect | null, targetElement: Element | null) => {
                  if (targetElement) {
                      console.log('[FeedbackViewerLogic] Section selected via footer CTA.');
                      this.prepareForInput(imageDataUrl, selectedHtml, bounds, targetElement);
                  } else {
                      console.log('[FeedbackViewerLogic] Section selection cancelled after footer CTA.');
                      this.domManager?.showFooterCTA(true);
                  }
              },
              this.domElements.viewer // Pass the panel element to ignore
          );
        } else {
            console.error('[FeedbackViewerImpl] Cannot start screen capture from footer: domElements.viewer is not available.');
        }
    };

    // Add the new listener
    if (footerSelectBtn) {
        footerSelectBtn.addEventListener('click', this.footerSelectListener);
    }
  }

  // Handler for the mini select button click
  private handleMiniSelectClick(e: MouseEvent): void {
    e.stopPropagation(); // Prevent triggering other clicks
    console.log('[FeedbackViewerLogic] Mini select (crosshair) button clicked.');
    this.isQuickAuditRun = false; // Ensure not in audit mode

    // Trigger screen capture, passing the main viewer element to be ignored
    if (this.domElements?.viewer) {
      screenCapture.startCapture(
        this.prepareForInput.bind(this), // Pass the bound method
        this.domElements.viewer // Pass the panel element to ignore
      );
    } else {
      console.error('[FeedbackViewerImpl] Cannot start screen capture: domElements.viewer is not available.');
    }
  }

  private handleSettingsClick(): void {
    console.log('[FeedbackViewerLogic] Settings button clicked.');
    if (this.settingsModal) {
      this.settingsModal.showModal();
    } else {
      console.error('[FeedbackViewerLogic] SettingsModal instance is not available.');
    }
  }

  private handleEscapeKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.isVisible) { // Use the private property
      console.log('[FeedbackViewerImpl] Escape key pressed.');
      this.hide(true, false); // User initiated hide via Escape, not fromCloseButton
    }
  }

  private addGlobalListeners(): void {
    if (this.boundHandleEscapeKey) {
        document.addEventListener('keydown', this.boundHandleEscapeKey);
        console.log('[FeedbackViewerImpl] Added escape keydown listener.');
    }
    // Add outside click listener here if not added elsewhere
    // REMOVED: if (this.outsideClickHandler) { ... }
  }

  private removeGlobalListeners(): void {
    if (this.boundHandleEscapeKey) {
        document.removeEventListener('keydown', this.boundHandleEscapeKey);
        console.log('[FeedbackViewerImpl] Removed escape keydown listener.');
    }
    // Remove outside click listener here
    // REMOVED: if (this.outsideClickHandler) { ... }
  }

  // ADDED: New method to handle showing the panel, clearing the flag
  private showFromApi(): void {
    if (this.isVisible) return; // Already visible

    try {
      localStorage.removeItem(this.PANEL_CLOSED_BY_USER_KEY);
      console.log('[FeedbackViewerImpl] Panel opening via API/toggle, removed explicit close flag.');
    } catch (e) {
      console.warn('[FeedbackViewerImpl] Failed to remove localStorage item:', e);
    }

    // --- Show the panel FIRST ---
    if (!this.domManager) {
        console.error("[FeedbackViewerImpl] Cannot show panel: DOM Manager not initialized.");
        return;
    }
    this.domManager.show(); // Make the panel visible via DOM Manager
    this.isVisible = true;    // Update internal state
    this.onToggleCallback(true); // Notify coordinator
    console.log('[FeedbackViewerImpl] Panel shown via showFromApi.');
    // --- End Show Panel ---

    const firstRun = !localStorage.getItem('checkra_onboarded');
    if (firstRun) {
      this.showOnboarding(); // This might call domManager.show() again, should be okay
    } else {
      // Panel is now visible, prepare the default input state (body)
      console.log('[FeedbackViewerImpl] showFromApi preparing default input state (body).');
      this.prepareForInput(null, null, null, document.body); // Pass body explicitly
    }
  }

  // ADDED: Methods for loading and saving history
  private loadHistory(): void {
    try {
      const storedHistory = localStorage.getItem(CONVERSATION_HISTORY_KEY);
      if (storedHistory) {
        const parsedHistory = JSON.parse(storedHistory) as ConversationItem[];
        // Ensure loaded items have isStreaming set to false for past AI messages
        this.conversationHistory = parsedHistory.map(item => {
          if (item.type === 'ai') {
            return { ...item, isStreaming: false };
          }
          return item;
        });
        console.log(`[FeedbackViewerImpl] Loaded ${this.conversationHistory.length} items from history.`);
        // TODO: Add call to domManager to render this history
      } else {
        this.conversationHistory = [];
      }
    } catch (e) {
      console.error('[FeedbackViewerImpl] Failed to load or parse conversation history:', e);
      this.conversationHistory = []; // Start fresh on error
      localStorage.removeItem(CONVERSATION_HISTORY_KEY); // Clear corrupted data
    }
  }

  private saveHistory(newItem?: ConversationItem): void { // Made newItem optional
    if (newItem) {
      if (newItem.type === 'ai') {
        newItem.isStreaming = true; // New AI messages start streaming
        // newItem.content = ''; // Content will be provided or start empty
      }
      this.conversationHistory.push(newItem);
    }
    try {
      // Always save the full history state when called
      localStorage.setItem(CONVERSATION_HISTORY_KEY, JSON.stringify(this.conversationHistory));
      console.log(`[FeedbackViewerImpl] Saved/Updated history. Total items: ${this.conversationHistory.length}`);
    } catch (e) {
      console.error('[FeedbackViewerImpl] Failed to save conversation history:', e);
    }
    
    // Trigger DOM update ONLY if a NEW item was added
    if(this.domManager && newItem) { 
       this.domManager.appendHistoryItem(newItem);
    } else if (this.domManager) {
        // If newItem is null, it means an update happened in updateResponse/finalizeResponse.
        // Those methods are now responsible for calling domManager.updateLastAIMessage directly.
        // So, no DOM update needed here when newItem is null.
    }
  }

  // --- ADDED: Helper to remove highlight --- 
  private removeSelectionHighlight(): void {
      if (this.currentlyHighlightedElement) {
          this.currentlyHighlightedElement.classList.remove('checkra-selected-element-outline');
          this.currentlyHighlightedElement = null;
          console.log('[FeedbackViewerLogic] Removed selection highlight.');
      }
  }
}