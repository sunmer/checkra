import Settings from '../settings';
import { feedbackViewer } from '../ui/feedback-viewer';
import { getEffectiveApiKey } from '../core/index'; // Import the getter

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
const getPageMetadata = (): PageMetadata => { // Use the new type
    const metadata: Partial<PageMetadata> = {}; // Use Partial for initialization

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
    // --- End Added Metadata ---


    // Type assertion since we know all properties are set (or explicitly null)
    return metadata as PageMetadata;
};


/**
 * Sends feedback (including optional screenshot, optional HTML, and optional prompt) to the backend.
 */
export const fetchFeedback = async (
    imageDataUrl: string | null,
    promptText: string,
    selectedHtml: string | null
): Promise<void> => {
  try {
    // Gather metadata
    const metadata = getPageMetadata();

    // --- Updated Type Definition ---
    const requestBody: {
        image?: string | null;
        prompt: string;
        html?: string | null;
        metadata: PageMetadata; // Use the updated type
    } = {
        prompt: promptText,
        metadata: metadata, // Include gathered metadata
    };
    // --- End Updated Type Definition ---

    if (imageDataUrl) {
        requestBody.image = imageDataUrl;
    }
    if (selectedHtml) {
        requestBody.html = selectedHtml;
    }

    // --- Add Authorization Header ---
    const currentApiKey = getEffectiveApiKey();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (currentApiKey) {
        headers['Authorization'] = `Bearer ${currentApiKey}`;
    } else {
        // This case should ideally not happen if initCheckra ran successfully,
        // but log a warning just in case.
        console.warn('[Checkra Service] API key/anonymous ID not available for feedback request.');
    }
    // --- End Add Authorization Header ---

    const response = await fetch(`${Settings.API_URL}/suggest/feedback`, {
      method: 'POST',
      headers: headers, // Use the updated headers object
      body: JSON.stringify(requestBody),
    });

    if (!response.ok || !response.body) {
      // Throw error to be caught below
      throw new Error(`Feedback request failed: ${response.status} ${response.statusText}`);
    }

    // Stream the response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log("Feedback stream complete");
        feedbackViewer.finalizeResponse(); // Signal end of stream
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      // console.log("Feedback chunk:", chunk); // Optional: keep for debugging
      feedbackViewer.updateResponse(chunk); // Update viewer with raw chunk
    }

  } catch (error) {
    console.error("Error getting feedback:", error);
    // Display error in the feedback viewer
    feedbackViewer.showError(error instanceof Error ? error.message : String(error));
  }
};
