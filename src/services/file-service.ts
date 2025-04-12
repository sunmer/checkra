import { ErrorInfo } from '../types';
import { AstProcessor } from '../core/ast-processor';
import { cleanCodeExample, copyToClipboard } from '../utils/code-utils';

/**
 * Service for handling file operations and code fixes
 */
export class FileService {
  private astProcessor: AstProcessor;

  constructor() {
    this.astProcessor = new AstProcessor();
  }

  /**
   * Requests access to a file for modification
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
              'text/javascript': ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
              'text/typescript': ['.ts', '.tsx'],
              'application/json': ['.json'], // Keep JSON simple for now
              'text/html': ['.html'], // HTML/CSS won't use Babel
              'text/css': ['.css'],
            }
          }
        ]
      });

      // Get selected file info
      const file = await fileHandle.getFile();
      const selectedFileName = file.name;

      // Extract just the file name from the full path for informational purposes
      const expectedFileName = fileName.split('/').pop() || fileName;

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
   * Applies a code fix to a file using Babel AST manipulation.
   */
  public async applyCodeFix(
    fileHandle: FileSystemFileHandle,
    originalFileContent: string,
    originalSourceSnippet: string,
    newCodeSnippet: string,
    errorInfo: ErrorInfo,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<boolean> {
    const fileName = fileHandle.name;
    const isJsTsFile = /\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(fileName);

    // If not a JS/TS file, fall back to simple replacement or clipboard
    if (!isJsTsFile) {
      statusCallback?.(`File type (${fileName}) not supported by Babel. Attempting direct replacement.`, 'warning');
      return this.applySimpleFix(fileHandle, originalFileContent, originalSourceSnippet, newCodeSnippet, statusCallback);
    }

    const cleaned = cleanCodeExample(newCodeSnippet);
    return await this.astProcessor.processCodeFix(
      fileHandle,
      originalFileContent,
      originalSourceSnippet, 
      cleaned,
      errorInfo,
      statusCallback
    );
  }

  /**
   * Applies a code fix using simple string replacement (fallback).
   */
  private async applySimpleFix(
    fileHandle: FileSystemFileHandle,
    originalFileContent: string,
    originalSourceSnippet: string,
    newCodeSnippet: string,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<boolean> {
    const cleanedNewCode = cleanCodeExample(newCodeSnippet);
    const cleanedOriginalSnippet = cleanCodeExample(originalSourceSnippet);

    if (!cleanedOriginalSnippet) {
      statusCallback?.('Original snippet is empty, cannot perform direct replacement.', 'warning');
      await copyToClipboard(cleanedNewCode);
      statusCallback?.('Code fix copied to clipboard.', 'warning');
      return false;
    }

    if (originalFileContent.includes(cleanedOriginalSnippet)) {
      statusCallback?.('Attempting direct string replacement...', 'info');
      const newContent = originalFileContent.replace(cleanedOriginalSnippet, cleanedNewCode);

      try {
        statusCallback?.('Writing updated content (simple replacement)...', 'info');
        const writable = await fileHandle.createWritable();
        await writable.write(newContent);
        await writable.close();
        statusCallback?.('Code fix applied using direct replacement (less reliable).', 'success');
        return true;
      } catch (error) {
        statusCallback?.(
          `Error writing file during simple replacement: ${error instanceof Error ? error.message : String(error)}`,
          'error'
        );
        console.error("Error during Simple Fix write:", error);
      }
    }

    // Last Resort: Copy to clipboard
    statusCallback?.('Direct replacement failed or original snippet not found. Please apply the fix manually.', 'error');
    await copyToClipboard(cleanedNewCode);
    statusCallback?.('Code fix copied to clipboard.', 'warning');
    return false;
  }
}

// Export singleton instance
export const fileService = new FileService();