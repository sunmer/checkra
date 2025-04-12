import { ErrorInfo } from '../types';
import { AstProcessor } from '../core/ast-processor';
import { cleanCodeExample, copyToClipboard } from '../utils/code-utils';
import { storeDirectoryHandle, getStoredDirectoryHandle, removeStoredDirectoryHandle } from '../utils/indexeddb-store';

const STORED_HANDLE_KEY = 'selectedSourceDirectory'; // Key for IndexedDB

/**
 * Service for handling file operations and code fixes
 */
export class FileService {
  private astProcessor: AstProcessor;
  private selectedDirectoryHandle: FileSystemDirectoryHandle | null = null;
  private isInitialized = false; // Flag to prevent multiple initializations

  constructor() {
    this.astProcessor = new AstProcessor();
    // Don't call initialize() here directly, let the app call it
  }

  /**
   * Initializes the service by attempting to load the stored directory handle.
   * Should be called once when the application starts.
   */
  public async initialize(
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;
    statusCallback?.('Initializing File Service, checking for stored directory access...', 'info');

    try {
      const storedHandle = await getStoredDirectoryHandle(STORED_HANDLE_KEY);
      if (storedHandle) {
        statusCallback?.(`Found stored handle for: ${storedHandle.name}. Verifying permissions...`, 'info');
        // IMPORTANT: Verify permission still exists
        if (await this.verifyPermission(storedHandle)) {
          statusCallback?.(`Permissions verified for directory: ${storedHandle.name}`, 'success');
          this.selectedDirectoryHandle = storedHandle;
        } else {
          statusCallback?.(`Permissions lost or denied for stored directory: ${storedHandle.name}. Please re-select the directory when needed.`, 'warning');
          // Remove the stale handle from storage
          await removeStoredDirectoryHandle(STORED_HANDLE_KEY);
        }
      } else {
         statusCallback?.('No stored directory handle found.', 'info');
      }
    } catch (error) {
      statusCallback?.(`Error loading stored directory handle: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  /**
   * Helper to verify permissions for a given handle.
   */
  private async verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    const options = { mode: 'readwrite' as FileSystemPermissionMode };
    // Check if permission was already granted
    if (await handle.queryPermission(options) === 'granted') {
      return true;
    }
    // Try to request permission without prompting the user again if possible
    // Note: Depending on the browser, this might still prompt if permission was explicitly revoked.
    if (await handle.requestPermission(options) === 'granted') {
      return true;
    }
    return false;
  }

  /**
   * Attempts to extract a project-relative path from various file URL/path formats.
   */
  private getProjectRelativePath(fileNameUrlOrPath: string): string | null {
    console.log('[Debug][getProjectRelativePath] Input:', fileNameUrlOrPath); // Log input
    try {
      // 1. Handle standard URLs (http, https)
      if (fileNameUrlOrPath.startsWith('http:') || fileNameUrlOrPath.startsWith('https:')) {
        const url = new URL(fileNameUrlOrPath);
        // Extract the path part, remove leading slash, decode
        let path = decodeURIComponent(url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname);
        console.log('[Debug][getProjectRelativePath] Initial path from URL:', path);

        // --- >>> ADDED CHECK: Process @fs/ or absolute path *within* the URL path <<< ---
        if (path.startsWith('@fs/') || path.startsWith('/')) {
            console.log('[Debug][getProjectRelativePath] Handling @fs/ or / within URL path.');
            let absolutePath = path.startsWith('@fs/') ? path.substring(4) : path;
            // Path from URL is usually already decoded, but decode again just in case
            absolutePath = decodeURIComponent(absolutePath);
            console.log('[Debug][getProjectRelativePath] Path after prefix strip/decode:', absolutePath);

            const srcIndex = absolutePath.indexOf('/src/');
            console.log('[Debug][getProjectRelativePath] Index of "/src/":', srcIndex);

            if (srcIndex !== -1) {
              const result = absolutePath.substring(srcIndex + 1);
              console.log('[Debug][getProjectRelativePath] Found "/src/", Result:', result);
              return result;
            } else {
               console.log('[Debug][getProjectRelativePath] "/src/" not found, using fallback.');
               const fallbackResult = absolutePath.substring(absolutePath.lastIndexOf('/') + 1);
               console.log('[Debug][getProjectRelativePath] Fallback Result:', fallbackResult);
               return fallbackResult;
            }
        } else {
             // If the path extracted from URL doesn't start with @fs/ or /, return it directly
             console.log('[Debug][getProjectRelativePath] Path from URL is already relative:', path);
             return path;
        }
        // --- >>> END ADDED CHECK <<< ---
      }

      // 2. Handle cases where the input *itself* starts with @fs/ or / (not part of a full URL)
      // This block might now be less likely to be hit if errors always provide full URLs, but keep it as a fallback.
      if (fileNameUrlOrPath.startsWith('@fs/') || fileNameUrlOrPath.startsWith('/')) {
        console.log('[Debug][getProjectRelativePath] Handling as direct @fs/ or / path.');
        let absolutePath = fileNameUrlOrPath.startsWith('@fs/')
          ? fileNameUrlOrPath.substring(4)
          : fileNameUrlOrPath;
        absolutePath = decodeURIComponent(absolutePath);
        console.log('[Debug][getProjectRelativePath] Path after prefix strip/decode:', absolutePath);

        const srcIndex = absolutePath.indexOf('/src/');
        console.log('[Debug][getProjectRelativePath] Index of "/src/":', srcIndex);

        if (srcIndex !== -1) {
          const result = absolutePath.substring(srcIndex + 1);
          console.log('[Debug][getProjectRelativePath] Found "/src/", Result:', result);
          return result;
        } else {
           console.log('[Debug][getProjectRelativePath] "/src/" not found, using fallback.');
           const fallbackResult = absolutePath.substring(absolutePath.lastIndexOf('/') + 1);
           console.log('[Debug][getProjectRelativePath] Fallback Result:', fallbackResult);
           return fallbackResult;
        }
      }

      // 3. Handle file:/// URLs
      if (fileNameUrlOrPath.startsWith('file:///')) {
         console.log('[Debug][getProjectRelativePath] Handling as file:/// path.');
        let filePath = decodeURIComponent(fileNameUrlOrPath.substring(7));
        const srcIndex = filePath.indexOf('/src/');
        if (srcIndex !== -1) {
          const result = filePath.substring(srcIndex + 1);
          console.log('[Debug][getProjectRelativePath] Found "/src/" in file path, Result:', result);
          return result;
        } else {
           console.log('[Debug][getProjectRelativePath] "/src/" not found in file path, using fallback.');
           const fallbackResult = filePath.substring(filePath.lastIndexOf('/') + 1);
           console.log('[Debug][getProjectRelativePath] Fallback Result:', fallbackResult);
           return fallbackResult;
        }
      }

      // 4. If it doesn't match known patterns, assume it might be a relative path already
      if (!fileNameUrlOrPath.includes(':') && !fileNameUrlOrPath.startsWith('/')) {
        console.log('[Debug][getProjectRelativePath] Handling as likely relative path.');
        return fileNameUrlOrPath;
      }

      // If none of the above, we couldn't determine the path
      console.warn(`[Debug][getProjectRelativePath] Could not determine project-relative path for: ${fileNameUrlOrPath}`);
      return null;

    } catch (error) {
      console.error(`[Debug][getProjectRelativePath] Error parsing fileName "${fileNameUrlOrPath}":`, error);
      return null;
    }
  }

  /**
   * Requests access to the project's source directory and stores it.
   */
  public async requestDirectoryAccess(
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<FileSystemDirectoryHandle | null> {
    try {
      if (!('showDirectoryPicker' in window)) {
        statusCallback?.('File System Access API (Directory Picker) is not supported.', 'error');
        return null;
      }

      statusCallback?.('Please select your project\'s source code directory...', 'info');
      const directoryHandle = await (window as any).showDirectoryPicker();

      if (directoryHandle) {
        // Store the handle in memory
        this.selectedDirectoryHandle = directoryHandle;
        statusCallback?.(`Access granted to directory: ${directoryHandle.name}`, 'success');

        // --- Store the handle in IndexedDB ---
        try {
          await storeDirectoryHandle(STORED_HANDLE_KEY, directoryHandle);
          statusCallback?.(`Directory access saved for future sessions.`, 'info');
        } catch (storeError) {
           statusCallback?.(`Could not save directory access for future sessions: ${storeError instanceof Error ? storeError.message : String(storeError)}`, 'warning');
        }
        // --- End storing ---

        return directoryHandle;
      } else {
        statusCallback?.('Directory selection cancelled or failed.', 'warning');
        this.selectedDirectoryHandle = null;
        // Clear potentially stale stored handle if user cancels
        await removeStoredDirectoryHandle(STORED_HANDLE_KEY).catch(e => console.warn("Could not remove stored handle on cancel:", e));
        return null;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        statusCallback?.('Directory selection was cancelled.', 'info');
      } else {
        statusCallback?.(`Error requesting directory access: ${error instanceof Error ? error.message : String(error)}`, 'error');
        console.error("Directory Picker Error:", error);
      }
      this.selectedDirectoryHandle = null;
      // Clear potentially stale stored handle on error
      await removeStoredDirectoryHandle(STORED_HANDLE_KEY).catch(e => console.warn("Could not remove stored handle on error:", e));
      return null;
    }
  }

  /**
   * Gets the directory handle, trying memory, then IndexedDB, then prompting.
   */
  public async getDirectoryHandle(
     statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<FileSystemDirectoryHandle | null> {
    // 1. Check memory cache first
    if (this.selectedDirectoryHandle) {
      statusCallback?.(`Using cached handle: ${this.selectedDirectoryHandle.name}. Verifying permissions...`, 'info');
      if (await this.verifyPermission(this.selectedDirectoryHandle)) {
         statusCallback?.(`Permissions verified for cached handle: ${this.selectedDirectoryHandle.name}`, 'success');
        return this.selectedDirectoryHandle;
      } else {
        statusCallback?.(`Permissions lost for cached handle: ${this.selectedDirectoryHandle.name}.`, 'warning');
        this.selectedDirectoryHandle = null; // Clear invalid cached handle
        // Also remove from storage as it's invalid
        await removeStoredDirectoryHandle(STORED_HANDLE_KEY).catch(e => console.warn("Could not remove stored handle:", e));
        // Proceed to prompt
      }
    }

    // 2. Try loading from IndexedDB if not in memory or permission lost
    if (!this.selectedDirectoryHandle) {
        try {
            const storedHandle = await getStoredDirectoryHandle(STORED_HANDLE_KEY);
            if (storedHandle) {
                statusCallback?.(`Using stored handle: ${storedHandle.name}. Verifying permissions...`, 'info');
                if (await this.verifyPermission(storedHandle)) {
                    statusCallback?.(`Permissions verified for stored handle: ${storedHandle.name}`, 'success');
                    this.selectedDirectoryHandle = storedHandle; // Cache in memory
                    return this.selectedDirectoryHandle;
                } else {
                    statusCallback?.(`Permissions lost or denied for stored directory: ${storedHandle.name}. Please re-select.`, 'warning');
                    // Remove the stale handle from storage
                    await removeStoredDirectoryHandle(STORED_HANDLE_KEY);
                    // Proceed to prompt
                }
            }
        } catch (error) {
            statusCallback?.(`Error checking stored directory handle: ${error instanceof Error ? error.message : String(error)}`, 'warning');
            // Proceed to prompt
        }
    }

    // 3. If not found or permissions failed, prompt the user
    statusCallback?.('Directory handle not available or permissions insufficient.', 'info');
    return await this.requestDirectoryAccess(statusCallback);
  }

  /**
   * Applies a code fix to the correct file within the selected directory.
   */
  public async applyCodeFix(
    originalSourceSnippet: string,
    newCodeSnippet: string,
    errorInfo: ErrorInfo,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<boolean> {

    // getDirectoryHandle will now try memory/storage before prompting
    const directoryHandle = await this.getDirectoryHandle(statusCallback);
    if (!directoryHandle) {
        // getDirectoryHandle or requestDirectoryAccess already showed messages
        return false;
    }

    if (!errorInfo.fileName) {
        statusCallback?.('Error information does not contain a filename.', 'error');
        return false;
    }

    // --- Get the project-relative path ---
    const projectRelativePath = this.getProjectRelativePath(errorInfo.fileName);
    if (!projectRelativePath) {
      statusCallback?.(`Could not determine a usable relative path for: ${errorInfo.fileName}`, 'error');
      return false;
    }
    // Example: projectRelativePath might be "src/demo.ts"

    // --- Calculate path relative to the selected directory handle ---
    let pathForGetHandle: string;
    if (directoryHandle.name === 'src' && projectRelativePath.startsWith('src/')) {
        pathForGetHandle = projectRelativePath.substring(4); // Remove "src/"
    }
    // Add more conditions here if users might select other directories (e.g., the root)
    // else if (directoryHandle.name === 'my-project' && projectRelativePath.startsWith(...)) { ... }
    else {
        // Default assumption: the projectRelativePath is already relative to the selected handle
        pathForGetHandle = projectRelativePath;
    }

    if (!pathForGetHandle) {
        statusCallback?.(`Calculated path for getFileHandle is empty. Original path: ${projectRelativePath}, Directory: ${directoryHandle.name}`, 'error');
        return false;
    }

    // --- >>> ADD DEBUGGING LOGS HERE <<< ---
    console.log('[Debug] Directory Handle Name:', directoryHandle.name);
    console.log('[Debug] Project Relative Path:', projectRelativePath);
    console.log('[Debug] Calculated Path for getFileHandle:', pathForGetHandle);
    // --- >>> END DEBUGGING LOGS <<< ---

    let fileHandle: FileSystemFileHandle;
    try {
      statusCallback?.(`Attempting to access file: ${pathForGetHandle} within ${directoryHandle.name}`, 'info');
      // Permission check is implicitly done by verifyPermission within getDirectoryHandle now,
      // but requesting again here ensures write access specifically for getFileHandle/write operations.
      // It might be redundant but ensures the latest state.
      if (await directoryHandle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
         statusCallback?.(`Write permission denied for directory ${directoryHandle.name}.`, 'error');
         return false;
      }
      fileHandle = await directoryHandle.getFileHandle(pathForGetHandle, { create: false });
      statusCallback?.(`Successfully accessed file handle for: ${fileHandle.name}`, 'info');
    } catch (error) {
      let errorMsg = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === 'NotFoundError') {
          errorMsg = `File not found at path "${pathForGetHandle}" inside "${directoryHandle.name}". Check if the selected directory is correct.`;
      } else {
          errorMsg = `Failed to get file handle for "${pathForGetHandle}" in "${directoryHandle.name}": ${errorMsg}`;
      }
      statusCallback?.(errorMsg, 'error');
      console.error(`Error getting file handle for ${pathForGetHandle} in ${directoryHandle.name}`, error);
      return false;
    }
    // --- File handle obtained ---

    // --- Read original content ---
    let originalFileContent: string;
    try {
        const file = await fileHandle.getFile();
        originalFileContent = await file.text();
    } catch (error) {
        statusCallback?.(
            `Failed to read file content for "${fileHandle.name}": ${error instanceof Error ? error.message : String(error)}`,
            'error'
        );
        return false;
    }
    // --- Original content read ---

    const fileName = fileHandle.name;
    const isJsTsFile = /\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(fileName);
    const cleanedNewCode = cleanCodeExample(newCodeSnippet);

    if (!isJsTsFile) {
      statusCallback?.(`File type (${fileName}) not supported by AST analysis. Attempting direct replacement.`, 'warning');
      return this.applySimpleFix(fileHandle, originalFileContent, originalSourceSnippet, cleanedNewCode, statusCallback);
    }

    statusCallback?.(`Applying fix to ${fileName} using AST analysis...`, 'info');
    return await this.astProcessor.processCodeFix(
      fileHandle,
      originalFileContent,
      originalSourceSnippet,
      cleanedNewCode,
      errorInfo,
      statusCallback
    );
  }

  /**
   * Applies a code fix using simple string replacement (fallback).
   * No changes needed here as it receives the correct fileHandle.
   */
  private async applySimpleFix(
    fileHandle: FileSystemFileHandle,
    originalFileContent: string,
    originalSourceSnippet: string,
    cleanedNewCodeSnippet: string, // Expect cleaned code here
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<boolean> {
    // Clean the original snippet for comparison (might be redundant if already clean)
    const cleanedOriginalSnippet = cleanCodeExample(originalSourceSnippet);

    if (!cleanedOriginalSnippet) {
      statusCallback?.('Original snippet context is empty, cannot perform reliable direct replacement.', 'warning');
      await copyToClipboard(cleanedNewCodeSnippet);
      statusCallback?.('Code fix copied to clipboard.', 'warning');
      return false;
    }

    // Check if the *specific context* exists before replacing
    if (originalFileContent.includes(cleanedOriginalSnippet)) {
      statusCallback?.('Original code snippet found. Attempting direct string replacement...', 'info');
      // Replace only the first occurrence of the snippet context
      const newContent = originalFileContent.replace(cleanedOriginalSnippet, cleanedNewCodeSnippet);

      // Basic check: Did the content actually change?
      if (newContent === originalFileContent) {
        statusCallback?.('Direct replacement did not change the file content (snippet might be identical or issue elsewhere).', 'warning');
        // Fallback to clipboard as replacement wasn't effective
        await copyToClipboard(cleanedNewCodeSnippet);
        statusCallback?.('Code fix copied to clipboard.', 'warning');
        return false;
      }

      try {
        statusCallback?.(`Writing updated content to ${fileHandle.name} (simple replacement)...`, 'info');
        const writable = await fileHandle.createWritable();
        await writable.write(newContent);
        await writable.close();
        statusCallback?.(`Code fix applied to ${fileHandle.name} using direct replacement (less reliable).`, 'success');
        return true;
      } catch (error) {
        statusCallback?.(
          `Error writing file "${fileHandle.name}" during simple replacement: ${error instanceof Error ? error.message : String(error)}`,
          'error'
        );
        console.error("Error during Simple Fix write:", error);
        // Fallback to clipboard on write error
        await copyToClipboard(cleanedNewCodeSnippet);
        statusCallback?.('Code fix copied to clipboard due to write error.', 'warning');
        return false;
      }
    } else {
      statusCallback?.('Original code snippet not found in the file for direct replacement.', 'warning');
    }

    // Last Resort: Copy to clipboard if replacement wasn't possible or failed
    statusCallback?.('Direct replacement failed or original snippet not found. Please apply the fix manually.', 'error');
    await copyToClipboard(cleanedNewCodeSnippet);
    statusCallback?.('Code fix copied to clipboard.', 'warning');
    return false;
  }
}

// Export singleton instance
export const fileService = new FileService();