import pako from 'pako';
import { API_BASE } from '../config';

interface AnalyticsEvent {
  ts: number;
  uid: string | null;
  sid: string;
  var: string | null;
  path: string;
  dur_ms: number;
  ref: string | null;
  ua: string;
}

let sessionId: string;
let pageStart: number;
let variantId: string | null;
let uid: string | null;

async function sendAnalyticsEvent(event: AnalyticsEvent): Promise<void> {
  const payload = JSON.stringify([event]); // API expects an array of events
  console.log('[Checkra Analytics] Event to send:', event);

  try {
    const gzippedPayload = pako.gzip(payload);
    console.log(`[Checkra Analytics] Original size: ${payload.length}, Gzipped size: ${gzippedPayload.byteLength}`);

    // const API_ENDPOINT = `${API_BASE}/collect`; // Defined in prompt, using API_BASE

    // Regarding navigator.sendBeacon:
    // The prompt mentions using sendBeacon for payloads < 60kB.
    // However, sendBeacon does not allow setting 'Content-Encoding: gzip' header from client-side.
    // Since the /collect endpoint is specified to expect gzipped content,
    // using fetch with pako for gzipping is the most reliable way to meet that requirement for MVP.
    // If the endpoint could handle uncompressed data from sendBeacon, that path could be explored.

    // For MVP, always using fetch to ensure gzipped payload with correct headers.
    const response = await fetch(`${API_BASE}/collect`, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'gzip',
        'Content-Type': 'application/json',
      },
      body: gzippedPayload,
      keepalive: true // Important for requests made during page dismissal (like in beforeunload)
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

function handleBeforeUnload(): void {
  const dur_ms = Math.round(performance.now() - pageStart);

  const event: AnalyticsEvent = {
    ts: Date.now(),
    uid: uid,
    sid: sessionId,
    var: variantId,
    path: window.location.pathname,
    dur_ms: dur_ms,
    ref: document.referrer || null,
    ua: navigator.userAgent,
  };

  sendAnalyticsEvent(event).catch(error => {
    console.error('[Checkra Analytics] Unhandled error in sendAnalyticsEvent from beforeunload:', error);
  });
}

export function initAnalytics(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return; // Don't run in non-browser environments
  }

  try {
    sessionId = crypto.randomUUID().slice(0, 10);
    pageStart = performance.now();
    variantId = new URL(window.location.href).searchParams.get('v');
    uid = localStorage.getItem('CheckraAnonymousId'); // Explicitly use CheckraAnonymousId as per prompt

    console.log('[Checkra Analytics] Initialized with:', { sessionId, pageStart, variantId, uid });

    window.addEventListener('beforeunload', handleBeforeUnload);
  } catch (error) {
    console.error('[Checkra Analytics] Failed to initialize analytics:', error);
  }
} 