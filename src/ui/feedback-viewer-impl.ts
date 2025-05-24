import { fetchFeedback } from '../services/ai-service';
import { SELECT_SVG_ICON, type FeedbackViewerElements } from './feedback-viewer-dom';
import type { FeedbackViewerDOM } from './feedback-viewer-dom';
import { screenCapture } from './screen-capture';
import type { SettingsModal } from './settings-modal';
import { eventEmitter } from '../core/index';
import { generateStableSelector } from '../utils/selector-utils';
import { API_BASE, CDN_DOMAIN } from '../config';
import { getSiteId } from '../utils/id'; 
import { fetchProtected, AuthenticationRequiredError, logout, startLogin, isLoggedIn } from '../auth/auth';
import { customWarn, customError } from '../utils/logger';

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

// localStorage keys for pending actions
const PENDING_ACTION_TYPE_KEY = 'checkra_auth_pending_action_type';
const PENDING_ACTION_DATA_KEY = 'checkra_auth_pending_action_data';

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
    if (!this.domManager || !this.domElements) {
      customError("[FeedbackViewerLogic] Cannot prepare for input: DOM Manager or elements not initialized.");
      return;
    }

    this.currentImageDataUrl = imageDataUrl;

    const isElementSelected = !!(targetElement && targetElement !== document.body); // Ensure boolean

    if (isElementSelected && targetElement) { // Added targetElement check for type safety
      this.stableSelectorForCurrentCycle = generateStableSelector(targetElement);
      this.originalOuterHTMLForCurrentCycle = selectedHtml; // Should only be set if an element is truly selected
    } else {
      // Handles null targetElement or document.body selection
      this.stableSelectorForCurrentCycle = 'body';
      this.originalOuterHTMLForCurrentCycle = document.body.outerHTML; // Fallback or default context
      if (targetElement === document.body) {
        // Removed: this.initialSelectedElement = document.body; // Explicitly set for clarity if it was body
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
      this.domManager.showImageGenerationStatus(false);
      this.domManager.updateLoaderVisibility(true, hasHtmlCode ? 'Creating new version...' : 'Loading...');
    } else {
      customWarn(`[FeedbackViewerImpl] updateResponse called but currentStreamItem (activeStreamingAiItem) is not an AI message or not streaming. Type: ${currentStreamItem.type}, Streaming: ${currentStreamItem.isStreaming}`);
    }
  }

  public finalizeResponse(): void {
    if (!this.domManager || !this.domElements) return;

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
        this.extractAndStoreFixHtml();
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
    this.domManager.showImageGenerationStatus(false);

    const contentWrapper = this.domElements.contentWrapper;
    contentWrapper.scrollTop = contentWrapper.scrollHeight;

    if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForCurrentCycle && this.currentFixId) {
      const lastAiItem = this.conversationHistory.filter(item => item.type === 'ai').pop();
      if (lastAiItem && lastAiItem.fix) {
        this.applyFixToPage(lastAiItem.fix.fixId, lastAiItem.fix.originalHtml, lastAiItem.fix.fixedHtml, this.stableSelectorForCurrentCycle || undefined);
      } else {
        customWarn('[FeedbackViewerImpl] Finalized response with fix HTML, but fix data not in history item. Applying from current cycle state.');
        if (this.currentFixId && this.originalOuterHTMLForCurrentCycle && this.fixedOuterHTMLForCurrentCycle && this.stableSelectorForCurrentCycle) {
          this.applyFixToPage(this.currentFixId, this.originalOuterHTMLForCurrentCycle, this.fixedOuterHTMLForCurrentCycle, this.stableSelectorForCurrentCycle || undefined);
        } else {
          customError('[FeedbackViewerImpl] Cannot apply fix from current cycle state: Missing required data (fixId, originalHTML, fixedHTML, or stableSelector).');
        }
      }
    }
  }

  public showError(error: Error | string): void {
    let errorHtmlContent: string;

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

    eventEmitter.emit('viewerWillHide'); // Emit before hiding
    this.domManager.hide();
    this.isVisible = false;
    this.onToggleCallback(false); // Inform parent about visibility change
    this.removeSelectionHighlight(); // Remove any active highlight
    this.resetStateForNewSelection(); // Reset for next interaction cycle
    
    if (initiatedByUser && fromCloseButton) {
      localStorage.setItem(this.PANEL_CLOSED_BY_USER_KEY, 'true');
    }
    eventEmitter.emit('viewerDidHide'); // Emit after hiding
  }

  private resetStateForNewSelection(): void {
    this.currentImageDataUrl = null;
    this.originalOuterHTMLForCurrentCycle = null;
    this.fixedOuterHTMLForCurrentCycle = null;
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
    const promptText = this.domElements?.promptTextarea.value.trim(); // Safely access promptTextarea

    // Allow /publish even if other conditions aren't met
    if (promptText?.toLowerCase() === '/publish') {
      this.publishSnapshot();
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
    this.domManager.updateLoaderVisibility(true, 'Loading...');
    this.domManager.clearUserMessage();
    this.domManager.showPromptInputArea(false, promptText);

    const imageKeywords = ["image", "photo", "picture", "screenshot", "visual", "look", "style", "design", "appearance", "graphic", "illustration", "background", "banner", "logo"];
    const promptHasImageKeyword = imageKeywords.some(keyword => promptText.includes(keyword));
    let imageDataToSend: string | null = null;

    if (promptHasImageKeyword && this.currentImageDataUrl) {
      imageDataToSend = this.currentImageDataUrl;
    } else if (promptHasImageKeyword) {
    } else {
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

    fetchFeedback(imageDataToSend, promptText, processedHtmlForAI);
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


        // Clean up listeners and map entry
        const listeners = this.appliedFixListeners.get(fixId);
        if (listeners) {
          this.appliedFixListeners.delete(fixId);
        }
        this.appliedFixes.delete(fixId);

      } catch (error) {
        customError(`[FeedbackViewerLogic] Error closing/reverting fix ${fixId}:`, error);
        // Optionally show an error to the user?
      }
    } else {
      customWarn(`[FeedbackViewerLogic] Could not find fix info or wrapper element for Fix ID: ${fixId} during close.`);
      // Attempt cleanup if possible
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

        // --- Update toggle button appearance ---
        if (fixInfo.isCurrentlyFixed) {
          toggleButton.innerHTML = DISPLAY_FIX_SVG;
          toggleButton.title = "Toggle Original Version";
          toggleButton.style.backgroundColor = 'rgba(60, 180, 110, 0.9)'; // Active color
        } else {
          toggleButton.innerHTML = HIDE_FIX_SVG;
          toggleButton.title = "Toggle Fixed Version";
          toggleButton.style.backgroundColor = ''; // Reset to default CSS background
        }

      } catch (error) {
        customError(`[FeedbackViewerLogic] Error toggling fix ${fixId}:`, error);
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
              customError(`[FeedbackViewerLogic] Failed to parse fixed HTML during toggle error restore for ${fixId}.`);
            }
            // --- END EDIT ---
          } catch (restoreError) {
            customError(`[FeedbackViewerLogic] Failed to restore fixed state for ${fixId} after toggle error:`, restoreError);
          }
        }
      }
    } else {
      customWarn(`[FeedbackViewerLogic] Could not find fix info, wrapper, content container, or toggle button for Fix ID: ${fixId} during toggle.`);
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

    if (match && match[1]) {
      let extractedHtml = match[1].trim();

      try {
        extractedHtml = this.postprocessHtmlFromAI(extractedHtml);
        
        const tempFragment = this.createFragmentFromHTML(extractedHtml);

        if (tempFragment && tempFragment.childNodes.length > 0) {
          this.fixedOuterHTMLForCurrentCycle = extractedHtml;
        } else {
          customWarn('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: Failed to parse extracted HTML into a valid, non-empty fragment. Fix may not be applicable.');
          this.fixedOuterHTMLForCurrentCycle = null;
        }
      } catch (e) {
        customError('[FeedbackViewerLogic DEBUG] extractAndStoreFixHtml: Error during postprocessing/validation:', e);
        this.fixedOuterHTMLForCurrentCycle = null;
      }
    } else {
      if (!lastAiItem.isStreaming && !GENERIC_HTML_REGEX.test(responseText)) {
      } else {
      }
      this.fixedOuterHTMLForCurrentCycle = null;
    }
  }
  private applyFixToPage(fixId: string, originalHtml: string, fixedHtml: string, stableSelector?: string): void {
    if (!this.domManager || !this.domElements) {
      customWarn('[FeedbackViewerLogic DEBUG] applyFixToPage: Cannot apply fix: Missing DOM Manager or elements.');
      return;
    }

    try {
      let elementToReplace = document.querySelector(`[data-checkra-fix-id="${fixId}"]`);

      let insertionParent: Node | null = null;
      let insertionBeforeNode: Node | null = null;

      if (elementToReplace) {
        if (!elementToReplace.parentNode) {
          customError(`[FeedbackViewerLogic DEBUG] applyFixToPage: Original element with ID ${fixId} has no parent node.`);
          throw new Error(`Original element with ID ${fixId} has no parent node.`);
        }
        insertionParent = elementToReplace.parentNode;
        insertionBeforeNode = elementToReplace.nextSibling;
        elementToReplace.remove(); 
      } else {
        customError(`[FeedbackViewerLogic DEBUG] applyFixToPage: Original element with ID ${fixId} not found. Cannot apply fix.`);
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

      const finalStableSelector = stableSelector || this.stableSelectorForCurrentCycle;
      if (!finalStableSelector) {
        customError(`[FeedbackViewerLogic] Critical error: Stable selector is missing for fix ID ${fixId}. Cannot reliably apply or store fix.`);
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
      customError('[FeedbackViewerLogic] Error applying fix directly to page:', error);
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
      customError("Error creating fragment from HTML string:", e, htmlString);
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
      this.currentlyHighlightedElement.classList.remove('checkra-selected-element-outline');
      this.currentlyHighlightedElement = null;
    }
  }
  private handleImageGenerationStart(data: { prompt?: string }): void {
    if (!this.domManager) return;
    // Hide general loading indicator if it's showing
    this.domManager.updateLoaderVisibility(false);
    // Show image generation specific status
    this.domManager.showImageGenerationStatus(true, data.prompt);
  }

  // RENAMED and REIMPLEMENTED: from exportSnapshot and sendSnapshotToBackend
  public async publishSnapshot(): Promise<void> {
    if (this.appliedFixes.size === 0) {
      customWarn("[FeedbackViewerImpl] No fixes applied. Nothing to publish.");
      this.renderUserMessage("No changes have been applied to publish.");
      return;
    }
    const changes = Array.from(this.appliedFixes.entries()); // Get data for potential storage
    const siteId = getSiteId();
    const clientGeneratedSnapshotId = crypto.randomUUID();
    const snapshotData = {
      siteId, snapshotId: clientGeneratedSnapshotId, timestamp: new Date().toISOString(),
      pageUrl: window.location.href, changes: this.appliedFixes.size > 0 ? Array.from(this.appliedFixes.values()).map(fixInfo => ({ 
        targetSelector: fixInfo.stableTargetSelector, 
        appliedHtml: fixInfo.fixedOuterHTML, 
        sessionFixId: fixInfo.originalElementId 
      })) : [],
    };
    const postSnapshotUrl = `${API_BASE}/sites/${siteId}/snapshots`;

    try {
      this.renderUserMessage("Publishing changes...");
      const postResponse = await fetchProtected(postSnapshotUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const postResult = await postResponse.json(); 
      if (postResult.publishedVariantId && postResult.snapshotId) {
        const shortPublishedId = postResult.publishedVariantId; 
        const fullSnapshotIdUUID = postResult.snapshotId; 
        this.renderUserMessage(`Published ID: ${shortPublishedId}`);
        const promoteUrl = `${API_BASE}/sites/${siteId}/variants/${shortPublishedId}`;
        try {
          const promoteResponse = await fetchProtected(promoteUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
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
            throw new Error(specificPromoteErrorMessage);
          }
          
          const shareUrl = `${window.location.origin}${window.location.pathname}?checkra-variant-id=${shortPublishedId}`;
          this.renderUserMessage(`Share URL: <a href="${shareUrl}" target="_blank">${shareUrl}</a>`);
        } catch (promoteError) {
          if (promoteError instanceof AuthenticationRequiredError || (promoteError && (promoteError as any).name === 'AuthenticationRequiredError')) {
            await this.handleAuthenticationRequiredAndRedirect('publish', changes, promoteError as AuthenticationRequiredError); 
          } else {
            customError("[FeedbackViewerImpl] Non-AuthenticationRequiredError during promoting snapshot. Error details follow.");
            if (promoteError instanceof Error) {
              customError("[FeedbackViewerImpl] Promote Error Name:", promoteError.name);
              customError("[FeedbackViewerImpl] Promote Error Message:", promoteError.message);
              if (promoteError.stack) {
                customError("[FeedbackViewerImpl] Promote Error Stack:", promoteError.stack);
              }
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
            const shortPublishedId = snapshotData.snapshotId.substring(0,8); 
            const displayErrorMessage = promoteError instanceof Error ? promoteError.message : String(promoteError);
            this.showError(`Failed to promote snapshot: ${displayErrorMessage}`);
            this.renderUserMessage(`Error promoting: ${displayErrorMessage}. Snapshot saved (ID: ${shortPublishedId}...) but not live.`);
          }
        }
      } else {
        customWarn("[FeedbackViewerImpl] Snapshot POST successful, but publishedVariantId or snapshotId missing in response:", postResult);
        this.renderUserMessage("Snapshot saved, but could not get necessary IDs for promotion.");
      }
    } catch (error) {
      if (error instanceof AuthenticationRequiredError || (error && (error as any).name === 'AuthenticationRequiredError')) {
        await this.handleAuthenticationRequiredAndRedirect('publish', changes, error as AuthenticationRequiredError); 
      } else {
        customError("[FeedbackViewerImpl] Non-AuthenticationRequiredError during saving snapshot. Error details follow.");
        if (error instanceof Error) {
          customError("[FeedbackViewerImpl] Error Name:", error.name);
          customError("[FeedbackViewerImpl] Error Message:", error.message);
          if (error.stack) {
            customError("[FeedbackViewerImpl] Error Stack:", error.stack);
          }
          // Check if we have a response object attached to the error, common in HTTP error wrappers
          // This is a common pattern but not standard for all Error objects.
          if ((error as any).response && typeof (error as any).response.status === 'number') {
             const response = (error as any).response as Response;
             customError("[FeedbackViewerImpl] Underlying response status:", response.status);
             try {
                const responseBody = await response.text(); // Attempt to read body if not already read
                customError("[FeedbackViewerImpl] Underlying response body:", responseBody);
             } catch (bodyError) {
                customError("[FeedbackViewerImpl] Could not read underlying response body:", bodyError);
             }
          }
        } else {
          customError("[FeedbackViewerImpl] Caught a non-Error object:", error);
        }

        const displayErrorMessage = error instanceof Error ? error.message : String(error);
        this.showError(`Failed to save snapshot: ${displayErrorMessage}`);
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