import { ErrorInfo, AIFixResponse } from '../types';
import { contentViewer } from '../ui/content-viewer';
import { AIFixCache } from './ai-cache-service';

/**
 * Fetches an AI-generated fix for an error.
 */
export const fetchAIFix = async (errorInfo: ErrorInfo): Promise<void> => {
  try {
    // Show loading state
    contentViewer.showLoading();
    contentViewer.initStreamStructure();

    // Check if we have a cached fix for this error
    const cache = AIFixCache.getInstance();
    const cachedFix = cache.getCachedFix(errorInfo);

    if (cachedFix) {
      console.log("Using cached AI fix");
      
      // Initialize the structure just like with a new request
      contentViewer.initStreamStructure();
      
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
      
      // If there was loading state shown, it should naturally 
      // disappear as we populate the content
      return;
    }

    // No cached fix, fetch from API
    const response = await fetch(`https://logger-backend-psi.vercel.app/api/suggest/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(errorInfo),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to get AI fix: ${response.status} ${response.statusText}`);
    }

    // Prepare to stream the response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Object to store partially parsed data
    let partialData: {
      issue?: string;
      fix?: string[];
      codeExample?: string;
    } = {};

    // Process the incoming stream
    const processBuffer = () => {
      // Extract issue if not already found
      if (!partialData.issue) {
        const issueMatch = buffer.match(/"issue"\s*:\s*"([^"]+)"/);
        if (issueMatch) {
          partialData.issue = issueMatch[1];
          contentViewer.updateIssue(partialData.issue);
        }
      }

      // Look for the fix array
      if (!partialData.fix) {
        try {
          // First try to find the start and end of the "fix" array
          const startMatch = buffer.match(/"fix"\s*:\s*\[/);
          if (startMatch) {
            const startIndex = buffer.indexOf(startMatch[0]) + startMatch[0].length;
            let bracketCount = 1; // We're already inside one bracket
            let endIndex = startIndex;

            // Find the matching closing bracket for the array
            for (let i = startIndex; i < buffer.length; i++) {
              if (buffer[i] === '[') bracketCount++;
              if (buffer[i] === ']') bracketCount--;

              if (bracketCount === 0) {
                endIndex = i + 1;
                break;
              }
            }

            // If we found a complete array
            if (bracketCount === 0) {
              const fixArrayStr = '[' + buffer.substring(startIndex, endIndex - 1) + ']';
              try {
                const fixArray = JSON.parse(fixArrayStr);
                if (Array.isArray(fixArray)) {
                  partialData.fix = fixArray;
                  contentViewer.updateFix(fixArray);
                }
              } catch (e) {
                // If parsing fails, we might have an incomplete array
                console.log("Fix array not yet complete");
              }
            }
          }
        } catch (e) {
          console.log("Still collecting fix data");
        }
      }

      // Extract code example
      if (!partialData.codeExample) {
        try {
          const codeExampleStartMatch = buffer.match(/"codeExample"\s*:\s*"/);
          if (codeExampleStartMatch) {
            const startIndex = buffer.indexOf(codeExampleStartMatch[0]) + codeExampleStartMatch[0].length;

            // Find the end of the code example (looking for a quote that's not escaped)
            let endIndex = -1;
            let i = startIndex;
            while (i < buffer.length) {
              if (buffer[i] === '"' && buffer[i - 1] !== '\\') {
                endIndex = i;
                break;
              }
              i++;
            }

            if (endIndex > -1) {
              partialData.codeExample = buffer.substring(startIndex, endIndex);
              contentViewer.updateCodeExample(partialData.codeExample);
            }
          }
        } catch (e) {
          console.log("Still collecting code example data");
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log("Stream complete");
        // Final processing of any remaining data
        processBuffer();
        
        // Cache the complete fix
        if (Object.keys(partialData).length > 0) {
          cache.cacheFix(errorInfo, partialData as AIFixResponse);
        }
        
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      console.log("Received chunk:", chunk.length, "bytes");
      processBuffer();
    }

  } catch (error) {
    console.error("Error in fetchAIFix:", error);
    contentViewer.showError(error instanceof Error ? error.message : String(error));
  }
};