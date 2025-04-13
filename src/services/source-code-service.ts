import { ErrorInfo } from '../types';
import { escapeHTML } from '../ui/utils';
import * as parser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';

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
   * Fetches source code based on error information.
   * Tries to identify the enclosing function for more precise context.
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
      const errorLineNumber = errorInfo.lineNumber || 0; // 1-based

      // Default context: +/- 5 lines around the error (1-based lines)
      let contextStartLine = Math.max(1, errorLineNumber - 5);
      let contextEndLine = Math.min(lines.length, errorLineNumber + 5);

      // --- Try to find the enclosing function using AST ---
      if (errorLineNumber > 0) {
          try {
            const ast = parser.parse(sourceCode, {
              sourceType: 'module',
              plugins: [ // Match plugins with AstProcessor or project needs
                'typescript',
                'jsx',
                'decorators-legacy',
                'classProperties',
                'exportDefaultFrom',
                'doExpressions',
                'optionalChaining',
                'nullishCoalescingOperator'
              ],
              errorRecovery: true, // Tolerate minor syntax errors
            });

            // --- Variables to store the function bounds ---
            let funcStartLine: number | null = null;
            let funcEndLine: number | null = null;
            let currentSmallestSize: number | null = null;
            // --- End variables ---

            traverse(ast, {
              enter(path) {
                if (!path.node.loc) return;

                const nodeStartLine = path.node.loc.start.line; // 1-based
                const nodeEndLine = path.node.loc.end.line;     // 1-based
                const nodeSize = nodeEndLine - nodeStartLine;

                // Check if the node contains the error line
                if (errorLineNumber >= nodeStartLine && errorLineNumber <= nodeEndLine) {
                  // Check if it's a function-like node
                  if (
                    path.isFunctionDeclaration() ||
                    path.isFunctionExpression() ||
                    path.isArrowFunctionExpression() ||
                    path.isObjectMethod() ||
                    path.isClassMethod()
                  ) {
                    // If we haven't found a function yet, or if this one is smaller
                    if (currentSmallestSize === null || nodeSize < currentSmallestSize) {
                      // --- Store the line numbers directly ---
                      funcStartLine = nodeStartLine;
                      funcEndLine = nodeEndLine;
                      currentSmallestSize = nodeSize;
                      // --- End storing line numbers ---
                    }
                  }
                }
              }
            });

            // --- Use the stored line numbers after traversal ---
            if (funcStartLine !== null && funcEndLine !== null) {
              contextStartLine = funcStartLine;
              contextEndLine = funcEndLine;
              console.log(`[SourceCodeService] Found containing function for line ${errorLineNumber}: Lines ${contextStartLine}-${contextEndLine}`);
            } else {
               console.log(`[SourceCodeService] Could not find specific function for line ${errorLineNumber}, using default +/- 5 lines context.`);
            }
            // --- End using stored line numbers ---

          } catch (parseError) {
            console.warn(`[SourceCodeService] AST parsing failed for ${errorInfo.fileName}, falling back to +/- 5 lines context:`, parseError);
            // Keep default context lines on parsing error
          }
      }
      // --- End AST analysis ---


      // Extract the code context based on the determined lines (1-based, inclusive)
      // Array slice uses 0-based indices, end exclusive.
      const finalStartLineIndex = contextStartLine - 1; // 0-based index
      const finalEndLineIndex = contextEndLine;         // 0-based exclusive index for slice

      const codeContext = lines.slice(finalStartLineIndex, finalEndLineIndex).join('\n');

      return {
        fileName: errorInfo.fileName,
        sourceCode, // Keep full source code available if needed elsewhere
        lines,      // All lines
        codeContext, // The extracted context (function or +/- 5 lines)
        startLine: finalStartLineIndex, // 0-based start line index for the context
        endLine: finalEndLineIndex,     // 0-based exclusive end line index for the context
        lineNumber: errorLineNumber,    // 1-based error line number
        message: errorInfo.message
      };
    } catch (error) {
      // Log the error and re-throw or return null/handle as appropriate
      console.error(`Error loading or processing source for ${errorInfo.fileName}:`, error);
      throw new Error(`Error loading or processing source: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generates HTML for source code display using the context defined in SourceCodeResult.
   */
  public generateSourceCodeHTML(result: SourceCodeResult): string {
    let sourceHTML = '<div style="position:relative;">';
    sourceHTML += `<h3 style="margin-top:0;color:#ccc;">${result.fileName} (Lines ${result.startLine + 1}-${result.endLine})</h3>`; // Show line range
    sourceHTML += '<pre style="margin:0;padding-bottom:20px;"><code>';

    // Use result.startLine and result.endLine which now define the context range
    for (let i = result.startLine; i < result.endLine; i++) {
      const lineNum = i + 1; // Display 1-based line number
      const isErrorLine = lineNum === result.lineNumber;
      const lineStyle = isErrorLine ?
        'background-color:rgba(255,0,0,0.2);font-weight:bold;' : '';

      sourceHTML += `<div style="display:flex;${lineStyle}">`;
      sourceHTML += `<div style="color:#666;text-align:right;padding-right:10px;user-select:none;width:40px;">${lineNum}</div>`; // Wider line number div
      sourceHTML += `<div style="white-space:pre;">${escapeHTML(result.lines[i] || '')}</div>`;
      sourceHTML += '</div>';
    }

    sourceHTML += '</code></pre>';

    // Add error message below the code block
    if (result.message && result.lineNumber) {
        sourceHTML += `<div style="color:#ff6b6b;margin-top:10px; padding-left: 50px;">Error on line ${result.lineNumber}: ${escapeHTML(result.message)}</div>`;
    } else if (result.message) {
        sourceHTML += `<div style="color:#ff6b6b;margin-top:10px;">Error: ${escapeHTML(result.message)}</div>`;
    }


    return sourceHTML;
  }

  /**
   * Generates plain source code with line numbers for the context defined in SourceCodeResult.
   * This is the string sent to the AI service.
   */
  public generateSourceCode(result: SourceCodeResult): string {
    // Use result.fileName which might include query parameters, consider cleaning it
    const cleanFileName = result.fileName.split('?')[0];
    let output = `File: ${cleanFileName}\n\n`;

    // Use result.startLine and result.endLine which now define the context range
    for (let i = result.startLine; i < result.endLine; i++) {
      const lineNum = i + 1; // 1-based line number
      const isErrorLine = lineNum === result.lineNumber;
      const linePrefix = isErrorLine ? '> ' : '  '; // Mark error line with '>'

      output += `${linePrefix}${lineNum}: ${result.lines[i] || ''}\n`;
    }

    // Add error information if available
    if (result.message && result.lineNumber) {
      output += `\nError at line ${result.lineNumber}: ${result.message}\n`;
    } else if (result.message) {
       output += `\nError: ${result.message}\n`;
    }

    return output;
  }
}

// Ensure the service is instantiated (assuming singleton pattern)
export const sourceCodeService = new SourceCodeService();