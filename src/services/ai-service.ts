import Settings from '../settings';
import { feedbackViewer } from '../ui/feedback-viewer';


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

    const response = await fetch(`${Settings.API_URL}/suggest/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
