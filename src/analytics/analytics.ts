import pako from 'pako';
import { API_BASE as FALLBACK_API_BASE } from '../config';
import { customWarn, customError } from '../utils/logger';

interface AnalyticsEventCore {
  ts: number;         // epoch ms
  uid: string | null;  // long-lived "CheckraAnonymousId" from localStorage
  sid: string;         // per-page-load session ID
  var: string | null;  // variantId – CRITICAL for attribution
  path: string;        // page path or synthetic ID for SPA actions
  dur_ms: number;      // dwell time for the page/action
  ref: string | null;  // document.referrer
  ua: string;          // navigator.userAgent
  [key: string]: any;  // Allow additional properties from CustomAnalyticsEventData
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
    customError('[Checkra Analytics] API base URL not configured. Call initAnalytics({ apiBaseUrl: "..." }) first.');
    return;
  }

  const payload = JSON.stringify([event]); // API expects an array of events

  try {
    const gzippedPayload = pako.gzip(payload);

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
      customError(`[Checkra Analytics] Failed to send analytics event. Status: ${response.status}`, await response.text());
    } else {
    }
  } catch (error) {
    customError('[Checkra Analytics] Error sending analytics event:', error);
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
    customError('[Checkra Analytics] Unhandled error in postEvent from handlePageUnload:', error);
  });
}

export interface AnalyticsConfig {
  apiBaseUrl?: string; // Optional, will fallback to ../config.ts
}

export function initAnalytics(config?: AnalyticsConfig): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof crypto === 'undefined' || typeof localStorage === 'undefined' || typeof performance === 'undefined') {
    customWarn('[Checkra Analytics] Not initializing in non-browser or feature-limited environment.');
    return;
  }

  try {
    configuredApiBase = config?.apiBaseUrl || FALLBACK_API_BASE;
    if (!configuredApiBase) {
      customError('[Checkra Analytics] API base URL is not defined. Provide it in initAnalytics or src/config.ts.');
      return;
    }

    sessionId = crypto.randomUUID().slice(0, 10);
    pageLoadTime = performance.now();
    
    try {
      const url = new URL(window.location.href);
      variantId = url.searchParams.get('v');
    } catch (e) {
      customWarn('[Checkra Analytics] Could not parse current URL to get variantId:', e);
      variantId = null;
    }
    
    anonymousUid = localStorage.getItem(CHECKRA_ANONYMOUS_ID_KEY);
    if (!anonymousUid) {
      anonymousUid = crypto.randomUUID();
      localStorage.setItem(CHECKRA_ANONYMOUS_ID_KEY, anonymousUid);
    }
    
    userAgent = navigator.userAgent;

    window.addEventListener('beforeunload', handlePageUnload);

  } catch (error) {
    customError('[Checkra Analytics] Failed to initialize analytics:', error);
  }
}

export function sendAnalyticsEvent(eventData: CustomAnalyticsEventData): void {
  if (!sessionId) {
    customWarn('[Checkra Analytics] Analytics not initialized. Call initAnalytics() first. Event dropped:', eventData);
    return;
  }

  const now = Date.now();

  const event: AnalyticsEventCore = {
    ts: now,
    uid: anonymousUid,
    sid: sessionId,
    var: variantId,
    ref: eventData.ref !== undefined ? eventData.ref : document.referrer || null,
    ua: userAgent,
    ...eventData // Spread other custom properties
  };

  postEvent(event).catch(error => {
    customError('[Checkra Analytics] Unhandled error in postEvent from sendAnalyticsEvent:', error);
  });
}