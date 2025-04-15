import { CheckraOptions } from '../types';
import { screenCapture } from './screen-capture';
import { feedbackViewer } from './feedback-viewer';

/**
 * Class for managing the floating feedback button UI component.
 */
export class FloatingMenu {
  private feedbackButton: HTMLSpanElement | null = null;
  private bottomContainer: HTMLDivElement | null = null;

  /**
   * Creates a new FloatingMenu instance.
   */
  constructor(config: CheckraOptions) {
    this.create();
  }

  /**
   * Creates the floating menu DOM elements.
   */
  private create(): void {
    // Create bottom container for feedback button
    this.bottomContainer = document.createElement('div');
    this.bottomContainer.id = 'floating-menu-container';
    this.bottomContainer.style.position = 'fixed';
    this.bottomContainer.style.bottom = '10px';
    this.bottomContainer.style.left = '10px';
    this.bottomContainer.style.boxSizing = 'border-box';
    this.bottomContainer.style.boxShadow = '2px 2px 3px rgba(0, 0, 0, 0.4)';
    this.bottomContainer.style.background = 'linear-gradient(to bottom, rgba(35, 45, 75, 0.9), rgba(29, 38, 55, 0.95))';
    this.bottomContainer.style.borderRadius = '20px';
    this.bottomContainer.style.padding = '6px 12px';
    this.bottomContainer.style.display = 'flex';
    this.bottomContainer.style.alignItems = 'center';
    this.bottomContainer.style.gap = '5px';
    this.bottomContainer.style.zIndex = '999';

    // Create Feedback button (SVG)
    this.feedbackButton = document.createElement('span');
    this.feedbackButton.id = 'show-feedback-viewer';
    this.feedbackButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
      <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
      <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
      <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
      <circle cx="12" cy="12" r="4"/>
      <path d="m16 16-1.5-1.5"/>
    </svg>`;
    this.feedbackButton.title = 'Get feedback on design';
    this.feedbackButton.style.width = '30px';
    this.feedbackButton.style.height = '30px';
    this.feedbackButton.style.borderRadius = '50%';
    this.feedbackButton.style.color = 'white';
    this.feedbackButton.style.display = 'flex';
    this.feedbackButton.style.alignItems = 'center';
    this.feedbackButton.style.justifyContent = 'center';
    this.feedbackButton.style.cursor = 'pointer';
    this.feedbackButton.style.boxShadow = 'rgba(0, 0, 0, 0.5) 0px -1px 1px';
    this.feedbackButton.style.backgroundColor = 'rgba(20, 120, 255, 0.85)';
    this.feedbackButton.style.border = '2px solid rgb(52 63 84 / 80%)';
    this.feedbackButton.style.userSelect = 'none';

    const svgElement = this.feedbackButton.querySelector('svg');
    if (svgElement) {
      svgElement.style.width = '18px';
      svgElement.style.height = '18px';
    }

    this.feedbackButton.addEventListener('click', (e) => {
      e.stopPropagation();
      console.log('[Feedback] Button clicked, starting screen capture...');
      screenCapture.startCapture((
        imageDataUrl,
        selectedHtml,
        bounds,
        targetElement,
        clickX,
        clickY,
        effectiveBackgroundColor
      ) => {
        console.log('[Feedback] Screen capture callback executed.');
        if ((clickX !== 0 || clickY !== 0) || imageDataUrl || selectedHtml || targetElement) {
            console.log('[Feedback] Data or valid click/element received. Showing input area...');
            try {
                feedbackViewer.showInputArea(
                    imageDataUrl,
                    selectedHtml,
                    bounds,
                    targetElement,
                    clickX,
                    clickY,
                    effectiveBackgroundColor
                );
                console.log('[Feedback] Feedback input area shown.');
            } catch (viewerError) {
                console.error('[Feedback] Error showing feedback input area:', viewerError);
            }
        } else {
            console.warn('[Feedback] Screen capture cancelled or failed. No data received.');
        }
      });
    });

    // Add feedback button to the bottom container
    if (this.bottomContainer && this.feedbackButton) {
      this.bottomContainer.appendChild(this.feedbackButton);
    }

    // Append the bottom container once the DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (this.bottomContainer) {
          document.body.appendChild(this.bottomContainer);
        }
      });
    } else {
      if (this.bottomContainer) {
        document.body.appendChild(this.bottomContainer);
      }
    }
  }

  /**
   * Destroys the floating menu component, removing all DOM elements and event listeners.
   */
  public destroy(): void {
    // Remove event listeners by cloning the node (simple way to remove all listeners)
    if (this.feedbackButton) {
        this.feedbackButton.replaceWith(this.feedbackButton.cloneNode(true));
    }
    // It might be sufficient to just remove the container, which contains the button
    if (this.bottomContainer) {
        this.bottomContainer.replaceWith(this.bottomContainer.cloneNode(true));
    }

    // Remove the bottom container from the DOM
    if (this.bottomContainer?.parentNode) {
      this.bottomContainer.parentNode.removeChild(this.bottomContainer);
    }

    // Nullify references
    this.feedbackButton = null;
    this.bottomContainer = null;
  }
}