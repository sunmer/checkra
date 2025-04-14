import Settings from '../settings';
import { ErrorInfo, AIFixResponse } from '../types';
import { codeFixViewer } from '../ui/code-fix-viewer';
import { feedbackViewer } from '../ui/feedback-viewer';
import { AIFixCache } from './ai-cache-service';
import { parseMarkdown } from './markdown-parser';
import { sourceCodeService } from '../services/source-code-service';
/**
 * Fetches an AI-generated fix for an error.
 */
export const fetchCodeFix = async (errorInfo: ErrorInfo): Promise<void> => {
  try {
    // Show loading state
    codeFixViewer.showLoading();
    codeFixViewer.initStreamStructure(errorInfo);

    // Check if we have a cached fix for this error
    const cache = AIFixCache.getInstance();
    const cachedFix = cache.getCachedFix(errorInfo);

    if (cachedFix) {
      console.log("Using cached AI fix");

      // Initialize the structure just like with a new request
      codeFixViewer.initStreamStructure(errorInfo);

      // Use the cached response
      if (cachedFix.issue) {
        codeFixViewer.updateIssue(cachedFix.issue);
      }

      if (cachedFix.fix && Array.isArray(cachedFix.fix)) {
        codeFixViewer.updateFix(cachedFix.fix);
      }

      if (cachedFix.codeExample) {
        codeFixViewer.updateCodeExample(cachedFix.codeExample);
      }

      return;
    }

    const sourceResult = await sourceCodeService.getSourceCode(errorInfo);

    if (sourceResult) {
      const sourceCode = sourceCodeService.generateSourceCode(sourceResult);
      sourceCodeService.generateSourceCodeHTML(sourceResult);

      // No cached fix, fetch from API
      const response = await fetch(`${Settings.API_URL}/suggest/error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...errorInfo,
          sourceCode: sourceCode
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Failed to get AI fix: ${response.status} ${response.statusText}`);
      }

      // Prepare to stream the response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Object to store parsed data
      let markdownData: {
        issue?: string;
        fix?: string[];
        codeExample?: string;
      } = {};

      // Process incoming stream chunks
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log("Stream complete");
          // Final parsing of any remaining data
          processMarkdownBuffer(buffer, markdownData);

          // Cache the complete fix
          if (Object.keys(markdownData).length > 0) {
            cache.cacheFix(errorInfo, markdownData as AIFixResponse);
          }

          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        console.log(chunk);

        // Process markdown as it comes in
        processMarkdownBuffer(buffer, markdownData);
      }
    }
  } catch (error) {
    console.error("Error in fetchAIFix:", error);
    codeFixViewer.showError(error instanceof Error ? error.message : String(error));
  }
};

/**
 * Process the markdown buffer and update the UI
 */
function processMarkdownBuffer(buffer: string, markdownData: any): void {
  // Parse the markdown content
  const parsedData = parseMarkdown(buffer);

  // Update UI with any new content
  if (parsedData.issue && parsedData.issue !== markdownData.issue) {
    markdownData.issue = parsedData.issue;
    codeFixViewer.updateIssue(parsedData.issue);
  }

  if (parsedData.fix && JSON.stringify(parsedData.fix) !== JSON.stringify(markdownData.fix)) {
    markdownData.fix = parsedData.fix;
    codeFixViewer.updateFix(parsedData.fix);
  }

  if (parsedData.codeExample && parsedData.codeExample !== markdownData.codeExample) {
    markdownData.codeExample = parsedData.codeExample;
    codeFixViewer.updateCodeExample(parsedData.codeExample);
  }
}

/**
 * Sends feedback (including a screenshot and optional prompt) to the backend.
 */
export const fetchFeedback = async (imageDataUrl: string, promptText: string): Promise<void> => {
  // Note: feedbackViewer UI should be in 'sending' state before this is called
  try {
    const response = await fetch(`${Settings.API_URL}/suggest/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: imageDataUrl,
        prompt: promptText
      }),
    });

    if (!response.ok || !response.body) {
      // Throw error to be caught below
      throw new Error(`Feedback request failed: ${response.status} ${response.statusText}`);
    }

    // Signal viewer to clear "Sending..." message and prepare for stream
    feedbackViewer.prepareForStream();

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
    console.error("Error sending feedback:", error);
    // Display error in the feedback viewer
    feedbackViewer.showError(error instanceof Error ? error.message : String(error));
  }
};
