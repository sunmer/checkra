import { escapeHTML, createCloseButton } from './utils';
import { AIFixResponse, ErrorInfo } from '../types';
import { sourceCodeService } from '../services/source-code-service';

/**
 * Class for managing the content viewer for displaying AI fixes and other content.
 * Optimized for streaming markdown responses and improved source code display.
 */
export class ContentViewer {
  private element: HTMLDivElement | null = null;
  private issueContent: HTMLElement | null = null;
  private fixContent: HTMLElement | null = null;
  private originalSourceContent: HTMLElement | null = null;
  private codeExampleContent: HTMLElement | null = null;
  private outsideClickHandler: (e: MouseEvent) => void;
  private currentResponse: Partial<AIFixResponse> = {};
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
   * Creates or gets the content viewer DOM element.
   */
  public create(): HTMLDivElement {
    if (!this.element) {
      this.element = document.createElement('div');
      this.element.id = 'contentDiv';

      // Add styling
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

    return this.element;
  }

  /**
   * Shows loading state in the content viewer.
   */
  public showLoading(): void {
    const element = this.create();
    element.style.display = 'block';
    
    // Clear existing content and add loading message
    element.innerHTML = '<div style="text-align:center;">Loading AI suggestion...</div>';
    
    // Re-add close button
    const closeButton = createCloseButton(() => {
      this.hide();
    });
    element.appendChild(closeButton);
  }

  /**
   * Shows an error message in the content viewer.
   */
  public showError(error: Error | string): void {
    const element = this.create();
    element.style.display = 'block';
    element.innerHTML = `<div style="color:#ff6b6b;">Error: ${
      error instanceof Error ? error.message : String(error)
    }</div>`;
    
    // Re-add close button
    const closeButton = createCloseButton(() => {
      this.hide();
    });
    element.appendChild(closeButton);
  }

  /**
   * Initializes the content structure for streaming updates.
   * @param errorInfo Optional error information to use for fetching source code
   */
  public async initStreamStructure(errorInfo?: ErrorInfo): Promise<void> {
    const element = this.create();
    element.style.display = 'block';

    // Store error info for later use
    this.currentErrorInfo = errorInfo || null;

    // Initialize HTML structure
    const htmlContent = `
      <div id="issue-section" style="margin-bottom:15px;">
        <h4 style="color:#6ab0ff;margin-bottom:5px;font-size:14px;">Issue</h4>
        <p id="issue-content">Analyzing issue...</p>
      </div>
      <div id="fix-section" style="margin-bottom:15px;">
        <h4 style="color:#6ab0ff;margin-bottom:5px;font-size:14px;">Fix</h4>
        <ul id="fix-content" style="margin-top:5px;padding-left:20px;">
          <li>Analyzing possible solutions...</li>
        </ul>
      </div>
      <div id="original-source-section" style="margin-bottom:15px;">
        <h4 style="color:#6ab0ff;margin-bottom:5px;font-size:14px;">Original Source</h4>
        <pre id="original-source-content" style="background-color:#2d2d2d;padding:10px;border-radius:4px;overflow-x:auto;"><code>Loading original source code...</code></pre>
      </div>
      <div id="code-example-section">
        <h4 style="color:#6ab0ff;margin-bottom:5px;font-size:14px;">Code Example</h4>
        <pre id="code-example-content" style="background-color:#2d2d2d;padding:10px;border-radius:4px;overflow-x:auto;"><code>Generating code example...</code></pre>
      </div>
    `;
    element.innerHTML = htmlContent;

    // Store references to the content elements
    this.issueContent = document.getElementById('issue-content');
    this.fixContent = document.getElementById('fix-content');
    this.originalSourceContent = document.getElementById('original-source-content');
    this.codeExampleContent = document.getElementById('code-example-content');
    
    // Re-add close button
    const closeButton = createCloseButton(() => {
      this.hide();
    });
    element.appendChild(closeButton);
    
    // Reset current response
    this.currentResponse = {};

    // Update the original source if errorInfo is provided
    if (errorInfo && this.originalSourceContent) {
      await this.loadOriginalSource(errorInfo);
    }
  }

  /**
   * Loads and displays the original source code using sourceCodeService
   * @param errorInfo Error information to use for fetching source code
   */
  private async loadOriginalSource(errorInfo: ErrorInfo): Promise<void> {
    if (!this.originalSourceContent) return;

    try {
      // Show loading state
      this.originalSourceContent.innerHTML = '<code>Loading original source code...</code>';
      
      // Use sourceCodeService to fetch source code
      const sourceResult = await sourceCodeService.getSourceCode(errorInfo);
      
      if (sourceResult) {
        // Update the errorInfo with context from the service
        errorInfo.codeContext = sourceResult.codeContext;
        
        // Generate formatted HTML using the service
        const sourceHTML = sourceCodeService.generateSourceHTML(sourceResult);
        
        // Update the original source content
        this.originalSourceContent.innerHTML = sourceHTML;
        
        // Store the source code in the current response
        this.currentResponse.originalSource = sourceResult.sourceCode;
      } else {
        this.originalSourceContent.innerHTML = '<code>Source code not available</code>';
      }
    } catch (error) {
      this.originalSourceContent.innerHTML = `<code>Error loading source: ${error instanceof Error ? error.message : String(error)}</code>`;
    }
  }

  /**
   * Updates the viewer with an AIFixResponse object.
   * Can be called with partial data for streaming updates.
   */
  public updateWithResponse(response: Partial<AIFixResponse>): void {
    // Update the current response with new data
    this.currentResponse = { ...this.currentResponse, ...response };
    
    // Update individual sections if they exist in the response
    if (response.issue !== undefined) {
      this.updateIssue(response.issue);
    }
    
    if (response.fix !== undefined) {
      // Handle both string array and any other format
      if (Array.isArray(response.fix)) {
        this.updateFix(response.fix);
      } else {
        // Convert non-array fix to string and wrap in array
        this.updateFix([String(response.fix)]);
      }
    }
    
    if (response.originalSource !== undefined) {
      this.updateOriginalSource(response.originalSource);
    }
    
    if (response.codeExample !== undefined) {
      this.updateCodeExample(response.codeExample);
    }
  }

  /**
   * Updates issue content in the streaming UI.
   */
  public updateIssue(issue: string): void {
    if (this.issueContent) {
      this.issueContent.textContent = issue;
    }
    this.currentResponse.issue = issue;
  }

  /**
   * Updates fix content in the streaming UI.
   */
  public updateFix(fixArray: string[]): void {
    if (this.fixContent) {
      let fixHtml = '';
      fixArray.forEach((item) => {
        fixHtml += `<li style="margin-bottom:5px;">${escapeHTML(item)}</li>`;
      });
      this.fixContent.innerHTML = fixHtml;
    }
    this.currentResponse.fix = fixArray;
  }

  /**
   * Updates the original source code in the streaming UI using the source code service
   */
  public async updateOriginalSource(originalSource: string): Promise<void> {
    if (!this.originalSourceContent) return;
    
    if (this.currentErrorInfo) {
      try {
        // Create a source result object using the original source
        const sourceResult = {
          fileName: this.currentErrorInfo.fileName || 'unknown',
          sourceCode: originalSource,
          lines: originalSource.split('\n'),
          codeContext: originalSource,
          startLine: Math.max(0, (this.currentErrorInfo.lineNumber || 1) - 5),
          endLine: (this.currentErrorInfo.lineNumber || 1) + 5,
          lineNumber: this.currentErrorInfo.lineNumber || 1,
          message: this.currentErrorInfo.message
        };
        
        // Update errorInfo with the new code context
        this.currentErrorInfo.codeContext = originalSource;
        
        // Generate HTML using the service
        const sourceHTML = sourceCodeService.generateSourceHTML(sourceResult);
        this.originalSourceContent.innerHTML = sourceHTML;
      } catch (error) {
        // Fallback to simple escaped display if service fails
        this.originalSourceContent.innerHTML = `<code>${escapeHTML(originalSource.trim())}</code>`;
      }
    } else {
      // No error info, just do simple escaped display
      this.originalSourceContent.innerHTML = `<code>${escapeHTML(originalSource.trim())}</code>`;
    }
    
    this.currentResponse.originalSource = originalSource;
  }

  /**
   * Updates code example content in the streaming UI.
   */
  public updateCodeExample(codeExample: string): void {
    if (this.codeExampleContent) {
      // Remove any lingering markdown code block syntax
      let cleanCode = codeExample;
      
      // Remove backticks and language identifier from beginning if present
      if (cleanCode.startsWith('```')) {
        const firstNewline = cleanCode.indexOf('\n');
        if (firstNewline > 0) {
          cleanCode = cleanCode.substring(firstNewline + 1);
        } else {
          cleanCode = cleanCode.substring(3); // Just remove the opening backticks
        }
      }
      
      // Remove closing backticks if present
      if (cleanCode.endsWith('```')) {
        cleanCode = cleanCode.substring(0, cleanCode.length - 3);
      }
      
      // Trim any extra whitespace
      cleanCode = cleanCode.trim();
      
      // Use syntax highlighting if we can determine the language
      // For now, just use simple escaped HTML
      this.codeExampleContent.innerHTML = `<code>${escapeHTML(cleanCode)}</code>`;
    }
    this.currentResponse.codeExample = codeExample;
  }

  /**
   * Gets the current AIFixResponse object.
   */
  public getCurrentResponse(): Partial<AIFixResponse> {
    return { ...this.currentResponse };
  }

  /**
   * Hides the content viewer.
   */
  public hide(): void {
    if (this.element) {
      this.element.style.display = 'none';
    }
  }

  /**
   * Cleans up event listeners when no longer needed.
   */
  public destroy(): void {
    document.removeEventListener('mousedown', this.outsideClickHandler);
    
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
      this.element = null;
    }
    
    // Clear references
    this.issueContent = null;
    this.fixContent = null;
    this.originalSourceContent = null;
    this.codeExampleContent = null;
    this.currentErrorInfo = null;
    this.currentResponse = {};
  }
}

// Singleton instance
export const contentViewer = new ContentViewer();