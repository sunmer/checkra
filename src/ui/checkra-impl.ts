import { fetchFeedback } from '../services/ai-service';
import { SELECT_SVG_ICON, type CheckraViewerElements } from './checkra-dom';
import type { CheckraDOM } from './checkra-dom';
import { screenCapture } from './screen-capture';
import type { SettingsModal } from './settings-modal';
import { eventEmitter } from '../core/index';
import { generateStableSelector } from '../utils/selector-utils';
import { API_BASE } from '../config';
import { getSiteId } from '../utils/id';
import { fetchProtected, logout, isLoggedIn } from '../auth/auth';
import { customError } from '../utils/logger';
import { GenerateSuggestionRequestbody, ConversationItem } from '../types';
import { ConversationController } from './checkra-conversation';
import { FixManager, createCenteredLoaderElement } from './checkra-fix-manager';

const PENDING_ACTION_TYPE_KEY = 'checkra_auth_pending_action_type';
const PENDING_ACTION_DATA_KEY = 'checkra_auth_pending_action_data';

export class CheckraImplementation {
  private domElements: CheckraViewerElements | null = null;
  private domManager: CheckraDOM | null = null;
  private settingsModal: SettingsModal | null = null;
  private optionsInitialVisibility: boolean;
  private enableRating: boolean;

  private isVisible: boolean = false;
  private currentImageDataUrl: string | null = null;
  private currentlyHighlightedElement: Element | null = null;
  private originalOuterHTMLForCurrentCycle: string | null = null;
  private fixedOuterHTMLForCurrentCycle: string | null = null;
  private currentFixId: string | null = null;
  private stableSelectorForCurrentCycle: string | null = null;
  private currentElementInsertionMode: 'replace' | 'insertBefore' | 'insertAfter' = 'replace';
  private fixIdCounter: number = 0;
  private activeStreamingAiItem: ConversationItem | null = null;
  private selectionPlusIconElement: HTMLDivElement | null = null;
  private pageReplaceLoaderElement: HTMLDivElement | null = null;

  private queuedPromptText: string | null = null;

  private boundHandleEscapeKey: ((event: KeyboardEvent) => void) | null = null;

  private boundUpdateResponse = this.updateResponse.bind(this);
  private boundRenderUserMessage = this.renderUserMessage.bind(this);
  private boundShowError = this.showError.bind(this);
  private boundFinalizeResponse = this.finalizeResponse.bind(this);
  private boundToggle = this.toggle.bind(this);
  private boundShowFromApi = this.showFromApi.bind(this);
  private boundHandleSuggestionClick = this.handleSuggestionClick.bind(this);
  private readonly PANEL_CLOSED_BY_USER_KEY = 'checkra_panel_explicitly_closed';
  private conversationController = new ConversationController();
  private conversationHistory: ConversationItem[] = [];

  private boundHandleJsonPatch = this.handleJsonPatch.bind(this);
  private boundHandleDomUpdate = this.handleDomUpdate.bind(this);

  private requestBodyForCurrentCycle: GenerateSuggestionRequestbody | null = null;
  private boundHandleRequestBodyPrepared = this.handleRequestBodyPrepared.bind(this);

  private fixManager = new FixManager();

  private boundHandleTextareaKeydown = this.handleTextareaKeydown.bind(this);
  private boundHandleSubmit = this.handleSubmit.bind(this);
  private boundHandleMiniSelectClick = this.handleMiniSelectClick.bind(this);
  private boundHandleSettingsClick = this.handleSettingsClick.bind(this);
  private boundHandleAuditClick = this.handleAuditClick.bind(this);

  private auditSectionInfo: Map<number, { selector: string; originalHtml: string; scores?: import('../types').SectionScoreCard; analysis?: string }> = new Map();

  private boundHandleAuditComplete = this.handleAuditComplete.bind(this);

  private boundHandleAuditError = (p: any) => this.showError(`Audit error (section ${p.section}): ${p.message}`);

  // Page scan loader
  private pageScanLoaderElement: HTMLDivElement | null = null;

  constructor(
    private onToggleCallback: (isVisible: boolean) => void,
    initialVisibilityFromOptions: boolean = false,
    enableRating: boolean = false
  ) {
    this.optionsInitialVisibility = initialVisibilityFromOptions;
    // Enable rating automatically when running via Vite dev server (import.meta.env.DEV === true)
    const isDevBuild = typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.DEV;
    this.enableRating = enableRating || isDevBuild;

    this.conversationController.clear();

    this.boundHandleEscapeKey = this.handleEscapeKey.bind(this);
  }

  public initialize(
    domManager: CheckraDOM,
    settingsModal: SettingsModal
  ): void {
    try {
      localStorage.removeItem('checkra_conversation_history');
      localStorage.removeItem('checkra_onboarded');
    } catch (e) {}

    this.fixManager.setOptions({
        domManager: domManager,
        enableRating: this.enableRating,
        showError: this.showError.bind(this),
        removeHighlight: this.removeSelectionHighlight.bind(this),
    });

    const handleClose = () => this.hide(true, true);
    this.domElements = domManager.create(handleClose);
    this.domManager = domManager;
    this.settingsModal = settingsModal;
    this.loadHistory();
    if (this.domManager && this.conversationHistory.length > 0) {
      this.domManager.renderFullHistory(this.conversationHistory);
    }

    this.domElements.promptTextarea.addEventListener('keydown', this.boundHandleTextareaKeydown);
    this.domElements.submitButton.addEventListener('click', this.boundHandleSubmit);
    this.domElements.miniSelectButton?.addEventListener('click', this.boundHandleMiniSelectClick);
    this.domElements.settingsButton?.addEventListener('click', this.boundHandleSettingsClick);
    this.domElements.auditButton?.addEventListener('click', this.boundHandleAuditClick);
    
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
    eventEmitter.on('auditRatingReceived', this.handleAuditRating.bind(this));
    eventEmitter.on('auditAnalysisReceived', this.handleAuditAnalysis.bind(this));
    eventEmitter.on('auditDomUpdateReceived', this.handleAuditDomUpdate.bind(this));
    eventEmitter.on('auditError', this.boundHandleAuditError);
    eventEmitter.on('auditComplete', this.boundHandleAuditComplete);
    eventEmitter.on('runAuditRequested', this.boundHandleAuditClick);

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

    this.domElements.promptTextarea.removeEventListener('keydown', this.boundHandleTextareaKeydown);
    this.domElements.submitButton.removeEventListener('click', this.boundHandleSubmit);
    this.domElements.miniSelectButton?.removeEventListener('click', this.boundHandleMiniSelectClick);
    
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
    eventEmitter.off('auditRatingReceived', this.handleAuditRating as any);
    eventEmitter.off('auditAnalysisReceived', this.handleAuditAnalysis as any);
    eventEmitter.off('auditDomUpdateReceived', this.handleAuditDomUpdate as any);
    eventEmitter.off('auditError', this.boundHandleAuditError);
    eventEmitter.off('auditComplete', this.boundHandleAuditComplete);
    eventEmitter.off('runAuditRequested', this.boundHandleAuditClick);

    this.domElements = null;
    this.domManager = null;
    this.removeGlobalListeners();

    this.removeSelectionHighlight();
    if (this.selectionPlusIconElement && this.selectionPlusIconElement.parentNode) {
      this.selectionPlusIconElement.parentNode.removeChild(this.selectionPlusIconElement);
      this.selectionPlusIconElement = null;
    }
  }

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
    if (!this.domManager || !this.domElements) return;

    this.removeSelectionHighlight();

    this.currentImageDataUrl = imageDataUrl;
    this.currentElementInsertionMode = insertionMode;

    const isElementSelected = !!(targetElement && targetElement !== document.body);

    if (isElementSelected && targetElement) {
      this.stableSelectorForCurrentCycle = generateStableSelector(targetElement);
      this.originalOuterHTMLForCurrentCycle = selectedHtml;
      this.currentlyHighlightedElement = targetElement;
      this.updateSelectionVisuals(targetElement, insertionMode);
      this.currentFixId = `checkra-fix-${this.fixIdCounter++}`;
      targetElement.setAttribute('data-checkra-fix-id', this.currentFixId);
    } else {
      this.stableSelectorForCurrentCycle = 'body';
      this.originalOuterHTMLForCurrentCycle = document.body.outerHTML;
      this.currentlyHighlightedElement = null;
      this.updateSelectionVisuals(null, 'replace');
      this.currentFixId = `checkra-fix-${this.fixIdCounter++}`;
    }

    this.fixedOuterHTMLForCurrentCycle = null;

    this.domManager.setPromptState(true, '');
    this.domManager.updateSubmitButtonState(isElementSelected);
    if (!isElementSelected) {
      if (this.domElements) this.domElements.promptTextarea.placeholder = 'Please select an element to provide feedback.';
    } else {
      if (this.domElements) this.domElements.promptTextarea.placeholder = 'e.g., "How can I improve this section?"';
    }

    this.domManager.updateLoaderVisibility(false);
    this.domManager.showFooterCTA(false);

    this.domElements?.promptTextarea.focus();

    if (this.queuedPromptText && this.domElements) {
      this.domElements.promptTextarea.value = this.queuedPromptText;
      this.queuedPromptText = null;
      this.boundHandleSubmit();
    }
  }

  public updateResponse(chunk: string): void {
    if (!this.domManager) return;
    const updated = this.conversationController.appendToStreaming(chunk);
    if (updated) {
        this.activeStreamingAiItem = updated;
        this.domManager.updateLastAIMessage(updated.content, true);
        const hasHtmlCode = /```(?:html)?\n([\s\S]*?)\n```/i.test(updated.content);
        this.domManager.updateLoaderVisibility(true, hasHtmlCode ? 'Creating new version...' : 'Loading...');
    }
  }

  public finalizeResponse(): void {
    if (!this.domManager || !this.domElements) return;

    this.hidePageLoaders();

    const streamToFinalize = this.conversationController.finalizeStreaming();
    if (streamToFinalize) {
      this.extractAndStoreFixHtml();

      if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForCurrentCycle && this.currentFixId) {
        streamToFinalize.fix = {
          originalHtml: this.originalOuterHTMLForCurrentCycle,
          fixedHtml: this.fixedOuterHTMLForCurrentCycle,
          fixId: this.currentFixId
        };
      }
      this.conversationController.saveToStorage();
      this.domManager.updateLastAIMessage(streamToFinalize.content, false);
      this.activeStreamingAiItem = null;
    }
    this.conversationHistory = this.conversationController.items;

    this.domManager.updateLoaderVisibility(false);
    this.domManager.setPromptState(true);
    this.domManager.updateSubmitButtonState(true);

    this.domElements.contentWrapper.scrollTop = this.domElements.contentWrapper.scrollHeight;

    if (this.fixedOuterHTMLForCurrentCycle && this.originalOuterHTMLForCurrentCycle && this.currentFixId && this.requestBodyForCurrentCycle) {
        this.fixManager.applyFix(
            this.currentFixId,
            this.originalOuterHTMLForCurrentCycle,
            this.fixedOuterHTMLForCurrentCycle,
            this.currentElementInsertionMode,
            this.requestBodyForCurrentCycle!,
            this.stableSelectorForCurrentCycle ?? undefined,
        );
        this.requestBodyForCurrentCycle = null;
    }
  }

  public showError(error: Error | string): void {
    let errorHtmlContent: string;
    this.hidePageLoaders();

    if (typeof error === 'string' && error.includes(SELECT_SVG_ICON)) {
      errorHtmlContent = error;
    } else {
      const errorTextMessage = error instanceof Error ? error.message : error;
      const escapedErrorMessage = new Option(errorTextMessage).innerHTML;
      errorHtmlContent = escapedErrorMessage;
      customError('[Checkra AI Error]', errorTextMessage);
    }
    
    this.conversationController.addErrorMessage(errorHtmlContent);
    this.domManager?.appendHistoryItem({ type: 'error', content: errorHtmlContent });
  }

  public hide(initiatedByUser: boolean, fromCloseButton: boolean = false): void {
    if (!this.isVisible || !this.domManager) return;
    eventEmitter.emit('viewerWillHide');
    this.domManager.hide();
    this.isVisible = false;
    this.onToggleCallback(false);
    this.removeSelectionHighlight();
    this.resetStateForNewSelection();

    if (initiatedByUser && fromCloseButton) {
      localStorage.setItem(this.PANEL_CLOSED_BY_USER_KEY, 'true');
      this.domManager.showAvailabilityToast();
    }
    eventEmitter.emit('viewerDidHide');
  }

  private resetStateForNewSelection(): void {
    this.currentImageDataUrl = null;
    this.originalOuterHTMLForCurrentCycle = null;
    this.fixedOuterHTMLForCurrentCycle = null;
    this.stableSelectorForCurrentCycle = null;
    this.activeStreamingAiItem = null;
    this.hidePageLoaders();
  }

  private renderUserMessage(message: string): void {
    if (!this.domManager) return;
    this.conversationController.append({ type: 'usermessage', content: message });
    this.domManager.appendHistoryItem({ type: 'usermessage', content: message });
    this.conversationHistory = this.conversationController.items;
  }

  private handleTextareaKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      this.boundHandleSubmit();
    }
  }

  private handleSubmit(): void {
    const promptText = this.domElements?.promptTextarea.value.trim();
    if (!promptText) {
        this.showError('Please enter a description or question.');
        return;
    }
    if (!this.domManager || !this.domElements || !this.originalOuterHTMLForCurrentCycle || !this.currentFixId) {
        this.showError(`First select an element on your website using the ${SELECT_SVG_ICON}`);
        return;
    }

    if (promptText.toLowerCase() === '/publish') {
      this.publishSnapshot();
    } else if (promptText.toLowerCase() === '/save') {
      if (this.fixManager.count === 0) {
        this.renderUserMessage("No changes have been applied to save as a draft.");
      } else {
        this.saveSnapshotAsDraft();
      }
    } else if (promptText.toLowerCase() === '/logout') {
      logout().then(() => this.renderUserMessage("You have been logged out."))
               .catch((err: Error) => this.renderUserMessage(`Logout failed: ${err.message}`));
    } else if (promptText.toLowerCase() === '/help') {
      this.showOnboarding();
    } else {
        this.domManager.setPromptState(false);
        this.domManager.updateSubmitButtonState(false);
        this.domManager.updateLoaderVisibility(true, 'Loading...');
        this.domManager.clearUserMessage();
        this.domManager.showPromptInputArea(false, promptText);
        this.hidePageLoaders();

        if (this.currentElementInsertionMode === 'insertBefore' || this.currentElementInsertionMode === 'insertAfter') {
            this.selectionPlusIconElement?.classList.add('loading');
        } else if (this.currentElementInsertionMode === 'replace' && this.currentlyHighlightedElement) {
            this.showReplaceLoader(this.currentlyHighlightedElement);
        }

        const imageKeywords = ["image", "photo", "picture", "screenshot", "visual", "look", "style", "design"];
        const useImage = imageKeywords.some(k => promptText.toLowerCase().includes(k));
        
        this.conversationController.addUserMessage(promptText);
        this.domManager.appendHistoryItem({ type: 'user', content: promptText });
        this.activeStreamingAiItem = this.conversationController.startStreamingAi();
        this.domManager.appendHistoryItem(this.activeStreamingAiItem);
        this.conversationHistory = this.conversationController.items;

        const html = this.originalOuterHTMLForCurrentCycle;
        try {
            const processedHtml = this.fixManager.preprocessHtmlForAI(html);
            fetchFeedback(useImage ? this.currentImageDataUrl : null, promptText, processedHtml, this.currentElementInsertionMode);
        } catch (e) {
            this.showError('Failed to process HTML before sending.');
        }

        try {
            if (!localStorage.getItem('checkra_onboarded')) localStorage.setItem('checkra_onboarded', '1');
        } catch (e) {}
    }
    
    this.domManager.setPromptState(true, '');
    this.domManager.updateSubmitButtonState(true);
  }

  private extractAndStoreFixHtml(): void {
    if (this.fixedOuterHTMLForCurrentCycle) return;
    const lastAiItem = [...this.conversationHistory].reverse().find(it => it.type === 'ai');
    if (!lastAiItem) return;

    const { html, analysis } = this.fixManager.extractFixedHtml(lastAiItem.content);
    if (html) {
      this.fixedOuterHTMLForCurrentCycle = html;
      if (analysis) lastAiItem.content = analysis;
    }
  }

  public toggle(): void {
    this.isVisible ? this.hide(true, false) : this.showFromApi(true);
  }

  public showOnboarding(): void {
    if (!this.domManager) return;
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
    if (this.domElements?.viewer) {
      screenCapture.startCapture(this.prepareForInput.bind(this), this.domElements.viewer);
    }
  }

  private handleSettingsClick(): void {
    this.settingsModal?.showModal();
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
    if (this.boundHandleEscapeKey) {
        document.removeEventListener('keydown', this.boundHandleEscapeKey);
    }
  }

  public showFromApi(triggeredByUserAction: boolean = false): void {
    if (this.isVisible) {
      if (triggeredByUserAction) localStorage.removeItem(this.PANEL_CLOSED_BY_USER_KEY);
      return;
    }
    if (!this.domManager) return;

    eventEmitter.emit('viewerWillShow');
    this.domManager.show();
    this.isVisible = true;
    this.onToggleCallback(true);
    if (triggeredByUserAction) localStorage.removeItem(this.PANEL_CLOSED_BY_USER_KEY);

    if (!localStorage.getItem('checkra_onboarded')) {
      this.showOnboarding();
      localStorage.setItem('checkra_onboarded', 'true');
    } else {
      this.domElements?.promptTextarea.focus();
    }
    eventEmitter.emit('viewerDidShow');
  }

  private loadHistory(): void {
    this.conversationController.loadFromStorage();
    this.conversationHistory = this.conversationController.items.map(item =>
      item.type === 'ai' ? { ...item, isStreaming: false } : item
    );
    (this.conversationController as any).history = [...this.conversationHistory];
  }

  private removeSelectionHighlight(): void {
    if (this.currentlyHighlightedElement) {
      this.currentlyHighlightedElement.classList.remove(
        'checkra-selected-element-outline', 'checkra-hover-top', 'checkra-hover-bottom',
        'checkra-highlight-container', 'checkra-selected-insert-before',
        'checkra-selected-insert-after', 'checkra-selected-replace', 'checkra-element-dimmed'
      );
    }
    if (this.selectionPlusIconElement) {
      this.selectionPlusIconElement.remove();
      this.selectionPlusIconElement = null;
    }
    if (this.pageReplaceLoaderElement) {
        this.pageReplaceLoaderElement.remove();
        this.pageReplaceLoaderElement = null;
    }
  }

  public async publishSnapshot(): Promise<void> {
    if (this.fixManager.count === 0) {
      this.renderUserMessage("No changes applied.");
      return;
    }
    const changes = Array.from(this.fixManager.getAppliedFixes().values()).map(fix => ({
      targetSelector: fix.stableTargetSelector,
      appliedHtml: fix.fixedOuterHTML,
    }));
    const siteId = getSiteId();
    const snapshotId = crypto.randomUUID();
    const payload = { snapshotId, changes, publish: true, pageUrl: window.location.href };

    try {
      this.renderUserMessage("Publishing...");
      await fetchProtected(`${API_BASE}/sites/${siteId}/snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const promoteRes = await fetchProtected(`${API_BASE}/sites/${siteId}/variants/${snapshotId}`, { method: 'PUT' });
      const { cdnUrl } = await promoteRes.json();
      if (cdnUrl) {
          this.renderUserMessage(`Published! URL: <a href="${cdnUrl}" target="_blank">${cdnUrl}</a>`);
      } else {
          this.renderUserMessage("Published, but failed to get URL.");
      }
    } catch (error) {
        const message = error instanceof Error ? error.message : "An unknown error occurred.";
        this.showError(`Publish failed: ${message}`);
    }
  }

  private async handlePendingActionAfterLogin(): Promise<void> {
    const actionType = localStorage.getItem(PENDING_ACTION_TYPE_KEY);
    if (!actionType || !(await isLoggedIn())) return;

    localStorage.removeItem(PENDING_ACTION_TYPE_KEY);
    localStorage.removeItem(PENDING_ACTION_DATA_KEY);

    if (actionType === 'publish' && this.fixManager.count > 0) {
        this.renderUserMessage("Resuming publish...");
        await this.publishSnapshot();
    }
  }

  private handleAuthErrorInUrl(): void {
    const params = new URLSearchParams(location.search);
    const error = params.get('error_description');
    if (error) {
      this.renderUserMessage(`Login failed: ${error}`);
      params.delete('error');
      params.delete('error_code');
      params.delete('error_description');
      history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
    }
  }

  private handleRequestBodyPrepared(requestBody: GenerateSuggestionRequestbody): void {
    this.requestBodyForCurrentCycle = requestBody;
  }

  private handleSuggestionClick(promptText: string): void {
    if (!promptText) return;
    this.queuedPromptText = promptText;
    this.handleMiniSelectClick(new MouseEvent('click'));
  }

  private updateSelectionVisuals(element: Element | null, mode: 'replace' | 'insertBefore' | 'insertAfter'): void {
    this.removeSelectionHighlight();
    if (!element) {
        this.currentlyHighlightedElement = null;
        return;
    }
    this.currentlyHighlightedElement = element;
    element.classList.add('checkra-highlight-container');

    if (mode === 'insertBefore' || mode === 'insertAfter') {
      element.classList.add(mode === 'insertBefore' ? 'checkra-selected-insert-before' : 'checkra-selected-insert-after');
      this.createPersistentPlusIcon(mode === 'insertBefore' ? 'top' : 'bottom', element as HTMLElement);
    } else {
      element.classList.add('checkra-selected-replace');
    }
  }

  private createPersistentPlusIcon(position: 'top' | 'bottom', parentElement: HTMLElement): void {
    if (!this.selectionPlusIconElement) {
      this.selectionPlusIconElement = document.createElement('div');
      this.selectionPlusIconElement.className = 'checkra-insert-indicator';
      this.selectionPlusIconElement.textContent = '+';
      document.body.appendChild(this.selectionPlusIconElement);
    }
    const parentRect = parentElement.getBoundingClientRect();
    this.selectionPlusIconElement.className = `checkra-insert-indicator ${position}`;
    this.selectionPlusIconElement.style.top = `${(position === 'top' ? parentRect.top : parentRect.bottom) + window.scrollY - 11}px`;
    this.selectionPlusIconElement.style.left = `${parentRect.left + window.scrollX + parentRect.width / 2 - 11}px`;
    this.selectionPlusIconElement.style.display = 'flex';
  }

  private async saveSnapshotAsDraft(): Promise<void> {
    if (this.fixManager.count === 0) return;

    const changes = Array.from(this.fixManager.getAppliedFixes().values()).map(fix => ({
      targetSelector: fix.stableTargetSelector,
      appliedHtml: fix.fixedOuterHTML,
    }));
    const siteId = getSiteId();
    const snapshotId = crypto.randomUUID();
    const payload = { snapshotId, changes, pageUrl: window.location.href, publish: false };

    try {
      this.renderUserMessage("Saving draft...");
      const res = await fetchProtected(`${API_BASE}/sites/${siteId}/snapshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const { accessUrl } = await res.json();
      if (accessUrl) {
          this.renderUserMessage(`Draft saved! URL: <a href="${accessUrl}" target="_blank">${accessUrl}</a>`);
      } else {
          this.renderUserMessage("Draft saved, but failed to get URL.");
      }
    } catch (error) {
        const message = error instanceof Error ? error.message : "An unknown error occurred.";
        this.showError(`Save draft failed: ${message}`);
    }
  }

  private handleJsonPatch(patchEvent: { payload: any; originalHtml: string }): void {
    try {
      const { payload, originalHtml } = patchEvent;
      let patchArray = typeof payload === 'string' ? JSON.parse(payload) : payload;
      if (!Array.isArray(patchArray)) throw new Error("Invalid patch format");

      let updatedHtml = originalHtml;
      const replaceOp = patchArray.find(op => op.op === 'replace' && (op.path === '' || op.path === '/'));
      if (replaceOp && typeof replaceOp.value === 'string') {
        updatedHtml = replaceOp.value;
      }
      
      const firstTagIndex = updatedHtml.indexOf('<');
      if (firstTagIndex > 0) updatedHtml = updatedHtml.slice(firstTagIndex);

      updatedHtml = this.fixManager.postprocessHtmlFromAI(updatedHtml);

      const frag = this.createFragmentFromHTML(updatedHtml);
      if (frag) {
        while (frag.firstChild && frag.firstChild.nodeType !== Node.ELEMENT_NODE) {
            frag.removeChild(frag.firstChild);
        }
        const temp = document.createElement('div');
        temp.appendChild(frag);
        this.fixedOuterHTMLForCurrentCycle = temp.innerHTML;
      }
    } catch (err) {
      this.showError('An error occurred while applying AI changes.');
    }
  }

  private handleDomUpdate(data: { html: string; insertionMode: 'replace' | 'insertBefore' | 'insertAfter' }): void {
    if (!this.currentlyHighlightedElement) {
      this.showError('No element was selected to apply the changes to.');
      return;
    }
    const { html, insertionMode } = data;
    let finalHtmlToApply = html.match(/^```(?:html)?\n([\s\S]*?)\n```$/i)?.[1]?.trim() ?? html;
    finalHtmlToApply = this.fixManager.postprocessHtmlFromAI(finalHtmlToApply);
    
    if (!this.currentFixId || !this.originalOuterHTMLForCurrentCycle || !this.requestBodyForCurrentCycle || !this.stableSelectorForCurrentCycle) {
      try {
        switch (insertionMode) {
          case 'insertBefore': this.currentlyHighlightedElement.insertAdjacentHTML('beforebegin', finalHtmlToApply); break;
          case 'insertAfter': this.currentlyHighlightedElement.insertAdjacentHTML('afterend', finalHtmlToApply); break;
          case 'replace': this.currentlyHighlightedElement.outerHTML = finalHtmlToApply; this.currentlyHighlightedElement = null; break;
        }
        this.removeSelectionHighlight();
      } catch (e) {}
      return;
    }
    this.fixManager.applyFix(this.currentFixId, this.originalOuterHTMLForCurrentCycle, finalHtmlToApply, insertionMode, this.requestBodyForCurrentCycle, this.stableSelectorForCurrentCycle);
    if (this.activeStreamingAiItem) {
        this.activeStreamingAiItem.isStreaming = false;
        this.domManager?.updateLastAIMessage(this.activeStreamingAiItem.content, false);
    }
    this.activeStreamingAiItem = null;
    this.requestBodyForCurrentCycle = null;
  }

  private showReplaceLoader(targetElement: Element): void {
    this.pageReplaceLoaderElement?.remove();
    this.pageReplaceLoaderElement = createCenteredLoaderElement();
    if (!targetElement.classList.contains('checkra-highlight-container')) {
        targetElement.classList.add('checkra-highlight-container');
    }
    targetElement.appendChild(this.pageReplaceLoaderElement);
    targetElement.classList.add('checkra-element-dimmed');
  }

  private hidePageLoaders(): void {
    this.selectionPlusIconElement?.classList.remove('loading');
    this.pageReplaceLoaderElement?.remove();
    this.pageReplaceLoaderElement = null;
    document.querySelectorAll('.checkra-element-dimmed').forEach(el => el.classList.remove('checkra-element-dimmed'));
  }

  private createFragmentFromHTML(htmlString: string): DocumentFragment | null {
    try {
      const template = document.createElement('template');
      template.innerHTML = htmlString.trim();
      return template.content;
    } catch {
      return null;
    }
  }

  private handleAuditClick(): void {
    if (!this.domManager) return;
    // Show page scan loader
    this.showPageScanLoader();
    const sections = this.scanAboveFoldSections();
    if (sections.length === 0) {
      this.showError('No sections found above the fold.');
      return;
    }
    // Map for later look-up
    this.auditSectionInfo.clear();
    sections.forEach(sec => {
      this.auditSectionInfo.set(sec.idx, { selector: sec.selector, originalHtml: sec.originalHtml });
    });
    // Show spinner and history entry
    this.domManager.updateLoaderVisibility(true, 'Auditing page…');
    this.conversationController.addUserMessage('/audit');
    this.domManager.appendHistoryItem({ type: 'user', content: 'Running quick audit…' });
    // fire request
    import('../services/ai-service').then(mod => {
      (mod as any).fetchAudit(sections);
    });
  }

  private scanAboveFoldSections(): Array<{ idx: number; selector: string; html: string; originalHtml: string }> {
    const results: { idx: number; selector: string; html: string; originalHtml: string }[] = [];
    const foldY = window.scrollY + window.innerHeight;
    const bodyWidth = document.body.clientWidth;

    const blocks = Array.from(document.querySelectorAll('section, header, main, article, div')) as HTMLElement[];

    const viewportHeight = window.innerHeight;

    // Heuristic rules:
    // 1. Element must be in the top viewport (any overlap with fold)
    // 2. Not the Checkra panel
    // 3. Min height & width
    // 4. Not gigantic (> 1.8 × viewport height)
    // 5. Sufficient text
    const qualifies = (el: HTMLElement): boolean => {
      if (el.closest('#checkra-feedback-viewer')) return false;
      const rect = el.getBoundingClientRect();
      if (rect.top >= foldY || rect.bottom <= 0) return false;
      if (rect.height < 80) return false;
      if (rect.height > viewportHeight * 1.8) return false; // too tall – likely outer wrapper
      if (rect.width / bodyWidth < 0.6) return false;
      if (el.innerText.trim().length < 40) return false;
      return true;
    };

    let candidates = blocks.filter(qualifies);

    // Prefer deeper (more specific) elements by sorting: first by top, then by depth(desc), then by height
    candidates.sort((a, b) => {
      const ta = a.getBoundingClientRect().top;
      const tb = b.getBoundingClientRect().top;
      if (Math.abs(ta - tb) > 5) return ta - tb;
      const depthA = getDomDepth(a);
      const depthB = getDomDepth(b);
      if (depthA !== depthB) return depthB - depthA; // deeper first
      return a.getBoundingClientRect().height - b.getBoundingClientRect().height;
    });

    const picked: HTMLElement[] = [];
    let idx = 0;
    for (const el of candidates) {
      if (picked.some(p => p.contains(el) || el.contains(p))) continue; // avoid ancestor/descendant of picked
      const selector = this.generateSelectorForElement(el);
      if (!selector) continue;
      // Store the original HTML BEFORE adding the placeholder attribute
      const originalHtml = el.outerHTML;
      el.setAttribute('data-checkra-fix-id', `audit-placeholder-${idx}`);
      const html = this.fixManager.preprocessHtmlForAI(el.outerHTML);
      results.push({ idx, selector, html, originalHtml });
      picked.push(el);
      idx++;
      if (idx >= 3) break;
    }

    function getDomDepth(node: HTMLElement): number {
      let depth = 0;
      let current: HTMLElement | null = node;
      while (current && current.parentElement) {
        depth++;
        current = current.parentElement as HTMLElement;
      }
      return depth;
    }

    // If no candidate picked, fallback to largest block above fold (unchanged)
    if (results.length === 0) {
      const largest = blocks
        .filter(el => el.getBoundingClientRect().top < foldY)
        .sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height))[0];
      if (largest) {
        const selector = this.generateSelectorForElement(largest);
        if (selector) {
          // Store the original HTML BEFORE adding the placeholder attribute
          const originalHtml = largest.outerHTML;
          largest.setAttribute('data-checkra-fix-id', 'audit-placeholder-0');
          const html = this.fixManager.preprocessHtmlForAI(largest.outerHTML);
          results.push({ idx:0, selector, html, originalHtml });
        }
      }
    }

    return results;
  }

  private generateSelectorForElement(el: Element): string | null {
    try {
      return generateStableSelector(el);
    } catch {
      return null;
    }
  }

  private handleAuditRating(payload: any): void {
    const { section, scores } = payload;
    const content = `Section ${section} scorecard:\n• Message clarity: ${scores.messageClarity}\n• Action strength: ${scores.actionStrength}\n• Trust & credibility: ${scores.trustCredibility}\n• Reading ease: Grade ${scores.readingEase}`;
    this.conversationController.append({ type: 'ai', content });
    this.domManager?.appendHistoryItem({ type: 'ai', content });
    const info = this.auditSectionInfo.get(section);
    if (info) {
      info.scores = scores;
      this.auditSectionInfo.set(section, info);
    }
  }

  private handleAuditAnalysis(payload: any): void {
    const { section, content } = payload;
    const msg = `Section ${section} analysis:\n${content}`;
    this.conversationController.append({ type: 'ai', content: msg });
    this.domManager?.appendHistoryItem({ type: 'ai', content: msg });
    const info = this.auditSectionInfo.get(section);
    if (info) {
      info.analysis = content;
      this.auditSectionInfo.set(section, info);
    }
  }

  private handleAuditDomUpdate(payload: any): void {
    const { section, html, insertionMode } = payload;
    
    const info = this.auditSectionInfo.get(section);
    if (!info) return;
    const fixId = `audit-${section}`;
    // Ensure the target element is marked for FixManager lookup
    const targetElement = document.querySelector(info.selector);
    if (targetElement) {
      (targetElement as HTMLElement).setAttribute('data-checkra-fix-id', fixId);
    }
    const cleanedHtml = this.fixManager.postprocessHtmlFromAI(
      html.replace(/\[\.\.\.content trimmed.*?\]/gi, '')
    );
    
    // Remove any audit placeholder attributes from the raw HTML string
    const finalCleanedHtml = cleanedHtml.replace(/\s*data-checkra-fix-id="audit-placeholder-\d+"/g, '');
    
    // First response -> hide scan loader
    this.hidePageScanLoader();

    // Pass scores/analysis if already available so the info button renders immediately
    this.fixManager.applyFix(
      fixId,
      info.originalHtml,
      finalCleanedHtml,
      insertionMode,
      { prompt: '/audit', metadata: {} as any, aiSettings: { model: 'gpt-4o-mini', temperature: 0.7 }, insertionMode } as any,
      info.selector,
      info.scores,
      info.analysis
    );

    // If analysis comes later, we'll update the stored fixInfo (button already exists)
    const fixInfo = this.fixManager.getAppliedFixes().get(fixId);
    if (fixInfo) {
      if (info.scores) fixInfo.auditScores = info.scores;
      if (info.analysis) fixInfo.auditAnalysis = info.analysis;
    }
  }

  private handleAuditComplete(): void {
    this.domManager?.updateLoaderVisibility(false);
    this.hidePageScanLoader();
  }

  private showPageScanLoader(): void {
    const bar = document.createElement('div');
    bar.className = 'checkra-page-scan-bar';
    document.body.appendChild(bar);
    this.pageScanLoaderElement = bar;
  }

  private hidePageScanLoader(): void {
    if (this.pageScanLoaderElement) {
      this.pageScanLoaderElement.remove();
      this.pageScanLoaderElement = null;
    }
  }
}
