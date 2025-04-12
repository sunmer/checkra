/**
 * Utility functions for code manipulation and clipboard operations
 */

/**
 * Clean code example (removes ``` fences and line numbers)
 */
export function cleanCodeExample(codeExample: string): string {
  if (!codeExample) return '';
  let cleanCode = codeExample.trim();
  
  // Updated regex to handle optional language identifiers (like ```javascript) and potential whitespace
  cleanCode = cleanCode.replace(/^```[\w\s]*\n?/m, ''); // Remove starting fence
  cleanCode = cleanCode.replace(/\n?```$/m, ''); // Remove ending fence
  
  // Regex to remove leading line numbers like "1.", "1 |", "1:", etc. possibly followed by whitespace
  cleanCode = cleanCode.replace(/^\s*\d+\s*[:.|]\s*/gm, '');
  
  return cleanCode.trim();
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<void> {
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
        const success = document.execCommand('copy');
        if (!success) {
          throw new Error('Fallback document.execCommand failed');
        }
      } catch (e) {
        console.error('Fallback clipboard copy failed:', e);
        // Avoid throwing here, let the caller handle UI feedback
      } finally {
        document.body.removeChild(textarea);
      }
    }
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    // Let the calling function decide how to handle clipboard failure via statusCallback.
  }
}