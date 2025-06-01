import { fetchFeedback } from '../services/ai-service';
import { SELECT_SVG_ICON, type CheckraViewerElements } from './checkra-dom';
import type { CheckraDOM } from './checkra-dom';
import { screenCapture } from './screen-capture';
import type { SettingsModal } from './settings-modal';
import { eventEmitter } from '../core/index';
import { generateStableSelector } from '../utils/selector-utils';
import { API_BASE, CDN_DOMAIN } from '../config';
import { getSiteId } from '../utils/id'; 
import { fetchProtected, AuthenticationRequiredError, logout, startLogin, isLoggedIn } from '../auth/auth';
import { customWarn, customError } from '../utils/logger';
import { GenerateSuggestionRequestbody, AddRatingRequestBody } from '../types'; // Added BackendPayloadMetadata and RequestBodyFeedback import

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
const COPY_FIX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy-icon lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

// --- Interface for Applied Fix Data ---
interface AppliedFixInfo {
  originalElementId: string; // Unique ID assigned to the element (session-specific data-checkra-fix-id)
  originalOuterHTML: string; // Store the full outerHTML (might represent multiple siblings)
  fixedOuterHTML: string; // Store the full outerHTML suggested by AI (might represent multiple siblings)
  appliedWrapperElement: HTMLDivElement | null; // Reference to the '.checkra-feedback-applied-fix' wrapper
  isCurrentlyFixed: boolean; // Tracks if the displayed version in the wrapper is the fix
  stableTargetSelector: string; // ADDED: A stable selector for the original element
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter'; // ADDED: How the fix was applied
  requestBody: GenerateSuggestionRequestbody; // ADDED: The request body that generated this fix
  isRated?: boolean; // ADDED: To track if the fix has been rated
}

// localStorage keys for pending actions
const PENDING_ACTION_TYPE_KEY = 'checkra_auth_pending_action_type';
const PENDING_ACTION_DATA_KEY = 'checkra_auth_pending_action_data';

/**
 * Handles the logic, state, and interactions for the feedback viewer.
 */
export class CheckraImplementation {
  private domElements: CheckraViewerElements | null = null;
  private domManager: CheckraDOM | null = null;
  private settingsModal: SettingsModal | null = null;
  private optionsInitialVisibility: boolean; // To store the initial visibility from options
  private enableRating: boolean; // ADDED: Store enableRating option

  // --- State ---
  private isVisible: boolean = false;
  private currentImageDataUrl: string | null = null;
  private currentlyHighlightedElement: Element | null = null; // << ADDED: Track element with outline
  private originalOuterHTMLForCurrentCycle: string | null = null; // Store the initial HTML of the selected element
  private fixedOuterHTMLForCurrentCycle: string | null = null; // Store the AI's suggested HTML (could be multiple elements)
  private currentFixId: string | null = null; // Unique ID for the element being worked on
  private stableSelectorForCurrentCycle: string | null = null; // ADDED: Stable selector for the current cycle
  private currentElementInsertionMode: 'replace' | 'insertBefore' | 'insertAfter' = 'replace'; // Added
  private fixIdCounter: number = 0; // Counter for generating unique IDs
  private originalSvgsMap: Map<string, string> = new Map();
  private svgPlaceholderCounter: number = 0;
  private activeStreamingAiItem: ConversationItem | null = null; // ADDED: To track the current AI message being streamed
  private selectionPlusIconElement: HTMLDivElement | null = null; // Added for persistent '+' icon
  private pageReplaceLoaderElement: HTMLDivElement | null = null; // Loader for 'replace' mode

  // --- Quick Suggestion Flow ---
  private queuedPromptText: string | null = null; // Stores prompt chosen before element selection

  // --- Global Tracking for Applied Fixes ---
  private appliedFixes: Map<string, AppliedFixInfo> = new Map();
  // Store listeners for applied fixes to clean them up later
  private appliedFixListeners: Map<string, { close: EventListener; toggle: EventListener; copy: EventListener; rate: EventListener }> = new Map();

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
  private boundHandleSuggestionClick = this.handleSuggestionClick.bind(this); // NEW: Bound handler for onboarding suggestion
  private readonly PANEL_CLOSED_BY_USER_KEY = 'checkra_panel_explicitly_closed'; // ADDED
  private conversationHistory: ConversationItem[] = [];

  private boundHandleJsonPatch = this.handleJsonPatch.bind(this);
  private boundHandleDomUpdate = this.handleDomUpdate.bind(this); // NEW: Bound handler for direct DOM updates

  private requestBodyForCurrentCycle: GenerateSuggestionRequestbody | null = null; // ADDED: To store request body for the current fix cycle
  private boundHandleRequestBodyPrepared = this.handleRequestBodyPrepared.bind(this); // NEW: Bound handler for request body

  constructor(
    private onToggleCallback: (isVisible: boolean) => void,
    initialVisibilityFromOptions: boolean = false, // New parameter
    enableRating: boolean = false // ADDED: enableRating parameter
  ) {
    this.optionsInitialVisibility = initialVisibilityFromOptions;
    this.enableRating = enableRating; // Store it
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
  }

  public initialize(
    domManager: CheckraDOM,
    settingsModal: SettingsModal
  ): void {
    // --- ALWAYS reset conversation history and onboarding flag on page load ---
    try {
      localStorage.removeItem(CONVERSATION_HISTORY_KEY);
      localStorage.removeItem('checkra_onboarded');
    } catch (e) {
      // Failing silently is acceptable; some environments block localStorage
    }

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
    // Listen for onboarding suggestion clicks
    eventEmitter.on('onboardingSuggestionClicked', this.boundHandleSuggestionClick);
    eventEmitter.on('aiJsonPatch', this.boundHandleJsonPatch);
    eventEmitter.on('aiDomUpdateReceived', this.boundHandleDomUpdate); // NEW: Listen for direct DOM updates
    eventEmitter.on('requestBodyPrepared', this.boundHandleRequestBodyPrepared); // NEW: Listen for request body from ai-service

    // Add event listener for stats badges clicks (delegated to responseContent)
    this.domElements.responseContent.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.classList.contains('checkra-stat-badge') && target.dataset.queryname) {
        this.fetchAndDisplayStats(target.dataset.queryname);
      }
    });

    this.addGlobalListeners();

    // --- Initial Visibility Logic --- 
    const panelWasClosedByUser = localStorage.getItem(this.PANEL_CLOSED_BY_USER_KEY) === 'true';

    if (this.optionsInitialVisibility && !panelWasClosedByUser) {
      this.showFromApi(false); // Show programmatically, don't mark as user action for clearing flags
    } else {
      // Panel is intended to be hidden or was closed by user.
      // Ensure it's hidden if not already (though DOM manager likely handles this by not calling .show())
      if (this.isVisible) {
        this.hide(false); // Programmatic hide if somehow visible
      }
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
    // Handle Supabase error query params (e.g. server_error) to avoid auth loops
    this.handleAuthErrorInUrl();

    // Check for and handle pending actions after auth callback
    this.handlePendingActionAfterLogin();
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
        const copyBtn = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-copy-btn');
        copyBtn?.removeEventListener('click', listeners.copy);
        const rateBtn = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-rate-btn');
        rateBtn?.removeEventListener('click', listeners.rate);
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
    eventEmitter.off('onboardingSuggestionClicked', this.boundHandleSuggestionClick);
    eventEmitter.off('aiJsonPatch', this.boundHandleJsonPatch);
    eventEmitter.off('aiDomUpdateReceived', this.boundHandleDomUpdate); // NEW: Unsubscribe from direct DOM updates
    eventEmitter.off('requestBodyPrepared', this.boundHandleRequestBodyPrepared); // NEW: Unsubscribe from request body event

    this.domElements = null;
    this.domManager = null;
    this.removeGlobalListeners();

    // Optional: Clear history state if needed on full cleanup?
    // this.conversationHistory = []; 
    this.removeSelectionHighlight(); // This will now also handle the persistent plus icon
    if (this.selectionPlusIconElement && this.selectionPlusIconElement.parentNode) {
      this.selectionPlusIconElement.parentNode.removeChild(this.selectionPlusIconElement);
      this.selectionPlusIconElement = null;
    }
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
    targetElement: Element | null,
    clickX: number, 
    clickY: number,
    effectiveBackgroundColor: string | null,
    insertionMode: 'replace' | 'insertBefore' | 'insertAfter' 
  ): void {
    if (!this.domManager || !this.domElements) {
      customError("[FeedbackViewerLogic] Cannot prepare for input: DOM Manager or elements not initialized.");
      return;
    }
    
    this.removeSelectionHighlight(); // Clear previous selection visuals first

    this.currentImageDataUrl = imageDataUrl;
    this.currentElementInsertionMode = insertionMode; 

    const isElementSelected = !!(targetElement && targetElement !== document.body); 

    if (isElementSelected && targetElement) { 
      this.stableSelectorForCurrentCycle = generateStableSelector(targetElement);
      this.originalOuterHTMLForCurrentCycle = selectedHtml; 
      this.currentlyHighlightedElement = targetElement; // Store the new one
      this.updateSelectionVisuals(targetElement, insertionMode); // Apply new visuals
      // currentFixId is now set correctly inside this block
      this.currentFixId = `checkra-fix-${this.fixIdCounter++}`;
      targetElement.setAttribute('data-checkra-fix-id', this.currentFixId);
    } else {
      this.stableSelectorForCurrentCycle = 'body';
      this.originalOuterHTMLForCurrentCycle = document.body.outerHTML; 
      this.currentlyHighlightedElement = null; // No specific element highlighted
      this.updateSelectionVisuals(null, 'replace'); // Clear any persistent visuals
      this.currentFixId = `checkra-fix-${this.fixIdCounter++}`; // Still need a fix ID for body context
    }

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

    // --- AUTO SUBMIT FLOW (if prompt was chosen before selection) ---
    if (this.queuedPromptText && this.domElements) {
      this.domElements.promptTextarea.value = this.queuedPromptText;
      this.queuedPromptText = null; 
      this.handleSubmit();
    }
  }

  public updateResponse(chunk: string): void {
    if (!this.domManager || !this.domElements) return;

    const currentStreamItem = this.activeStreamingAiItem;

    if (currentStreamItem) {
    } else {
      const lastItemInHistory = this.conversationHistory.length > 0 ? this.conversationHistory[this.conversationHistory.length - 1] : null;
      customWarn(`[FeedbackViewerImpl] updateResponse: activeStreamingAiItem is null. Last item in history: ${lastItemInHistory?.type}, streaming: ${lastItemInHistory?.isStreaming}`);
      return;
    }

    if (currentStreamItem.type === 'ai' && currentStreamItem.isStreaming) {
      currentStreamItem.content += chunk;
      this.domManager.updateLastAIMessage(currentStreamItem.content, true);

      const hasHtmlCode = GENERIC_HTML_REGEX.test(currentStreamItem.content);
      this.domManager.updateLoaderVisibility(true, hasHtmlCode ? 'Creating new version...' : 'Loading...');
    } else {
      customWarn(`[FeedbackViewerImpl] updateResponse called but currentStreamItem (activeStreamingAiItem) is not an AI message or not streaming. Type: ${currentStreamItem.type}, Streaming: ${currentStreamItem.isStreaming}`);
    }
  }

  public finalizeResponse(): void {
    if (!this.domManager || !this.domElements) return;

    this.hidePageLoaders(); // Hide page loaders when response is finalized

    const streamToFinalize = this.activeStreamingAiItem;

    if (streamToFinalize && streamToFinalize.type === 'ai' && streamToFinalize.isStreaming) {
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
    } else {
      customWarn(`[FeedbackViewerImpl] finalizeResponse called but no active AI message was streaming or found. Active item state: type=${streamToFinalize?.type}, streaming=${streamToFinalize?.isStreaming}`);
      const lastHistoryAI = [...this.conversationHistory].reverse().find(item => item.type === 'ai' && item.isStreaming);
      if (lastHistoryAI) {
        customWarn("[FeedbackViewerImpl DEBUG] finalizeResponse: Fallback - found a different streaming AI item in history. Finalizing it.", lastHistoryAI);
        lastHistoryAI.isStreaming = false;
        this.extractAndStoreFixHtml(); // Ensure fix HTML is extracted for this fallback case too
        if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForCurrentCycle && this.currentFixId) {
            lastHistoryAI.fix = { // Also store fix data if applicable
                originalHtml: this.originalOuterHTMLForCurrentCycle,
                fixedHtml: this.fixedOuterHTMLForCurrentCycle,
                fixId: this.currentFixId
            };
        }
        this.saveHistory();
        this.domManager.updateLastAIMessage(lastHistoryAI.content, false);
      } else {
         customWarn("[FeedbackViewerImpl DEBUG] finalizeResponse: Fallback - no streaming AI item found in history either.");
      }
      this.activeStreamingAiItem = null;
    }

    this.domManager.updateLoaderVisibility(false);
    this.domManager.setPromptState(true);
    this.domManager.updateSubmitButtonState(true);

    const contentWrapper = this.domElements.contentWrapper;
    contentWrapper.scrollTop = contentWrapper.scrollHeight;

    if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForCurrentCycle && this.currentFixId) {
      const lastAiItem = this.conversationHistory.filter(item => item.type === 'ai').pop();
      const modeToUse = this.currentElementInsertionMode;
      const requestBodyForFix = this.requestBodyForCurrentCycle; // Use the stored request body

      if (lastAiItem && lastAiItem.fix && requestBodyForFix) {
        this.applyFixToPage(lastAiItem.fix.fixId, lastAiItem.fix.originalHtml, lastAiItem.fix.fixedHtml, modeToUse, requestBodyForFix, this.stableSelectorForCurrentCycle || undefined);
      } else {
        customWarn('[FeedbackViewerImpl] Finalized response with fix HTML, but fix data not in history item or requestBodyForFix missing.');
        if (!requestBodyForFix) {
          customError('[FeedbackViewerImpl] requestBodyForCurrentCycle is null - the ai-service may not have emitted requestBodyPrepared event.');
        }
        if (this.currentFixId && this.originalOuterHTMLForCurrentCycle && this.fixedOuterHTMLForCurrentCycle && this.stableSelectorForCurrentCycle && requestBodyForFix) {
          this.applyFixToPage(this.currentFixId, this.originalOuterHTMLForCurrentCycle, this.fixedOuterHTMLForCurrentCycle, modeToUse, requestBodyForFix, this.stableSelectorForCurrentCycle || undefined);
        } else {
          customError('[FeedbackViewerImpl] Cannot apply fix from current cycle state: Missing required data (fixId, originalHTML, fixedHTML, stableSelector, or requestBodyForFix).');
        }
      }
      this.requestBodyForCurrentCycle = null; // Clear after use
    }
  }

  public showError(error: Error | string): void {
    let errorHtmlContent: string;

    this.hidePageLoaders(); // Hide page loaders on error

    if (typeof error === 'string' && error.includes(SELECT_SVG_ICON)) {
      // If it's the specific error message with the SVG placeholder,
      // leave it as is, assuming it's already formatted with the SVG string.
      errorHtmlContent = error;
    } else {
      // For other errors (Error objects or plain strings without the specific SVG placeholder)
      const errorTextMessage = error instanceof Error ? error.message : error;
      // Escape HTML for general errors to prevent XSS if the error message itself contains HTML
      const escapedErrorMessage = new Option(errorTextMessage).innerHTML;
      errorHtmlContent = escapedErrorMessage;
      customError('[Checkra AI Error]', errorTextMessage); // Log the plain text version
    }

    const errorItem: ConversationItem = {
      type: 'error',
      content: errorHtmlContent, // This will be HTML
    };

    this.conversationHistory.push(errorItem);
    this.saveHistory(errorItem); // Pass the new item to save incrementally

    if (this.domManager) {
      this.domManager.appendHistoryItem(errorItem); // Use appendHistoryItem
    }
  }

  public hide(initiatedByUser: boolean, fromCloseButton: boolean = false): void {
    if (!this.isVisible) return;
    if (!this.domManager) {
      customError('[FeedbackViewerLogic] Cannot hide: DOM manager not initialized.');
      return;
    }

    eventEmitter.emit('viewerWillHide'); 
    this.domManager.hide();
    this.isVisible = false;
    this.onToggleCallback(false); 
    this.removeSelectionHighlight(); // This will clear classes and the persistent plus icon
    this.resetStateForNewSelection(); 
    
    if (initiatedByUser && fromCloseButton) {
      localStorage.setItem(this.PANEL_CLOSED_BY_USER_KEY, 'true');
      this.domManager?.showAvailabilityToast();
    }
    eventEmitter.emit('viewerDidHide'); 
  }

  private resetStateForNewSelection(): void {
    this.currentImageDataUrl = null;
    this.originalOuterHTMLForCurrentCycle = null;
    this.fixedOuterHTMLForCurrentCycle = null;
    this.stableSelectorForCurrentCycle = null;
    this.originalSvgsMap.clear();
    this.svgPlaceholderCounter = 0;
    this.activeStreamingAiItem = null; 
    this.hidePageLoaders(); // Hide page loaders on new selection
  }

  // --- Method to render user-facing messages (warnings, info) into history ---
  private renderUserMessage(message: string): void {
    if (!this.domManager) {
      customError("[FeedbackViewerImpl] Cannot render user message: DOM Manager not initialized.");
      return;
    }
    const userMessageItem: ConversationItem = { type: 'usermessage', content: message };
    // We save it to history, and appendHistoryItem will also render it.
    this.saveHistory(userMessageItem); 
    // No direct call to domManager.appendHistoryItem here as saveHistory handles it.
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
    const promptText = this.domElements?.promptTextarea.value.trim(); 

    // Allow /publish even if other conditions aren't met
    if (promptText?.toLowerCase() === '/publish') {
      this.publishSnapshot();
      this.domManager?.setPromptState(true, ''); 
      this.domManager?.updateSubmitButtonState(true); 
      return; 
    }

    // ADDED: Handle /save command
    if (promptText?.toLowerCase() === '/save') {
      if (this.appliedFixes.size === 0) {
        this.renderUserMessage("No changes have been applied to save as a draft.");
        this.domManager?.setPromptState(true, '');
        this.domManager?.updateSubmitButtonState(true);
        return;
      }
      this.saveSnapshotAsDraft(); // New method to handle saving logic
      this.domManager?.setPromptState(true, '');
      this.domManager?.updateSubmitButtonState(true);
      return;
    }

    // ADDED: Handle /logout command
    if (promptText?.toLowerCase() === '/logout') {
      this.renderUserMessage("Logging out..."); // Provide immediate feedback
      logout().then(() => {
        // This part might not be reached if window.location.reload() in Auth.logout executes quickly.
        // However, it's good practice to have a success path.
        this.renderUserMessage("You have been logged out. The page should reload automatically.");
      }).catch((err: Error) => {
        customError("[FeedbackViewerLogic] Error during /logout command:", err);
        // Use renderUserMessage for consistency with /publish feedback style
        this.renderUserMessage(`Logout failed: ${err.message}`);
      }).finally(() => {
        // Clear the command from the textarea and re-enable submit, 
        // though this might also be interrupted by page reload.
        this.domManager?.setPromptState(true, ''); 
        this.domManager?.updateSubmitButtonState(true); 
      });
      return; 
    }

    // ADDED: Handle /help command
    if (promptText?.toLowerCase() === '/help') {
      this.showOnboarding();
      this.domManager?.setPromptState(true, ''); // Clear the /help command
      this.domManager?.updateSubmitButtonState(true); // Re-enable submit if it was disabled
      return;
    }

    // ADDED: Handle /stats command
    if (promptText?.toLowerCase() === '/stats') {
      this.displayStatsBadges(); // New method to be created
      this.domManager?.setPromptState(true, ''); // Clear the /stats command
      this.domManager?.updateSubmitButtonState(true); // Re-enable submit if it was disabled
      return;
    }

    // Existing guards for regular feedback submission
    if (!this.domManager || !this.domElements || !this.originalOuterHTMLForCurrentCycle || !this.currentFixId) {
      this.showError(`First select an element on your website using the${SELECT_SVG_ICON}`);
      return;
    }

    if (!promptText) {
      this.showError('Please enter a description or question.');
      return;
    }

    // The /publish case is handled above, so no need for trimmedLowerCasePrompt here again for that.

    this.domManager.setPromptState(false);
    this.domManager.updateSubmitButtonState(false);
    this.domManager.updateLoaderVisibility(true, 'Loading...'); // This is the side panel loader
    this.domManager.clearUserMessage();
    this.domManager.showPromptInputArea(false, promptText);

    // --- Show page-specific loaders ---
    this.hidePageLoaders(); // Clear any previous loaders first
    if (this.currentElementInsertionMode === 'insertBefore' || this.currentElementInsertionMode === 'insertAfter') {
        if (this.selectionPlusIconElement) {
            this.selectionPlusIconElement.classList.add('loading');
        }
    } else if (this.currentElementInsertionMode === 'replace') {
        if (this.currentlyHighlightedElement) {
            this.showReplaceLoader(this.currentlyHighlightedElement);
        }
    }
    // --- End page-specific loaders ---

    const imageKeywords = ["image", "photo", "picture", "screenshot", "visual", "look", "style", "design", "appearance", "graphic", "illustration", "background", "banner", "logo"];
    const promptHasImageKeyword = imageKeywords.some(keyword => promptText.toLowerCase().includes(keyword)); // Ensure keyword is already lowercase or use keyword.toLowerCase()
    let imageDataToSend: string | null = null;

    if (promptHasImageKeyword && this.currentImageDataUrl) {
      imageDataToSend = this.currentImageDataUrl;
    } else if (promptHasImageKeyword && !this.currentImageDataUrl) {
      customWarn('[FeedbackViewerLogic] Prompt suggests a design request, but no screenshot was captured/available from element selection.');
      // imageDataToSend remains null, so no image will be sent
    } else {
      // Prompt is not design-related, or no screenshot desired by prompt.
      // imageDataToSend remains null, so no image will be sent
    }

    this.saveHistory({ type: 'user', content: promptText });
    
    const newAiPlaceholder: ConversationItem = { type: 'ai', content: '', isStreaming: true };
    this.saveHistory(newAiPlaceholder);
    if (this.conversationHistory.length > 0 && 
        this.conversationHistory[this.conversationHistory.length - 1].type === 'ai') {
      this.activeStreamingAiItem = this.conversationHistory[this.conversationHistory.length - 1];
    } else {
      customError("[FeedbackViewerLogic ERROR] handleSubmit: Failed to set activeStreamingAiItem after adding AI placeholder.");
      this.activeStreamingAiItem = null;
    }

    let processedHtmlForAI = this.originalOuterHTMLForCurrentCycle; 
    this.originalSvgsMap.clear();
    this.svgPlaceholderCounter = 0;
    try {
      processedHtmlForAI = this.preprocessHtmlForAI(processedHtmlForAI);
    } catch (e) {
      customError('[FeedbackViewerLogic] Error preprocessing HTML for AI:', e);
      this.showError('Failed to process HTML before sending.');
      return;
    }

    // Note: The full request body with rich metadata will be provided by ai-service
    // via the 'requestBodyPrepared' event. We don't create it here anymore.
    // Just call fetchFeedback which will trigger the metadata gathering in ai-service.

    fetchFeedback(imageDataToSend, promptText, processedHtmlForAI, this.currentElementInsertionMode);
    // After submitting, clear the textarea and reset button for general prompts too
    this.domManager?.setPromptState(true, ''); 
    this.domManager?.updateSubmitButtonState(true); // Re-enable submit, assuming selection is still valid or will be re-evaluated

    try {
      if (!localStorage.getItem('checkra_onboarded')) {
        localStorage.setItem('checkra_onboarded', '1');
      }
    } catch (e) {
      customWarn('[FeedbackViewerImpl] Failed to set checkra_onboarded after submission:', e);
    }
  }

  // --- Applied Fix Button Handlers --- (These remain for already applied fixes)
  private handleAppliedFixClose(fixId: string, event: Event): void {
    event.stopPropagation();
    const fixInfo = this.appliedFixes.get(fixId);
    const wrapperElement = document.querySelector(`.checkra-feedback-applied-fix[data-checkra-fix-id="${fixId}"]`);

    if (fixInfo && wrapperElement) {
      try {
        if (fixInfo.insertionMode === 'replace') {
          const originalFragment = this.createFragmentFromHTML(fixInfo.originalOuterHTML);
          if (!originalFragment || originalFragment.childNodes.length === 0) {
            throw new Error('Failed to parse original HTML into non-empty fragment for reverting (replace mode).');
          }
          const firstOriginalElement = originalFragment.firstElementChild;
          if (firstOriginalElement) {
            firstOriginalElement.setAttribute('data-checkra-fix-id', fixId);
          }
          wrapperElement.replaceWith(originalFragment);
        } else { // 'insertBefore' or 'insertAfter'
          wrapperElement.remove(); // Simply remove the added adjacent section
        }

        const listeners = this.appliedFixListeners.get(fixId);
        if (listeners) {
          const closeBtn = wrapperElement.querySelector('.feedback-fix-close-btn');
          const toggleBtn = wrapperElement.querySelector('.feedback-fix-toggle');
          const copyBtn = wrapperElement.querySelector('.feedback-fix-copy-btn');
          const rateBtn = wrapperElement.querySelector('.feedback-fix-rate-btn'); // Added this line
          closeBtn?.removeEventListener('click', listeners.close);
          toggleBtn?.removeEventListener('click', listeners.toggle);
          copyBtn?.removeEventListener('click', listeners.copy);
          rateBtn?.removeEventListener('click', listeners.rate);
          this.appliedFixListeners.delete(fixId);
        }
        this.appliedFixes.delete(fixId);

      } catch (error) {
        customError(`[FeedbackViewerLogic] Error closing/reverting fix ${fixId} (mode: ${fixInfo.insertionMode}):`, error);
      }
    } else {
      customWarn(`[FeedbackViewerLogic] Could not find fix info or wrapper element for Fix ID: ${fixId} during close.`);
      if (wrapperElement) wrapperElement.remove();
      if (this.appliedFixes.has(fixId)) this.appliedFixes.delete(fixId);
      if (this.appliedFixListeners.has(fixId)) this.appliedFixListeners.delete(fixId);
    }
  }

  private handleAppliedFixToggle(fixId: string, event: Event): void {
    event.stopPropagation();
    const fixInfo = this.appliedFixes.get(fixId);
    const wrapperElement = document.querySelector(`.checkra-feedback-applied-fix[data-checkra-fix-id="${fixId}"]`);
    const contentContainer = wrapperElement?.querySelector('.checkra-applied-fix-content');
    const toggleButton = wrapperElement?.querySelector<HTMLButtonElement>('.feedback-fix-toggle');

    if (fixInfo && wrapperElement && contentContainer && toggleButton) {
      try {
        if (fixInfo.insertionMode === 'replace') {
          const htmlToInsert = fixInfo.isCurrentlyFixed
            ? fixInfo.originalOuterHTML
            : fixInfo.fixedOuterHTML;
          const newContentFragment = this.createFragmentFromHTML(htmlToInsert);
          if (!newContentFragment || newContentFragment.childNodes.length === 0) {
            throw new Error('Failed to parse HTML into non-empty fragment for toggle (replace mode).');
          }
          if (!contentContainer) { 
               throw new Error('Content container not found for replace mode toggle.');
          }
          contentContainer.innerHTML = '';
          contentContainer.appendChild(newContentFragment);
          fixInfo.isCurrentlyFixed = !fixInfo.isCurrentlyFixed;

          if (fixInfo.isCurrentlyFixed) {
            // toggleButton.innerHTML = HIDE_FIX_SVG; // REMOVED SVG swap
            toggleButton.classList.add('toggled-on');
            toggleButton.title = "Toggle Original Version";
            // toggleButton.style.backgroundColor = 'rgba(60, 180, 110, 0.9)'; // REMOVED direct style
          } else {
            // toggleButton.innerHTML = DISPLAY_FIX_SVG; // REMOVED SVG swap
            toggleButton.classList.remove('toggled-on');
            toggleButton.title = "Toggle Fixed Version";
            // toggleButton.style.backgroundColor = ''; // REMOVED direct style
          }
        } else { // 'insertBefore' or 'insertAfter'
          fixInfo.isCurrentlyFixed = !fixInfo.isCurrentlyFixed; 
          if (contentContainer instanceof HTMLElement) { 
              if (fixInfo.isCurrentlyFixed) { 
                  contentContainer.style.display = '';
                  // toggleButton.innerHTML = HIDE_FIX_SVG; // REMOVED SVG swap
                  toggleButton.classList.add('toggled-on');
                  toggleButton.title = "Hide This Section Content"; 
                  // toggleButton.style.backgroundColor = 'rgba(60, 180, 110, 0.9)'; // REMOVED direct style
              } else { 
                  contentContainer.style.display = 'none';
                  // toggleButton.innerHTML = DISPLAY_FIX_SVG; // REMOVED SVG swap
                  toggleButton.classList.remove('toggled-on');
                  toggleButton.title = "Show This Section Content"; 
                  // toggleButton.style.backgroundColor = ''; // REMOVED direct style
              }
          } else {
              customError(`[FeedbackViewerLogic] Content container not found or not HTMLElement within wrapper for fixId ${fixId} during insertBefore/After toggle.`);
          }
        }
      } catch (error) {
        customError(`[FeedbackViewerLogic] Error toggling fix ${fixId} (mode: ${fixInfo.insertionMode}):`, error);
        // Simplified error handling for toggle; try to restore a consistent state if possible
        if (fixInfo.insertionMode === 'replace' && !fixInfo.isCurrentlyFixed) {
          try {
            const fixedFragment = this.createFragmentFromHTML(fixInfo.fixedOuterHTML);
            if (fixedFragment && fixedFragment.childNodes.length > 0) {
              contentContainer.innerHTML = '';
              contentContainer.appendChild(fixedFragment);
              fixInfo.isCurrentlyFixed = true;
              // toggleButton.innerHTML = HIDE_FIX_SVG; // REMOVED SVG swap
              toggleButton.classList.add('toggled-on');
              toggleButton.title = "Toggle Original Version";
              // toggleButton.style.backgroundColor = 'rgba(60, 180, 110, 0.9)'; // REMOVED direct style
            }
          } catch (restoreError) {
            customError(`[FeedbackViewerLogic] Failed to restore fixed state for ${fixId} after toggle error (replace):`, restoreError);
          }
        } else if (fixInfo.insertionMode !== 'replace' && !fixInfo.isCurrentlyFixed) {
           // If adjacent and failed while trying to show it, try to ensure it's shown
           if (wrapperElement instanceof HTMLElement) wrapperElement.style.display = '';
           fixInfo.isCurrentlyFixed = true;
           // toggleButton.innerHTML = HIDE_FIX_SVG; // REMOVED SVG swap
           toggleButton.classList.add('toggled-on');
           toggleButton.title = "Hide This Section";
           // toggleButton.style.backgroundColor = 'rgba(60, 180, 110, 0.9)'; // REMOVED direct style
        }
      }
    } else {
      customWarn(`[FeedbackViewerLogic] Could not find fix info, wrapper, content container, or toggle button for Fix ID: ${fixId} during toggle.`);
    }
  }

  /**
   * Copies a ready-to-use LLM prompt for the selected fix to the clipboard.
   */
  private async handleAppliedFixCopy(fixId: string, event: Event): Promise<void> {
    event.stopPropagation();
    const fixInfo = this.appliedFixes.get(fixId);
    if (!fixInfo) {
      customError(`[FeedbackViewerLogic] Copy prompt failed – fix ${fixId} not found in map.`);
      return;
    }

    try {
      const prompt = this.buildFixPrompt(fixInfo);
      await navigator.clipboard.writeText(prompt);
      console.info('[Checkra] Prompt copied to clipboard for fix', fixId);
      this.domManager?.showCopyPromptToast();
    } catch (err) {
      customError('[FeedbackViewerLogic] Failed to copy prompt to clipboard:', err);
      this.showError('Unable to copy prompt to clipboard.');
    }
  }

  /**
   * Generates a framework-agnostic prompt describing how to apply this fix.
   * The prompt can be fed to an LLM or shared with another developer.
   */
  private buildFixPrompt(fix: AppliedFixInfo): string {
    const { stableTargetSelector, originalOuterHTML, fixedOuterHTML } = fix;

    const getTextContentFromHtml = (html: string): string => {
      try {
        const template = document.createElement('template');
        template.innerHTML = html.trim();
        return template.content.textContent || '';
      } catch (e) {
        customError('[buildFixPrompt] Error parsing HTML for textContent:', e);
        return '';
      }
    };

    const originalTextContent = getTextContentFromHtml(originalOuterHTML);

    const jsonPayload = {
      op: "replaceOuterHTML",
      uniqueSelector: stableTargetSelector,
      originalOuterHTMLSnippet: originalOuterHTML.substring(0, 250) + (originalOuterHTML.length > 250 ? '...' : ''),
      originalTextContentSnippet: originalTextContent.substring(0, 150) + (originalTextContent.length > 150 ? '...' : ''),
      // Provide full HTML for the assistant to work with, snippets are for quick identification aids.
      originalOuterHTML: originalOuterHTML,
      proposedOuterHTML: fixedOuterHTML
    };

    const jsonPayloadString = JSON.stringify(jsonPayload, null, 2);

    // Construct the full prompt including instructions for the AI coding assistant
    const fullPrompt = `
You are an autonomous coding agent with read-write access to the repository.

Input patch (JSON) ⬇
\`\`\`json
${jsonPayloadString}
\`\`\`

Your job:
1. Locate the source code file and specific section that produces the HTML matching the \`uniqueSelector\` and resembling the \`originalOuterHTMLSnippet\` or \`originalTextContentSnippet\` from the JSON payload.
   - First, try a direct search for the \`originalOuterHTMLSnippet\`
   - If not found, try searching for the \`originalTextContentSnippet\`
   - Use the \`uniqueSelector\` to confirm you've found the correct element if the live application can be run and inspected (e.g., via browser devtools and \`document.querySelector(\`${stableTargetSelector}\`)\`).

2. Apply the necessary changes to this source code so that its rendered output will exactly match the \`proposedOuterHTML\` from the JSON payload.
   - Make the changes idiomatically according to the project's existing coding patterns and technologies.
   - This might involve changing component props, updating template syntax, modifying class lists (e.g., for Tailwind CSS), or altering attributes.

3. Aim for semantic and minimal changes. For example, if only a class name changed, update the class, don't replace the entire HTML block if avoidable.

4. If the changes involve CSS classes that are not utility classes (like Tailwind), ensure that any necessary new CSS definitions are added or existing ones are updated to match the visual intent of the \`proposedOuterHTML\`

5. IMPORTANT: Return only the modified code block(s) or the diff. Do not include explanations unless the changes are complex and warrant it.
`;

    return fullPrompt;
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
      const placeholder = doc.createElement('svg'); // Create an actual SVG element as placeholder
      placeholder.setAttribute('data-checkra-id', placeholderId);
      // Add some minimal content or attributes to ensure it's not empty if the parser is strict
      placeholder.setAttribute('viewBox', '0 0 1 1'); 
      svg.parentNode?.replaceChild(placeholder, svg);
    });

    // Determine the correct way to serialize back to string
    let processedHtmlString;
    if (doc.body.childNodes.length === 1 && doc.body.firstElementChild && htmlString.trim().startsWith(`<${doc.body.firstElementChild.tagName.toLowerCase()}`)) {
      // Likely a single element was passed in, use its outerHTML
      processedHtmlString = doc.body.firstElementChild.outerHTML;
    } else {
      // Likely a fragment or multiple elements, use body.innerHTML
      processedHtmlString = doc.body.innerHTML;
    }
    customWarn('[FeedbackViewerImpl DEBUG] preprocessHtmlForAI output:', processedHtmlString.slice(0,300));
    return processedHtmlString;
  }

  /**
   * Parses AI-generated HTML, finds placeholders, and replaces them with stored SVGs.
   */
  private postprocessHtmlFromAI(aiHtmlString: string): string {
    if (this.originalSvgsMap.size === 0) {
      return aiHtmlString; // No SVGs were replaced initially
    }

    let restoredHtml = aiHtmlString.replace(SVG_PLACEHOLDER_REGEX, (match, placeholderId) => {
      const originalSvg = this.originalSvgsMap.get(placeholderId);
      if (originalSvg) {
        return originalSvg;
      } else {
        customWarn(`[FeedbackViewerLogic] Original SVG not found for placeholder ID: ${placeholderId}. Leaving placeholder.`);
        return match; // Keep the placeholder if original is missing
      }
    });

    return restoredHtml;
  }

  /**
   * Extracts HTML from the accumulated response, postprocesses it,
   * and stores it in `fixedOuterHTMLForCurrentCycle`.
   */
  private extractAndStoreFixHtml(): void {
    if (this.fixedOuterHTMLForCurrentCycle) {
      // Already set via JSON patch handling; skip extraction
      return;
    }
    const aiItems = this.conversationHistory.filter(item => item.type === 'ai');
    const lastAiItem = aiItems.length > 0 ? aiItems[aiItems.length - 1] : null;

    if (!lastAiItem || !lastAiItem.content) {
      this.fixedOuterHTMLForCurrentCycle = null;
      return;
    }
    const responseText = lastAiItem.content;

    let match = responseText.match(SPECIFIC_HTML_REGEX);
    if (!match) {
      match = responseText.match(GENERIC_HTML_REGEX);
    }

    let extractedHtml: string | null = null;
    let analysisPortion: string | null = null;

    if (match && match[1]) {
      extractedHtml = match[1].trim();
      analysisPortion = responseText.replace(match[0], '').trim();
    } else {
      // Fallback: attempt to locate raw HTML outside of fences (common when LLM omitted code block)
      // Heuristic: find first element tag that likely starts the intended HTML block.
      // We search for common block-level tags but fall back to the very first '<' if needed.
      const tagRegex = /<\s*(div|section|article|main|header|footer|nav|ul|ol|li|p|h[1-6]|details|summary)[^>]*>/i;
      const tagMatch = tagRegex.exec(responseText);
      const startIdx = tagMatch ? tagMatch.index : responseText.indexOf('<');
      if (startIdx !== -1) {
        extractedHtml = responseText.slice(startIdx).trim();
        analysisPortion = responseText.slice(0, startIdx).trim();
      }
    }

    if (extractedHtml) {
      try {
        extractedHtml = this.postprocessHtmlFromAI(extractedHtml);

        // Optionally scrub leading non-element/comment nodes similar to JSON patch flow
        const scrubLeadingNonElement = (html: string): string => {
          const frag = this.createFragmentFromHTML(html);
          if (!frag) return html;
          while (frag.firstChild && (frag.firstChild.nodeType === Node.COMMENT_NODE || frag.firstChild.nodeType === Node.TEXT_NODE)) {
            frag.firstChild.parentNode?.removeChild(frag.firstChild);
          }
          const temp = document.createElement('div');
          temp.appendChild(frag);
          return temp.innerHTML;
        };
        extractedHtml = scrubLeadingNonElement(extractedHtml);

        const tempFragment = this.createFragmentFromHTML(extractedHtml);

        if (tempFragment && tempFragment.childNodes.length > 0) {
          this.fixedOuterHTMLForCurrentCycle = extractedHtml;

          // Clean the AI bubble to only show analysis portion (if any)
          if (analysisPortion && lastAiItem) {
            lastAiItem.content = analysisPortion;
          }
        } else {
          customWarn('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: Fallback extraction failed to produce valid HTML fragment.');
          this.fixedOuterHTMLForCurrentCycle = null;
        }
      } catch (e) {
        customError('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: Error during fallback postprocessing/validation:', e);
        this.fixedOuterHTMLForCurrentCycle = null;
      }
    } else {
      this.fixedOuterHTMLForCurrentCycle = null;
    }
  }
  private applyFixToPage(fixId: string, originalHtml: string, fixedHtml: string, insertionMode: 'replace' | 'insertBefore' | 'insertAfter', requestBody: GenerateSuggestionRequestbody, stableSelector?: string): void {
    if (!this.domManager || !this.domElements) {
      customWarn('[FeedbackViewerLogic DEBUG] applyFixToPage: Cannot apply fix: Missing DOM Manager or elements.');
      return;
    }

    try {
      const originalSelectedElement = document.querySelector(`[data-checkra-fix-id="${fixId}"]`);

      if (!originalSelectedElement) {
        customError(`[FeedbackViewerLogic DEBUG] applyFixToPage: Original element with ID ${fixId} not found. Cannot apply fix.`);
        this.showError(`Failed to apply fix: Original target element for fix ${fixId} not found.`);
        return;
      }
      
      if (!originalSelectedElement.parentNode) {
        customError(`[FeedbackViewerLogic DEBUG] applyFixToPage: Original element with ID ${fixId} has no parent node.`);
        this.showError(`Failed to apply fix: Original target for fix ${fixId} has no parent.`);
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'checkra-feedback-applied-fix checkra-fix-fade-in';
      wrapper.setAttribute('data-checkra-fix-id', fixId);

      // --- NEW: Preserve layout classes/styles for adjacent insertions ---
      if (insertionMode === 'insertBefore' || insertionMode === 'insertAfter') {
        const origEl = originalSelectedElement as HTMLElement;
        if (origEl) {
          // Copy classes except internal checkra-* ones
          origEl.classList.forEach(cls => {
            if (!cls.startsWith('checkra-')) {
              wrapper.classList.add(cls);
            }
          });
          // Copy inline styles if any (appended to avoid overwriting position/outline set by CSS)
          const origStyle = origEl.getAttribute('style');
          if (origStyle && origStyle.trim().length > 0) {
            const existingStyle = wrapper.getAttribute('style') || '';
            wrapper.setAttribute('style', `${existingStyle} ${origStyle}`.trim());
          }
        }
      }
      // --- END NEW ---

      const contentContainer = document.createElement('div');
      contentContainer.className = 'checkra-applied-fix-content';
      const fixedContentFragment = this.createFragmentFromHTML(fixedHtml);
      if (!fixedContentFragment || fixedContentFragment.childNodes.length === 0) {
        throw new Error('Failed to parse fixed HTML for content container fragment.');
      }
      contentContainer.appendChild(fixedContentFragment);
      wrapper.appendChild(contentContainer);

      const controlsContainer = document.createElement('div');
      controlsContainer.className = 'checkra-fix-controls-container';

      const closeBtn = this.createAppliedFixButton('close', fixId);
      const toggleBtn = this.createAppliedFixButton('toggle', fixId);
      const copyBtn = this.createAppliedFixButton('copy', fixId);
      // const rateBtn = this.createAppliedFixButton('rate', fixId); // Declaration moved down
      
      controlsContainer.appendChild(copyBtn);
      controlsContainer.appendChild(toggleBtn);
      // Conditionally add rateBtn
      let rateBtn: HTMLButtonElement | null = null; // Declare rateBtn, initially null
      if (this.enableRating) {
        rateBtn = this.createAppliedFixButton('rate', fixId);
        controlsContainer.appendChild(rateBtn); // Append if enabled
      }
      controlsContainer.appendChild(closeBtn); // Close button is last

      wrapper.appendChild(controlsContainer);

      const parent = originalSelectedElement.parentNode;

      if (insertionMode === 'replace') {
        parent.insertBefore(wrapper, originalSelectedElement.nextSibling);
        originalSelectedElement.remove();
      } else if (insertionMode === 'insertBefore') {
        parent.insertBefore(wrapper, originalSelectedElement);
      } else if (insertionMode === 'insertAfter') {
        parent.insertBefore(wrapper, originalSelectedElement.nextSibling);
      }

      const finalStableSelector = stableSelector || this.stableSelectorForCurrentCycle;
      if (!finalStableSelector) {
        customError(`[FeedbackViewerLogic] Critical error: Stable selector is missing for fix ID ${fixId}. Cannot reliably apply or store fix.`);
        this.showError(`Failed to apply fix: Stable target selector missing for fix ${fixId}.`);
        if (wrapper.parentNode) wrapper.remove();
        return;
      }

      const fixInfoData: AppliedFixInfo = {
        originalElementId: fixId,
        originalOuterHTML: originalHtml,
        fixedOuterHTML: fixedHtml,
        appliedWrapperElement: wrapper,
        isCurrentlyFixed: true,
        stableTargetSelector: finalStableSelector,
        insertionMode: insertionMode, 
        requestBody: requestBody,
        isRated: false, // Initialize isRated to false for a new fix
      };
      this.appliedFixes.set(fixId, fixInfoData);

      // Apply .rated class and disable if initially rated (e.g. from restored state)
      if (rateBtn && fixInfoData.isRated) { // Check if rateBtn exists
        rateBtn.classList.add('rated');
        (rateBtn as HTMLButtonElement).disabled = true;
      }

      const listeners = {
        close: (e: Event) => this.handleAppliedFixClose(fixId, e),
        toggle: (e: Event) => this.handleAppliedFixToggle(fixId, e),
        copy: (e: Event) => this.handleAppliedFixCopy(fixId, e),
        // Conditionally add rate listener if rateBtn exists/was created
        ...(rateBtn && { rate: (e: Event) => this.handleAppliedFixRate(fixId, e) })
      } as any; // Use any here due to conditional property, or type more carefully
      
      this.appliedFixListeners.set(fixId, listeners);
      closeBtn.addEventListener('click', listeners.close);
      toggleBtn.addEventListener('click', listeners.toggle);
      copyBtn.addEventListener('click', listeners.copy);
      if (rateBtn && listeners.rate) { // Check if rateBtn and its listener exist
        rateBtn.addEventListener('click', listeners.rate);
      }

      this.fixedOuterHTMLForCurrentCycle = null;
      this.removeSelectionHighlight();

    } catch (error) {
      customError('[FeedbackViewerLogic] Error applying fix directly to page:', error);
      this.showError(`Failed to apply fix: ${error instanceof Error ? error.message : String(error)}`);
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
      customError("Error creating fragment from HTML string:", e, htmlString);
      return null;
    }
  }

  /** Creates a button for the applied fix wrapper */
  private createAppliedFixButton(type: 'close' | 'toggle' | 'copy' | 'rate', fixId: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.setAttribute('data-fix-id', fixId);

    switch (type) {
      case 'close':
        button.className = 'feedback-fix-close-btn';
        button.innerHTML = '&times;';
        button.title = 'Discard Fix (Revert to Original)';
        break;
      case 'toggle':
        button.className = 'feedback-fix-toggle toggled-on'; // Add .toggled-on by default
        button.innerHTML = DISPLAY_FIX_SVG; // Always use the "eye open" SVG
        button.title = 'Toggle Original Version'; // Initial title assuming fix is shown first
        break;
      case 'copy':
        button.className = 'feedback-fix-copy-btn';
        button.innerHTML = COPY_FIX_SVG;
        button.title = 'Copy prompt for this fix';
        break;
      case 'rate': // Added case for rate button
        button.className = 'feedback-fix-rate-btn';
        button.innerHTML = '★'; // Star icon
        button.title = 'Rate this fix';
        break;
    }
    return button;
  }

  /**
   * Toggles the visibility of the feedback viewer.
   * Assumes initialization is handled by the coordinator.
   */
  public toggle(): void {
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
      customError("[FeedbackViewerLogic] Cannot show onboarding: DOM Manager or elements not initialized.");
      return;
    }
    this.domManager.showOnboardingView(true);
    this.domManager.showPromptInputArea(false);
    this.domManager.clearAIResponseContent();
    this.domManager.updateLoaderVisibility(false);
    this.domManager.show(); // This makes the panel visible
    this.isVisible = true; // << SET isVisible to true
    this.onToggleCallback(true); // Notify coordinator/external

    // No specific listeners to add to onboarding buttons anymore as audit is removed.
    // The onboarding view itself is handled by FeedbackViewerDOM.
  }
  
  // Handler for the mini select button click
  private handleMiniSelectClick(e: MouseEvent): void {
    e.stopPropagation(); // Prevent triggering other clicks
    // this.isQuickAuditRun = false; // REMOVED: Audit feature removed

    // Trigger screen capture, passing the main viewer element to be ignored
    if (this.domElements?.viewer) {
      screenCapture.startCapture(
        this.prepareForInput.bind(this), // Pass the bound method
        this.domElements.viewer // Pass the panel element to ignore
      );
    } else {
      customError('[FeedbackViewerImpl] Cannot start screen capture: domElements.viewer is not available.');
    }
  }

  private handleSettingsClick(): void {
    if (this.settingsModal) {
      this.settingsModal.showModal();
    } else {
      customError('[FeedbackViewerLogic] SettingsModal instance is not available.');
    }
  }

  private handleEscapeKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.isVisible) { // Use the private property
      this.hide(true, false); // User initiated hide via Escape, not fromCloseButton
    }
  }

  private addGlobalListeners(): void {
    if (this.boundHandleEscapeKey) {
      document.addEventListener('keydown', this.boundHandleEscapeKey);
    }
    // Add outside click listener here if not added elsewhere
  }

  private removeGlobalListeners(): void {
    document.removeEventListener('keydown', this.boundHandleEscapeKey!);
  }

  public showFromApi(triggeredByUserAction: boolean = false): void {
    if (this.isVisible) {
      // If it's already visible, and this call was triggered by a user action (e.g. toggle)
      // that intends to show it, ensure any "closed by user" flag is cleared.
      if (triggeredByUserAction) {
        localStorage.removeItem(this.PANEL_CLOSED_BY_USER_KEY);
      }
      return;
    }

    if (!this.domManager) {
      customError('[FeedbackViewerLogic] Cannot show: DOM Manager not initialized.');
      return;
    }

    eventEmitter.emit('viewerWillShow'); // Emit before showing

    this.domManager.show();
    this.isVisible = true;
    this.onToggleCallback(true); // Inform parent about visibility change

    if (triggeredByUserAction) {
      localStorage.removeItem(this.PANEL_CLOSED_BY_USER_KEY);
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
        // TODO: Add call to domManager to render this history
      } else {
        this.conversationHistory = [];
      }
    } catch (e) {
      customError('[FeedbackViewerImpl] Failed to load or parse conversation history:', e);
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
    } catch (e) {
      customError('[FeedbackViewerImpl] Failed to save conversation history:', e);
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
      this.currentlyHighlightedElement.classList.remove(
        'checkra-selected-element-outline',
        'checkra-hover-top',
        'checkra-hover-bottom',
        'checkra-highlight-container',
        'checkra-selected-insert-before',
        'checkra-selected-insert-after',
        'checkra-selected-replace',
        'checkra-element-dimmed' // Ensure dimmed is removed here too
      );
    }
    if (this.selectionPlusIconElement && this.selectionPlusIconElement.parentNode) {
      this.selectionPlusIconElement.classList.remove('loading'); // Ensure loading is removed from plus icon
      this.selectionPlusIconElement.parentNode.removeChild(this.selectionPlusIconElement);
      this.selectionPlusIconElement = null;
    }
    // Also ensure replace loader is removed if selection is cleared while it was active
    if (this.pageReplaceLoaderElement) {
        this.pageReplaceLoaderElement.remove();
        this.pageReplaceLoaderElement = null;
    }
  }

  // RENAMED and REIMPLEMENTED: from exportSnapshot and sendSnapshotToBackend
  public async publishSnapshot(): Promise<void> {
    if (this.appliedFixes.size === 0) {
      customWarn("[FeedbackViewerImpl] No fixes applied. Nothing to publish.");
      this.renderUserMessage("No changes have been applied to publish.");
      return;
    }
    const changesToPublish = Array.from(this.appliedFixes.values()).map(fixInfo => ({
      targetSelector: fixInfo.stableTargetSelector,
      appliedHtml: fixInfo.fixedOuterHTML,
      sessionFixId: fixInfo.originalElementId
    }));
    const siteId = getSiteId();
    const clientGeneratedSnapshotId = crypto.randomUUID(); // This is the key ID

    const snapshotPayload = {
      snapshotId: clientGeneratedSnapshotId,
      timestamp: new Date().toISOString(),
      pageUrl: window.location.href,
      changes: changesToPublish,
      publish: true // Mark for publishing
    };

    const postSnapshotUrl = `${API_BASE}/sites/${siteId}/snapshots`;

    try {
      this.renderUserMessage("Preparing to publish changes...");
      const postResponse = await fetchProtected(postSnapshotUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshotPayload),
      });

      if (!postResponse.ok) {
        const errorBody = await postResponse.text();
        let specificErrorMessage = `Storing snapshot for publish failed: ${postResponse.status} ${postResponse.statusText}`;
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

      const postResult = await postResponse.json();
      // According to new API: postResult contains { message, snapshotId (clientGeneratedSnapshotId), accessUrl, s3SnapshotPath }
      // We need clientGeneratedSnapshotId for the next step.

      if (postResult.snapshotId !== clientGeneratedSnapshotId) {
        customError("[FeedbackViewerImpl] Mismatch between client-generated snapshotId and server response.", { client: clientGeneratedSnapshotId, server: postResult.snapshotId });
        this.renderUserMessage("Error: Snapshot ID mismatch after initial save. Cannot proceed with publishing.");
        return;
      }

      this.renderUserMessage(`Snapshot ${clientGeneratedSnapshotId.substring(0,8)}... stored. Now promoting to live...`);

      // The snapshotId in the path is the clientGeneratedSnapshotId
      const promoteUrl = `${API_BASE}/sites/${siteId}/variants/${clientGeneratedSnapshotId}`;

      try {
        const promoteResponse = await fetchProtected(promoteUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}), // Empty body as per new API
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
          throw new Error(specificPromoteErrorMessage);
        }

        const promoteResult = await promoteResponse.json();
        // According to new API: promoteResult contains { message, siteId, snapshotId (promoted), promotedAt, cdnUrl }
        if (promoteResult.cdnUrl && promoteResult.snapshotId) {
          this.renderUserMessage(`Published successfully! Snapshot ID: ${promoteResult.snapshotId.substring(0,8)}...`);
          const shareUrl = promoteResult.cdnUrl; // Use the cdnUrl directly
          this.renderUserMessage(`Share URL: <a href="${shareUrl}" target="_blank" rel="noopener noreferrer">${shareUrl}</a>`);
        } else {
          customWarn("[FeedbackViewerImpl] Promotion successful, but cdnUrl or snapshotId missing in response:", promoteResult);
          this.renderUserMessage(`Snapshot ${clientGeneratedSnapshotId.substring(0,8)}... promoted, but could not get the public share URL.`);
        }

      } catch (promoteError) {
        if (promoteError instanceof AuthenticationRequiredError || (promoteError && (promoteError as any).name === 'AuthenticationRequiredError')) {
          // Pass the original 'publish' action type and the full snapshotPayload (or relevant parts)
          // so it can be retried. For simplicity, passing the fact that it was a publish action.
          // The 'changesToPublish' might be too large for localStorage if not careful.
          // Let's store a simplified marker for publish and rely on this.appliedFixes to be re-evaluated.
          await this.handleAuthenticationRequiredAndRedirect('publish', { /* minimal data or rely on current state */ }, promoteError as AuthenticationRequiredError);
          this.renderUserMessage("Authentication required to promote. Please log in to continue.");
        } else {
          customError("[FeedbackViewerImpl] Non-AuthenticationRequiredError during promoting snapshot. Error details follow.");
          if (promoteError instanceof Error) {
            customError("[FeedbackViewerImpl] Promote Error Name:", promoteError.name);
            customError("[FeedbackViewerImpl] Promote Error Message:", promoteError.message);
            if (promoteError.stack) customError("[FeedbackViewerImpl] Promote Error Stack:", promoteError.stack);
            if ((promoteError as any).response && typeof (promoteError as any).response.status === 'number') {
              const response = (promoteError as any).response as Response;
              customError("[FeedbackViewerImpl] Underlying promote response status:", response.status);
              try {
                 const responseBody = await response.text();
                 customError("[FeedbackViewerImpl] Underlying promote response body:", responseBody);
              } catch (bodyError) {
                 customError("[FeedbackViewerImpl] Could not read underlying promote response body:", bodyError);
              }
           }
          } else {
            customError("[FeedbackViewerImpl] Caught a non-Error object during promotion:", promoteError);
          }
          const displayErrorMessage = promoteError instanceof Error ? promoteError.message : String(promoteError);
          this.showError(`Failed to promote snapshot: ${displayErrorMessage}`);
          this.renderUserMessage(`Error promoting snapshot ${clientGeneratedSnapshotId.substring(0,8)}...: ${displayErrorMessage}. It was stored but is not live.`);
        }
      }
    } catch (error) {
      if (error instanceof AuthenticationRequiredError || (error && (error as any).name === 'AuthenticationRequiredError')) {
        // Store a simplified marker for publish action.
        await this.handleAuthenticationRequiredAndRedirect('publish', { /* minimal data or rely on current state */ }, error as AuthenticationRequiredError);
        this.renderUserMessage("Authentication required to publish. Please log in to continue.");
      } else {
        customError("[FeedbackViewerImpl] Non-AuthenticationRequiredError during saving snapshot for publish. Error details follow.");
        if (error instanceof Error) {
          customError("[FeedbackViewerImpl] Error Name:", error.name);
          customError("[FeedbackViewerImpl] Error Message:", error.message);
          if (error.stack) customError("[FeedbackViewerImpl] Error Stack:", error.stack);
          if ((error as any).response && typeof (error as any).response.status === 'number') {
             const response = (error as any).response as Response;
             customError("[FeedbackViewerImpl] Underlying response status:", response.status);
             try {
                const responseBody = await response.text();
                customError("[FeedbackViewerImpl] Underlying response body:", responseBody);
             } catch (bodyError) {
                customError("[FeedbackViewerImpl] Could not read underlying response body:", bodyError);
             }
          }
        } else {
          customError("[FeedbackViewerImpl] Caught a non-Error object:", error);
        }
        const displayErrorMessage = error instanceof Error ? error.message : String(error);
        this.showError(`Failed to save snapshot for publishing: ${displayErrorMessage}`);
      }
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

    this.domManager.appendHistoryItem({
      type: 'ai', 
      content: `Fetching ${getFriendlyQueryName(queryName)}...`,
      isStreaming: true 
    });

    try {
      const response = await fetchProtected(`https://${CDN_DOMAIN}/analytics/${queryName}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch stats: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      if (!data.rows || data.rows.length === 0) {
        const noDataMessage = "No data available for this query.";
        this.saveHistory({ type: 'usermessage', content: noDataMessage });
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
        this.domManager.updateLastAIMessage(markdownTable, false);
      } else {
        const formatErrorMessage = "Could not format data for display.";
        this.saveHistory({ type: 'usermessage', content: formatErrorMessage });
      }

    } catch (error: any) {
      if (error instanceof AuthenticationRequiredError || (error && (error as any).name === 'AuthenticationRequiredError')) {
        await this.handleAuthenticationRequiredAndRedirect('fetchStats', { queryName }, error as AuthenticationRequiredError);
      } else {
        customError("[FeedbackViewerImpl] Non-AuthenticationRequiredError during fetching stats. Error details follow.");
        if (error instanceof Error) {
          customError("[FeedbackViewerImpl] Stats Error Name:", error.name);
          customError("[FeedbackViewerImpl] Stats Error Message:", error.message);
          if (error.stack) {
            customError("[FeedbackViewerImpl] Stats Error Stack:", error.stack);
          }
          if ((error as any).response && typeof (error as any).response.status === 'number') {
            const response = (error as any).response as Response;
            customError("[FeedbackViewerImpl] Underlying stats response status:", response.status);
            try {
               const responseBody = await response.text();
               customError("[FeedbackViewerImpl] Underlying stats response body:", responseBody);
            } catch (bodyError) {
               customError("[FeedbackViewerImpl] Could not read underlying stats response body:", bodyError);
            }
         }
        } else {
          customError("[FeedbackViewerImpl] Caught a non-Error object during stats fetch:", error);
        }
        const displayErrorMessage = error instanceof Error ? error.message : String(error);
        this.domManager.updateLastAIMessage(`Sorry, I couldn't fetch those stats. Error: ${displayErrorMessage}`, false);
      }
    }
  }

  private async handleAuthenticationRequiredAndRedirect(actionType: string, actionData: any, authError: AuthenticationRequiredError): Promise<void> {
    try {
      localStorage.setItem(PENDING_ACTION_TYPE_KEY, actionType);
      if (actionData !== undefined) {
        localStorage.setItem(PENDING_ACTION_DATA_KEY, JSON.stringify(actionData));
      }
      
      const loginUrlFromError = authError?.loginUrl;
      const encodedRedirect = encodeURIComponent((window as any).Checkra?.REDIRECT_URI ?? location.origin + '/auth/callback');
      const safeToUseLoginUrl = loginUrlFromError && loginUrlFromError.includes(`redirect_to=${encodedRedirect}`);

      if (safeToUseLoginUrl) {
        window.location.href = loginUrlFromError;
      } else {
        // Fallback: build correct login flow via startLogin()
        customWarn('[FeedbackViewerImpl] Backend loginUrl missing or has wrong redirect_to. Falling back to startLogin().');
        try {
          await startLogin(); // Use imported startLogin
        } catch (loginError) {
          customError('[FeedbackViewerImpl] Error calling startLogin():', loginError);
          this.showError('Authentication is required. Auto-redirect to login failed.');
        }
      }
    } catch (e) {
      customError('[FeedbackViewerImpl] Failed to store pending action or initiate login:', e);
      this.showError('Could not prepare for login. Please try again.');
    }
  }

  private async handlePendingActionAfterLogin(): Promise<void> {
    const actionType = localStorage.getItem(PENDING_ACTION_TYPE_KEY);
    const rawActionData = localStorage.getItem(PENDING_ACTION_DATA_KEY);

    if (actionType) {
      const loggedIn = await isLoggedIn(); // Use imported isLoggedIn
      if (!loggedIn) {
        return; // Do not resume; keep data intact for after auth
      }

      localStorage.removeItem(PENDING_ACTION_TYPE_KEY);
      localStorage.removeItem(PENDING_ACTION_DATA_KEY);

      let actionData: any = null;
      if (rawActionData) {
        try {
          actionData = JSON.parse(rawActionData);
        } catch (e) {
          customError('[FeedbackViewerImpl] Failed to parse pending action data:', e);
          this.showError('Could not restore previous action: invalid data.');
          return;
        }
      }

      switch (actionType) {
        case 'publish':
          if (actionData && Array.isArray(actionData)) {
            // Attempt to restore this.appliedFixes from the stored array of entries
            try {
              this.appliedFixes = new Map(actionData as Iterable<readonly [string, AppliedFixInfo]>);
            } catch (e) {
              customError('[FeedbackViewerImpl] Error restoring appliedFixes from localStorage:', e);
              this.showError('Failed to restore changes for publishing.');
              return;
            }
          } else if (this.appliedFixes.size === 0) { // If no actionData or it was bad, AND current fixes are empty
            this.renderUserMessage("No changes were pending to publish after login.");
            return;
          }
          this.renderUserMessage("Resuming publish operation after login...");
          await this.publishSnapshot();
          break;
        case 'fetchStats':
          if (actionData && typeof actionData.queryName === 'string') {
            this.renderUserMessage(`Resuming stats fetch for ${getFriendlyQueryName(actionData.queryName)} after login...`);
            await this.fetchAndDisplayStats(actionData.queryName);
          } else {
            customError('[FeedbackViewerImpl] Invalid or missing queryName for pending fetchStats action.');
            this.showError('Could not restore stats fetch: missing query details.');
          }
          break;
        default:
          customWarn(`[FeedbackViewerImpl] Unknown pending action type: ${actionType}`);
      }
    } else {
    }
  }

  /**
   * Detects ?error=... returned from Supabase and surfaces it to the user once, then cleans it from history.
   * Prevents endless redirect loops when Supabase cannot create the user due to RLS / grants.
   */
  private handleAuthErrorInUrl(): void {
    const params = new URLSearchParams(location.search);
    const errorCode = params.get('error');
    const errorDesc = params.get('error_description');
    if (errorCode) {
      customWarn('[FeedbackViewerImpl] Supabase auth error detected in URL:', errorCode, errorDesc);
      this.renderUserMessage(`Login failed: ${errorDesc || errorCode}. Please contact support or retry later.`);
      // Clear the params to avoid repeated messages / loops
      params.delete('error');
      params.delete('error_code');
      params.delete('error_description');
      const newUrl = `${location.pathname}${params.toString() ? '?' + params.toString() : ''}${location.hash}`;
      history.replaceState(null, '', newUrl);
    }
  }

  // --- Handler for requestBodyPrepared event from ai-service ---
  private handleRequestBodyPrepared(requestBody: GenerateSuggestionRequestbody): void {
    // Store the full request body with all metadata from ai-service
    this.requestBodyForCurrentCycle = requestBody;
    customWarn('[FeedbackViewerImpl] Received full request body with metadata:', {
      hasFrameworkDetection: !!requestBody.metadata?.frameworkDetection,
      hasCssDigests: !!requestBody.metadata?.cssDigests,
      hasUiKitDetection: !!requestBody.metadata?.uiKitDetection
    });
  }

  // --- QUICK SUGGESTION HANDLER ---
  private handleSuggestionClick(promptText: string): void {
    if (!promptText) return;

    // Store the prompt to be auto-submitted after element selection
    this.queuedPromptText = promptText;

    // Initiate element selection (same logic as mini-select button)
    if (this.domElements?.viewer) {
      screenCapture.startCapture(this.prepareForInput.bind(this), this.domElements.viewer);
    } else {
      customError('[FeedbackViewerImpl] Cannot start quick suggestion flow: viewer element not available.');
      // Fallback: Just put prompt into textarea as a regular flow
      if (this.domElements?.promptTextarea) {
        this.domElements.promptTextarea.value = promptText;
        this.domElements.promptTextarea.focus();
      }
    }
  }

  private updateSelectionVisuals(element: Element | null, mode: 'replace' | 'insertBefore' | 'insertAfter'): void {
    this.removeSelectionHighlight(); 

    if (!element) {
        this.currentlyHighlightedElement = null; 
        return;
    }
    
    this.currentlyHighlightedElement = element; 
    element.classList.add('checkra-highlight-container'); 

    if (mode === 'insertBefore') {
      element.classList.add('checkra-selected-insert-before');
      this.createPersistentPlusIcon('top', element as HTMLElement);
    } else if (mode === 'insertAfter') {
      element.classList.add('checkra-selected-insert-after');
      this.createPersistentPlusIcon('bottom', element as HTMLElement);
    } else { // replace
      element.classList.add('checkra-selected-replace');
      // No plus icon for replace mode
    }
  }

  private createPersistentPlusIcon(position: 'top' | 'bottom', parentElement: HTMLElement): void {
    if (!this.selectionPlusIconElement) {
      this.selectionPlusIconElement = document.createElement('div');
      this.selectionPlusIconElement.className = 'checkra-insert-indicator'; // Uses styles from screen-capture.ts
      this.selectionPlusIconElement.textContent = '+';
      document.body.appendChild(this.selectionPlusIconElement);
    }
    this.selectionPlusIconElement.classList.remove('top', 'bottom');
    this.selectionPlusIconElement.classList.add(position);

    const parentRect = parentElement.getBoundingClientRect();
    if (position === 'top') {
      this.selectionPlusIconElement.style.top = `${parentRect.top + window.scrollY - 11}px`;
    } else { // bottom
      this.selectionPlusIconElement.style.top = `${parentRect.bottom + window.scrollY - 11}px`;
    }
    this.selectionPlusIconElement.style.left = `${parentRect.left + window.scrollX + parentRect.width / 2 - 11}px`;
    this.selectionPlusIconElement.style.display = 'flex';
  }

  // Method to save the current changes as a private draft
  private async saveSnapshotAsDraft(): Promise<void> {
    if (this.appliedFixes.size === 0) {
      customWarn("[FeedbackViewerImpl] No fixes applied. Nothing to save as draft.");
      // User message is handled by the caller (handleSubmit) for this specific case
      return;
    }

    const changesToSave = Array.from(this.appliedFixes.values()).map(fixInfo => ({
      targetSelector: fixInfo.stableTargetSelector,
      appliedHtml: fixInfo.fixedOuterHTML,
      sessionFixId: fixInfo.originalElementId
    }));
    const siteId = getSiteId();
    const clientGeneratedSnapshotId = crypto.randomUUID();

    const snapshotPayload = {
      snapshotId: clientGeneratedSnapshotId,
      timestamp: new Date().toISOString(),
      pageUrl: window.location.href,
      changes: changesToSave,
      publish: false // Explicitly save as draft
    };

    const postSnapshotUrl = `${API_BASE}/sites/${siteId}/snapshots`;

    try {
      this.renderUserMessage("Saving draft...");
      const postResponse = await fetchProtected(postSnapshotUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshotPayload),
      });

      if (!postResponse.ok) {
        const errorBody = await postResponse.text();
        let specificErrorMessage = `Saving draft failed: ${postResponse.status} ${postResponse.statusText}`;
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

      const postResult = await postResponse.json();
      // Expected response: { message, snapshotId, accessUrl, s3SnapshotPath }

      if (postResult.snapshotId === clientGeneratedSnapshotId && postResult.accessUrl) {
        this.renderUserMessage(`Draft saved successfully! Snapshot ID: ${postResult.snapshotId.substring(0,8)}...`);
        this.renderUserMessage(`Access your draft (owner only): <a href="${postResult.accessUrl}" target="_blank" rel="noopener noreferrer">${postResult.accessUrl}</a>`);
      } else {
        customWarn("[FeedbackViewerImpl] Save draft successful, but snapshotId or accessUrl missing/mismatched in response:", postResult);
        this.renderUserMessage("Draft saved, but could not get the access URL. Snapshot ID: " + (postResult.snapshotId || clientGeneratedSnapshotId).substring(0,8) + "...");
      }

    } catch (error) {
      if (error instanceof AuthenticationRequiredError || (error && (error as any).name === 'AuthenticationRequiredError')) {
        // For saving drafts, we might just inform the user they need to log in.
        // Or, we could try to store the 'save' action similar to 'publish', but it's less critical.
        // For now, inform and let them retry manually after login.
        await this.handleAuthenticationRequiredAndRedirect('saveDraft', { /* minimal data */ }, error as AuthenticationRequiredError);
        this.renderUserMessage("Authentication required to save draft. Please log in and try again.");
      } else {
        customError("[FeedbackViewerImpl] Error during saving draft. Error details follow.");
        if (error instanceof Error) {
          customError("[FeedbackViewerImpl] Draft Save Error Name:", error.name);
          customError("[FeedbackViewerImpl] Draft Save Error Message:", error.message);
          if (error.stack) customError("[FeedbackViewerImpl] Draft Save Error Stack:", error.stack);
          if ((error as any).response && typeof (error as any).response.status === 'number') {
             const response = (error as any).response as Response;
             customError("[FeedbackViewerImpl] Underlying draft save response status:", response.status);
             try {
                const responseBody = await response.text();
                customError("[FeedbackViewerImpl] Underlying draft save response body:", responseBody);
             } catch (bodyError) {
                customError("[FeedbackViewerImpl] Could not read underlying draft save response body:", bodyError);
             }
          }
        } else {
          customError("[FeedbackViewerImpl] Caught a non-Error object during draft save:", error);
        }
        const displayErrorMessage = error instanceof Error ? error.message : String(error);
        this.showError(`Failed to save draft: ${displayErrorMessage}`);
      }
    }
  }

  private handleJsonPatch(patchEvent: { payload: any; originalHtml: string }): void {
    try {
      const { payload, originalHtml } = patchEvent;

      let patchArray: any = null;
      if (typeof payload === 'string') {
        try {
          patchArray = JSON.parse(payload);
        } catch (e) {
          customError('[FeedbackViewerImpl] Failed to parse JSON patch payload string:', e, payload);
          this.showError('Failed to parse JSON patch from AI response.');
          return;
        }
      } else {
        patchArray = payload;
      }

      customWarn('[FeedbackViewerImpl] Received aiJsonPatch payload. Type:', typeof patchArray, 'Array?', Array.isArray(patchArray));
 
      if (!Array.isArray(patchArray)) {
        customError('[FeedbackViewerImpl] Patch payload is not an array:', patchArray);
        this.showError('Invalid JSON patch received from AI.');
        return;
      }

      customWarn('[FeedbackViewerImpl] Patch array length:', patchArray.length, 'First element snippet:', JSON.stringify(patchArray[0]).slice(0,150));
 
      // Extract the replacement HTML from the patch (root-level replace op)
      let updatedHtml: string | null = null;
      for (const op of patchArray) {
        if (op && op.op === 'replace' && (op.path === '' || op.path === '/')) {
          updatedHtml = op.value as string;
          break;
        }
      }

      if (!updatedHtml || typeof updatedHtml !== 'string') {
        customWarn('[FeedbackViewerImpl] No applicable replace op found in JSON patch. Falling back to originalHtml.');
        updatedHtml = originalHtml;
      }

      // Clean up: if the value includes commentary or markdown before the real HTML, trim to first HTML tag
      const firstTagIndex = updatedHtml.indexOf('<');
      if (firstTagIndex > 0) {
        updatedHtml = updatedHtml.slice(firstTagIndex);
      }

      // Restore any SVG placeholders back to real SVGs
      try {
        updatedHtml = this.postprocessHtmlFromAI(updatedHtml);
      } catch (e) {
        customWarn('[FeedbackViewerImpl] postprocessHtmlFromAI failed on JSON patch HTML:', e);
      }

      // Remove any leading comment or plaintext nodes that are not valid elements
      const scrubLeadingNonElement = (html: string): string => {
        const frag = this.createFragmentFromHTML(html);
        if (!frag) return html;

        // Remove nodes from the start until we hit an element node
        while (frag.firstChild && (frag.firstChild.nodeType === Node.COMMENT_NODE || frag.firstChild.nodeType === Node.TEXT_NODE)) {
          const textNode = frag.firstChild;
          if (textNode.nodeType === Node.TEXT_NODE) {
            // If it's just whitespace, remove; if it's visible text (human commentary), also drop it.
            const textContent = textNode.textContent || '';
            if (textContent.trim() === '') {
              textNode.parentNode?.removeChild(textNode);
            } else {
              // For non-whitespace text, also remove – commentary should not be inserted into DOM
              textNode.parentNode?.removeChild(textNode);
            }
          } else {
            // Comment node – always remove
            textNode.parentNode?.removeChild(textNode);
          }
        }

        // Serialize back by creating a temporary container
        const tempContainer = document.createElement('div');
        tempContainer.appendChild(frag);
        return tempContainer.innerHTML;
      };

      updatedHtml = scrubLeadingNonElement(updatedHtml);

      const testFrag = this.createFragmentFromHTML(updatedHtml);
      if (!testFrag || testFrag.childNodes.length === 0) {
        customError('[FeedbackViewerImpl] Parsed HTML from JSON patch is empty/invalid after scrubbing – will skip applying.');
        return;
      }

      this.fixedOuterHTMLForCurrentCycle = updatedHtml;

      // Ensure there is an active AI placeholder to mark as non-streaming (content was already streamed)
      if (this.activeStreamingAiItem) {
        // We simply keep whatever analysis content was streamed; no need to clear it.
      }

      // After storing fixed HTML, we rely on finalizeResponse (triggered by aiFinalized) to apply the fix.

    } catch (err) {
      customError('[FeedbackViewerImpl] Error handling aiJsonPatch event:', err);
      this.showError('An error occurred while applying AI suggested changes.');
    }
  }

  // ADDED: Handler for the rating button click
  private handleAppliedFixRate(fixId: string, event: Event): void {
    event.stopPropagation();
    const fixInfo = this.appliedFixes.get(fixId);
    const rateButton = (event.currentTarget as HTMLElement);

    if (!fixInfo || !fixInfo.appliedWrapperElement || !rateButton || (rateButton as HTMLButtonElement).disabled) {
      // Also check if button is disabled
      customWarn(`[FeedbackViewerLogic] Cannot rate: Fix info/elements missing or already rated/disabled for Fix ID: ${fixId}.`);
      return;
    }

    // Check if a rating options container already exists, remove if so to toggle off
    let existingOptionsContainer = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-rating-options');
    if (existingOptionsContainer) {
      existingOptionsContainer.remove();
      return; 
    }

    const ratingOptionsContainer = document.createElement('div');
    ratingOptionsContainer.className = 'feedback-fix-rating-options';
    ratingOptionsContainer.style.position = 'absolute';
    ratingOptionsContainer.style.zIndex = '10000'; 
    ratingOptionsContainer.style.right = '0px'; 
    ratingOptionsContainer.style.top = '30px';

    const ratings = [
      { value: 1, text: '★ Not OK' },
      { value: 2, text: '★★ OK' },
      { value: 3, text: '★★★ Pretty good' },
      { value: 4, text: '★★★★ Wow!' },
    ];

    ratings.forEach(rating => {
      const optionElement = document.createElement('div');
      optionElement.className = 'feedback-rating-option';
      optionElement.textContent = rating.text;
      optionElement.setAttribute('data-rating-value', rating.value.toString());
      
      optionElement.addEventListener('click', (e) => {
        // Check if the click target is within an existing feedback form.
        // If so, don't re-process this click on the optionElement itself.
        const existingForm = optionElement.querySelector('.feedback-rating-feedback-form');
        if (existingForm && existingForm.contains(e.target as Node)) {
          return; // Click was inside the form, do nothing here.
        }

        e.stopPropagation();
        // If rating is 1 or 2, show feedback input and submit button
        if (rating.value === 1 || rating.value === 2) {
          // Remove any existing feedback form
          const existingForm = ratingOptionsContainer.querySelector('.feedback-rating-feedback-form');
          if (existingForm) existingForm.remove();

          const feedbackForm = document.createElement('form');
          feedbackForm.className = 'feedback-rating-feedback-form';
          feedbackForm.style.display = 'flex';
          feedbackForm.style.flexDirection = 'column';
          feedbackForm.style.gap = '6px';
          feedbackForm.style.marginTop = '8px';

          // Prevent click from bubbling up to optionElement and recreating form - NO LONGER NEEDED HERE
          // feedbackForm.addEventListener('click', (ev) => ev.stopPropagation());

          const feedbackInput = document.createElement('input');
          feedbackInput.type = 'text';
          feedbackInput.placeholder = 'Optional feedback (what could be improved?)';
          feedbackInput.className = 'feedback-rating-feedback-input';
          feedbackInput.style.padding = '6px 8px';
          feedbackInput.style.borderRadius = '8px';
          feedbackInput.style.border = '1px solid #888';
          feedbackInput.style.fontSize = '12px';
          feedbackInput.style.background = '#222';
          feedbackInput.style.color = '#eee';

          // Prevent click from bubbling up to optionElement and recreating form - NO LONGER NEEDED HERE
          // feedbackInput.addEventListener('click', (ev) => ev.stopPropagation());

          // --- Chips ---
          const chipLabels = ['ugly', 'off brand', 'broken', 'copy', 'colors', 'layout', 'spacing'];
          const chipsContainer = document.createElement('div');
          chipsContainer.style.display = 'flex';
          chipsContainer.style.gap = '6px';
          chipsContainer.style.margin = '6px 0 0 0';
          chipsContainer.style.flexWrap = 'wrap';

          let selectedChips: Set<string> = new Set();

          chipLabels.forEach(label => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.textContent = label;
            chip.className = 'feedback-rating-chip';
            chip.addEventListener('click', (ev) => {
              ev.preventDefault();
              ev.stopPropagation(); // Prevent event from bubbling up to parent elements
              if (selectedChips.has(label)) {
                selectedChips.delete(label);
                chip.classList.remove('active');
              } else {
                selectedChips.add(label);
                chip.classList.add('active');
              }
              updateSubmitState();
            });
            chipsContainer.appendChild(chip);
          });

          // --- Submit button ---
          const submitBtn = document.createElement('button');
          submitBtn.type = 'button';
          submitBtn.textContent = 'submit rating';
          submitBtn.className = 'feedback-rating-feedback-submit';
          Object.assign(submitBtn.style, {
            marginTop: '2px',
            padding: '6px 10px',
            borderRadius: '8px',
            background: '#2563eb',
            color: '#fff',
            fontWeight: 'bold',
            fontSize: '12px',
            border: 'none',
            cursor: 'pointer',
            opacity: '0.7'
          } as CSSStyleDeclaration);
          submitBtn.disabled = true;

          function updateSubmitState() {
            const feedbackVal = feedbackInput.value.trim();
            if (feedbackVal.length > 0 || selectedChips.size > 0) {
              submitBtn.disabled = false;
              submitBtn.style.opacity = '1';
            } else {
              submitBtn.disabled = true;
              submitBtn.style.opacity = '0.7';
            }
          }

          feedbackInput.addEventListener('input', updateSubmitState);

          feedbackForm.appendChild(feedbackInput);
          feedbackForm.appendChild(chipsContainer);
          feedbackForm.appendChild(submitBtn);

          // Remove the form submit handler entirely

          // Add click handler to submitBtn
          submitBtn.addEventListener('click', () => {
            console.log('submitBtn clicked');
            const feedbackVal = feedbackInput.value.trim();
            if (fixInfo.requestBody) {
              const feedbackPayload: AddRatingRequestBody = {
                ...fixInfo.requestBody,
                rating: rating.value as 1 | 2 | 3 | 4,
                feedback: feedbackVal || undefined,
                fixId: fixId,
                tags: selectedChips.size > 0 ? Array.from(selectedChips) : undefined,
                generatedHtml: fixInfo.fixedOuterHTML,
              };
              console.log('POSTING fixRated payload:', feedbackPayload);
              eventEmitter.emit('fixRated', feedbackPayload);
              customWarn(`[FeedbackViewerImpl] Fix rated: ${rating.value} for fixId: ${fixId} with feedback: ${feedbackVal} and tags: ${Array.from(selectedChips).join(',')}`);
              fixInfo.isRated = true;
              rateButton.classList.add('rated');
              (rateButton as HTMLButtonElement).disabled = true;
              ratingOptionsContainer.remove();
            }
          });

          feedbackInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              submitBtn.click();
            }
          });

          optionElement.appendChild(feedbackForm);
          feedbackInput.focus();
          updateSubmitState();
        } else {
          // For ratings 3 or 4, submit immediately
          if (fixInfo.requestBody) {
            const feedbackPayload: AddRatingRequestBody = {
              ...fixInfo.requestBody,
              rating: rating.value as 1 | 2 | 3 | 4,
              fixId: fixId,
              generatedHtml: fixInfo.fixedOuterHTML,
            };
            eventEmitter.emit('fixRated', feedbackPayload);
            customWarn(`[FeedbackViewerImpl] Fix rated: ${rating.value} for fixId: ${fixId}`);
            fixInfo.isRated = true;
            rateButton.classList.add('rated');
            (rateButton as HTMLButtonElement).disabled = true;
          }
          ratingOptionsContainer.remove();
        }
      });
      ratingOptionsContainer.appendChild(optionElement);
    });

    // Add a click outside listener to close the options container
    const clickOutsideListener = (ev: MouseEvent) => {
      if (!ratingOptionsContainer.contains(ev.target as Node) && ev.target !== rateButton) {
        ratingOptionsContainer.remove();
        document.removeEventListener('click', clickOutsideListener, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('click', clickOutsideListener, true);
    }, 0);

    const controlsContainer = rateButton.parentElement;
    if (controlsContainer) {
        controlsContainer.appendChild(ratingOptionsContainer);
    } else {
        fixInfo.appliedWrapperElement.appendChild(ratingOptionsContainer);
    }
  }

  private handleDomUpdate(data: { html: string; insertionMode: 'replace' | 'insertBefore' | 'insertAfter' }): void {
    customWarn('[CheckraImplementation] Received aiDomUpdateReceived', data);
    if (!this.currentlyHighlightedElement) {
      customError('[CheckraImplementation] No currentlyHighlightedElement to apply DOM update to.');
      this.showError('No element was selected to apply the changes to.');
      return;
    }

    const { html, insertionMode } = data;
    let processedHtml = html;

    const fenceRegex = /^```(?:html)?\n([\s\S]*?)\n```$/i;
    const fenceMatch = processedHtml.match(fenceRegex);
    if (fenceMatch && fenceMatch[1]) {
      processedHtml = fenceMatch[1].trim();
      customWarn('[CheckraImplementation] Stripped Markdown fences from domUpdateHtml content.');
    }

    try {
      processedHtml = this.postprocessHtmlFromAI(processedHtml); 
      const scrubLeadingNonElement = (incomingHtml: string): string => {
        const frag = this.createFragmentFromHTML(incomingHtml);
        if (!frag) return incomingHtml;
        while (frag.firstChild && (frag.firstChild.nodeType === Node.COMMENT_NODE || frag.firstChild.nodeType === Node.TEXT_NODE)) {
          const textNode = frag.firstChild;
          if (textNode.nodeType === Node.TEXT_NODE) {
            const textContent = textNode.textContent || '';
            if (textContent.trim() === '') {
              textNode.parentNode?.removeChild(textNode);
            } else {
              textNode.parentNode?.removeChild(textNode);
            }
          } else {
            textNode.parentNode?.removeChild(textNode);
          }
        }
        const tempContainer = document.createElement('div');
        tempContainer.appendChild(frag);
        return tempContainer.innerHTML;
      };
      processedHtml = scrubLeadingNonElement(processedHtml);

    } catch (e) {
      customWarn('[CheckraImplementation] postprocessHtmlFromAI or scrubbing failed on domUpdateHtml:', e);
    }

    const finalHtmlToApply = processedHtml;

    const testFrag = this.createFragmentFromHTML(finalHtmlToApply);
    if (!testFrag || testFrag.childNodes.length === 0) {
      customError('[CheckraImplementation] HTML for domUpdate is empty/invalid after processing. Aborting DOM update.');
      this.showError('AI generated empty content, nothing to apply.');
      return;
    }

    // Ensure necessary context is available before calling applyFixToPage
    if (!this.currentFixId || !this.originalOuterHTMLForCurrentCycle || !this.requestBodyForCurrentCycle || !this.stableSelectorForCurrentCycle) {
        customError('[CheckraImplementation] Missing context for applyFixToPage in handleDomUpdate.', {
            fixId: this.currentFixId,
            originalHtml: this.originalOuterHTMLForCurrentCycle,
            requestBody: this.requestBodyForCurrentCycle,
            stableSelector: this.stableSelectorForCurrentCycle
        });
        this.showError('Internal error: Could not apply changes due to missing context.');
        // Fallback to direct insertion without controls if context is missing, to at least show the HTML.
        // This is a degraded experience but better than nothing if context is somehow lost.
        if (this.currentlyHighlightedElement) {
          customWarn('[CheckraImplementation] Fallback: performing direct DOM insertion in handleDomUpdate due to missing context for controls.')
          try {
              switch (insertionMode) {
                  case 'insertBefore': this.currentlyHighlightedElement.insertAdjacentHTML('beforebegin', finalHtmlToApply); break;
                  case 'insertAfter': this.currentlyHighlightedElement.insertAdjacentHTML('afterend', finalHtmlToApply); break;
                  case 'replace': this.currentlyHighlightedElement.outerHTML = finalHtmlToApply; this.currentlyHighlightedElement = null; break;
              }
              this.removeSelectionHighlight();
          } catch (directInsertError) {
              customError('[CheckraImplementation] Error during fallback direct DOM insertion:', directInsertError);
          }
        } else {
          customError('[CheckraImplementation] Cannot perform fallback direct DOM insertion, currentlyHighlightedElement is null.');
        }
        return;
    }

    // Call applyFixToPage to ensure controls are added and fix is tracked
    this.applyFixToPage(
        this.currentFixId,
        this.originalOuterHTMLForCurrentCycle,
        finalHtmlToApply, // This is the fixedHTML
        insertionMode,
        this.requestBodyForCurrentCycle,
        this.stableSelectorForCurrentCycle
    );

    customWarn(`[CheckraImplementation] DOM update via applyFixToPage initiated with mode: ${insertionMode}`);
      
    if (this.activeStreamingAiItem) {
        this.activeStreamingAiItem.isStreaming = false;
        this.domManager?.updateLastAIMessage(this.activeStreamingAiItem.content, false); 
    }
    this.activeStreamingAiItem = null;
    this.requestBodyForCurrentCycle = null; // Clear after use, similar to finalizeResponse

    // Note: applyFixToPage itself calls removeSelectionHighlight, so no need to call it here again.
    // Also, if mode is 'replace', applyFixToPage doesn't nullify currentlyHighlightedElement directly,
    // but the element with data-checkra-fix-id is removed and replaced by the wrapper.
    // The original selection highlight should be gone due to applyFixToPage's own call.
  }

  private showReplaceLoader(targetElement: Element): void {
    if (this.pageReplaceLoaderElement) {
        this.pageReplaceLoaderElement.remove(); // Remove if already exists
    }
    this.pageReplaceLoaderElement = createCenteredLoaderElement(); // Uses the module-level helper
    
    if (!targetElement.classList.contains('checkra-highlight-container')) {
        targetElement.classList.add('checkra-highlight-container');
    }

    targetElement.appendChild(this.pageReplaceLoaderElement);
    targetElement.classList.add('checkra-element-dimmed');
  }

  private hidePageLoaders(): void {
    if (this.selectionPlusIconElement) {
        this.selectionPlusIconElement.classList.remove('loading');
    }
    if (this.pageReplaceLoaderElement) {
        this.pageReplaceLoaderElement.remove();
        this.pageReplaceLoaderElement = null;
    }
    const dimmedElements = document.querySelectorAll('.checkra-element-dimmed');
    dimmedElements.forEach(el => el.classList.remove('checkra-element-dimmed'));
  }

  // --- End of CheckraImplementation class ---
}

// Helper function placed at module level
function createCenteredLoaderElement(): HTMLDivElement {
    const loaderOuter = document.createElement('div');
    loaderOuter.className = 'checkra-replace-loader'; // Positioned container

    const spinnerInner = document.createElement('div');
    spinnerInner.className = 'checkra-spinner-inner'; // Actual spinning element with border
    loaderOuter.appendChild(spinnerInner);

    return loaderOuter;
}

// Helper function to get a user-friendly display name for a query
function getFriendlyQueryName(queryName: string): string {
  switch (queryName) {
    case 'metrics_1d':
      return 'Stats (last 24h)';
    case 'metrics_7d':
      return 'Stats (last 7d)';
    case 'geo_top5_7d':
      return 'Top Countries (last 7d)';
    default:
      return queryName.replace(/_/g, ' '); // Default fallback
  }
}