import { ErrorInfo } from '../types';
import { createCloseButton } from './utils';
import { tooltip } from './tooltip';
import { sourceCodeService } from '../services/source-code-service';
import { fileService } from '../services/file-service';
import { contentViewer } from './content-viewer';

/**
 * Class for managing the source code viewer functionality.
 */
export class SourceViewer {
  private element: HTMLDivElement | null = null;
  private outsideClickHandler: (e: MouseEvent) => void;
  private currentErrorInfo: ErrorInfo | null = null;

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
    this.element.style.fontSize = '12px';
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
    
    try {
      const sourceResult = await sourceCodeService.getSourceCode(errorInfo);
      
      if (!sourceResult) {
        this.element!.innerHTML = '<div>Source information not available</div>';
      } else {
        // Update the errorInfo with code context from the service
        errorInfo.codeContext = sourceResult.codeContext;
        
        // Generate HTML using the service
        const sourceHTML = sourceCodeService.generateSourceCodeHTML(sourceResult);
        this.element!.innerHTML = sourceHTML;
        
        // Re-add close button
        const closeButton = createCloseButton(() => {
          this.hide();
        });
        this.element!.appendChild(closeButton);
      }
    } catch (error) {
      this.element!.innerHTML = `<div>Error loading source: ${error instanceof Error ? error.message : String(error)}</div>`;
    }
    
    this.element!.style.display = 'block';
  }

  /**
   * Hides the source viewer.
   */
  public hide(): void {
    if (this.element) {
      this.element.style.display = 'none';
    }
    this.currentErrorInfo = null;
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
    this.currentErrorInfo = null;
  }
}

// Singleton instance
export const sourceViewer = new SourceViewer();