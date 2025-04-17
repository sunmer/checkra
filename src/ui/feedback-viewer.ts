import { escapeHTML } from './utils';
import { fetchFeedback } from '../services/ai-service';
import { marked } from 'marked';
import { copyViewportToClipboard } from '../utils/clipboard-utils';

// --- LocalStorage Keys ---
const LS_WIDTH_KEY = 'feedbackViewerWidth';
const LS_HEIGHT_KEY = 'feedbackViewerHeight';
const DEFAULT_WIDTH = 450; // Default width in pixels
const DEFAULT_HEIGHT = 200; // Default initial height (can adjust)
const MIN_WIDTH = 300;
const MIN_HEIGHT = 200;
const MAX_WIDTH_VW = 80; // Max width as percentage of viewport width
const MAX_HEIGHT_VH = 60; // Max height as percentage of viewport height

/**
 * Class for managing the feedback response viewer modal.
 */
export class FeedbackViewer {
  private element: HTMLDivElement | null = null;
  private promptTextarea: HTMLTextAreaElement | null = null;
  private submitButton: HTMLButtonElement | null = null;
  private submitButtonTextSpan: HTMLSpanElement | null = null;
  private responseContentElement: HTMLElement | null = null;
  private renderedHtmlPreview: HTMLDivElement | null = null;
  private outsideClickHandler: (e: MouseEvent) => void;
  private currentImageDataUrl: string | null = null;
  private currentSelectedHtml: string | null = null;
  private originalElementBounds: DOMRect | null = null;
  private originalElementRef: Element | null = null;
  private insertedFixWrapper: HTMLDivElement | null = null;
  private fixContentContainer: HTMLDivElement | null = null;
  private accumulatedResponseText: string = '';
  private fixWrapperCloseButtonListener: (() => void) | null = null;
  private originalElementDisplayStyle: string | null = null;
  private fixWrapperMouseLeaveListener: (() => void) | null = null;
  private originalElementMouseEnterListener: (() => void) | null = null;
  private closeButton: HTMLButtonElement | null = null;
  private loadingIndicatorElement: HTMLDivElement | null = null;
  private isStreamStarted: boolean = false;
  private resizeHandle: HTMLDivElement | null = null; // <-- Add resize handle element
  private actionButtonsContainer: HTMLDivElement | null = null; // <-- Add container for action buttons
  private applyFixButton: HTMLButtonElement | null = null; // <-- Add apply fix button
  private showHtmlButton: HTMLButtonElement | null = null; // <-- Add show html button

  // --- Dragging State ---
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private dragInitialLeft: number = 0;
  private dragInitialTop: number = 0;
  // --- End Dragging State ---

  // --- Resizing State ---
  private isResizing: boolean = false;
  private resizeStartX: number = 0;
  private resizeStartY: number = 0;
  private initialWidth: number = 0;
  private initialHeight: number = 0;
  // --- End Resizing State ---

  constructor() {
    this.outsideClickHandler = (e: MouseEvent) => {
      if (this.element &&
        this.element.style.display !== 'none' &&
        e.target instanceof Node &&
        !this.element.contains(e.target) &&
        !this.renderedHtmlPreview?.contains(e.target)) {
        if (!this.closeButton || !this.closeButton.contains(e.target as Node)) {
             this.hide();
        }
      }
    };
  }

  // --- Helper methods for size persistence ---
  private saveSize(width: number, height: number): void {
    try {
      localStorage.setItem(LS_WIDTH_KEY, width.toString());
      localStorage.setItem(LS_HEIGHT_KEY, height.toString());
      console.log(`[FeedbackViewer] Saved size: W=${width}, H=${height}`);
    } catch (e) {
      console.error("[FeedbackViewer] Error saving size to localStorage:", e);
    }
  }

  private loadSize(): { width: number | null; height: number | null } {
    try {
      const savedWidth = localStorage.getItem(LS_WIDTH_KEY);
      const savedHeight = localStorage.getItem(LS_HEIGHT_KEY);
      const width = savedWidth ? parseInt(savedWidth, 10) : null;
      const height = savedHeight ? parseInt(savedHeight, 10) : null;

      if (width && height) {
        console.log(`[FeedbackViewer] Loaded size: W=${width}, H=${height}`);
        // Basic validation
        if (width >= MIN_WIDTH && height >= MIN_HEIGHT) {
             return { width, height };
        } else {
            console.warn("[FeedbackViewer] Loaded size out of bounds, using defaults.");
            localStorage.removeItem(LS_WIDTH_KEY); // Clear invalid stored size
            localStorage.removeItem(LS_HEIGHT_KEY);
        }
      }
    } catch (e) {
      console.error("[FeedbackViewer] Error loading size from localStorage:", e);
    }
    return { width: null, height: null };
  }
  // --- End Helper methods ---

  public create(): void {
    if (this.element) return;

    const styleElement = document.createElement('style');
    styleElement.textContent = `
      #feedback-response-content .streamed-content h1,
      #feedback-response-content .streamed-content h2,
      #feedback-response-content .streamed-content h3,
      #feedback-response-content .streamed-content h4,
      #feedback-response-content .streamed-content h5,
      #feedback-response-content .streamed-content h6 {
        color: #fff;
        margin-top: 14px;
        margin-bottom: 0.5em;
        font-weight: 600;
      }

      #feedback-response-content .streamed-content p {
        margin-bottom: 0.8em;
        line-height: 1.6;
      }

      #feedback-response-content .streamed-content code {
        background-color: #3a3a3a;
        padding: 0.2em 0.4em;
        border-radius: 3px;
        font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
        font-size: 0.9em;
      }

      #feedback-response-content .streamed-content pre {
        display: none;
        background-color: #2a2a2a;
        padding: 10px;
        border-radius: 4px;
        overflow-x: auto;
        margin-bottom: 1em;
      }

      #feedback-response-content .streamed-content pre code {
        background-color: transparent;
        padding: 0;
        border-radius: 0;
        font-size: 14px;
      }

      #feedback-response-content .streamed-content ul,
      #feedback-response-content .streamed-content ol {
        padding-left: 20px;
        margin-bottom: 1em;
      }

      #feedback-response-content .streamed-content li {
        margin-bottom: 0.4em;
      }

      /* --- New Fade In Keyframe --- */
      @keyframes fadeInElement {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      /* --- End Keyframes --- */

      .feedback-injected-fix {
        position: relative;
        opacity: 0; /* Start transparent for fade-in */
        outline: 2px dashed #196ee6;
        outline-offset: 6px;
        animation:
          fadeInElement 1.5s ease-out 1 forwards;
      }

      .feedback-fix-close-btn {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 18px;
        height: 18px;
        background-color: rgba(80, 80, 80, 0.7);
        color: #ddd;
        border: 1px solid #555;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
        line-height: 1;
        z-index: 11;
        pointer-events: auto;
        transition: background-color 0.2s, color 0.2s;
        font-family: sans-serif;
      }

      .feedback-fix-close-btn:hover {
        background-color: rgba(200, 50, 50, 0.8);
        color: white;
      }

      /* --- New Copy Button Styles --- */
      .feedback-fix-copy-btn {
        position: absolute;
        top: 2px;
        right: 24px; /* Position next to the close button */
        width: 18px;
        height: 18px;
        background-color: rgba(80, 80, 80, 0.7);
        color: #ddd;
        border: 1px solid #555;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2px; /* Add padding for the SVG */
        box-sizing: border-box; /* Include padding in width/height */
        z-index: 11;
        pointer-events: auto;
        transition: background-color 0.2s, color 0.2s;
      }

      .feedback-fix-copy-btn svg {
        width: 10px; /* Adjust SVG size */
        height: 10px;
        stroke: currentColor; /* Inherit color */
      }

      .feedback-fix-copy-btn:hover {
        background-color: rgba(80, 120, 200, 0.8); /* Different hover color */
        color: white;
      }
      /* --- End Copy Button Styles --- */

      #feedback-viewer button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background-color: rgba(255, 255, 255, 0.1) !important;
      }
      #feedback-viewer button:not(:disabled):hover {
         background-color: rgba(255, 255, 255, 0.2);
      }

      #feedback-viewer #feedback-submit-button {
        position: absolute;
        bottom: 10px;
        right: 10px;
        justify-content: center;
        align-items: center;
        gap: 6px;
        text-align: center;
        background: #2563eb;
        color: white;
        font-size: 0.875rem;
        font-weight: 500;
        border-radius: 0.375rem;
        padding: 6px 8px;
        cursor: pointer;
      }

      #feedback-viewer #feedback-submit-button:focus {
        outline: none;
        box-shadow: 0 0 0 1px #4b5563;
      }

      #feedback-viewer #feedback-submit-button:disabled {
        /* Override the general disabled style to keep the blue background */
        background-color: #2563eb !important;
        /* Keep the opacity change to indicate it's disabled */
        opacity: 0.6; /* Slightly less faded than the default 0.5 */
        cursor: not-allowed;
      }

      #feedback-viewer #feedback-submit-button span:last-child {
        margin-left: 0;
        color: #e5e7eb;
      }

      /* Loading Spinner Animation */
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .loading-spinner {
        animation: spin 1s linear infinite;
        width: 1.2em; /* Adjust size as needed */
        height: 1.2em;
        flex-shrink: 0; /* Prevent spinner from shrinking */
      }

      /* Style for the loading indicator container */
      #feedback-loading-indicator {
        display: flex; /* Use flex for alignment */
        align-items: center;
        gap: 8px; /* Space between spinner and text */
        color: #a0c8ff; /* Match response title color */
        font-size: 0.9em; /* Slightly smaller text */
      }

      #feedback-viewer {
        cursor: grab; /* Add grab cursor for the whole viewer */
        position: fixed; /* Or absolute, depending on positioning logic */
        overflow: hidden; /* Prevent content overflow during resize */
      }

      #feedback-viewer.dragging {
        cursor: grabbing;
      }

      #feedback-viewer textarea,
      #feedback-viewer button,
      #feedback-viewer #feedback-response-content {
        cursor: auto; /* Keep default cursor for interactive elements */
      }

      /* --- Resize Handle Style --- */
      #feedback-viewer-resize-handle {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 15px;
        height: 15px;
        cursor: nwse-resize;
        background-color: rgba(255, 255, 255, 0.2);
        border-top: 1px solid rgba(255, 255, 255, 0.3);
        border-left: 1px solid rgba(255, 255, 255, 0.3);
        border-bottom-right-radius: 8px; /* Match parent */
        z-index: 10; /* Above content, below potential modals */
        transition: background-color 0.2s;
      }
      #feedback-viewer-resize-handle:hover {
        background-color: rgba(255, 255, 255, 0.4);
      }
      /* --- End Resize Handle Style --- */
    `;

    document.head.appendChild(styleElement);

    this.element = document.createElement('div');
    this.element.id = 'feedback-viewer';

    // --- Load and Apply Persisted Size ---
    const { width: loadedWidth, height: loadedHeight } = this.loadSize();
    const initialWidth = loadedWidth ?? DEFAULT_WIDTH;
    const initialHeight = loadedHeight ?? DEFAULT_HEIGHT; // Use a default height too

    this.element.style.position = 'fixed'; // Keep fixed for initial state/fallback
    this.element.style.backgroundColor = 'rgba(35, 45, 75, 0.95)';
    this.element.style.color = 'white';
    this.element.style.padding = '0'; // Padding is now on contentWrapper
    this.element.style.borderRadius = '8px';
    this.element.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.4)';
    this.element.style.zIndex = '1002';
    // Apply loaded/default size
    this.element.style.width = `${initialWidth}px`;
    this.element.style.height = `${initialHeight}px`;
    // Set min/max constraints
    this.element.style.minWidth = `${MIN_WIDTH}px`;
    this.element.style.minHeight = `${MIN_HEIGHT}px`;
    this.element.style.maxWidth = `${MAX_WIDTH_VW}vw`;
    this.element.style.maxHeight = `${MAX_HEIGHT_VH}vh`;
    // this.element.style.maxHeight = '80vh'; // Remove or adjust this if using dynamic height
    // this.element.style.width = 'clamp(350px, 50vw, 500px)'; // Remove clamp
    this.element.style.overflow = 'hidden'; // Important for resize handle
    this.element.style.display = 'none';
    this.element.style.fontFamily = 'sans-serif';
    this.element.style.lineHeight = '1.5';
    this.element.style.flexDirection = 'column'; // Keep flex for layout

    // --- Add Dragging Listeners ---
    this.element.addEventListener('mousedown', this.handleDragStart);
    // --- End Add Dragging Listeners ---

    const contentWrapper = document.createElement('div');
    contentWrapper.style.padding = '15px 20px 20px 20px'; // Apply padding here
    contentWrapper.style.overflowY = 'auto'; // Allow content scrolling
    contentWrapper.style.flexGrow = '1'; // Make content area fill space
    contentWrapper.style.height = '100%'; // Ensure it tries to take full height for flexbox
    contentWrapper.style.boxSizing = 'border-box'; // Include padding in height calc

    const promptTitle = document.createElement('h4');
    promptTitle.textContent = 'Describe what you need help with';
    promptTitle.style.color = '#a0c8ff';
    promptTitle.style.marginBottom = '8px';
    promptTitle.style.marginTop = '0';
    promptTitle.style.fontSize = '14px';
    promptTitle.style.fontWeight = '600';
    promptTitle.style.paddingBottom = '0';
    contentWrapper.appendChild(promptTitle);

    const textareaContainer = document.createElement('div');
    textareaContainer.style.position = 'relative';

    this.promptTextarea = document.createElement('textarea');
    this.promptTextarea.rows = 4;
    this.promptTextarea.placeholder = 'e.g., "How can I improve the conversion of this page?"';
    this.promptTextarea.style.width = '100%';
    this.promptTextarea.style.padding = '10px';
    this.promptTextarea.style.backgroundColor = '#fff';
    this.promptTextarea.style.color = '#333';
    this.promptTextarea.style.border = '1px solid #ccc';
    this.promptTextarea.style.borderRadius = '4px';
    this.promptTextarea.style.fontFamily = 'inherit';
    this.promptTextarea.style.fontSize = '14px';
    this.promptTextarea.style.resize = 'vertical';
    this.promptTextarea.style.boxSizing = 'border-box';
    this.promptTextarea.addEventListener('keydown', this.handleTextareaKeydown);
    textareaContainer.appendChild(this.promptTextarea);

    this.submitButton = document.createElement('button');
    this.submitButton.id = 'feedback-submit-button';
    this.submitButton.style.display = 'flex';

    const buttonText = document.createElement('span');
    buttonText.textContent = 'Get Feedback';
    this.submitButton.appendChild(buttonText);
    this.submitButtonTextSpan = buttonText;

    const shortcutHint = document.createElement('span');
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    shortcutHint.textContent = isMac ? '(Cmd + ⏎)' : '(Ctrl + ⏎)';
    shortcutHint.style.fontSize = '10px';

    this.submitButton.appendChild(buttonText);
    this.submitButton.appendChild(shortcutHint);

    this.submitButton.addEventListener('click', this.handleSubmit);
    textareaContainer.appendChild(this.submitButton);

    contentWrapper.appendChild(textareaContainer);

    // --- Create Response Header (Container for Title and Button) ---
    const responseHeader = document.createElement('div');
    responseHeader.style.display = 'none'; // Initially hidden
    responseHeader.style.justifyContent = 'space-between';
    responseHeader.style.alignItems = 'center';
    responseHeader.style.marginBottom = '10px';
    responseHeader.style.marginTop = '15px';
    responseHeader.style.borderBottom = '1px solid rgba(255, 255, 255, 0.15)';
    responseHeader.style.paddingBottom = '6px';

    const responseTitle = document.createElement('h4');
    responseTitle.textContent = 'Feedback Response';
    responseTitle.style.color = '#a0c8ff';
    responseTitle.style.fontSize = '14px';
    responseTitle.style.fontWeight = '600';
    responseTitle.style.margin = '0'; // Remove default margins

    // --- Create Loading Indicator (Spinner + Text) ---
    this.loadingIndicatorElement = document.createElement('div');
    this.loadingIndicatorElement.id = 'feedback-loading-indicator';
    this.loadingIndicatorElement.style.display = 'none'; // Initially hidden
    this.loadingIndicatorElement.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="loading-spinner"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
      <span>Getting feedback...</span>
    `;
    // --- End Loading Indicator ---

    // --- Append Title and Loader to Header ---
    responseHeader.appendChild(responseTitle);
    responseHeader.appendChild(this.loadingIndicatorElement); // Add loader instead

    // --- Append Header and Content Area ---
    this.responseContentElement = document.createElement('div');
    this.responseContentElement.id = 'feedback-response-content';
    this.responseContentElement.style.wordWrap = 'break-word';
    this.responseContentElement.style.fontFamily = 'inherit';
    this.responseContentElement.style.fontSize = '14px';
    this.responseContentElement.style.marginTop = '10px';
    this.responseContentElement.style.display = 'none'; // Content area also starts hidden

    contentWrapper.appendChild(responseHeader); // Add the header container
    contentWrapper.appendChild(this.responseContentElement); // Add the content area below the header

    // --- Create Action Buttons Container ---
    this.actionButtonsContainer = document.createElement('div');
    this.actionButtonsContainer.id = 'feedback-action-buttons';
    this.actionButtonsContainer.style.display = 'none'; // Initially hidden
    this.actionButtonsContainer.style.marginTop = '12px';
    this.actionButtonsContainer.style.paddingTop = '10px';
    this.actionButtonsContainer.style.borderTop = '1px solid rgba(255, 255, 255, 0.15)';
    this.actionButtonsContainer.style.display = 'flex';
    this.actionButtonsContainer.style.gap = '8px';

    // --- Create Apply Fix Button ---
    this.applyFixButton = document.createElement('button');
    this.applyFixButton.textContent = 'Apply Fix';
    this.applyFixButton.classList.add('apply-fix');
    // Basic styling (can be refined with CSS classes)
    this.applyFixButton.style.padding = '6px 12px';
    this.applyFixButton.style.backgroundColor = '#2563eb';
    this.applyFixButton.style.borderRadius = '0.375rem';
    this.applyFixButton.style.fontSize = '0.875rem';
    this.applyFixButton.style.color = 'white';
    this.applyFixButton.style.cursor = 'pointer';
    this.applyFixButton.addEventListener('click', this.handleApplyFixClick);
    this.actionButtonsContainer.appendChild(this.applyFixButton);

    // --- Create Show HTML Button ---
    this.showHtmlButton = document.createElement('button');
    this.showHtmlButton.textContent = 'Show HTML';
    this.showHtmlButton.classList.add('show-html');
    // Basic styling
    this.showHtmlButton.style.padding = '6px 12px';
    this.showHtmlButton.style.backgroundColor = 'transparent';
    this.showHtmlButton.style.borderRadius = '0.375rem';
    this.showHtmlButton.style.fontSize = '0.875rem';
    this.showHtmlButton.style.border = '1px solid #2563eb';
    this.showHtmlButton.style.color = '#fff';
    this.showHtmlButton.style.borderRadius = '4px';
    this.showHtmlButton.style.cursor = 'pointer';
    this.showHtmlButton.addEventListener('click', this.handleShowHtmlClick);
    this.actionButtonsContainer.appendChild(this.showHtmlButton);

    // Append Action Buttons Container after response content
    contentWrapper.appendChild(this.actionButtonsContainer);
    // --- End Action Buttons ---

    this.element.appendChild(contentWrapper); // Append content wrapper first

    // --- Create and Add Resize Handle ---
    this.resizeHandle = document.createElement('div');
    this.resizeHandle.id = 'feedback-viewer-resize-handle';
    this.resizeHandle.addEventListener('mousedown', this.handleResizeStart);
    this.element.appendChild(this.resizeHandle); // Append handle AFTER content wrapper
    // --- End Resize Handle ---

    this.renderedHtmlPreview = document.createElement('div');
    this.renderedHtmlPreview.id = 'feedback-rendered-html-preview';
    this.renderedHtmlPreview.style.position = 'fixed';
    this.renderedHtmlPreview.style.display = 'none';
    this.renderedHtmlPreview.style.opacity = '0';
    this.renderedHtmlPreview.style.border = '1px dashed #007acc';
    this.renderedHtmlPreview.style.color = '#d4d4d4';
    this.renderedHtmlPreview.style.zIndex = '1001';
    this.renderedHtmlPreview.style.padding = '8px';
    this.renderedHtmlPreview.style.borderRadius = '4px';
    this.renderedHtmlPreview.style.maxWidth = '450px';
    this.renderedHtmlPreview.style.maxHeight = '350px';
    this.renderedHtmlPreview.style.overflow = 'auto';
    this.renderedHtmlPreview.style.transition = 'opacity 0.2s ease-in-out';
    this.renderedHtmlPreview.style.pointerEvents = 'none';
    this.renderedHtmlPreview.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.4)';

    this.renderedHtmlPreview.addEventListener('mouseover', () => {
        if (this.renderedHtmlPreview && this.renderedHtmlPreview.style.display !== 'none') {
            this.renderedHtmlPreview.style.opacity = '1';
        }
    });
    this.renderedHtmlPreview.addEventListener('mouseout', () => {
        if (this.renderedHtmlPreview) {
            this.renderedHtmlPreview.style.opacity = '0';
        }
    });

    document.body.appendChild(this.renderedHtmlPreview);
    document.body.appendChild(this.element);
    document.addEventListener('mousedown', this.outsideClickHandler);
  }

  public showInputArea(
    imageDataUrl: string | null,
    selectedHtml: string | null,
    targetRect: DOMRect | null,
    targetElement: Element | null
  ): void {
    if (!this.element) this.create();
    if (!this.element || !this.promptTextarea || !this.submitButton || !this.responseContentElement || !this.submitButtonTextSpan || !this.renderedHtmlPreview || !this.loadingIndicatorElement) return;

    // --- Load size again in case it was created but hidden ---
    // (Optional: could rely on create, but this ensures it if show is called directly)
    const { width: loadedWidth, height: loadedHeight } = this.loadSize();
    if (loadedWidth && loadedHeight) {
        // Re-apply constraints before setting size
        this.element.style.minWidth = `${MIN_WIDTH}px`;
        this.element.style.minHeight = `${MIN_HEIGHT}px`;
        this.element.style.maxWidth = `${MAX_WIDTH_VW}vw`;
        this.element.style.maxHeight = `${MAX_HEIGHT_VH}vh`;
        // Apply loaded size
        this.element.style.width = `${loadedWidth}px`;
        this.element.style.height = `${loadedHeight}px`;
    } else {
        // Apply defaults if nothing loaded
        this.element.style.width = `${DEFAULT_WIDTH}px`;
        this.element.style.height = `${DEFAULT_HEIGHT}px`;
    }

    // --- Store data ---
    this.currentImageDataUrl = imageDataUrl;
    this.currentSelectedHtml = selectedHtml;
    this.originalElementBounds = targetRect; // Use this for positioning
    this.originalElementRef = targetElement;

    // --- Reset state ---
    this.promptTextarea.value = '';
    this.promptTextarea.disabled = false;
    this.submitButton.disabled = false;
    this.submitButtonTextSpan.textContent = 'Get Feedback';
    this.responseContentElement.innerHTML = '';
    this.accumulatedResponseText = '';
    this.responseContentElement.style.display = 'none';
    const responseHeader = this.responseContentElement.previousElementSibling as HTMLElement;
    if (responseHeader) responseHeader.style.display = 'none';
    this.loadingIndicatorElement.style.display = 'none';
    this.updateActionButtonsVisibility(false); // Hide buttons on reset

    this.renderedHtmlPreview.innerHTML = '';
    this.renderedHtmlPreview.style.display = 'none';
    this.renderedHtmlPreview.style.opacity = '0';
    this.renderedHtmlPreview.style.pointerEvents = 'none';

    console.log('[FeedbackViewer DEBUG] Calling removeInjectedFix from showInputArea (start).');
    this.removeInjectedFix();

    this.promptTextarea.style.display = 'block';
    this.submitButton.style.display = 'flex';

    // --- Calculate and Set Position ---
    const viewer = this.element;
    viewer.style.transform = 'none';
    viewer.style.position = 'fixed'; // Start with fixed for calculations

    if (this.originalElementBounds) {
        const target = this.originalElementBounds;
        const placementMargin = 10; // Space between target and viewer
        const viewportMargin = 10; // Space from viewport edges

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // --- Estimate viewer dimensions (using current style dimensions) ---
        viewer.style.visibility = 'hidden';
        viewer.style.display = 'flex';
        viewer.style.left = '-9999px'; // Position offscreen for measurement
        viewer.style.top = '-9999px';

        // Get dimensions based on current style (loaded or default)
        const viewerWidth = viewer.offsetWidth;
        const viewerHeight = viewer.offsetHeight;

        // Hide it again immediately
        viewer.style.display = 'none';
        viewer.style.visibility = 'visible';
        viewer.style.left = ''; // Reset temporary styles
        viewer.style.top = '';
        // --- End dimension estimation ---

        if (!viewerWidth || !viewerHeight) {
            console.warn('[FeedbackViewer] Could not determine viewer dimensions, falling back to center (fixed).');
            viewer.style.position = 'fixed'; // Ensure fixed for center fallback
            viewer.style.top = '50%';
            viewer.style.left = '50%';
            this.element.style.display = 'flex';
            this.promptTextarea.focus();
            return; // Exit early
        }

        console.log(`[FeedbackViewer] Target Rect:`, target);
        console.log(`[FeedbackViewer] Estimated Viewer Dimensions: W=${viewerWidth}, H=${viewerHeight}`);

        // Helper functions (doesOverlap, fitsInViewport) remain the same
        const doesOverlap = (rect1: DOMRect, rect2: DOMRect): boolean => {
            return !(
                rect1.right < rect2.left ||
                rect1.left > rect2.right ||
                rect1.bottom < rect2.top ||
                rect1.top > rect2.bottom
            );
        };
        const fitsInViewport = (rect: { top: number; left: number; bottom: number; right: number }): boolean => {
            return (
                rect.top >= viewportMargin &&
                rect.left >= viewportMargin &&
                rect.bottom <= viewportHeight - viewportMargin &&
                rect.right <= viewportWidth - viewportMargin
            );
        };

        let bestViewportTop: number | null = null;
        let bestViewportLeft: number | null = null;

        // Potential positions definition remains the same
        const potentialPositions = [
            // 1. Below
            { top: target.bottom + placementMargin, left: target.left + target.width / 2 - viewerWidth / 2, width: viewerWidth, height: viewerHeight, name: "Below" },
            // 2. Above
            { top: target.top - viewerHeight - placementMargin, left: target.left + target.width / 2 - viewerWidth / 2, width: viewerWidth, height: viewerHeight, name: "Above" },
            // 3. Right
            { top: target.top + target.height / 2 - viewerHeight / 2, left: target.right + placementMargin, width: viewerWidth, height: viewerHeight, name: "Right" },
            // 4. Left
            { top: target.top + target.height / 2 - viewerHeight / 2, left: target.left - viewerWidth - placementMargin, width: viewerWidth, height: viewerHeight, name: "Left" }
        ];

        // --- Find the first valid position (relative to viewport) ---
        for (const pos of potentialPositions) {
            let clampedTop = Math.max(viewportMargin, Math.min(pos.top, viewportHeight - pos.height - viewportMargin));
            let clampedLeft = Math.max(viewportMargin, Math.min(pos.left, viewportWidth - pos.width - viewportMargin));

            const potentialRect = DOMRect.fromRect({ x: clampedLeft, y: clampedTop, width: pos.width, height: pos.height });

            console.log(`[FeedbackViewer] Checking position: ${pos.name}`, potentialRect);
            const overlapsTarget = doesOverlap(potentialRect, target);
            const fitsViewport = fitsInViewport({ top: potentialRect.top, left: potentialRect.left, bottom: potentialRect.bottom, right: potentialRect.right });
            console.log(`[FeedbackViewer] -> Overlaps Target: ${overlapsTarget}, Fits Viewport: ${fitsViewport}`);

            if (!overlapsTarget && fitsViewport) {
                bestViewportTop = potentialRect.top; // Store viewport-relative coords
                bestViewportLeft = potentialRect.left;
                console.log(`[FeedbackViewer] Found valid viewport position: ${pos.name} at T:${bestViewportTop}, L:${bestViewportLeft}`);
                break;
            }
        }

        // --- Apply the best position or fallback ---
        if (bestViewportTop !== null && bestViewportLeft !== null) {
            // Found a good spot - use absolute positioning relative to document
            viewer.style.position = 'absolute';
            const finalTop = bestViewportTop + window.scrollY;
            const finalLeft = bestViewportLeft + window.scrollX;
            viewer.style.top = `${finalTop}px`;
            viewer.style.left = `${finalLeft}px`;
            console.log(`[FeedbackViewer] Applying ABSOLUTE position: top: ${viewer.style.top}, left: ${viewer.style.left}`);
        } else {
            // Fallback: Place below and clamp using FIXED positioning
            console.warn('[FeedbackViewer] No ideal non-overlapping position found. Falling back to placing below (fixed, clamped).');
            viewer.style.position = 'fixed'; // Ensure fixed for this fallback
            let fallbackTop = target.bottom + placementMargin;
            let fallbackLeft = target.left + target.width / 2 - viewerWidth / 2;

            // Clamp fallback position within viewport
            fallbackTop = Math.max(viewportMargin, Math.min(fallbackTop, viewportHeight - viewerHeight - viewportMargin));
            fallbackLeft = Math.max(viewportMargin, Math.min(fallbackLeft, viewportWidth - viewerWidth - viewportMargin));

            viewer.style.top = `${fallbackTop}px`;
            viewer.style.left = `${fallbackLeft}px`;
            console.log(`[FeedbackViewer] Applying FIXED fallback position: top: ${viewer.style.top}, left: ${viewer.style.left}`);
        }

    } else {
        // Fallback to center if targetRect is null
        console.warn('[FeedbackViewer] Target bounds not available, falling back to center position (fixed).');
        viewer.style.position = 'fixed';
        viewer.style.top = '50%';
        viewer.style.left = '50%';
        // Center using margins now that width/height are explicit
        viewer.style.marginTop = `-${viewer.offsetHeight / 2}px`;
        viewer.style.marginLeft = `-${viewer.offsetWidth / 2}px`;
        // viewer.style.transform = 'translate(-50%, -50%)'; // Avoid transform if using margins
    }
    // --- End Position Calculation ---

    this.element.style.display = 'flex'; // Make visible *after* positioning
    this.promptTextarea.focus();
  }

  private handleTextareaKeydown = (e: KeyboardEvent): void => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      this.handleSubmit();
    }
  };

  private handleSubmit = (): void => {
    if (!this.promptTextarea || !this.submitButton || !this.responseContentElement || !this.submitButtonTextSpan || !this.loadingIndicatorElement) return;
    if (!this.currentImageDataUrl && !this.currentSelectedHtml) {
      console.warn('[Feedback] Cannot submit feedback without captured image or HTML.');
      this.showError('Could not capture image or HTML structure.');
      return;
    }

    const promptText = this.promptTextarea.value.trim();

    console.log('[Feedback] Submitting feedback...');
    console.log('[Feedback] Image Data:', this.currentImageDataUrl ? 'Present' : 'Absent');
    console.log('[Feedback] Selected HTML:', this.currentSelectedHtml ? 'Present' : 'Absent');

    this.promptTextarea.disabled = true;
    this.submitButton.disabled = true;
    this.submitButtonTextSpan.textContent = 'Sending...';
    this.isStreamStarted = false;

    // --- Clear previous content and show loader ---
    this.responseContentElement.innerHTML = ''; // Clear previous response content
    this.responseContentElement.style.display = 'block'; // Show response area
    this.loadingIndicatorElement.style.display = 'flex'; // Show the loader in the header
    this.updateActionButtonsVisibility(false); // Hide buttons on new submit
    // --- End loader display ---

    this.accumulatedResponseText = ''; // Reset accumulated text
    const responseHeader = this.responseContentElement.previousElementSibling as HTMLElement;
    if (responseHeader) {
        responseHeader.style.display = 'flex'; // Ensure header is visible
    }

    fetchFeedback(this.currentImageDataUrl, promptText, this.currentSelectedHtml);
  };

  public updateResponse(chunk: string): void {
    if (this.responseContentElement && this.element) {
      const contentWrapper = this.element.querySelector<HTMLDivElement>(':scope > div:first-child');
      if (!contentWrapper) return;

      const scrollThreshold = 10;
      const isScrolledToBottom = contentWrapper.scrollHeight - contentWrapper.scrollTop - contentWrapper.clientHeight < scrollThreshold;

      // If this is the first chunk, clear the initial message (if any)
      // BUT KEEP THE LOADER VISIBLE
      if (!this.isStreamStarted) {
        this.responseContentElement.innerHTML = ''; // Clear any initial placeholder text
        this.isStreamStarted = true; // Mark stream as started
      }

      this.accumulatedResponseText += chunk;
      const parsedHtml = marked.parse(this.accumulatedResponseText) as string;
      // Wrap parsed HTML to ensure consistent structure for scrolling/styling
      this.responseContentElement.innerHTML = `<div class="streamed-content">${parsedHtml}</div>`;

      if (isScrolledToBottom) {
        contentWrapper.scrollTop = contentWrapper.scrollHeight;
      }

      this.tryRenderHtmlPreview();
      // Only try to inject if we have accumulated text
      if (this.accumulatedResponseText.trim()) {
          console.log('[FeedbackViewer DEBUG] Calling tryInjectHtmlFix from updateResponse.');
          this.tryInjectHtmlFix(); // This will now also handle button visibility
      }
    }
  }

  private tryRenderHtmlPreview(): void {
    if (!this.renderedHtmlPreview || !this.originalElementBounds) return;

    const htmlPreviewRegex = /# Complete HTML with All Fixes\s*```(?:html)?\n([\s\S]*?)\n```/i;
    const match = this.accumulatedResponseText.match(htmlPreviewRegex);

    if (match && match[1]) {
      const extractedHtml = match[1].trim();

      if (this.renderedHtmlPreview.innerHTML !== extractedHtml) {
        console.log('[FeedbackViewer] Found updated HTML preview content.');
        this.renderedHtmlPreview.innerHTML = extractedHtml;

        this.renderedHtmlPreview.style.display = 'block';
        this.renderedHtmlPreview.style.opacity = '0';
        this.renderedHtmlPreview.style.pointerEvents = 'auto';

        requestAnimationFrame(() => {
            if (!this.renderedHtmlPreview || !this.originalElementBounds) return;

            this.renderedHtmlPreview.style.visibility = 'hidden';
            this.renderedHtmlPreview.style.opacity = '1';
            const previewRect = this.renderedHtmlPreview.getBoundingClientRect();
            this.renderedHtmlPreview.style.opacity = '0';
            this.renderedHtmlPreview.style.visibility = 'visible';

            const margin = 8;
            const viewportMargin = 10;

            let previewTop = this.originalElementBounds.top - previewRect.height - margin;
            let previewLeft = this.originalElementBounds.left;

            if (previewTop < viewportMargin) {
                previewTop = this.originalElementBounds.bottom + margin;
            }

            if (previewLeft < viewportMargin) {
                previewLeft = viewportMargin;
            }
            else if (previewLeft + previewRect.width > window.innerWidth - viewportMargin) {
                previewLeft = window.innerWidth - previewRect.width - viewportMargin;
            }

            if (previewTop + previewRect.height > window.innerHeight - viewportMargin) {
                 previewTop = window.innerHeight - previewRect.height - viewportMargin;
                 if (previewTop < viewportMargin) {
                     previewTop = viewportMargin;
                 }
            }

            this.renderedHtmlPreview.style.top = `${previewTop}px`;
            this.renderedHtmlPreview.style.left = `${previewLeft}px`;
            console.log(`[FeedbackViewer] Positioned HTML preview at top: ${previewTop}px, left: ${previewLeft}px`);
        });
      }
    } else {
      if (this.renderedHtmlPreview.style.display !== 'none') {
          console.log('[FeedbackViewer] HTML preview pattern not found in response, hiding preview.');
          this.renderedHtmlPreview.style.display = 'none';
          this.renderedHtmlPreview.style.opacity = '0';
          this.renderedHtmlPreview.style.pointerEvents = 'none';
          this.renderedHtmlPreview.innerHTML = '';
      }
    }
  }

  private tryInjectHtmlFix(): void {
    console.log('[FeedbackViewer DEBUG] Entering tryInjectHtmlFix.');

    if (!this.originalElementRef || !document.body.contains(this.originalElementRef)) {
        console.log('[FeedbackViewer DEBUG] tryInjectHtmlFix aborted: originalElementRef invalid or not in DOM.');
        console.log('[FeedbackViewer DEBUG] Calling removeInjectedFix from tryInjectHtmlFix (invalid originalElementRef).');
        this.removeInjectedFix();
        return;
    }

    const specificHtmlRegex = /# Complete HTML with All Fixes\s*```(?:html)?\n([\s\S]*?)\n```/i;
    const genericHtmlRegex = /```(?:html)?\n([\s\S]*?)\n```/i;

    let match = this.accumulatedResponseText.match(specificHtmlRegex);
    if (!match) {
      match = this.accumulatedResponseText.match(genericHtmlRegex);
    }

    this.updateActionButtonsVisibility(!!match);

    if (match && match[1]) {
      const extractedHtml = match[1].trim();
      console.log('[FeedbackViewer DEBUG] Regex matched. Extracted HTML:', extractedHtml.substring(0, 200) + '...');

      let newContentSourceElement: HTMLElement | null = null;
      let newContentHtml = '';
      let attributesToCopy: { name: string; value: string }[] = [];

      try {
        const parser = new DOMParser();
        const parsedDoc = parser.parseFromString(extractedHtml, 'text/html');

        if (parsedDoc.body && extractedHtml.toLowerCase().startsWith('<body')) {
            console.log('[FeedbackViewer DEBUG] Detected <BODY> tag as root. Replacing with <DIV>.');
            const replacementDiv = document.createElement('div');

            attributesToCopy = Array.from(parsedDoc.body.attributes)
                .filter(attr => attr.name.toLowerCase() !== 'style');
            console.log(`[FeedbackViewer DEBUG] Stored ${attributesToCopy.length} attributes from suggested <body> to copy to wrapper.`);

            while (parsedDoc.body.firstChild) {
                replacementDiv.appendChild(parsedDoc.body.firstChild);
            }
            newContentSourceElement = replacementDiv;
            newContentHtml = replacementDiv.innerHTML;
            console.log('[FeedbackViewer DEBUG] Created replacement DIV. innerHTML:', newContentHtml.substring(0, 200) + '...');
        } else {
            const tempContentContainer = document.createElement('div');
            while (parsedDoc.body.firstChild) {
                tempContentContainer.appendChild(parsedDoc.body.firstChild);
            }
            newContentHtml = tempContentContainer.innerHTML;
            console.log('[FeedbackViewer DEBUG] Using parsed content directly. innerHTML:', newContentHtml.substring(0, 200) + '...');
        }

      } catch (parseError) {
        console.error('[FeedbackViewer DEBUG] Error processing extracted HTML:', parseError);
        return;
      }

      if (!this.insertedFixWrapper) {
          console.log('[FeedbackViewer DEBUG] Creating injected fix wrapper for the first time.');

          this.insertedFixWrapper = document.createElement('div');
          this.insertedFixWrapper.classList.add('feedback-injected-fix');
          this.insertedFixWrapper.style.display = 'none';
          this.insertedFixWrapper.style.backgroundColor = 'transparent';

          if (attributesToCopy.length > 0) {
              attributesToCopy.forEach(attr => {
                  this.insertedFixWrapper!.setAttribute(attr.name, attr.value);
                  console.log(`[FeedbackViewer DEBUG] Copied attribute to wrapper: ${attr.name}="${attr.value}"`);
              });
          }

          this.fixContentContainer = document.createElement('div');
          this.fixContentContainer.classList.add('feedback-fix-content');
          try {
              this.fixContentContainer.innerHTML = newContentHtml;
              this.insertedFixWrapper.appendChild(this.fixContentContainer);
              console.log('[FeedbackViewer DEBUG] Appended initial content to inner container.');
          } catch (appendError) {
             console.error('[FeedbackViewer DEBUG] Error setting initial content for inner container:', appendError);
             this.insertedFixWrapper = null;
             this.fixContentContainer = null;
             return;
          }

          this.fixWrapperCloseButtonListener = () => {
              console.log('[FeedbackViewer DEBUG] Close button clicked on injected fix.');
              this.removeInjectedFix();
          };
          const closeButton = document.createElement('span');
          closeButton.classList.add('feedback-fix-close-btn');
          closeButton.textContent = '✕';
          closeButton.title = 'Dismiss fix suggestion';
          closeButton.addEventListener('click', this.fixWrapperCloseButtonListener);
          this.insertedFixWrapper.appendChild(closeButton);

          const copyButton = document.createElement('span');
          copyButton.classList.add('feedback-fix-copy-btn');
          copyButton.title = 'Copy viewport to clipboard';
          copyButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
          copyButton.addEventListener('click', (e) => {
              e.stopPropagation();
              console.log('[FeedbackViewer DEBUG] Copy button clicked.');
              copyViewportToClipboard().catch(err => {
                  console.error("Error copying viewport:", err);
              });
          });
          this.insertedFixWrapper.appendChild(copyButton);

          // --- Add MouseLeave Listener to Hide Fix ---
          this.fixWrapperMouseLeaveListener = () => {
              console.log('[FeedbackViewer DEBUG] Mouse left injected fix wrapper.');
              if (this.insertedFixWrapper && this.originalElementRef instanceof HTMLElement && this.originalElementDisplayStyle !== null) {
                  this.insertedFixWrapper.style.display = 'none';
                  // Restore original element only if it was hidden by 'Apply Fix'
                  if (this.originalElementRef.style.display === 'none') {
                      this.originalElementRef.style.display = this.originalElementDisplayStyle;
                      console.log(`[FeedbackViewer DEBUG] Hid fix wrapper, restored original element display to: ${this.originalElementDisplayStyle}`);
                  } else {
                      console.log('[FeedbackViewer DEBUG] Hid fix wrapper, original element was already visible.');
                  }
              } else {
                   console.log('[FeedbackViewer DEBUG] MouseLeave: Skipping hide/restore (wrapper missing, original ref invalid, or style not stored).');
              }
          };
          this.insertedFixWrapper.addEventListener('mouseleave', this.fixWrapperMouseLeaveListener);
          console.log('[FeedbackViewer DEBUG] Added mouseleave listener to fix wrapper.');
          // --- End Add MouseLeave Listener ---

          // --- Add MouseEnter Listener to Original Element to Show Fix ---
          if (this.originalElementRef instanceof HTMLElement) {
              this.originalElementMouseEnterListener = () => {
                  console.log('[FeedbackViewer DEBUG] Mouse entered original element area.');
                  // Only show the fix if it exists AND if 'Apply Fix' has been clicked (indicated by originalElementDisplayStyle being set)
                  if (this.insertedFixWrapper && this.originalElementDisplayStyle !== null) {
                      this.insertedFixWrapper.style.display = ''; // Show fix
                      if (this.originalElementRef instanceof HTMLElement) {
                          this.originalElementRef.style.display = 'none'; // Hide original
                          console.log('[FeedbackViewer DEBUG] Showed fix wrapper, hid original element (mouseenter).');
                      }
                  } else {
                      console.log('[FeedbackViewer DEBUG] MouseEnter: Skipping show fix (wrapper missing or Apply Fix not clicked yet).');
                  }
              };
              this.originalElementRef.addEventListener('mouseenter', this.originalElementMouseEnterListener);
              console.log('[FeedbackViewer DEBUG] Added mouseenter listener to original element.');
          }
          // --- End Add MouseEnter Listener ---

          if (this.originalElementRef && this.originalElementRef.parentNode) {
            this.originalElementRef.parentNode.insertBefore(
              this.insertedFixWrapper,
              this.originalElementRef.nextSibling
            );
            console.log('[FeedbackViewer DEBUG] Inserted fix wrapper into DOM after original element.');
          } else {
            console.error('[FeedbackViewer DEBUG] Cannot insert fix: Original element or its parent not found.');
            this.removeInjectedFix();
            return;
          }

      } else if (this.fixContentContainer) {
          if (this.fixContentContainer.innerHTML !== newContentHtml) {
              console.log('[FeedbackViewer DEBUG] Updating content of existing inner container.');
              try {
                  this.fixContentContainer.innerHTML = newContentHtml;
              } catch (updateError) {
                  console.error('[FeedbackViewer DEBUG] Error updating inner container HTML:', updateError);
              }
          } else {
              console.log('[FeedbackViewer DEBUG] No update needed (inner content matches).');
          }
      } else {
          console.warn('[FeedbackViewer DEBUG] Wrapper exists but inner container reference is missing. Recreating.');
          this.removeInjectedFix();
      }

    } else {
      console.log('[FeedbackViewer DEBUG] Regex did not match. Ensuring fix is removed.');
      console.log('[FeedbackViewer DEBUG] Calling removeInjectedFix from tryInjectHtmlFix (regex mismatch).');
      this.removeInjectedFix();
    }
    console.log('[FeedbackViewer DEBUG] Exiting tryInjectHtmlFix.');
  }

  private removeInjectedFix(): void {
    console.log('[FeedbackViewer DEBUG] >>> Entering removeInjectedFix <<<');
    console.trace('[FeedbackViewer DEBUG] removeInjectedFix call stack:');

    // --- Remove MouseLeave Listener ---
    if (this.insertedFixWrapper && this.fixWrapperMouseLeaveListener) {
        console.log('[FeedbackViewer DEBUG] Removing mouseleave listener from fix wrapper.');
        this.insertedFixWrapper.removeEventListener('mouseleave', this.fixWrapperMouseLeaveListener);
        this.fixWrapperMouseLeaveListener = null;
    }
    // --- End Remove MouseLeave Listener ---

    // --- Remove MouseEnter Listener ---
    if (this.originalElementRef instanceof HTMLElement && this.originalElementMouseEnterListener) {
        console.log('[FeedbackViewer DEBUG] Removing mouseenter listener from original element.');
        this.originalElementRef.removeEventListener('mouseenter', this.originalElementMouseEnterListener);
        this.originalElementMouseEnterListener = null;
    }
    // --- End Remove MouseEnter Listener ---

    if (this.originalElementRef instanceof HTMLElement) {
        console.log(`[FeedbackViewer DEBUG] Restoring original element display: ${this.originalElementDisplayStyle || 'default'}`);
        if (document.body.contains(this.originalElementRef)) {
            // Restore display style regardless of whether it was hidden or not,
            // as removeInjectedFix means we are reverting everything.
            this.originalElementRef.style.display = this.originalElementDisplayStyle || '';
        } else {
            console.log('[FeedbackViewer DEBUG] Original element no longer in DOM, skipping style restoration.');
        }
    }

    if (this.insertedFixWrapper) {
        console.log('[FeedbackViewer DEBUG] Removing insertedFixWrapper from DOM.');
        this.insertedFixWrapper.remove();
        this.insertedFixWrapper = null;
    }

    this.fixContentContainer = null;
    this.originalElementDisplayStyle = null;
    if (this.fixWrapperCloseButtonListener) {
        console.log('[FeedbackViewer DEBUG] Nullifying close button listener reference.');
        this.fixWrapperCloseButtonListener = null;
    }

    this.updateActionButtonsVisibility(false);

    console.log('[FeedbackViewer DEBUG] <<< Exiting removeInjectedFix >>>');
  }

  public finalizeResponse(): void {
    if (this.responseContentElement && this.accumulatedResponseText === '') {
      this.responseContentElement.textContent = 'Received empty response.';
    }
    console.log("Feedback stream finalized in viewer.");

    // Hide the loader now that the stream is finished
    if (this.loadingIndicatorElement) {
        this.loadingIndicatorElement.style.display = 'none';
    }

    if (this.promptTextarea) this.promptTextarea.disabled = false;
    if (this.submitButton && this.submitButtonTextSpan) {
      this.submitButton.disabled = false;
      this.submitButtonTextSpan.textContent = 'Get Feedback';
    }

    this.tryRenderHtmlPreview();
    console.log('[FeedbackViewer DEBUG] Calling tryInjectHtmlFix from finalizeResponse.');
    this.tryInjectHtmlFix();
  }

  public showError(error: Error | string): void {
    if (!this.element || !this.responseContentElement || !this.submitButtonTextSpan || !this.loadingIndicatorElement) return;

    this.element.style.display = 'flex';
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Hide the loader on error
    this.loadingIndicatorElement.style.display = 'none';

    this.responseContentElement.innerHTML = '';
    this.accumulatedResponseText = '';

    const responseHeader = this.responseContentElement.previousElementSibling as HTMLElement;
    if (responseHeader) {
        responseHeader.style.display = 'flex'; // Keep header visible for title
    }

    this.responseContentElement.style.display = 'block';
    this.responseContentElement.innerHTML = `<div style="color:#ff8a8a; white-space: pre-wrap;"><strong>Error:</strong> ${escapeHTML(errorMessage)}</div>`;

    if (this.promptTextarea) this.promptTextarea.disabled = false;
    if (this.submitButton && this.submitButtonTextSpan) {
      this.submitButton.disabled = false;
      this.submitButtonTextSpan.textContent = 'Get Feedback';
    }

    this.updateActionButtonsVisibility(false); // Hide buttons on error
  }

  public hide(): void {
    if (this.element) {
      this.element.style.display = 'none';
      this.currentImageDataUrl = null;
      this.currentSelectedHtml = null;
      if (this.promptTextarea) this.promptTextarea.value = '';
      if (this.responseContentElement) {
        const responseHeader = this.responseContentElement.previousElementSibling as HTMLElement;
        if (responseHeader) responseHeader.style.display = 'none';
      }
      this.accumulatedResponseText = '';
      // Ensure loader is hidden when hiding the panel
      if (this.loadingIndicatorElement) {
          this.loadingIndicatorElement.style.display = 'none';
      }
      this.updateActionButtonsVisibility(false); // Hide buttons when viewer hides

      console.log('[FeedbackViewer] Main viewer panel hidden.');
    }
    if (this.renderedHtmlPreview) {
        this.renderedHtmlPreview.style.display = 'none';
        this.renderedHtmlPreview.style.opacity = '0';
        this.renderedHtmlPreview.style.pointerEvents = 'none';
        this.renderedHtmlPreview.innerHTML = '';
        console.log('[FeedbackViewer] Rendered HTML preview hidden.');
    }
  }

  public destroy(): void {
    const styleElement = document.head.querySelector('style');
    if (styleElement && styleElement.textContent?.includes('#feedback-response-content .streamed-content')) {
        document.head.removeChild(styleElement);
    }
    document.removeEventListener('mousedown', this.outsideClickHandler);
    this.promptTextarea?.removeEventListener('keydown', this.handleTextareaKeydown);
    this.closeButton?.removeEventListener('click', () => this.hide());

    // --- Remove Drag Listeners ---
    this.element?.removeEventListener('mousedown', this.handleDragStart);
    // Clean up document listeners if dragging was somehow interrupted
    document.removeEventListener('mousemove', this.handleDragMove);
    document.removeEventListener('mouseup', this.handleDragEnd);
    // --- End Remove Drag Listeners ---

    // --- Remove Resize Listeners ---
    this.resizeHandle?.removeEventListener('mousedown', this.handleResizeStart);
    // Clean up document listeners if resizing was somehow interrupted
    document.removeEventListener('mousemove', this.handleResizeMove);
    document.removeEventListener('mouseup', this.handleResizeEnd);
    // --- End Remove Resize Listeners ---

    // --- Remove MouseLeave Listener (if somehow still attached) ---
    if (this.insertedFixWrapper && this.fixWrapperMouseLeaveListener) {
        this.insertedFixWrapper.removeEventListener('mouseleave', this.fixWrapperMouseLeaveListener);
    }
    // --- End Remove MouseLeave Listener ---

    if (this.originalElementRef instanceof HTMLElement && this.originalElementMouseEnterListener) {
        this.originalElementRef.removeEventListener('mouseenter', this.originalElementMouseEnterListener);
    }
    // --- End Remove MouseEnter Listener ---

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    if (this.renderedHtmlPreview && this.renderedHtmlPreview.parentNode) {
        document.body.removeChild(this.renderedHtmlPreview);
    }
    console.log('[FeedbackViewer DEBUG] Calling removeInjectedFix from destroy().');
    this.removeInjectedFix(); // Handles listener removal too
    this.element = null;
    this.promptTextarea = null;
    this.submitButton = null;
    this.responseContentElement = null;
    this.currentImageDataUrl = null;
    this.currentSelectedHtml = null;
    this.submitButtonTextSpan = null;
    this.renderedHtmlPreview = null;
    this.originalElementBounds = null;
    this.originalElementRef = null;
    this.insertedFixWrapper = null;
    this.fixContentContainer = null;
    this.fixWrapperCloseButtonListener = null;
    this.originalElementDisplayStyle = null;
    this.fixWrapperMouseLeaveListener = null;
    this.originalElementMouseEnterListener = null;
    this.closeButton = null;
    this.loadingIndicatorElement = null;
    this.isStreamStarted = false;
    this.resizeHandle = null;
    this.actionButtonsContainer = null;
    this.applyFixButton = null;
    this.showHtmlButton = null;
    // --- Reset Dragging State ---
    this.isDragging = false;
    // --- Reset Resizing State ---
    this.isResizing = false;
    // --- End Reset Dragging State ---
    console.log('[FeedbackViewer] Instance destroyed.');
  }

  // --- Dragging Handlers ---
  private handleDragStart = (e: MouseEvent): void => {
    // Prevent starting drag if resize is in progress or target is resize handle
    if (this.isResizing || !this.element || (this.resizeHandle && this.resizeHandle.contains(e.target as Node))) return;

    e.preventDefault(); // Prevent text selection during drag

    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragInitialLeft = this.element.offsetLeft;
    this.dragInitialTop = this.element.offsetTop;

    // Ensure transform is removed if it was used for centering
    this.element.style.transform = 'none';
    // Reset margins if they were used for centering
    this.element.style.marginTop = '';
    this.element.style.marginLeft = '';
    // Apply grabbing cursor via class for potentially other style changes
    this.element.classList.add('dragging');

    document.addEventListener('mousemove', this.handleDragMove);
    document.addEventListener('mouseup', this.handleDragEnd);
  };

  private handleDragMove = (e: MouseEvent): void => {
    if (!this.isDragging || !this.element) return;

    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;

    // Update position based on drag delta
    this.element.style.left = `${this.dragInitialLeft + dx}px`;
    this.element.style.top = `${this.dragInitialTop + dy}px`;
  };

  private handleDragEnd = (e: MouseEvent): void => {
    if (!this.isDragging || !this.element) return;

    this.isDragging = false;
    this.element.classList.remove('dragging'); // Remove dragging class

    document.removeEventListener('mousemove', this.handleDragMove);
    document.removeEventListener('mouseup', this.handleDragEnd);
  };
  // --- End Dragging Handlers ---

  // --- Resizing Handlers ---
  private handleResizeStart = (e: MouseEvent): void => {
    if (!this.element) return;

    e.preventDefault(); // Prevent text selection, etc.
    e.stopPropagation(); // Prevent triggering drag start

    this.isResizing = true;
    this.resizeStartX = e.clientX;
    this.resizeStartY = e.clientY;
    this.initialWidth = this.element.offsetWidth;
    this.initialHeight = this.element.offsetHeight;

    // Add listeners to the document to capture mouse move everywhere
    document.addEventListener('mousemove', this.handleResizeMove);
    document.addEventListener('mouseup', this.handleResizeEnd);

    // Optional: Add a class for visual feedback during resize
    this.element.classList.add('resizing');
    // Disable pointer events on content during resize (prevents iframe issues etc.)
    const contentWrapper = this.element.querySelector<HTMLDivElement>(':scope > div:not(#feedback-viewer-resize-handle)');
    if(contentWrapper) contentWrapper.style.pointerEvents = 'none';
  };

  private handleResizeMove = (e: MouseEvent): void => {
    if (!this.isResizing || !this.element) return;

    const dx = e.clientX - this.resizeStartX;
    const dy = e.clientY - this.resizeStartY;

    let newWidth = this.initialWidth + dx;
    let newHeight = this.initialHeight + dy;

    // Apply constraints (min/max) - Max needs calculation relative to viewport
    const maxWidthPx = (window.innerWidth * MAX_WIDTH_VW) / 100;
    const maxHeightPx = (window.innerHeight * MAX_HEIGHT_VH) / 100;

    newWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidthPx));
    newHeight = Math.max(MIN_HEIGHT, Math.min(newHeight, maxHeightPx));

    this.element.style.width = `${newWidth}px`;
    this.element.style.height = `${newHeight}px`;
  };

  private handleResizeEnd = (e: MouseEvent): void => {
    if (!this.isResizing || !this.element) return;

    this.isResizing = false;
    document.removeEventListener('mousemove', this.handleResizeMove);
    document.removeEventListener('mouseup', this.handleResizeEnd);

    // Re-enable pointer events on content
    const contentWrapper = this.element.querySelector<HTMLDivElement>(':scope > div:not(#feedback-viewer-resize-handle)');
     if(contentWrapper) contentWrapper.style.pointerEvents = '';

    // Optional: Remove resizing class
    this.element.classList.remove('resizing');

    // --- Persist the final size ---
    this.saveSize(this.element.offsetWidth, this.element.offsetHeight);
    // --- End Persistence ---
  };
  // --- End Resizing Handlers ---

  // --- Add Action Button Handlers ---
  private handleApplyFixClick = (): void => {
      console.log('[FeedbackViewer DEBUG] Apply Fix button clicked.');
      if (this.insertedFixWrapper && this.originalElementRef instanceof HTMLElement) {
          // Store original display style *before* hiding it, if not already stored
          if (this.originalElementDisplayStyle === null) {
              this.originalElementDisplayStyle = window.getComputedStyle(this.originalElementRef).display;
              if (this.originalElementDisplayStyle === 'none') {
                  this.originalElementDisplayStyle = 'block'; // Default fallback
              }
              console.log(`[FeedbackViewer DEBUG] Stored original display style: ${this.originalElementDisplayStyle}`);
          }
          // Show the fix wrapper
          this.insertedFixWrapper.style.display = ''; // Use default display
          // Hide the original element
          this.originalElementRef.style.display = 'none';
          console.log('[FeedbackViewer DEBUG] Displayed fix wrapper, hid original element.');
      } else {
          console.warn('[FeedbackViewer DEBUG] Cannot apply fix: Wrapper or original element ref missing/invalid.');
      }
  };

  private handleShowHtmlClick = (): void => {
      console.log('[FeedbackViewer DEBUG] Show HTML button clicked.');
      if (this.responseContentElement) {
          const preElement = this.responseContentElement.querySelector('.streamed-content pre') as HTMLPreElement | null;
          if (preElement) {
              preElement.style.display = 'block';
              console.log('[FeedbackViewer DEBUG] Set pre element display to block.');
              // Optional: Scroll to the pre element
              preElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } else {
              console.warn('[FeedbackViewer DEBUG] Could not find pre element within response content.');
          }
      }
  };
  // --- End Action Button Handlers ---

  // --- Add Helper for Button Visibility ---
  private updateActionButtonsVisibility(show: boolean): void {
      if (this.actionButtonsContainer) {
          const displayValue = show ? 'flex' : 'none';
          if (this.actionButtonsContainer.style.display !== displayValue) {
              this.actionButtonsContainer.style.display = displayValue;
              console.log(`[FeedbackViewer DEBUG] Action buttons visibility set to: ${displayValue}`);
          }
      }
  }
  // --- End Helper ---
}

export const feedbackViewer = new FeedbackViewer();
