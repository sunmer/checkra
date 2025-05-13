import Settings from '../settings';
import { getEffectiveApiKey, getCurrentAiSettings, eventEmitter } from '../core/index';
import { AiSettings } from '../ui/settings-modal';

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
}

/**
 * Gathers metadata from the current page.
 */
const getPageMetadata = (): PageMetadata => {
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

  // --- Added Metadata ---
  metadata.url = window.location.href;
  metadata.language = document.documentElement.lang || null;
  const h1Tag = document.querySelector('h1');
  metadata.h1 = h1Tag ? h1Tag.textContent?.trim() || null : null;

  return metadata as PageMetadata;
};

/**
 * Base function for handling feedback/audit requests and streaming SSE responses.
 */
const fetchFeedbackBase = async (
  apiUrl: string,
  promptText: string,
  selectedHtml: string | null
): Promise<void> => {
  try {
    const metadata = getPageMetadata();
    const currentAiSettings = getCurrentAiSettings();

    const requestBody: {
      // No image field needed here as it's handled by the caller if necessary
      prompt: string;
      html?: string | null;
      metadata: PageMetadata;
      aiSettings: AiSettings;
    } = {
      prompt: promptText,
      metadata: metadata,
      aiSettings: currentAiSettings
    };

    if (selectedHtml) {
      requestBody.html = selectedHtml;
    }

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

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Process final buffer chunk
        if (buffer.trim()) {
          try {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.startsWith('data:')) {
                const jsonString = line.substring(5).trim();
                if (jsonString) {
                  const data = JSON.parse(jsonString);
                  if (data.userMessage) {
                    eventEmitter.emit('aiUserMessage', data.userMessage);
                  } else if (data.content) {
                    eventEmitter.emit('aiResponseChunk', data.content);
                  } else if (data.error) {
                    console.error("Received error via SSE:", data.error);
                    eventEmitter.emit('aiError', `Stream Error: ${data.error}`);
                  }
                }
              }
            }
          } catch (e) {
            console.error("Error processing final buffer chunk:", e, buffer);
            eventEmitter.emit('aiError', `Error processing final stream data: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        eventEmitter.emit('aiFinalized');
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const jsonString = line.substring(5).trim();
            if (jsonString) {
              const data = JSON.parse(jsonString);
              if (data.userMessage) {
                eventEmitter.emit('aiUserMessage', data.userMessage);
              } else if (data.content) {
                eventEmitter.emit('aiResponseChunk', data.content);
              } else if (data.error) {
                console.error("Received error via SSE:", data.error);
                eventEmitter.emit('aiError', `Stream Error: ${data.error}`);
              }
            }
          } catch (e) {
            console.error("Error parsing SSE data line:", e, line);
            eventEmitter.emit('aiError', `Error parsing stream data: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else if (line.trim() === '' && buffer.startsWith('data:')) {
          // Handle potential empty line separator
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
  _imageDataUrl: string | null, // Kept for signature compatibility, but not used in base
  promptText: string,
  selectedHtml: string | null
): Promise<void> => {
  // NOTE: _imageDataUrl is ignored here as the base function doesn't handle it.
  // If image sending is needed for this specific endpoint later, logic must be added here.
  const apiUrl = `${Settings.API_URL}/checkraCompletions/suggest/feedback`;
  return fetchFeedbackBase(apiUrl, promptText, selectedHtml);
};

/**
 * Sends a quick audit request to the /audit endpoint.
 */
export const fetchAudit = async (
  promptText: string,
  html: string | null // Audit specifically needs HTML
): Promise<void> => {
  const apiUrl = `${Settings.API_URL}/checkraCompletions/suggest/audit`;
  // Ensure HTML is provided for audit
  if (!html) {
      const errorMsg = 'Cannot run audit: Missing required HTML content.';
      console.error('[fetchAudit] HTML content is required for audit requests.');
      eventEmitter.emit('aiError', errorMsg);
      return;
  }
  return fetchFeedbackBase(apiUrl, promptText, html);
};
