import { fetchFeedback } from '../services/ai-service';
import { SELECT_SVG_ICON, type CheckraViewerElements } from './checkra-dom';
import { CheckraDOM } from './checkra-dom';
import type { SettingsModal } from './settings-modal';
import { eventEmitter } from '../core/index';
import { AuthenticationRequiredError } from '../auth/auth';
import { customWarn, customError } from '../utils/logger';
import { GenerateSuggestionRequestbody, AddRatingRequestBody, ResolvedColorInfo } from '../types';
import { OverlayManager, ControlButtonCallbacks } from './overlay-manager';
import { AppliedFixStore, AppliedFixInfo } from './applied-fix-store';
import { RatingUI } from './rating-ui';
import { SnapshotService } from '../services/snapshot-service';
import { StatsFetcher, StatsFetcherResult, getFriendlyQueryName } from '../analytics/stats-fetcher';
import { AuthPendingActionHelper, type AuthCallbackInterface } from '../auth/auth-pending-action-helper';
import { GENERIC_HTML_REGEX } from '../utils/regex';
import { ConversationHistory, type ConversationItem } from './conversation-history';
import { CommandDispatcher } from './command-dispatcher';
import { SelectionManager, type SelectionDetails } from './selection-manager';
import { FixApplier } from './fix-applier';
import { AIResponsePipeline, type ExtractedFix } from './ai-response-pipeline';
import { ViewerEvents, type ViewerEventCallbacks } from './viewer-events';
import { renderLucideIcons } from '../utils/icon-renderer';

export class CheckraImplementation implements AuthCallbackInterface, ViewerEventCallbacks {
  private domElements: CheckraViewerElements | null = null;
  private domManager: CheckraDOM | null = null;
  private settingsModal: SettingsModal | null = null;
  private overlayManager: OverlayManager;
  private optionsInitialVisibility: boolean;
  private enableRating: boolean;
  public appliedFixStore: AppliedFixStore;
  private ratingUI: RatingUI;
  private snapshotService: SnapshotService;
  private statsFetcher: StatsFetcher;
  private authPendingActionHelper: AuthPendingActionHelper;
  private conversationHistoryManager: ConversationHistory;
  private commandDispatcher: CommandDispatcher;
  private selectionManager: SelectionManager | null = null;
  private fixApplier: FixApplier;
  private aiResponsePipeline: AIResponsePipeline;
  private viewerEvents: ViewerEvents;

  // --- State ---
  private isVisible: boolean = false;

  // --- State related to the current selection/AI cycle, set by prepareForInputFromSelection ---
  private currentImageDataUrlForAI: string | null = null;
  private originalOuterHTMLForAI: string | null = null;
  private currentFixIdForAI: string | null = null;
  private stableSelectorForAI: string | null = null;
  private currentElementInsertionModeForAI: 'replace' | 'insertBefore' | 'insertAfter' = 'replace';
  private currentComputedBackgroundColorForAI: string | null = null;
  private targetElementForAI: Element | null = null;
  
  private fixedOuterHTMLForCurrentCycle: string | null = null;
  private currentResolvedColors: ResolvedColorInfo | null = null;
  private requestBodyForCurrentCycle: GenerateSuggestionRequestbody | null = null;

  // --- Quick Suggestion Flow ---
  private queuedPromptText: string | null = null;

  private boundHandleEscapeKey: ((event: KeyboardEvent) => void) | null = null;

  // --- Helpers for binding methods for event listeners ---
  public boundUpdateResponse = this.updateResponse.bind(this);
  public boundRenderUserMessage = this.renderUserMessage.bind(this);
  public boundShowError = this.showError.bind(this);
  public boundFinalizeResponse = this.finalizeResponse.bind(this);
  public boundToggle = this.toggle.bind(this);
  public boundShowFromApi = this.showFromApi.bind(this);
  public boundHandleSuggestionClick = this.handleSuggestionClick.bind(this);
  private readonly PANEL_CLOSED_BY_USER_KEY = 'checkra_panel_explicitly_closed';

  public boundHandleJsonPatch = this.handleJsonPatch.bind(this);
  public boundHandleDomUpdate = this.handleDomUpdate.bind(this);
  public boundHandleRequestBodyPrepared = this.handleRequestBodyPrepared.bind(this);
  public boundHandleResolvedColorsUpdate = this.handleResolvedColorsUpdate.bind(this);
  private boundPrepareForInputFromSelection = this.prepareForInputFromSelection.bind(this);

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
    this.commandDispatcher = new CommandDispatcher(this, this.snapshotService);
    this.fixApplier = new FixApplier(this.appliedFixStore, this.overlayManager);
    this.aiResponsePipeline = new AIResponsePipeline();
    this.viewerEvents = new ViewerEvents(this);

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
    this.boundToggle = this.toggle.bind(this);
    this.boundShowFromApi = this.showFromApi.bind(this);
    this.boundHandleSuggestionClick = this.handleSuggestionClick.bind(this);
    this.boundHandleJsonPatch = this.handleJsonPatch.bind(this);
    this.boundHandleDomUpdate = this.handleDomUpdate.bind(this);
    this.boundHandleRequestBodyPrepared = this.handleRequestBodyPrepared.bind(this);
    this.boundHandleResolvedColorsUpdate = this.handleResolvedColorsUpdate.bind(this);
    this.getControlCallbacksForFix = this.getControlCallbacksForFix.bind(this);
  }

  public async initialize(
    domManager: CheckraDOM,
    settingsModal: SettingsModal
  ): Promise<void> {
    try {
      this.conversationHistoryManager.clearHistory();
      localStorage.removeItem('checkra_onboarded');
    } catch (e) { /* Silently fail */ }

    const handleClose = () => this.hide(true, true);
    this.domElements = domManager.create(handleClose);
    this.domManager = domManager;
    this.settingsModal = settingsModal;
    this.conversationHistoryManager.setDomManager(domManager);

    if (this.domElements?.viewer) {
      this.selectionManager = new SelectionManager(this.domElements.viewer);
    } else {
      customError('[CheckraImplementation] Cannot initialize SelectionManager: domElements.viewer is not available.');
    }

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
    this.authPendingActionHelper.handleAuthErrorInUrl(this);
    this.authPendingActionHelper.handlePendingActionAfterLogin(this);
    eventEmitter.emit('feedbackViewerImplReady');
    await renderLucideIcons();
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
    eventEmitter.off('toggleViewerShortcut', this.boundToggle);
    eventEmitter.off('showViewerApi', this.boundShowFromApi);
    eventEmitter.off('onboardingSuggestionClicked', this.boundHandleSuggestionClick);
    eventEmitter.off('aiJsonPatch', this.boundHandleJsonPatch);
    eventEmitter.off('aiDomUpdateReceived', this.boundHandleDomUpdate);
    eventEmitter.off('requestBodyPrepared', this.boundHandleRequestBodyPrepared);
    eventEmitter.off('internalResolvedColorsUpdate', this.boundHandleResolvedColorsUpdate);
    this.viewerEvents.unsubscribe();
    this.domElements = null;
    this.domManager = null;
    this.removeGlobalListeners();
    this.selectionManager?.resetSelectionState();
  }

  public getIsVisible(): boolean {
    return this.isVisible;
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

  public async finalizeResponse(): Promise<void> {
    customWarn('[CheckraImpl finalizeResponse] INVOKED.');

    if (!this.domManager || !this.domElements) {
      customError('[CheckraImpl finalizeResponse] DOMManager or DOMElements not available. Aborting UI updates.');
      return;
    }
    customWarn('[CheckraImpl finalizeResponse] DOMManager and DOMElements are available.');

    this.selectionManager?.hidePageLoaders();
    customWarn('[CheckraImpl finalizeResponse] Called hidePageLoaders (for page-specific loaders).');

    const streamToFinalize = this.conversationHistoryManager.getActiveStreamingAIItem();
    customWarn(`[CheckraImpl finalizeResponse] Active streaming AI item before processing: ${streamToFinalize ? streamToFinalize.type + ' - ' + streamToFinalize.content.substring(0,30) : 'null'}`);

    if (streamToFinalize && streamToFinalize.type === 'ai' && streamToFinalize.isStreaming) {
      customWarn('[CheckraImpl finalizeResponse] Found active AI stream to finalize in history.');
      if (this.fixedOuterHTMLForCurrentCycle === null) {
        customWarn('[CheckraImpl finalizeResponse] fixedOuterHTMLForCurrentCycle is null, attempting to extract from final stream content.');
        const lastAiItemContent = streamToFinalize.content;
        // If the content is purely text, extractHtmlFromResponse might return null for fixedHtml
        const extractionResult: ExtractedFix = this.aiResponsePipeline.extractHtmlFromResponse(lastAiItemContent);
        this.fixedOuterHTMLForCurrentCycle = extractionResult.fixedHtml; // This might still be null if no HTML fix
        customWarn(`[CheckraImpl finalizeResponse] After extractHtmlFromResponse, fixedOuterHTMLForCurrentCycle snippet: ${this.fixedOuterHTMLForCurrentCycle?.substring(0, 50)}`);
        
        // Ensure the analysis portion (text) is what's stored if fixedHtml was extracted
        if (extractionResult.analysisPortion && extractionResult.analysisPortion !== lastAiItemContent && extractionResult.fixedHtml) {
          customWarn('[CheckraImpl finalizeResponse] Analysis portion differs and fix HTML extracted. Updating last AI item content in history with analysis.');
          this.conversationHistoryManager.setLastAIItemContent(extractionResult.analysisPortion);
        } else {
          customWarn('[CheckraImpl finalizeResponse] No separate analysis portion to update, or no fix HTML extracted. Content in history is final text from stream.');
        }
      } else {
        customWarn(`[CheckraImpl finalizeResponse] fixedOuterHTMLForCurrentCycle was already set (e.g., by handleDomUpdate or handleJsonPatch). Snippet: ${this.fixedOuterHTMLForCurrentCycle?.substring(0,50)}`);
      }

      let fixDataForHistory: { originalHtml: string; fixedHtml: string; fixId: string } | undefined = undefined;
      if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForAI && this.currentFixIdForAI) {
        fixDataForHistory = {
          originalHtml: this.originalOuterHTMLForAI,
          fixedHtml: this.fixedOuterHTMLForCurrentCycle,
          fixId: this.currentFixIdForAI
        };
        customWarn('[CheckraImpl finalizeResponse] Prepared fixDataForHistory for conversation history.');
      }
      // Always finalize the item in history to mark it as not streaming, even if no fixData
      this.conversationHistoryManager.finalizeLastAIItem(fixDataForHistory);
      customWarn('[CheckraImpl finalizeResponse] Called conversationHistoryManager.finalizeLastAIItem.');
    } else {
      customWarn(`[CheckraImpl finalizeResponse] No active AI message was streaming, or streamToFinalize is null/not AI type. streamToFinalize: ${!!streamToFinalize}`);
      // This case can happen if the stream ends without a currently active streaming item, or if the last item wasn't AI.
      // We should still ensure any previous AI message that *might* have been streaming is finalized.
      const history = this.conversationHistoryManager.getHistory();
      const lastHistoryAIItem = [...history].reverse().find(item => item.type === 'ai');
      if (lastHistoryAIItem && lastHistoryAIItem.isStreaming) {
        customWarn("[CheckraImpl finalizeResponse] Fallback: Finalizing the most recent AI item in history as not streaming because no active stream was found.");
        this.conversationHistoryManager.finalizeLastAIItem(undefined); // Finalize without specific fix data
      } else {
        customWarn("[CheckraImpl finalizeResponse] No streaming AI item to finalize explicitly. UI updates will proceed.");
      }
    }
    
    customWarn('[CheckraImpl finalizeResponse] Proceeding to UI finalization (loader, prompt state).');
    this.domManager.updateLoaderVisibility(false);
    customWarn('[CheckraImpl finalizeResponse] Called domManager.updateLoaderVisibility(false).');
    this.domManager.setPromptState(true);
    customWarn('[CheckraImpl finalizeResponse] Called domManager.setPromptState(true).');
    this.domManager.updateSubmitButtonState(true);
    customWarn('[CheckraImpl finalizeResponse] Called domManager.updateSubmitButtonState(true). UI finalization complete.');

    customWarn('[CheckraImpl finalizeResponse] Conditions for fixApplier.apply:', {
        currentFixIdForAI: !!this.currentFixIdForAI,
        originalOuterHTMLForAI: !!this.originalOuterHTMLForAI,
        fixedOuterHTMLForCurrentCycle: !!this.fixedOuterHTMLForCurrentCycle, // This might be null for text-only responses
        requestBodyForCurrentCycle: !!this.requestBodyForCurrentCycle,
        stableSelectorForAI: !!this.stableSelectorForAI
    });
    customWarn(`[CheckraImpl finalizeResponse] Value of fixedOuterHTMLForCurrentCycle before apply attempt: ${this.fixedOuterHTMLForCurrentCycle?.substring(0, 100)}`);

    if (
      this.currentFixIdForAI &&
      this.originalOuterHTMLForAI &&
      this.fixedOuterHTMLForCurrentCycle && // Only attempt apply if there's actually HTML
      this.requestBodyForCurrentCycle &&
      this.stableSelectorForAI
    ) {
      customWarn('[CheckraImpl finalizeResponse] All conditions MET. Calling fixApplier.apply.');
      const appliedFixInfo = this.fixApplier.apply({
        fixId: this.currentFixIdForAI,
        originalHtml: this.originalOuterHTMLForAI,
        fixedHtml: this.fixedOuterHTMLForCurrentCycle, 
        insertionMode: this.currentElementInsertionModeForAI,
        requestBody: this.requestBodyForCurrentCycle,
        stableSelector: this.stableSelectorForAI,
        currentResolvedColors: this.currentResolvedColors,
        getControlCallbacks: this.getControlCallbacksForFix
      });
      if (appliedFixInfo) {
        customWarn('[CheckraImpl finalizeResponse] Fix applied successfully by FixApplier.');
        this.selectionManager?.removeSelectionHighlight(); 
        await renderLucideIcons();
      } else {
        this.showError(`Failed to apply fix: ${this.currentFixIdForAI}. See console for details.`);
        customError('[CheckraImpl finalizeResponse] fixApplier.apply returned null/false.');
      }
    } else {
      customWarn('[CheckraImpl finalizeResponse] One or more conditions NOT MET for fixApplier.apply, or no HTML fix content. No fix applied.');
      if (this.fixedOuterHTMLForCurrentCycle === null && this.currentFixIdForAI) {
        customWarn('[CheckraImpl finalizeResponse] fixedOuterHTMLForCurrentCycle is null (text-only AI response or extraction error). Fix not applied.')
      }
    }
    
    // Store whether there was HTML content before nullifying, to decide on resetting selection
    const hadHtmlFixContent = !!this.fixedOuterHTMLForCurrentCycle;

    // Reset state variables for the next cycle
    this.requestBodyForCurrentCycle = null;
    this.fixedOuterHTMLForCurrentCycle = null; 
    this.currentResolvedColors = null;
    
    // If there was HTML content processed (even if application failed for other reasons),
    // or if the fix applier indicates a structural change was made,
    // then reset the selection context.
    // Otherwise (e.g., text-only response), keep the selection context for potential re-prompt.
    if (hadHtmlFixContent) { 
        customWarn('[CheckraImpl finalizeResponse] Resetting selection context as HTML fix content was processed.');
        this.resetStateForNewSelection(); // This clears currentFixIdForAI, originalOuterHTMLForAI etc.
        this.selectionManager?.removeSelectionHighlight();
    } else {
        customWarn('[CheckraImpl finalizeResponse] No HTML fix content was processed (e.g. text-only response). Retaining selection context for potential re-prompt.');
    }
  }

  public showError(error: Error | string): void {
    let errorHtmlContent: string;
    this.selectionManager?.hidePageLoaders();
    if (typeof error === 'string' && error.includes(SELECT_SVG_ICON)) {
      errorHtmlContent = error;
    } else {
      const errorTextMessage = error instanceof Error ? error.message : error;
      const escapedErrorMessage = new Option(errorTextMessage).innerHTML;
      errorHtmlContent = escapedErrorMessage;
      customError('[Checkra AI Error]', errorTextMessage);
    }
    const errorItem: ConversationItem = {
      type: 'error',
      content: errorHtmlContent,
    };
    this.conversationHistoryManager.saveHistory(errorItem);
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
    this.selectionManager?.removeSelectionHighlight();
    this.resetStateForNewSelection(); 
    if (initiatedByUser && fromCloseButton) {
      localStorage.setItem(this.PANEL_CLOSED_BY_USER_KEY, 'true');
      this.domManager?.showAvailabilityToast();
    }
    eventEmitter.emit('viewerDidHide'); 
  }

  private resetStateForNewSelection(): void {
    this.currentImageDataUrlForAI = null;
    this.originalOuterHTMLForAI = null;
    this.fixedOuterHTMLForCurrentCycle = null;
    this.stableSelectorForAI = null;
    this.currentFixIdForAI = null;
    this.currentComputedBackgroundColorForAI = null;
    this.targetElementForAI = null;
    this.selectionManager?.resetSelectionState();
    this.currentResolvedColors = null;
  }

  public renderUserMessage(message: string): void {
    if (!this.domManager) {
      customError("[FeedbackViewerImpl] Cannot render user message: DOM Manager not initialized.");
      return;
    }
    const userMessageItem: ConversationItem = { type: 'usermessage', content: message };
    this.conversationHistoryManager.saveHistory(userMessageItem);
  }

  private handleTextareaKeydown(e: KeyboardEvent): void {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      this.handleSubmit();
    }
  }

  private async handleSubmit(): Promise<void> {
    const promptText = this.domElements?.promptTextarea.value.trim();
    if (promptText) {
      const commandHandled = await this.commandDispatcher.tryHandleCommand(promptText);
      if (commandHandled) {
        this.domManager?.setPromptState(true, '');
        this.domManager?.updateSubmitButtonState(true);
        if (this.domElements?.promptTextarea) {
            this.domElements.promptTextarea.value = '';
        }
        return;
      }
    }

    // Ensure that an element has been selected OR the prompt is general (does not require an element context)
    // For now, the main check is if originalOuterHTMLForAI and currentFixIdForAI are set, implying element selection.
    if (!this.domManager || !this.domElements || !this.originalOuterHTMLForAI || !this.currentFixIdForAI) {
      // If these are not set, it means no element was properly selected for context-specific feedback.
      // However, a user might still want to submit a general prompt that doesn't target a specific element.
      // The current logic shows an error. We might need to refine this if general prompts are allowed
      // without prior selection (e.g. after an onboarding click if user then types something else general).
      // For the onboarding flow, selection is expected after the click.
      this.showError(`First select an element on your website using the${SELECT_SVG_ICON}`);
      return;
    }

    // Hide onboarding view if it's active, as we are now submitting the actual prompt.
    if (this.domManager && this.domManager.isOnboardingVisible()) { 
        this.domManager.showOnboardingView(false);
    }

    if (!promptText) {
      this.showError('Please enter a description or question.');
      return;
    }
    this.domManager.setPromptState(false);
    this.domManager.updateSubmitButtonState(false);
    this.domManager.updateLoaderVisibility(true, 'Loading...');
    this.domManager.clearUserMessage();
    this.domManager.showPromptInputArea(false, promptText);
    this.selectionManager?.hidePageLoaders();
    if (this.currentElementInsertionModeForAI === 'insertBefore' || this.currentElementInsertionModeForAI === 'insertAfter') {
        this.selectionManager?.showPageSpecificLoaders(this.currentElementInsertionModeForAI);
    } else if (this.currentElementInsertionModeForAI === 'replace') {
        this.selectionManager?.showPageSpecificLoaders('replace', this.targetElementForAI);
    }

    const imageKeywords = ["image", "photo", "picture", "screenshot", "visual", "look", "style", "design", "appearance", "graphic", "illustration", "background", "banner", "logo"];
    const promptHasImageKeyword = imageKeywords.some(keyword => promptText.toLowerCase().includes(keyword));
    let imageDataToSend: string | null = null;
    if (promptHasImageKeyword && this.currentImageDataUrlForAI) {
      imageDataToSend = this.currentImageDataUrlForAI;
    } else if (promptHasImageKeyword && !this.currentImageDataUrlForAI) {
      customWarn('[FeedbackViewerLogic] Prompt suggests a design request, but no screenshot was captured/available.');
    }
    this.conversationHistoryManager.saveHistory({ type: 'user', content: promptText });
    const newAiPlaceholder: ConversationItem = { type: 'ai', content: '', isStreaming: true };
    this.conversationHistoryManager.saveHistory(newAiPlaceholder);

    let processedHtmlForAI = this.originalOuterHTMLForAI;
    if (processedHtmlForAI) {
        try {
          processedHtmlForAI = this.aiResponsePipeline.preprocessHtmlForAI(processedHtmlForAI);
        } catch (e) {
          customError('[FeedbackViewerLogic] Error preprocessing HTML for AI:', e);
          this.showError('Failed to process HTML before sending.');
          return;
        }
    } else {
        customError('[FeedbackViewerLogic] Original HTML for AI is null. Cannot preprocess.');
        this.showError('Cannot process page content.');
        return;
    }

    customWarn(`[CheckraImpl handleSubmit] Sending to backend with insertionMode: ${this.currentElementInsertionModeForAI}`);

    fetchFeedback(imageDataToSend, promptText, processedHtmlForAI, this.currentElementInsertionModeForAI, this.currentComputedBackgroundColorForAI);
    this.domManager?.setPromptState(true, '');
    this.domManager?.updateSubmitButtonState(true);
    try {
      if (!localStorage.getItem('checkra_onboarded')) {
        localStorage.setItem('checkra_onboarded', '1');
      }
    } catch (e) {
      customWarn('[FeedbackViewerImpl] Failed to set checkra_onboarded after submission:', e);
    }
  }

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

  private async handleAppliedFixToggle(fixId: string): Promise<void> {
    const fixInfo = this.appliedFixStore.get(fixId);
    if (!fixInfo || !fixInfo.markerStartNode || !fixInfo.markerEndNode || !fixInfo.appliedFixWrapperElement) {
      customWarn(`[FeedbackViewerLogic] Toggle: Could not find fix info, markers, or wrapper for Fix ID: ${fixId}.`);
      return;
    }
    const { originalOuterHTML, fixedOuterHTML, appliedFixWrapperElement } = fixInfo;
    
    try {
      const htmlToInsert = fixInfo.isCurrentlyFixed ? originalOuterHTML : fixedOuterHTML;
      
      while (appliedFixWrapperElement.firstChild) {
        appliedFixWrapperElement.removeChild(appliedFixWrapperElement.firstChild);
      }

      const newContentFragment = this.createFragmentFromHTML(htmlToInsert);
      let newActualAppliedElement: HTMLElement | null = null;

      if (newContentFragment && newContentFragment.childNodes.length > 0) {
        appliedFixWrapperElement.appendChild(newContentFragment);
        newActualAppliedElement = appliedFixWrapperElement.firstElementChild as HTMLElement || null;
      } else {
        customWarn(`[FeedbackViewerLogic] Toggle: HTML to insert was empty or invalid for fixId: ${fixId}. Wrapper is now empty.`);
      }

      fixInfo.actualAppliedElement = newActualAppliedElement;

      if (newActualAppliedElement) {
        this.overlayManager.showControlsForFix(
          fixId, 
          newActualAppliedElement,
          appliedFixWrapperElement,
          this.getControlCallbacksForFix(fixId)
        );
      } else {
        customWarn(`[FeedbackViewerLogic] Toggle: No actual element to show controls for after toggle for fixId: ${fixId}. Hiding controls.`);
        this.overlayManager.hideControlsForFix(fixId);
      }
      
      await renderLucideIcons();
      
      fixInfo.isCurrentlyFixed = !fixInfo.isCurrentlyFixed;
      this.overlayManager.updateToggleButtonVisuals(fixId, fixInfo.isCurrentlyFixed);
    } catch (error) {
      customError(`[FeedbackViewerLogic] Error toggling fix ${fixId}:`, error);
      if (fixInfo) { 
        this.overlayManager.updateToggleButtonVisuals(fixId, fixInfo.isCurrentlyFixed);
      }
    }
  }

  public getControlCallbacksForFix(fixId: string): ControlButtonCallbacks {
    return {
      onClose: () => this.handleAppliedFixClose(fixId),
      onToggle: () => this.handleAppliedFixToggle(fixId),
      onCopy: () => this.handleAppliedFixCopy(fixId),
      onRate: this.enableRating ? (anchorElement: HTMLElement) => this.handleAppliedFixRate(fixId, anchorElement) : undefined
    };
  }

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
   - Use the \`uniqueSelector\` to confirm you\'ve found the correct element if the live application can be run and inspected (e.g., via browser devtools and \`document.querySelector(\`${stableTargetSelector}\`)\`).

2. Apply the necessary changes to this source code so that its rendered output will exactly match the \`proposedOuterHTML\` from the JSON payload.
   - Make the changes idiomatically according to the project\'s existing coding patterns and technologies.
   - This might involve changing component props, updating template syntax, modifying class lists (e.g., for Tailwind CSS), or altering attributes.

3. Aim for semantic and minimal changes. For example, if only a class name changed, update the class, don\'t replace the entire HTML block if avoidable.

4. If the changes involve CSS classes that are not utility classes (like Tailwind), ensure that any necessary new CSS definitions are added or existing ones are updated to match the visual intent of the \`proposedOuterHTML\`

5. IMPORTANT: Return only the modified code block(s) or the diff. Do not include explanations unless the changes are complex and warrant it.
`;
    return fullPrompt;
  }

  public toggle(): void {
    if (this.isVisible) {
      this.hide(true, false);
    } else {
      this.showFromApi(true);
    }
  }

  public showOnboarding(): void {
    if (!this.domManager || !this.domElements) {
      customError("[FeedbackViewerLogic] Cannot show onboarding: DOM Manager or elements not initialized.");
      return;
    }
    this.domManager.showOnboardingView(true);
    this.domManager.showPromptInputArea(false);
    this.domManager.clearAIResponseContent();
    this.domManager.updateLoaderVisibility(false);
    this.domManager.show();
    this.isVisible = true;
    this.onToggleCallback(true);
  }
  
  private handleMiniSelectClick(e: MouseEvent): void {
    e.stopPropagation();
    if (this.selectionManager) {
      // Clear any existing active selection before starting a new one
      this.selectionManager.removeSelectionHighlight();
      this.resetStateForNewSelection(); // Clears originalOuterHTMLForAI, currentFixIdForAI, etc.
      
      this.selectionManager.startElementSelection('replace', this.boundPrepareForInputFromSelection);
    } else {
      customError('[CheckraImpl] SelectionManager not initialized. Cannot start screen capture.');
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
    if (event.key === 'Escape' && this.isVisible) {
      this.hide(true, false);
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
      if (triggeredByUserAction) {
        localStorage.removeItem(this.PANEL_CLOSED_BY_USER_KEY);
      }
      return;
    }
    if (!this.domManager) {
      customError('[FeedbackViewerLogic] Cannot show: DOM Manager not initialized.');
      return;
    }
    eventEmitter.emit('viewerWillShow');
    this.domManager.show();
    this.isVisible = true;
    this.onToggleCallback(true);
    if (triggeredByUserAction) {
      localStorage.removeItem(this.PANEL_CLOSED_BY_USER_KEY);
    }
    if (!localStorage.getItem('checkra_onboarded')) {
      this.showOnboarding();
      localStorage.setItem('checkra_onboarded', 'true');
    } else {
      if (this.domElements && document.activeElement !== this.domElements.promptTextarea) {
          this.domElements.promptTextarea.focus();
      }
    }
    eventEmitter.emit('viewerDidShow');
  }

  private handleResolvedColorsUpdate(colors: ResolvedColorInfo): void {
    customWarn('[CheckraImpl] Received internalResolvedColorsUpdate:', colors);
    this.currentResolvedColors = colors;
  }

  private async invokeAuthRedirect(actionType: string, actionData: any, authError: AuthenticationRequiredError): Promise<void> {
    await this.authPendingActionHelper.handleAuthenticationRequiredAndRedirect(
      actionType, 
      actionData, 
      authError,
      this
    );
  }

  public displayStatsBadges(): void {
    if (!this.domManager) return;
    const badgesHtml = `
      <div class="checkra-stats-badges-wrapper">
        <div class="checkra-stats-badges">
          <button class="checkra-stat-badge" data-queryname="metrics_1d">${getFriendlyQueryName('metrics_1d')}</button>
          <button class="checkra-stat-badge" data-queryname="metrics_7d">${getFriendlyQueryName('metrics_7d')}</button>
          <button class="checkra-stat-badge" data-queryname="geo_top5_7d">${getFriendlyQueryName('geo_top5_7d')}</button>
        </div>
      </div>
    `;
    this.conversationHistoryManager.saveHistory({ type: 'usermessage', content: badgesHtml });
  }

  public async initiateStatsFetch(queryName: string): Promise<void> {
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
      if (error instanceof AuthenticationRequiredError) {
        await this.invokeAuthRedirect('fetchStats', { queryName }, error); 
      } else {
        customError("[FeedbackViewerImpl] Unexpected error during initiateStatsFetch:", error);
        this.domManager.updateLastAIMessage(`Sorry, an unexpected error occurred while fetching stats.`, false);
      }
    }
  }

  private handleStatsResult(result: StatsFetcherResult): void {
    if (!this.domManager) return;
    if (result.success && result.markdownTable) {
      this.domManager.updateLastAIMessage(result.markdownTable, false);
    } else if (result.message) {
      this.domManager.updateLastAIMessage(result.message, false);
    } else {
      this.domManager.updateLastAIMessage("Received an unrecognized response while fetching stats.", false);
    }
  }

  private handleJsonPatch(patchEvent: { payload: any; originalHtml: string }): void {
    customWarn('[CheckraImpl handleJsonPatch] Received event:', patchEvent);
    try {
      const { payload, originalHtml } = patchEvent;
      let patchArray: any = null;
      if (typeof payload === 'string') {
        try { 
          patchArray = JSON.parse(payload); 
          customWarn('[CheckraImpl handleJsonPatch] Parsed string payload into array:', patchArray);
        } catch (e) {
          customError('[CheckraImpl handleJsonPatch] Failed to parse JSON patch payload string:', e, payload);
          this.showError('Failed to parse JSON patch from AI response.'); return;
        }
      } else { 
        patchArray = payload; 
        customWarn('[CheckraImpl handleJsonPatch] Payload is already an object/array:', patchArray);
      }

      if (!Array.isArray(patchArray)) {
        customError('[CheckraImpl handleJsonPatch] Patch payload is not an array:', patchArray);
        this.showError('Invalid JSON patch received from AI.'); return;
      }

      let updatedHtmlFromPatch: string | null = null;
      for (const op of patchArray) {
        if (op && op.op === 'replace' && (op.path === '' || op.path === '/')) {
          updatedHtmlFromPatch = op.value as string; 
          customWarn('[CheckraImpl handleJsonPatch] Extracted HTML from replace op:', updatedHtmlFromPatch?.substring(0, 200));
          break;
        }
      }
      if (!updatedHtmlFromPatch) {
        customWarn('[CheckraImpl handleJsonPatch] No root replace op found in JSON patch. Using originalHtml from event as fallback for processing pipeline.');
        updatedHtmlFromPatch = originalHtml; 
      }

      customWarn('[CheckraImpl handleJsonPatch] HTML going into AIResponsePipeline.processJsonPatchedHtml:', updatedHtmlFromPatch?.substring(0, 200));
      this.fixedOuterHTMLForCurrentCycle = this.aiResponsePipeline.processJsonPatchedHtml(updatedHtmlFromPatch);
      customWarn('[CheckraImpl handleJsonPatch] HTML after AIResponsePipeline.processJsonPatchedHtml (this.fixedOuterHTMLForCurrentCycle):', this.fixedOuterHTMLForCurrentCycle?.substring(0, 200));

      const testFrag = this.createFragmentFromHTML(this.fixedOuterHTMLForCurrentCycle || ''); 
      if (!testFrag || testFrag.childNodes.length === 0) {
        customError('[CheckraImpl handleJsonPatch] Processed HTML from JSON patch is empty/invalid after pipeline. fixedOuterHTMLForCurrentCycle will be null.');
        this.fixedOuterHTMLForCurrentCycle = null; 
      } else {
        customWarn('[CheckraImpl handleJsonPatch] Processed HTML from JSON patch is VALID.');
      }
    } catch (err) {
      customError('[CheckraImpl handleJsonPatch] Error handling aiJsonPatch event:', err);
      this.showError('An error occurred while applying AI suggested changes.');
      this.fixedOuterHTMLForCurrentCycle = null;
    }
  }

  private async handleDomUpdate(data: { html: string; insertionMode: 'replace' | 'insertBefore' | 'insertAfter' }): Promise<void> {
    customWarn('[CheckraImplementation] Received aiDomUpdateReceived', data);
    
    const { html, insertionMode } = data;
    let processedHtml = html;
    const fenceRegex = /^```(?:html)?\n([\s\S]*?)\n```$/i;
    const fenceMatch = processedHtml.match(fenceRegex);
    if (fenceMatch && fenceMatch[1]) {
      processedHtml = fenceMatch[1].trim();
    }

    const finalHtmlToApply = this.aiResponsePipeline.processJsonPatchedHtml(processedHtml);

    const testFrag = this.createFragmentFromHTML(finalHtmlToApply);
    if (!testFrag || testFrag.childNodes.length === 0) {
      customError('[CheckraImplementation] HTML for domUpdate is empty/invalid after pipeline processing. Aborting.');
      this.showError('AI generated empty content, nothing to apply.');
      // Ensure finalizeResponse doesn't try to apply an empty fix if this was the only HTML received
      this.fixedOuterHTMLForCurrentCycle = null; 
      return;
    }

    // Set the necessary properties for finalizeResponse to use
    this.fixedOuterHTMLForCurrentCycle = finalHtmlToApply;
    this.currentElementInsertionModeForAI = insertionMode;

    customWarn(`[CheckraImplementation handleDomUpdate] fixedOuterHTMLForCurrentCycle set from domUpdateHtml. Insertion mode: ${this.currentElementInsertionModeForAI}. Content snippet:`, finalHtmlToApply.substring(0,200));
    
    // Do NOT call fixApplier.apply here. Let finalizeResponse handle it.
    // Do NOT nullify instance variables here.

    // It might be appropriate to finalize the AI item in history if this is the terminal HTML update
    // However, aiFinalized event should still trigger finalizeResponse for the actual application.
    // For now, let's assume that if a domUpdateHtml comes, it might be followed by more content OR aiFinalized.
    // If it's the *only* content, finalizeResponse will pick it up.
    // If there was other streaming text that formed an analysis, that text will be in the AI bubble,
    // and this HTML will be used for the fix.
  }

  private handleRequestBodyPrepared(requestBody: GenerateSuggestionRequestbody): void {
    this.requestBodyForCurrentCycle = requestBody;
    customWarn('[FeedbackViewerImpl] Received full request body with metadata:', {
      hasFrameworkDetection: !!requestBody.metadata?.frameworkDetection,
      hasCssDigests: !!requestBody.metadata?.cssDigests,
      hasUiKitDetection: !!requestBody.metadata?.uiKitDetection
    });
  }

  private handleSuggestionClick(promptText: string): void {
    if (!promptText || !this.domManager || !this.domElements?.promptTextarea) {
        customWarn('[CheckraImpl] handleSuggestionClick: No prompt text or DOM elements not ready.');
        return;
    }

    this.domElements.promptTextarea.value = promptText;
    this.domElements.promptTextarea.focus();

    this.queuedPromptText = promptText;

    // Check if an element is already selected
    if (this.originalOuterHTMLForAI && this.currentFixIdForAI && this.targetElementForAI) {
      customWarn('[CheckraImpl] Suggestion clicked, and an element was already selected. Submitting immediately.');
      // The prompt is in queuedPromptText, prepareForInputFromSelection will pick it up if it calls handleSubmit
      // Or handleSubmit will use the textarea value. Ensure textarea has the correct prompt.
      if (this.domElements?.promptTextarea) {
        this.domElements.promptTextarea.value = promptText; // Ensure textarea has the chip's prompt
      }
      // Since prepareForInputFromSelection is what usually populates promptTextarea if queuedPromptText is set,
      // and then calls handleSubmit, we can directly call handleSubmit here as the selection is already done.
      this.handleSubmit(); 
    } else if (this.selectionManager) {
      customWarn('[CheckraImpl] Suggestion clicked. Prompt queued. Starting element selection as no element was pre-selected.');
      this.selectionManager.startElementSelection('replace', this.boundPrepareForInputFromSelection);
      if (this.domElements?.promptTextarea) {
        this.domElements.promptTextarea.placeholder = 'Please select an element on the page to apply this suggestion.';
      }
      this.domManager.updateSubmitButtonState(true);
    } else {
      customError('[CheckraImpl] SelectionManager not initialized. Cannot start element selection after suggestion click.');
      this.showError('Could not start element selection. Please try again.');
      this.queuedPromptText = null; // Clear queued prompt as we can't proceed
    }
  }

  private handleAppliedFixRate(fixId: string, anchorElement: HTMLElement): void {
    if (!this.enableRating) {
      customWarn('[FeedbackViewerImpl] Rating is disabled. handleAppliedFixRate should not have been called.');
      return;
    }
    const fixInfo = this.appliedFixStore.get(fixId);
    if (!fixInfo) {
      customWarn('[FeedbackViewerLogic] Cannot rate: Fix info missing for Fix ID: ' + fixId);
      return;
    }
    if (fixInfo.isRated) {
      customWarn('[FeedbackViewerImpl] Fix ' + fixId + ' has already been rated. Re-rating is not allowed.');
      if (anchorElement && anchorElement instanceof HTMLButtonElement) {
        anchorElement.classList.remove('rated'); 
        anchorElement.classList.add('rated-successfully');
        anchorElement.disabled = true;
      }
      return;
    }

    const onRatingSubmitted = async (payload: AddRatingRequestBody) => {
      eventEmitter.emit('fixRated', payload);
      fixInfo.isRated = true;

      if (anchorElement && anchorElement instanceof HTMLButtonElement) {
        anchorElement.classList.remove('rated');
        anchorElement.classList.add('rated-successfully');
        anchorElement.disabled = true;
      }
      customWarn('[FeedbackViewerImpl] Rating submitted for ' + fixId + '. Button styled as rated-successfully and disabled.');
      this.ratingUI.hideRatingPopover();
    };

    const onPopoverClosedWithoutSubmit = () => {
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

  private createFragmentFromHTML(htmlString: string): DocumentFragment | null {
    try {
      const template = document.createElement('template');
      template.innerHTML = htmlString.trim();
      return template.content;
    } catch (e) {
      customError("[CheckraImplementation] Error creating fragment from HTML string:", e, htmlString);
      return null;
    }
  }

  private prepareForInputFromSelection(details: SelectionDetails): void {
    if (!this.domManager || !this.domElements) {
      customError("[CheckraImplementation] Cannot prepare for input: DOM Manager or elements not initialized.");
      return;
    }
    this.currentImageDataUrlForAI = details.imageDataUrl;
    this.originalOuterHTMLForAI = details.originalOuterHTML;
    this.currentFixIdForAI = details.fixId;
    this.stableSelectorForAI = details.stableSelector;
    this.currentElementInsertionModeForAI = details.insertionMode;
    this.currentComputedBackgroundColorForAI = details.computedBackgroundColor;
    this.targetElementForAI = details.targetElement;

    this.fixedOuterHTMLForCurrentCycle = null;
    this.requestBodyForCurrentCycle = null; 

    this.domManager.setPromptState(true, '');
    const isElementEffectivelySelected = !!(details.targetElement && details.targetElement !== document.body);
    this.domManager.updateSubmitButtonState(isElementEffectivelySelected);
    if (!isElementEffectivelySelected) {
      if (this.domElements) this.domElements.promptTextarea.placeholder = 'Please select an element on the page to provide feedback.';
    } else {
      if (this.domElements) this.domElements.promptTextarea.placeholder = 'e.g., "How can I improve the UX or conversion of this section?"';
    }
    this.domManager.updateLoaderVisibility(false);
    this.domManager.showFooterCTA(false);
    this.domElements?.promptTextarea.focus();

    if (this.queuedPromptText && this.domElements) {
      this.domElements.promptTextarea.value = this.queuedPromptText;
      this.queuedPromptText = null;
      this.handleSubmit();
    }
  }

  public async handlePublishCommand(): Promise<void> {
    customWarn('[CheckraImpl] Resuming handlePublishCommand via CommandDispatcher after auth.');
    await this.commandDispatcher.tryHandleCommand('/publish'); 
  }

  public async handleSaveDraftCommand(): Promise<void> {
    customWarn('[CheckraImpl] Resuming handleSaveDraftCommand via CommandDispatcher after auth.');
    await this.commandDispatcher.tryHandleCommand('/save');
  }
}