import Settings from '../settings';
import { feedbackViewer } from '../ui/feedback-viewer';
import { getEffectiveApiKey } from '../core/index'; // Import the getter


/**
 * Sends feedback (including optional screenshot, optional HTML, and optional prompt) to the backend.
 */
export const fetchFeedback = async (
    imageDataUrl: string | null,
    promptText: string,
    selectedHtml: string | null
): Promise<void> => {
  try {
    // Construct body conditionally based on available data
    const requestBody: { image?: string | null; prompt: string; html?: string | null } = {
        prompt: promptText,
    };
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
