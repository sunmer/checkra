import { fetchFeedback } from '../services/ai-service';
import { SELECT_SVG_ICON, type CheckraViewerElements } from './checkra-dom';
import type { CheckraDOM } from './checkra-dom';
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

  public initialize(
    domManager: CheckraDOM,
    settingsModal: SettingsModal
  ): void {
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

  public finalizeResponse(): void {
    if (!this.domManager || !this.domElements) return;
    this.selectionManager?.hidePageLoaders();
    const streamToFinalize = this.conversationHistoryManager.getActiveStreamingAIItem();

    if (streamToFinalize && streamToFinalize.type === 'ai' && streamToFinalize.isStreaming) {
      if (this.fixedOuterHTMLForCurrentCycle === null) {
        customWarn('[CheckraImpl finalizeResponse] fixedOuterHTMLForCurrentCycle is null, attempting to extract from stream.');
        const lastAiItemContent = streamToFinalize.content;
        const extractionResult: ExtractedFix = this.aiResponsePipeline.extractHtmlFromResponse(lastAiItemContent);
        this.fixedOuterHTMLForCurrentCycle = extractionResult.fixedHtml;
        customWarn('[CheckraImpl finalizeResponse] After extractHtmlFromResponse, fixedOuterHTMLForCurrentCycle:', this.fixedOuterHTMLForCurrentCycle?.substring(0, 200));
        
        if (extractionResult.analysisPortion && extractionResult.analysisPortion !== lastAiItemContent) {
          this.conversationHistoryManager.setLastAIItemContent(extractionResult.analysisPortion);
        }
      } else {
        customWarn('[CheckraImpl finalizeResponse] fixedOuterHTMLForCurrentCycle was already set (likely by JSON patch). Skipping extraction from stream.');
      }

      let fixDataForHistory: { originalHtml: string; fixedHtml: string; fixId: string } | undefined = undefined;
      if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForAI && this.currentFixIdForAI) {
        fixDataForHistory = {
          originalHtml: this.originalOuterHTMLForAI,
          fixedHtml: this.fixedOuterHTMLForCurrentCycle,
          fixId: this.currentFixIdForAI
        };
      }
      this.conversationHistoryManager.finalizeLastAIItem(fixDataForHistory);
    } else {
      customWarn(`[CheckraImpl finalizeResponse] No active AI message was streaming or streamToFinalize is null.`);
      if (this.fixedOuterHTMLForCurrentCycle === null) {
        const history = this.conversationHistoryManager.getHistory();
        const lastHistoryAIItem = [...history].reverse().find(item => item.type === 'ai' && item.isStreaming);
        if (lastHistoryAIItem) {
          customWarn("[CheckraImpl finalizeResponse DEBUG] Fallback - found a different streaming AI item in history. Finalizing it.", lastHistoryAIItem);
          const extractionResult: ExtractedFix = this.aiResponsePipeline.extractHtmlFromResponse(lastHistoryAIItem.content);
          this.fixedOuterHTMLForCurrentCycle = extractionResult.fixedHtml;
          customWarn('[CheckraImpl finalizeResponse - Fallback] After extractHtmlFromResponse, fixedOuterHTMLForCurrentCycle:', this.fixedOuterHTMLForCurrentCycle?.substring(0, 200));
          let fixDataForHistory: { originalHtml: string; fixedHtml: string; fixId: string } | undefined = undefined;
          if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForAI && this.currentFixIdForAI) {
              fixDataForHistory = {
                originalHtml: this.originalOuterHTMLForAI,
                fixedHtml: this.fixedOuterHTMLForCurrentCycle,
                fixId: this.currentFixIdForAI
              };
          }
          if (extractionResult.analysisPortion && extractionResult.analysisPortion !== lastHistoryAIItem.content) {
              this.conversationHistoryManager.setLastAIItemContent(extractionResult.analysisPortion);
          }
          this.conversationHistoryManager.finalizeLastAIItem(fixDataForHistory); 
        } else {
           customWarn("[CheckraImpl finalizeResponse DEBUG] Fallback - no streaming AI item found in history either.");
        }
      }
    }
    
    this.domManager.updateLoaderVisibility(false);
    this.domManager.setPromptState(true);
    this.domManager.updateSubmitButtonState(true);
    const contentWrapper = this.domElements.contentWrapper;
    contentWrapper.scrollTop = contentWrapper.scrollHeight;

    customWarn('[CheckraImpl finalizeResponse] Conditions for fixApplier.apply:', {
        currentFixIdForAI: !!this.currentFixIdForAI,
        originalOuterHTMLForAI: !!this.originalOuterHTMLForAI,
        fixedOuterHTMLForCurrentCycle: !!this.fixedOuterHTMLForCurrentCycle,
        requestBodyForCurrentCycle: !!this.requestBodyForCurrentCycle,
        stableSelectorForAI: !!this.stableSelectorForAI
    });
    customWarn('[CheckraImpl finalizeResponse] Value of fixedOuterHTMLForCurrentCycle before apply:', this.fixedOuterHTMLForCurrentCycle?.substring(0, 200));

    if (
      this.currentFixIdForAI &&
      this.originalOuterHTMLForAI &&
      this.fixedOuterHTMLForCurrentCycle && 
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
        customWarn('[FeedbackViewerImpl] Fix applied successfully by FixApplier:', appliedFixInfo.originalElementId);
      } else {
        this.showError(`Failed to apply fix: ${this.currentFixIdForAI}. See console for details.`);
      }
      this.requestBodyForCurrentCycle = null;
      this.fixedOuterHTMLForCurrentCycle = null;
      this.selectionManager?.removeSelectionHighlight();
      this.currentResolvedColors = null;
    } else {
      customError('[CheckraImpl finalizeResponse] One or more conditions NOT MET. CANNOT call fixApplier.apply.');
      if (this.fixedOuterHTMLForCurrentCycle === null && this.currentFixIdForAI) {
        customWarn('[CheckraImpl finalizeResponse] fixedOuterHTMLForCurrentCycle is null, possibly due to extraction/patch error. Fix not applied.')
      }
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
    if (!this.domManager || !this.domElements || !this.originalOuterHTMLForAI || !this.currentFixIdForAI) {
      this.showError(`First select an element on your website using the${SELECT_SVG_ICON}`);
      return;
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
        // If the patch isn't a simple root replace, the originalHtml from the event might be what the AI intended to modify in a more complex way.
        // However, our current pipeline expects a full HTML string to process for `fixedOuterHTMLForCurrentCycle`.
        // This path might need more sophisticated patch application logic if complex patches are expected.
        // For now, if there's no root replace, we are effectively saying the AI didn't provide a full new version via this patch.
        // We will let processJsonPatchedHtml handle the originalHtml from the event.
        updatedHtmlFromPatch = originalHtml; 
      }

      customWarn('[CheckraImpl handleJsonPatch] HTML going into AIResponsePipeline.processJsonPatchedHtml:', updatedHtmlFromPatch?.substring(0, 200));
      this.fixedOuterHTMLForCurrentCycle = this.aiResponsePipeline.processJsonPatchedHtml(updatedHtmlFromPatch);
      customWarn('[CheckraImpl handleJsonPatch] HTML after AIResponsePipeline.processJsonPatchedHtml (this.fixedOuterHTMLForCurrentCycle):', this.fixedOuterHTMLForCurrentCycle?.substring(0, 200));

      const testFrag = this.createFragmentFromHTML(this.fixedOuterHTMLForCurrentCycle || ''); 
      if (!testFrag || testFrag.childNodes.length === 0) {
        customError('[CheckraImpl handleJsonPatch] Processed HTML from JSON patch is empty/invalid after pipeline. fixedOuterHTMLForCurrentCycle will be null.');
        this.fixedOuterHTMLForCurrentCycle = null; 
        // No return here, finalizeResponse will check fixedOuterHTMLForCurrentCycle
      } else {
        customWarn('[CheckraImpl handleJsonPatch] Processed HTML from JSON patch is VALID.');
      }
      // finalizeResponse (triggered by aiFinalized event) will use this.fixedOuterHTMLForCurrentCycle
    } catch (err) {
      customError('[CheckraImpl handleJsonPatch] Error handling aiJsonPatch event:', err);
      this.showError('An error occurred while applying AI suggested changes.');
      this.fixedOuterHTMLForCurrentCycle = null; // Ensure it's null on error
    }
  }

  private handleDomUpdate(data: { html: string; insertionMode: 'replace' | 'insertBefore' | 'insertAfter' }): void {
    customWarn('[CheckraImplementation] Received aiDomUpdateReceived', data);
    if (!this.targetElementForAI && this.stableSelectorForAI !== 'body') {
      customError('[CheckraImplementation] No targetElementForAI to apply DOM update to (and not a body update).');
      this.showError('No element was selected to apply the changes to.');
      return;
    }
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
      return;
    }

    if (!this.currentFixIdForAI || !this.originalOuterHTMLForAI || !this.requestBodyForCurrentCycle || !this.stableSelectorForAI) {
        customError('[CheckraImplementation] Missing context for applyFixToPage in handleDomUpdate.', {
            fixId: this.currentFixIdForAI,
            originalHtml: this.originalOuterHTMLForAI,
            requestBody: this.requestBodyForCurrentCycle,
            stableSelector: this.stableSelectorForAI
        });
        this.showError('Internal error: Could not apply changes due to missing context.');
        if (this.targetElementForAI) {
          customWarn('[CheckraImplementation] Fallback: performing direct DOM insertion in handleDomUpdate.')
          try {
              switch (insertionMode) {
                  case 'insertBefore': this.targetElementForAI.insertAdjacentHTML('beforebegin', finalHtmlToApply); break;
                  case 'insertAfter': this.targetElementForAI.insertAdjacentHTML('afterend', finalHtmlToApply); break;
                  case 'replace': this.targetElementForAI.outerHTML = finalHtmlToApply; this.targetElementForAI = null; break;
              }
              this.selectionManager?.removeSelectionHighlight();
          } catch (directInsertError) {
              customError('[CheckraImplementation] Error during fallback direct DOM insertion:', directInsertError);
          }
        } else if (this.stableSelectorForAI === 'body') {
            document.body.innerHTML = finalHtmlToApply;
            this.selectionManager?.removeSelectionHighlight();
        } else {
          customError('[CheckraImplementation] Cannot perform fallback direct DOM insertion.');
        }
        return;
    }

    const appliedFixInfo = this.fixApplier.apply({
        fixId: this.currentFixIdForAI,
        originalHtml: this.originalOuterHTMLForAI,
        fixedHtml: finalHtmlToApply,
        insertionMode: insertionMode,
        requestBody: this.requestBodyForCurrentCycle,
        stableSelector: this.stableSelectorForAI,
        currentResolvedColors: this.currentResolvedColors,
        getControlCallbacks: this.getControlCallbacksForFix
    });
    if (appliedFixInfo) {
        customWarn(`[CheckraImplementation] DOM update via FixApplier successful for mode: ${insertionMode}`);
    } else {
        this.showError(`Failed to apply direct DOM update for fix: ${this.currentFixIdForAI}.`);
    }
    this.conversationHistoryManager.finalizeLastAIItem();
    this.requestBodyForCurrentCycle = null;
    this.fixedOuterHTMLForCurrentCycle = null;
    this.selectionManager?.removeSelectionHighlight();
    this.currentResolvedColors = null;
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
    if (!promptText) return;
    this.queuedPromptText = promptText;
    if (this.selectionManager) {
      this.selectionManager.startElementSelection('replace', this.boundPrepareForInputFromSelection);
    } else {
      customError('[CheckraImpl] SelectionManager not initialized. Cannot start quick suggestion flow.');
      if (this.domElements?.promptTextarea) {
        this.domElements.promptTextarea.value = promptText;
        this.domElements.promptTextarea.focus();
      }
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
      customWarn('[FeedbackViewerImpl] Rating submitted for ' + fixId + '. Button styled as rated.');
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
    // originalSvgsMap and svgPlaceholderCounter are now in AIResponsePipeline
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

  // Add public stubs to satisfy AuthCallbackInterface, delegating to CommandDispatcher
  public async handlePublishCommand(): Promise<void> {
    // The actual logic is now in CommandDispatcher, which might call back to 
    // checkraImpl.invokeAuthRedirect if it encounters an auth error during its own execution.
    // However, AuthPendingActionHelper calls this method to *resume* an action.
    // So, this method should effectively re-trigger the command via the dispatcher.
    customWarn('[CheckraImpl] Resuming handlePublishCommand via CommandDispatcher after auth.');
    await this.commandDispatcher.tryHandleCommand('/publish'); 
  }

  public async handleSaveDraftCommand(): Promise<void> {
    customWarn('[CheckraImpl] Resuming handleSaveDraftCommand via CommandDispatcher after auth.');
    await this.commandDispatcher.tryHandleCommand('/save');
  }
}