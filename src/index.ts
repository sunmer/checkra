import { initCheckra } from './core/index';
import './core/shortcut-handler';
import { CheckraOptions } from './types';
import { CDN_DOMAIN } from './config';
import { initAnalytics } from './analytics/analytics';

// Re-export core functions and types
export { initCheckra } from './core/index';
export type { CheckraOptions } from './types';

// --- Auto-initialization logic ---

/**
 * Default options for auto-initialization.
 */
const defaultAutoInitOptions: CheckraOptions = {
  // No apiKey by default, triggers anonymous UUID
  isVisible: false, // Default to hidden
};

/**
 * Reads configuration from the script tag's data attributes.
 */
function getScriptTagConfig(): Partial<CheckraOptions> | undefined {
  if (typeof document !== 'undefined') {
    let ownScriptTag: HTMLScriptElement | null = null;
    // Prefer document.currentScript if available and seems to be us
    if (document.currentScript && (document.currentScript as HTMLScriptElement).src && (document.currentScript as HTMLScriptElement).src.includes('checkra')) {
      ownScriptTag = document.currentScript as HTMLScriptElement;
    } else {
      // Fallback: Find the script tag that likely loaded this UMD bundle.
      // This is heuristic, searches for a script tag with 'checkra' in its src.
      const scripts = document.getElementsByTagName('script');
      for (let i = scripts.length - 1; i >= 0; i--) {
        if (scripts[i].src && scripts[i].src.includes('checkra')) {
          ownScriptTag = scripts[i];
          break;
        }
      }
    }

    if (ownScriptTag) {
      const configString = ownScriptTag.getAttribute('data-checkra-config');
      if (configString) {
        try {
          const parsedConfig = JSON.parse(configString);
          // Basic validation: ensure it's an object
          if (typeof parsedConfig === 'object' && parsedConfig !== null) {
            return parsedConfig as Partial<CheckraOptions>;
          } else {
            console.error('[Checkra] data-checkra-config did not parse to an object:', parsedConfig);
          }
        } catch (e) {
          console.error('[Checkra] Failed to parse data-checkra-config JSON:', e, configString);
        }
      }
    }
  }
  return undefined;
}

/**
 * Reads configuration from a global variable if it exists.
 */
function getGlobalVariableConfig(): Partial<CheckraOptions> | undefined {
  if (typeof window !== 'undefined' && (window as any).CheckraConfig) {
    const globalConfig = (window as any).CheckraConfig;
    if (typeof globalConfig === 'object' && globalConfig !== null) {
      return globalConfig as Partial<CheckraOptions>;
    } else {
      console.error('[Checkra] window.CheckraConfig is not an object:', globalConfig);
    }
  }
  return undefined;
}

/**
 * Combines configurations from various sources with a defined precedence.
 * Precedence: Script Tag data attributes > Global window.CheckraConfig > Default options.
 */
function getFinalConfig(): CheckraOptions {
  const scriptConfig = getScriptTagConfig();
  const globalVarConfig = getGlobalVariableConfig();

  // Precedence: Script Tag > Global Var > Programmatic Options (passed to init) > Defaults
  // Note: programmatic options are handled in initCheckra itself.
  return {
    ...defaultAutoInitOptions,
    ...(globalVarConfig || {}),
    ...(scriptConfig || {}),
  };
}

// Check if running in a browser environment
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  checkForPublishedVersion(); // This handles ?checkra-variant-id for A/B testing
  initAnalytics();

  const initialize = () => {
    // Check if already initialized
    if (!(window as any).checkraInitialized) {
      try {
        const configFromSources = getFinalConfig(); // Gets script/global config merged with defaults
        console.log('[Checkra] DOM ready, auto-initializing with config from sources:', configFromSources);
        
        // initCheckra is now imported from './core/index'
        const api = initCheckra(configFromSources); 
        
        if (api) {
          (window as any).checkra = api; // Expose API globally (lowercase 'c')
          (window as any).checkraInitialized = true; // Use a consistent flag name
          document.dispatchEvent(new CustomEvent('checkraReady'));
          console.log('[Checkra] Auto-initialization complete. API exposed as window.checkra. "checkraReady" event dispatched.');
        } else {
          console.error("[Checkra] Auto-initialization failed, API not returned.");
        }
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