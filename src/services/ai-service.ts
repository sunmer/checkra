import Settings from '../settings';
import { feedbackViewer } from '../ui/feedback-viewer';
import { getEffectiveApiKey, getCurrentAiSettings } from '../core/index';
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
 * Sends feedback (including optional screenshot, optional HTML, and optional prompt) to the backend.
 */
export const fetchFeedback = async (
  _imageDataUrl: string | null,
  promptText: string,
  selectedHtml: string | null
): Promise<void> => {
  try {
    // Gather metadata
    const metadata = getPageMetadata();
    // Get settings using the new function from core
    const currentAiSettings = getCurrentAiSettings();

    const requestBody: {
      image?: string | null;
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

    // --- Add Authorization Header ---
    const currentApiKey = getEffectiveApiKey();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (currentApiKey) {
      headers['Authorization'] = `Bearer ${currentApiKey}`;
    } else {
      console.warn('[Checkra Service] API key/anonymous ID not available for feedback request.');
    }
    
    const response = await fetch(`${Settings.API_URL}/checkraCompletions/suggest/feedback`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    // --- Modified Error Handling for !response.ok ---
    if (!response.ok) {
      let specificErrorMessage = `Feedback request failed: ${response.status} ${response.statusText}`;
      try {
        const errorBodyText = await response.text(); // Read body once
        if (errorBodyText) {
            const errorJson = JSON.parse(errorBodyText);
            if (errorJson && errorJson.error) {
                // Use the specific error from JSON payload
                specificErrorMessage = errorJson.error;
            }
        }
      } catch (parseError) {
        // Ignore parsing error, stick with the original HTTP status error
        console.warn("[Checkra Service] Failed to parse error response body:", parseError);
      }
      // Throw the determined error message to be caught by the outer catch block
      throw new Error(specificErrorMessage);
    }
    // --- End Modified Error Handling ---

    // Proceed with stream processing only if response.ok is true
    if (!response.body) {
        throw new Error("Response body is null, cannot process stream.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          try {
            const lines = buffer.split('\n');
            for (const line of lines) {
              if (line.startsWith('data:')) {
                const jsonString = line.substring(5).trim();
                if (jsonString) {
                  const data = JSON.parse(jsonString);
                  if (data.userMessage) {
                    feedbackViewer.renderUserMessage(data.userMessage);
                  } else if (data.content) {
                    feedbackViewer.updateResponse(data.content);
                  } else if (data.error) {
                    console.error("Received error via SSE:", data.error);
                    feedbackViewer.showError(`Stream Error: ${data.error}`);
                  }
                }
              }
            }
          } catch (e) {
            console.error("Error processing final buffer chunk:", e, buffer);
          }
        }
        feedbackViewer.finalizeResponse(); // Signal end of stream
        break;
      }

      // Append new data to buffer and process line by line
      buffer += decoder.decode(value, { stream: true });
      let lines = buffer.split('\n');

      // Keep the last partial line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const jsonString = line.substring(5).trim();
            if (jsonString) {
              const data = JSON.parse(jsonString);
              if (data.userMessage) {
                feedbackViewer.renderUserMessage(data.userMessage);
              } else if (data.content) {
                feedbackViewer.updateResponse(data.content);
              } else if (data.error) {
                console.error("Received error via SSE:", data.error);
                feedbackViewer.showError(`Stream Error: ${data.error}`);
              }
            }
          } catch (e) {
            console.error("Error parsing SSE data line:", e, line);
          }
        } else if (line.trim() === '' && buffer.startsWith('data:')) {
          // Handle potential empty line separating messages if needed, though OpenAI stream usually doesn't do this.
          // If the buffer *only* contained 'data: ', this avoids erroring. Reset buffer.
          // console.log("Empty line separator or incomplete data prefix.");
        }
      }
    }

  } catch (error) {
    console.error("Error getting feedback:", error);
    // Display error in the feedback viewer
    feedbackViewer.showError(error instanceof Error ? error.message : String(error));
  }
};
