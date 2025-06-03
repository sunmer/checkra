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

    try {
      const originalSelectedElement = document.querySelector(`[data-checkra-fix-id="${fixId}"]`);
      let parent: Node | null = null;
      let effectiveOriginalElement: Element | null = originalSelectedElement;

      if (!originalSelectedElement && stableSelector === 'body' && insertionMode === 'replace') {
        parent = document.body.parentNode;
        effectiveOriginalElement = document.body;
        customWarn('[FixApplier] Body replacement scenario.');
      } else if (originalSelectedElement) {
        parent = originalSelectedElement.parentNode;
      } else {
        customError(`[FixApplier] Original element/context for fix ID ${fixId} (selector: ${stableSelector}) not found.`);
        return null;
      }
      
      if (!parent) {
        customError(`[FixApplier] Parent node not found for fix ${fixId}.`);
        return null;
      }

      const startComment = document.createComment(` checkra-fix-start:${fixId} `);
      const endComment = document.createComment(` checkra-fix-end:${fixId} `);
      let actualAppliedElement: HTMLElement | null = null;

      if (insertionMode === 'replace') {
        if (!effectiveOriginalElement) {
            customError(`[FixApplier] effectiveOriginalElement is null for replace.`);
            return null;
        }
        if (!parent) {
            customError(`[FixApplier] Parent became null unexpectedly before replace operation for fix ID ${fixId}.`);
            return null;
        }
        parent.insertBefore(startComment, effectiveOriginalElement);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = fixedHtml.trim();
        const newNodes = Array.from(tempDiv.childNodes);
        if (newNodes.length > 0) {
          if (!parent) {
            return null;
          }
          newNodes.forEach(node => parent!.insertBefore(node, effectiveOriginalElement!));
          actualAppliedElement = newNodes.find(node => node.nodeType === Node.ELEMENT_NODE) as HTMLElement || null;
        }
        if (newNodes.length > 0) {
          if (!parent) {
            return null;
          }
          parent!.removeChild(effectiveOriginalElement!);
          const lastNewNode = newNodes[newNodes.length - 1];
          if (lastNewNode.nextSibling) {
            parent!.insertBefore(endComment, lastNewNode.nextSibling);
          } else {
            parent!.appendChild(endComment);
          }
        } else {
          customWarn(`[FixApplier] FixedHTML for ${fixId} (replace) resulted in no nodes. Original kept. Removing start marker.`);
          if (startComment.parentNode) {
            parent!.removeChild(startComment);
          }
        }
      } else if (insertionMode === 'insertBefore') {
        if (!effectiveOriginalElement) { customError('[FixApplier] No effective element for insertBefore'); return null; }
        if (!parent) { customError('[FixApplier] Parent is null for insertBefore'); return null; }
        parent.insertBefore(startComment, effectiveOriginalElement);
        parent.insertBefore(endComment, effectiveOriginalElement);
        const fragment = this.createFragmentFromHTML(fixedHtml);
        if (fragment) parent.insertBefore(fragment, endComment);
        let current = startComment.nextSibling;
        while(current && current !== endComment) {
            if (current.nodeType === Node.ELEMENT_NODE) { actualAppliedElement = current as HTMLElement; break; }
            current = current.nextSibling;
        }
      } else if (insertionMode === 'insertAfter') {
        if (!effectiveOriginalElement) { customError('[FixApplier] No effective element for insertAfter'); return null; }
        if (!parent) { customError('[FixApplier] Parent is null for insertAfter'); return null; }
        const anchorNode = effectiveOriginalElement.nextSibling;
        parent.insertBefore(startComment, anchorNode);
        parent.insertBefore(endComment, anchorNode);
        const fragment = this.createFragmentFromHTML(fixedHtml);
        if (fragment) parent.insertBefore(fragment, endComment);
        let current = startComment.nextSibling;
        while(current && current !== endComment) {
            if (current.nodeType === Node.ELEMENT_NODE) { actualAppliedElement = current as HTMLElement; break; }
            current = current.nextSibling;
        }
      }
      
      const finalStableSelector = stableSelector; // stableSelector is now mandatory from params if original element not found directly
      if (!finalStableSelector) {
        customError(`[FixApplier] Critical error: Stable selector is missing for fix ID ${fixId}.`);
        startComment?.remove(); endComment?.remove();
        return null;
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
        resolvedColors: currentResolvedColors ? { ...currentResolvedColors } : undefined
      };
      this.appliedFixStore.add(fixId, fixInfoData);

      if (!actualAppliedElement && insertionMode !== 'replace') {
        customWarn(`[FixApplier] Fix ${fixId} (${insertionMode}) resulted in no applied element.`);
        startComment?.remove(); endComment?.remove();
        this.overlayManager.hideControlsForFix(fixId);
        this.appliedFixStore.delete(fixId);
      } else if (actualAppliedElement) {
         const controlCallbacks = getControlCallbacks(fixId);
        this.overlayManager.showControlsForFix(fixId, actualAppliedElement, controlCallbacks);
      } else if (insertionMode === 'replace' && !actualAppliedElement) {
        customWarn(`[FixApplier] Fix ${fixId} (replace) resulted in empty content. No controls shown.`);
      }
      return fixInfoData;
    } catch (error) {
      customError('[FixApplier] Error applying fix:', error);
      // Optionally, throw the error or return a specific error status
      return null;
    }
  }
} 