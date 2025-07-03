import type { AddRatingRequestBody, GenerateSuggestionRequestbody } from '../types';
import { eventEmitter } from '../core/index';
import { customWarn, customError } from '../utils/logger';

export interface AppliedFixInfo {
  originalElementId: string;
  originalOuterHTML: string;
  fixedOuterHTML: string;
  appliedWrapperElement: HTMLDivElement | null;
  isCurrentlyFixed: boolean;
  stableTargetSelector: string;
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter';
  requestBody: GenerateSuggestionRequestbody;
  isRated?: boolean;
  auditScores?: import('../types').SectionScoreCard;
  auditAnalysis?: string;
  originalPlaceholderElement?: HTMLElement | null;
  originalElementRef?: HTMLElement | null;
  originalContentElement?: HTMLElement | null;
}

const SVG_PLACEHOLDER_REGEX = /<svg\s+data-checkra-id="([^"]+)"[^>]*>[\s\S]*?<\/svg>/g;

// DEBUG helper – toggle to false to silence console output in production builds
const DEBUG_FIX_MANAGER = true;
function dLog(...args: any[]) { if (DEBUG_FIX_MANAGER) console.log('[FixManager]', ...args); }

export class FixManager {
  private appliedFixes = new Map<string, AppliedFixInfo>();
  private originalSvgsMap: Map<string, string> = new Map();
  private svgPlaceholderCounter = 0;
  private appliedFixListeners = new Map<string, { close: EventListener; toggle: EventListener; copy: EventListener; rate?: EventListener; info?: EventListener }>();
  private enableRating: boolean = false;
  private domManager: any = null;
  private showErrorCb?: (msg: string | Error) => void;
  private removeHighlightCb?: () => void;

  get count() {
    return this.appliedFixes.size;
  }

  getAppliedFixes() {
      return this.appliedFixes;
  }

  setOptions(options: {
    enableRating?: boolean;
    domManager?: any;
    showError?: (msg: string | Error) => void;
    removeHighlight?: () => void;
  }) {
    if (options.enableRating !== undefined) this.enableRating = options.enableRating;
    if (options.domManager !== undefined) this.domManager = options.domManager;
    if (options.showError) this.showErrorCb = options.showError;
    if (options.removeHighlight) this.removeHighlightCb = options.removeHighlight;
  }

  applyFix(
    fixId: string,
    originalHtml: string,
    fixedHtml: string,
    insertionMode: 'replace' | 'insertBefore' | 'insertAfter',
    requestBody: GenerateSuggestionRequestbody,
    stableSelector?: string,
    auditScores?: import('../types').SectionScoreCard,
    auditAnalysis?: string
  ) {
    dLog('applyFix() called', { fixId, insertionMode, stableSelector });
    this.applyFixToPage(fixId, originalHtml, fixedHtml, insertionMode, requestBody, stableSelector, auditScores, auditAnalysis);
  }

  private applyFixToPage(
    fixId: string,
    originalHtml: string,
    fixedHtml: string,
    insertionMode: 'replace' | 'insertBefore' | 'insertAfter',
    requestBody: GenerateSuggestionRequestbody,
    stableSelector?: string,
    auditScores?: import('../types').SectionScoreCard,
    auditAnalysis?: string
  ): void {
    if (!this.domManager) {
      customWarn('[FixManager] applyFixToPage: Cannot apply fix: Missing DOM Manager.');
      return;
    }

    try {
      const originalSelectedElement = document.querySelector(`[data-checkra-fix-id="${fixId}"]`);
      dLog('applyFixToPage: located original element', originalSelectedElement);

      if (!originalSelectedElement) {
        this.showErrorCb?.(`Failed to apply fix: Original target element for fix ${fixId} not found.`);
        return;
      }

      if (!originalSelectedElement.parentNode) {
        this.showErrorCb?.(`Failed to apply fix: Original target for fix ${fixId} has no parent.`);
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'checkra-feedback-applied-fix checkra-fix-fade-in';
      wrapper.setAttribute('data-checkra-fix-id', fixId);

      if (insertionMode === 'replace' && originalSelectedElement instanceof HTMLElement) {
        const origEl = originalSelectedElement as HTMLElement;
        const forbidden = /^(flex(|-[^ ]+)?|grid(|-[^ ]+)?|absolute|relative|fixed|sticky|inset|top-|left-|right-|bottom-|w-|h-|before:|after:|z-)/;
        origEl.classList.forEach(cls => {
          if (!cls.startsWith('checkra-') && !forbidden.test(cls) && !wrapper.classList.contains(cls)) {
            wrapper.classList.add(cls);
          }
        });
        const origInlineStyle = origEl.getAttribute('style');
        if (origInlineStyle && origInlineStyle.trim().length > 0) {
          const currentWrapperStyle = wrapper.style.cssText;
          wrapper.style.cssText = `${currentWrapperStyle}${currentWrapperStyle ? ';' : ''}${origInlineStyle}`.replace(/;\s*;+/g, ';').replace(/^\s*;|;\s*$/g, '');
        }
        const role = origEl.getAttribute('role');
        if (role) wrapper.setAttribute('role', role);
        const tabindex = origEl.getAttribute('tabindex');
        if (tabindex) wrapper.setAttribute('tabindex', tabindex);
        const computedDisplay = window.getComputedStyle(origEl).display;
        if (computedDisplay && computedDisplay !== 'contents') {
            if (!wrapper.style.display || wrapper.style.display === 'block' && computedDisplay !== 'block') {
                 wrapper.style.display = computedDisplay;
            }
        }
      } else if (insertionMode === 'insertBefore' || insertionMode === 'insertAfter') {
        // Simplified class/style copy for adjacent elements
      }

      // Fixed content container
      const contentContainer = document.createElement('div');
      contentContainer.className = 'checkra-applied-fix-content';
      
      // Clean the fixed HTML as well to avoid any duplicate checkra attributes
      const cleanFixedHtml = fixedHtml
        .replace(/\s*data-checkra-fix-id="[^"]*"/g, '')
        .replace(/\s*data-checkra-listener-attached="[^"]*"/g, '');
      
      const fixedContentFragment = this.createFragmentFromHTML(cleanFixedHtml);
      if (!fixedContentFragment || fixedContentFragment.childNodes.length === 0) {
        throw new Error('Failed to parse fixed HTML for content container fragment.');
      }
      contentContainer.appendChild(fixedContentFragment);
      wrapper.appendChild(contentContainer);

      // For replace mode also store original version inside wrapper (hidden by default)
      let originalContentEl: HTMLElement | null = null;
      if (insertionMode === 'replace') {
        dLog('Creating original content element', { originalHtmlLength: originalHtml.length });
        originalContentEl = document.createElement('div');
        originalContentEl.className = 'checkra-original-content';
        originalContentEl.style.display = 'none';
        
        // Clean the original HTML to ensure it doesn't have any checkra attributes
        const cleanOriginalHtml = originalHtml
          .replace(/\s*data-checkra-fix-id="[^"]*"/g, '')
          .replace(/\s*data-checkra-listener-attached="[^"]*"/g, '');
        
        const origFrag = this.createFragmentFromHTML(cleanOriginalHtml);
        dLog('Original fragment created', { 
          hasFragment: !!origFrag, 
          childCount: origFrag?.childNodes.length,
          cleanedLength: cleanOriginalHtml.length 
        });
        
        // Even if fragment is empty, keep the element for consistent behavior
        if (origFrag) {
          originalContentEl.appendChild(origFrag);
        } else {
          // Fallback: use innerHTML if fragment creation fails
          originalContentEl.innerHTML = cleanOriginalHtml;
        }
        wrapper.appendChild(originalContentEl);
      }

      const controlsContainer = document.createElement('div');
      controlsContainer.className = 'checkra-fix-controls-container';

      const closeBtn = this.createAppliedFixButton('close', fixId);
      const toggleBtn = this.createAppliedFixButton('toggle', fixId);
      const copyBtn = this.createAppliedFixButton('copy', fixId);
      const fixInfoData: AppliedFixInfo = {
        originalElementId: fixId,
        originalOuterHTML: originalHtml,
        fixedOuterHTML: fixedHtml,
        appliedWrapperElement: wrapper,
        isCurrentlyFixed: true,
        stableTargetSelector: stableSelector!,
        insertionMode: insertionMode,
        requestBody,
        isRated: false,
        auditScores,
        auditAnalysis,
        originalElementRef: insertionMode === 'replace' ? null : (originalSelectedElement as HTMLElement),
        originalContentElement: originalContentEl
      };

      let infoBtn: HTMLButtonElement | null = null;
      if (auditAnalysis) {
        infoBtn = this.createAppliedFixButton('info', fixId);
        controlsContainer.appendChild(infoBtn);
      }
      controlsContainer.appendChild(copyBtn);
      controlsContainer.appendChild(toggleBtn);
      
      let rateBtn: HTMLButtonElement | null = null;
      if (this.enableRating) {
        rateBtn = this.createAppliedFixButton('rate', fixId);
        controlsContainer.appendChild(rateBtn);
      }
      controlsContainer.appendChild(closeBtn);

      wrapper.appendChild(controlsContainer);

      const parent = originalSelectedElement.parentNode;

      if (insertionMode === 'replace') {
        // Remove original element; we already stored its HTML inside wrapper for toggling
        parent.insertBefore(wrapper, originalSelectedElement.nextSibling);
        originalSelectedElement.remove();
        dLog('applyFixToPage: wrapper inserted', { insertionMode, wrapper, originalSelectedElement });
      } else if (insertionMode === 'insertBefore') {
        parent.insertBefore(wrapper, originalSelectedElement);
        (originalSelectedElement as HTMLElement).style.display = 'none';
        dLog('applyFixToPage: wrapper inserted', { insertionMode, wrapper, originalSelectedElement });
      } else if (insertionMode === 'insertAfter') {
        parent.insertBefore(wrapper, originalSelectedElement.nextSibling);
        (originalSelectedElement as HTMLElement).style.display = 'none';
        dLog('applyFixToPage: wrapper inserted', { insertionMode, wrapper, originalSelectedElement });
      }

      if (!stableSelector) {
        this.showErrorCb?.(`Failed to apply fix: Stable target selector missing for fix ${fixId}.`);
        if (wrapper.parentNode) wrapper.remove();
        return;
      }

      this.appliedFixes.set(fixId, fixInfoData);

      if (rateBtn && fixInfoData.isRated) {
        rateBtn.classList.add('rated');
        rateBtn.disabled = true;
      }

      const listeners: any = {
        close: (e: Event) => this.handleAppliedFixClose(fixId, e),
        toggle: (e: Event) => this.handleAppliedFixToggle(fixId, e),
        copy: (e: Event) => this.handleAppliedFixCopy(fixId, e)
      };
      if (rateBtn) listeners.rate = (e: Event) => this.handleAppliedFixRate(fixId, e);
      if (infoBtn) listeners.info = (e: Event) => this.handleAppliedFixInfo(fixId, e);
      
      closeBtn.addEventListener('click', listeners.close);
      toggleBtn.addEventListener('click', listeners.toggle);
      copyBtn.addEventListener('click', listeners.copy);
      const rateHandler = listeners.rate as EventListener | undefined;
      if (rateBtn && rateHandler) rateBtn.addEventListener('click', rateHandler);
      const infoHandler = listeners.info as EventListener | undefined;
      if (infoBtn && infoHandler) infoBtn.addEventListener('click', infoHandler);

      // Store these listeners so they can be properly removed when the fix is closed
      this.appliedFixListeners.set(fixId, listeners);

      this.removeHighlightCb?.();

    } catch (error) {
      customError('[FixManager] Error applying fix to page:', error);
      this.showErrorCb?.(`Failed to apply fix: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handleAppliedFixClose(fixId: string, event: Event): void {
    event.stopPropagation();
    const fixInfo = this.appliedFixes.get(fixId);
    const wrapperElement = document.querySelector(`.checkra-feedback-applied-fix[data-checkra-fix-id="${fixId}"]`);

    if (fixInfo && wrapperElement) {
      try {
        if (fixInfo.insertionMode === 'replace') {
          const originalFragment = this.createFragmentFromHTML(fixInfo.originalOuterHTML);
          if (!originalFragment || originalFragment.childNodes.length === 0) {
            throw new Error('Failed to parse original HTML fragment for reverting.');
          }
          wrapperElement.replaceWith(originalFragment);
        } else {
          wrapperElement.remove();
        }

        const listeners = this.appliedFixListeners.get(fixId);
        if (listeners) {
          const closeBtn = wrapperElement.querySelector('.feedback-fix-close-btn');
          const toggleBtn = wrapperElement.querySelector('.feedback-fix-toggle');
          const copyBtn = wrapperElement.querySelector('.feedback-fix-copy-btn');
          const rateBtn = wrapperElement.querySelector('.feedback-fix-rate-btn');
          const infoBtnEl = wrapperElement.querySelector('.feedback-fix-info-btn');
          closeBtn?.removeEventListener('click', listeners.close);
          toggleBtn?.removeEventListener('click', listeners.toggle);
          copyBtn?.removeEventListener('click', listeners.copy);
          const rateHandler = listeners.rate as EventListener | undefined;
          if (rateBtn && rateHandler) rateBtn.removeEventListener('click', rateHandler);
          const infoHandler = listeners.info as EventListener | undefined;
          if (infoBtnEl && infoHandler) infoBtnEl.removeEventListener('click', infoHandler);
          this.appliedFixListeners.delete(fixId);
        }
        this.appliedFixes.delete(fixId);

      } catch (error) {
        customError(`[FixManager] Error closing fix ${fixId}:`, error);
      }
    }
  }

  private handleAppliedFixToggle(fixId: string, event: Event): void {
    event.stopPropagation();
    const fixInfo = this.appliedFixes.get(fixId);

    // Obtain the button that triggered the event and locate its parent wrapper for more reliable DOM traversal
    const toggleButton = event.currentTarget as HTMLButtonElement | null;
    const wrapperElement = toggleButton ? (toggleButton.closest('.checkra-feedback-applied-fix') as HTMLElement | null) : null;
    const contentContainer = wrapperElement?.querySelector('.checkra-applied-fix-content') as HTMLElement | null;

    if (fixInfo && wrapperElement && contentContainer && toggleButton) {
      dLog('Toggle clicked', { fixId, insertionMode: fixInfo.insertionMode, isCurrentlyFixed: fixInfo.isCurrentlyFixed });
      try {
        dLog('Before toggle', { contentDisplay: contentContainer.style.display, originalDisplay: fixInfo.originalElementRef?.style.display });
        
        // Log the actual elements we're working with
        dLog('Toggle elements', {
          hasOriginalContent: !!fixInfo.originalContentElement,
          hasContentContainer: !!contentContainer,
          originalContentDisplay: fixInfo.originalContentElement?.style.display,
          contentContainerDisplay: contentContainer.style.display,
          insertionMode: fixInfo.insertionMode
        });
        
        fixInfo.isCurrentlyFixed = !fixInfo.isCurrentlyFixed;

        if (fixInfo.insertionMode === 'replace') {
          const origCont = fixInfo.originalContentElement;
          dLog('Replace mode toggle', { hasOrigCont: !!origCont, willShowFixed: fixInfo.isCurrentlyFixed });
          if (origCont && contentContainer) {
            if (fixInfo.isCurrentlyFixed) {
              // Show fixed
              contentContainer.style.display = '';
              origCont.style.display = 'none';
              toggleButton.classList.add('toggled-on');
              toggleButton.title = 'Show Original Version';
            } else {
              // Show original
              contentContainer.style.display = 'none';
              origCont.style.display = '';
              toggleButton.classList.remove('toggled-on');
              toggleButton.title = 'Show Fixed Version';
            }
          }
        } else {
          // insertBefore/insertAfter – swap visibility between fixed wrapper's content and the original element.
          const originalEl = fixInfo.originalElementRef;
          if (contentContainer && originalEl) {
            if (fixInfo.isCurrentlyFixed) {
              // Show fixed
              contentContainer.style.display = '';
              originalEl.style.display = 'none';
              toggleButton.classList.add('toggled-on');
              toggleButton.title = 'Show Original Version';
            } else {
              // Show original
              contentContainer.style.display = 'none';
              originalEl.style.display = '';
              toggleButton.classList.remove('toggled-on');
              toggleButton.title = 'Show Fixed Version';
            }
          }
        }
        dLog('After toggle', { isNowFixed: fixInfo.isCurrentlyFixed, contentDisplay: contentContainer.style.display, originalDisplay: fixInfo.originalElementRef?.style.display });
      } catch (error) {
        customError(`[FixManager] Error toggling fix ${fixId}:`, error);
      }
    }
  }

  private async handleAppliedFixCopy(fixId: string, event: Event): Promise<void> {
    event.stopPropagation();
    const fixInfo = this.appliedFixes.get(fixId);
    if (!fixInfo) return;

    try {
      const prompt = this.buildFixPrompt(fixInfo);
      await navigator.clipboard.writeText(prompt);
      this.domManager?.showCopyPromptToast();
    } catch (err) {
      customError('[FixManager] Failed to copy prompt to clipboard:', err);
      this.showErrorCb?.('Unable to copy prompt to clipboard.');
    }
  }

  private handleAppliedFixRate(fixId: string, event: Event): void {
    event.stopPropagation();
    const fixInfo = this.appliedFixes.get(fixId);
    const rateButton = (event.currentTarget as HTMLButtonElement);

    if (!fixInfo || !fixInfo.appliedWrapperElement || !rateButton || rateButton.disabled) {
      return;
    }

    let existingOptionsContainer = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-rating-options');
    if (existingOptionsContainer) {
      existingOptionsContainer.remove();
      return;
    }

    const ratingOptionsContainer = document.createElement('div');
    ratingOptionsContainer.className = 'feedback-fix-rating-options';

    const ratings = [
      { value: 1, text: '★ Not OK' },
      { value: 2, text: '★★ OK' },
      { value: 3, text: '★★★ Good' },
      { value: 4, text: '★★★★ Great!' },
    ];

    ratings.forEach(rating => {
      const optionElement = document.createElement('div');
      optionElement.className = 'feedback-rating-option';
      optionElement.textContent = rating.text;
      
      optionElement.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.feedback-rating-feedback-form')) return;

        e.stopPropagation();
        if (rating.value <= 2) {
          const form = this.createRatingForm(fixId, rating.value as 1 | 2, ratingOptionsContainer);
          optionElement.appendChild(form);
          (form.querySelector('input') as HTMLInputElement)?.focus();
        } else {
          this.submitRating(fixId, rating.value as 3 | 4);
          ratingOptionsContainer.remove();
        }
      });
      ratingOptionsContainer.appendChild(optionElement);
    });

    const clickOutsideListener = (ev: MouseEvent) => {
       if (!ratingOptionsContainer.contains(ev.target as Node) && ev.target !== rateButton) {
         ratingOptionsContainer.remove();
         document.removeEventListener('click', clickOutsideListener, true);
       }
     };
     setTimeout(() => document.addEventListener('click', clickOutsideListener, true), 0);

    // Append to the wrapper element so it's positioned relative to the entire fix
    fixInfo.appliedWrapperElement.appendChild(ratingOptionsContainer);
  }

  private createRatingForm(fixId: string, ratingValue: 1 | 2, container: HTMLElement): HTMLFormElement {
    const feedbackForm = document.createElement('form');
    feedbackForm.className = 'feedback-rating-feedback-form';
    
    const feedbackInput = document.createElement('input');
    feedbackInput.type = 'text';
    feedbackInput.placeholder = 'Optional feedback';
    feedbackInput.className = 'feedback-rating-feedback-input';
    
    const chipsContainer = document.createElement('div');
    chipsContainer.className = 'feedback-rating-chips';
    let selectedChips: Set<string> = new Set();
    ['ugly', 'off brand', 'broken', 'copy', 'colors', 'layout', 'spacing'].forEach(label => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = label;
      chip.className = 'feedback-rating-chip';
      chip.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        chip.classList.toggle('active');
        selectedChips.has(label) ? selectedChips.delete(label) : selectedChips.add(label);
        submitBtn.disabled = feedbackInput.value.trim().length === 0 && selectedChips.size === 0;
      });
      chipsContainer.appendChild(chip);
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.textContent = 'Submit Rating';
    submitBtn.className = 'feedback-rating-feedback-submit';
    submitBtn.disabled = true;

    feedbackInput.addEventListener('input', () => {
        submitBtn.disabled = feedbackInput.value.trim().length === 0 && selectedChips.size === 0;
    });

    submitBtn.addEventListener('click', () => {
      this.submitRating(fixId, ratingValue, feedbackInput.value.trim(), Array.from(selectedChips));
      container.remove();
    });

    feedbackForm.append(feedbackInput, chipsContainer, submitBtn);
    return feedbackForm;
  }
  
  private submitRating(fixId: string, rating: 1 | 2 | 3 | 4, feedback?: string, tags?: string[]) {
      const fixInfo = this.appliedFixes.get(fixId);
      if (!fixInfo || !fixInfo.requestBody) return;
      
      const payload: AddRatingRequestBody = { ...fixInfo.requestBody, rating, feedback, tags, fixId, generatedHtml: fixInfo.fixedOuterHTML };
      eventEmitter.emit('fixRated', payload);
      
      fixInfo.isRated = true;
      const rateButton = fixInfo.appliedWrapperElement?.querySelector<HTMLButtonElement>('.feedback-fix-rate-btn');
      if (rateButton) {
          rateButton.classList.add('rated');
          rateButton.disabled = true;
      }
  }

  private createFragmentFromHTML(htmlString: string): DocumentFragment | null {
    try {
      const template = document.createElement('template');
      template.innerHTML = htmlString.trim();
      return template.content;
    } catch { return null; }
  }

  private createAppliedFixButton(type: 'close' | 'toggle' | 'copy' | 'rate' | 'info', fixId: string): HTMLButtonElement {
    const DISPLAY_FIX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>`;
    const INFO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-info-icon lucide-info"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;
    const COPY_FIX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy-icon lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
    const button = document.createElement('button');
    button.setAttribute('data-fix-id', fixId);
    switch (type) {
      case 'close': button.className = 'feedback-fix-close-btn'; button.innerHTML = '&times;'; button.title = 'Discard Fix'; break;
      case 'toggle': button.className = 'feedback-fix-toggle toggled-on'; button.innerHTML = DISPLAY_FIX_SVG; button.title = 'Toggle Original Version'; break;
      case 'copy': button.className = 'feedback-fix-copy-btn'; button.innerHTML = COPY_FIX_SVG; button.title = 'Copy prompt for this fix'; break;
      case 'rate': button.className = 'feedback-fix-rate-btn'; button.innerHTML = '★'; button.title = 'Rate this fix'; break;
      case 'info': button.className = 'feedback-fix-info-btn'; button.innerHTML = INFO_SVG; button.title = 'Show audit details'; break;
    }
    return button;
  }

  private buildFixPrompt(fix: AppliedFixInfo): string {
    const { stableTargetSelector, originalOuterHTML, fixedOuterHTML } = fix;
    const jsonPayload = { op: "replaceOuterHTML", uniqueSelector: stableTargetSelector, originalOuterHTML, proposedOuterHTML: fixedOuterHTML };
    return `You are an autonomous coding agent... apply this patch: \n${JSON.stringify(jsonPayload, null, 2)}`;
  }

  preprocessHtmlForAI(htmlString: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const svgs = doc.querySelectorAll('svg');

    svgs.forEach(svg => {
      const placeholderId = `checkra-svg-${this.svgPlaceholderCounter++}`;
      this.originalSvgsMap.set(placeholderId, svg.outerHTML);
      const placeholder = doc.createElement('svg');
      placeholder.setAttribute('data-checkra-id', placeholderId);
      placeholder.setAttribute('viewBox', '0 0 1 1');
      svg.parentNode?.replaceChild(placeholder, svg);
    });
    
    if (doc.body.childNodes.length === 1 && doc.body.firstElementChild) {
      return doc.body.firstElementChild.outerHTML;
    }
    return doc.body.innerHTML;
  }

  postprocessHtmlFromAI(aiHtmlString: string): string {
    if (this.originalSvgsMap.size === 0) return aiHtmlString;
    return aiHtmlString.replace(SVG_PLACEHOLDER_REGEX, (match, id) => this.originalSvgsMap.get(id) || match);
  }

  extractFixedHtml(responseText: string): { html: string | null; analysis: string | null } {
    const GENERIC_HTML_REGEX = /```(?:html)?\n([\s\S]*?)\n```/i;
    let match = responseText.match(GENERIC_HTML_REGEX);
    if (match && match[1]) {
      const extractedHtml = this.postprocessHtmlFromAI(match[1].trim());
      const analysisPortion = responseText.replace(match[0], '').trim();
      return { html: extractedHtml, analysis: analysisPortion };
    }
    return { html: null, analysis: responseText };
  }

  private handleAppliedFixInfo(fixId: string, event: Event): void {
    event.stopPropagation();
    const fixInfo = this.appliedFixes.get(fixId);
    if (!fixInfo || !fixInfo.appliedWrapperElement) return;

    let existingOverlay = fixInfo.appliedWrapperElement.querySelector('.feedback-fix-info-overlay');
    if (existingOverlay) { existingOverlay.remove(); return; }

    const overlay = document.createElement('div');
    overlay.className = 'feedback-fix-info-overlay';

    const analysisText = fixInfo.auditAnalysis || 'No analysis.';
    const scores = fixInfo.auditScores;
    const scoreHtml = scores ? `<div style="font-size:11px;line-height:1.4;margin-bottom:4px;">`+
      `Clarity: ${scores.messageClarity}<br/>Action: ${scores.actionStrength}<br/>Trust: ${scores.trustCredibility}<br/>Ease: ${scores.readingEase}`+
      `</div>` : '';

    overlay.innerHTML = `${scoreHtml}<div style="font-size:11px;line-height:1.4;white-space:pre-wrap;max-width:220px;">${analysisText}</div>`;

    // click outside to close
    const clickOutside = (e: MouseEvent) => {
      if (!overlay.contains(e.target as Node) && (e.target as HTMLElement) !== event.currentTarget) {
        overlay.remove();
        document.removeEventListener('click', clickOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('click', clickOutside, true), 0);

    // Append to the wrapper element so it's positioned relative to the entire fix
    fixInfo.appliedWrapperElement.appendChild(overlay);
  }
}

export function createCenteredLoaderElement(): HTMLDivElement {
    const loaderOuter = document.createElement('div');
    loaderOuter.className = 'checkra-replace-loader';
    const spinnerInner = document.createElement('div');
    spinnerInner.className = 'checkra-spinner-inner';
    loaderOuter.appendChild(spinnerInner);
    return loaderOuter;
} 