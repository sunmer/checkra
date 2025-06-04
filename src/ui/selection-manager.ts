import { customError, customWarn } from '../utils/logger';
import { generateStableSelector } from '../utils/selector-utils';
import { screenCapture } from './screen-capture';
import { rgbToHex } from '../utils/color';
import { createCenteredLoaderElement } from './loader-factory';

export interface SelectionDetails {
  imageDataUrl: string | null;
  selectedHtml: string | null;
  stableSelector: string;
  originalOuterHTML: string;
  fixId: string;
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter';
  computedBackgroundColor: string;
  targetElement: Element | null; // The actual element selected, null if body
}

export type PrepareForInputCallback = (details: SelectionDetails) => void;

export class SelectionManager {
  private viewerElementToIgnore: HTMLElement | null = null;
  private prepareForInputCb: PrepareForInputCallback | null = null;

  private currentImageDataUrl: string | null = null;
  private currentlyHighlightedElement: Element | null = null;
  private currentFixIdCounter: number = 0; // Internal counter for fix IDs
  // This property stores the mode set when startElementSelection is called (e.g., by CheckraImpl)
  // It might differ from the mode determined by screen-capture's hover logic.
  private initialInsertionModeForSession: 'replace' | 'insertBefore' | 'insertAfter' = 'replace';
  private currentComputedBackgroundColor: string | null = null;
  private selectionPlusIconElement: HTMLDivElement | null = null;
  private pageReplaceLoaderElement: HTMLDivElement | null = null;

  constructor(viewerElementToIgnore: HTMLElement | null) {
    if (viewerElementToIgnore) {
        this.viewerElementToIgnore = viewerElementToIgnore;
    }
    this.handleSelectionResult = this.handleSelectionResult.bind(this);
  }

  public startElementSelection(insertionMode: 'replace' | 'insertBefore' | 'insertAfter', cb: PrepareForInputCallback): void {
    customWarn(`[SelectionManager] startElementSelection called with initial session mode: ${insertionMode}`);
    this.initialInsertionModeForSession = insertionMode; // Store the mode that initiated the session
    if (!this.viewerElementToIgnore) {
      customError('[SelectionManager] Viewer element to ignore is not set. Cannot start capture.');
      return;
    }
    this.prepareForInputCb = cb;
    screenCapture.startCapture(this.handleSelectionResult, this.viewerElementToIgnore);
  }

  private handleSelectionResult(
    imageDataUrl: string | null,
    selectedHtml: string | null, 
    _targetRect: DOMRect | null, // _targetRect might not be directly needed by the manager itself
    targetElement: Element | null,
    _clickX: number, // _clickX might not be directly needed
    _clickY: number, // _clickY might not be directly needed
    _effectiveBackgroundColor: string | null, // This will be re-computed
    // This mode comes from screenCapture.ts internal logic (hovering over + zones)
    modeFromScreenCapture: 'replace' | 'insertBefore' | 'insertAfter' 
  ): void {
    if (!this.prepareForInputCb) {
      customError('[SelectionManager] PrepareForInputCallback not set. Cannot proceed.');
      return;
    }
    this.removeSelectionHighlight(); // Clear previous selection visuals first

    this.currentImageDataUrl = imageDataUrl;

    let computedBgColor = '#FFFFFF';
    if (targetElement) {
      let el: HTMLElement | null = targetElement as HTMLElement;
      let rawBgColor = 'rgba(0, 0, 0, 0)';
      while (el) {
        const style = window.getComputedStyle(el);
        rawBgColor = style.backgroundColor;
        if (rawBgColor && rawBgColor !== 'rgba(0, 0, 0, 0)' && rawBgColor !== 'transparent') {
          break;
        }
        if (el === document.body) break;
        el = el.parentElement;
      }
      computedBgColor = rgbToHex(rawBgColor) || '#FFFFFF';
      customWarn('[SelectionManager] Computed BG for context:', computedBgColor, 'from element:', targetElement, '(raw was:', rawBgColor, ')');
    } else {
      customWarn('[SelectionManager] No targetElement, defaulting computed BG to #FFFFFF');
    }
    this.currentComputedBackgroundColor = computedBgColor;

    const isElementSelected = !!(targetElement && targetElement !== document.body);
    let stableSelector: string;
    let originalOuterHTML: string;
    const fixId = `checkra-fix-${this.currentFixIdCounter++}`;

    if (isElementSelected && targetElement) {
      stableSelector = generateStableSelector(targetElement);
      originalOuterHTML = selectedHtml || targetElement.outerHTML; // Fallback if selectedHtml is null for some reason
      this.currentlyHighlightedElement = targetElement;
      // Update visuals based on the mode from screen capture (hover/click)
      this.updateSelectionVisuals(targetElement, modeFromScreenCapture); 
      targetElement.setAttribute('data-checkra-fix-id', fixId);
    } else {
      stableSelector = 'body';
      originalOuterHTML = document.body.outerHTML;
      this.currentlyHighlightedElement = null;
      // For body or no selection, visuals are typically for 'replace'
      this.updateSelectionVisuals(null, 'replace'); 
    }

    // ADDED LOG: To check the modeFromScreenCapture and the mode being sent in details
    customWarn(`[SelectionManager] handleSelectionResult: modeFromScreenCapture = ${modeFromScreenCapture}, initialInsertionModeForSession = ${this.initialInsertionModeForSession}`);

    const selectionDetails: SelectionDetails = {
      imageDataUrl: this.currentImageDataUrl,
      selectedHtml: selectedHtml, // This is the HTML snippet from screenCapture
      stableSelector,
      originalOuterHTML, // This is the outerHTML of the element or body
      fixId,
      // CRUCIAL FIX: Use modeFromScreenCapture, which reflects the actual user interaction with hover zones
      insertionMode: modeFromScreenCapture, 
      computedBackgroundColor: this.currentComputedBackgroundColor,
      targetElement: targetElement, // Pass the actual selected element
    };
    
    customWarn('[SelectionManager] handleSelectionResult: final selectionDetails being sent: ', selectionDetails);

    this.prepareForInputCb(selectionDetails);
  }
  
  public updateSelectionVisuals(element: Element | null, mode: 'replace' | 'insertBefore' | 'insertAfter'): void {
    this.removeSelectionHighlight(); // Clear any existing highlights/icons

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
      // No plus icon for replace mode by default, but loader might appear here.
    }
  }

  private createPersistentPlusIcon(position: 'top' | 'bottom', parentElement: HTMLElement): void {
    if (!this.selectionPlusIconElement) {
      this.selectionPlusIconElement = document.createElement('div');
      this.selectionPlusIconElement.className = 'checkra-insert-indicator';
      this.selectionPlusIconElement.textContent = '+';
      document.body.appendChild(this.selectionPlusIconElement);
    }
    this.selectionPlusIconElement.classList.remove('top', 'bottom', 'loading');
    this.selectionPlusIconElement.classList.add(position);

    const parentRect = parentElement.getBoundingClientRect();
    this.selectionPlusIconElement.style.position = 'absolute'; // Ensure it's positioned absolutely relative to body
    if (position === 'top') {
      this.selectionPlusIconElement.style.top = `${parentRect.top + window.scrollY - 11}px`;
    } else { // bottom
      this.selectionPlusIconElement.style.top = `${parentRect.bottom + window.scrollY - 11}px`;
    }
    this.selectionPlusIconElement.style.left = `${parentRect.left + window.scrollX + parentRect.width / 2 - 11}px`;
    this.selectionPlusIconElement.style.display = 'flex';
  }

  public removeSelectionHighlight(): void {
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
      // Remove data-checkra-fix-id if it was added by this manager and not persisted by a fix
      // This needs careful handling if applied fixes also use this attribute.
      // For now, we assume selection highlighting should clear its own temporary attributes.
      // if (this.currentlyHighlightedElement.getAttribute('data-checkra-fix-id')?.startsWith('checkra-fix-')) {
      //   this.currentlyHighlightedElement.removeAttribute('data-checkra-fix-id');
      // }
    }
    if (this.selectionPlusIconElement) {
      this.selectionPlusIconElement.classList.remove('loading');
      if (this.selectionPlusIconElement.parentNode) {
         this.selectionPlusIconElement.parentNode.removeChild(this.selectionPlusIconElement);
      }
      this.selectionPlusIconElement = null;
    }
    this.hidePageLoaders(); // Also ensures replace loader is removed
    this.currentlyHighlightedElement = null; 
  }

  public showPageSpecificLoaders(mode: 'insertBefore' | 'insertAfter' | 'replace', targetElementForReplace?: Element | null): void {
    this.hidePageLoaders(); // Clear any previous loaders first
    if (mode === 'insertBefore' || mode === 'insertAfter') {
      if (this.selectionPlusIconElement) {
        this.selectionPlusIconElement.classList.add('loading');
      }
    } else if (mode === 'replace') {
      if (targetElementForReplace) {
        this.showReplaceLoader(targetElementForReplace);
      } else if (this.currentlyHighlightedElement) { // Fallback to currently highlighted if no specific target
        this.showReplaceLoader(this.currentlyHighlightedElement);
      }
    }
  }
  
  private showReplaceLoader(targetElement: Element): void {
    if (this.pageReplaceLoaderElement && this.pageReplaceLoaderElement.parentNode) {
        this.pageReplaceLoaderElement.remove();
    }
    this.pageReplaceLoaderElement = createCenteredLoaderElement(); 
    
    // Ensure the target has the container class for proper dimming and loader positioning
    if (!targetElement.classList.contains('checkra-highlight-container')) {
        targetElement.classList.add('checkra-highlight-container');
    }
    targetElement.appendChild(this.pageReplaceLoaderElement);
    targetElement.classList.add('checkra-element-dimmed');
  }

  public hidePageLoaders(): void {
    if (this.selectionPlusIconElement) {
        this.selectionPlusIconElement.classList.remove('loading');
    }
    if (this.pageReplaceLoaderElement && this.pageReplaceLoaderElement.parentNode) {
        this.pageReplaceLoaderElement.remove();
        this.pageReplaceLoaderElement = null;
    }
    // Remove dimming from any elements that might have had it
    const dimmedElements = document.querySelectorAll('.checkra-element-dimmed');
    dimmedElements.forEach(el => el.classList.remove('checkra-element-dimmed'));
  }

  // Method to be called from CheckraImplementation to clear selection-specific state
  public resetSelectionState(): void {
    this.currentImageDataUrl = null;
    // this.currentlyHighlightedElement is cleared by removeSelectionHighlight
    // this.currentElementInsertionMode = 'replace'; // Or reset to a default
    // this.currentComputedBackgroundColor = null;
    this.removeSelectionHighlight(); // This also calls hidePageLoaders
  }
} 