import { escapeHTML, createCloseButton } from './utils';
import { AIFixResponse } from '../types';

/**
 * Class for managing the content viewer for displaying AI fixes and other content.
 * Now optimized for streaming markdown responses.
 */
export class ContentViewer {
  private element: HTMLDivElement | null = null;
  private issueContent: HTMLElement | null = null;
  private fixContent: HTMLElement | null = null;
  private codeExampleContent: HTMLElement | null = null;
  private outsideClickHandler: (e: MouseEvent) => void;
  private currentResponse: Partial<AIFixResponse> = {};

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
  }

  /**
   * Initializes the content structure for streaming updates.
   */
  public initStreamStructure(): void {
    const element = this.create();
    element.style.display = 'block';

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
      <div id="code-example-section">
        <h4 style="color:#6ab0ff;margin-bottom:5px;font-size:14px;">Code Example</h4>
        <pre id="code-example-content" style="background-color:#2d2d2d;padding:10px;border-radius:4px;overflow-x:auto;"><code>Generating code example...</code></pre>
      </div>
    `;
    element.innerHTML = htmlContent;

    // Store references to the content elements
    this.issueContent = document.getElementById('issue-content');
    this.fixContent = document.getElementById('fix-content');
    this.codeExampleContent = document.getElementById('code-example-content');
    
    // Re-add close button
    const closeButton = createCloseButton(() => {
      this.hide();
    });
    element.appendChild(closeButton);
    
    // Reset current response
    this.currentResponse = {};
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
      fixArray.forEach((item, index) => {
        fixHtml += `<li style="margin-bottom:5px;">${escapeHTML(item)}</li>`;
      });
      this.fixContent.innerHTML = fixHtml;
    }
    this.currentResponse.fix = fixArray;
  }

  /**
   * Updates code example content in the streaming UI.
   */
  public updateCodeExample(codeExample: string): void {
    if (this.codeExampleContent) {
      // Remove any lingering markdown code block syntax
      let cleanCode = codeExample;
      
      // Remove backticks from beginning/end if they somehow made it through
      if (cleanCode.startsWith('```')) {
        // Find the first newline after the opening backticks
        const firstNewline = cleanCode.indexOf('\n');
        if (firstNewline > 0) {
          cleanCode = cleanCode.substring(firstNewline + 1);
        } else {
          cleanCode = cleanCode.substring(3); // Just remove the backticks
        }
      }
      
      if (cleanCode.endsWith('```')) {
        cleanCode = cleanCode.substring(0, cleanCode.length - 3);
      }
      
      this.codeExampleContent.innerHTML = `<code>${escapeHTML(cleanCode.trim())}</code>`;
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
  }
}

// Singleton instance
export const contentViewer = new ContentViewer();