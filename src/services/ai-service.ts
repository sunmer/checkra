import Settings from '../settings';
import { getEffectiveApiKey, getCurrentAiSettings, eventEmitter } from '../core/index';
import { AiSettings } from '../ui/settings-modal';
import html2canvas from 'html2canvas';


const extractColorsFromElement = async (element: HTMLElement): Promise<{ primary?: string; accent?: string } | null> => {
  try {
    const canvas = await html2canvas(element, {
      scale: 0.25,
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
    console.warn('[Checkra Service] Failed to extract colors from screenshot:', error);
    return null;
  }
};
// --- END MOVED ---
interface DalleImageRequest {
  prompt: string;
  size?: string;
}

interface DalleImageResponse {
  url: string;
}

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

  // Attempt to extract brand colors
  try {
    const computedStyles = getComputedStyle(document.documentElement);
    let primaryColor = computedStyles.getPropertyValue('--primary').trim();
    let accentColor = computedStyles.getPropertyValue('--accent').trim();

    // Fallback logic if CSS variables are not found or are empty
    if (!primaryColor || !accentColor) {
      console.log('[Checkra Service] CSS variables --primary or --accent not found/empty. Attempting fallback...');
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
          console.log(`[Checkra Service] Fallback: Using button background for primary color: ${primaryColor}`);
        }
        // Use button text color if --accent was missing and different from primary
        if (!accentColor && btnTextColor && !['transparent', 'rgba(0, 0, 0, 0)'].includes(btnTextColor) && btnTextColor !== primaryColor) {
          accentColor = btnTextColor;
          console.log(`[Checkra Service] Fallback: Using button text for accent color: ${accentColor}`);
        }
      } else {
        console.log('[Checkra Service] Fallback: No visible button found to infer colors.');
      }
    }
    
    if (primaryColor || accentColor) {
        metadata.brand = {};
        if (primaryColor) metadata.brand.primary = primaryColor;
        if (accentColor) metadata.brand.accent = accentColor;
    }
  } catch (e) {
    console.warn('[Checkra Service] Could not retrieve brand colors:', e);
  }
  if (!metadata.brand?.primary || !metadata.brand?.accent) {
    console.log('[Checkra Service] Attempting screenshot-based color extraction...');
    const screenshotColors = await extractColorsFromElement(document.body);
    if (screenshotColors) {
      if (!metadata.brand) metadata.brand = {};
      if (!metadata.brand.primary && screenshotColors.primary) {
        metadata.brand.primary = screenshotColors.primary;
        console.log(`[Checkra Service] Screenshot fallback: Using primary color: ${screenshotColors.primary}`);
      }
      if (!metadata.brand.accent && screenshotColors.accent) {
        metadata.brand.accent = screenshotColors.accent;
        console.log(`[Checkra Service] Screenshot fallback: Using accent color: ${screenshotColors.accent}`);
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
  imageDataUrl?: string | null
): Promise<void> => {
  try {
    const metadata = await getPageMetadata();
    const currentAiSettings = getCurrentAiSettings();
    console.log('[AI Service] Using AiSettings for request (fetchFeedbackBase):', currentAiSettings); // DEBUG LOG

    const requestBody: {
      prompt: string;
      html?: string | null;
      metadata: PageMetadata;
      aiSettings: AiSettings;
      image?: string | null;
    } = {
      prompt: promptText,
      metadata: metadata,
      aiSettings: currentAiSettings
    };

    if (selectedHtml) {
      requestBody.html = selectedHtml;
    }
    if (imageDataUrl) {
      requestBody.image = imageDataUrl;
    }
    console.log('[AI Service] Full request body (fetchFeedbackBase):', requestBody); // DEBUG LOG

    const currentApiKey = getEffectiveApiKey();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (currentApiKey) {
      headers['Authorization'] = `Bearer ${currentApiKey}`;
    } else {
      console.warn('[Checkra Service] API key/anonymous ID not available for request.');
    }

    console.log(`[Checkra Service] Sending request to: ${apiUrl}`);
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
        console.warn("[Checkra Service] Failed to parse error response body:", parseError);
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
        // Process final buffer chunk if any
        if (buffer.trim()) {
          // Simplified final processing, assuming event context might be lost or irrelevant for trailing data
          // For robustness, one might need to process the last event/data pair here if buffer holds them.
          console.log("[SSE Parser] Processing final buffer content:", buffer);
          // Basic attempt to parse if it looks like a data line, otherwise log it.
          if (buffer.startsWith('data:')) {
            try {
              const jsonString = buffer.substring(5).trim();
              if (jsonString) {
                const data = JSON.parse(jsonString);
                // Default to aiResponseChunk for any un-event-typed final data with content
                if (data.content) {
                  eventEmitter.emit('aiResponseChunk', data.content);
                } else {
                  console.warn("[SSE Parser] Final buffer data line did not contain 'content':", data);
                }
              }
            } catch (e) {
              console.error("[SSE Parser] Error processing final buffer as data line:", e, buffer);
            }
          } else if (buffer.trim()) { // Log if it's not empty and not a data line
            console.log("[SSE Parser] Non-empty final buffer did not start with 'data:':", buffer);
          }
        }
        eventEmitter.emit('aiFinalized');
        console.log("[SSE Parser] Stream ended, aiFinalized emitted.");
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEventType = line.substring(6).trim();
          console.log(`[SSE Parser] Encountered event type: ${currentEventType}`);
        } else if (line.startsWith('data:')) {
          try {
            const jsonString = line.substring(5).trim();
            if (jsonString) {
              const parsedData = JSON.parse(jsonString);
              console.log("[SSE Parser] Data received:", parsedData, "Current Event Type:", currentEventType);

              if (currentEventType) {
                // If we have a specific event type, emit that with the parsed data as payload
                eventEmitter.emit(currentEventType, parsedData);
                console.log(`[SSE Parser] Emitted event '${currentEventType}' with payload:`, parsedData);
                currentEventType = null;
              } else {
                // Default behavior: check for known structures in the data payload
                if (parsedData.userMessage) {
                  eventEmitter.emit('aiUserMessage', parsedData.userMessage);
                } else if (parsedData.content) {
                  eventEmitter.emit('aiResponseChunk', parsedData.content);
                } else if (parsedData.error) {
                  console.error("[SSE Parser] Received error object via SSE data line:", parsedData.error);
                  eventEmitter.emit('aiError', `Stream Error: ${parsedData.error}`);
                } else {
                  console.warn("[SSE Parser] Received data line with unknown structure (no event type):");
                }
              }
            }
          } catch (e) {
            console.error("[SSE Parser] Error parsing SSE data line:", e, line);
            eventEmitter.emit('aiError', `Error parsing stream data: ${e instanceof Error ? e.message : String(e)}`);
            currentEventType = null;
          }
        } else if (line.trim() === '' && currentEventType) {
          // An empty line typically signifies the end of an event block in SSE.
          // If we had an event type, but no data followed before an empty line,
          // it might be an event without data or a separator. Reset currentEventType.
          // console.log("[SSE Parser] Empty line after event type, resetting currentEventType.");
          // currentEventType = null; // Not strictly needed to reset here as data line resets it.
        } else if (line.trim() !== '') {
          // Log lines that are not event, data, or empty (could be comments or malformed)
          console.log("[SSE Parser] Ignoring non-standard SSE line:", line);
        }
      }
    }

  } catch (error) {
    console.error("Error in fetchFeedbackBase:", error);
    eventEmitter.emit('aiError', error instanceof Error ? error.message : String(error));
  }
};

/**
 * Sends regular feedback (specific section or general prompt) to the /feedback endpoint.
 */
export const fetchFeedback = async (
  imageDataUrl: string | null,
  promptText: string,
  selectedHtml: string | null
): Promise<void> => {
  // NOTE: _imageDataUrl is ignored here as the base function doesn't handle it.
  // If image sending is needed for this specific endpoint later, logic must be added here.
  const apiUrl = `${Settings.API_URL}/checkraCompletions/suggest/feedback`;
  return fetchFeedbackBase(apiUrl, promptText, selectedHtml, imageDataUrl);
};
/**
 * Calls the backend to generate an image using DALL-E.
 * @param prompt The text prompt for image generation.
 * @param size The desired size of the image (e.g., "256x256", "512x512", "1024x1024").
 * @returns Promise resolving to the image URL.
 */
export const generateDalleImage = async (
  prompt: string,
  size?: string
): Promise<string> => {
  console.log(`[AI Service] generateDalleImage called. Prompt: "${prompt}", Size: ${size}`);
  const apiUrl = `${Settings.API_URL}/checkraCompletions/genImage`;
  console.log(`[Checkra Service] Generating DALL-E image with prompt: "${prompt}", size: ${size || 'default'}`);

  try {
    const currentAiSettings = getCurrentAiSettings(); 
    console.log('[AI Service] Using AiSettings for request (generateDalleImage):', currentAiSettings); // DEBUG LOG
    const metadata = await getPageMetadata(); 

    const requestBody: DalleImageRequest & { aiSettings?: AiSettings; metadata?: PageMetadata } = { 
      prompt: prompt,
      aiSettings: currentAiSettings,
      metadata: metadata 
    };

    if (size) {
      requestBody.size = size;
    }
    console.log('[AI Service] Full request body (generateDalleImage):', requestBody); // DEBUG LOG

    const currentApiKey = getEffectiveApiKey();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (currentApiKey) {
      headers['Authorization'] = `Bearer ${currentApiKey}`;
    } else {
      console.warn('[Checkra Service] API key/anonymous ID not available for DALL-E request.');
    }

    console.log('[AI Service] Attempting to fetch from DALL-E endpoint:', apiUrl, 'Request Body:', requestBody);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody),
    });
    console.log('[AI Service] DALL-E fetch response status:', response.status);

    if (!response.ok) {
      let specificErrorMessage = `DALL-E request failed: ${response.status} ${response.statusText}`;
      try {
        const errorBodyText = await response.text();
        console.error('[AI Service] DALL-E error response body:', errorBodyText);
        if (errorBodyText) {
            const errorJson = JSON.parse(errorBodyText);
            if (errorJson && errorJson.error) {
                specificErrorMessage = errorJson.error;
            }
        }
      } catch (parseError) {
        console.warn("[Checkra Service] Failed to parse DALL-E error response body:", parseError);
      }
      eventEmitter.emit('dalleImageError', { prompt, size, error: specificErrorMessage });
      throw new Error(specificErrorMessage);
    }

    const result: DalleImageResponse = await response.json();
    console.log('[AI Service] DALL-E response JSON:', result);
    if (!result.url) {
        const errorMsg = "DALL-E response missing image URL.";
        eventEmitter.emit('dalleImageError', { prompt, size, error: errorMsg });
        throw new Error(errorMsg);
    }
    
    eventEmitter.emit('dalleImageLoaded', { prompt, size, url: result.url });
    return result.url;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[AI Service] Error in generateDalleImage function:", errorMessage, error);
    eventEmitter.emit('dalleImageError', { prompt, size, error: errorMessage });
    throw error; 
  }
};
