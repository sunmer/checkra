import { LoggerOptions, ErrorInfo } from '../types';
import { truncateText } from './utils';
import { tooltip } from './tooltip';
import { sourceViewer } from './source-viewer';
import { fetchAIFix } from '../services/ai-service';

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
  private isExpanded: boolean;
  private errorCount: number = 0;
  private originalStyle: Partial<CSSStyleDeclaration>;
  private config: LoggerOptions;
  private clickListener: (() => void) | null = null;

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
    this.closeButton.style.fontSize = '14px';
    this.closeButton.style.color = 'white';
    this.closeButton.style.userSelect = 'none';
    
    this.closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.isExpanded = false;
      this.updateStyle();
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
      });
    } else {
      if (this.errorLogDiv) {
        document.body.appendChild(this.errorLogDiv);
      }
    }
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

      // Hide error count in expanded state
      if (this.errorCountBadge) {
        this.errorCountBadge.style.display = 'none';
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

      // Show error count in collapsed state
      if (this.errorCountBadge) {
        this.errorCountBadge.style.display = 'block';
        this.errorCountBadge.textContent = this.errorCount.toString();
      }
    }
  }

  /**
   * Adds a new error to the log.
   */
  public addError(msg: string, errorInfo: ErrorInfo): void {
    this.errorCount++;
    
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
        viewSourceBtn.style.padding = '2px 4px';
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
        fixWithAIBtn.style.padding = '2px 4px';
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
    
    if (this.closeButton) {
      // Clone and replace to remove all event listeners
      const oldCloseButton = this.closeButton;
      this.closeButton = oldCloseButton.cloneNode(true) as HTMLSpanElement;
      if (oldCloseButton.parentNode) {
        oldCloseButton.parentNode.replaceChild(this.closeButton, oldCloseButton);
      }
    }

    // Remove tooltip event listeners from all error message spans
    if (this.errorList) {
      const errorMessages = this.errorList.querySelectorAll('.error-message');
      errorMessages.forEach(msgElem => {
        // Clone and replace to remove all event listeners
        const oldMsgElem = msgElem;
        const newMsgElem = oldMsgElem.cloneNode(true);
        if (oldMsgElem.parentNode) {
          oldMsgElem.parentNode.replaceChild(newMsgElem, oldMsgElem);
        }
      });
    }

    // Remove the error log div from the DOM
    if (this.errorLogDiv && this.errorLogDiv.parentNode) {
      this.errorLogDiv.parentNode.removeChild(this.errorLogDiv);
    }

    // Clear references
    this.errorLogDiv = null;
    this.errorList = null;
    this.errorCountBadge = null;
    this.closeButton = null;
    
    // Clear source map
    errorSourceMap.clear();
    
    // Reset error count
    this.errorCount = 0;
  }
}