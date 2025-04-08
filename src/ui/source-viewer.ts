import { ErrorInfo } from '../types';
import { escapeHTML, createCloseButton } from './utils';
import { tooltip } from './tooltip';

/**
 * Class for managing the source code viewer functionality.
 */
export class SourceViewer {
  private element: HTMLDivElement | null = null;
  private outsideClickHandler: (e: MouseEvent) => void;

  constructor() {
    // Handler for outside clicks
    this.outsideClickHandler = (e: MouseEvent) => {
      if (this.element && 
          this.element.style.display !== 'none' && 
          e.target instanceof Node && 
          !this.element.contains(e.target)) {
        this.hide();
      }
    };
  }

  /**
   * Creates the source viewer DOM element.
   */
  public create(): void {
    if (this.element) return;

    this.element = document.createElement('div');
    this.element.style.position = 'fixed';
    this.element.style.top = '50%';
    this.element.style.left = '50%';
    this.element.style.transform = 'translate(-50%, -50%)';
    this.element.style.backgroundColor = '#1e1e1e';
    this.element.style.color = '#d4d4d4';
    this.element.style.padding = '20px';
    this.element.style.borderRadius = '5px';
    this.element.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
    this.element.style.zIndex = '1002';
    this.element.style.maxWidth = '80%';
    this.element.style.maxHeight = '80%';
    this.element.style.overflowY = 'auto';
    this.element.style.fontFamily = 'monospace';
    this.element.style.fontSize = '14px';
    this.element.style.display = 'none';

    // Add close button
    const closeButton = createCloseButton(() => {
      this.hide();
    });
    this.element.appendChild(closeButton);
    document.body.appendChild(this.element);
    
    // Set up event listener for clicks outside the element
    document.addEventListener('mousedown', this.outsideClickHandler);
  }

  /**
   * Shows the source code viewer with the specified error information.
   */
  public async show(errorInfo: ErrorInfo): Promise<void> {
    // Hide tooltip when viewing source
    tooltip.hide();

    if (!this.element) this.create();
    
    if (!errorInfo || !errorInfo.fileName) {
      this.element!.innerHTML = '<div>Source information not available</div>';
      this.element!.style.display = 'block';
      return;
    }

    try {
      // Try to fetch the source file
      const response = await fetch(errorInfo.fileName);
      if (!response.ok) {
        throw new Error(`Failed to fetch source: ${response.status} ${response.statusText}`);
      }

      const sourceCode = await response.text();
      const lines = sourceCode.split('\n');

      // Create source view with line numbers
      let sourceHTML = '<div style="position:relative;">';
      sourceHTML += `<h3 style="margin-top:0;color:#ccc;">${errorInfo.fileName}</h3>`;
      sourceHTML += '<pre style="margin:0;padding-bottom:20px;"><code>';

      // Determine range of lines to show (context around the error)
      const lineNumber = errorInfo.lineNumber || 0;
      const startLine = Math.max(0, lineNumber - 5);
      const endLine = Math.min(lines.length, lineNumber + 5);

      // Extract the code context to include with error info
      const codeContext = lines.slice(startLine, endLine).join('\n');

      // Update errorInfo with the code context
      errorInfo.codeContext = codeContext;

      // Add line numbers and code
      for (let i = startLine; i < endLine; i++) {
        const lineNum = i + 1;
        const isErrorLine = lineNum === lineNumber;
        const lineStyle = isErrorLine ?
          'background-color:rgba(255,0,0,0.2);font-weight:bold;' : '';

        sourceHTML += `<div style="display:flex;${lineStyle}">`;
        sourceHTML += `<div style="color:#666;text-align:right;padding-right:10px;user-select:none;width:30px;">${lineNum}</div>`;
        sourceHTML += `<div style="white-space:pre;">${escapeHTML(lines[i] || '')}</div>`;
        sourceHTML += '</div>';
      }

      sourceHTML += '</code></pre>';

      // Add error message
      if (errorInfo.message) {
        sourceHTML += `<div style="color:#ff6b6b;margin-top:10px;">Error: ${escapeHTML(errorInfo.message)}</div>`;
      }

      this.element!.innerHTML = sourceHTML;
      
      // Re-add close button
      const closeButton = createCloseButton(() => {
        if (this.element) {
          this.element.style.display = 'none';
        }
      });
      this.element!.appendChild(closeButton);
      
      this.element!.style.display = 'block';
    } catch (error) {
      this.element!.innerHTML = `<div>Error loading source: ${error instanceof Error ? error.message : String(error)}</div>`;
      this.element!.style.display = 'block';
    }
  }

  /**
   * Hides the source viewer.
   */
  public hide(): void {
    if (this.element) {
      this.element.style.display = 'none';
    }
  }
  
  /**
   * Cleans up event listeners when no longer needed.
   * Should be called when the logger is being destroyed.
   */
  public destroy(): void {
    document.removeEventListener('mousedown', this.outsideClickHandler);
    
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
      this.element = null;
    }
  }
}

// Singleton instance
export const sourceViewer = new SourceViewer();