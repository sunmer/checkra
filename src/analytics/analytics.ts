import pako from 'pako';
import { API_BASE as FALLBACK_API_BASE } from '../config';

interface AnalyticsEventCore {
  ts: number;         // epoch ms
  uid: string | null;  // long-lived "CheckraAnonymousId" from localStorage
  sid: string;         // per-page-load session ID
  var: string | null;  // variantId – CRITICAL for attribution
  path: string;        // page path or synthetic ID for SPA actions
  dur_ms: number;      // dwell time for the page/action
  ref: string | null;  // document.referrer
  ua: string;          // navigator.userAgent
}

// For custom events, some fields are optional or will be overridden
export interface CustomAnalyticsEventData {
  path: string;        // page path or synthetic ID for SPA actions
  dur_ms: number;      // dwell time for the page/action (often 0 for point-in-time conversions)
  ref?: string | null; // Optional: override document.referrer if needed for this specific event
  // Allow other optional fields, but they must conform to the overall AnalyticsEvent if extended later
  [key: string]: any; 
}

let sessionId: string;
let variantId: string | null;
let anonymousUid: string | null;
let userAgent: string;
let pageLoadTime: number;
let configuredApiBase: string;

const CHECKRA_ANONYMOUS_ID_KEY = 'CheckraAnonymousId';

async function postEvent(event: AnalyticsEventCore): Promise<void> {
  if (!configuredApiBase) {
    console.error('[Checkra Analytics] API base URL not configured. Call initAnalytics({ apiBaseUrl: "..." }) first.');
    return;
  }

  const payload = JSON.stringify([event]); // API expects an array of events
  console.log('[Checkra Analytics] Event to send:', event);

  try {
    const gzippedPayload = pako.gzip(payload);
    console.log(`[Checkra Analytics] Original size: ${payload.length} bytes, Gzipped size: ${gzippedPayload.byteLength} bytes`);

    const response = await fetch(`${configuredApiBase}/collect`, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'gzip',
        'Content-Type': 'application/json',
      },
      body: gzippedPayload,
      // keepalive: true is important for requests made during page dismissal (like in beforeunload)
      // For V1, we'll use it for all events for simplicity, though it's most critical for beforeunload.
      keepalive: true 
    });

    if (!response.ok) {
      console.error(`[Checkra Analytics] Failed to send analytics event. Status: ${response.status}`, await response.text());
    } else {
      console.log('[Checkra Analytics] Analytics event sent successfully.');
    }
  } catch (error) {
    console.error('[Checkra Analytics] Error sending analytics event:', error);
  }
}

function handlePageUnload(): void {
  if (!sessionId) return; // Not initialized

  const durationMs = Math.round(performance.now() - pageLoadTime);

  const event: AnalyticsEventCore = {
    ts: Date.now(),
    uid: anonymousUid,
    sid: sessionId,
    var: variantId,
    path: window.location.pathname + window.location.search, // Capture full path with query params for page view
    dur_ms: durationMs,
    ref: document.referrer || null,
    ua: userAgent,
  };

  // This call to postEvent is deliberately not awaited and errors are caught internally
  // to ensure it doesn't block page unload.
  postEvent(event).catch(error => {
    console.error('[Checkra Analytics] Unhandled error in postEvent from handlePageUnload:', error);
  });
}

export interface AnalyticsConfig {
  apiBaseUrl?: string; // Optional, will fallback to ../config.ts
}

export function initAnalytics(config?: AnalyticsConfig): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof crypto === 'undefined' || typeof localStorage === 'undefined' || typeof performance === 'undefined') {
    console.warn('[Checkra Analytics] Not initializing in non-browser or feature-limited environment.');
    return;
  }

  try {
    configuredApiBase = config?.apiBaseUrl || FALLBACK_API_BASE;
    if (!configuredApiBase) {
      console.error('[Checkra Analytics] API base URL is not defined. Provide it in initAnalytics or src/config.ts.');
      return;
    }

    sessionId = crypto.randomUUID().slice(0, 10);
    pageLoadTime = performance.now();
    
    try {
      const url = new URL(window.location.href);
      variantId = url.searchParams.get('v');
    } catch (e) {
      console.warn('[Checkra Analytics] Could not parse current URL to get variantId:', e);
      variantId = null;
    }
    
    anonymousUid = localStorage.getItem(CHECKRA_ANONYMOUS_ID_KEY);
    if (!anonymousUid) {
      anonymousUid = crypto.randomUUID();
      localStorage.setItem(CHECKRA_ANONYMOUS_ID_KEY, anonymousUid);
    }
    
    userAgent = navigator.userAgent;

    window.addEventListener('beforeunload', handlePageUnload);

    console.log('[Checkra Analytics] Initialized. Configured API Base:', configuredApiBase, { sessionId, variantId, anonymousUid, userAgent });
  } catch (error) {
    console.error('[Checkra Analytics] Failed to initialize analytics:', error);
  }
}