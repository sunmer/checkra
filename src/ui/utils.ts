/**
 * Creates a debounce function for performance optimization.
 */
export const debounce = <F extends (...args: any[]) => any>(
  func: F,
  waitFor: number
): ((...args: Parameters<F>) => void) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (this: any, ...args: Parameters<F>): void {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func.apply(this, args), waitFor);
  };
};

// Helper to escape HTML characters - memoize for performance
const escapeHTMLCache = new Map<string, string>();

/**
 * Escapes HTML special characters to prevent XSS.
 */
export const escapeHTML = (str: string): string => {
  if (escapeHTMLCache.has(str)) {
    return escapeHTMLCache.get(str)!;
  }

  const escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  escapeHTMLCache.set(str, escaped);
  return escaped;
};

/**
 * Truncates text to a specified maximum length and adds '...' if truncated.
 */
export const truncateText = (text: string, maxLength: number = 100): string => {
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
};
