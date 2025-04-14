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
  private initializationPromise: Promise<void> | null = null; // Promise resolves when init is done

  constructor(statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void) {
    this.astProcessor = new AstProcessor();
    // Start initialization, but don't block constructor
    this.initializationPromise = this.initialize(statusCallback).catch(err => {
        // Catch error here so it doesn't become an unhandled rejection if await ensureInitialized isn't called
        console.error("[FileService] Initialization promise failed:", err);
        // isInitialized remains false
    });
  }

  /**
   * Initializes the service by attempting to load the stored directory handle.
   * Checks permission status without requesting it.
   */
  private async initialize(
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<void> {
    // Prevent re-entry if already initialized or initializing
    if (this.isInitialized) {
      return;
    }
    // Check if another call is already in progress (though constructor pattern makes this less likely)
    if (this.initializationPromise && !this.isInitialized) {
        return this.initializationPromise; // Wait for the existing initialization
    }

    console.log('[FileService] Initializing...');
    statusCallback?.('Initializing File Service, checking for stored directory access...', 'info');

    try {
      const storedHandle = await getStoredDirectoryHandle(STORED_HANDLE_KEY);
      if (storedHandle) {
        statusCallback?.(`Found stored handle for: ${storedHandle.name}. Checking permission status...`, 'info');
        // --- Use checkPermissionStatus instead of verifyPermission ---
        const permissionStatus = await this.checkPermissionStatus(storedHandle);
        statusCallback?.(`Initial permission status for ${storedHandle.name}: ${permissionStatus}`, 'info');

        if (permissionStatus === 'granted') {
          statusCallback?.(`Permissions previously granted for directory: ${storedHandle.name}`, 'success');
          this.selectedDirectoryHandle = storedHandle; // Cache the handle
        } else if (permissionStatus === 'prompt') {
           statusCallback?.(`Permissions require confirmation for stored directory: ${storedHandle.name}. Will prompt when needed.`, 'info');
           // Don't cache yet, getDirectoryHandle will re-verify and prompt later
           // Optionally, could remove from storage here too, to force picker if prompt fails later
           // await removeStoredDirectoryHandle(STORED_HANDLE_KEY);
        } else { // 'denied'
          statusCallback?.(`Permissions were denied for stored directory: ${storedHandle.name}. Forgetting handle.`, 'warning');
          await removeStoredDirectoryHandle(STORED_HANDLE_KEY); // Remove invalid handle
        }
      } else {
         statusCallback?.('No stored directory handle found.', 'info');
      }
      this.isInitialized = true; // Set flag *after* successful completion
      console.log('[FileService] Initialization complete.');
    } catch (error) {
      // --- Handle potential errors during checkPermissionStatus or IndexedDB access ---
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Check specifically for the user activation error, although it shouldn't happen with queryPermission
      if (errorMsg.includes('User activation is required')) {
         statusCallback?.('Error during initialization: Stored handle exists but cannot check status without user interaction. Please re-select directory later.', 'warning');
         // Remove the problematic handle to avoid loops
         await removeStoredDirectoryHandle(STORED_HANDLE_KEY).catch(e => console.warn("Failed to remove handle after init error:", e));
      } else {
         statusCallback?.(`Error loading/checking stored directory handle: ${errorMsg}`, 'error');
         console.error('[FileService] Initialization failed during load/check:', error);
      }
      // Do not set isInitialized = true on error
      // Rethrow only if it's not the activation error we handled gracefully
      if (!errorMsg.includes('User activation is required')) {
          throw error;
      }
      // If it *was* the activation error, we logged a warning and removed the handle,
      // consider initialization "complete" but without a cached handle.
      this.isInitialized = true;
    }
  }

  /** Helper to wait for initialization to complete */
  public async ensureInitialized(): Promise<boolean> {
      if (this.isInitialized) {
          return true;
      }
      if (this.initializationPromise) {
          try {
              await this.initializationPromise;
              // Re-check isInitialized state after await, in case of error during init
              return this.isInitialized;
          } catch (error) {
              // Error already logged by the initialization catch block
              console.error("[FileService] Waiting for initialization failed.");
              return false; // Initialization failed
          }
      } else {
          // This case should ideally not be reached if constructor logic is sound
          console.error("[FileService] Initialization promise missing unexpectedly.");
          // Attempt recovery? Or just fail.
          try {
              console.log("[FileService] Attempting recovery initialization...");
              this.initializationPromise = this.initialize( (msg, type) =>
                  console.log(`[FileService Recovery Init Status - ${type.toUpperCase()}]: ${msg}`)
              ).catch(err => { console.error("[FileService] Recovery initialization failed:", err); });
              await this.initializationPromise;
              return this.isInitialized;
          } catch {
              return false;
          }
      }
  }

  /**
   * Helper to check the current permission status for a given handle using queryPermission.
   * Does NOT request permission.
   */
  private async checkPermissionStatus(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
    const options = { mode: 'readwrite' as FileSystemPermissionMode };
    try {
        const status = await handle.queryPermission(options);
        return status;
    } catch (error) {
        console.error("Error querying permission status:", error);
        // If querying fails, assume we need to prompt later or it's denied.
        // Returning 'prompt' might be safer, but 'denied' reflects the error state.
        return 'denied';
    }
  }

  /**
   * Helper to verify permissions, requesting if necessary.
   * Should only be called in response to user activation.
   */
  private async verifyOrRequestPermission(handle: FileSystemDirectoryHandle, statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void): Promise<boolean> {
    const options = { mode: 'readwrite' as FileSystemPermissionMode };
    try {
      // 1. Check current status
      const currentStatus = await handle.queryPermission(options);
      statusCallback?.(`Permission status for ${handle.name}: ${currentStatus}`, 'info');

      if (currentStatus === 'granted') {
        return true;
      }

      if (currentStatus === 'denied') {
        statusCallback?.(`Permission explicitly denied for ${handle.name}. Cannot proceed.`, 'warning');
        return false;
      }

      // 2. If 'prompt', request permission (requires user activation)
      if (currentStatus === 'prompt') {
        statusCallback?.(`Requesting permission for ${handle.name}...`, 'info');
        // This is the call that requires user activation
        if (await handle.requestPermission(options) === 'granted') {
          statusCallback?.(`Permission granted for ${handle.name}.`, 'success');
          return true;
        } else {
          statusCallback?.(`Permission denied by user or browser for ${handle.name}.`, 'warning');
          return false;
        }
      }
    } catch (error) {
        // Catch errors during query or request
        statusCallback?.(`Error verifying/requesting permission for ${handle.name}: ${error instanceof Error ? error.message : String(error)}`, 'error');
        console.error("Error in verifyOrRequestPermission:", error);
        return false;
    }
    // Fallback case (shouldn't be reached ideally)
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
   * Returns the name of the currently selected and permission-granted directory.
   * Returns null if no directory is selected or permissions are not granted.
   */
  public getCurrentDirectoryName(): string | null {
    // Directly check the in-memory handle, which should be populated
    // after successful initialization or selection/permission grant.
    if (this.selectedDirectoryHandle) {
      return this.selectedDirectoryHandle.name;
    }
    return null; // No handle currently active/cached
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
   * Clears the selected directory handle from memory and IndexedDB.
   */
  public async forgetDirectoryAccess(
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<void> {
    statusCallback?.('Forgetting directory access...', 'info');
    this.selectedDirectoryHandle = null; // Clear memory cache
    try {
      await removeStoredDirectoryHandle(STORED_HANDLE_KEY); // Clear storage
      statusCallback?.('Directory access has been forgotten. You will be prompted next time.', 'success');
    } catch (error) {
      statusCallback?.(`Error removing stored directory handle: ${error instanceof Error ? error.message : String(error)}`, 'error');
      console.error('Error forgetting directory access:', error);
    }
  }

  /**
   * Gets the directory handle, trying cache/storage first, then prompting.
   * Verifies/requests permissions when a handle is found.
   */
  public async getDirectoryHandle(
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<FileSystemDirectoryHandle | null> {
    // Wait for initialization to finish before proceeding
    const initialized = await this.ensureInitialized();
    if (!initialized) {
        statusCallback?.('FileService initialization failed or did not complete. Cannot get handle.', 'error');
        return null;
    }

    let handleToCheck: FileSystemDirectoryHandle | null | undefined = this.selectedDirectoryHandle;
    let source = 'memory cache';

    // 1. Check memory cache
    if (handleToCheck) {
        statusCallback?.(`Found handle in ${source}: ${handleToCheck.name}. Verifying/Requesting permissions...`, 'info');
        // --- Use verifyOrRequestPermission ---
        if (await this.verifyOrRequestPermission(handleToCheck, statusCallback)) {
            // statusCallback message handled within verifyOrRequestPermission
            return this.selectedDirectoryHandle; // Already verified and cached
        } else {
            statusCallback?.(`Permissions lost or denied for directory in ${source}: ${handleToCheck.name}. Clearing...`, 'warning');
            this.selectedDirectoryHandle = null; // Clear invalid cached handle
            handleToCheck = null; // Ensure we try storage next
            try { await removeStoredDirectoryHandle(STORED_HANDLE_KEY); } catch { /* ignore */ }
        }
    }

    // 2. Check IndexedDB storage if not found in memory or memory check failed
    if (!handleToCheck) {
        source = 'storage';
        try {
            handleToCheck = await getStoredDirectoryHandle(STORED_HANDLE_KEY);
            if (handleToCheck) {
                statusCallback?.(`Found handle in ${source}: ${handleToCheck.name}. Verifying/Requesting permissions...`, 'info');
                 // --- Use verifyOrRequestPermission ---
                if (await this.verifyOrRequestPermission(handleToCheck, statusCallback)) {
                    // statusCallback message handled within verifyOrRequestPermission
                    this.selectedDirectoryHandle = handleToCheck; // Cache in memory
                    return this.selectedDirectoryHandle;
                } else {
                    statusCallback?.(`Permissions lost or denied for directory in ${source}: ${handleToCheck.name}. Clearing...`, 'warning');
                    this.selectedDirectoryHandle = null; // Clear memory cache just in case
                    await removeStoredDirectoryHandle(STORED_HANDLE_KEY); // Remove stale handle
                    handleToCheck = null; // Ensure we prompt next
                }
            } else {
                 statusCallback?.(`No valid handle found in ${source}.`, 'info');
            }
        } catch (error) {
            statusCallback?.(`Error checking ${source} for handle: ${error instanceof Error ? error.message : String(error)}`, 'error');
            handleToCheck = null; // Ensure we prompt on error
        }
    }


    // 3. If no valid handle found/verified, prompt the user
    statusCallback?.('Directory access required. Prompting user...', 'info');
    // requestDirectoryAccess internally calls storeDirectoryHandle which is fine
    const newHandle = await this.requestDirectoryAccess(statusCallback);
    // No need to call verifyOrRequestPermission immediately after requestDirectoryAccess,
    // as showDirectoryPicker grants permission implicitly upon selection.
    return newHandle;
  }

  /**
   * Applies a code fix to the correct file within the selected directory.
   */
  public async applyCodeFix(
    errorInfo: ErrorInfo,
    originalSourceSnippet: string,
    newCodeSnippet: string,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<boolean> {
      // Wait for initialization to finish before proceeding
      const initialized = await this.ensureInitialized();
      if (!initialized) {
          statusCallback?.('Cannot apply fix: FileService initialization failed.', 'error');
          return false;
      }

      statusCallback?.('Attempting to apply code fix...', 'info');
      // getDirectoryHandle will now also wait if called, but ensureInitialized check is good practice
      const directoryHandle = await this.getDirectoryHandle(statusCallback);

      if (!directoryHandle) {
        // Error message handled within getDirectoryHandle or requestDirectoryAccess
        statusCallback?.('Failed to get directory handle. Cannot apply fix.', 'error');
        return false;
      }
      // --- Directory handle obtained ---

      // --- Calculate relative path ---
      const projectRelativePath = this.getProjectRelativePath(errorInfo.fileName || '');
      if (!projectRelativePath) {
          statusCallback?.(`Could not determine project relative path for: ${errorInfo.fileName}`, 'error');
          return false;
      }

      // Determine the path needed for getFileHandleRecursive()
      // It should be relative to the directoryHandle itself.
      let pathForGetHandle: string;
      if (directoryHandle.name === 'src' && projectRelativePath.startsWith('src/')) {
          pathForGetHandle = projectRelativePath.substring(4); // Remove 'src/'
      } else {
          // Fallback or handle cases where the selected directory isn't 'src'
          // This might need adjustment based on expected directory structures
          pathForGetHandle = projectRelativePath;
          statusCallback?.(`Selected directory is "${directoryHandle.name}", using path "${pathForGetHandle}" relative to it. Ensure this is correct.`, 'warning');
      }
      // Ensure no leading slash, as getFileHandleRecursive handles normalization
      pathForGetHandle = pathForGetHandle.replace(/^\/+/, '');

      // --- Get file handle using the recursive helper ---
      let fileHandle: FileSystemFileHandle;
      try {
        statusCallback?.(`Attempting to access file recursively: ${pathForGetHandle} within ${directoryHandle.name}`, 'info');
        // Re-verify permission just before access (might be redundant but safe)
        if (await this.verifyOrRequestPermission(directoryHandle, statusCallback)) { // Use helper for permissions
           // --- Use the recursive helper function ---
           fileHandle = await this.getFileHandleRecursive(directoryHandle, pathForGetHandle);
           // -----------------------------------------
           statusCallback?.(`Successfully accessed file handle for: ${fileHandle.name}`, 'info');
        } else {
             statusCallback?.(`Write permission denied for directory ${directoryHandle.name}.`, 'error');
             return false;
        }

      } catch (error) {
        let errorMsg = error instanceof Error ? error.message : String(error);
        // Error messages from getFileHandleRecursive are already quite descriptive
        statusCallback?.(errorMsg, 'error');
        console.error(`Error getting file handle via getFileHandleRecursive for ${pathForGetHandle} in ${directoryHandle.name}`, error);
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

  /**
   * Asynchronously retrieves a FileSystemFileHandle for a given path relative
   * to a base directory handle, traversing subdirectories as needed.
   * (Moved from ai-service.ts)
   *
   * @param baseDirHandle The FileSystemDirectoryHandle for the root directory (e.g., 'src').
   * @param relativePath The path to the file relative to the base directory (e.g., 'ui/screen-capture.ts' or 'demo.ts').
   * @returns A Promise that resolves with the FileSystemFileHandle if found.
   * @throws An error if the path is invalid, or if any directory/file along the path doesn't exist or access is denied.
   */
  private async getFileHandleRecursive(
      baseDirHandle: FileSystemDirectoryHandle,
      relativePath: string
  ): Promise<FileSystemFileHandle> {
      // Normalize path: remove leading/trailing slashes and ensure consistent separators
      const normalizedPath = relativePath.replace(/^\/+|\/+$/g, '');
      const pathParts = normalizedPath.split('/').filter(part => part !== ''); // Split and remove empty parts like double slashes //

      if (pathParts.length === 0) {
          throw new Error("Relative path cannot be empty or just slashes.");
      }

      let currentDirHandle = baseDirHandle;
      const fileName = pathParts.pop(); // Get the file name (last part)

      if (!fileName) {
           throw new Error(`Invalid relative path: "${relativePath}" - must include a filename.`);
      }

      // Traverse the directory parts (if any)
      for (const dirName of pathParts) {
          if (!dirName) continue; // Should not happen with filter, but safety check
          try {
              // console.debug(`[FileAccess] Getting directory handle for: ${dirName} within ${currentDirHandle.name}`);
              currentDirHandle = await currentDirHandle.getDirectoryHandle(dirName);
          } catch (error: any) {
              console.error(`[FileAccess] Error getting directory handle for "${dirName}" in path "${normalizedPath}":`, error);
              if (error.name === 'NotFoundError') {
                   throw new Error(`Directory not found: "${dirName}" in path "${normalizedPath}" relative to "${baseDirHandle.name}"`);
              } else if (error.name === 'TypeMismatchError') {
                   throw new Error(`"${dirName}" is a file, not a directory, in path "${normalizedPath}"`);
              } else {
                   throw new Error(`Failed to access directory "${dirName}" in path "${normalizedPath}": ${error.message}`);
              }
          }
      }

      // Get the file handle from the final directory (which might be the baseDirHandle if no subdirs)
      try {
          // console.debug(`[FileAccess] Getting file handle for: ${fileName} within ${currentDirHandle.name}`);
          const fileHandle = await currentDirHandle.getFileHandle(fileName);
          // console.debug(`[FileAccess] Successfully got file handle for: ${relativePath}`);
          return fileHandle;
      } catch (error: any) {
          console.error(`[FileAccess] Error getting file handle for "${fileName}" in "${currentDirHandle.name}":`, error);
          if (error.name === 'NotFoundError') {
              throw new Error(`File not found: "${fileName}" in path "${normalizedPath}" relative to "${baseDirHandle.name}"`);
          } else if (error.name === 'TypeMismatchError') {
              throw new Error(`"${fileName}" is a directory, not a file, in path "${normalizedPath}"`);
          } else {
              throw new Error(`Failed to access file "${fileName}" in path "${normalizedPath}": ${error.message}`);
          }
      }
  }
}

// Export singleton instance
export const fileService = new FileService( (msg, type) =>
    console.log(`[FileService Init Status - ${type.toUpperCase()}]: ${msg}`)
);