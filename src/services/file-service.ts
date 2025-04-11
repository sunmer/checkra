import { ErrorInfo } from '../types';

/**
 * Service for handling file operations and code fixes
 * Improved version with less strict validation and better TS support
 */
export class FileService {
  /**
   * Requests access to a file for modification
   * @param fileName File path to request access for (can be approximate)
   * @param statusCallback Optional callback to report status
   * @returns FileSystemFileHandle if access is granted, null otherwise
   */
  public async requestFileAccess(
    fileName: string,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<FileSystemFileHandle | null> {
    try {
      // Check if the File System Access API is available
      if (!('showOpenFilePicker' in window)) {
        statusCallback?.('File System Access API is not supported in this browser.', 'error');
        return null;
      }

      statusCallback?.('Please select the file to modify...', 'info');
      
      // Request the user to select the file with broader file type acceptance
      const [fileHandle] = await (window as any).showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'All Source Code Files',
            accept: {
              'text/javascript': ['.js', '.jsx', '.ts', '.tsx', '.html', '.css'],
              'text/html': ['.html'],
              'text/css': ['.css'],
              'text/typescript': ['.ts', '.tsx'],
              'application/json': ['.json']
            }
          }
        ]
      });

      // Get selected file info but don't be strict about the name
      const file = await fileHandle.getFile();
      const selectedFileName = file.name;

      // Extract just the file name from the full path for informational purposes
      const expectedFileName = fileName.split('/').pop() || fileName;
      
      // Show info about the file but don't warn explicitly
      if (selectedFileName !== expectedFileName) {
        statusCallback?.(
          `Selected file "${selectedFileName}" will be used instead of "${expectedFileName}".`,
          'info'
        );
      }

      statusCallback?.('File access granted.', 'success');
      return fileHandle;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        statusCallback?.('File selection was cancelled.', 'info');
      } else {
        statusCallback?.(
          `Error accessing file: ${error instanceof Error ? error.message : String(error)}`,
          'error'
        );
      }
      return null;
    }
  }

  /**
   * Applies a code fix to a file using block-aware replacement.
   *
   * @param fileHandle File handle to modify
   * @param originalFileContent Original file content as a single string
   * @param originalSourceSnippet Original source snippet (used for identification)
   * @param newCodeSnippet New code snippet to replace the original block
   * @param errorInfo Error information including line numbers and potentially function name
   * @param statusCallback Optional callback to report status
   * @returns Boolean indicating success
   */
  public async applyCodeFix(
    fileHandle: FileSystemFileHandle,
    originalFileContent: string,
    originalSourceSnippet: string,
    newCodeSnippet: string,
    errorInfo: ErrorInfo,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<boolean> {
    try {
      statusCallback?.('Preparing to apply code fix...', 'info');

      const cleanedNewCode = this.cleanCodeExample(newCodeSnippet);
      const cleanedOriginalSnippet = this.cleanCodeExample(originalSourceSnippet);
      const fileLines = originalFileContent.split('\n');
      const newCodeLines = cleanedNewCode.split('\n');

      // 1. Attempt to find the function/block based on signature and line number
      statusCallback?.('Attempting to locate target code block...', 'info');
      const targetRange = this.findCodeBlock(
          fileLines,
          cleanedOriginalSnippet,
          errorInfo.lineNumber || 1, // Use line number as a hint
          statusCallback
      );

      if (targetRange) {
        statusCallback?.(`Located target block from line ${targetRange.startLine + 1} to ${targetRange.endLine + 1}.`, 'info');

        // Perform the "delete then insert" replacement
        fileLines.splice(targetRange.startLine, targetRange.endLine - targetRange.startLine + 1, ...newCodeLines);

        const newContent = fileLines.join('\n');

        // Write updated content back to file
        const writable = await fileHandle.createWritable();
        await writable.write(newContent);
        await writable.close();

        statusCallback?.('Code fix successfully applied using block replacement!', 'success');
        return true;
      } else {
        statusCallback?.('Could not reliably locate the target code block for replacement.', 'warning');
      }

      // 2. Fallback: Try direct replacement (less reliable but might work for exact matches)
      if (originalFileContent.includes(cleanedOriginalSnippet)) {
        statusCallback?.('Falling back to direct string replacement...', 'info');
        const newContent = originalFileContent.replace(cleanedOriginalSnippet, cleanedNewCode);

        const writable = await fileHandle.createWritable();
        await writable.write(newContent);
        await writable.close();

        statusCallback?.('Code fix applied using direct replacement (less reliable).', 'success');
        return true;
      }


      // 3. Last Resort: Copy to clipboard
      statusCallback?.('Automatic replacement failed. Please apply the fix manually.', 'error');
      await this.copyToClipboard(cleanedNewCode);
      statusCallback?.('Code fix copied to clipboard.', 'warning');
      return false;

    } catch (error) {
      statusCallback?.(
        `Error applying code fix: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
      // Optionally copy to clipboard on error too
      if (newCodeSnippet) {
         await this.copyToClipboard(newCodeSnippet);
         statusCallback?.('New code copied to clipboard due to error.', 'warning');
      }
      return false;
    }
  }

  /**
   * Tries to find the start and end lines of a code block (e.g., function)
   * matching the provided snippet, using the line number as a hint.
   *
   * @param fileLines Array of lines from the original file
   * @param snippetLines The lines of the original code snippet (cleaned)
   * @param hintLineNumber The approximate line number where the original code was located (1-based)
   * @param statusCallback Optional callback
   * @returns Object with { startLine, endLine } (0-based indices) or null if not found
   */
  private findCodeBlock(
    fileLines: string[],
    originalSnippet: string,
    hintLineNumber: number,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): { startLine: number; endLine: number } | null {

    const snippetLines = originalSnippet.split('\n').filter(line => line.trim() !== '');
    if (snippetLines.length === 0) {
      statusCallback?.('Original snippet is empty, cannot locate block.', 'warning');
      return null;
    }

    // --- Strategy: Find function/block signature near the hint line ---

    // Try to extract a potential function name or signature start from the snippet
    const signaturePatterns = [
      /^(?:export\s+)?(?:async\s+)?function\s+([\w$]+)\s*\(|^const\s+([\w$]+)\s*=\s*(?:async\s*)?\(/, // function x( | const x = ( | const x = async (
      /^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*{/, // const x = {
      /^([\w$]+)\s*\(.*\)\s*{/, // myFunction() {
      /^(?:public|private|protected|static)?\s*([\w$]+)\s*\(.*\)\s*{/, // classMethod() {
      // Add more patterns if needed for different structures (e.g., class declarations)
    ];

    let potentialSignatureLine = snippetLines[0];
    let functionName: string | null = null;

    for (const pattern of signaturePatterns) {
        const match = potentialSignatureLine.match(pattern);
        // Find the first non-undefined capture group which should be the name
        if (match) {
            functionName = match.slice(1).find(name => name !== undefined) || null;
            break;
        }
    }

    // If no clear signature on the first line, try finding the first line with significant characters
    if (!functionName) {
        potentialSignatureLine = snippetLines.find(line => line.trim().length > 5) || snippetLines[0];
    }

    statusCallback?.(`Attempting to match signature starting like: "${potentialSignatureLine.substring(0, 50)}..." near line ${hintLineNumber}`, 'info');
    if(functionName) statusCallback?.(`Identified potential function name: "${functionName}"`, 'info');

    const searchRadius = 30; // How many lines above/below the hint to search
    const searchStart = Math.max(0, hintLineNumber - 1 - searchRadius); // 0-based index
    const searchEnd = Math.min(fileLines.length, hintLineNumber - 1 + searchRadius);

    let bestMatch: { startLine: number; endLine: number; score: number } | null = null;

    for (let i = searchStart; i < searchEnd; i++) {
      const currentLine = fileLines[i];

      // Check if the current line looks like the start of our snippet
      // Option 1: Match function name if identified
      // Option 2: Match the start of the potential signature line (trimmed)
      const trimmedCurrentLine = currentLine.trim();
      const trimmedSigLine = potentialSignatureLine.trim();

      let isPotentialStart = false;
      if (functionName && trimmedCurrentLine.includes(functionName) && (trimmedCurrentLine.includes('function') || trimmedCurrentLine.includes('=>') || trimmedCurrentLine.includes('=') || trimmedCurrentLine.includes(':'))) {
         isPotentialStart = true;
      } else if (!functionName && trimmedCurrentLine.startsWith(trimmedSigLine.substring(0, Math.min(trimmedSigLine.length, 15)))) {
         // Fallback: check if line starts similarly if no function name found
         isPotentialStart = true;
      } else if (this.calculateSimilarity(trimmedCurrentLine, trimmedSigLine) > 0.7) {
         // Fallback: check overall similarity for the first line
         isPotentialStart = true;
      }


      if (isPotentialStart) {
        // Found a potential start line. Now find the block end.
        const blockEnd = this.findMatchingBlockEnd(fileLines, i);

        if (blockEnd !== null) {
          // We found a complete block. Check its similarity to the original snippet.
          const blockContent = fileLines.slice(i, blockEnd + 1).join('\n');
          const similarity = this.calculateSimilarity(this.cleanCodeExample(blockContent), originalSnippet);

          statusCallback?.(`Potential block found (Lines ${i+1}-${blockEnd+1}). Similarity: ${similarity.toFixed(2)}`, 'info');

          // If this match is better than the previous best, store it
          if (similarity > 0.6 && (!bestMatch || similarity > bestMatch.score)) { // Threshold of 0.6 similarity
            bestMatch = { startLine: i, endLine: blockEnd, score: similarity };
          }
        }
      }
    }

    // If we found a good match, return it
    if (bestMatch) {
        statusCallback?.(`Selected best match block (Lines ${bestMatch.startLine + 1}-${bestMatch.endLine + 1}) with score ${bestMatch.score.toFixed(2)}.`, 'success');
        return { startLine: bestMatch.startLine, endLine: bestMatch.endLine };
    }

    statusCallback?.('Could not find a suitable block match based on signature and similarity.', 'warning');
    return null;
  }

  /**
   * Finds the line index of the matching closing brace '}' for an opening brace '{'
   * starting the search from potentialStartLine. Handles nested braces.
   * IMPORTANT: This is a simplified implementation and might fail with braces in comments or strings.
   *
   * @param fileLines Array of lines
   * @param potentialStartLine Index of the line where the block potentially starts (or contains the first '{')
   * @returns The 0-based index of the line containing the matching '}', or null if not found/unbalanced.
   */
  private findMatchingBlockEnd(fileLines: string[], potentialStartLine: number): number | null {
    let braceBalance = 0;
    let foundFirstBrace = false;
    let firstBraceLine = -1;

    for (let i = potentialStartLine; i < fileLines.length; i++) {
      const line = fileLines[i];
      // Rudimentary check to ignore braces in single-line comments
      const codePart = line.split('//')[0];

      // Find braces in the relevant part of the line
      for (let charIndex = 0; charIndex < codePart.length; charIndex++) {
         const char = codePart[charIndex];
          // Basic string detection (can be fooled by escaped quotes)
          if (char === '"' || char === "'" || char === '`') {
              const quote = char;
              charIndex++; // Move past opening quote
              while(charIndex < codePart.length) {
                  if (codePart[charIndex] === '\\') { // Skip escaped chars
                      charIndex++;
                  } else if (codePart[charIndex] === quote) { // Found closing quote
                      break;
                  }
                  charIndex++;
              }
              // Continue to next character after the string
              continue;
          }

        if (char === '{') {
          if (!foundFirstBrace) {
            foundFirstBrace = true;
            firstBraceLine = i; // Remember the line where the block *really* started (with '{')
          }
          braceBalance++;
        } else if (char === '}') {
          braceBalance--;
        }
      }

      // If we found the first brace and the balance returns to 0, this is the end line.
      // We must ensure balance goes positive first.
      if (foundFirstBrace && braceBalance === 0 && firstBraceLine !== -1) {
        return i; // Return the line index where balance returned to 0
      }

      // Safety break: If balance goes negative, braces are mismatched before our block.
      if (foundFirstBrace && braceBalance < 0) {
          // console.warn(`Brace imbalance detected near line ${i+1}. Aborting block search.`);
          return null;
      }
    }

    // If we reach the end of the file and balance isn't 0, something is wrong.
    // console.warn(`Reached end of file while searching for block end. Brace balance: ${braceBalance}`);
    return null;
  }

  // --- Keep existing helper methods ---

  /** Calculate similarity (simple whitespace/comment normalization) */
  private calculateSimilarity(str1: string, str2: string): number {
    const normalize = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '') // Remove comments
                                    .replace(/\s+/g, ' ') // Normalize whitespace
                                    .trim();
    const s1 = normalize(str1);
    const s2 = normalize(str2);
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;

    // Basic Levenshtein distance based similarity (could be improved)
    const levenshtein = (a: string, b: string): number => {
      if (a.length === 0) return b.length;
      if (b.length === 0) return a.length;
      const matrix = Array(a.length + 1).fill(0).map(() => Array(b.length + 1).fill(0));
      for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
      for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
      for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1, // deletion
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j - 1] + cost // substitution
          );
        }
      }
      return matrix[a.length][b.length];
    };

    const dist = levenshtein(s1, s2);
    const maxLen = Math.max(s1.length, s2.length);
    return maxLen === 0 ? 1 : 1 - dist / maxLen;
  }


  /** Clean code example */
  public cleanCodeExample(codeExample: string): string {
     if (!codeExample) return '';
     let cleanCode = codeExample.trim();
     cleanCode = cleanCode.replace(/^```[\w]*\n?/m, ''); // More robust ``` removal start
     cleanCode = cleanCode.replace(/\n?```$/m, '');      // More robust ``` removal end
     cleanCode = cleanCode.replace(/^\s*\d+[.:|]\s*/gm, ''); // Remove potential line numbers
     return cleanCode.trim();
  }

  /** Copy to clipboard */
  public async copyToClipboard(text: string): Promise<void> {
    if (!text) return;
    try {
        if (navigator.clipboard && window.isSecureContext) {
             await navigator.clipboard.writeText(text);
        } else {
            // Fallback for insecure contexts or older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed'; // Prevent scrolling to bottom
            textarea.style.opacity = '0';
            textarea.style.left = '-9999px';
            textarea.style.top = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            try {
                document.execCommand('copy');
            } catch (e) {
                console.error('Fallback clipboard copy failed:', e);
                throw new Error('Clipboard copy failed'); // Re-throw for caller
            }
            document.body.removeChild(textarea);
        }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Don't necessarily throw here, maybe just log the error.
      // Let the calling function decide how to handle clipboard failure.
    }
  }

}

// Export singleton instance
export const fileService = new FileService();