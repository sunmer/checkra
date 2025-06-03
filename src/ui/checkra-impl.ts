import { fetchFeedback } from '../services/ai-service';
import { SELECT_SVG_ICON, type CheckraViewerElements } from './checkra-dom';
import type { CheckraDOM } from './checkra-dom';
import { screenCapture } from './screen-capture';
import type { SettingsModal } from './settings-modal';
import { eventEmitter } from '../core/index';
import { generateStableSelector } from '../utils/selector-utils';
import { AuthenticationRequiredError, logout, startLogin, isLoggedIn } from '../auth/auth';
import { customWarn, customError } from '../utils/logger';
import { GenerateSuggestionRequestbody, AddRatingRequestBody, ResolvedColorInfo } from '../types';
import { OverlayManager, ControlButtonCallbacks } from './overlay-manager';
import { AppliedFixStore, AppliedFixInfo } from './applied-fix-store';
import { RatingUI } from './rating-ui';
import { SnapshotService, SnapshotOperationResult } from '../services/snapshot-service';
import { StatsFetcher, StatsFetcherResult, getFriendlyQueryName } from '../analytics/stats-fetcher';
import { AuthPendingActionHelper, PendingAction } from '../auth/auth-pending-action-helper';
import { rgbToHex } from '../utils/color';
import { createCenteredLoaderElement } from './loader-factory';
import { SPECIFIC_HTML_REGEX, GENERIC_HTML_REGEX, SVG_PLACEHOLDER_REGEX } from '../utils/regex';
import { ConversationHistory, type ConversationItem } from './conversation-history';

export class CheckraImplementation {
  private domElements: CheckraViewerElements | null = null;
  private domManager: CheckraDOM | null = null;
  private settingsModal: SettingsModal | null = null;
  private overlayManager: OverlayManager;
  private optionsInitialVisibility: boolean;
  private enableRating: boolean;
  private appliedFixStore: AppliedFixStore;
  private ratingUI: RatingUI;
  private snapshotService: SnapshotService;
  private statsFetcher: StatsFetcher;
  private authPendingActionHelper: AuthPendingActionHelper;
  private conversationHistoryManager: ConversationHistory;

  // --- State ---
  private isVisible: boolean = false;
  private currentImageDataUrl: string | null = null;
  private currentlyHighlightedElement: Element | null = null;
  private originalOuterHTMLForCurrentCycle: string | null = null;
  private fixedOuterHTMLForCurrentCycle: string | null = null;
  private currentFixId: string | null = null;
  private stableSelectorForCurrentCycle: string | null = null;
  private currentElementInsertionMode: 'replace' | 'insertBefore' | 'insertAfter' = 'replace';
  private currentComputedBackgroundColor: string | null = null;
  private currentResolvedColors: ResolvedColorInfo | null = null;

  private fixIdCounter: number = 0;
  private originalSvgsMap: Map<string, string> = new Map();
  private svgPlaceholderCounter: number = 0;
  private selectionPlusIconElement: HTMLDivElement | null = null;
  private pageReplaceLoaderElement: HTMLDivElement | null = null;

  // --- Quick Suggestion Flow ---
  private queuedPromptText: string | null = null;

  private boundHandleEscapeKey: ((event: KeyboardEvent) => void) | null = null;

  // --- Helpers for binding methods for event listeners ---
  private boundUpdateResponse = this.updateResponse.bind(this);
  private boundRenderUserMessage = this.renderUserMessage.bind(this);
  private boundShowError = this.showError.bind(this);
  private boundFinalizeResponse = this.finalizeResponse.bind(this);
  private boundToggle = this.toggle.bind(this);
  private boundShowFromApi = this.showFromApi.bind(this);
  private boundHandleSuggestionClick = this.handleSuggestionClick.bind(this);
  private readonly PANEL_CLOSED_BY_USER_KEY = 'checkra_panel_explicitly_closed';

  private boundHandleJsonPatch = this.handleJsonPatch.bind(this);
  private boundHandleDomUpdate = this.handleDomUpdate.bind(this);

  private requestBodyForCurrentCycle: GenerateSuggestionRequestbody | null = null;
  private boundHandleRequestBodyPrepared = this.handleRequestBodyPrepared.bind(this);
  private boundHandleResolvedColorsUpdate = this.handleResolvedColorsUpdate.bind(this);

  constructor(
    private onToggleCallback: (isVisible: boolean) => void,
    initialVisibilityFromOptions: boolean = false,
    enableRating: boolean = false
  ) {
    this.optionsInitialVisibility = initialVisibilityFromOptions;
    this.enableRating = enableRating;
    this.overlayManager = new OverlayManager();
    this.appliedFixStore = new AppliedFixStore();
    this.ratingUI = new RatingUI();
    this.snapshotService = new SnapshotService();
    this.statsFetcher = new StatsFetcher();
    this.authPendingActionHelper = new AuthPendingActionHelper();
    this.conversationHistoryManager = new ConversationHistory();
    // Bind methods
    this.handleTextareaKeydown = this.handleTextareaKeydown.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleAppliedFixClose = this.handleAppliedFixClose.bind(this);
    this.handleAppliedFixToggle = this.handleAppliedFixToggle.bind(this);
    this.handleMiniSelectClick = this.handleMiniSelectClick.bind(this);
    this.handleSettingsClick = this.handleSettingsClick.bind(this);
    this.boundHandleEscapeKey = this.handleEscapeKey.bind(this);
  }

  public initialize(
    domManager: CheckraDOM,
    settingsModal: SettingsModal
  ): void {
    try {
      this.conversationHistoryManager.clearHistory();
      localStorage.removeItem('checkra_onboarded');
    } catch (e) {
      // Failing silently is acceptable; some environments block localStorage
    }

    const handleClose = () => this.hide(true, true);
    this.domElements = domManager.create(handleClose);
    this.domManager = domManager;
    this.settingsModal = settingsModal;
    this.conversationHistoryManager.setDomManager(domManager);

    this.ratingUI.applyStyles();

    this.domElements.promptTextarea.addEventListener('keydown', this.handleTextareaKeydown);
    this.domElements.submitButton.addEventListener('click', this.handleSubmit);
    this.domElements.miniSelectButton?.addEventListener('click', this.handleMiniSelectClick);
    this.domElements.settingsButton?.addEventListener('click', this.handleSettingsClick);
    eventEmitter.on('aiResponseChunk', this.boundUpdateResponse);
    eventEmitter.on('aiUserMessage', this.boundRenderUserMessage);
    eventEmitter.on('aiError', this.boundShowError);
    eventEmitter.on('aiFinalized', this.boundFinalizeResponse);
    eventEmitter.on('toggleViewerShortcut', this.boundToggle);
    eventEmitter.on('showViewerApi', this.boundShowFromApi);
    eventEmitter.on('onboardingSuggestionClicked', this.boundHandleSuggestionClick);
    eventEmitter.on('aiJsonPatch', this.boundHandleJsonPatch);
    eventEmitter.on('aiDomUpdateReceived', this.boundHandleDomUpdate);
    eventEmitter.on('requestBodyPrepared', this.boundHandleRequestBodyPrepared);
    eventEmitter.on('internalResolvedColorsUpdate', this.boundHandleResolvedColorsUpdate);

    this.domElements.responseContent.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.classList.contains('checkra-stat-badge') && target.dataset.queryname) {
        this.initiateStatsFetch(target.dataset.queryname);
      }
    });

    this.addGlobalListeners();

    const panelWasClosedByUser = localStorage.getItem(this.PANEL_CLOSED_BY_USER_KEY) === 'true';

    if (this.optionsInitialVisibility && !panelWasClosedByUser) {
      this.showFromApi(false);
    } else {
      if (this.isVisible) {
        this.hide(false);
      }
      if (this.domManager && !this.isVisible && !sessionStorage.getItem('checkra_toast_shown_session')) {
        setTimeout(() => {
          if (this.domManager && !this.isVisible) {
             this.domManager.showAvailabilityToast();
             sessionStorage.setItem('checkra_toast_shown_session', 'true');
          }
        }, 250);
      }
    }
    this.handleAuthErrorInUrl();
    this.handlePendingActionAfterLogin();
    eventEmitter.emit('feedbackViewerImplReady');
  }

  public cleanup(): void {
    if (!this.domElements) return;

    this.domElements.promptTextarea.removeEventListener('keydown', this.handleTextareaKeydown);
    this.domElements.submitButton.removeEventListener('click', this.handleSubmit);

    this.overlayManager.removeAllControlsAndOverlay();

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

    const currentStreamItem = this.conversationHistoryManager.getActiveStreamingAIItem();

    if (currentStreamItem) {
      const newContent = currentStreamItem.content + chunk;
      this.conversationHistoryManager.updateLastAIMessage(newContent, true);

      const hasHtmlCode = GENERIC_HTML_REGEX.test(newContent);
      this.domManager.updateLoaderVisibility(true, hasHtmlCode ? 'Creating new version...' : 'Loading...');
    } else {
      const history = this.conversationHistoryManager.getHistory();
      const lastItemInHistory = history.length > 0 ? history[history.length - 1] : null;
      customWarn(`[FeedbackViewerImpl] updateResponse: activeStreamingAiItem is null. Last item in history: ${lastItemInHistory?.type}, streaming: ${lastItemInHistory?.isStreaming}`);
      return;
    }
  }

  public finalizeResponse(): void {
    if (!this.domManager || !this.domElements) return;

    this.hidePageLoaders(); // Hide page loaders when response is finalized

    const streamToFinalize = this.conversationHistoryManager.getActiveStreamingAIItem();

    if (streamToFinalize && streamToFinalize.type === 'ai' && streamToFinalize.isStreaming) {
      this.extractAndStoreFixHtml();
      
      let fixDataForHistory: { originalHtml: string; fixedHtml: string; fixId: string } | undefined = undefined;
      if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForCurrentCycle && this.currentFixId) {
        fixDataForHistory = {
          originalHtml: this.originalOuterHTMLForCurrentCycle,
          fixedHtml: this.fixedOuterHTMLForCurrentCycle,
          fixId: this.currentFixId
        };
      }
      this.conversationHistoryManager.finalizeLastAIItem(fixDataForHistory);
    } else {
      customWarn(`[FeedbackViewerImpl] finalizeResponse called but no active AI message was streaming or found. Active item state: type=${streamToFinalize?.type}, streaming=${streamToFinalize?.isStreaming}`);
      const history = this.conversationHistoryManager.getHistory();
      const lastHistoryAI = [...history].reverse().find(item => item.type === 'ai' && item.isStreaming);

      if (lastHistoryAI) {
        customWarn("[FeedbackViewerImpl DEBUG] finalizeResponse: Fallback - found a different streaming AI item in history. Finalizing it.", lastHistoryAI);
        this.extractAndStoreFixHtml();
        let fixDataForHistory: { originalHtml: string; fixedHtml: string; fixId: string } | undefined = undefined;
        if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForCurrentCycle && this.currentFixId) {
            fixDataForHistory = {
              originalHtml: this.originalOuterHTMLForCurrentCycle,
              fixedHtml: this.fixedOuterHTMLForCurrentCycle,
              fixId: this.currentFixId
            };
        }
        this.conversationHistoryManager.finalizeLastAIItem(fixDataForHistory);
      } else {
         customWarn("[FeedbackViewerImpl DEBUG] finalizeResponse: Fallback - no streaming AI item found in history either.");
      }
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

    this.conversationHistoryManager.saveHistory(errorItem);

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
    this.conversationHistoryManager.saveHistory(userMessageItem);
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
      this.handlePublishCommand(); // MODIFIED: Call new handler
      this.domManager?.setPromptState(true, ''); 
      this.domManager?.updateSubmitButtonState(true); 
      return; 
    }

    // ADDED: Handle /save command
    if (promptText?.toLowerCase() === '/save') {
      this.handleSaveDraftCommand(); // MODIFIED: Call new handler
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

    this.conversationHistoryManager.saveHistory({ type: 'user', content: promptText });
    
    const newAiPlaceholder: ConversationItem = { type: 'ai', content: '', isStreaming: true };
    this.conversationHistoryManager.saveHistory(newAiPlaceholder);

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
  private handleAppliedFixClose(fixId: string): void {
    const fixInfo = this.appliedFixStore.get(fixId);

    if (!fixInfo || !fixInfo.markerStartNode || !fixInfo.markerEndNode) {
      customWarn(`[FeedbackViewerLogic] Could not find fix info or markers for Fix ID: ${fixId} during close.`);
      this.overlayManager.hideControlsForFix(fixId);
      this.appliedFixStore.delete(fixId);
      return;
    }

    const { markerStartNode, markerEndNode, originalOuterHTML, insertionMode } = fixInfo;
    const parent = markerStartNode.parentNode;

    if (!parent) {
      customError(`[FeedbackViewerLogic] Parent node of markers not found for fix ${fixId}. Cannot revert.`);
      this.overlayManager.hideControlsForFix(fixId);
      this.appliedFixStore.delete(fixId);
      return;
    }

    try {
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
        parent.insertBefore(originalFragment, markerEndNode);
      }
      
      markerStartNode.remove();
      markerEndNode.remove();

      this.overlayManager.hideControlsForFix(fixId); 
      this.appliedFixStore.delete(fixId);

    } catch (error) {
      customError(`[FeedbackViewerLogic] Error closing/reverting fix ${fixId} (mode: ${insertionMode}):`, error);
      markerStartNode?.remove();
      markerEndNode?.remove();
      this.overlayManager.hideControlsForFix(fixId);
      this.appliedFixStore.delete(fixId);
    }
  }

  private handleAppliedFixToggle(fixId: string): void {
    const fixInfo = this.appliedFixStore.get(fixId);

    if (!fixInfo || !fixInfo.markerStartNode || !fixInfo.markerEndNode) {
      customWarn(`[FeedbackViewerLogic] Toggle: Could not find fix info or markers for Fix ID: ${fixId}.`);
      return;
    }

    const { markerStartNode, markerEndNode, originalOuterHTML, fixedOuterHTML } = fixInfo;
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
      let newActualAppliedElement: HTMLElement | null = null;

      if (newContentFragment && newContentFragment.childNodes.length > 0) {
        parent.insertBefore(newContentFragment, markerEndNode);
        let firstNewElement = markerStartNode.nextSibling;
        while(firstNewElement && firstNewElement !== markerEndNode) {
            if (firstNewElement.nodeType === Node.ELEMENT_NODE) {
                newActualAppliedElement = firstNewElement as HTMLElement;
                break;
            }
            firstNewElement = firstNewElement.nextSibling;
        }
        
        if (fixInfo.actualAppliedElement !== newActualAppliedElement || !this.overlayManager.isControlsVisible(fixId)) {
            const oldActualAppliedElement = fixInfo.actualAppliedElement;
            fixInfo.actualAppliedElement = newActualAppliedElement;

            if (newActualAppliedElement) {
                if (newActualAppliedElement !== oldActualAppliedElement || !this.overlayManager.isControlsVisible(fixId)){
                    this.overlayManager.showControlsForFix(fixId, newActualAppliedElement, this.getControlCallbacksForFix(fixId));
                } else {
                    this.overlayManager.updateControlsPositionForFix(fixId, newActualAppliedElement);
                }
            } else {
                this.overlayManager.hideControlsForFix(fixId);
            }
        }
      } else {
        customWarn(`[FeedbackViewerLogic] Toggle: HTML to insert was empty or invalid for fixId: ${fixId}. Hiding controls.`);
        fixInfo.actualAppliedElement = null; 
        this.overlayManager.hideControlsForFix(fixId); 
      }

      fixInfo.isCurrentlyFixed = !fixInfo.isCurrentlyFixed;
      this.overlayManager.updateToggleButtonVisuals(fixId, fixInfo.isCurrentlyFixed);

    } catch (error) {
      customError(`[FeedbackViewerLogic] Error toggling fix ${fixId}:`, error);
      if (fixInfo) { 
        this.overlayManager.updateToggleButtonVisuals(fixId, fixInfo.isCurrentlyFixed); // Attempt to restore visual state
      }
    }
  }

  /** Helper to reconstruct callbacks for a fix, e.g. after toggling an empty fix back to having content */
  private getControlCallbacksForFix(fixId: string): ControlButtonCallbacks {
    return {
      onClose: () => this.handleAppliedFixClose(fixId),
      onToggle: () => this.handleAppliedFixToggle(fixId),
      onCopy: () => this.handleAppliedFixCopy(fixId),
      onRate: this.enableRating ? (anchorElement: HTMLElement) => this.handleAppliedFixRate(fixId, anchorElement) : undefined
    };
  }

  /**
   * Copies a ready-to-use LLM prompt for the selected fix to the clipboard.
   */
  private async handleAppliedFixCopy(fixId: string): Promise<void> {
    const fixInfo = this.appliedFixStore.get(fixId);
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
      originalOuterHTML: originalOuterHTML,
      proposedOuterHTML: fixedOuterHTML
    };

    const jsonPayloadString = JSON.stringify(jsonPayload, null, 2);

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
    const history = this.conversationHistoryManager.getHistory();
    const aiItems = history.filter(item => item.type === 'ai');
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
            this.conversationHistoryManager.setLastAIItemContent(analysisPortion);
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
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = fixedHtml.trim();
        const newNodes = Array.from(tempDiv.childNodes);

        if (newNodes.length > 0) {
          newNodes.forEach(node => parent.insertBefore(node, originalSelectedElement));
          actualAppliedElement = newNodes.find(node => node.nodeType === Node.ELEMENT_NODE) as HTMLElement || null;
        } else {
          customWarn(`[FeedbackViewerLogic] FixedHTML for ${fixId} (replace) resulted in no actual nodes. Original was kept.`);
          parent.removeChild(startComment); // Remove start marker if nothing inserted
        }
        
        if (newNodes.length > 0) {
          parent.removeChild(originalSelectedElement);
          const lastNewNode = newNodes[newNodes.length - 1];
          if (lastNewNode.nextSibling) {
            parent.insertBefore(endComment, lastNewNode.nextSibling);
          } else {
            parent.appendChild(endComment);
          }
        }
      } else if (insertionMode === 'insertBefore') {
        parent.insertBefore(startComment, originalSelectedElement);
        parent.insertBefore(endComment, originalSelectedElement); // endComment is now immediately before originalSelectedElement
        const fragment = this.createFragmentFromHTML(fixedHtml);
        if (fragment) parent.insertBefore(fragment, endComment); // Insert content between start and end markers
        
        let current = startComment.nextSibling;
        while(current && current !== endComment) { // Loop correctly stops at endComment
            if (current.nodeType === Node.ELEMENT_NODE) {
                actualAppliedElement = current as HTMLElement;
                break;
            }
            current = current.nextSibling;
        }
      } else if (insertionMode === 'insertAfter') {
        const anchorNode = originalSelectedElement.nextSibling; // Node after original, for placing markers
        parent.insertBefore(startComment, anchorNode);
        parent.insertBefore(endComment, anchorNode); // endComment is now immediately before anchorNode
        
        const fragment = this.createFragmentFromHTML(fixedHtml);
        if (fragment) parent.insertBefore(fragment, endComment); // Insert content between start and end markers
        
        let current = startComment.nextSibling;
        while(current && current !== endComment) { // Loop correctly stops at endComment
            if (current.nodeType === Node.ELEMENT_NODE) {
                actualAppliedElement = current as HTMLElement;
                break;
            }
            current = current.nextSibling;
        }
      }
      // --- END: New Marker-Based Fix Application ---

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
        markerStartNode: startComment,
        markerEndNode: endComment,
        actualAppliedElement: actualAppliedElement,
        isCurrentlyFixed: true,
        stableTargetSelector: finalStableSelector,
        insertionMode: insertionMode, 
        requestBody: requestBody, 
        isRated: false,
        resolvedColors: this.currentResolvedColors ? { ...this.currentResolvedColors } : undefined
      };
      this.appliedFixStore.add(fixId, fixInfoData);

      if (!actualAppliedElement) {
        customWarn(`[FeedbackViewerLogic] Fix ${fixId} (${insertionMode}) resulted in no applied element. Markers may be present but content is empty. Controls not fully activated.`);
        startComment?.remove();
        endComment?.remove();
        this.overlayManager.hideControlsForFix(fixId);
        this.appliedFixStore.delete(fixId);
        this.fixedOuterHTMLForCurrentCycle = null; 
        this.removeSelectionHighlight();
        this.currentResolvedColors = null; 
        return; 
      }

      const controlCallbacks: ControlButtonCallbacks = {
        onClose: () => this.handleAppliedFixClose(fixId),
        onToggle: () => this.handleAppliedFixToggle(fixId),
        onCopy: () => this.handleAppliedFixCopy(fixId),
        onRate: this.enableRating ? (anchorElement: HTMLElement) => this.handleAppliedFixRate(fixId, anchorElement) : undefined
      };
      
      this.overlayManager.showControlsForFix(
        fixId,
        actualAppliedElement,
        controlCallbacks 
      );
      
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
        'checkra-element-dimmed'
      );
    }
    if (this.selectionPlusIconElement && this.selectionPlusIconElement.parentNode) {
      this.selectionPlusIconElement.classList.remove('loading');
      this.selectionPlusIconElement.parentNode.removeChild(this.selectionPlusIconElement);
      this.selectionPlusIconElement = null;
    }
    if (this.pageReplaceLoaderElement) {
        this.pageReplaceLoaderElement.remove();
        this.pageReplaceLoaderElement = null;
    }
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

  private async handleAuthenticationRequiredAndRedirect(actionType: string, actionData: any, authError: AuthenticationRequiredError): Promise<void> {
    try {
      this.authPendingActionHelper.setPendingAction(actionType, actionData);
      
      const loginUrlFromError = authError?.loginUrl;
      const encodedRedirect = encodeURIComponent((window as any).Checkra?.REDIRECT_URI ?? location.origin + '/auth/callback');
      const safeToUseLoginUrl = loginUrlFromError && loginUrlFromError.includes(`redirect_to=${encodedRedirect}`);

      if (safeToUseLoginUrl) {
        window.location.href = loginUrlFromError;
      } else {
        customWarn('[FeedbackViewerImpl] Backend loginUrl missing or has wrong redirect_to. Falling back to startLogin().');
        try {
          await startLogin();
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
    const pendingAction: PendingAction = this.authPendingActionHelper.getPendingAction();
    const { actionType, actionData } = pendingAction; // actionData is already parsed or null

    if (actionType) {
      const loggedIn = await isLoggedIn();
      if (!loggedIn) {
        return; 
      }

      this.authPendingActionHelper.clearPendingAction();

      // No need to parse actionData again, it's already handled by getPendingAction
      // No need to manually remove localStorage items, clearPendingAction handles it

      switch (actionType) {
        case 'publish':
        case 'saveDraft': 
          if (actionData && Array.isArray(actionData)) {
            try {
              this.appliedFixStore.clear(); 
              const restoredMap = new Map<string, AppliedFixInfo>(actionData as Array<[string, AppliedFixInfo]>);
              restoredMap.forEach((value, key) => this.appliedFixStore.add(key, value));
              
              if (this.appliedFixStore.getSize() === 0 && actionType === 'publish') { 
                  this.renderUserMessage("No changes were pending to publish after login.");
                  return;
              }
              if (this.appliedFixStore.getSize() === 0 && actionType === 'saveDraft') { 
                this.renderUserMessage("No changes were pending to save as draft after login.");
                return;
            }
            } catch (e) {
              customError('[FeedbackViewerImpl] Error restoring appliedFixes from localStorage:', e);
              this.showError(`Failed to restore changes for ${actionType}.`);
              return;
            }
          } else if (this.appliedFixStore.getSize() === 0) { 
            this.renderUserMessage(`No changes were pending to ${actionType} after login.`);
            return;
          }
          
          this.renderUserMessage(`Resuming ${actionType} operation after login...`);
          if (actionType === 'publish') {
            await this.handlePublishCommand();
          } else if (actionType === 'saveDraft') {
            await this.handleSaveDraftCommand();
          }
          break;
        case 'fetchStats':
          if (actionData && typeof actionData.queryName === 'string') {
            this.renderUserMessage(`Resuming stats fetch for ${getFriendlyQueryName(actionData.queryName)} after login...`);
            this.initiateStatsFetch(actionData.queryName);
          } else {
            customError('[FeedbackViewerImpl] Invalid or missing queryName for pending fetchStats action.');
            this.showError('Could not restore stats fetch: missing query details.');
          }
          break;
        default:
          customWarn(`[FeedbackViewerImpl] Unknown pending action type: ${actionType}`);
      }
    } else {
      // No action type found, nothing to do
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

  private displayStatsBadges(): void {
    if (!this.domManager) return;

    // Uses getFriendlyQueryName imported from stats-fetcher.ts
    const badgesHtml = `
      <div class="checkra-stats-badges-wrapper">
        <div class="checkra-stats-badges">
          <button class="checkra-stat-badge" data-queryname="metrics_1d">${getFriendlyQueryName('metrics_1d')}</button>
          <button class="checkra-stat-badge" data-queryname="metrics_7d">${getFriendlyQueryName('metrics_7d')}</button>
          <button class="checkra-stat-badge" data-queryname="geo_top5_7d">${getFriendlyQueryName('geo_top5_7d')}</button>
        </div>
      </div>
    `;
    
    this.conversationHistoryManager.saveHistory({ type: 'usermessage', content: badgesHtml }); // Kept as 'usermessage'
  }

  // NEW: Method to initiate stats fetch and handle its result
  private async initiateStatsFetch(queryName: string): Promise<void> {
    if (!this.domManager) return;

    this.domManager.appendHistoryItem({
      type: 'ai',
      content: `Fetching ${getFriendlyQueryName(queryName)}...`,
      isStreaming: true
    });

    try {
      const result = await this.statsFetcher.fetchStats(queryName);
      this.handleStatsResult(result);
    } catch (error) {
      // This catch block now primarily handles AuthenticationRequiredError re-thrown by StatsFetcher
      if (error instanceof AuthenticationRequiredError) {
        await this.handleAuthenticationRequiredAndRedirect('fetchStats', { queryName }, error);
        // No need to updateLastAIMessage here as handlePendingActionAfterLogin will re-trigger
      } else {
        // Handle unexpected errors not caught by StatsFetcher's internal try-catch
        customError("[FeedbackViewerImpl] Unexpected error during initiateStatsFetch:", error);
        this.domManager.updateLastAIMessage(`Sorry, an unexpected error occurred while fetching stats.`, false);
      }
    }
  }

  // NEW: Method to process the result from StatsFetcher
  private handleStatsResult(result: StatsFetcherResult): void {
    if (!this.domManager) return;

    if (result.success && result.markdownTable) {
      this.domManager.updateLastAIMessage(result.markdownTable, false);
    } else if (result.message) {
      // Display error or informational message from StatsFetcher (e.g., "No data", "Could not format")
      // We can use saveHistory which appends a 'usermessage' or updateLastAIMessage for an 'ai' styled error.
      // Using updateLastAIMessage to keep it consistent with how other AI errors are shown.
      this.domManager.updateLastAIMessage(result.message, false);
    } else {
      // Fallback for an unknown state from StatsFetcherResult
      this.domManager.updateLastAIMessage("Received an unrecognized response while fetching stats.", false);
    }
  }

  // Method to be restored and updated
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

      const firstTagIndex = updatedHtml.indexOf('<');
      if (firstTagIndex > 0) {
        updatedHtml = updatedHtml.slice(firstTagIndex);
      }

      try {
        updatedHtml = this.postprocessHtmlFromAI(updatedHtml);
      } catch (e) {
        customWarn('[FeedbackViewerImpl] postprocessHtmlFromAI failed on JSON patch HTML:', e);
      }

      const scrubLeadingNonElement = (html: string): string => {
        const frag = this.createFragmentFromHTML(html);
        if (!frag) return html;

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

      updatedHtml = scrubLeadingNonElement(updatedHtml);

      const testFrag = this.createFragmentFromHTML(updatedHtml);
      if (!testFrag || testFrag.childNodes.length === 0) {
        customError('[FeedbackViewerImpl] Parsed HTML from JSON patch is empty/invalid after scrubbing – will skip applying.');
        return;
      }

      this.fixedOuterHTMLForCurrentCycle = updatedHtml;
      // The activeStreamingAiItem is implicitly handled by ConversationHistoryManager.
      // finalizeResponse, triggered by aiFinalized event, will take care of updating the UI and history state.

    } catch (err) {
      customError('[FeedbackViewerImpl] Error handling aiJsonPatch event:', err);
      this.showError('An error occurred while applying AI suggested changes.');
    }
  }

  // Method to be restored and updated
  private handleDomUpdate(data: { html: string; insertionMode: 'replace' | 'insertBefore' | 'insertAfter' }): void {
    customWarn('[CheckraImplementation] Received aiDomUpdateReceived', data);
    if (!this.currentlyHighlightedElement && this.stableSelectorForCurrentCycle !== 'body') {
      customError('[CheckraImplementation] No currentlyHighlightedElement to apply DOM update to (and not a body update).');
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

    if (!this.currentFixId || !this.originalOuterHTMLForCurrentCycle || !this.requestBodyForCurrentCycle || !this.stableSelectorForCurrentCycle) {
        customError('[CheckraImplementation] Missing context for applyFixToPage in handleDomUpdate.', {
            fixId: this.currentFixId,
            originalHtml: this.originalOuterHTMLForCurrentCycle,
            requestBody: this.requestBodyForCurrentCycle,
            stableSelector: this.stableSelectorForCurrentCycle
        });
        this.showError('Internal error: Could not apply changes due to missing context.');
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
        } else if (this.stableSelectorForCurrentCycle === 'body') {
            document.body.innerHTML = finalHtmlToApply;
            this.removeSelectionHighlight();
        } else {
          customError('[CheckraImplementation] Cannot perform fallback direct DOM insertion, currentlyHighlightedElement is null and not a body update.');
        }
        return;
    }

    this.applyFixToPage(
        this.currentFixId,
        this.originalOuterHTMLForCurrentCycle,
        finalHtmlToApply,
        insertionMode,
        this.requestBodyForCurrentCycle,
        this.stableSelectorForCurrentCycle
    );
    // MODIFIED: Simplified string to avoid template literal issues for diagnostics
    customWarn('[CheckraImplementation] DOM update via applyFixToPage initiated with mode: ' + insertionMode);
        
    this.conversationHistoryManager.finalizeLastAIItem();

    const userMessages = this.conversationHistoryManager.getHistory().filter(item => item.type === 'user');
    const lastUserPrompt = userMessages.length > 0 ? userMessages[userMessages.length -1].content : null;
    if (this.requestBodyForCurrentCycle?.prompt === lastUserPrompt) {
        this.requestBodyForCurrentCycle = null;
    }
  }

  // Method to be restored
  private async handlePublishCommand(): Promise<void> {
    if (this.appliedFixStore.getSize() === 0) {
      this.renderUserMessage("No changes have been applied to publish.");
      return;
    }
    this.renderUserMessage("Publishing changes...");
    try {
      const result: SnapshotOperationResult = await this.snapshotService.publishSnapshot(this.appliedFixStore.getAll());
      this.renderUserMessage(result.message);
      if (result.success && result.cdnUrl) {
        // MODIFIED: Simplified string
        this.renderUserMessage('Share URL: <a href="' + result.cdnUrl + '" target="_blank" rel="noopener noreferrer">' + result.cdnUrl + '</a>');
      } else if (!result.success && result.snapshotId) {
        // MODIFIED: Simplified string
        this.renderUserMessage('Snapshot ID (stored but not fully published): ' + result.snapshotId.substring(0,8) + '...');
      }
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        await this.handleAuthenticationRequiredAndRedirect('publish', Array.from(this.appliedFixStore.getAll().entries()), error);
        this.renderUserMessage("Authentication required to publish. Please log in to continue.");
      } else {
        customError("[FeedbackViewerImpl] Error during publish command:", error);
        const displayErrorMessage = error instanceof Error ? error.message : String(error);
        // MODIFIED: Simplified string for diagnostics
        this.showError('Failed to publish: ' + displayErrorMessage);
      }
    }
  }

  // Method to be restored
  private async handleSaveDraftCommand(): Promise<void> {
    if (this.appliedFixStore.getSize() === 0) {
      this.renderUserMessage("No changes have been applied to save as a draft.");
      return;
    }
    this.renderUserMessage("Saving draft...");
    try {
      const result: SnapshotOperationResult = await this.snapshotService.saveSnapshotAsDraft(this.appliedFixStore.getAll());
      this.renderUserMessage(result.message);
      if (result.success && result.accessUrl) {
        // MODIFIED: Simplified string
        this.renderUserMessage('Access your draft (owner only): <a href="' + result.accessUrl + '" target="_blank" rel="noopener noreferrer">' + result.accessUrl + '</a>');
      }
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) {
        await this.handleAuthenticationRequiredAndRedirect('saveDraft', Array.from(this.appliedFixStore.getAll().entries()), error);
        this.renderUserMessage("Authentication required to save draft. Please log in and try again.");
      } else {
        customError("[FeedbackViewerImpl] Error during save draft command:", error);
        const displayErrorMessage = error instanceof Error ? error.message : String(error);
        // MODIFIED: Simplified string
        this.showError('Failed to save draft: ' + displayErrorMessage);
      }
    }
  }
  
  // Method to be restored
  private showReplaceLoader(targetElement: Element): void {
    if (this.pageReplaceLoaderElement) {
        this.pageReplaceLoaderElement.remove();
    }
    this.pageReplaceLoaderElement = createCenteredLoaderElement();
    
    if (!targetElement.classList.contains('checkra-highlight-container')) {
        targetElement.classList.add('checkra-highlight-container');
    }

    targetElement.appendChild(this.pageReplaceLoaderElement);
    targetElement.classList.add('checkra-element-dimmed');
  }

  // Method to be restored
  private handleAppliedFixRate(fixId: string, anchorElement: HTMLElement): void {
    if (!this.enableRating) {
      customWarn('[FeedbackViewerImpl] Rating is disabled. handleAppliedFixRate should not have been called.');
      return;
    }

    const fixInfo = this.appliedFixStore.get(fixId);
    if (!fixInfo) {
      // MODIFIED: Simplified string
      customWarn('[FeedbackViewerLogic] Cannot rate: Fix info missing for Fix ID: ' + fixId);
      return;
    }

    if (fixInfo.isRated) {
      // MODIFIED: Simplified string
      customWarn('[FeedbackViewerImpl] Fix ' + fixId + ' already rated. Ignoring request.');
      return;
    }

    const onRatingSubmitted = (payload: AddRatingRequestBody) => {
      eventEmitter.emit('fixRated', payload);
      fixInfo.isRated = true;
      if (anchorElement && anchorElement instanceof HTMLButtonElement) {
        anchorElement.classList.add('rated');
        anchorElement.disabled = true;
      }
      // MODIFIED: Simplified string
      customWarn('[FeedbackViewerImpl] Rating submitted for ' + fixId + '. Button styled as rated.');
    };

    const onPopoverClosedWithoutSubmit = () => {
      // MODIFIED: Simplified string
      customWarn('[FeedbackViewerImpl] Rating popover closed without submission for ' + fixId);
    };

    this.ratingUI.showRatingPopover(
      fixInfo,
      anchorElement,
      fixId,
      onRatingSubmitted,
      onPopoverClosedWithoutSubmit
    );
  }

  // --- END of CheckraImplementation class ---
}