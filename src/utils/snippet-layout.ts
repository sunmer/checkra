import { PageFingerprint, SnippetLayout } from '../types';

// Utility: joins classList array into a single space-separated string (or null if empty)
function joinClasses(classes?: string[] | null): string | null {
  if (!classes || classes.length === 0) return null;
  return Array.from(new Set(classes)).join(' ');
}

// Extract classes from an HTML snippet (root element only)
function extractRootClassesFromHtml(html: string): string[] {
  const match = html.match(/class\s*=\s*("|')([^"']*)(\1)/i);
  if (match && match[2]) {
    return match[2].split(/\s+/).filter(Boolean);
  }
  return [];
}

function pickContainerClasses(classList: string[]): string[] {
  return classList.filter(c => /^(max-w-|container|mx-auto)/.test(c));
}

function pickGridClasses(classList: string[]): string[] {
  return classList.filter(c => /(grid|flex)/.test(c));
}

/**
 * Build SnippetLayout following backend spec.
 * @param insertionMode where the snippet will be placed
 * @param selectedHtml HTML string being replaced (if any)
 * @param pageFp optional pageFingerprint to fall back to (contrast container)
 */
export function buildSnippetLayout(
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter',
  selectedHtml: string | null,
  pageFp?: PageFingerprint | null
): SnippetLayout {
  // Default null layout
  const empty: SnippetLayout = { container: null, wrapper: null, grid: null };

  // Case 1 – replace: derive from selectedHtml if available
  if (insertionMode === 'replace' && selectedHtml) {
    const rootClasses = extractRootClassesFromHtml(selectedHtml);
    const container = joinClasses(pickContainerClasses(rootClasses));
    const grid = joinClasses(pickGridClasses(rootClasses));
    // wrapper estimation omitted for replaced selection – not reliably detectable
    return { container, wrapper: null, grid };
  }

  // Case 2 – insertBefore / insertAfter: use first contrast container from fingerprint
  if (pageFp) {
    const contrast = pageFp.containers.find(c => c.role === 'contrast');
    if (contrast) {
      const container = joinClasses(contrast.wrapperClasses);
      const grid = joinClasses(pickGridClasses(contrast.wrapperClasses));
      return { container, wrapper: null, grid };
    }
  }

  return empty;
} 