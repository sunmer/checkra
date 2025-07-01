import Settings from '../settings';
import { getEffectiveApiKey, getCurrentAiSettings } from '../core/index';
import { customWarn, customError } from '../utils/logger';
// import html2canvas from 'html2canvas'; // Eager import removed
import { CSS_ATOMIC_MAP } from '../utils/css-map';
import { detectCssFramework, DetectedFramework } from '../utils/framework-detector';
import { detectUiKit, UiKitDetection } from '../utils/ui-kit-detector';
import { generateColorScheme } from '../utils/color-utils';
import {
  GenerateSuggestionRequestbody,
  AddRatingRequestBody,
  PageMetadata,
  BackendPayloadMetadata
} from '../types';

let serviceEventEmitter: any = null; // Local reference to the event emitter

// Type for the html2canvas function itself
type Html2CanvasStatic = (element: HTMLElement, options?: Partial<any>) => Promise<HTMLCanvasElement>;
// The above 'any' for options is a simplification; you might want to import Options type from html2canvas if needed elsewhere

let h2cModule: Html2CanvasStatic | null = null;

async function getHtml2Canvas(): Promise<Html2CanvasStatic | null> {
  if (h2cModule) return h2cModule;
  try {
    const imported = await import('html2canvas');
    // html2canvas is a default export which is the function itself
    h2cModule = imported.default;
    if (typeof h2cModule !== 'function') {
      customError('[AI Service] html2canvas loaded but is not a function. Loaded:', h2cModule);
      h2cModule = null; // Reset if not valid
      if (serviceEventEmitter) { // Check if emitter is initialized
        serviceEventEmitter.emit('error', { source: 'ai-service', error: new Error('html2canvas lib failed to load') });
      }
      return null;
    }
    return h2cModule;
  } catch (error) {
    customError('[AI Service] Failed to dynamically load html2canvas:', error);
    if (serviceEventEmitter) { // Check if emitter is initialized
      serviceEventEmitter.emit('error', { source: 'ai-service', error: new Error('html2canvas lib failed to load') });
    }
    return null;
  }
}

const buildTokensMap = (classesUsed: Set<string>, frameworkName: string): Record<string,string> => {
  const map: Record<string,string> = {};
  if (frameworkName === 'tailwind') {
    classesUsed.forEach(cls => {
      const decl = CSS_ATOMIC_MAP[cls];
      if (decl) map[cls] = decl;
    });
  } else {
    // Fallback: compute styles directly.
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    classesUsed.forEach(cls => {
      probe.className = cls;
      const style = getComputedStyle(probe);
      const fs = style.fontSize ? `font-size:${style.fontSize};` : '';
      const lh = style.lineHeight ? `line-height:${style.lineHeight};` : '';
      const color = style.color && style.color !== 'rgba(0, 0, 0, 0)' ? `color:${style.color};` : '';
      const bg = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `background-color:${style.backgroundColor};` : '';
      const bs = style.boxShadow && style.boxShadow !== 'none' ? `box-shadow:${style.boxShadow};` : '';
      const decl = `${fs}${lh}${color}${bg}${bs}`.replace(/;;+/g, ';');
      if (decl) map[cls] = decl;
    });
    document.body.removeChild(probe);
  }
  return map;
};

interface CssContext {
  comment: string;
  cssDigests: any;
  frameworkDetection: import('../utils/framework-detector').DetectedFramework;
}

const produceCssContext = (htmlString: string): CssContext => {
  if (!htmlString) {
    const fd = detectCssFramework();
    const emptyDigest = {
      [fd.name]: {
        version: fd.version,
        tokens: {}
      }
    };
    return {
      comment: '<!-- cssDigests: {} -->',
      cssDigests: emptyDigest,
      frameworkDetection: fd
    };
  }
   
  const classRegex = /class="([^"]*)"/g;
  let match;
  const classesUsed = new Set<string>();

  while ((match = classRegex.exec(htmlString)) !== null) {
    const classes = match[1].split(/\s+/);
    classes.forEach(cls => {
      if (cls.trim()) {
        classesUsed.add(cls.trim());
      }
    });
  }

  const framework = detectCssFramework();
  const digestTokens = buildTokensMap(classesUsed, framework.name);

  const cssDigests: any = {
    [framework.name]: {
      version: framework.version,
      tokens: digestTokens
    }
  };

  return {
    comment: `<!-- cssDigests: ${JSON.stringify(cssDigests)} -->`,
    cssDigests,
    frameworkDetection: framework
  };
};

const extractColorsFromElement = async (element: HTMLElement): Promise<{ primary?: string; accent?: string } | null> => {
  const html2canvasRenderFunc = await getHtml2Canvas();
  if (!html2canvasRenderFunc) {
    customWarn('[Checkra Service] html2canvas not available, cannot extract colors from screenshot.');
    return null;
  }

  try {
    const canvas = await html2canvasRenderFunc(element, {
      scale: 0.25, // Lower scale for performance if full detail isn't needed for color extraction
      height: window.innerHeight,
      windowHeight: window.innerHeight,
      y: window.scrollY,
      logging: false
    });

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const colorCounts: { [key: string]: number } = {};
    const step = 4 * 5;

    for (let i = 0; i < data.length; i += step) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 200) continue;
      if (r > 240 && g > 240 && b > 240) continue;
      if (r < 15 && g < 15 && b < 15) continue;

      const quantR = Math.round(r / 32) * 32;
      const quantG = Math.round(g / 32) * 32;
      const quantB = Math.round(b / 32) * 32;
      const colorKey = `rgb(${quantR},${quantG},${quantB})`;

      colorCounts[colorKey] = (colorCounts[colorKey] || 0) + 1;
    }

    const sortedColors = Object.entries(colorCounts).sort(([, countA], [, countB]) => countB - countA);

    if (sortedColors.length === 0) return null;

    const primary = sortedColors[0][0];
    let accent;
    if (sortedColors.length > 1) {
      for (let i = 1; i < sortedColors.length; i++) {
        if (sortedColors[i][0] !== primary) {
          accent = sortedColors[i][0];
          break;
        }
      }
      if (!accent) accent = sortedColors.length > 1 ? sortedColors[1][0] : undefined;
    }

    return { primary, accent };

  } catch (error) {
    customWarn('[Checkra Service] Failed to extract colors from screenshot:', error);
    return null;
  }
};

// ---------- NEW HELPER: mapHexToUtilityToken -----------------------------
/**
 * Try to translate a hex colour (e.g. "#2563eb") to a utility class token
 * understood by the detected CSS framework (e.g. "bg-blue-600" for Tailwind).
 * Currently supports Tailwind by scanning CSS_ATOMIC_MAP.  Returns null if no
 * mapping is found.
 */
function mapHexToUtilityToken(hex: string | undefined | null, frameworkName: string): string | null {
  if (!hex) return null;
  const normalised = hex.trim().toLowerCase();
  if (!normalised.startsWith('#')) return null;

  if (frameworkName === 'tailwind') {
    for (const [token, decl] of Object.entries(CSS_ATOMIC_MAP)) {
      if (decl && decl.toLowerCase().includes(normalised)) {
        // Only keep colour-related utility classes
        if (token.startsWith('bg-') || token.startsWith('text-') || token.startsWith('border-')) {
          return token;
        }
      }
    }
  }
  // TODO: Add Bootstrap / MUI palette lookup here if desired
  return null;
}
// ------------------------------------------------------------------------

/**
 * Gathers metadata from the current page.
 */
const getPageMetadata = async (): Promise<PageMetadata> => {
  const metadata: Partial<PageMetadata> = {};

  // 1. Title
  metadata.title = document.title || null;

  // 2. Meta Description
  const descriptionTag = document.querySelector('meta[name="description"]');
  metadata.description = descriptionTag ? descriptionTag.getAttribute('content') : null;

  // 3. OG Title
  const ogTitleTag = document.querySelector('meta[property="og:title"]');
  metadata.ogTitle = ogTitleTag ? ogTitleTag.getAttribute('content') : null;

  // 4. Viewport Size
  metadata.viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
  metadata.url = window.location.href;
  metadata.language = document.documentElement.lang || null;
  const h1Tag = document.querySelector('h1');
  metadata.h1 = h1Tag ? h1Tag.textContent?.trim() || null : null;

  // --- New brand colour & lever extraction ---
  try {
    const frameworkInfo = detectCssFramework();
    const { colours, lever, perf } = await (await import('../utils/design-tokens')).resolveBrandColors(
      document.body,
      frameworkInfo,
      document.body.outerHTML,
      extractColorsFromElement
    );
    if (colours) {
      const primaryToken = mapHexToUtilityToken(colours.primary, frameworkInfo.name);
      const accentToken  = mapHexToUtilityToken(colours.accent, frameworkInfo.name);

      metadata.brand = {
        inferred: colours,
        primary: primaryToken ? primaryToken : colours.primary,
        accent: accentToken ? accentToken : colours.accent,
        // Pass through tokens as separate fields for backend debugging
        primaryUtilityToken: primaryToken || null,
        accentUtilityToken : accentToken  || null,
      } as any;
    }
    if (lever) {
      // @ts-ignore attach custom for now; will be forwarded later
      (metadata as any).leverValues = lever;
    }
    // Attach perfHints so backend can debug slow paths
    // @ts-ignore
    (metadata as any).perfHints = perf;
    // generate palette if not already done
    if (colours?.primary && colours?.accent) {
      const palette = generateColorScheme(colours.primary, colours.accent);
      if (palette.length === 5) (metadata.brand as any).palette = palette;
    }
  } catch (err) {
    customWarn('[Checkra Service] Brand extraction failed:', err);
  }

  return metadata as PageMetadata;
};

/**
 * Base function for handling feedback/audit requests and streaming SSE responses.
 */
const fetchFeedbackBase = async (
  apiUrl: string,
  promptText: string,
  selectedHtml: string | null,
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter',
  imageDataUrl?: string | null
): Promise<void> => {
  try {
    const pageMeta = await getPageMetadata(); // Renamed to pageMeta for clarity
    const currentAiSettings = getCurrentAiSettings();

    let sanitizedHtml: string | null = selectedHtml ? selectedHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') : null;
    let processedHtml = sanitizedHtml;
    
    // These will now be part of BackendPayloadMetadata
    let cssDigestsForPayload: any = null;
    let frameworkDetectionForPayload: DetectedFramework | undefined = undefined;
    let uiKitDetectionForPayload: UiKitDetection | undefined = undefined;

    if (sanitizedHtml) {
      const cssCtx = produceCssContext(sanitizedHtml || '');
      processedHtml = `${cssCtx.comment}\n${sanitizedHtml}`;
      cssDigestsForPayload = cssCtx.cssDigests;
      frameworkDetectionForPayload = cssCtx.frameworkDetection;
      uiKitDetectionForPayload = sanitizedHtml ? detectUiKit(sanitizedHtml) : undefined;
    } else {
      // Even if no HTML is selected, we might want to send framework/UI kit info if detected globally
      // For now, only produceCssContext is called if selectedHtml exists.
      // If global detection is desired, detectCssFramework() and detectUiKit() could be called here.
      // For simplicity, keeping existing logic: these are only populated if selectedHtml exists.
      const globalFramework = detectCssFramework(); // Detect framework globally
      frameworkDetectionForPayload = globalFramework;
      // uiKitDetectionForPayload can be based on document.body.outerHTML if needed, but might be too broad.
      // For now, uiKitDetectionForPayload will only be set if selectedHtml is present.
    }
    
    // Construct BackendPayloadMetadata
    const backendMetadata: BackendPayloadMetadata = {
      ...pageMeta, // Spread PageMetadata
      cssDigests: cssDigestsForPayload,
      frameworkDetection: frameworkDetectionForPayload,
      uiKitDetection: uiKitDetectionForPayload
    };

    const requestBody: GenerateSuggestionRequestbody = {
      prompt: promptText,
      metadata: backendMetadata, // Use the consolidated metadata
      aiSettings: currentAiSettings,
      insertionMode: insertionMode
    };

    if (sanitizedHtml) {
      requestBody.html = processedHtml;
      requestBody.htmlCharCount = sanitizedHtml.length;
      // cssDigests, frameworkDetection, uiKitDetection are now part of requestBody.metadata
    }

    // Emit the request body so checkra-impl can store it with the full metadata
    if (serviceEventEmitter) {
      serviceEventEmitter.emit('requestBodyPrepared', requestBody);
    }

    const currentApiKey = getEffectiveApiKey();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (currentApiKey) {
      headers['Authorization'] = `Bearer ${currentApiKey}`;
    } else {
      customWarn('[Checkra Service] API key/anonymous ID not available for request.');
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let specificErrorMessage = `Request failed: ${response.status} ${response.statusText}`;
      try {
        const errorBodyText = await response.text();
        if (errorBodyText) {
          const errorJson = JSON.parse(errorBodyText);
          if (errorJson && errorJson.error) {
            specificErrorMessage = errorJson.error;
          }
        }
      } catch (parseError) {
        customWarn("[Checkra Service] Failed to parse error response body:", parseError);
      }
      throw new Error(specificErrorMessage);
    }

    if (!response.body) {
      throw new Error("Response body is null, cannot process stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          if (buffer.startsWith('data:')) {
            try {
              const jsonString = buffer.substring(5).trim();
              if (jsonString) {
                const data = JSON.parse(jsonString);
                if (data.type === 'json-patch') {
                  let parsedPayload: any = data.payload;
                  try { parsedPayload = JSON.parse(data.payload || jsonString); } catch (e) { /* ... */ }
                  if (serviceEventEmitter) serviceEventEmitter.emit('aiJsonPatch', { payload: parsedPayload, originalHtml: data.originalHtml || '' });
                } else if (data.content) {
                  if (serviceEventEmitter) serviceEventEmitter.emit('aiResponseChunk', data.content);
                } else { /* ... */ }
              }
            } catch (e) { /* ... */ }
          }
        }
        if (serviceEventEmitter) serviceEventEmitter.emit('aiFinalized');
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEventType = line.substring(6).trim();
        } else if (line.startsWith('data:')) {
          try {
            const jsonString = line.substring(5).trim();
            if (jsonString) {
              const parsedData = JSON.parse(jsonString);
              if (currentEventType) {
                if (currentEventType === 'analysis') {
                  if (parsedData.content && serviceEventEmitter) {
                    serviceEventEmitter.emit('aiResponseChunk', parsedData.content);
                  }
                } else if (currentEventType === 'domUpdateHtml') {
                  if (parsedData.html && parsedData.insertionMode) {
                    if (serviceEventEmitter) {
                      serviceEventEmitter.emit('aiDomUpdateReceived', {
                        html: parsedData.html,
                        insertionMode: parsedData.insertionMode,
                      });
                    }
                  } else {
                    customWarn('[AI Service] Received domUpdateHtml event with missing html or insertionMode:', parsedData);
                  }
                } else {
                  // For unforeseen named events, just forward them generically.
                  if (serviceEventEmitter) {
                    serviceEventEmitter.emit(currentEventType, parsedData);
                  }
                }
                currentEventType = null;
              } else {
                // No currentEventType – ignore (protocol guarantees named events).
              }
            }
          } catch (e) {
            if (serviceEventEmitter) serviceEventEmitter.emit('aiError', `Error parsing stream data: ${e instanceof Error ? e.message : String(e)}`);
            currentEventType = null;
          }
        }
      }
    }
  } catch (error) {
    customError("Error in fetchFeedbackBase:", error);
    if (serviceEventEmitter) { // Check if emitter is initialized
      serviceEventEmitter.emit('aiError', error instanceof Error ? error.message : String(error));
    }
  }
};

/**
 * Sends regular feedback (specific section or general prompt) to the /feedback endpoint.
 */
export const fetchFeedback = async (
  imageDataUrl: string | null,
  promptText: string,
  selectedHtml: string | null,
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter'
): Promise<void> => {
  const apiUrl = `${Settings.API_URL}/checkraCompletions/generate`;
  return fetchFeedbackBase(apiUrl, promptText, selectedHtml, insertionMode, imageDataUrl);
};

/**
 * Sends the rated fix to the backend.
 */
export const sendFixRating = async (feedbackPayload: AddRatingRequestBody): Promise<void> => {
  const apiUrl = `${Settings.API_URL}/checkraCompletions/rating`;
  const currentApiKey = getEffectiveApiKey();
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (currentApiKey) {
    headers['Authorization'] = `Bearer ${currentApiKey}`;
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(feedbackPayload),
    });

    if (!response.ok) {
      let specificErrorMessage = `Rating submission failed: ${response.status} ${response.statusText}`;
      try {
        const errorBodyText = await response.text();
        if (errorBodyText) {
          const errorJson = JSON.parse(errorBodyText);
          if (errorJson && errorJson.error) {
            specificErrorMessage = errorJson.error;
          }
        }
      } catch (parseError) {
        customWarn("[AI Service] Failed to parse error response body for rating submission:", parseError);
      }
      throw new Error(specificErrorMessage);
    }
    console.log('[AI Service] Fix rating submitted successfully.');

  } catch (error) {
    customError("Error in sendFixRating:", error);
    if (serviceEventEmitter) { // Check if emitter is initialized
      serviceEventEmitter.emit('aiError', error instanceof Error ? `Rating Submission Error: ${error.message}` : String(error));
    }
  }
};

/**
 * Initializes event listeners for the AI service.
 * @param emitter The event emitter instance from core.
 */
export function initializeAiServiceListeners(emitter: any): void {
  serviceEventEmitter = emitter; // Store the passed emitter instance
  serviceEventEmitter.on('fixRated', (payload: AddRatingRequestBody) => {
    sendFixRating(payload);
  });
}

// ---------------------- NEW AUDIT API ---------------------------

export interface AuditSectionPayload {
  idx: number;
  selector: string;
  html: string;
  boundingRect?: { top: number; left: number; width: number; height: number };
}

export const fetchAudit = async (
  sections: AuditSectionPayload[],
  aiSettings?: Partial<import('../types').AiSettings>
): Promise<void> => {
  try {
    if (!sections || sections.length === 0) {
      throw new Error('No sections provided for audit.');
    }

    const pageMeta = await getPageMetadata();
    const currentAiSettings = aiSettings ? { ...getCurrentAiSettings(), ...aiSettings } : getCurrentAiSettings();

    const requestBody: any = {
      audit: true,
      sections: sections.map(s => ({ idx: s.idx, selector: s.selector, html: s.html, boundingRect: s.boundingRect })),
      metadata: pageMeta,
      aiSettings: currentAiSettings,
    };

    const currentApiKey = getEffectiveApiKey();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (currentApiKey) headers['Authorization'] = `Bearer ${currentApiKey}`;

    const response = await fetch(`${Settings.API_URL}/checkraCompletions/audit`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Audit request failed: ${response.status} ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType: string | null = null;

    const emit = (type: string, data: any) => {
      if (serviceEventEmitter) serviceEventEmitter.emit(type, data);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          if (buffer.startsWith('data:')) {
            try {
              const jsonString = buffer.substring(5).trim();
              if (jsonString) {
                const parsed = JSON.parse(jsonString);
                if (currentEventType) emit(mapAuditEvent(currentEventType), parsed);
              }
            } catch {}
          }
        }
        emit('auditComplete', { totalSections: sections.length });
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEventType = line.substring(6).trim();
        } else if (line.startsWith('data:')) {
          try {
            const jsonString = line.substring(5).trim();
            if (!jsonString) continue;
            const parsedData = JSON.parse(jsonString);
            if (currentEventType) {
              emit(mapAuditEvent(currentEventType), parsedData);
              currentEventType = null;
            }
          } catch (err) {
            emit('auditError', { section: -1, message: `Parse error: ${err instanceof Error ? err.message : String(err)}` });
            currentEventType = null;
          }
        }
      }
    }
  } catch (err) {
    if (serviceEventEmitter) serviceEventEmitter.emit('auditError', { section: -1, message: err instanceof Error ? err.message : String(err) });
  }
};

function mapAuditEvent(evt: string): string {
  switch (evt) {
    case 'rating': return 'auditRatingReceived';
    case 'analysis': return 'auditAnalysisReceived';
    case 'domUpdateHtml': return 'auditDomUpdateReceived';
    case 'auditError': return 'auditError';
    case 'auditComplete': return 'auditComplete';
    default: return evt;
  }
}