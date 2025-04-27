import { screenCapture } from './screen-capture';
import { feedbackViewer } from './feedback-viewer';
import { SettingsModal } from './settings-modal';

/**
 * Class for managing the floating feedback button UI component.
 */
export class FloatingMenu {
  private feedbackButton: HTMLSpanElement | null = null;
  private settingsButton: HTMLSpanElement | null = null;
  private bottomContainer: HTMLDivElement | null = null;
  private isCreated: boolean = false;
  private settingsModalInstance: SettingsModal;

  /**
   * Creates a new FloatingMenu instance.
   * Does NOT create DOM elements immediately.
   */
  constructor(settingsModal: SettingsModal) {
    this.settingsModalInstance = settingsModal;
  }

  /**
   * Creates the floating menu DOM elements if they don't exist.
   * Returns true if created successfully or already existed, false otherwise.
   */
  public create(): boolean {
    if (this.isCreated || document.getElementById('checkra-floating-menu-container')) {
      this.isCreated = true;
      this.bottomContainer = document.getElementById('checkra-floating-menu-container') as HTMLDivElement | null;
      if (this.bottomContainer) {
          this.feedbackButton = this.bottomContainer.querySelector('#checkra-show-feedback-viewer');
          this.settingsButton = this.bottomContainer.querySelector('#checkra-show-settings-modal');
      }
      console.log('[FloatingMenu] Already created or found existing element.');
      return true;
    }

    if (!document.body) {
        console.error('[FloatingMenu] Cannot create menu: document.body is not available yet.');
        return false;
    }

    // Create bottom container for feedback button
    this.bottomContainer = document.createElement('div');
    this.bottomContainer.id = 'checkra-floating-menu-container';
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
    this.feedbackButton.id = 'checkra-show-feedback-viewer';
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
    this.feedbackButton.title = 'Get feedback on design';
    this.feedbackButton.style.cursor = 'pointer';

    const svgElement = this.feedbackButton.querySelector('svg');
    if (svgElement) {
      svgElement.style.width = '18px';
      svgElement.style.height = '18px';
    }

    // Create Settings button (SVG)
    this.settingsButton = document.createElement('span');
    this.settingsButton.id = 'checkra-show-settings-modal';
    this.settingsButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>`;
    this.settingsButton.title = 'Open Settings';

    // Apply similar styling as the feedback button
    this.settingsButton.style.width = '16px';
    this.settingsButton.style.height = '16px';
    this.settingsButton.style.marginTop = '-4px';
    this.settingsButton.style.borderRadius = '50%';
    this.settingsButton.style.color = 'white';
    this.settingsButton.style.display = 'flex';
    this.settingsButton.style.alignItems = 'center';
    this.settingsButton.style.justifyContent = 'center';
    this.settingsButton.style.cursor = 'pointer';
    this.settingsButton.style.border = '2px solid rgb(52 63 84 / 80%)';
    this.settingsButton.style.userSelect = 'none';

    // Style the inner SVG
    const settingsSvgElement = this.settingsButton.querySelector('svg');
    if (settingsSvgElement) {
      settingsSvgElement.style.width = '18px';
      settingsSvgElement.style.height = '18px';
    }

    const feedbackClickHandler = (e: MouseEvent) => {
        e.stopPropagation();
        this.triggerFeedbackCapture();
    };
    const settingsClickHandler = (e: MouseEvent) => {
        e.stopPropagation();
        console.log('[Settings] Button clicked, opening settings modal...');
        this.settingsModalInstance.showModal();
    };

    this.feedbackButton.addEventListener('click', feedbackClickHandler);
    this.settingsButton.addEventListener('click', settingsClickHandler);

    // Add buttons to the bottom container
    if (this.bottomContainer) {
      if (this.feedbackButton) {
        this.bottomContainer.appendChild(this.feedbackButton);
      }
      if (this.settingsButton) {
        this.bottomContainer.appendChild(this.settingsButton);
      }
    }

    // Append the container to the body
    document.body.appendChild(this.bottomContainer);
    this.isCreated = true;
    console.log('[FloatingMenu] Menu created and added to DOM.');
    return true;
  }

  /**
   * Programmatically triggers the feedback capture process.
   */
  public triggerFeedbackCapture(): void {
    if (!this.isCreated) {
        console.warn('[FloatingMenu] Cannot trigger feedback capture, menu not created.');
        return;
    }

    console.log('[Feedback] Triggered programmatically, starting screen capture...');
    screenCapture.startCapture((
      imageDataUrl,
      selectedHtml,
      bounds,
      targetElement,
      clickX,
      clickY,
      _effectiveBackgroundColor
    ) => {
      console.log('[Feedback] Screen capture callback executed.');
      if ((clickX !== 0 || clickY !== 0) || imageDataUrl || selectedHtml || targetElement) {
          console.log('[Feedback] Data or valid click/element received. Showing input area...');
          try {
              feedbackViewer.showInputArea(
                  imageDataUrl,
                  selectedHtml,
                  bounds,
                  targetElement
              );
              console.log('[Feedback] Feedback input area shown.');
          } catch (viewerError) {
              console.error('[Feedback] Error showing feedback input area:', viewerError);
          }
      } else {
          console.warn('[Feedback] Screen capture cancelled or failed. No data received.');
      }
    });
  }

  /**
   * Destroys the floating menu component, removing all DOM elements and event listeners.
   */
  public destroy(): void {
    if (this.bottomContainer?.parentNode) {
      this.bottomContainer.parentNode.removeChild(this.bottomContainer);
    }

    this.feedbackButton = null;
    this.settingsButton = null;
    this.bottomContainer = null;
    this.isCreated = false;
    console.log('[FloatingMenu] Instance destroyed.');
  }
}