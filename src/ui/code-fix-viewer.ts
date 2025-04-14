import { escapeHTML } from './utils';
import { AIFixResponse, ErrorInfo } from '../types';
import { sourceCodeService } from '../services/source-code-service';
import { fileService } from '../services/file-service'; // Import the FileService
import { cleanCodeExample, copyToClipboard } from '../utils/code-utils';

/**
 * Class for managing the content viewer for displaying AI fixes and other content.
 * Optimized for streaming markdown responses and improved source code display.
 */
export class CodeFixViewer {
  private element: HTMLDivElement | null = null;
  private issueContent: HTMLElement | null = null;
  private fixContent: HTMLElement | null = null;
  private originalSourceContent: HTMLElement | null = null;
  private codeExampleContent: HTMLElement | null = null;
  private outsideClickHandler: (e: MouseEvent) => void;
  private currentResponse: Partial<AIFixResponse> = {};
  private currentErrorInfo: ErrorInfo | null = null;
  private applyButton: HTMLButtonElement | null = null;

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
  }

  /**
   * Shows an error message in the content viewer.
   */
  public showError(error: Error | string): void {
    const element = this.create();
    element.style.display = 'block';
    element.innerHTML = `<div style="color:#ff6b6b;">Error: ${error instanceof Error ? error.message : String(error)
      }</div>`;
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
        <h4 style="color:#6ab0ff;margin-bottom:5px;margin-top:0;font-size:14px;">Issue</h4>
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
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h4 style="color:#6ab0ff;margin-bottom:5px;font-size:14px;">Code Fix</h4>
          <button id="apply-fix-button" style="background-color:#0e639c;color:white;border:none;border-radius:3px;padding:5px 10px;cursor:pointer;font-size:14px;margin-left:10px;">Apply fix</button>
        </div>
        <pre id="code-example-content" style="background-color:#2d2d2d;padding:10px;border-radius:4px;overflow-x:auto;"><code>Generating code fix...</code></pre>
      </div>
    `;
    element.innerHTML = htmlContent;

    // Store references to the content elements
    this.issueContent = document.getElementById('issue-content');
    this.fixContent = document.getElementById('fix-content');
    this.originalSourceContent = document.getElementById('original-source-content');
    this.codeExampleContent = document.getElementById('code-example-content');
    this.applyButton = document.getElementById('apply-fix-button') as HTMLButtonElement;

    // Add event listener to apply button
    if (this.applyButton) {
      this.applyButton.addEventListener('click', () => this.applyCodeFix());
      // Initially disable the button until we have a code fix
      this.applyButton.disabled = true;
      this.applyButton.style.opacity = '0.5';
    }

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
        const sourceHTML = sourceCodeService.generateSourceCodeHTML(sourceResult);

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
        const sourceHTML = sourceCodeService.generateSourceCodeHTML(sourceResult);
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
   * Now with smart diff highlighting against the original source.
   */
  public updateCodeExample(codeExample: string): void {
    if (!this.codeExampleContent) return;

    // Clean up the code example using the fileService
    const cleanCode = cleanCodeExample(codeExample);

    // Check if we have original source to compare against
    const originalSource = this.currentResponse.originalSource;

    if (originalSource && cleanCode) {
      try {
        // Generate diff highlighted HTML
        const diffHtml = this.generateDiffHighlightedHTML(originalSource, cleanCode);
        this.codeExampleContent.innerHTML = diffHtml;
      } catch (error) {
        // Fallback to simple display if diff generation fails
        this.codeExampleContent.innerHTML = `<code>${escapeHTML(cleanCode)}</code>`;
        console.error('Error generating diff:', error);
      }
    } else {
      // No original source, just display the code example
      this.codeExampleContent.innerHTML = `<code>${escapeHTML(cleanCode)}</code>`;
    }

    this.currentResponse.codeExample = codeExample;

    // Enable the apply button now that we have a code fix
    if (this.applyButton && cleanCode) {
      this.applyButton.disabled = false;
      this.applyButton.style.opacity = '1';
    }
  }

  /**
   * Generates HTML with intelligent diff highlighting between original and modified code.
   * Preserves indentation while highlighting actual code changes.
   * Only the specific changes will get a green background.
   */
  private generateDiffHighlightedHTML(originalCode: string, modifiedCode: string): string {
    // For comparison, normalize the code (remove whitespace but keep track of original lines)
    const normalizeForComparison = (code: string): { normalized: string[], original: string[] } => {
      const original = code.split('\n').filter(line => line.trim().length > 0);
      const normalized = original.map(line => this.normalizeCodeLine(line));
      return { normalized, original };
    };

    const original = normalizeForComparison(originalCode);
    const modified = normalizeForComparison(modifiedCode);

    let diffHtml = '<pre style="margin:0;"><code style="display:block;">';

    // Process the modified code line by line
    for (let i = 0; i < modified.original.length; i++) {
      const modifiedLine = modified.original[i];
      const normalizedModifiedLine = modified.normalized[i];

      // Find if this line exists in original code (ignoring whitespace)
      const isNewOrChanged = !original.normalized.some(origLine =>
        this.compareCodeLines(origLine, normalizedModifiedLine)
      );

      // Apply green background only to new or changed lines
      const lineStyle = isNewOrChanged ?
        'background-color:rgba(0,128,0,0.2);' : '';

      // Add the line with proper indentation preserved
      diffHtml += `<div style="white-space:pre;${lineStyle}">${escapeHTML(modifiedLine)}</div>`;
    }

    diffHtml += '</code></pre>';
    return diffHtml;
  }

  /**
   * Normalizes a code line for comparison while preserving the original formatting
   */
  private normalizeCodeLine(line: string): string {
    return line.replace(/\s+/g, '') // Remove all whitespace
      .replace(/\/\/.*$/, ''); // Remove comments
  }

  /**
   * Compares two already normalized code lines.
   * @returns true if the lines are essentially the same code
   */
  private compareCodeLines(line1: string, line2: string): boolean {
    return line1 === line2;
  }

  /**
   * Applies the suggested code fix to the file within the selected directory.
   */
  private async applyCodeFix(): Promise<void> {
    if (!this.currentResponse.codeExample || !this.currentErrorInfo?.fileName) {
      this.showStatusMessage('Missing code example or file information.', 'error');
      return;
    }

    // Show initial status message including the filename
    const fileName = this.currentErrorInfo.fileName;
    this.showStatusMessage(`Applying fix to ${fileName}...`, 'info');

    // --- Ensure Directory Access ---
    const directoryHandle = await fileService.getDirectoryHandle(
        (message, type) => this.showStatusMessage(message, type) // Keep this for directory access errors/prompts
    );

    if (!directoryHandle) {
      // getDirectoryHandle already shows status messages for errors/cancellation
      this.showStatusMessage('Directory access is required to apply fixes automatically.', 'warning');
       // Optionally copy to clipboard as fallback
       if (this.currentResponse.codeExample) {
          const cleanCode = cleanCodeExample(this.currentResponse.codeExample);
          await copyToClipboard(cleanCode);
          this.showStatusMessage('Fix copied to clipboard.', 'info');
       }
      return;
    }
    // --- Directory Access Confirmed ---

    try {
      // Clean the suggested code *before* passing it
      const cleanCode = cleanCodeExample(this.currentResponse.codeExample);

      // --- Fetch the original source snippet (code context) ---
      let originalSourceSnippet = '';
      if (this.currentErrorInfo) {
          const sourceResult = await sourceCodeService.getSourceCode(this.currentErrorInfo);
          if (sourceResult && sourceResult.codeContext) {
              originalSourceSnippet = cleanCodeExample(sourceResult.codeContext);
          } else {
              this.showStatusMessage('Could not retrieve original code snippet for context matching.', 'warning');
          }
      } else {
           this.showStatusMessage('Missing error information to fetch code snippet.', 'warning');
           // We need errorInfo to proceed with applyCodeFix
           return; // Exit early if errorInfo is missing
      }
      // --- End fetching snippet ---

      // Ensure we have error info before calling applyCodeFix
      if (!this.currentErrorInfo) {
          this.showStatusMessage('Cannot apply fix: Missing error information.', 'error');
          return;
      }

      // Apply the fix using the directory handle and error info
      // FileService will handle getting the file handle and reading content
      const success = await fileService.applyCodeFix(
        this.currentErrorInfo, // <-- Pass ErrorInfo first
        originalSourceSnippet, // Pass the context snippet second
        cleanCode,             // Pass the cleaned AI suggestion third
        (message, type) => this.showStatusMessage(message, type) // Pass status callback for fileService messages
      );

      if (success) {
        // fileService.applyCodeFix or its delegates already show success messages
        // Optionally hide the viewer after success
        setTimeout(() => this.hide(), 2000);
      } else {
        // fileService.applyCodeFix or its delegates show error/warning messages
        // and handle clipboard copy as a fallback.
        this.showStatusMessage('Automatic fix application failed. See previous messages.', 'error');
        // Ensure it's copied if not done already by fileService
         await copyToClipboard(cleanCode);
         this.showStatusMessage('Fix copied to clipboard as a fallback.', 'info');
      }
    } catch (error) {
      // Catch unexpected errors during the process
      this.showStatusMessage(
        `Failed to apply code fix: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
      console.error('Apply fix error in CodeFixViewer:', error);

      // Try to copy to clipboard as fallback
      if (this.currentResponse.codeExample) {
        const cleanCode = cleanCodeExample(this.currentResponse.codeExample);
        await copyToClipboard(cleanCode);
        this.showStatusMessage('Fix copied to clipboard as fallback.', 'info');
      }
    }
  }

  /**
   * Shows a status message in the content viewer.
   */
  private showStatusMessage(message: string, type: 'info' | 'success' | 'error' | 'warning'): void {
    const colorMap = {
      info: '#6ab0ff',
      success: '#4CAF50',
      error: '#ff6b6b',
      warning: '#FFC107'
    };

    // Create a status container if it doesn't exist
    let statusContainer = document.getElementById('status-message-container');
    if (!statusContainer) {
      statusContainer = document.createElement('div');
      statusContainer.id = 'status-message-container';
      statusContainer.style.position = 'fixed';
      statusContainer.style.bottom = '20px';
      statusContainer.style.right = '20px';
      statusContainer.style.zIndex = '1005';
      document.body.appendChild(statusContainer);
    }

    // Create the status message element
    const statusElement = document.createElement('div');
    statusElement.style.backgroundColor = colorMap[type];
    statusElement.style.color = '#ffffff';
    statusElement.style.padding = '10px 15px';
    statusElement.style.borderRadius = '4px';
    statusElement.style.marginTop = '10px';
    statusElement.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    statusElement.style.transition = 'opacity 0.3s ease-in-out';
    statusElement.textContent = message;

    // Add to the container
    statusContainer.appendChild(statusElement);

    // Remove after delay
    setTimeout(() => {
      statusElement.style.opacity = '0';
      setTimeout(() => {
        if (statusContainer && statusElement.parentNode === statusContainer) {
          statusContainer.removeChild(statusElement);
        }
        // If no more messages, remove the container
        if (statusContainer && statusContainer.childNodes.length === 0) {
          document.body.removeChild(statusContainer);
        }
      }, 300);
    }, 3000);
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

    if (this.applyButton) {
      this.applyButton.removeEventListener('click', () => this.applyCodeFix());
    }

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
      this.element = null;
    }

    // Remove status container if it exists
    const statusContainer = document.getElementById('status-message-container');
    if (statusContainer && statusContainer.parentNode) {
      statusContainer.parentNode.removeChild(statusContainer);
    }

    // Clear references
    this.issueContent = null;
    this.fixContent = null;
    this.originalSourceContent = null;
    this.codeExampleContent = null;
    this.applyButton = null;
    this.currentErrorInfo = null;
    this.currentResponse = {};
  }
}

// Singleton instance
export const codeFixViewer = new CodeFixViewer();