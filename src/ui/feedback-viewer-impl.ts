import { fetchFeedback } from '../services/ai-service';
import type { FeedbackViewerElements } from './feedback-viewer-dom';
import type { FeedbackViewerDOM } from './feedback-viewer-dom';
import { screenCapture } from './screen-capture';
import type { SettingsModal } from './settings-modal';
import { eventEmitter } from '../core/index';
import { generateStableSelector } from '../utils/selector-utils';
import { API_BASE, CDN_DOMAIN } from '../config';
import { getSiteId } from '../utils/id'; 

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
const DISPLAY_FIX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
const HIDE_FIX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-off-icon lucide-eye-off"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>`;

// --- Interface for Applied Fix Data ---
interface AppliedFixInfo {
  originalElementId: string; // Unique ID assigned to the element (session-specific data-checkra-fix-id)
  originalOuterHTML: string; // Store the full outerHTML (might represent multiple siblings)
  fixedOuterHTML: string; // Store the full outerHTML suggested by AI (might represent multiple siblings)
  appliedWrapperElement: HTMLDivElement | null; // Reference to the '.checkra-feedback-applied-fix' wrapper
  isCurrentlyFixed: boolean; // Tracks if the displayed version in the wrapper is the fix
  stableTargetSelector: string; // ADDED: A stable selector for the original element
}

/**
 * Handles the logic, state, and interactions for the feedback viewer.
 */
export class FeedbackViewerImpl {
  private domElements: FeedbackViewerElements | null = null;
  private domManager: FeedbackViewerDOM | null = null;
  private settingsModal: SettingsModal | null = null;
  private optionsInitialVisibility: boolean; // To store the initial visibility from options

  // --- State ---
  private isVisible: boolean = false;
  private currentImageDataUrl: string | null = null;
  private initialSelectedElement: Element | null = null; // The element *initially* selected by the user for the cycle
  private currentlyHighlightedElement: Element | null = null; // << ADDED: Track element with outline
  private originalOuterHTMLForCurrentCycle: string | null = null; // Store the initial HTML of the selected element
  private fixedOuterHTMLForCurrentCycle: string | null = null; // Store the AI's suggested HTML (could be multiple elements)
  private currentFixId: string | null = null; // Unique ID for the element being worked on
  private stableSelectorForCurrentCycle: string | null = null; // ADDED: Stable selector for the current cycle
  private fixIdCounter: number = 0; // Counter for generating unique IDs
  private originalSvgsMap: Map<string, string> = new Map();
  private svgPlaceholderCounter: number = 0;
  private activeStreamingAiItem: ConversationItem | null = null; // ADDED: To track the current AI message being streamed

  // --- Global Tracking for Applied Fixes ---
  private appliedFixes: Map<string, AppliedFixInfo> = new Map();
  // Store listeners for applied fixes to clean them up later
  private appliedFixListeners: Map<string, { close: EventListener; toggle: EventListener }> = new Map();

  // --- Listeners ---

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
  private conversationHistory: ConversationItem[] = [];
  private boundHandleImageGenerationStart = this.handleImageGenerationStart.bind(this);

  constructor(
    private onToggleCallback: (isVisible: boolean) => void,
    initialVisibilityFromOptions: boolean = false // New parameter
  ) {
    console.log(`[FeedbackViewerImpl] Constructor called with initialVisibilityFromOptions: ${initialVisibilityFromOptions}`);
    this.optionsInitialVisibility = initialVisibilityFromOptions;
    // Bind methods
    this.handleTextareaKeydown = this.handleTextareaKeydown.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleAppliedFixClose = this.handleAppliedFixClose.bind(this);
    this.handleAppliedFixToggle = this.handleAppliedFixToggle.bind(this);
    this.handleMiniSelectClick = this.handleMiniSelectClick.bind(this);
    this.handleSettingsClick = this.handleSettingsClick.bind(this);
    this.boundHandleEscapeKey = this.handleEscapeKey.bind(this);
    this.boundUpdateResponse = this.updateResponse.bind(this);
    this.boundRenderUserMessage = this.renderUserMessage.bind(this);
    this.boundShowError = this.showError.bind(this);
    this.boundFinalizeResponse = this.finalizeResponse.bind(this);
    this.boundHandleImageGenerationStart = this.handleImageGenerationStart.bind(this);
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
    eventEmitter.on('aiResponseChunk', this.boundUpdateResponse);
    eventEmitter.on('aiUserMessage', this.boundRenderUserMessage);
    eventEmitter.on('aiError', this.boundShowError);
    eventEmitter.on('aiFinalized', this.boundFinalizeResponse);
    eventEmitter.on('toggleViewerShortcut', this.boundToggle); // ADDED: Subscribe to toggle shortcut event
    eventEmitter.on('showViewerApi', this.boundShowFromApi); // ADDED: Listen for API show event
    eventEmitter.on('aiImageGenerationStart', this.boundHandleImageGenerationStart);

    // Add event listener for stats badges clicks (delegated to responseContent)
    this.domElements.responseContent.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.classList.contains('checkra-stat-badge') && target.dataset.queryname) {
        this.fetchAndDisplayStats(target.dataset.queryname);
      }
    });

    console.log('[FeedbackViewerLogic] Initialized. Attaching global listeners and subscribing to AI events.');
    this.addGlobalListeners();

    // --- Initial Visibility Logic --- 
    const panelWasClosedByUser = localStorage.getItem(this.PANEL_CLOSED_BY_USER_KEY) === 'true';
    console.log(`[FeedbackViewerImpl] Initializing visibility. OptionsInitial: ${this.optionsInitialVisibility}, PanelClosedByUser: ${panelWasClosedByUser}`);

    if (this.optionsInitialVisibility && !panelWasClosedByUser) {
      console.log('[FeedbackViewerImpl] Initial visibility is true and panel was not closed by user. Showing panel.');
      this.showFromApi(false); // Show programmatically, don't mark as user action for clearing flags
    } else {
      // Panel is intended to be hidden or was closed by user.
      // Ensure it's hidden if not already (though DOM manager likely handles this by not calling .show())
      if (this.isVisible) {
        this.hide(false); // Programmatic hide if somehow visible
      }
      console.log(`[FeedbackViewerImpl] Initial visibility is false or panel was closed by user (${panelWasClosedByUser}). Panel remains hidden.`);
      // Show availability toast if panel is hidden and toast not shown this session
      // Ensure this.domManager is checked, and also this.isVisible before showing toast.
      if (this.domManager && !this.isVisible && !sessionStorage.getItem('checkra_toast_shown_session')) {
        setTimeout(() => { // setTimeout to allow other UI updates to settle
          if (this.domManager && !this.isVisible) { // Double check, state might change rapidly
             this.domManager.showAvailabilityToast();
             sessionStorage.setItem('checkra_toast_shown_session', 'true');
          }
        }, 250); 
      }
    }
    eventEmitter.emit('feedbackViewerImplReady'); // Emit event after all initialization
  }

  public cleanup(): void {
    if (!this.domElements) return;

    // Remove general listeners
    this.domElements.promptTextarea.removeEventListener('keydown', this.handleTextareaKeydown);
    this.domElements.submitButton.removeEventListener('click', this.handleSubmit);

    // --- Clean up listeners on applied fixes ---
    this.appliedFixListeners.forEach((listeners, fixId) => {
      const fixInfo = this.appliedFixes.get(fixId);
      if (fixInfo?.appliedWrapperElement) {
        const closeBtn = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-close-btn');
        const toggleBtn = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-toggle');
        closeBtn?.removeEventListener('click', listeners.close);
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

    // Remove mini select listener
    this.domElements.miniSelectButton?.removeEventListener('click', this.handleMiniSelectClick);
    eventEmitter.off('aiResponseChunk', this.boundUpdateResponse);
    eventEmitter.off('aiUserMessage', this.boundRenderUserMessage);
    eventEmitter.off('aiError', this.boundShowError);
    eventEmitter.off('aiFinalized', this.boundFinalizeResponse);
    eventEmitter.off('toggleViewerShortcut', this.boundToggle); // ADDED: Unsubscribe from toggle shortcut event
    eventEmitter.off('showViewerApi', this.boundShowFromApi); // ADDED: Unsubscribe from API show event
    eventEmitter.off('aiImageGenerationStart', this.boundHandleImageGenerationStart);

    this.domElements = null;
    this.domManager = null;
    this.removeGlobalListeners();

    // Optional: Clear history state if needed on full cleanup?
    // this.conversationHistory = []; 
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

    this.currentImageDataUrl = imageDataUrl;
    this.initialSelectedElement = targetElement; 

    const isElementSelected = !!(targetElement && targetElement !== document.body); // Ensure boolean

    if (isElementSelected && targetElement) { // Added targetElement check for type safety
      this.stableSelectorForCurrentCycle = generateStableSelector(targetElement);
      console.log(`[Impl.prepareForInput] Generated stable selector for ${targetElement.tagName}: ${this.stableSelectorForCurrentCycle}`);
      this.originalOuterHTMLForCurrentCycle = selectedHtml; // Should only be set if an element is truly selected
      console.log(`[Impl.prepareForInput] USING specific selectedHtml for ${targetElement.tagName}, length: ${selectedHtml?.length}`);
    } else {
      // Handles null targetElement or document.body selection
      this.stableSelectorForCurrentCycle = 'body';
      this.originalOuterHTMLForCurrentCycle = document.body.outerHTML; // Fallback or default context
      console.log(`[Impl.prepareForInput] No specific element selected or body selected. Defaulting context. Target: ${targetElement?.tagName}`);
      if (targetElement === document.body) {
        this.initialSelectedElement = document.body; // Explicitly set for clarity if it was body
      }
    }

    // Generate a NEW fixId for this NEW interaction cycle
    this.currentFixId = `checkra-fix-${this.fixIdCounter++}`;
    this.removeSelectionHighlight(); // Remove from previous element

    if (isElementSelected && targetElement) { // Ensure targetElement is not null here
      targetElement.classList.add('checkra-selected-element-outline');
      this.currentlyHighlightedElement = targetElement;
      targetElement.setAttribute('data-checkra-fix-id', this.currentFixId);
    } else {
      this.currentlyHighlightedElement = null; // No highlight on body or if no selection
    }

    console.log(`[FeedbackViewerLogic] Preparing for new input cycle. Assigned ID ${this.currentFixId} to ${this.initialSelectedElement?.tagName ?? 'null'}`);

    // Reset fix-specific state for this NEW cycle
    this.fixedOuterHTMLForCurrentCycle = null;
    this.originalSvgsMap.clear();
    this.svgPlaceholderCounter = 0;

    // --- Update UI elements --- 
    this.domManager.setPromptState(true, '');
    this.domManager.updateSubmitButtonState(isElementSelected);
    if (!isElementSelected) {
      if (this.domElements) this.domElements.promptTextarea.placeholder = 'Please select an element on the page to provide feedback.';
    } else {
      if (this.domElements) this.domElements.promptTextarea.placeholder = 'e.g., "How can I improve the UX or conversion of this section?"';
    }

    this.domManager.updateLoaderVisibility(false);
    this.domManager.showFooterCTA(false);

    if (this.domElements) { }

    this.domElements?.promptTextarea.focus();
    console.log('[Impl.prepareForInput] UI reset for new input context.');
  }

  public updateResponse(chunk: string): void {
    if (!this.domManager || !this.domElements) return;

    const currentStreamItem = this.activeStreamingAiItem;

    if (currentStreamItem) {
      console.log(`[FeedbackViewerImpl DEBUG] updateResponse: Checking currentStreamItem. Type: ${currentStreamItem.type}, Streaming: ${currentStreamItem.isStreaming}, ContentLen: ${currentStreamItem.content?.length}`);
    } else {
      console.log('[FeedbackViewerImpl DEBUG] updateResponse: activeStreamingAiItem is null.');
      const lastItemInHistory = this.conversationHistory.length > 0 ? this.conversationHistory[this.conversationHistory.length - 1] : null;
      console.warn(`[FeedbackViewerImpl] updateResponse: activeStreamingAiItem is null. Last item in history: ${lastItemInHistory?.type}, streaming: ${lastItemInHistory?.isStreaming}`);
      return;
    }

    if (currentStreamItem.type === 'ai' && currentStreamItem.isStreaming) {
      currentStreamItem.content += chunk;
      this.domManager.updateLastAIMessage(currentStreamItem.content, true);

      const hasHtmlCode = GENERIC_HTML_REGEX.test(currentStreamItem.content);
      this.domManager.showImageGenerationStatus(false);
      this.domManager.updateLoaderVisibility(true, hasHtmlCode ? 'Creating new version...' : 'Loading...');
    } else {
      console.warn(`[FeedbackViewerImpl] updateResponse called but currentStreamItem (activeStreamingAiItem) is not an AI message or not streaming. Type: ${currentStreamItem.type}, Streaming: ${currentStreamItem.isStreaming}`);
    }
  }

  public finalizeResponse(): void {
    console.log("[FeedbackViewerLogic] Feedback stream finalized.");
    if (!this.domManager || !this.domElements) return;

    const streamToFinalize = this.activeStreamingAiItem;

    if (streamToFinalize && streamToFinalize.type === 'ai' && streamToFinalize.isStreaming) {
      console.log("[FeedbackViewerImpl DEBUG] finalizeResponse: Finalizing activeStreamingAiItem.");
      streamToFinalize.isStreaming = false;
      this.extractAndStoreFixHtml();
      
      if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForCurrentCycle && this.currentFixId) {
        streamToFinalize.fix = {
          originalHtml: this.originalOuterHTMLForCurrentCycle,
          fixedHtml: this.fixedOuterHTMLForCurrentCycle,
          fixId: this.currentFixId
        };
      }
      this.saveHistory();
      this.domManager.updateLastAIMessage(streamToFinalize.content, false);
      this.activeStreamingAiItem = null;
      console.log("[FeedbackViewerImpl DEBUG] finalizeResponse: Cleared activeStreamingAiItem.");
    } else {
      console.warn(`[FeedbackViewerImpl] finalizeResponse called but no active AI message was streaming or found. Active item state: type=${streamToFinalize?.type}, streaming=${streamToFinalize?.isStreaming}`);
      const lastHistoryAI = [...this.conversationHistory].reverse().find(item => item.type === 'ai' && item.isStreaming);
      if (lastHistoryAI) {
        console.warn("[FeedbackViewerImpl DEBUG] finalizeResponse: Fallback - found a different streaming AI item in history. Finalizing it.", lastHistoryAI);
        lastHistoryAI.isStreaming = false;
        this.extractAndStoreFixHtml();
        this.saveHistory();
        this.domManager.updateLastAIMessage(lastHistoryAI.content, false);
      } else {
         console.warn("[FeedbackViewerImpl DEBUG] finalizeResponse: Fallback - no streaming AI item found in history either.");
      }
      this.activeStreamingAiItem = null;
    }

    this.domManager.updateLoaderVisibility(false);
    this.domManager.setPromptState(true);
    this.domManager.updateSubmitButtonState(true);
    this.domManager.showImageGenerationStatus(false);

    const contentWrapper = this.domElements.contentWrapper;
    contentWrapper.scrollTop = contentWrapper.scrollHeight;

    if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForCurrentCycle && this.currentFixId) {
      const lastAiItem = this.conversationHistory.filter(item => item.type === 'ai').pop();
      if (lastAiItem && lastAiItem.fix) {
        this.applyFixToPage(lastAiItem.fix.fixId, lastAiItem.fix.originalHtml, lastAiItem.fix.fixedHtml, this.stableSelectorForCurrentCycle || undefined);
      } else {
        console.warn('[FeedbackViewerImpl] Finalized response with fix HTML, but fix data not in history item. Applying from current cycle state.');
        if (this.currentFixId && this.originalOuterHTMLForCurrentCycle && this.fixedOuterHTMLForCurrentCycle && this.stableSelectorForCurrentCycle) {
          this.applyFixToPage(this.currentFixId, this.originalOuterHTMLForCurrentCycle, this.fixedOuterHTMLForCurrentCycle, this.stableSelectorForCurrentCycle || undefined);
        } else {
          console.error('[FeedbackViewerImpl] Cannot apply fix from current cycle state: Missing required data (fixId, originalHTML, fixedHTML, or stableSelector).');
        }
      }
    }
  }

  public showError(error: Error | string): void {
    if (!this.domManager || !this.domElements) return; // Guard
    const errorMessage = error instanceof Error ? error.message : error;
    const errorItem: ConversationItem = { type: 'error', content: errorMessage };
    this.conversationHistory.push(errorItem);
    this.domManager.appendHistoryItem(errorItem);
    this.domManager.setPromptState(true);
    this.activeStreamingAiItem = null; // Reset active streaming item on error
  }

  public hide(initiatedByUser: boolean, fromCloseButton: boolean = false): void {
    if (!this.isVisible) return;
    if (!this.domManager) {
      console.error('[FeedbackViewerLogic] Cannot hide: DOM manager not initialized.');
      return;
    }

    console.log(`[FeedbackViewerImpl] hide called. initiatedByUser: ${initiatedByUser}, fromCloseButton: ${fromCloseButton}`);
    eventEmitter.emit('viewerWillHide'); // Emit before hiding
    this.domManager.hide();
    this.isVisible = false;
    this.onToggleCallback(false); // Inform parent about visibility change
    this.removeSelectionHighlight(); // Remove any active highlight
    this.resetStateForNewSelection(); // Reset for next interaction cycle
    
    if (initiatedByUser && fromCloseButton) {
      localStorage.setItem(this.PANEL_CLOSED_BY_USER_KEY, 'true');
      console.log(`[FeedbackViewerImpl] Panel closed by user via close button. Set ${this.PANEL_CLOSED_BY_USER_KEY}.`);
    }
    eventEmitter.emit('viewerDidHide'); // Emit after hiding
  }

  private resetStateForNewSelection(): void {
    console.log('[FeedbackViewerImpl] Resetting state for new selection/cycle.');
    this.currentImageDataUrl = null;
    this.initialSelectedElement = null;
    this.originalOuterHTMLForCurrentCycle = null;
    this.fixedOuterHTMLForCurrentCycle = null;
    // this.currentFixId = null; // currentFixId should persist until a new selection cycle starts in prepareForInput
    this.stableSelectorForCurrentCycle = null;
    this.originalSvgsMap.clear();
    this.svgPlaceholderCounter = 0;
    this.activeStreamingAiItem = null; // Also reset any active streaming item

    // Optionally, tell DOM to reset/clear certain parts if not handled by hide() or prepareForInput()
    // For example, if there are specific UI elements tied to a fix proposal that aren't part of the general history.
    // this.domManager?.clearCurrentFixProposalDisplay(); // Example if such a method existed
  }

  // --- Method to render user-facing messages (warnings, info) into history ---
  private renderUserMessage(message: string): void {
    if (!this.domManager) {
      console.error("[FeedbackViewerImpl] Cannot render user message: DOM Manager not initialized.");
      return;
    }
    const userMessageItem: ConversationItem = { type: 'usermessage', content: message };
    // We save it to history, and appendHistoryItem will also render it.
    this.saveHistory(userMessageItem); 
    // No direct call to domManager.appendHistoryItem here as saveHistory handles it.
    console.log(`[FeedbackViewerImpl] Rendered user message: ${message}`);
  }

  // --- UI Event Handlers ---

  private handleTextareaKeydown(e: KeyboardEvent): void {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      this.handleSubmit();
    }
  }

  private handleSubmit(): void {
    const promptText = this.domElements?.promptTextarea.value.trim(); // Safely access promptTextarea

    // Allow /publish even if other conditions aren't met
    if (promptText?.toLowerCase() === '/publish') {
      console.log("[FeedbackViewerLogic] /publish command detected. Calling publishSnapshot().");
      this.publishSnapshot();
      this.domManager?.setPromptState(true, ''); 
      this.domManager?.updateSubmitButtonState(true); 
      return; 
    }

    // ADDED: Handle /help command
    if (promptText?.toLowerCase() === '/help') {
      console.log("[FeedbackViewerLogic] /help command detected. Calling showOnboarding().");
      this.showOnboarding();
      this.domManager?.setPromptState(true, ''); // Clear the /help command
      this.domManager?.updateSubmitButtonState(true); // Re-enable submit if it was disabled
      return;
    }

    // ADDED: Handle /stats command
    if (promptText?.toLowerCase() === '/stats') {
      console.log("[FeedbackViewerLogic] /stats command detected.");
      this.displayStatsBadges(); // New method to be created
      this.domManager?.setPromptState(true, ''); // Clear the /stats command
      this.domManager?.updateSubmitButtonState(true); // Re-enable submit if it was disabled
      return;
    }

    // Existing guards for regular feedback submission
    if (!this.domManager || !this.domElements || !this.originalOuterHTMLForCurrentCycle || !this.currentFixId) {
      this.showError('Missing context for submission (original HTML or Fix ID). Please select an element again.');
      return;
    }

    if (!promptText) {
      this.showError('Please enter a description or question.');
      return;
    }

    // The /publish case is handled above, so no need for trimmedLowerCasePrompt here again for that.
    console.log(`[FeedbackViewerLogic] Submitting feedback for Fix ID: ${this.currentFixId}...`);

    this.domManager.setPromptState(false);
    this.domManager.updateSubmitButtonState(false);
    this.domManager.updateLoaderVisibility(true, 'Loading...');
    this.domManager.clearUserMessage();
    this.domManager.showPromptInputArea(false, promptText);

    const imageKeywords = ["image", "photo", "picture", "screenshot", "visual", "look", "style", "design", "appearance", "graphic", "illustration", "background", "banner", "logo"];
    const promptHasImageKeyword = imageKeywords.some(keyword => promptText.includes(keyword));
    let imageDataToSend: string | null = null;

    if (promptHasImageKeyword && this.currentImageDataUrl) {
      imageDataToSend = this.currentImageDataUrl;
      console.log("[FeedbackViewerLogic] Image keyword found, using existing screenshot from current selection.");
    } else if (promptHasImageKeyword) {
      console.log("[FeedbackViewerLogic] Image keyword found, but no existing screenshot from selection. Proceeding without image.");
    } else {
      console.log("[FeedbackViewerLogic] No image-related keyword in prompt. Not sending image.");
    }

    this.saveHistory({ type: 'user', content: promptText });
    
    const newAiPlaceholder: ConversationItem = { type: 'ai', content: '', isStreaming: true };
    this.saveHistory(newAiPlaceholder);
    if (this.conversationHistory.length > 0 && 
        this.conversationHistory[this.conversationHistory.length - 1].type === 'ai') {
      this.activeStreamingAiItem = this.conversationHistory[this.conversationHistory.length - 1];
      console.log("[FeedbackViewerLogic DEBUG] handleSubmit: Set activeStreamingAiItem.");
    } else {
      console.error("[FeedbackViewerLogic ERROR] handleSubmit: Failed to set activeStreamingAiItem after adding AI placeholder.");
      this.activeStreamingAiItem = null;
    }

    let processedHtmlForAI = this.originalOuterHTMLForCurrentCycle; 
    this.originalSvgsMap.clear();
    this.svgPlaceholderCounter = 0;
    try {
      console.log('[FeedbackViewerLogic] Preprocessing HTML to replace SVGs...');
      processedHtmlForAI = this.preprocessHtmlForAI(processedHtmlForAI);
      console.log(`[FeedbackViewerLogic] Preprocessing complete. Stored ${this.originalSvgsMap.size} SVGs.`);
    } catch (e) {
      console.error('[FeedbackViewerLogic] Error preprocessing HTML for AI:', e);
      this.showError('Failed to process HTML before sending.');
      return;
    }

    fetchFeedback(imageDataToSend, promptText, processedHtmlForAI);
    try {
      if (!localStorage.getItem('checkra_onboarded')) {
        localStorage.setItem('checkra_onboarded', '1');
        console.log('[FeedbackViewerImpl] Onboarding marked complete via first submission.');
      }
    } catch (e) {
      console.warn('[FeedbackViewerImpl] Failed to set checkra_onboarded after submission:', e);
    }
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
    const aiItems = this.conversationHistory.filter(item => item.type === 'ai');
    const lastAiItem = aiItems.length > 0 ? aiItems[aiItems.length - 1] : null;

    if (!lastAiItem || !lastAiItem.content) {
      console.log('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: No AI message content found in history to extract from.');
      this.fixedOuterHTMLForCurrentCycle = null;
      return;
    }
    const responseText = lastAiItem.content;
    console.log('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: Full AI responseText for HTML extraction: ', responseText);

    let match = responseText.match(SPECIFIC_HTML_REGEX);
    console.log('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: SPECIFIC_HTML_REGEX match result:', match);
    if (!match) {
      match = responseText.match(GENERIC_HTML_REGEX);
      console.log('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: GENERIC_HTML_REGEX match result:', match);
    }

    if (match && match[1]) {
      let extractedHtml = match[1].trim();
      console.log('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: Initial extractedHtml (trimmed):', extractedHtml);

      try {
        extractedHtml = this.postprocessHtmlFromAI(extractedHtml);
        console.log('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: extractedHtml after postprocessHtmlFromAI() (changed: ${beforePostProcess !== extractedHtml}):', extractedHtml);
        
        const tempFragment = this.createFragmentFromHTML(extractedHtml);
        console.log('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: createFragmentFromHTML result:', tempFragment ? 'Fragment created' : 'Fragment FAILED');

        if (tempFragment && tempFragment.childNodes.length > 0) {
          this.fixedOuterHTMLForCurrentCycle = extractedHtml;
          console.log(`[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: Successfully STORED fixedOuterHTMLForCurrentCycle (length: ${extractedHtml.length}).`);
        } else {
          console.warn('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: Failed to parse extracted HTML into a valid, non-empty fragment. Fix may not be applicable.');
          this.fixedOuterHTMLForCurrentCycle = null;
        }
      } catch (e) {
        console.error('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: Error during postprocessing/validation:', e);
        this.fixedOuterHTMLForCurrentCycle = null;
      }
    } else {
      if (!lastAiItem.isStreaming && !GENERIC_HTML_REGEX.test(responseText)) {
        console.log('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: No HTML block found in the final AI response history item (isStreaming: false, regex test failed).');
      } else {
        console.log('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: No regex match for HTML block (isStreaming: ${lastAiItem.isStreaming}, regex test result for GENERIC_HTML_REGEX on full response: ${GENERIC_HTML_REGEX.test(responseText)}).');
      }
      this.fixedOuterHTMLForCurrentCycle = null;
    }
  }
  private applyFixToPage(fixId: string, originalHtml: string, fixedHtml: string, stableSelector?: string): void {
    console.log(`[FeedbackViewerLogic DEBUG] applyFixToPage: Attempting to apply fix. Fix ID: ${fixId}, Stable Selector: ${stableSelector || 'Not Provided (will use current cycle)'}`);
    if (!this.domManager || !this.domElements) {
      console.warn('[FeedbackViewerLogic DEBUG] applyFixToPage: Cannot apply fix: Missing DOM Manager or elements.');
      return;
    }

    try {
      let elementToReplace = document.querySelector(`[data-checkra-fix-id="${fixId}"]`);
      console.log('[FeedbackViewerLogic DEBUG] applyFixToPage: Result of querySelector(`[data-checkra-fix-id="${fixId}"]`):', elementToReplace);

      let insertionParent: Node | null = null;
      let insertionBeforeNode: Node | null = null;

      if (elementToReplace) {
        if (!elementToReplace.parentNode) {
          console.error(`[FeedbackViewerLogic DEBUG] applyFixToPage: Original element with ID ${fixId} has no parent node.`);
          throw new Error(`Original element with ID ${fixId} has no parent node.`);
        }
        insertionParent = elementToReplace.parentNode;
        console.log('[FeedbackViewerLogic DEBUG] applyFixToPage: Determined insertionParent:', insertionParent);
        insertionBeforeNode = elementToReplace.nextSibling;
        elementToReplace.remove(); 
      } else {
        console.error(`[FeedbackViewerLogic DEBUG] applyFixToPage: Original element with ID ${fixId} not found. Cannot apply fix.`);
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
      const toggleBtn = this.createAppliedFixButton('toggle', fixId);
      wrapper.appendChild(closeBtn);
      wrapper.appendChild(toggleBtn);

      insertionParent.insertBefore(wrapper, insertionBeforeNode);
      console.log(`[FeedbackViewerLogic] Inserted permanent wrapper for ${fixId}.`);

      const finalStableSelector = stableSelector || this.stableSelectorForCurrentCycle;
      if (!finalStableSelector) {
        console.error(`[FeedbackViewerLogic] Critical error: Stable selector is missing for fix ID ${fixId}. Cannot reliably apply or store fix.`);
        this.showError(`Failed to apply fix: Stable target selector missing for fix ${fixId}.`);
        return;
      }

      const fixInfo: AppliedFixInfo = {
        originalElementId: fixId, // Session-specific ID
        originalOuterHTML: originalHtml,
        fixedOuterHTML: fixedHtml,
        appliedWrapperElement: wrapper,
        isCurrentlyFixed: true,
        stableTargetSelector: finalStableSelector // Use the determined stable selector
      };
      this.appliedFixes.set(fixId, fixInfo);
      console.log(`[FeedbackViewerLogic] Stored applied fix info for ${fixId} with stable selector: ${finalStableSelector}`);

      const listeners = {
        close: (e: Event) => this.handleAppliedFixClose(fixId, e),
        toggle: (e: Event) => this.handleAppliedFixToggle(fixId, e)
      };
      this.appliedFixListeners.set(fixId, listeners);
      closeBtn.addEventListener('click', listeners.close);
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
  private createAppliedFixButton(type: 'close' | 'toggle', fixId: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.setAttribute('data-fix-id', fixId);

    switch (type) {
      case 'close':
        button.className = 'feedback-fix-close-btn';
        button.innerHTML = '&times;';
        button.title = 'Discard Fix (Revert to Original)';
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
    console.log(`[FeedbackViewerImpl.toggle] Current visibility: ${this.isVisible}`);
    if (this.isVisible) {
      this.hide(true, false); // User initiated, not from close button
    } else {
      // This is a user action (shortcut or direct toggle call if exposed)
      // So, we want to override PANEL_CLOSED_BY_USER_KEY
      this.showFromApi(true); // Pass true for triggeredByUserAction
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

    // No specific listeners to add to onboarding buttons anymore as audit is removed.
    // The onboarding view itself is handled by FeedbackViewerDOM.
  }
  
  // Handler for the mini select button click
  private handleMiniSelectClick(e: MouseEvent): void {
    e.stopPropagation(); // Prevent triggering other clicks
    console.log('[FeedbackViewerLogic] Mini select (crosshair) button clicked.');
    // this.isQuickAuditRun = false; // REMOVED: Audit feature removed

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
  }

  private removeGlobalListeners(): void {
    document.removeEventListener('keydown', this.boundHandleEscapeKey!);
    console.log('[FeedbackViewerLogic] Removed global keydown listener for Escape key.');
  }

  public showFromApi(triggeredByUserAction: boolean = false): void {
    if (this.isVisible) {
      console.log('[FeedbackViewerImpl] showFromApi called, but panel is already visible.');
      // If it's already visible, and this call was triggered by a user action (e.g. toggle)
      // that intends to show it, ensure any "closed by user" flag is cleared.
      if (triggeredByUserAction) {
        localStorage.removeItem(this.PANEL_CLOSED_BY_USER_KEY);
        console.log(`[FeedbackViewerImpl] Panel already visible, user action to show, cleared ${this.PANEL_CLOSED_BY_USER_KEY}.`);
      }
      return;
    }

    if (!this.domManager) {
      console.error('[FeedbackViewerLogic] Cannot show: DOM Manager not initialized.');
      return;
    }
    console.log(`[FeedbackViewerImpl] showFromApi called. triggeredByUserAction: ${triggeredByUserAction}`);

    eventEmitter.emit('viewerWillShow'); // Emit before showing

    this.domManager.show();
    this.isVisible = true;
    this.onToggleCallback(true); // Inform parent about visibility change

    if (triggeredByUserAction) {
      localStorage.removeItem(this.PANEL_CLOSED_BY_USER_KEY);
      console.log(`[FeedbackViewerImpl] Panel shown by user action. Cleared ${this.PANEL_CLOSED_BY_USER_KEY}.`);
    }

    // Handle onboarding for the first run if not already onboarded
    if (!localStorage.getItem('checkra_onboarded')) {
      this.showOnboarding();
      localStorage.setItem('checkra_onboarded', 'true');
    } else {
      // If not onboarding, prepare default input state (e.g., focus textarea)
      // This might need to be conditional if onboarding takes focus
      if (this.domElements && document.activeElement !== this.domElements.promptTextarea) {
          this.domElements.promptTextarea.focus();
      }
    }
    
    eventEmitter.emit('viewerDidShow'); // Emit after showing
    console.log('[FeedbackViewerImpl] Panel shown via API call.');
  }

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
    if (this.domManager && newItem) {
      this.domManager.appendHistoryItem(newItem);
    } else if (this.domManager) {
      // If newItem is null, it means an update happened in updateResponse/finalizeResponse.
      // Those methods are now responsible for calling domManager.updateLastAIMessage directly.
      // So, no DOM update needed here when newItem is null.
    }
  }
  private removeSelectionHighlight(): void {
    if (this.currentlyHighlightedElement) {
      this.currentlyHighlightedElement.classList.remove('checkra-selected-element-outline');
      this.currentlyHighlightedElement = null;
      console.log('[FeedbackViewerLogic] Removed selection highlight.');
    }
  }
  private handleImageGenerationStart(data: { prompt?: string }): void {
    if (!this.domManager) return;
    console.log('[FeedbackViewerImpl] AI Image Generation Started. Prompt:', data.prompt);
    // Hide general loading indicator if it's showing
    this.domManager.updateLoaderVisibility(false);
    // Show image generation specific status
    this.domManager.showImageGenerationStatus(true, data.prompt);
  }

  // RENAMED and REIMPLEMENTED: from exportSnapshot and sendSnapshotToBackend
  public async publishSnapshot(): Promise<void> {
    if (this.appliedFixes.size === 0) {
      console.warn("[FeedbackViewerImpl] No fixes applied. Nothing to publish.");
      this.renderUserMessage("No changes have been applied to publish.");
      return;
    }

    const changes = Array.from(this.appliedFixes.values()).map(fixInfo => {
      return {
        targetSelector: fixInfo.stableTargetSelector,
        appliedHtml: fixInfo.fixedOuterHTML,
        sessionFixId: fixInfo.originalElementId
      };
    });

    const siteId = getSiteId();
    const clientGeneratedSnapshotId = crypto.randomUUID(); // Frontend still generates a UUID for the snapshot content
    console.log("[FeedbackViewerImpl DEBUG] Generated clientSnapshotId for this publish attempt:", clientGeneratedSnapshotId);

    const snapshotData = {
      siteId:      siteId,
      snapshotId:  clientGeneratedSnapshotId, // This UUID is sent to the backend
      timestamp:   new Date().toISOString(),
      pageUrl:     window.location.href,
      changes:     changes,
    };

    console.log("[FeedbackViewerImpl] Snapshot data for POST /snapshots prepared:", snapshotData);
    
    const postSnapshotUrl = `${API_BASE}/sites/${siteId}/snapshots`;
    console.log(`[FeedbackViewerImpl] Saving snapshot to: ${postSnapshotUrl}`);

    try {
      this.renderUserMessage("Publishing changes..."); 
      const postResponse = await fetch(postSnapshotUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(snapshotData),
      });

      if (!postResponse.ok) {
        const errorBody = await postResponse.text();
        let specificErrorMessage = `Saving snapshot failed: ${postResponse.status} ${postResponse.statusText}`;
        try {
            const errorJson = JSON.parse(errorBody);
            if (errorJson && errorJson.message) { 
                specificErrorMessage += ` - ${errorJson.message}`;
            }
        } catch (parseErr) {
            specificErrorMessage += ` - ${errorBody}`;
        }
        throw new Error(specificErrorMessage);
      }

      // Backend now returns { publishedVariantId (short), snapshotId (UUID from payload), publicCdnUrl, newVariantRecordCreated }
      const postResult = await postResponse.json(); 
      console.log("[FeedbackViewerImpl] Snapshot successfully saved (POST response):", postResult);
      
      if (postResult.publishedVariantId && postResult.snapshotId) {
        const shortPublishedId = postResult.publishedVariantId; // Short ID for URLs and promote path
        const fullSnapshotIdUUID = postResult.snapshotId; // UUID for promotion body, should match clientGeneratedSnapshotId

        // Verify backend returned the same snapshotId we sent
        if (fullSnapshotIdUUID !== clientGeneratedSnapshotId) {
            console.warn(`[FeedbackViewerImpl] Mismatch between client-generated snapshotId (${clientGeneratedSnapshotId}) and backend-returned snapshotId (${fullSnapshotIdUUID}). Using backend's.`);
            // Potentially use clientGeneratedSnapshotId if strict control is needed, or trust backend's echo.
            // For now, we'll use what the backend confirmed (fullSnapshotIdUUID) for the promotion body.
        }

        this.renderUserMessage(`Published ID: ${shortPublishedId}`);
        
        // Promote using the SHORT publishedVariantId in the path
        const promoteUrl = `${API_BASE}/sites/${siteId}/variants/${shortPublishedId}`;
        console.log(`[FeedbackViewerImpl] Promoting variant. URL: ${promoteUrl}`);

        try {
          const promoteResponse = await fetch(promoteUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            // Body MUST contain the full UUID snapshotId
            body: JSON.stringify({ snapshotIdToPromote: fullSnapshotIdUUID }), 
          });

          if (!promoteResponse.ok) {
            const promoteErrorBody = await promoteResponse.text();
            let specificPromoteErrorMessage = `Promotion failed: ${promoteResponse.status} ${promoteResponse.statusText}`;
            try {
                const errorJson = JSON.parse(promoteErrorBody);
                if (errorJson && errorJson.message) { 
                    specificPromoteErrorMessage += ` - ${errorJson.message}`;
                }
            } catch (parseErr) {
                specificPromoteErrorMessage += ` - ${promoteErrorBody}`;
            }
            console.error("[FeedbackViewerImpl] Error promoting snapshot:", specificPromoteErrorMessage, promoteErrorBody);
            this.showError(`Failed to promote snapshot: ${specificPromoteErrorMessage}`);
            this.renderUserMessage(`Error promoting: ${specificPromoteErrorMessage}. Snapshot saved (ID: ${shortPublishedId.substring(0,8)}...) but not live.`);
            return; 
          }

          // Promotion response: { variantId (short, same as publishedVariantId), cdnUrl, snapshotId (UUID) }
          const promoteResult = await promoteResponse.json(); 
          console.log("[FeedbackViewerImpl] Snapshot successfully promoted (PUT response):", promoteResult);
          
          // Use the cdnUrl from the promotion response, or fallback to publicCdnUrl from POST response
          const liveCdnUrl = promoteResult.cdnUrl || postResult.publicCdnUrl;
          // Share URL uses the SHORT publishedVariantId and the new query parameter
          const shareUrl = `${window.location.origin}${window.location.pathname}?checkra-variant-id=${shortPublishedId}`;

          this.renderUserMessage(`Share URL: <a href="${shareUrl}" target="_blank">${shareUrl}</a>`);
          console.log("[FeedbackViewerImpl] Share URL:", shareUrl, "Live CDN URL:", liveCdnUrl);

        } catch (promoteError) {
          console.error("[FeedbackViewerImpl] Network or other error promoting snapshot:", promoteError);
          const errorMessage = promoteError instanceof Error ? promoteError.message : "An unknown error occurred during promotion.";
          this.showError(`Failed to promote snapshot: ${errorMessage}`);
          this.renderUserMessage(`Error promoting: ${errorMessage}. Snapshot saved (ID: ${shortPublishedId.substring(0,8)}...) but not live.`);
        }
      } else {
        console.warn("[FeedbackViewerImpl] Snapshot POST successful, but publishedVariantId or snapshotId missing in response:", postResult);
        this.renderUserMessage("Snapshot saved, but could not get necessary IDs for promotion.");
      }

    } catch (error) { // Error from initial POST
      console.error("[FeedbackViewerImpl] Error saving snapshot:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred during saving.";
      this.showError(`Failed to save snapshot: ${errorMessage}`);
      this.renderUserMessage(`Error saving snapshot: ${errorMessage}`);
    }
  }

  private displayStatsBadges(): void {
    if (!this.domManager) return;

    // Added a wrapper div with a specific class for targeting in CSS
    const badgesHtml = `
      <div class="checkra-stats-badges-wrapper">
        <div class="checkra-stats-badges">
          <button class="checkra-stat-badge" data-queryname="metrics_1d">Stats (last 24h)</button>
          <button class="checkra-stat-badge" data-queryname="metrics_7d">Stats (last 7d)</button>
          <button class="checkra-stat-badge" data-queryname="geo_top5_7d">Top Countries (last 7d)</button>
        </div>
      </div>
    `;
    
    this.saveHistory({ type: 'usermessage', content: badgesHtml }); // Kept as 'usermessage'
  }

  // Method to fetch and display stats when a badge is clicked
  private async fetchAndDisplayStats(queryName: string): Promise<void> {
    if (!this.domManager) return;
    console.log(`[FeedbackViewerLogic] Fetching stats for query: ${queryName}`);

    this.domManager.appendHistoryItem({
      type: 'ai', // Show a thinking indicator
      content: `Fetching ${queryName.replace(/_/g, ' ')}...`,
      isStreaming: true // Use streaming style for "thinking"
    });

    try {
      const response = await fetch(`https://${CDN_DOMAIN}/analytics/${queryName}`);
      
      // Update the "thinking" message to a final state (non-streaming)
      // This requires a way to update the last message if the DOM manager supports it,
      // or simply appending a new message. For simplicity, we'll append new.
      // Ideally, domManager.updateLastAIMessage would be used.
      // For now, we'll remove the thinking message if possible, or just let it be.
      // Let's assume we can't easily remove/update the "thinking" message and proceed.
      // A better approach would be to have domManager.updateLastAIMessage take an ID or be smarter.
      // The current domManager.updateLastAIMessage updates the *very last* AI bubble.
      // So, if another AI message came in, it would get overwritten.
      // For robust V1, new bubble for result is safest.

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch stats: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      console.log('[FeedbackViewerLogic] Stats data received:', data.rows);

      if (!data.rows || data.rows.length === 0) {
        this.saveHistory({ type: 'ai', content: "No data available for this query." });
        return;
      }

      let markdownTable = "";
      if (queryName === 'metrics_1d' || queryName === 'metrics_7d') {
        markdownTable = `| Variant | Views   | Uniques | Avg. Dwell (ms) |\n|---------|---------|---------|-----------------|\n`;
        data.rows.forEach((row: any) => {
          markdownTable += `| ${row.var || 'N/A'} | ${row.views || '0'} | ${row.uniques || '0'} | ${row.avg_dur_ms || '0'} |\n`;
        });
      } else if (queryName === 'geo_top5_7d') {
        markdownTable = `| Variant | Country | Views   | Uniques | Avg. Dwell (ms) |\n|---------|---------|---------|---------|-----------------|\n`;
        data.rows.forEach((row: any) => {
          markdownTable += `| ${row.var || 'N/A'} | ${row.country || 'N/A'} | ${row.views || '0'} | ${row.uniques || '0'} | ${row.avg_dur_ms || '0'} |\n`;
        });
      }

      if (markdownTable) {
         // Replace the "Fetching..." message with the actual table.
        this.domManager.updateLastAIMessage(markdownTable, false);
      } else {
        this.saveHistory({ type: 'ai', content: "Could not format data for display." });
      }

    } catch (error: any) {
      console.error('[FeedbackViewerLogic] Error fetching or displaying stats:', error);
      // Replace the "Fetching..." message with the error.
      this.domManager.updateLastAIMessage(`Sorry, I couldn't fetch those stats right now. Please try again. Error: ${error.message}`, false);
    }
  }
}