import { customWarn } from './logger';

// Use the version of lucide-static from your package.json, or 'latest'
// It's good practice to lock this to a specific version matching your expectations.
const LUCIDE_VERSION = '0.512.0'; // Or dynamically get from package.json during build if needed
const LUCIDE_CDN_BASE_URL = `https://cdn.jsdelivr.net/npm/lucide-static@${LUCIDE_VERSION}/icons/`;

// Tracks whether the MutationObserver has been set up already.
let lucideObserverInstalled = false;

function installLucideObserver(): void {
  if (lucideObserverInstalled || typeof MutationObserver === 'undefined') return;

  try {
    const observer = new MutationObserver((mutations) => {
      let shouldRender = false;
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node.nodeType !== 1) continue; // element nodes only
          const el = node as HTMLElement;
          if (el.matches && el.matches('i[data-lucide]')) {
            shouldRender = true;
            break;
          }
          if (el.querySelector && el.querySelector('i[data-lucide]')) {
            shouldRender = true;
            break;
          }
        }
        if (shouldRender) break;
      }
      if (shouldRender) {
        // Fire and forget; we don't await to avoid observer recursion.
        renderLucideIcons().catch((e) => customWarn('[IconRenderer] Error during observer-triggered render:', e));
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    lucideObserverInstalled = true;
    customWarn('[IconRenderer] MutationObserver installed to auto-render Lucide icons on new DOM nodes.');
  } catch (e) {
    customWarn('[IconRenderer] Failed to install MutationObserver for Lucide icons:', e);
  }
}

/**
 * Renders Lucide icons by fetching SVG strings from a CDN
 * and replacing <i data-lucide="..."> placeholders.
 */
export async function renderLucideIcons(): Promise<void> {
  let nodes: HTMLElement[] = [];
  try {
    nodes = Array.from(document.querySelectorAll<HTMLElement>('i[data-lucide]'));
  } catch (e) {
    customWarn('[IconRenderer] Error querying for lucide icons (document may not be ready):', e);
    return;
  }

  // Install observer (once) so future DOM changes also trigger rendering.
  installLucideObserver();

  if (nodes.length === 0) {
    return;
  }

  // customWarn(`[IconRenderer] Found ${nodes.length} lucide icon(s) to process via CDN.`);

  await Promise.all(nodes.map(async (iconPlaceholderElement) => {
    const iconName = iconPlaceholderElement.getAttribute('data-lucide')?.trim().toLowerCase();

    if (!iconName) {
      customWarn('[IconRenderer] Found an <i> tag with data-lucide attribute but no value.', iconPlaceholderElement);
      return;
    }

    if (!/^[a-z0-9-]+$/.test(iconName)) {
        customWarn(`[IconRenderer] Invalid lucide icon name format: "${iconName}". Skipping.`);
        return;
    }

    try {
      const response = await fetch(`${LUCIDE_CDN_BASE_URL}${iconName}.svg`);
      if (!response.ok) {
        // Attempt to provide a more specific error for 404s (icon likely doesn't exist)
        if (response.status === 404) {
            customWarn(`[IconRenderer] Failed to fetch icon "${iconName}" (Error 404). Icon may not exist in lucide-static@${LUCIDE_VERSION}. URL: ${response.url}`);
        } else {
            customWarn(`[IconRenderer] Failed to fetch icon "${iconName}". Status: ${response.status} ${response.statusText}. URL: ${response.url}`);
        }
        return; // Stop processing this icon if fetch failed
      }
      const svgString = await response.text();

      if (typeof svgString !== 'string') {
        customWarn(`[IconRenderer] Unexpected fetch response for icon "${iconName}": not a string.`);
        return;
      }

      const tempContainer = document.createElement('div');
      tempContainer.innerHTML = svgString.trim();
      const svgElement = tempContainer.querySelector('svg');

      if (svgElement && svgElement.tagName.toLowerCase() === 'svg') {
        const placeholderClasses = iconPlaceholderElement.getAttribute('class');
        if (placeholderClasses) {
          const existingSvgClasses = svgElement.getAttribute('class') || '';
          svgElement.setAttribute('class', (existingSvgClasses + ' ' + placeholderClasses).trim());
        }
        if (!svgElement.classList.contains('lucide')) {
            svgElement.classList.add('lucide');
        }
        if (!svgElement.classList.contains(`lucide-${iconName}`)) {
            svgElement.classList.add(`lucide-${iconName}`);
        }

        const placeholderStyle = iconPlaceholderElement.getAttribute('style');
        if (placeholderStyle) {
          // Combine styles, letting placeholder's potentially override SVG's defaults if names clash, otherwise append.
          // A more sophisticated merge might be needed for complex cases, but string concat is common.
          const existingStyle = svgElement.getAttribute('style') || '';
          svgElement.setAttribute('style', (existingStyle.endsWith(';') ? existingStyle : existingStyle + (existingStyle ? ';' : '')) + placeholderStyle);
        }
        
        for (const attr of iconPlaceholderElement.attributes) {
            if ((attr.name.startsWith('data-') && attr.name !== 'data-lucide') || attr.name.startsWith('aria-')) {
                svgElement.setAttribute(attr.name, attr.value);
            }
        }
        
        // Ensure aria-hidden is set if no other accessible name is provided
        const hasAccessibleName = svgElement.querySelector('title') || 
                                  svgElement.getAttribute('aria-labelledby') || 
                                  svgElement.getAttribute('aria-label') ||
                                  iconPlaceholderElement.getAttribute('aria-label') || 
                                  iconPlaceholderElement.getAttribute('aria-labelledby');
                                  
        if (!hasAccessibleName) {
            svgElement.setAttribute('aria-hidden', iconPlaceholderElement.getAttribute('aria-hidden') ?? 'true');
        }

        iconPlaceholderElement.replaceWith(svgElement);
      } else {
        customWarn(`[IconRenderer] Could not locate <svg> element in fetched content for icon "${iconName}". Raw content snippet:`, svgString.substring(0,120));
      }
    } catch (error) {
      customWarn(`[IconRenderer] Error loading or processing lucide icon "${iconName}" from CDN:`, error);
    }
  }));
} 