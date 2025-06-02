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
import { GenerateSuggestionRequestbody, AddRatingRequestBody, ResolvedColorInfo } from '../types'; // Added BackendPayloadMetadata and RequestBodyFeedback import
import { OverlayManager } from './overlay-manager';


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
  originalElementId: string; 
  originalOuterHTML: string; 
  fixedOuterHTML: string; 
  // appliedWrapperElement: HTMLDivElement | null; // REMOVED
  markerStartNode: Comment | null; // ADDED: Reference to the start marker comment node
  markerEndNode: Comment | null;   // ADDED: Reference to the end marker comment node
  actualAppliedElement: HTMLElement | null; // ADDED: The first actual element node of the applied fix
  isCurrentlyFixed: boolean; 
  stableTargetSelector: string; 
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter'; 
  requestBody: GenerateSuggestionRequestbody; 
  isRated?: boolean; 
  resolvedColors?: ResolvedColorInfo; 
}

// localStorage keys for pending actions
const PENDING_ACTION_TYPE_KEY = 'checkra_auth_pending_action_type';
const PENDING_ACTION_DATA_KEY = 'checkra_auth_pending_action_data';

// ADDED: Helper function to convert rgb/rgba to hex
function rgbToHex(rgbString: string): string | null {
  if (!rgbString || rgbString.toLowerCase() === 'transparent' || rgbString === 'rgba(0, 0, 0, 0)') {
    return null; // Treat transparent as needing a default fallback (e.g., #FFFFFF)
  }

  const match = rgbString.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d*\.?\d+))?\)$/i);
  if (!match) {
    // If it doesn't match rgb/rgba, it might already be hex or a named color.
    // For simplicity, if it starts with #, assume it's hex. Otherwise, can't convert here.
    if (rgbString.startsWith('#')) return rgbString;
    return null; // Cannot convert other formats like named colors here, fallback needed
  }

  // If alpha is 0, it's effectively transparent
  if (match[4] && parseFloat(match[4]) === 0) {
    return null;
  }

  const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
  const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
  const b = parseInt(match[3], 10).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
}

/**
 * Handles the logic, state, and interactions for the feedback viewer.
 */
export class CheckraImplementation {
  private domElements: CheckraViewerElements | null = null;
  private domManager: CheckraDOM | null = null;
  private settingsModal: SettingsModal | null = null;
  private overlayManager: OverlayManager; // ADDED: OverlayManager instance
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
  private currentComputedBackgroundColor: string | null = null; // ADDED for backend WCAG checks
  private currentResolvedColors: ResolvedColorInfo | null = null; // ADDED: For incoming resolved colors
  private lastAppliedFixResolvedColors: ResolvedColorInfo | null = null; // ADDED: For rating the last applied fix

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
  private boundHandleResolvedColorsUpdate = this.handleResolvedColorsUpdate.bind(this); // ADDED

  constructor(
    private onToggleCallback: (isVisible: boolean) => void,
    initialVisibilityFromOptions: boolean = false, // New parameter
    enableRating: boolean = false // ADDED: enableRating parameter
  ) {
    this.optionsInitialVisibility = initialVisibilityFromOptions;
    this.enableRating = enableRating; // Store it
    this.overlayManager = new OverlayManager(); // ADDED: Instantiate OverlayManager
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
    eventEmitter.on('internalResolvedColorsUpdate', this.boundHandleResolvedColorsUpdate); // ADDED

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
      // const fixInfo = this.appliedFixes.get(fixId); // TODO: Revisit cleanup with new marker/overlay system
      // if (fixInfo?.appliedWrapperElement) { // OLD WRAPPER LOGIC - TO BE REPLACED
      //   const closeBtn = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-close-btn');
      //   const toggleBtn = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-toggle');
      //   closeBtn?.removeEventListener('click', listeners.close);
      //   toggleBtn?.removeEventListener('click', listeners.toggle);
      //   const copyBtn = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-copy-btn');
      //   copyBtn?.removeEventListener('click', listeners.copy);
      //   const rateBtn = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-rate-btn');
      //   rateBtn?.removeEventListener('click', listeners.rate);
      // }
    });
    this.appliedFixListeners.clear(); // Listeners are managed by OverlayManager or on buttons themselves

    this.overlayManager.removeAllControlsAndOverlay(); // ADDED: Cleanup overlay

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
    eventEmitter.off('internalResolvedColorsUpdate', this.boundHandleResolvedColorsUpdate); // ADDED

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

    // --- Determine and store computed background color ---
    if (targetElement) {
      let el: HTMLElement | null = targetElement as HTMLElement;
      let rawBgColor = 'rgba(0, 0, 0, 0)'; // Default to transparent
      while (el) {
        const style = window.getComputedStyle(el);
        rawBgColor = style.backgroundColor;
        if (rawBgColor && rawBgColor !== 'rgba(0, 0, 0, 0)' && rawBgColor !== 'transparent') {
          break; // Found an opaque color
        }
        if (el === document.body) break;
        el = el.parentElement;
      }
      // Convert to hex, defaulting to #FFFFFF if conversion fails or color is transparent
      this.currentComputedBackgroundColor = rgbToHex(rawBgColor) || '#FFFFFF';
      customWarn('[CheckraImpl] Computed BG for context:', this.currentComputedBackgroundColor, 'from element:', targetElement, '(raw was:', rawBgColor, ')');
    } else {
      this.currentComputedBackgroundColor = '#FFFFFF'; // Default for body or no selection
      customWarn('[CheckraImpl] No targetElement, defaulting computed BG to #FFFFFF');
    }
    // --- End: Determine computed background color ---

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

    // --- MODIFIED/SIMPLIFIED logic for applying the fix ---
    if (
      this.currentFixId &&
      this.originalOuterHTMLForCurrentCycle &&
      this.fixedOuterHTMLForCurrentCycle && // This is the source of truth for the final HTML
      this.requestBodyForCurrentCycle &&    // Ensure we have the full request context
      this.stableSelectorForCurrentCycle     // Ensure we have the stable selector
    ) {
      customWarn('[FeedbackViewerImpl] FinalizeResponse: Applying fix with all conditions met.');
      this.applyFixToPage(
        this.currentFixId,
        this.originalOuterHTMLForCurrentCycle,
        this.fixedOuterHTMLForCurrentCycle, // Use the processed HTML
        this.currentElementInsertionMode,
        this.requestBodyForCurrentCycle,    // Pass the stored full request body
        this.stableSelectorForCurrentCycle
      );
      // Clear the request body for the current cycle AFTER it has been used for applying the fix.
      this.requestBodyForCurrentCycle = null;
    } else {
      customError('[FeedbackViewerImpl] FinalizeResponse: CANNOT apply fix. One or more critical pieces of context are missing.', {
        currentFixId: !!this.currentFixId,
        originalOuterHTML: !!this.originalOuterHTMLForCurrentCycle,
        fixedOuterHTML: !!this.fixedOuterHTMLForCurrentCycle,
        requestBody: !!this.requestBodyForCurrentCycle,
        stableSelector: !!this.stableSelectorForCurrentCycle,
        currentInsertionMode: this.currentElementInsertionMode
      });
      // If fixedOuterHTMLForCurrentCycle was set but we couldn't apply, it implies an issue with other context gathering.
      if (this.fixedOuterHTMLForCurrentCycle) {
        customWarn('[FeedbackViewerImpl] Fixed HTML was available, but other context prevented applying the fix. The viewer might be in an inconsistent state.');
      }
      // If requestBodyForCurrentCycle was the missing piece, it might indicate an issue with the requestBodyPrepared event or its timing.
      if (!this.requestBodyForCurrentCycle && this.fixedOuterHTMLForCurrentCycle) {
          customError('[FeedbackViewerImpl] Critical: requestBodyForCurrentCycle was missing when trying to apply a fix for which HTML was ready.');
      }
    }
    // this.fixedOuterHTMLForCurrentCycle is reset within applyFixToPage (if called) or by resetStateForNewSelection.
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
    this.currentComputedBackgroundColor = null; // Reset for next cycle
    this.currentResolvedColors = null; // ADDED: Reset for next cycle
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
    // ADDED: Pass currentComputedBackgroundColor to fetchFeedback
    fetchFeedback(imageDataToSend, promptText, processedHtmlForAI, this.currentElementInsertionMode, this.currentComputedBackgroundColor);
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

    if (!fixInfo || !fixInfo.markerStartNode || !fixInfo.markerEndNode) {
      customWarn(`[FeedbackViewerLogic] Could not find fix info or markers for Fix ID: ${fixId} during close.`);
      this.overlayManager.hideControls(); 
      this.appliedFixes.delete(fixId);
      this.appliedFixListeners.delete(fixId); 
      return;
    }

    const { markerStartNode, markerEndNode, originalOuterHTML, insertionMode, stableTargetSelector } = fixInfo;
    const parent = markerStartNode.parentNode;

    if (!parent) {
      customError(`[FeedbackViewerLogic] Parent node of markers not found for fix ${fixId}. Cannot revert.`);
      // Attempt to remove controls as a fallback
      document.querySelector(`.checkra-fix-controls-container[data-controls-for-fix="${fixId}"]`)?.remove();
      this.appliedFixes.delete(fixId);
      this.appliedFixListeners.delete(fixId);
      return;
    }

    try {
      // Remove all nodes between start and end markers (inclusive of end, exclusive of start initially)
      let currentNode = markerStartNode.nextSibling;
      while (currentNode && currentNode !== markerEndNode) {
        const next = currentNode.nextSibling;
        parent.removeChild(currentNode);
        currentNode = next;
      }

      if (insertionMode === 'replace') {
        const originalFragment = this.createFragmentFromHTML(originalOuterHTML);
        if (!originalFragment || originalFragment.childNodes.length === 0) {
          throw new Error('Failed to parse original HTML for revert.');
        }
        
        // Insert original content before where the end marker was (or is, if not removed yet)
        parent.insertBefore(originalFragment, markerEndNode);

        // Re-tag the first element of the reverted content so it can be selected again
        let firstRevertedElement = markerStartNode.nextSibling;
        while(firstRevertedElement && firstRevertedElement.nodeType !== Node.ELEMENT_NODE) {
            firstRevertedElement = firstRevertedElement.nextSibling;
        }
        if (firstRevertedElement && firstRevertedElement !== markerEndNode) {
            (firstRevertedElement as HTMLElement).setAttribute('data-checkra-fix-id', fixId);
            // Also, update actualAppliedElement in fixInfo if we were to keep the fix (e.g. for a redo later)
            // For close, we are deleting the fix, so this isn't strictly necessary for this operation.
        } else {
            customWarn(`[FeedbackViewerLogic] Could not find first element of reverted content for fix ${fixId} to re-tag.`);
        }
      } 
      // For 'insertBefore' or 'insertAfter', removing nodes between markers is sufficient as original was not touched.
      
      // Remove markers themselves
      markerStartNode.remove();
      markerEndNode.remove();

      // Remove controls (now handled by OverlayManager)
      this.overlayManager.hideControls(); 

      // Clean up state
      const listeners = this.appliedFixListeners.get(fixId);
      if (listeners) {
        // Buttons are removed with controls, so no need to remove listeners from them individually IF controls are gone
        this.appliedFixListeners.delete(fixId);
      }
      this.appliedFixes.delete(fixId);

    } catch (error) {
      customError(`[FeedbackViewerLogic] Error closing/reverting fix ${fixId} (mode: ${insertionMode}):`, error);
      // Fallback: try to remove markers and controls if error occurred mid-operation
      markerStartNode?.remove();
      markerEndNode?.remove();
      this.overlayManager.hideControls(); 
      this.appliedFixes.delete(fixId);
      this.appliedFixListeners.delete(fixId);
    }
  }

  private handleAppliedFixToggle(fixId: string, event: Event): void {
    event.stopPropagation();
    const fixInfo = this.appliedFixes.get(fixId);
    const toggleButton = event.currentTarget as HTMLButtonElement | null; // Get button from the event

    if (!fixInfo || !fixInfo.markerStartNode || !fixInfo.markerEndNode) {
      customWarn(`[FeedbackViewerLogic] Toggle: Could not find fix info or markers for Fix ID: ${fixId}.`);
      return;
    }

    // Ensure toggleButton is actually the one we expect, though currentTarget should be reliable here
    if (!toggleButton || !toggleButton.classList.contains('feedback-fix-toggle') || toggleButton.dataset.fixId !== fixId) {
        customError(`[FeedbackViewerLogic] Toggle: Event target is not the expected toggle button for fix ${fixId}.`);
        // If we don't have the button, we can still toggle content but can't update button visuals.
    }

    const { markerStartNode, markerEndNode, originalOuterHTML, fixedOuterHTML, insertionMode } = fixInfo;
    const parent = markerStartNode.parentNode;

    if (!parent) {
      customError(`[FeedbackViewerLogic] Toggle: Parent node of markers not found for fix ${fixId}.`);
      return;
    }

    try {
      const htmlToInsert = fixInfo.isCurrentlyFixed ? originalOuterHTML : fixedOuterHTML;
      
      let currentNode = markerStartNode.nextSibling;
      while (currentNode && currentNode !== markerEndNode) {
        const nextNode = currentNode.nextSibling;
        parent.removeChild(currentNode);
        currentNode = nextNode;
      }

      const newContentFragment = this.createFragmentFromHTML(htmlToInsert);

      if (newContentFragment && newContentFragment.childNodes.length > 0) {
        parent.insertBefore(newContentFragment, markerEndNode);
        let firstNewElement = markerStartNode.nextSibling;
        while(firstNewElement && firstNewElement.nodeType !== Node.ELEMENT_NODE) {
            firstNewElement = firstNewElement.nextSibling;
        }
        const newActualAppliedElement = (firstNewElement && firstNewElement !== markerEndNode) ? firstNewElement as HTMLElement : null;
        if (fixInfo.actualAppliedElement !== newActualAppliedElement) {
            fixInfo.actualAppliedElement = newActualAppliedElement;
            // If the actual element changed and controls are visible, tell OverlayManager to update position for this fix
            if (fixInfo.actualAppliedElement && this.overlayManager.isFixControlsVisible(fixId)) { // NEW: Need isFixControlsVisible
                 this.overlayManager.updateControlsPositionForFix(fixId, fixInfo.actualAppliedElement); // NEW: Need updateControlsPositionForFix
            }
        }
      } else {
        customError(`[FeedbackViewerLogic] Toggle: Failed to parse HTML (or HTML was empty) for fixId: ${fixId}.`);
        fixInfo.actualAppliedElement = null; 
      }

      fixInfo.isCurrentlyFixed = !fixInfo.isCurrentlyFixed;

      if (toggleButton) {
        if (fixInfo.isCurrentlyFixed) {
          toggleButton.classList.add('toggled-on');
          toggleButton.title = "Toggle Original Version";
        } else {
          toggleButton.classList.remove('toggled-on');
          toggleButton.title = "Toggle Fixed Version";
        }
      }

    } catch (error) {
      customError(`[FeedbackViewerLogic] Error toggling fix ${fixId} (mode: ${insertionMode}):`, error);
      if (toggleButton && fixInfo) { 
        if (fixInfo.isCurrentlyFixed) {
          toggleButton.classList.add('toggled-on');
          toggleButton.title = "Toggle Original Version";
        } else {
          toggleButton.classList.remove('toggled-on');
          toggleButton.title = "Toggle Fixed Version";
        }
      }
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
      const parent = originalSelectedElement.parentNode;

      // --- START: New Marker-Based Fix Application ---
      const startComment = document.createComment(` checkra-fix-start:${fixId} `);
      const endComment = document.createComment(` checkra-fix-end:${fixId} `);
      let actualAppliedElement: HTMLElement | null = null;

      if (insertionMode === 'replace') {
        parent.insertBefore(startComment, originalSelectedElement);
        
        // Use a temporary div to parse fixedHtml and get actual nodes
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = fixedHtml.trim();
        const newNodes = Array.from(tempDiv.childNodes);

        if (newNodes.length > 0) {
          newNodes.forEach(node => parent.insertBefore(node, originalSelectedElement));
          actualAppliedElement = newNodes.find(node => node.nodeType === Node.ELEMENT_NODE) as HTMLElement || null;
        } else {
          // If fixedHtml is empty or only comments/text, insert a placeholder or handle error
          customWarn(`[FeedbackViewerLogic] FixedHTML for ${fixId} resulted in no actual nodes. Original was kept.`);
          // Fallback: remove startComment if no actual content is replacing originalSelectedElement
          parent.removeChild(startComment);
          // Keep originalSelectedElement in place, do not remove it if fixedHtml is empty.
          // No endComment needed if nothing was effectively inserted.
          // actualAppliedElement remains null
        }
        
        // Only remove originalSelectedElement if newNodes were actually inserted
        if (newNodes.length > 0) {
          parent.removeChild(originalSelectedElement);
          // Insert endComment after the last of the new nodes
          const lastNewNode = newNodes[newNodes.length - 1];
          if (lastNewNode.nextSibling) {
            parent.insertBefore(endComment, lastNewNode.nextSibling);
          } else {
            parent.appendChild(endComment);
          }
        } else {
          // If fixedHTML was empty, remove the start comment as nothing was actually applied to replace the original
          // and originalSelectedElement is kept.
          // No need to re-add data-checkra-fix-id as it was never removed from originalSelectedElement
        }

      } else if (insertionMode === 'insertBefore') {
        parent.insertBefore(startComment, originalSelectedElement);
        originalSelectedElement.insertAdjacentHTML('beforebegin', fixedHtml);
        actualAppliedElement = startComment.nextElementSibling as HTMLElement | null;
        // Insert endComment before the originalSelectedElement, which is after all parts of fixedHtml
        parent.insertBefore(endComment, originalSelectedElement);
      } else if (insertionMode === 'insertAfter') {
        parent.insertBefore(startComment, originalSelectedElement.nextSibling);
        originalSelectedElement.insertAdjacentHTML('afterend', fixedHtml);
        actualAppliedElement = originalSelectedElement.nextElementSibling as HTMLElement | null;
        // Find the true end of the inserted content to place the endComment
        let currentElement = actualAppliedElement;
        let lastSiblingOfFix = actualAppliedElement;
        while(currentElement && currentElement.nextSibling !== endComment && currentElement !== originalSelectedElement) {
            if (currentElement.nodeType === Node.COMMENT_NODE && currentElement.nodeValue === ` checkra-fix-start:${fixId} `) break; // Should not happen here, but safety
            lastSiblingOfFix = currentElement as HTMLElement;
            currentElement = currentElement.nextElementSibling as HTMLElement | null;
        }
        if (lastSiblingOfFix && lastSiblingOfFix.nextSibling) {
             parent.insertBefore(endComment, lastSiblingOfFix.nextSibling);
        } else {
             parent.appendChild(endComment);
        }
      }
      // --- END: New Marker-Based Fix Application ---

      // --- Controls Container (Temporary: Appended to body) ---
      // This section will be replaced by OverlayManager in Phase 2
      // const controlsContainer = document.createElement('div');
      // controlsContainer.className = 'checkra-fix-controls-container';
      // controlsContainer.setAttribute('data-controls-for-fix', fixId); // To identify it later
      
      const closeBtn = this.createAppliedFixButton('close', fixId);
      const toggleBtn = this.createAppliedFixButton('toggle', fixId);
      const copyBtn = this.createAppliedFixButton('copy', fixId);
      let rateBtn: HTMLButtonElement | null = null;
      if (this.enableRating) {
        rateBtn = this.createAppliedFixButton('rate', fixId);
        // controlsContainer.appendChild(rateBtn); // OLD
      }
      // controlsContainer.appendChild(copyBtn); // OLD
      // controlsContainer.appendChild(toggleBtn); // OLD
      // controlsContainer.appendChild(closeBtn); // OLD
      // document.body.appendChild(controlsContainer); // OLD
      // --- End Controls Container ---

      const finalStableSelector = stableSelector || this.stableSelectorForCurrentCycle;
      if (!finalStableSelector) {
        customError(`[FeedbackViewerLogic] Critical error: Stable selector is missing for fix ID ${fixId}.`);
        startComment?.remove();
        endComment?.remove();
        this.showError(`Failed to apply fix: Stable target selector missing for fix ${fixId}.`);
        return;
      }
      
      const fixInfoData: AppliedFixInfo = {
        originalElementId: fixId,
        originalOuterHTML: originalHtml,
        fixedOuterHTML: fixedHtml,
        markerStartNode: startComment, // These are defined in the function scope
        markerEndNode: endComment,     // and will hold the correct Comment nodes
        actualAppliedElement: actualAppliedElement, // Will be null if fixedHtml was empty
        isCurrentlyFixed: true,
        stableTargetSelector: finalStableSelector,
        insertionMode: insertionMode, 
        requestBody: requestBody, 
        isRated: false,
        resolvedColors: this.currentResolvedColors ? { ...this.currentResolvedColors } : undefined
      };
      this.appliedFixes.set(fixId, fixInfoData);

      // If actualAppliedElement is null, it means fixedHtml was empty or only comments/text.
      if (!actualAppliedElement) {
        customWarn(`[FeedbackViewerLogic] Fix ${fixId} (${insertionMode}) resulted in no applied element. Markers may be present but content is empty. Controls not fully activated.`);
        // For 'replace' mode, if fixedHtml was empty, originalSelectedElement was kept and only startComment was added then removed.
        // No further marker cleanup needed here for 'replace' as it's handled within its specific block.
        if (insertionMode === 'insertBefore' || insertionMode === 'insertAfter') {
            // If nothing substantial was inserted between the markers for these modes.
            let sibling = startComment.nextSibling;
            let onlyMarkers = true;
            while (sibling && sibling !== endComment) {
                if (sibling.nodeType === Node.ELEMENT_NODE) {
                    onlyMarkers = false;
                    break;
                }
                sibling = sibling.nextSibling;
            }
            if (onlyMarkers) {
                customWarn(`[FeedbackViewerLogic] Removing markers for ${fixId} (${insertionMode}) as no element nodes were found between them.`);
                startComment.remove();
                endComment.remove();
            }
        } 
        // For 'replace' mode where actualAppliedElement is null, the original element was kept.
        // The startComment was already removed if newNodes was empty.
        // If newNodes was not empty but only contained non-element nodes, startComment and endComment might still be around the original element.
        // This specific sub-case of 'replace' + !actualAppliedElement is tricky because originalSelectedElement itself might have been the only thing between markers briefly.
        // The logic within the 'replace' block aims to remove originalSelectedElement only if newNodes are concrete.
        // If originalSelectedElement is still there and markers are around it due to empty/non-element fixedHTML, they should be removed.
        else if (insertionMode === 'replace') {
            if (startComment.parentNode && endComment.parentNode && startComment.nextSibling === originalSelectedElement && originalSelectedElement.nextSibling === endComment) {
                customWarn(`[FeedbackViewerLogic] Removing markers around original element for ${fixId} (replace) as fixedHTML was empty.`);
                startComment.remove();
                endComment.remove();
            } else if (startComment.parentNode && startComment.nextSibling === endComment) { // If markers ended up adjacent
                customWarn(`[FeedbackViewerLogic] Removing adjacent markers for ${fixId} (replace) as fixedHTML was effectively empty.`);
                startComment.remove();
                endComment.remove();
            }
        }

        this.fixedOuterHTMLForCurrentCycle = null; 
        this.removeSelectionHighlight();
        this.currentResolvedColors = null; 
        // Controls might have been added to body, remove them too if no actual fix applied
        // const controls = document.querySelector(`.checkra-fix-controls-container[data-controls-for-fix="${fixId}"]`);
        // controls?.remove();
        this.overlayManager.hideControls(); 
        this.appliedFixes.delete(fixId); // Also remove from appliedFixes as it's not a valid applied fix
        this.appliedFixListeners.delete(fixId);
        return; 
      }

      const listeners = {
        close: (e: Event) => this.handleAppliedFixClose(fixId, e),
        toggle: (e: Event) => this.handleAppliedFixToggle(fixId, e),
        copy: (e: Event) => this.handleAppliedFixCopy(fixId, e),
        ...(rateBtn && { rate: (e: Event) => this.handleAppliedFixRate(fixId, e) })
      } as any; // Cast to any due to conditional rate listener, consider defining a more precise type for listeners if preferred
      
      // Store listeners. OverlayManager will use these to attach to the actual button instances it manages.
      this.appliedFixListeners.set(fixId, listeners); 

      // Show controls using OverlayManager
      if (actualAppliedElement) {
        this.overlayManager.showControls(
          fixId,
          actualAppliedElement,
          // Pass the created button elements directly
          { close: closeBtn, toggle: toggleBtn, copy: copyBtn, rate: rateBtn || undefined }, 
          listeners // Pass the listeners object for OverlayManager to use
        );
      } else {
        customWarn(`[FeedbackViewerImpl applyFixToPage] No actualAppliedElement for fix ${fixId}, controls not shown via overlay.`);
        // Buttons were created but not added to DOM/Overlay, no specific cleanup needed for them here
        // If listeners were stored in appliedFixListeners, that map entry will be stale but harmless or cleaned on explicit close.
      }

      // Direct listener attachment to buttons is now handled by OverlayManager
      // closeBtn.addEventListener('click', listeners.close); // OLD
      // toggleBtn.addEventListener('click', listeners.toggle); // OLD
      // copyBtn.addEventListener('click', listeners.copy); // OLD
      // if (rateBtn && listeners.rate) { // OLD
      //   rateBtn.addEventListener('click', listeners.rate); // OLD
      // }

      this.fixedOuterHTMLForCurrentCycle = null; 
      this.removeSelectionHighlight();
      this.currentResolvedColors = null; 

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
    button.classList.add('feedback-fix-btn'); // Common base class

    switch (type) {
      case 'close':
        button.classList.add('feedback-fix-close-btn');
        button.innerHTML = '&times;';
        button.title = 'Discard Fix (Revert to Original)';
        break;
      case 'toggle':
        button.classList.add('feedback-fix-toggle', 'toggled-on'); // Add .toggled-on by default
        button.innerHTML = DISPLAY_FIX_SVG; // Always use the "eye open" SVG
        button.title = 'Toggle Original Version'; // Initial title assuming fix is shown first
        break;
      case 'copy':
        button.classList.add('feedback-fix-copy-btn');
        button.innerHTML = COPY_FIX_SVG;
        button.title = 'Copy prompt for this fix';
        break;
      case 'rate': // Added case for rate button
        button.classList.add('feedback-fix-rate-btn');
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

    // if (!fixInfo || !fixInfo.appliedWrapperElement || !rateButton || (rateButton as HTMLButtonElement).disabled) { // OLD CHECK
    // Temporarily adjust check, actualAppliedElement might not be the one with controls yet
    if (!fixInfo || !rateButton || (rateButton as HTMLButtonElement).disabled) { 
      customWarn(`[FeedbackViewerLogic] Cannot rate: Fix info missing or button disabled for Fix ID: ${fixId}.`);
      return;
    }

    // Check if a rating options container already exists, remove if so to toggle off
    // let existingOptionsContainer = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-rating-options'); // OLD
    // Query document directly for now; this will be more robust with overlay manager
    let existingOptionsContainer = document.body.querySelector(`.feedback-fix-rating-options[data-rating-for-fix="${fixId}"]`);
    if (existingOptionsContainer) {
      existingOptionsContainer.remove();
      return; 
    }

    const ratingOptionsContainer = document.createElement('div');
    ratingOptionsContainer.className = 'feedback-fix-rating-options';
    ratingOptionsContainer.setAttribute('data-rating-for-fix', fixId); // For querying
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
                // ADDED: Include resolved color info if available for this fix
                resolvedPrimaryColorInfo: fixInfo.resolvedColors?.resolvedPrimaryColorInfo,
                resolvedAccentColorInfo: fixInfo.resolvedColors?.resolvedAccentColorInfo,
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
              // ADDED: Include resolved color info if available for this fix
              resolvedPrimaryColorInfo: fixInfo.resolvedColors?.resolvedPrimaryColorInfo,
              resolvedAccentColorInfo: fixInfo.resolvedColors?.resolvedAccentColorInfo,
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

    const overlayHost = this.overlayManager.getOverlayElement() || document.body;
    if (overlayHost === document.body && !this.overlayManager.getOverlayElement()) {
        customWarn("[FeedbackViewerLogic] OverlayManager overlay element not found, appending rating options to document.body as a fallback.");
    }
    overlayHost.appendChild(ratingOptionsContainer);
    
    // Position relative to the rateButton, which is in the controls overlay
    const rateButtonRect = rateButton.getBoundingClientRect();
    const overlayRect = overlayHost.getBoundingClientRect(); // Get overlay rect for offset calculation if not body

    let topPosition = rateButtonRect.bottom + window.scrollY;
    let leftPosition = rateButtonRect.left + window.scrollX - (ratingOptionsContainer.offsetWidth / 2) + (rateButtonRect.width / 2);

    // If appended to a specific overlay, adjust for overlay's own offset from viewport if it's not 0,0
    // However, our overlay is fixed at 0,0 so overlayRect.top/left should be 0.
    // This complexity is reduced by the overlay being full viewport fixed.
    // topPosition -= overlayRect.top; 
    // leftPosition -= overlayRect.left;

    ratingOptionsContainer.style.top = `${topPosition}px`;
    ratingOptionsContainer.style.left = `${leftPosition}px`;

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
        this.requestBodyForCurrentCycle, // Pass the shared request body
        this.stableSelectorForCurrentCycle
    );

    customWarn(`[CheckraImplementation] DOM update via applyFixToPage initiated with mode: ${insertionMode}`);
      
    if (this.activeStreamingAiItem) {
        this.activeStreamingAiItem.isStreaming = false;
        this.domManager?.updateLastAIMessage(this.activeStreamingAiItem.content, false); 
    }
    this.activeStreamingAiItem = null;
    // Clear the request body for the current cycle AFTER it has been used by applyFixToPage via handleDomUpdate
    if (this.requestBodyForCurrentCycle?.prompt === this.conversationHistory.find(item => item.type === 'user')?.content) {
        // Basic check to see if it's the same cycle, can be made more robust
        this.requestBodyForCurrentCycle = null;
    }

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

  // --- END: New Types for Color Resolution Event ---
  // ADDED: New handler for resolved colors event
  private handleResolvedColorsUpdate(colors: ResolvedColorInfo): void {
    customWarn('[CheckraImpl] Received internalResolvedColorsUpdate:', colors);
    this.currentResolvedColors = colors;
    // Optionally, you could emit another event here if other UI parts need to react instantly
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