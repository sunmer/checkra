import Settings from '../settings';
import { ErrorInfo, AIFixResponse } from '../types';
import { contentViewer } from '../ui/content-viewer';
import { AIFixCache } from './ai-cache-service';
import { parseMarkdown } from './markdown-parser';
import { sourceCodeService } from '../services/source-code-service';
/**
 * Fetches an AI-generated fix for an error.
 */
export const fetchAIFix = async (errorInfo: ErrorInfo): Promise<void> => {
  try {
    // Show loading state
    contentViewer.showLoading();
    contentViewer.initStreamStructure(errorInfo);

    // Check if we have a cached fix for this error
    const cache = AIFixCache.getInstance();
    const cachedFix = cache.getCachedFix(errorInfo);

    if (cachedFix) {
      console.log("Using cached AI fix");

      // Initialize the structure just like with a new request
      contentViewer.initStreamStructure(errorInfo);

      // Use the cached response
      if (cachedFix.issue) {
        contentViewer.updateIssue(cachedFix.issue);
      }

      if (cachedFix.fix && Array.isArray(cachedFix.fix)) {
        contentViewer.updateFix(cachedFix.fix);
      }

      if (cachedFix.codeExample) {
        contentViewer.updateCodeExample(cachedFix.codeExample);
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
        console.log("Received chunk:", chunk.length, "bytes");

        // Process markdown as it comes in
        processMarkdownBuffer(buffer, markdownData);
      }
    }
  } catch (error) {
    console.error("Error in fetchAIFix:", error);
    contentViewer.showError(error instanceof Error ? error.message : String(error));
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
    contentViewer.updateIssue(parsedData.issue);
  }

  if (parsedData.fix && JSON.stringify(parsedData.fix) !== JSON.stringify(markdownData.fix)) {
    markdownData.fix = parsedData.fix;
    contentViewer.updateFix(parsedData.fix);
  }

  if (parsedData.codeExample && parsedData.codeExample !== markdownData.codeExample) {
    markdownData.codeExample = parsedData.codeExample;
    contentViewer.updateCodeExample(parsedData.codeExample);
  }
}