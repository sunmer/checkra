import { LoggerOptions, ErrorInfo } from '../types';
import { truncateText } from './utils';
import { tooltip } from './tooltip';
import { sourceViewer } from './source-viewer';
import { fetchAIFix } from '../services/ai-service';
import { fileService } from '../services/file-service';
import { screenCapture } from './screen-capture';
import { feedbackViewer } from './feedback-viewer';

// Create a centralized source map that can be imported by other files
export const errorSourceMap = new Map<string, ErrorInfo>();

/**
 * Class for managing the error log UI component.
 */
export class ErrorLog {
  private errorLogDiv: HTMLElement | null = null;
  private errorList: HTMLUListElement | null = null;
  private errorCountBadge: HTMLSpanElement | null = null;
  private closeButton: HTMLSpanElement | null = null;
  private settingsButton: HTMLSpanElement | null = null;
  private settingsView: HTMLDivElement | null = null;
  private settingsCloseButton: HTMLSpanElement | null = null;
  private settingsStatus: HTMLParagraphElement | null = null;
  private isExpanded: boolean;
  private errorCount: number = 0;
  private originalStyle: Partial<CSSStyleDeclaration>;
  private config: LoggerOptions;
  private clickListener: (() => void) | null = null;
  private noErrorsMessage: HTMLElement | null = null;
  private feedbackButton: HTMLSpanElement | null = null;

  /**
   * Creates a new ErrorLog instance.
   */
  constructor(config: LoggerOptions, originalStyle: Partial<CSSStyleDeclaration>) {
    this.config = config;
    this.originalStyle = originalStyle;
    this.isExpanded = !config.startCollapsed;
    this.create();
  }

  /**
   * Creates the error log DOM elements.
   */
  private create(): void {
    // Create error log div
    this.errorLogDiv = document.createElement('div');
    this.errorLogDiv.id = this.config.errorLogDivId || 'error-log';

    // Create error list
    this.errorList = document.createElement('ul');
    this.errorList.style.margin = '0';
    this.errorList.style.padding = '0';
    this.errorList.style.listStyleType = 'disc'; // Bullet points

    if (this.errorLogDiv) {
      this.errorLogDiv.appendChild(this.errorList);
    }

    // Create error count badge for the collapsed state
    this.errorCountBadge = document.createElement('span');
    this.errorCountBadge.textContent = '0';
    this.errorCountBadge.style.position = 'absolute';
    this.errorCountBadge.style.top = '50%';
    this.errorCountBadge.style.left = '50%';
    this.errorCountBadge.style.transform = 'translate(-50%, -50%)';
    this.errorCountBadge.style.color = 'white';
    this.errorCountBadge.style.fontWeight = 'bold';
    
    if (this.errorLogDiv) {
      this.errorLogDiv.appendChild(this.errorCountBadge);
    }

    // Create a close button for the expanded state
    this.closeButton = document.createElement('span');
    this.closeButton.textContent = '×';
    this.closeButton.style.position = 'absolute';
    this.closeButton.style.top = '4px';
    this.closeButton.style.right = '8px';
    this.closeButton.style.cursor = 'pointer';
    this.closeButton.style.fontSize = '18px';
    this.closeButton.style.color = 'white';
    this.closeButton.style.userSelect = 'none';
    
    this.closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.isExpanded = false;
      this.updateStyle();
      this.hideSettingsView();
    });

    // Create settings button (⚙️)
    this.settingsButton = document.createElement('span');
    this.settingsButton.textContent = '⚙️';
    this.settingsButton.title = 'Settings';
    this.settingsButton.style.position = 'absolute';
    this.settingsButton.style.top = '28px';
    this.settingsButton.style.right = '8px';
    this.settingsButton.style.cursor = 'pointer';
    this.settingsButton.style.fontSize = '14px';
    this.settingsButton.style.color = 'white';
    this.settingsButton.style.userSelect = 'none';
    this.settingsButton.style.display = 'none';

    this.settingsButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSettingsView();
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
    this.settingsView.style.paddingTop = '40px';
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

    // Create close button for settings view
    this.settingsCloseButton = document.createElement('span');
    this.settingsCloseButton.textContent = '×';
    this.settingsCloseButton.style.position = 'absolute';
    this.settingsCloseButton.style.top = '10px';
    this.settingsCloseButton.style.right = '15px';
    this.settingsCloseButton.style.fontSize = '24px';
    this.settingsCloseButton.style.color = '#abb2bf';
    this.settingsCloseButton.style.cursor = 'pointer';
    this.settingsCloseButton.style.fontWeight = 'bold';
    this.settingsCloseButton.style.lineHeight = '1';
    this.settingsCloseButton.addEventListener('click', () => this.hideSettingsView());
    this.settingsView.appendChild(this.settingsCloseButton);

    // Settings content
    const settingsTitle = document.createElement('h3');
    settingsTitle.textContent = 'Directory Settings';
    settingsTitle.style.marginTop = '0';
    settingsTitle.style.marginBottom = '15px';
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
    
    if (this.errorLogDiv) {
      this.errorLogDiv.appendChild(this.noErrorsMessage);
    }

    // Create Feedback button (?)
    this.feedbackButton = document.createElement('span');
    this.feedbackButton.id = 'feedback-log';
    this.feedbackButton.textContent = '?';
    this.feedbackButton.title = 'Send Feedback';
    this.feedbackButton.style.position = 'fixed';
    this.feedbackButton.style.bottom = '10px';
    this.feedbackButton.style.left = '50px';
    this.feedbackButton.style.width = '30px';
    this.feedbackButton.style.height = '30px';
    this.feedbackButton.style.borderRadius = '50%';
    this.feedbackButton.style.backgroundColor = 'rgba(0, 100, 255, 0.8)';
    this.feedbackButton.style.color = 'white';
    this.feedbackButton.style.display = 'flex';
    this.feedbackButton.style.alignItems = 'center';
    this.feedbackButton.style.justifyContent = 'center';
    this.feedbackButton.style.fontSize = '16px';
    this.feedbackButton.style.fontWeight = 'bold';
    this.feedbackButton.style.cursor = 'pointer';
    this.feedbackButton.style.zIndex = '1000';
    this.feedbackButton.style.userSelect = 'none';

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

    // Apply initial styles based on config
    this.updateStyle();

    // When clicking the error log div, toggle its state
    this.clickListener = () => {
      if (!this.isExpanded) {
        this.isExpanded = true;
        this.updateStyle();
      }
    };
    
    if (this.errorLogDiv) {
      this.errorLogDiv.addEventListener('click', this.clickListener);
    }

    // Append the error log div once the DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (this.errorLogDiv) {
          document.body.appendChild(this.errorLogDiv);
        }
        if (this.settingsView) {
          document.body.appendChild(this.settingsView);
        }
        if (this.feedbackButton) {
          document.body.appendChild(this.feedbackButton);
        }
      });
    } else {
      if (this.errorLogDiv) {
        document.body.appendChild(this.errorLogDiv);
      }
      if (this.settingsView) {
        document.body.appendChild(this.settingsView);
      }
      if (this.feedbackButton) {
        document.body.appendChild(this.feedbackButton);
      }
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
    if (this.settingsView) this.settingsView.style.display = 'block';
    this.showSettingsStatus('', 'info');
  }

  /** Hide the settings view */
  private hideSettingsView(): void {
    if (this.settingsView) this.settingsView.style.display = 'none';
  }

  /**
   * Update the error log div's style based on its state.
   */
  private updateStyle(): void {
    if (!this.errorLogDiv) return;

    if (this.isExpanded) {
      // Reset all inline styles first to avoid style conflicts
      this.errorLogDiv.removeAttribute('style');

      // Reapply all original styles
      for (const prop in this.originalStyle) {
        this.errorLogDiv.style[prop as any] = this.originalStyle[prop as keyof typeof this.originalStyle] as string;
      }

      if (this.errorList) {
        this.errorList.style.display = 'block';
      }

      if (this.closeButton && !this.errorLogDiv.contains(this.closeButton)) {
        this.errorLogDiv.appendChild(this.closeButton);
      }

      if (this.settingsButton && !this.errorLogDiv.contains(this.settingsButton)) {
        this.errorLogDiv.appendChild(this.settingsButton);
      }

      if (this.settingsView && !this.errorLogDiv.contains(this.settingsView)) {
        this.errorLogDiv.appendChild(this.settingsView);
      }

      if (this.settingsButton) {
        this.settingsButton.style.display = 'inline-block';
      }

      // Hide error count in expanded state
      if (this.errorCountBadge) {
        this.errorCountBadge.style.display = 'none';
      }

      // Show/hide no errors message based on error count
      if (this.noErrorsMessage) {
        this.noErrorsMessage.style.display = this.errorCount === 0 ? 'block' : 'none';
      }
    } else {
      // Collapsed: shrink into a small circle at the bottom left.
      // Reset styles first to avoid conflicts
      this.errorLogDiv.removeAttribute('style');

      // Apply collapsed styles
      this.errorLogDiv.style.position = 'fixed';
      this.errorLogDiv.style.bottom = '10px';
      this.errorLogDiv.style.left = '10px';
      this.errorLogDiv.style.right = 'auto';
      this.errorLogDiv.style.width = '30px';
      this.errorLogDiv.style.height = '30px';
      this.errorLogDiv.style.borderRadius = '50%';
      this.errorLogDiv.style.padding = '0';
      this.errorLogDiv.style.overflow = 'hidden';
      this.errorLogDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
      this.errorLogDiv.style.fontSize = '12px';
      this.errorLogDiv.style.cursor = 'pointer';
      this.errorLogDiv.style.zIndex = '1000'; // Preserve z-index from original style

      if (this.errorList) {
        this.errorList.style.display = 'none';
      }

      // Remove the close button
      if (this.closeButton && this.errorLogDiv.contains(this.closeButton)) {
        this.errorLogDiv.removeChild(this.closeButton);
      }

      // Remove the settings button
      if (this.settingsButton && this.errorLogDiv.contains(this.settingsButton)) {
        this.errorLogDiv.removeChild(this.settingsButton);
      }

      // Remove the settings view and ensure it's hidden
      this.hideSettingsView();

      // Show error count in collapsed state
      if (this.errorCountBadge) {
        this.errorCountBadge.style.display = 'block';
        this.errorCountBadge.textContent = this.errorCount.toString();
      }

      // Hide no errors message in collapsed state
      if (this.noErrorsMessage) {
        this.noErrorsMessage.style.display = 'none';
      }
    }

    // The feedback button has fixed positioning, so it doesn't need
    // to change based on the error log's expanded/collapsed state.
    // Ensure it remains visible if it was created.
    if (this.feedbackButton) {
      this.feedbackButton.style.display = 'flex';
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

      // Create error message span (truncated)
      const msgSpan = document.createElement('span');
      const truncatedMsg = truncateText(msg, this.config.maxMessageLength);
      msgSpan.textContent = truncatedMsg;
      msgSpan.style.marginRight = '8px';
      msgSpan.classList.add('error-message');
      li.appendChild(msgSpan);

      // Add source code link if filename exists
      if (errorInfo.fileName) {
        const fileInfo = document.createElement('span');
        fileInfo.textContent = `[${errorInfo.fileName.split('/').pop()}:${errorInfo.lineNumber || '?'}]`;
        fileInfo.style.color = '#aaa';
        fileInfo.style.fontSize = '10px';
        li.appendChild(fileInfo);

        // Create source code button
        const viewSourceBtn = document.createElement('button');
        viewSourceBtn.textContent = 'View Source';
        viewSourceBtn.style.marginLeft = '8px';
        viewSourceBtn.style.fontSize = '10px';
        viewSourceBtn.style.padding = '4px 6px';
        viewSourceBtn.style.backgroundColor = '#555';
        viewSourceBtn.style.color = 'white';
        viewSourceBtn.style.border = 'none';
        viewSourceBtn.style.borderRadius = '3px';
        viewSourceBtn.style.cursor = 'pointer';

        viewSourceBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showSource(errorId);
        });

        li.appendChild(viewSourceBtn);

        // Create "Fix with AI" button
        const fixWithAIBtn = document.createElement('button');
        fixWithAIBtn.textContent = 'Fix with AI';
        fixWithAIBtn.style.marginLeft = '8px';
        fixWithAIBtn.style.fontSize = '10px';
        fixWithAIBtn.style.padding = '4px 6px';
        fixWithAIBtn.style.backgroundColor = '#4a76c7';
        fixWithAIBtn.style.color = 'white';
        fixWithAIBtn.style.border = 'none';
        fixWithAIBtn.style.borderRadius = '3px';
        fixWithAIBtn.style.cursor = 'pointer';

        fixWithAIBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.getAIFix(errorId);
        });

        li.appendChild(fixWithAIBtn);
      }

      // Style for the list item
      li.style.marginBottom = '4px';
      li.style.cursor = 'pointer';
      li.style.display = 'flex';
      li.style.alignItems = 'center';

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

    // Update error count badge
    if (this.errorCountBadge) {
      this.errorCountBadge.textContent = this.errorCount.toString();
    }
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
  private getAIFix(errorId: string): void {
    const errorInfo = errorSourceMap.get(errorId);
    if (errorInfo) {
      fetchAIFix(errorInfo);
    }
  }

  /**
   * Destroys the error log component, removing all DOM elements and event listeners.
   */
  public destroy(): void {
    // Remove event listeners
    if (this.errorLogDiv && this.clickListener) {
      this.errorLogDiv.removeEventListener('click', this.clickListener);
      this.clickListener = null;
    }
    
    // Remove button listeners (cloning)
    if (this.closeButton) this.closeButton.replaceWith(this.closeButton.cloneNode(true));
    if (this.settingsButton) this.settingsButton.replaceWith(this.settingsButton.cloneNode(true));
    if (this.settingsView) this.settingsView.replaceWith(this.settingsView.cloneNode(true));

    // Remove tooltip event listeners from all error message spans
    if (this.errorList) {
      this.errorList.querySelectorAll('.error-message').forEach(span => {
        span.replaceWith(span.cloneNode(true));
      });
    }

    // Remove the main div from the DOM
    if (this.errorLogDiv && this.errorLogDiv.parentNode) {
      this.errorLogDiv.parentNode.removeChild(this.errorLogDiv);
    }
    // Remove settings view from DOM
    if (this.settingsView && this.settingsView.parentNode) {
      this.settingsView.parentNode.removeChild(this.settingsView);
    }

    // Remove feedback button and its listener
    if (this.feedbackButton) {
      this.feedbackButton.replaceWith(this.feedbackButton.cloneNode(true));
      if (this.feedbackButton.parentNode) {
        this.feedbackButton.parentNode.removeChild(this.feedbackButton);
      }
      this.feedbackButton = null;
    }

    // Nullify references
    this.errorLogDiv = null;
    this.errorList = null;
    this.errorCountBadge = null;
    this.closeButton = null;
    this.settingsButton = null;
    this.settingsView = null;
    this.settingsCloseButton = null;
    this.settingsStatus = null;
    this.noErrorsMessage = null;
    this.originalStyle = {};
    errorSourceMap.clear();
  }
}