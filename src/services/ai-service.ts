import Settings from '../settings';
import { getEffectiveApiKey, getCurrentAiSettings } from '../core/index';
import { customWarn, customError } from '../utils/logger';
import { detectCssFramework } from '../utils/framework-detector';
import { generateColorScheme, parseColorString, rgbaToHex } from '../utils/color-utils';
import {
  AddRatingRequestBody,
  PageMetadata,
  BackendPayloadMetadata,
  DetectedFramework,
  GradientDescriptor
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

const BOOTSTRAP_CLASS_REGEXES = [
  /^(container(-fluid|-sm|-md|-lg|-xl|-xxl))$/,
  /^row$/, 
  /^col(-(?:auto|[1-9]|1[0-2]))?$/,
  /^col-(sm|md|lg|xl|xxl)- (?:auto|[1-9]|1[0-2])$/,
  /^g-[0-5]$/, /^gx-[0-5]$/, /^gy-[0-5]$/, // Gutters
  /^(m|p|ms|me|mt|mb|ps|pe|pt|pb)-[0-5]$/, // Margin/Padding spacing
  /^(m|p|ms|me|mt|mb|ps|pe|pt|pb)-auto$/,
  /^(m|p|ms|me|mt|mb|ps|pe|pt|pb)-(sm|md|lg|xl|xxl)-[0-5]$/,
  /^(m|p|ms|me|mt|mb|ps|pe|pt|pb)-(sm|md|lg|xl|xxl)-auto$/,
  /^text-(primary|secondary|success|danger|warning|info|light|dark|white|body|muted|black-50|white-50|reset|decoration-none)$/,
  /^text-(start|center|end)$/,
  /^text-(sm|md|lg|xl|xxl)-(start|center|end)$/,
  /^text-(lowercase|uppercase|capitalize)$/,
  /^fw-(light|lighter|normal|bold|semibold|bolder)$/, /^fst-(italic|normal)$/,
  /^lh-(1|sm|base|lg)$/,
  /^bg-(primary|secondary|success|danger|warning|info|light|dark|black|white|transparent|body)$/,
  /^border(?:-(primary|secondary|success|danger|warning|info|light|dark|white|black|transparent))?$/,
  /^border-[0-5]$/, /^border-(top|bottom|start|end)(?:-[0-5])?$/,
  /^rounded(?:-(0|1|2|3|4|5|circle|pill|top|bottom|start|end|top-left|top-right|bottom-left|bottom-right))?$/,
  /^d-(none|inline|inline-block|block|grid|table|table-row|table-cell|flex|inline-flex)$/,
  /^d-(sm|md|lg|xl|xxl)-(none|inline|inline-block|block|grid|table|table-row|table-cell|flex|inline-flex)$/,
  /^(justify-content|align-items|align-content|align-self)-(start|end|center|between|around|stretch)$/,
  /^(justify-content|align-items|align-content|align-self)-(sm|md|lg|xl|xxl)-(start|end|center|between|around|stretch)$/,
  /^(flex-row|flex-column|flex-fill|flex-grow-0|flex-grow-1|flex-shrink-0|flex-shrink-1|flex-wrap|flex-nowrap|order-[0-5]|order-first|order-last)$/,
  /^(flex)-(sm|md|lg|xl|xxl)-(row|column|row-reverse|column-reverse|fill|grow-0|grow-1|shrink-0|shrink-1|wrap|nowrap|wrap-reverse)$/,
  /^(float-start|float-end|float-none)$/,
  /^(float)-(sm|md|lg|xl|xxl)-(start|end|none)$/,
  /^(shadow|shadow-sm|shadow-lg|shadow-none)$/,
  /^(position-static|position-relative|position-absolute|position-fixed|position-sticky)$/,
  /^(top-0|top-50|top-100|bottom-0|bottom-50|bottom-100|start-0|start-50|start-100|end-0|end-50|end-100)$/,
  /^(translate-middle|translate-middle-x|translate-middle-y)$/,
  /^(btn|btn-sm|btn-lg)$/,
  /^btn-(primary|secondary|success|danger|warning|info|light|dark|link|outline-primary|outline-secondary|outline-success|outline-danger|outline-warning|outline-info|outline-light|outline-dark)$/,
  /^(alert|alert-primary|alert-secondary|alert-success|alert-danger|alert-warning|alert-info|alert-light|alert-dark)$/,
  /^(nav|nav-tabs|nav-pills|nav-fill|nav-justified)$/, /^(nav-item|nav-link)$/,
  /^(navbar|navbar-expand-(sm|md|lg|xl|xxl))$/, /^(navbar-brand|navbar-toggler|navbar-toggler-icon|navbar-nav|navbar-text|navbar-collapse)$/,
  /^(card|card-body|card-title|card-subtitle|card-text|card-link|card-header|card-footer|card-img|card-img-top|card-img-bottom|card-img-overlay)$/,
  /^(modal|modal-dialog|modal-content|modal-header|modal-title|modal-body|modal-footer)$/, /^(modal-dialog-scrollable|modal-dialog-centered|modal-fullscreen(?:-(sm|md|lg|xl|xxl)-down)?)$/,
  /^(badge|rounded-pill)$/,
  /^(table|table-striped|table-bordered|table-hover|table-sm|table-responsive(?:-(sm|md|lg|xl|xxl))?)$/,
  /^(form-label|form-control|form-select|form-check|form-check-input|form-check-label|form-text|input-group|input-group-text)$/,
  /^(is-valid|is-invalid|valid-feedback|invalid-feedback|valid-tooltip|invalid-tooltip)$/,
  /^(visible|invisible)$/
];

const buildTokensMap = (classesUsed: Set<string>, frameworkName: string): string[] => {
  const tokensArray: string[] = [];
  if (frameworkName === 'tailwind') {
    classesUsed.forEach(cls => {
      tokensArray.push(cls); // Send all found classes for Tailwind
    });
  } else if (frameworkName === 'bootstrap') {
    classesUsed.forEach(cls => {
      if (BOOTSTRAP_CLASS_REGEXES.some(regex => regex.test(cls))) {
        tokensArray.push(cls); // Only send recognized Bootstrap classes
      }
    });
  } else {
    // For other frameworks or custom, we are currently sending computed style key-value pairs.
    // To make the return type consistent (string[]), this path would need to change.
    // Option 1: Send only class names: classesUsed.forEach(cls => tokensArray.push(cls));
    // Option 2: Keep sending computed styles but change cssDigests structure (more complex)
    // For now, let's prioritize Option 1 for consistency if this path is hit, though it loses computed style info.
    // A better long-term solution would be a more robust cssDigests type.
    classesUsed.forEach(cls => tokensArray.push(cls)); 
    customWarn(`[buildTokensMap] Fallback for framework '${frameworkName}': sending only class names, not computed styles.`);
  }
  return tokensArray;
};

interface CssContext {
  comment: string;
  cssDigests: {
    [frameworkName: string]: {
      version: string;
      tokens: string[]; // Ensure tokens is an array of strings
    };
  };
  frameworkDetection: DetectedFramework;
}

const produceCssContext = (htmlString: string): CssContext => {
  // Detect framework based on the provided htmlString (snippet) or globally if htmlString is empty
  const framework = detectCssFramework(htmlString || undefined); 
  
  if (!htmlString) {
    // If htmlString is empty, framework detection was global. Tokens should be empty.
    const emptyDigest: CssContext['cssDigests'] = {
      [framework.name]: {
        version: framework.version,
        tokens: [] 
      }
    };
    return {
      comment: '<!-- cssDigests: {} -->', 
      cssDigests: emptyDigest,
      frameworkDetection: framework
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

  // Framework was already detected using htmlString (or globally if empty) at the beginning
  const digestTokens = buildTokensMap(classesUsed, framework.name);

  const cssDigests: CssContext['cssDigests'] = {
    [framework.name]: {
      version: framework.version,
      tokens: digestTokens 
    }
  };

  return {
    comment: `<!-- cssDigests: ${JSON.stringify(cssDigests)} -->`,
    cssDigests,
    frameworkDetection: framework // This is now context-aware (snippet or global)
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
    const { colours } = await (await import('../utils/design-tokens')).resolveBrandColors(
      document.body,
      frameworkInfo,
      document.body.outerHTML,
      extractColorsFromElement
    );
    if (colours) {
      // Helper to convert utility token to hex colour
      const tokenToHex = (token: string): string | null => {
        if (!token || token.startsWith('#')) return token;
        if (!/^((text|bg|border)-[a-zA-Z0-9\-]+)/.test(token)) return token;
        const span = document.createElement('span');
        span.style.position = 'absolute';
        span.style.left = '-9999px';
        span.style.top = '-9999px';
        span.className = token;
        document.body.appendChild(span);
        const colorStr = getComputedStyle(span).color;
        document.body.removeChild(span);
        const parsed = parseColorString(colorStr);
        if (parsed) {
          return rgbaToHex(parsed);
        }
        return null;
      };

      const resolvedPrimary = tokenToHex(colours.primary) || colours.primary;
      const resolvedAccent = tokenToHex(colours.accent) || colours.accent;

      metadata.brand = {
        inferred: colours,
        primary: resolvedPrimary,
        accent: resolvedAccent,
        primaryUtilityToken: colours.primary,
        accentUtilityToken: colours.accent,
      } as any;
    }
    // perfHints retained only for client-side dev console – do not send to backend
    // generate palette if not already done
    if (metadata.brand && colours?.primary) {
        const palette = generateColorScheme(colours.primary, colours.accent);
        if (palette.length === 5) (metadata.brand as any).palette = palette;
    }
  } catch (err) {
    customWarn('[Checkra Service] Brand extraction failed:', err);
  }

  return metadata as PageMetadata;
};

interface ExtraRequestOptions {
  componentSpec?: {
    id: string;
  };
  /** Override or extend aiSettings for a specific generation */
  aiSettingsOverride?: Partial<import('../types').AiSettings>;
}

const fetchFeedbackBase = async (
  apiUrl: string,
  promptText: string,
  selectedHtml: string | null,
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter',
  imageDataUrl?: string | null,
  generationId?: string | null,
  extras?: ExtraRequestOptions
): Promise<void> => {
  try {
    const pageMeta = await getPageMetadata(); // Renamed to pageMeta for clarity
    let currentAiSettings = getCurrentAiSettings();

    // Apply any AI-settings overrides supplied for this call (e.g. gallery preview)
    if (extras?.aiSettingsOverride) {
      currentAiSettings = { ...currentAiSettings, ...extras.aiSettingsOverride } as any;
    }

    let sanitizedHtml: string | null = selectedHtml ? selectedHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') : null;
    let analysisBuffer = '';
    
    // --- Gradient descriptor for this request ---
    let activeGradientDescriptor: GradientDescriptor | null = null;

    // These will now be part of BackendPayloadMetadata
    let frameworkDetectionForPayload: DetectedFramework | undefined = undefined;

    // New page fingerprint sampler
    let pageFingerprintForPayload: import('../types').PageFingerprint | undefined = undefined;
    try {
      const { collectPageFingerprint } = await import('../utils/page-fingerprint-sampler');
      pageFingerprintForPayload = collectPageFingerprint();
    } catch (err) {
      customWarn('[AI Service] Page fingerprint sampling failed:', err);
    }

    if (sanitizedHtml) {
      const cssCtx = produceCssContext(sanitizedHtml);
      frameworkDetectionForPayload = cssCtx.frameworkDetection;
    } else {
      // No element selected, perform global detections
      frameworkDetectionForPayload = detectCssFramework(); // Global detection
    }
    
    // Construct BackendPayloadMetadata
    const backendMetadata: BackendPayloadMetadata = {
      ...pageMeta, // Spread PageMetadata
      frameworkDetection: frameworkDetectionForPayload,
      pageFingerprint: pageFingerprintForPayload ?? null,
      prefersDarkMode: document.documentElement.classList.contains('dark') || document.body.classList.contains('dark'),
    };

    const requestBody: any = {
      prompt: promptText,
      metadata: backendMetadata,
      aiSettings: currentAiSettings,
    };

    if (!extras?.componentSpec) {
      requestBody.insertionMode = insertionMode;
    }

    if (extras?.componentSpec) {
      requestBody.componentSpec = extras.componentSpec;
    }

    if (generationId) {
      requestBody.generationId = generationId;
    }

    if (serviceEventEmitter) {
      serviceEventEmitter.emit('requestBodyPrepared', requestBody);
    }

    // --- Debug ------------------------------------------------------
    customWarn('[AI Service] DEBUG – sending generateFull request', {
      url: apiUrl,
      prompt: promptText,
      componentId: extras?.componentSpec?.id,
      hasInsertionMode: !!requestBody.insertionMode
    });

    const currentApiKey = getEffectiveApiKey();
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    };
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

    customWarn('[AI Service] DEBUG – SSE stream opened');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Process any remaining buffer content if necessary (though SSE usually ends with \n\n)
        // The main aiFinalized event should handle the end of all data.
        if (serviceEventEmitter) serviceEventEmitter.emit('aiFinalized');
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last partial line in buffer

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEventType = line.substring(6).trim();
          customWarn('[AI Service] DEBUG – event line', currentEventType);
        } else if (line.startsWith('data:')) {
          const jsonString = line.substring(5).trim();
          if (jsonString) {
            try {
              const parsedData = JSON.parse(jsonString);
              if (!currentEventType) {
                // This case is for old-style messages without an event type, or if an event type was missed.
                // Based on new spec, all data should be under an event type.
                // We can log this as unexpected or try to infer based on payload.
                customWarn('[AI Service] SSE data received without a preceding event type:', parsedData);
                // For now, we will not process data without an explicit event type under the new model.
                continue;
              }

              // Verbose log of every parsed event
              customWarn('[AI Service] DEBUG – parsed SSE event', currentEventType, parsedData);

              switch (currentEventType) {
                case 'colors':
                  if (serviceEventEmitter) {
                    serviceEventEmitter.emit('internalResolvedColorsUpdate', parsedData);
                  }
                  break;
                case 'analysis':
                  if (parsedData.chunk && typeof parsedData.chunk === 'string') {
                    analysisBuffer += parsedData.chunk;
                    if (serviceEventEmitter) {
                      serviceEventEmitter.emit('aiResponseChunk', parsedData.chunk);
                    }
                  } else {
                    customWarn('[AI Service] analysis event received without a valid string chunk:', parsedData);
                  }
                  break;
                case 'analysisDone':
                  if (serviceEventEmitter) {
                    // Emit a new event for clarity, carrying the full analysis
                    serviceEventEmitter.emit('aiAnalysisFinalized', analysisBuffer);
                  }
                  analysisBuffer = ''; // Reset for next potential message cycle
                  break;
                case 'thinking':
                  /*
                   * Front-end UX wants in-flight status messages ("Planning UI layout…", etc.).
                   * Forward the message so UI can show it in the loader area.
                   */
                  if (parsedData.message && typeof parsedData.message === 'string') {
                    if (serviceEventEmitter) {
                      serviceEventEmitter.emit('aiThinking', parsedData.message);
                    }
                  } else {
                    customWarn('[AI Service] thinking event received without a valid message:', parsedData);
                  }
                  break;
                case 'thinkingDone':
                  // Signal to UI that background thinking steps are finished; hide loader text.
                  if (serviceEventEmitter) {
                    serviceEventEmitter.emit('aiThinkingDone');
                  }
                  break;
                case 'generationId':
                  if (parsedData.generationId && serviceEventEmitter) {
                    serviceEventEmitter.emit('generationIdReceived', parsedData.generationId);
                  }
                  break;
                case 'gradientDescriptor':
                  try {
                    activeGradientDescriptor = parsedData as GradientDescriptor;
                  } catch (e) {
                    customWarn('[AI Service] Failed to process gradientDescriptor payload:', e, parsedData);
                  }
                  break;
                case 'htmlForPatch': // Simplest option: treat htmlForPatch as htmlReplace
                  if (parsedData.html && typeof parsedData.html === 'string') {
                    const processedHtml = applyGradientToHtml(parsedData.html, activeGradientDescriptor);
                    if (serviceEventEmitter) {
                      serviceEventEmitter.emit('aiDomUpdateReceived', {
                        html: processedHtml,
                        insertionMode: 'replace' 
                      });
                    }
                  } else {
                    customWarn('[AI Service] Event ', currentEventType, ' received without valid HTML string:', parsedData);
                  }
                  break;
                case 'htmlInsertBefore':
                  if (parsedData.html && typeof parsedData.html === 'string') {
                    const processedHtml = applyGradientToHtml(parsedData.html, activeGradientDescriptor);
                    if (serviceEventEmitter) {
                      serviceEventEmitter.emit('aiDomUpdateReceived', {
                        html: processedHtml,
                        insertionMode: 'insertBefore'
                      });
                    }
                  } else {
                    customWarn('[AI Service] htmlInsertBefore event received without valid HTML string:', parsedData);
                  }
                  break;
                case 'htmlInsertAfter':
                  if (parsedData.html && typeof parsedData.html === 'string') {
                    const processedHtml = applyGradientToHtml(parsedData.html, activeGradientDescriptor);
                    if (serviceEventEmitter) {
                      serviceEventEmitter.emit('aiDomUpdateReceived', {
                        html: processedHtml,
                        insertionMode: 'insertAfter'
                      });
                    }
                  } else {
                    customWarn('[AI Service] htmlInsertAfter event received without valid HTML string:', parsedData);
                  }
                  break;
                case 'htmlReplace':
                  if (parsedData.html && typeof parsedData.html === 'string') {
                    const processedHtml = applyGradientToHtml(parsedData.html, activeGradientDescriptor);
                    if (serviceEventEmitter) {
                      serviceEventEmitter.emit('aiDomUpdateReceived', {
                        html: processedHtml,
                        insertionMode: 'replace'
                      });
                    }
                  } else {
                    customWarn('[AI Service] htmlReplace event received without valid HTML string:', parsedData);
                  }
                  break;
                default:
                  // Handle any other custom events if the backend might send them,
                  // or log as unrecognized.
                  customWarn(`[AI Service] Received unrecognized SSE event type '${currentEventType}':`, parsedData);
                  if (serviceEventEmitter) {
                      // Forward other events if a generic handler exists or if specific conditions met
                      // For instance, if there was a generic 'aiCustomEvent' or similar.
                      // serviceEventEmitter.emit(currentEventType, parsedData);
                  }
                  break;
              }
              currentEventType = null; // Reset after processing data for an event
            } catch (e) {
              customError('[AI Service] Error parsing SSE data JSON:', jsonString, e);
              if (serviceEventEmitter) {
                serviceEventEmitter.emit('aiError', `Error parsing stream data: ${e instanceof Error ? e.message : String(e)}`);
              }
              currentEventType = null; // Reset event type on error too
            }
          }
        } else if (line.trim() === '') {
          // Empty line often signifies end of an event block in SSE, reset currentEventType if needed
          // Though our logic resets it after processing 'data:'
          currentEventType = null;
        }
      }
    }
  } catch (error) {
    customError("Error in fetchFeedbackBase:", error);
    if (serviceEventEmitter) { 
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
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter',
  generationId?: string | null
): Promise<void> => {
  const apiUrl = `${Settings.API_URL}/checkraCompletions/generateFull`;
  return fetchFeedbackBase(apiUrl, promptText, selectedHtml, insertionMode, imageDataUrl, generationId, undefined);
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
    if (serviceEventEmitter) { 
      serviceEventEmitter.emit('aiError', error instanceof Error ? `Rating Submission Error: ${error.message}` : String(error));
    }
  }
};

/**
 * Initializes event listeners for the AI service.
 * @param emitter The event emitter instance from core.
 */
export function initializeAiServiceListeners(emitter: any): void {
  serviceEventEmitter = emitter; 
  serviceEventEmitter.on('fixRated', (payload: AddRatingRequestBody) => {
    sendFixRating(payload);
  });
}

// Helper: applies gradient descriptor to HTML string
function applyGradientToHtml(htmlString: string, gradientSpec: GradientDescriptor | null): string {
  if (!gradientSpec) return htmlString;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = htmlString;
  const targets = wrapper.querySelectorAll('[data-checkra-gradient="true"]');
  if (targets && targets.length > 0) {
    // CSS syntax: linear-gradient(in <color-space> <angle>deg, <from>, <to>)
    const gradientCss = `linear-gradient(in ${gradientSpec.kind} ${gradientSpec.angle}deg, ${gradientSpec.from}, ${gradientSpec.to})`;
    targets.forEach(el => {
      const htmlEl = el as HTMLElement;
      const existingStyle = htmlEl.getAttribute('style') || '';
      const needSeparator = existingStyle.trim() !== '' && !existingStyle.trim().endsWith(';');
      const separator = needSeparator ? '; ' : '';
      htmlEl.setAttribute('style', `${existingStyle}${separator}background-image: ${gradientCss};`);
      htmlEl.removeAttribute('data-checkra-gradient');
    });
  }
  return wrapper.innerHTML;
}

/**
 * Convenience wrapper for gallery snippet preview / confirm generation.
 */
export const fetchComponentSnippet = async (
  prompt: 'gallery-preview' | 'gallery-confirm',
  componentId: string,
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter',
  copyQuality: 'none' | undefined = 'none'
): Promise<void> => {
  const apiUrl = `${Settings.API_URL}/checkraCompletions/generateFull`;
  const aiSettingsOverride: Partial<import('../types').AiSettings> = {};
  if (copyQuality) {
    aiSettingsOverride.copyQuality = copyQuality;
  }

  const componentSpec = {
    id: componentId
  };

  return fetchFeedbackBase(
    apiUrl,
    prompt,
    null, // no selectedHtml for new insertions
    insertionMode,
    null,
    null,
    {
      componentSpec,
      aiSettingsOverride
    }
  );
};