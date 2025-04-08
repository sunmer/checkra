import { AIFixResponse } from '../types';
import { escapeHTML, createCloseButton } from './utils';

/**
 * Class for managing the content viewer for displaying AI fixes and other content.
 */
export class ContentViewer {
  private element: HTMLDivElement | null = null;
  private issueContent: HTMLElement | null = null;
  private fixContent: HTMLElement | null = null;
  private codeExampleContent: HTMLElement | null = null;
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
   * Creates or gets the content viewer DOM element.
   */
  public create(): HTMLDivElement {
    if (!this.element) {
      this.element = document.createElement('div');
      this.element.id = 'contentDiv';

      // Add some basic styling
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
  }

  /**
   * Updates issue content in the streaming UI.
   */
  public updateIssue(issue: string): void {
    if (this.issueContent) {
      this.issueContent.textContent = issue;
    }
  }

  /**
   * Updates fix content in the streaming UI.
   */
  public updateFix(fixArray: string[]): void {
    if (this.fixContent) {
      let fixHtml = '';
      fixArray.forEach(item => {
        fixHtml += `<li style="margin-bottom:5px;">${escapeHTML(item)}</li>`;
      });
      this.fixContent.innerHTML = fixHtml;
    }
  }

  /**
   * Updates code example content in the streaming UI.
   */
  public updateCodeExample(codeExample: string): void {
    if (this.codeExampleContent) {
      this.codeExampleContent.innerHTML = `<code>${escapeHTML(codeExample)}</code>`;
    }
  }

  /**
   * Updates the content viewer with the complete AIFixResponse.
   */
  public update(data: AIFixResponse): void {
    const element = this.create();
    element.style.display = 'block';

    let htmlContent = '';

    // Add "Issue" section if present
    if (data.issue) {
      htmlContent += `<div style="margin-bottom:15px;">
        <h4 style="color:#6ab0ff;margin-bottom:5px;">Issue</h4>
        <p>${escapeHTML(data.issue)}</p>
      </div>`;
    }

    // Add "Fix" section if present
    if (data.fix && Array.isArray(data.fix)) {
      htmlContent += `<div style="margin-bottom:15px;">
        <h4 style="color:#6ab0ff;margin-bottom:5px;">Fix</h4>
        <ul style="margin-top:5px;padding-left:20px;">`;
      
      data.fix.forEach(item => {
        htmlContent += `<li style="margin-bottom:5px;">${escapeHTML(item)}</li>`;
      });
      
      htmlContent += `</ul></div>`;
    } else if (data.fix) {
      htmlContent += `<div style="margin-bottom:15px;">
        <h4 style="color:#6ab0ff;margin-bottom:5px;">Fix</h4>
        <pre style="white-space:pre-wrap;margin:0;">${escapeHTML(String(data.fix))}</pre>
      </div>`;
    }

    // Add "Code Example" section if present
    if (data.codeExample) {
      htmlContent += `<div>
        <h4 style="color:#6ab0ff;margin-bottom:5px;">Code Example</h4>
        <pre style="background-color:#2d2d2d;padding:10px;border-radius:4px;overflow-x:auto;margin:0;">
          <code>${escapeHTML(data.codeExample)}</code>
        </pre>
      </div>`;
    }

    // Update the contentDiv with the new HTML content
    element.innerHTML = htmlContent;
    
    // Re-add close button
    const closeButton = createCloseButton(() => {
      if (this.element) {
        this.element.style.display = 'none';
      }
    });
    element.appendChild(closeButton);
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
export const contentViewer = new ContentViewer();