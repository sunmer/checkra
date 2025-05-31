import { initCheckra } from './core/index';
import './core/shortcut-handler';
import { CheckraOptions } from './types';
import { API_BASE } from './config';
import { initAnalytics } from './analytics/analytics';
import { customWarn, customError } from './utils/logger';
import { fetchProtected, isLoggedIn } from './auth/auth';
import { getSiteId } from './utils/id';

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
  enableRating: false, // ADDED: Default for enableRating in auto-init
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
            customError('[Checkra] data-checkra-config did not parse to an object:', parsedConfig);
          }
        } catch (e) {
          customError('[Checkra] Failed to parse data-checkra-config JSON:', e, configString);
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
      customError('[Checkra] window.CheckraConfig is not an object:', globalConfig);
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

// Helper to inject a <link rel="preconnect"> for a given URL origin
function injectPreconnect(url: string): void {
  try {
    const targetOrigin = new URL(url).origin;
    if (document.head.querySelector(`link[rel="preconnect"][href="${targetOrigin}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = targetOrigin;
    link.crossOrigin = 'anonymous'; // Often needed for cross-origin preconnects
    document.head.appendChild(link);
  } catch (e) {
    customError("[Checkra] Failed to inject preconnect for URL:", url, e);
  }
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

// Unified boot-loader logic for snapshots from API (?checkra-id=...)
async function applySnapshotFromApi(snapshotId: string): Promise<void> {
  // Ensure DOM is ready before auth checks or siteId retrieval, as these might depend on it.
  if (document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }

  const siteId = getSiteId();
  if (!siteId) {
    customError("[Checkra Bootloader] Site ID not found. Cannot fetch snapshot from API.");
    return; // Cannot proceed without siteId for the API path
  }

  const apiUrl = `${API_BASE}/sites/${siteId}/snapshots/${snapshotId}`;
  injectPreconnect(API_BASE); // Preconnect to the API base URL
  const guardStyle = addFlickerGuard();
  let response: Response;

  try {
    const loggedIn = await isLoggedIn();

    if (loggedIn) {
      response = await fetchProtected(apiUrl, { method: 'GET' });
    } else {
      response = await fetch(apiUrl, { method: 'GET' });
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        customWarn(`[Checkra Bootloader] Unauthorized (or not owner of private draft) for snapshot ${snapshotId}. Status: ${response.status}`);
      } else if (response.status === 404) {
        customWarn(`[Checkra Bootloader] Snapshot ${snapshotId} not found. Status: ${response.status}`);
      } else {
        customError(`[Checkra Bootloader] Failed to fetch snapshot ${snapshotId} from API: ${response.status} ${response.statusText}`);
      }
      removeFlickerGuard(guardStyle);
      return;
    }

    const snapshot = await response.json();

    if (snapshot && snapshot.changes && Array.isArray(snapshot.changes) && snapshot.changes.length > 0) {
      // DOM should be ready here due to the check at the beginning of the function
      requestAnimationFrame(() => {
        for (const change of snapshot.changes) {
          if (change.targetSelector && typeof change.targetSelector === 'string' && typeof change.appliedHtml === 'string') {
            try {
              const targetElement = document.querySelector(change.targetSelector);
              if (targetElement) {
                if (targetElement.parentNode) {
                  targetElement.outerHTML = change.appliedHtml;
                } else {
                  customWarn(`[Checkra Bootloader] Target element for selector: ${change.targetSelector} has no parent. Cannot apply outerHTML.`);
                }
              } else {
                customWarn(`[Checkra Bootloader] Target element not found for selector: ${change.targetSelector}`);
              }
            } catch (e) {
              customError(`[Checkra Bootloader] Error applying change for selector ${change.targetSelector}:`, e);
            }
          }
        }
        removeFlickerGuard(guardStyle);
        // After successfully applying, update the URL to remove the checkra-id to prevent re-application on refresh/back nav
        // And to provide a cleaner URL if the user shares it.
        if (window.history.replaceState) {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete('checkra-id');
          window.history.replaceState({ path: cleanUrl.toString() }, '', cleanUrl.toString());
        }
      });
    } else {
      customWarn("[Checkra Bootloader] Snapshot data from API is invalid, has no changes, or changes array is empty.", snapshot);
      removeFlickerGuard(guardStyle);
    }
  } catch (error) {
    customError(`[Checkra Bootloader] Error loading or applying snapshot ${snapshotId} from API:`, error);
    removeFlickerGuard(guardStyle);
  }
}

// Renamed and simplified function
function checkForCheckraIdInUrl(): void {
  if (typeof window !== 'undefined' && window.location && window.location.search) {
    const urlParams = new URLSearchParams(window.location.search);
    const snapshotId = urlParams.get('checkra-id'); // Use 'checkra-id' consistently

    if (snapshotId) {
      // Preconnect to API_BASE is handled within applySnapshotFromApi
      applySnapshotFromApi(snapshotId).catch(err => {
        customError("[Checkra Bootloader] Unhandled error in applySnapshotFromApi:", err);
      });
    }
  }
}

// Check if running in a browser environment
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  checkForCheckraIdInUrl(); // Updated function call
  initAnalytics();

  const initialize = () => {
    // Check if already initialized
    if (!(window as any).checkraInitialized) {
      try {
        const configFromSources = getFinalConfig();
        const api = initCheckra(configFromSources);
        if (api) {
          (window as any).checkra = api;
          (window as any).checkraInitialized = true;
          document.dispatchEvent(new CustomEvent('checkraReady'));
        } else {
          customError("[Checkra] Auto-initialization failed, API not returned.");
        }
      } catch (e) {
        customError("[Checkra] Failed to auto-initialize:", e);
      }
    } else {
      // console.log("[Checkra] Already auto-initialized.");
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
}