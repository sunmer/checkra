import type { AppliedFixInfo, AppliedFixStore } from './applied-fix-store';
import type { OverlayManager, ControlButtonCallbacks } from './overlay-manager';
import type { GenerateSuggestionRequestbody, ResolvedColorInfo } from '../types';
import { customWarn, customError } from '../utils/logger';

export interface FixApplicationParams {
  fixId: string;
  originalHtml: string;
  fixedHtml: string;
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter';
  requestBody: GenerateSuggestionRequestbody;
  stableSelector?: string;
  currentResolvedColors: ResolvedColorInfo | null;
  // Callback to get control button handlers from CheckraImplementation
  getControlCallbacks: (fixId: string) => ControlButtonCallbacks; 
}

export class FixApplier {
  private appliedFixStore: AppliedFixStore;
  private overlayManager: OverlayManager;

  constructor(appliedFixStore: AppliedFixStore, overlayManager: OverlayManager) {
    this.appliedFixStore = appliedFixStore;
    this.overlayManager = overlayManager;
  }

  private createFragmentFromHTML(htmlString: string): DocumentFragment | null {
    try {
      const template = document.createElement('template');
      template.innerHTML = htmlString.trim();
      return template.content;
    } catch (e) {
      customError("[FixApplier] Error creating fragment from HTML string:", e, htmlString);
      return null;
    }
  }

  public apply(params: FixApplicationParams): AppliedFixInfo | null {
    const { 
      fixId, originalHtml, fixedHtml, insertionMode, 
      requestBody, stableSelector, currentResolvedColors,
      getControlCallbacks
    } = params;

    // Early validation
    if (!stableSelector) {
      customError(`[FixApplier] Critical error: Stable selector is missing for fix ID ${fixId}.`);
      return null;
    }

    try {
      const originalSelectedElementMarker = document.querySelector(`[data-checkra-fix-id="${fixId}"]`);
      let parent: Node | null = null;
      let effectiveOriginalElementForRemoval: Element | null = originalSelectedElementMarker;
      let insertionAnchor: Node | null = originalSelectedElementMarker;

      if (!originalSelectedElementMarker && stableSelector === 'body' && insertionMode === 'replace') {
        parent = document.body.parentNode;
        effectiveOriginalElementForRemoval = document.body;
        insertionAnchor = document.body;
        customWarn('[FixApplier] Body replacement scenario.');
      } else if (originalSelectedElementMarker) {
        parent = originalSelectedElementMarker.parentNode;
        if (insertionMode === 'insertAfter') {
          insertionAnchor = originalSelectedElementMarker.nextSibling;
        }
      } else {
        customError(`[FixApplier] Original element context for fix ID ${fixId} (selector: ${stableSelector}) not found.`);
        return null;
      }
      
      if (!parent) {
        customError(`[FixApplier] Parent node not found for fix ${fixId}.`);
        return null;
      }

      // Create elements for successful path
      const startComment = document.createComment(` checkra-fix-start:${fixId} `);
      const endComment = document.createComment(` checkra-fix-end:${fixId} `);
      const appliedFixWrapper = document.createElement('div');
      appliedFixWrapper.className = 'checkra-feedback-applied-fix';
      appliedFixWrapper.setAttribute('data-checkra-applied-wrapper-for', fixId);

      // Insert elements into DOM
      this.insertFixElements(parent, insertionAnchor, effectiveOriginalElementForRemoval, insertionMode, startComment, appliedFixWrapper, endComment);

      // Populate wrapper with content
      const fragment = this.createFragmentFromHTML(fixedHtml);
      let actualAppliedElement: HTMLElement | null = null;
      
      if (fragment) {
        appliedFixWrapper.appendChild(fragment);
        actualAppliedElement = appliedFixWrapper.firstElementChild as HTMLElement || null;
      } else {
        customWarn(`[FixApplier] FixedHTML for ${fixId} resulted in an empty fragment. Wrapper is empty.`);
      }

      if (!actualAppliedElement && appliedFixWrapper.childNodes.length > 0 && appliedFixWrapper.firstChild?.nodeType === Node.TEXT_NODE) {
        customWarn(`[FixApplier] Fix ${fixId} resulted in only text nodes directly in wrapper. actualAppliedElement is null.`);
      }

      // Use actualAppliedElement if available, otherwise use the wrapper
      const controlTarget = actualAppliedElement || appliedFixWrapper;

      // Create fix info and show controls
      const fixInfoData: AppliedFixInfo = {
        originalElementId: fixId,
        originalOuterHTML: originalHtml,
        fixedOuterHTML: fixedHtml,
        markerStartNode: startComment,
        markerEndNode: endComment,
        actualAppliedElement: actualAppliedElement,
        appliedFixWrapperElement: appliedFixWrapper,
        isCurrentlyFixed: true,
        stableTargetSelector: stableSelector,
        insertionMode: insertionMode, 
        requestBody: requestBody, 
        isRated: false,
        resolvedColors: currentResolvedColors ? { ...currentResolvedColors } : undefined
      };
      
      this.appliedFixStore.add(fixId, fixInfoData);
      
      const controlCallbacks = getControlCallbacks(fixId);
      this.overlayManager.showControlsForFix(fixId, controlTarget, appliedFixWrapper, controlCallbacks);
      
      return fixInfoData;
    } catch (error) {
      customError('[FixApplier] Error applying fix:', error);
      return null;
    }
  }

  private insertFixElements(
    parent: Node,
    insertionAnchor: Node | null,
    effectiveOriginalElementForRemoval: Element | null,
    insertionMode: 'replace' | 'insertBefore' | 'insertAfter',
    startComment: Comment,
    appliedFixWrapper: HTMLDivElement,
    endComment: Comment
  ): void {
    if (insertionMode === 'replace') {
      if (!effectiveOriginalElementForRemoval) {
        throw new Error('effectiveOriginalElementForRemoval is null for replace');
      }
      parent.insertBefore(startComment, effectiveOriginalElementForRemoval);
      parent.insertBefore(appliedFixWrapper, effectiveOriginalElementForRemoval);
      parent.insertBefore(endComment, effectiveOriginalElementForRemoval);
      parent.removeChild(effectiveOriginalElementForRemoval);
    } else if (insertionMode === 'insertBefore') {
      if (!insertionAnchor) {
        throw new Error('No insertionAnchor for insertBefore');
      }
      parent.insertBefore(startComment, insertionAnchor);
      parent.insertBefore(appliedFixWrapper, insertionAnchor);
      parent.insertBefore(endComment, insertionAnchor);
    } else { // insertAfter
      parent.insertBefore(startComment, insertionAnchor);
      parent.insertBefore(appliedFixWrapper, insertionAnchor);
      parent.insertBefore(endComment, insertionAnchor);
    }
  }
} 