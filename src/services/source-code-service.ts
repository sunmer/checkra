import { ErrorInfo } from '../types';
import { escapeHTML } from '../ui/utils';

/**
 * Interface for source code information
 */
export interface SourceCodeResult {
  fileName: string;
  sourceCode: string;
  lines: string[];
  codeContext: string;
  startLine: number;
  endLine: number;
  lineNumber: number;
  message?: string;
}

/**
 * Service for retrieving and processing source code
 */
export class SourceCodeService {
  /**
   * Fetches source code based on error information
   */
  public async getSourceCode(errorInfo: ErrorInfo): Promise<SourceCodeResult | null> {
    if (!errorInfo || !errorInfo.fileName) {
      return null;
    }

    try {
      // Try to fetch the source file
      const response = await fetch(errorInfo.fileName);
      if (!response.ok) {
        throw new Error(`Failed to fetch source: ${response.status} ${response.statusText}`);
      }

      const sourceCode = await response.text();
      const lines = sourceCode.split('\n');

      // Determine range of lines to show (context around the error)
      const lineNumber = errorInfo.lineNumber || 0;
      const startLine = Math.max(0, lineNumber - 5);
      const endLine = Math.min(lines.length, lineNumber + 5);

      // Extract the code context to include with error info
      const codeContext = lines.slice(startLine, endLine).join('\n');

      return {
        fileName: errorInfo.fileName,
        sourceCode,
        lines,
        codeContext,
        startLine,
        endLine,
        lineNumber,
        message: errorInfo.message
      };
    } catch (error) {
      throw new Error(`Error loading source: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generates HTML for source code display
   */
  public generateSourceHTML(result: SourceCodeResult): string {
    let sourceHTML = '<div style="position:relative;">';
    sourceHTML += `<h3 style="margin-top:0;color:#ccc;">${result.fileName}</h3>`;
    sourceHTML += '<pre style="margin:0;padding-bottom:20px;"><code>';

    // Add line numbers and code
    for (let i = result.startLine; i < result.endLine; i++) {
      const lineNum = i + 1;
      const isErrorLine = lineNum === result.lineNumber;
      const lineStyle = isErrorLine ?
        'background-color:rgba(255,0,0,0.2);font-weight:bold;' : '';

      sourceHTML += `<div style="display:flex;${lineStyle}">`;
      sourceHTML += `<div style="color:#666;text-align:right;padding-right:10px;user-select:none;width:30px;">${lineNum}</div>`;
      sourceHTML += `<div style="white-space:pre;">${escapeHTML(result.lines[i] || '')}</div>`;
      sourceHTML += '</div>';
    }

    sourceHTML += '</code></pre>';

    // Add error message
    if (result.message) {
      sourceHTML += `<div style="color:#ff6b6b;margin-top:10px;">Error: ${escapeHTML(result.message)}</div>`;
    }

    return sourceHTML;
  }

  /**
   * Generates plain source code with line numbers, filename etc for LLM analysis
   */
  public generateSourceCode(result: SourceCodeResult): string {
    let output = `File: ${result.fileName}\n\n`;
    
    // Add relevant code segment with line numbers
    for (let i = result.startLine; i < result.endLine; i++) {
      const lineNum = i + 1;
      const isErrorLine = lineNum === result.lineNumber;
      const linePrefix = isErrorLine ? '> ' : '  '; // Mark error line with '>'
      
      output += `${linePrefix}${lineNum}: ${result.lines[i] || ''}\n`;
    }
    
    // Add error information if available
    if (result.message) {
      output += `\nError at line ${result.lineNumber}: ${result.message}\n`;
    }
    
    return output;
  }
}

// Singleton instance
export const sourceCodeService = new SourceCodeService();