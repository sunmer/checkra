import { LoggerOptions, ErrorInfo } from '../types';
import { truncateText } from './utils';
import { tooltip } from './tooltip';
import { sourceViewer } from './source-viewer';
import { fetchCodeFix } from '../services/ai-service';
import { fileService } from '../services/file-service';
import { screenCapture } from './screen-capture';
import { feedbackViewer } from './feedback-viewer';

// Create a centralized source map that can be imported by other files
export const errorSourceMap = new Map<string, ErrorInfo>();

/**
 * Class for managing the floating menu UI component (errors, feedback, settings).
 */
export class FloatingMenu {
  private floatingMenuDiv: HTMLElement | null = null;
  private errorList: HTMLUListElement | null = null;
  private errorCountBadge: HTMLSpanElement | null = null;
  private settingsButton: HTMLSpanElement | null = null;
  private settingsView: HTMLDivElement | null = null;
  private settingsStatus: HTMLParagraphElement | null = null;
  private isExpanded: boolean = false;
  private errorCount: number = 0;
  private originalStyle: Partial<CSSStyleDeclaration>;
  private config: LoggerOptions;
  private noErrorsMessage: HTMLElement | null = null;
  private feedbackButton: HTMLSpanElement | null = null;
  private bottomContainer: HTMLDivElement | null = null;
  private errorButton: HTMLDivElement | null = null;
  private collapseTimeoutId: number | null = null;
  private settingsOutsideClickHandler: ((event: MouseEvent) => void) | null = null;

  /**
   * Creates a new FloatingMenu instance.
   */
  constructor(config: LoggerOptions, originalStyle: Partial<CSSStyleDeclaration>) {
    this.config = config;
    this.originalStyle = originalStyle;
    this.create();
  }

  /**
   * Creates the floating menu DOM elements.
   */
  private create(): void {
    // Create floating menu div (main expanded view)
    this.floatingMenuDiv = document.createElement('div');
    this.floatingMenuDiv.id = 'error-container';
    this.floatingMenuDiv.style.display = 'none'; // Initially hidden if startCollapsed is true

    // Create error list
    this.errorList = document.createElement('ul');
    this.errorList.style.margin = '0';
    this.errorList.style.padding = '0';
    this.errorList.style.listStyleType = 'disc'; // Bullet points

    if (this.floatingMenuDiv) {
      this.floatingMenuDiv.appendChild(this.errorList);
    }

    // Create bottom container for collapsed state elements
    this.bottomContainer = document.createElement('div');
    this.bottomContainer.id = 'floating-menu-container';
    this.bottomContainer.style.position = 'fixed';
    this.bottomContainer.style.bottom = '10px';
    this.bottomContainer.style.left = '10px';
    this.bottomContainer.style.boxShadow = '2px 2px 3px rgba(0, 0, 0, 0.4)'; // Slightly darker shadow
    // Replace solid background with a gradient for a glossy effect
    this.bottomContainer.style.background = 'linear-gradient(to bottom, rgba(35, 45, 75, 0.9), rgba(29, 38, 55, 0.95))';
    this.bottomContainer.style.borderRadius = '20px'; // Rounded corners
    this.bottomContainer.style.padding = '6px 12px';
    this.bottomContainer.style.display = 'flex'; // Use flexbox for layout
    this.bottomContainer.style.alignItems = 'center';
    this.bottomContainer.style.gap = '5px'; // Space between items
    this.bottomContainer.style.zIndex = '999'; // Below the main log/settings
    this.bottomContainer.style.display = 'none'; // Initially hidden

    // Create collapsed error badge (red circle)
    this.errorButton = document.createElement('div');
    this.errorButton.style.width = '30px';
    this.errorButton.style.height = '30px';
    this.errorButton.style.borderRadius = '50%';
    // Slightly lighter red and less transparent
    this.errorButton.style.boxShadow = 'rgba(0, 0, 0, 0.5) 0px -1px 3px';
    this.errorButton.style.backgroundColor = 'rgba(255, 15, 61, 0.85)';
    this.errorButton.style.border = '2px solid rgb(52 63 84 / 80%)';
    this.errorButton.style.position = 'relative'; // For positioning the count badge
    this.errorButton.style.cursor = 'pointer';
    this.errorButton.style.display = 'flex'; // Center content
    this.errorButton.style.alignItems = 'center'; // Center content
    this.errorButton.style.justifyContent = 'center'; // Center content
    // Add a subtle shadow to make it look like a button
    this.errorButton.title = 'Show Errors';
    this.errorButton.id = 'show-error-viewer';

    // ADDED: Hover listener to the collapsed error badge to expand the log
    this.errorButton.addEventListener('mouseenter', () => {
      // Clear collapse timeout if mouse moves quickly back to trigger
      if (this.collapseTimeoutId) {
        clearTimeout(this.collapseTimeoutId);
        this.collapseTimeoutId = null;
      }
      this.isExpanded = true;
      this.updateStyle();
    });

    // Create error count badge INSIDE the collapsed badge
    this.errorCountBadge = document.createElement('span');
    this.errorCountBadge.textContent = '0';
    // Removed absolute positioning, flexbox handles centering now
    this.errorCountBadge.style.color = 'white';
    this.errorCountBadge.style.fontWeight = 'bold';
    this.errorCountBadge.style.fontSize = '12px'; // Match old collapsed style
    this.errorCountBadge.style.userSelect = 'none';

    if (this.errorButton) {
      this.errorButton.appendChild(this.errorCountBadge);
      this.bottomContainer.appendChild(this.errorButton); // Add badge to container
    }

    // Modify mouse leave listener for the expanded container
    if (this.floatingMenuDiv) {
      // Add mouseenter listener to clear timeout if user returns
      this.floatingMenuDiv.addEventListener('mouseenter', () => {
        if (this.collapseTimeoutId) {
          console.log('[FloatingMenu] Mouse re-entered expanded menu, clearing collapse timer.');
          clearTimeout(this.collapseTimeoutId);
          this.collapseTimeoutId = null;
        }
      });

      this.floatingMenuDiv.addEventListener('mouseleave', (_e: MouseEvent) => {
        // Clear any existing timeout first in case of rapid movements
        if (this.collapseTimeoutId) {
          clearTimeout(this.collapseTimeoutId);
        }

        // Don't collapse if settings view is open
        if (this.settingsView?.style.display !== 'none') {
          console.log('[FloatingMenu] Mouse left, but settings view is open. Not starting collapse timer.');
          return;
        }

        // Start collapse timer (1 second delay)
        console.log('[FloatingMenu] Mouse left expanded menu, starting 1s collapse timer.');
        this.collapseTimeoutId = window.setTimeout(() => {
          // Check again if settings opened during the timeout, if it's still expanded,
          // and if the mouse is NOT currently over the trigger area OR the expanded menu itself.
          const isHoveringTrigger = this.bottomContainer?.matches(':hover');
          const isHoveringExpandedMenu = this.floatingMenuDiv?.matches(':hover'); // Check if mouse returned to expanded menu

          if (
            this.settingsView?.style.display === 'none' &&
            this.isExpanded &&
            !isHoveringTrigger &&
            !isHoveringExpandedMenu // Don't collapse if mouse is back over the expanded menu
          ) {
            console.log('[FloatingMenu] Collapse timer finished, collapsing.');
            this.isExpanded = false;
            this.updateStyle();
          } else {
            console.log('[FloatingMenu] Collapse timer finished, but conditions not met (settings open, mouse back over trigger/menu, or no longer expanded). Aborting collapse.');
          }
          this.collapseTimeoutId = null; // Clear the ID after execution/check
        }, 500);
      });
    }

    // Create settings button (⚙)
    this.settingsButton = document.createElement('span');
    this.settingsButton.id = 'show-settings-viewer'; // Give it an ID
    this.settingsButton.textContent = '⚙';
    this.settingsButton.title = 'Settings';
    // Remove absolute positioning
    // this.settingsButton.style.position = 'absolute';
    // this.settingsButton.style.top = '28px';
    // this.settingsButton.style.right = '8px';
    this.settingsButton.style.cursor = 'pointer';
    // Make it look like the other buttons
    this.settingsButton.style.width = '10px';
    this.settingsButton.style.height = '10px';
    this.settingsButton.style.borderRadius = '50%';
    this.settingsButton.style.color = 'white';
    this.settingsButton.style.display = 'flex'; // Use flex for centering
    this.settingsButton.style.alignItems = 'center';
    this.settingsButton.style.justifyContent = 'center';
    this.settingsButton.style.fontSize = '16px'; // Match feedback button size
    this.settingsButton.style.fontWeight = 'bold'; // Match feedback button weight
    this.settingsButton.style.userSelect = 'none';
    // Add similar background/border/shadow
    this.settingsButton.style.boxShadow = 'rgba(0, 0, 0, 0.5) 0px -1px 1px';
    this.settingsButton.style.backgroundColor = 'rgba(100, 110, 130, 0.85)'; // Greyish background
    this.settingsButton.style.border = '2px solid rgb(52 63 84 / 80%)';
    // this.settingsButton.style.display = 'none'; // No longer initially hidden

    this.settingsButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSettingsView();
    });

    // Add mouseenter listener to settings button to clear collapse timeout
    this.settingsButton.addEventListener('mouseenter', () => {
      if (this.collapseTimeoutId) {
        console.log('[FloatingMenu] Mouse entered settings button, clearing collapse timer.');
        clearTimeout(this.collapseTimeoutId);
        this.collapseTimeoutId = null;
      }
    });

    // Create settings view
    this.settingsView = document.createElement('div');
    this.settingsView.style.position = 'fixed';
    this.settingsView.style.top = '50%';
    this.settingsView.style.left = '50%';
    this.settingsView.style.transform = 'translate(-50%, -50%)';
    this.settingsView.style.backgroundColor = '#282c34';
    this.settingsView.style.border = '1px solid #444';
    this.settingsView.style.borderRadius = '5px';
    this.settingsView.style.padding = '20px';
    this.settingsView.style.zIndex = '1050';
    this.settingsView.style.display = 'none';
    this.settingsView.style.color = '#abb2bf';
    this.settingsView.style.fontSize = '13px';
    this.settingsView.style.minWidth = '300px';
    this.settingsView.style.maxWidth = '90vw';
    this.settingsView.style.maxHeight = '80vh';
    this.settingsView.style.overflowY = 'auto';
    this.settingsView.style.boxShadow = '0 5px 15px rgba(0,0,0,0.3)';

    this.settingsView.addEventListener('click', (e) => e.stopPropagation());

    // Settings content
    const settingsTitle = document.createElement('h3');
    settingsTitle.textContent = 'Directory Settings';
    settingsTitle.style.marginTop = '0';
    settingsTitle.style.color = '#ffffff';
    this.settingsView.appendChild(settingsTitle);

    // Status message area
    this.settingsStatus = document.createElement('p');
    this.settingsStatus.style.margin = '0 0 10px 0';
    this.settingsStatus.style.fontSize = '12px';
    this.settingsStatus.style.minHeight = '1.2em';
    this.settingsStatus.style.color = '#999';
    this.settingsView.appendChild(this.settingsStatus);

    // Forget Directory Button
    const forgetButton = document.createElement('button');
    forgetButton.textContent = 'Forget Directory Access';
    this.styleSettingsButton(forgetButton);
    forgetButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      this.showSettingsStatus('Forgetting access...', 'info');
      await fileService.forgetDirectoryAccess((msg, type) => this.showSettingsStatus(msg, type));
    });
    this.settingsView.appendChild(forgetButton);

    // Change Directory Button
    const changeButton = document.createElement('button');
    changeButton.textContent = 'Change Directory';
    this.styleSettingsButton(changeButton);
    changeButton.style.marginTop = '8px';
    changeButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      this.showSettingsStatus('Requesting directory access...', 'info');
      this.hideSettingsView();
      await fileService.requestDirectoryAccess((msg, type) => {
        console.log(`[Directory Change Status - ${type.toUpperCase()}]: ${msg}`);
      });
    });
    this.settingsView.appendChild(changeButton);

    // Create "No warnings or errors" message
    this.noErrorsMessage = document.createElement('div');
    this.noErrorsMessage.textContent = 'No warnings or errors.';
    this.noErrorsMessage.style.padding = '8px';
    this.noErrorsMessage.style.color = '#aaa';
    this.noErrorsMessage.style.display = 'block'; // Show by default

    if (this.floatingMenuDiv) {
      this.floatingMenuDiv.appendChild(this.noErrorsMessage);
    }

    // Create Feedback button (?) -> Now SVG
    this.feedbackButton = document.createElement('span');
    this.feedbackButton.id = 'show-feedback-viewer';
    // Set innerHTML WITHOUT width/height attributes in the <svg> tag
    this.feedbackButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
      <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
      <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
      <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
      <circle cx="12" cy="12" r="4"/> <!-- Increased radius from 3 to 4 -->
      <path d="m16 16-1.5-1.5"/> <!-- Adjusted handle path slightly -->
    </svg>`;
    this.feedbackButton.title = 'Get feedback on design';
    this.feedbackButton.style.width = '30px'; // Keep button size
    this.feedbackButton.style.height = '30px'; // Keep button size
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
      screenCapture.startCapture((imageDataUrl) => {
        // Log: Callback executed
        console.log('[Feedback] Screen capture callback executed.');
        console.log('[Feedback] Image data URL received:', imageDataUrl ? imageDataUrl.substring(0, 50) + '...' : 'null');

        if (imageDataUrl) {
          console.log('[Feedback] Image data URL is valid. Showing input area...');
          try {
            feedbackViewer.showInputArea(imageDataUrl);
            console.log('[Feedback] Feedback input area shown.');
          } catch (viewerError) {
            console.error('[Feedback] Error showing feedback input area:', viewerError);
          }
        } else {
          console.warn('[Feedback] Screen capture cancelled or failed. No image data received.');
          // alert('Screen capture failed or was cancelled.');
        }
      });
    });

    // Add mouseenter listener to feedback button to clear collapse timeout
    this.feedbackButton.addEventListener('mouseenter', () => {
      if (this.collapseTimeoutId) {
        console.log('[FloatingMenu] Mouse entered feedback button, clearing collapse timer.');
        clearTimeout(this.collapseTimeoutId);
        this.collapseTimeoutId = null;
      }
    });

    // Add feedback button to the bottom container
    if (this.bottomContainer && this.feedbackButton) {
      this.bottomContainer.appendChild(this.feedbackButton);
    }

    // Add settings button to the bottom container AFTER feedback button
    if (this.bottomContainer && this.settingsButton) {
      this.bottomContainer.appendChild(this.settingsButton);
    }

    // Apply initial styles based on config
    this.updateStyle();

    // Append the elements once the DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (this.floatingMenuDiv) {
          document.body.appendChild(this.floatingMenuDiv);
        }
        if (this.settingsView) {
          document.body.appendChild(this.settingsView);
        }
        // Append the bottom container instead of the feedback button directly
        if (this.bottomContainer) {
          document.body.appendChild(this.bottomContainer);
        }
        // if (this.feedbackButton) { // No longer needed
        //   document.body.appendChild(this.feedbackButton);
        // }
      });
    } else {
      if (this.floatingMenuDiv) {
        document.body.appendChild(this.floatingMenuDiv);
      }
      if (this.settingsView) {
        document.body.appendChild(this.settingsView);
      }
      // Append the bottom container instead of the feedback button directly
      if (this.bottomContainer) {
        document.body.appendChild(this.bottomContainer);
      }
      // if (this.feedbackButton) { // No longer needed
      //   document.body.appendChild(this.feedbackButton);
      // }
    }
  }

  /** Helper to style settings buttons */
  private styleSettingsButton(button: HTMLButtonElement): void {
    button.style.display = 'block';
    button.style.width = '100%';
    button.style.padding = '8px 12px';
    button.style.fontSize = '13px';
    button.style.backgroundColor = '#4a76c7';
    button.style.color = 'white';
    button.style.border = '1px solid #3a5a9a';
    button.style.borderRadius = '4px';
    button.style.cursor = 'pointer';
    button.style.textAlign = 'center';
    button.style.transition = 'background-color 0.2s ease';

    button.onmouseover = () => button.style.backgroundColor = '#5a86d7';
    button.onmouseout = () => button.style.backgroundColor = '#4a76c7';
  }

  /** Show status message inside the settings view */
  private showSettingsStatus(message: string, type: 'info' | 'success' | 'error' | 'warning'): void {
    if (this.settingsStatus) {
      this.settingsStatus.textContent = message;
      switch (type) {
        case 'success': this.settingsStatus.style.color = '#98c379'; break;
        case 'error': this.settingsStatus.style.color = '#e06c75'; break;
        case 'warning': this.settingsStatus.style.color = '#e5c07b'; break;
        case 'info':
        default: this.settingsStatus.style.color = '#999'; break;
      }
    }
    console.log(`[Settings Status - ${type.toUpperCase()}]: ${message}`);
  }

  /** Toggle visibility of the settings view */
  private toggleSettingsView(): void {
    if (this.settingsView) {
      const isVisible = this.settingsView.style.display !== 'none';
      if (isVisible) {
        this.hideSettingsView();
      } else {
        this.showSettingsView();
      }
    }
  }

  /** Show the settings view */
  private showSettingsView(): void {
    if (this.settingsView && this.settingsStatus) {
      this.settingsView.style.display = 'block';

      // Get the current directory name
      const currentDirName = fileService.getCurrentDirectoryName();

      if (currentDirName) {
        this.settingsStatus.textContent = `Access granted to: ${currentDirName}`;
        this.settingsStatus.style.color = '#98c379';
      } else {
        this.settingsStatus.textContent = 'No directory access granted.';
        this.settingsStatus.style.color = '#999';
      }

      // --- Add click outside listener ---
      // Define the handler (if not already defined)
      if (!this.settingsOutsideClickHandler) {
        this.settingsOutsideClickHandler = (event: MouseEvent) => {
          // Check if the click is outside the settingsView element
          if (this.settingsView &&
              this.settingsView.style.display !== 'none' && // Only act if visible
              event.target instanceof Node && // Ensure target is a Node
              !this.settingsView.contains(event.target) && // Click is outside the view
              event.target !== this.settingsButton) { // Click is not the settings button itself
            console.log('[FloatingMenu] Click detected outside settings view. Closing.');
            this.hideSettingsView();
          }
        };
      }
      // Add the listener (use setTimeout to avoid capturing the click that opened it)
      setTimeout(() => {
        console.log('[FloatingMenu] Adding document listener for settings click outside.');
        document.addEventListener('mousedown', this.settingsOutsideClickHandler!);
      }, 0);
      // --- End add click outside listener ---
    }
  }

  /** Hide the settings view */
  private hideSettingsView(): void {
    if (this.settingsView) {
        this.settingsView.style.display = 'none';
    }
    // --- Remove click outside listener ---
    if (this.settingsOutsideClickHandler) {
      console.log('[FloatingMenu] Removing document listener for settings click outside.');
      document.removeEventListener('mousedown', this.settingsOutsideClickHandler);
      // Optional: Nullify the handler reference if you want it recreated each time
      // this.settingsOutsideClickHandler = null;
    }
    // --- End remove click outside listener ---
  }

  /**
   * Update the floating menu div's style based on its state.
   */
  private updateStyle(): void {
    if (!this.floatingMenuDiv || !this.bottomContainer) return;

    if (this.isExpanded) {
      // --- EXPANDED STATE ---
      // Hide the bottom container
      this.bottomContainer.style.display = 'none';

      // Show and style the main floating menu div
      this.floatingMenuDiv.style.display = 'block'; // Make sure it's visible
      // Reset all inline styles first to avoid style conflicts
      this.floatingMenuDiv.removeAttribute('style');
      // Ensure display is block after reset
      this.floatingMenuDiv.style.display = 'block';

      // Reapply all original styles
      for (const prop in this.originalStyle) {
        this.floatingMenuDiv.style[prop as any] = this.originalStyle[prop as keyof typeof this.originalStyle] as string;
      }

      if (this.errorList) {
        this.errorList.style.display = 'block';
      }

      // REMOVED: No longer adding settings button to expanded view
      // if (this.settingsButton && !this.floatingMenuDiv.contains(this.settingsButton)) {
      //   this.floatingMenuDiv.appendChild(this.settingsButton);
      // }

      if (this.settingsView && !this.floatingMenuDiv.contains(this.settingsView)) {
        // NOTE: Settings VIEW still needs to be appended somewhere.
        // Appending to body might be better if it's modal-like.
        // Let's keep it appended to the body during creation instead.
        // document.body.appendChild(this.settingsView); // Moved to create()
      }

      // REMOVED: Settings button display is handled by bottomContainer visibility now
      // if (this.settingsButton) {
      //   this.settingsButton.style.display = 'inline-block';
      // }

      // Show/hide no errors message based on error count
      if (this.noErrorsMessage) {
        this.noErrorsMessage.style.display = this.errorCount === 0 ? 'block' : 'none';
      }

    } else {
      // --- COLLAPSED STATE ---
      // Hide the main floating menu div
      this.floatingMenuDiv.style.display = 'none';
      // Ensure settings view is also hidden when collapsing
      this.hideSettingsView();

      // Show the bottom container
      this.bottomContainer.style.display = 'flex';

      // Update error count in the collapsed badge
      if (this.errorCountBadge) {
        this.errorCountBadge.textContent = this.errorCount.toString();
      }

    }

  }

  /**
   * Adds a new error to the log.
   */
  public addError(msg: string, errorInfo: ErrorInfo): void {
    this.errorCount++;

    // Hide the "No warnings or errors" message when errors exist
    if (this.noErrorsMessage) {
      this.noErrorsMessage.style.display = 'none';
    }

    // Generate a unique ID for this error
    const errorId = `error-${Date.now()}-${this.errorCount}`;
    errorSourceMap.set(errorId, errorInfo);

    if (this.errorList) {
      const li = document.createElement('li');

      // Create error message span (truncated) - Appended first
      const msgSpan = document.createElement('span');
      const truncatedMsg = truncateText(msg, this.config.maxMessageLength);
      msgSpan.textContent = truncatedMsg;
      // msgSpan.style.marginRight = '8px'; // Space handled by fileInfo margin now
      msgSpan.classList.add('error-message');
      // Allow message to take available space, pushing fileInfo/buttons right
      msgSpan.style.flexGrow = '1';
      msgSpan.style.wordBreak = 'break-word'; // Help with long words/paths

      li.appendChild(msgSpan); // Append message span first

      // Create and append file info span if filename exists (after message)
      if (errorInfo.fileName) {
        const fileInfo = document.createElement('span');
        fileInfo.textContent = `[${errorInfo.fileName.split('/').pop()}:${errorInfo.lineNumber || '?'}]`;
        fileInfo.style.color = '#aaa';
        fileInfo.style.fontSize = '10px';
        fileInfo.style.marginLeft = '8px'; // Space between message and file info
        fileInfo.style.marginRight = '8px'; // Space between file info and buttons
        fileInfo.style.whiteSpace = 'nowrap'; // Prevent wrapping
        fileInfo.style.flexShrink = '0'; // Prevent shrinking

        li.appendChild(fileInfo); // Append file info second
      }

      // Create a container for buttons ONLY
      const actionsContainer = document.createElement('div');
      actionsContainer.style.display = 'flex';
      actionsContainer.style.alignItems = 'center';
      // actionsContainer.style.marginLeft = 'auto'; // No longer needed, msgSpan pushes it
      actionsContainer.style.flexShrink = '0'; // Prevent shrinking

      // Add buttons if filename exists
      if (errorInfo.fileName) {
        // Create source code button
        const viewSourceBtn = document.createElement('button');
        viewSourceBtn.textContent = 'View Source';
        viewSourceBtn.style.marginRight = '4px'; // Space between buttons
        viewSourceBtn.style.fontSize = '10px';
        viewSourceBtn.style.padding = '4px 6px';
        viewSourceBtn.style.backgroundColor = '#555';
        viewSourceBtn.style.color = 'white';
        viewSourceBtn.style.border = 'none';
        viewSourceBtn.style.borderRadius = '3px';
        viewSourceBtn.style.cursor = 'pointer';
        viewSourceBtn.style.whiteSpace = 'nowrap'; // Prevent button text wrapping

        viewSourceBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showSource(errorId);
        });

        actionsContainer.appendChild(viewSourceBtn); // Add to actions container

        // Create "Fix with AI" button
        const fixWithAIBtn = document.createElement('button');
        fixWithAIBtn.textContent = 'Fix with AI';
        // fixWithAIBtn.style.marginRight = '8px'; // No margin needed after last button
        fixWithAIBtn.style.fontSize = '10px';
        fixWithAIBtn.style.padding = '4px 6px';
        fixWithAIBtn.style.backgroundColor = '#4a76c7';
        fixWithAIBtn.style.color = 'white';
        fixWithAIBtn.style.border = 'none';
        fixWithAIBtn.style.borderRadius = '3px';
        fixWithAIBtn.style.cursor = 'pointer';
        fixWithAIBtn.style.whiteSpace = 'nowrap'; // Prevent button text wrapping

        fixWithAIBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.getCodeFix(errorId);
        });

        actionsContainer.appendChild(fixWithAIBtn); // Add to actions container
      }

      // Only append actions container if it actually contains buttons
      if (actionsContainer.hasChildNodes()) {
        li.appendChild(actionsContainer); // Append the actions container last
      }

      // Style for the list item
      // li.style.marginBottom = '4px'; // Replaced by paddingBottom
      li.style.paddingBottom = '4px'; // Space below the border
      li.style.paddingTop = '4px'; // Space below the border
      li.style.borderBottom = '1px solid rgba(223, 223, 223, 0.2)'; // Light grey bottom border
      li.style.cursor = 'pointer';
      li.style.display = 'flex';
      li.style.alignItems = 'center'; // Vertically center items within the row
      li.style.justifyContent = 'flex-start'; // Align items to the start

      // Store the full message as a data attribute
      li.dataset.fullMessage = msg;
      li.dataset.errorId = errorId;

      // Add hover events for tooltip ONLY to the message span
      msgSpan.addEventListener('mouseover', (_e) => {
        if (msgSpan.textContent?.includes('...')) {
          const fullMessage = li.dataset.fullMessage || '';
          tooltip.show(fullMessage, msgSpan);
        }
      });

      msgSpan.addEventListener('mouseout', () => {
        tooltip.hide();
      });

      this.errorList.appendChild(li);
    }

    // Update error count badge (inside the collapsed badge)
    if (this.errorCountBadge) {
      this.errorCountBadge.textContent = this.errorCount.toString();
    }
    // Update style in case this is the first error and log was collapsed
    this.updateStyle();
  }

  /**
   * Shows the source code for an error.
   */
  public showSource(errorId: string): void {
    const errorInfo = errorSourceMap.get(errorId);
    if (errorInfo) {
      sourceViewer.show(errorInfo);
    }
  }

  /**
   * Gets an AI fix for an error.
   */
  private getCodeFix(errorId: string): void {
    const errorInfo = errorSourceMap.get(errorId);
    if (errorInfo) {
      fetchCodeFix(errorInfo);
    }
  }

  /**
   * Destroys the floating menu component, removing all DOM elements and event listeners.
   */
  public destroy(): void {
    // Clear any pending timeout
    if (this.collapseTimeoutId) {
      clearTimeout(this.collapseTimeoutId);
      this.collapseTimeoutId = null;
    }

    // Remove event listeners (cloning)
    if (this.settingsButton) this.settingsButton.replaceWith(this.settingsButton.cloneNode(true));
    if (this.settingsView) this.settingsView.replaceWith(this.settingsView.cloneNode(true));
    if (this.bottomContainer) this.bottomContainer.replaceWith(this.bottomContainer.cloneNode(true)); // Still clone container itself if needed
    if (this.floatingMenuDiv) this.floatingMenuDiv.replaceWith(this.floatingMenuDiv.cloneNode(true)); // Clones to remove mouseenter/mouseleave
    if (this.feedbackButton) this.feedbackButton.replaceWith(this.feedbackButton.cloneNode(true)); // Clones to remove click/mouseenter
    if (this.errorButton) this.errorButton.replaceWith(this.errorButton.cloneNode(true)); // Clones to remove mouseenter

    // Remove tooltip event listeners from all error message spans
    if (this.errorList) {
      this.errorList.querySelectorAll('.error-message').forEach(span => {
        span.replaceWith(span.cloneNode(true));
      });
      // Also remove listeners from source/AI buttons within list items if added dynamically
      this.errorList.querySelectorAll('li button').forEach(button => {
        button.replaceWith(button.cloneNode(true));
      });
    }

    // Remove the main div from the DOM (already cloned/replaced, remove original reference if needed)
    if (this.floatingMenuDiv?.parentNode) {
      this.floatingMenuDiv.parentNode.removeChild(this.floatingMenuDiv);
    }
    // Remove settings view from DOM (already cloned/replaced)
    if (this.settingsView?.parentNode) {
      this.settingsView.parentNode.removeChild(this.settingsView);
    }
    // Remove the bottom container from the DOM (already cloned/replaced)
    if (this.bottomContainer?.parentNode) {
      this.bottomContainer.parentNode.removeChild(this.bottomContainer);
    }

    // Nullify references
    this.floatingMenuDiv = null;
    this.errorList = null;
    this.errorCountBadge = null;
    this.settingsButton = null;
    this.settingsView = null;
    this.settingsStatus = null;
    this.noErrorsMessage = null;
    this.feedbackButton = null;
    this.bottomContainer = null;
    this.errorButton = null;
    this.originalStyle = {};
    errorSourceMap.clear();
    this.collapseTimeoutId = null;

    // --- Ensure listener is removed on destroy ---
    if (this.settingsOutsideClickHandler) {
      document.removeEventListener('mousedown', this.settingsOutsideClickHandler);
      this.settingsOutsideClickHandler = null;
    }
    // --- End ensure listener removal ---
  }
}