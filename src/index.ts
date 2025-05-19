import { initCheckra } from './core/index';
import './core/shortcut-handler';
import { CheckraOptions } from './types';
import { CDN_DOMAIN } from './config';
import { initAnalytics } from './analytics/event-tracker';

// Re-export core functions and types
export { initCheckra } from './core/index';
export type { CheckraOptions } from './types';

// --- Auto-initialization logic ---

/**
 * Default options for auto-initialization.
 */
const defaultAutoInitOptions: CheckraOptions = {
  isVisible: true, // Use isVisible
  // Add other default options here if needed in the future
};

/**
 * Reads configuration from a global variable if it exists.
 * Allows users to configure Checkra *before* the script tag.
 * Example: <script>window.CheckraConfig = { isVisible: false };</script>
 *          <script src="path/to/logger.js"></script>
 */
function getGlobalConfig(): CheckraOptions | undefined {
  const globalConfig = (window as any).CheckraConfig; // Use CheckraConfig for clarity
  if (typeof window !== 'undefined' && globalConfig) {
    // Merge global config with defaults, letting global config override
    return {
      ...defaultAutoInitOptions,
      ...globalConfig // Spread the global config object
    };
  }
  // Return only defaults if no global config is found
  return defaultAutoInitOptions;
}

// Check if running in a browser environment
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  checkForPublishedVersion();
  initAnalytics();

  const initialize = () => {
    // Check if already initialized
    if (!(window as any).CheckraInitialized) {
      try {
        const options = getGlobalConfig();
        console.log('[Checkra] DOM ready, auto-initializing...');
        initCheckra(options);
        (window as any).CheckraInitialized = true;
      } catch (e) {
        console.error("[Checkra] Failed to auto-initialize:", e);
      }
    } else {
      console.log("[Checkra] Already initialized, skipping auto-init.");
    }
  };

  // Check if DOM is already loaded (e.g., script loaded async defer or at end of body)
  if (document.readyState === 'loading') {
    // Loading hasn't finished yet
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    // `DOMContentLoaded` has already fired
    initialize();
  }
}

// Helper to inject a <link rel="preconnect"> for CDN
function injectPreconnect(url: string): void {
  if (document.head.querySelector(`link[rel="preconnect"][href="${url}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = url;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

// Helper to inject a <link rel="prefetch"> for the variant JSON (high priority fetch hint)
function injectPrefetch(url: string): void {
  if (document.head.querySelector(`link[rel="prefetch"][href="${url}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'fetch';
  link.href = url;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

// Helper to temporarily hide body until patch applied
function addFlickerGuard(): HTMLStyleElement {
  const style = document.createElement('style');
  style.id = 'checkra-flicker-guard';
  style.textContent = 'body{opacity:0 !important;transition:none !important;}';
  document.head.appendChild(style);
  return style;
}

function removeFlickerGuard(styleEl: HTMLStyleElement | null): void {
  if (styleEl && styleEl.parentNode) {
    styleEl.parentNode.removeChild(styleEl);
  }
}

// Boot-loader logic for ?v= parameter
async function applyPublishedSnapshot(variantId: string): Promise<void> {
  const snapshotUrl = `https://${CDN_DOMAIN}/variants/${variantId}.json`;
  console.log(`[Checkra Bootloader] Detected variantId: ${variantId}. Fetching snapshot from: ${snapshotUrl}`);

  // Preconnect & prefetch hints (best-effort)
  injectPreconnect(`https://${CDN_DOMAIN}`);
  injectPrefetch(snapshotUrl);

  // Add flicker guard as early as possible
  const guardStyle = addFlickerGuard();

  try {
    const response = await fetch(snapshotUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch snapshot: ${response.status} ${response.statusText}`);
    }
    const snapshot = await response.json();
    console.log("[Checkra Bootloader] Snapshot data fetched:", snapshot);

    if (snapshot && snapshot.changes && Array.isArray(snapshot.changes)) {
      if (document.readyState === 'loading') {
        await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      }

      console.log(`[Checkra Bootloader] Applying ${snapshot.changes.length} changes...`);
      // Batch DOM mutations inside a single frame for minimal layout thrash
      requestAnimationFrame(() => {
        for (const change of snapshot.changes) {
          if (change.targetSelector && typeof change.targetSelector === 'string' && typeof change.appliedHtml === 'string') {
            try {
              const targetElement = document.querySelector(change.targetSelector);
              if (targetElement) {
                if (targetElement.parentNode) {
                  targetElement.outerHTML = change.appliedHtml;
                } else {
                  console.warn(`[Checkra Bootloader] Target element for selector: ${change.targetSelector} has no parent. Cannot apply outerHTML.`);
                }
              } else {
                console.warn(`[Checkra Bootloader] Target element not found for selector: ${change.targetSelector}`);
              }
            } catch (e) {
              console.error(`[Checkra Bootloader] Error applying change for selector ${change.targetSelector}:`, e);
            }
          }
        }
        removeFlickerGuard(guardStyle);
      });
      console.log("[Checkra Bootloader] Finished applying snapshot changes.");
    } else {
      console.warn("[Checkra Bootloader] Snapshot data is invalid or has no changes.", snapshot);
      removeFlickerGuard(guardStyle);
    }
  } catch (error) {
    console.error("[Checkra Bootloader] Error loading or applying snapshot:", error);
    removeFlickerGuard(guardStyle);
  }
}

function checkForPublishedVersion(): void {
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    const urlParams = new URLSearchParams(window.location.search);
    const variantId = urlParams.get('checkra-variant-id');
    if (variantId) {
      // Preconnect as early as possible
      injectPreconnect(`https://${CDN_DOMAIN}`);
      const prefetchUrl = `https://${CDN_DOMAIN}/variants/${variantId}.json`;
      injectPrefetch(prefetchUrl);

      applyPublishedSnapshot(variantId).catch(err => {
        console.error("[Checkra Bootloader] Unhandled error in applyPublishedSnapshot:", err);
      });
    }
  }
}