import Settings from '../settings';
import { getEffectiveApiKey, getCurrentAiSettings, eventEmitter } from '../core/index';
import { AiSettings } from '../ui/settings-modal';
import { customWarn, customError } from '../utils/logger';
// import html2canvas from 'html2canvas'; // Eager import removed

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
      return null;
    }
    return h2cModule;
  } catch (error) {
    customError('[AI Service] Failed to dynamically load html2canvas:', error);
    eventEmitter.emit('error', { source: 'ai-service', error: new Error('html2canvas lib failed to load') });
    return null;
  }
}

// Helper function to generate cssDigest
const generateCssDigest = (htmlString: string): string => {
  if (!htmlString) return '<!-- cssDigest: -->';

  const classRegex = /class="([^"]*)"/g;
  let match;
  const allClasses = new Set<string>();

  while ((match = classRegex.exec(htmlString)) !== null) {
    const classes = match[1].split(/\s+/);
    classes.forEach(cls => {
      if (cls.trim()) {
        allClasses.add(cls.trim());
      }
    });
  }

  if (allClasses.size === 0) {
    return '<!-- cssDigest: -->';
  }

  return `<!-- cssDigest: ${Array.from(allClasses).join(',')} -->`;
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

interface PageMetadata {
  title: string | null;
  description: string | null;
  ogTitle: string | null;
  url: string;
  language: string | null;
  h1: string | null;
  viewport: {
    width: number;
    height: number;
  };
  brand?: {
    primary?: string | null;
    accent?: string | null;
  };
  // framework?: string; // REMOVED as per user request
}

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

  // FRAMEWORK DETECTION LOGIC REMOVED HERE

  // Attempt to extract brand colors
  try {
    const computedStyles = getComputedStyle(document.documentElement);
    let primaryColor = computedStyles.getPropertyValue('--primary').trim();
    let accentColor = computedStyles.getPropertyValue('--accent').trim();

    // Fallback logic if CSS variables are not found or are empty
    if (!primaryColor || !accentColor) {

      const buttons = document.querySelectorAll('button, a[role="button"], input[type="submit"], input[type="button"]');
      let firstVisibleButton: HTMLElement | null = null;
      for (const btn of Array.from(buttons)) {
        if (btn instanceof HTMLElement && btn.offsetParent !== null) { // Check if visible
          firstVisibleButton = btn;
          break;
        }
      }

      if (firstVisibleButton) {
        const buttonStyles = getComputedStyle(firstVisibleButton);
        const btnBgColor = buttonStyles.backgroundColor;
        const btnTextColor = buttonStyles.color;

        // Use button background if --primary was missing
        if (!primaryColor && btnBgColor && !['transparent', 'rgba(0, 0, 0, 0)'].includes(btnBgColor)) {
          primaryColor = btnBgColor;

        }
        // Use button text color if --accent was missing and different from primary
        if (!accentColor && btnTextColor && !['transparent', 'rgba(0, 0, 0, 0)'].includes(btnTextColor) && btnTextColor !== primaryColor) {
          accentColor = btnTextColor;

        }
      } else {

      }
    }

    if (primaryColor || accentColor) {
      metadata.brand = {};
      if (primaryColor) metadata.brand.primary = primaryColor;
      if (accentColor) metadata.brand.accent = accentColor;
    }
  } catch (e) {
    customWarn('[Checkra Service] Could not retrieve brand colors:', e);
  }
  if (!metadata.brand?.primary || !metadata.brand?.accent) {

    const screenshotColors = await extractColorsFromElement(document.body);
    if (screenshotColors) {
      if (!metadata.brand) metadata.brand = {};
      if (!metadata.brand.primary && screenshotColors.primary) {
        metadata.brand.primary = screenshotColors.primary;

      }
      if (!metadata.brand.accent && screenshotColors.accent) {
        metadata.brand.accent = screenshotColors.accent;

      }
    }
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
    const metadata = await getPageMetadata(); // metadata will no longer contain .framework
    const currentAiSettings = getCurrentAiSettings();

    let processedHtml = selectedHtml;
    let originalSentHtmlForPatch: string | null = null;
    let jsonPatchAccumulator: string = ''; // Accumulator for JSON patch NDJSON chunks
    let patchStartSeen: boolean = false; // Flag to detect when PATCH_START marker has been encountered
    let analysisAccumulator: string = ''; // Accumulate analysis chunks until marker detected

    if (selectedHtml) {
      const digest = generateCssDigest(selectedHtml);
      processedHtml = `${digest}\n${selectedHtml}`;
      if (insertionMode === 'replace' && selectedHtml.length >= 500) {
        originalSentHtmlForPatch = selectedHtml;
        customWarn('[AI Service] JSON Patch mode activated: insertionMode is replace and selectedHtml.length >= 500.');
      } else if (insertionMode === 'replace') {
        customWarn('[AI Service] Direct HTML replace mode activated: insertionMode is replace and selectedHtml.length < 500.');
      }
    }

    const requestBody: {
      prompt: string;
      html?: string | null;
      htmlCharCount?: number;
      metadata: PageMetadata;
      aiSettings: AiSettings;
      image?: string | null;
      insertionMode: 'replace' | 'insertBefore' | 'insertAfter';
    } = {
      prompt: promptText,
      metadata: metadata,
      aiSettings: currentAiSettings,
      insertionMode: insertionMode
    };

    if (selectedHtml) {
      requestBody.html = processedHtml;
      requestBody.htmlCharCount = selectedHtml.length;
    }
    if (imageDataUrl) {
      requestBody.image = imageDataUrl;
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
                // Check for JSON patch in the final buffer as well
                if (originalSentHtmlForPatch) {
                  if (typeof data.content === 'string') {
                    jsonPatchAccumulator += data.content;
                  }
                  // Do not emit aiResponseChunk here for patch mode
                } else if (data.type === 'json-patch') {
                  let parsedPayload: any = jsonPatchAccumulator;
                  try {
                    parsedPayload = JSON.parse(jsonPatchAccumulator);
                  } catch (e) {
                    customWarn('[AI Service] Failed to parse accumulated JSON patch; sending raw string', e);
                  }
                  customWarn('[AI Service] Emitting aiJsonPatch. Raw length:', jsonPatchAccumulator.length, 'Parsed type:', Array.isArray(parsedPayload) ? 'array' : typeof parsedPayload);
                  eventEmitter.emit('aiJsonPatch', { payload: parsedPayload, originalHtml: originalSentHtmlForPatch });
                } else if (data.content) {
                  eventEmitter.emit('aiResponseChunk', data.content);
                } else {
                  customWarn("[SSE Parser] Final buffer data line did not contain 'content' or valid 'json-patch':", data);
                }
              }
            } catch (e) {
              customError("[SSE Parser] Error processing final buffer as data line:", e, buffer);
            }
          } else if (buffer.trim()) {
            // customWarn("[SSE Parser] Final buffer contained non-data line content:", buffer);
          }
        }
        if (originalSentHtmlForPatch && jsonPatchAccumulator.length > 0) {
          let parsedPayload: any = jsonPatchAccumulator;
          try {
            parsedPayload = JSON.parse(jsonPatchAccumulator);
          } catch (e) {
            customWarn('[AI Service] Failed to parse accumulated JSON patch at stream end; sending raw string', e);
          }
          customWarn('[AI Service] Emitting aiJsonPatch at stream end. Raw length:', jsonPatchAccumulator.length);
          eventEmitter.emit('aiJsonPatch', { payload: parsedPayload, originalHtml: originalSentHtmlForPatch });
        }
        eventEmitter.emit('aiFinalized');
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
                eventEmitter.emit(currentEventType, parsedData);
                currentEventType = null;
              } else {
                if (parsedData.type === 'json-patch') {
                  customWarn('[AI Service] Received inline json-patch event (not NDJSON). Emitting immediately.');
                  eventEmitter.emit('aiJsonPatch', { payload: parsedData.payload, originalHtml: originalSentHtmlForPatch || '' });
                  // After emitting, we can continue to wait for stream end.
                } else if (originalSentHtmlForPatch) {
                  // We're in JSON patch mode with analysis + patch. Detect PATCH_START marker.
                  const raw = parsedData.content;
                  const cleaned = raw.replace(/\u001b/g, ''); // Remove ESC char if present

                  if (!patchStartSeen) {
                    analysisAccumulator += cleaned;
                    const markerIndex = analysisAccumulator.indexOf('[PATCH_START]');
                    if (markerIndex !== -1) {
                      const analysisPart = analysisAccumulator.substring(0, markerIndex);
                      if (analysisPart.trim().length > 0) {
                        eventEmitter.emit('aiResponseChunk', analysisPart);
                        customWarn('[AI Service] Emitting analysis portion length', analysisPart.length);
                      }
                      patchStartSeen = true;
                      const afterMarker = analysisAccumulator.substring(markerIndex + '[PATCH_START]'.length);
                      if (afterMarker.length > 0) {
                        jsonPatchAccumulator += afterMarker;
                        customWarn('[AI Service] Accum patch chunk, total length now', jsonPatchAccumulator.length);
                      }
                      analysisAccumulator = '';
                    }
                  } else {
                    // After marker -> accumulate patch
                    jsonPatchAccumulator += cleaned;
                  }
                } else if (parsedData.userMessage) {
                  eventEmitter.emit('aiUserMessage', parsedData.userMessage);
                } else if (parsedData.content) {
                  eventEmitter.emit('aiResponseChunk', parsedData.content);
                } else if (parsedData.error) {
                  customError("[SSE Parser] Received error object via SSE data line:", parsedData.error, parsedData.details);
                  eventEmitter.emit('aiError', `Stream Error: ${parsedData.error}${parsedData.details ? ' - ' + parsedData.details : ''}`);
                } else {
                  customWarn("[SSE Parser] Received data line with unknown structure (no event type):", parsedData);
                }
              }
            }
          } catch (e) {
            customError("[SSE Parser] Error parsing SSE data line:", e, line);
            eventEmitter.emit('aiError', `Error parsing stream data: ${e instanceof Error ? e.message : String(e)}`);
            currentEventType = null;
          }
        } else if (line.trim() === '' && currentEventType) {
          // currentEventType = null; // Not strictly needed
        } else if (line.trim() !== '') {
          // customWarn("[SSE Parser] Received non-empty, non-event, non-data line:", line);
        }
      }
    }
  } catch (error) {
    customError("Error in fetchFeedbackBase:", error);
    eventEmitter.emit('aiError', error instanceof Error ? error.message : String(error));
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
  const apiUrl = `${Settings.API_URL}/checkraCompletions/suggest/feedback`;
  return fetchFeedbackBase(apiUrl, promptText, selectedHtml, insertionMode, imageDataUrl);
};