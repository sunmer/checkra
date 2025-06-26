// @ts-ignore - Using Vite's ?inline import
import checkraCss from '../shared.css?inline';

export interface EnsureSharedCssOptions {
  nonce?: string;
}

/**
 * Ensures the Checkra shared CSS palette is injected into the document.
 * This is idempotent - multiple calls will not create duplicate style elements.
 * 
 * @param id - The ID for the style element (default: 'checkra-css')
 * @param opts - Options including CSP nonce if needed
 */
export function ensureSharedCss(id = 'checkra-css', opts: EnsureSharedCssOptions = {}): void {
  if (typeof document === 'undefined') return; // SSR guard
  
  if (document.getElementById(id)) return; // Already injected
  
  const style = document.createElement('style');
  style.id = id;
  
  if (opts.nonce) {
    style.nonce = opts.nonce;
  }
  
  style.textContent = checkraCss;
  document.head.appendChild(style);
} 