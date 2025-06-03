import { customWarn, customError } from '../utils/logger';
import { SPECIFIC_HTML_REGEX, GENERIC_HTML_REGEX, SVG_PLACEHOLDER_REGEX } from '../utils/regex';

export interface ExtractedFix {
  fixedHtml: string | null;
  analysisPortion: string | null;
}

export class AIResponsePipeline {
  private originalSvgsMap: Map<string, string> = new Map();
  private svgPlaceholderCounter: number = 0;

  constructor() {
    // Initialization if needed
  }

  public preprocessHtmlForAI(htmlString: string): string {
    // Ensure class properties are used for map and counter
    this.originalSvgsMap.clear();
    this.svgPlaceholderCounter = 0; 

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const svgs = doc.querySelectorAll('svg');

    svgs.forEach(svg => {
      const placeholderId = `checkra-svg-${this.svgPlaceholderCounter++}`;
      this.originalSvgsMap.set(placeholderId, svg.outerHTML);

      const placeholder = doc.createElement('svg');
      placeholder.setAttribute('data-checkra-id', placeholderId);
      placeholder.setAttribute('viewBox', '0 0 1 1');
      svg.parentNode?.replaceChild(placeholder, svg);
    });

    let processedHtmlString;
    if (doc.body.childNodes.length === 1 && doc.body.firstElementChild && htmlString.trim().startsWith(`<${doc.body.firstElementChild.tagName.toLowerCase()}`)) {
      processedHtmlString = doc.body.firstElementChild.outerHTML;
    } else {
      processedHtmlString = doc.body.innerHTML;
    }
    customWarn('[AIResponsePipeline DEBUG] preprocessHtmlForAI output:', processedHtmlString.slice(0,300));
    return processedHtmlString;
  }

  public postprocessHtmlFromAI(aiHtmlString: string): string {
    if (this.originalSvgsMap.size === 0) {
      return aiHtmlString;
    }
    let restoredHtml = aiHtmlString.replace(SVG_PLACEHOLDER_REGEX, (match, placeholderId) => {
      const originalSvg = this.originalSvgsMap.get(placeholderId);
      if (originalSvg) {
        return originalSvg;
      } else {
        customWarn(`[AIResponsePipeline] Original SVG not found for placeholder ID: ${placeholderId}. Leaving placeholder.`);
        return match;
      }
    });
    return restoredHtml;
  }

  // Helper to create fragments, moved here if it's only used for HTML processing within this pipeline
  // Or it can be a shared utility / remain in CheckraImplementation if used more broadly.
  // For now, let's assume it might be useful here for parsing/scrubbing.
  private createFragmentFromHTML(htmlString: string): DocumentFragment | null {
    try {
      const template = document.createElement('template');
      template.innerHTML = htmlString.trim();
      return template.content;
    } catch (e) {
      customError("[AIResponsePipeline] Error creating fragment from HTML string:", e, htmlString);
      return null;
    }
  }

  private scrubLeadingNonElementNodes(html: string): string {
    const frag = this.createFragmentFromHTML(html);
    if (!frag) return html;
    while (frag.firstChild && (frag.firstChild.nodeType === Node.COMMENT_NODE || frag.firstChild.nodeType === Node.TEXT_NODE)) {
        const child = frag.firstChild;
        // Remove empty text nodes or any comment nodes
        if (child.nodeType === Node.COMMENT_NODE || (child.nodeType === Node.TEXT_NODE && child.textContent?.trim() === '')) {
            frag.removeChild(child);
        } else if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim() !== '') {
            // If it's a non-empty text node (likely human commentary before HTML), remove it too.
            frag.removeChild(child);
        } else {
            break; // Should not happen if logic is correct, but good to prevent infinite loop
        }
    }
    const temp = document.createElement('div');
    temp.appendChild(frag);
    return temp.innerHTML;
  }

  public extractHtmlFromResponse(responseText: string): ExtractedFix {
    let match = responseText.match(SPECIFIC_HTML_REGEX);
    if (!match) {
      match = responseText.match(GENERIC_HTML_REGEX);
    }

    let extractedHtml: string | null = null;
    let analysisPortion: string | null = null;

    if (match && match[1]) {
      extractedHtml = match[1].trim();
      analysisPortion = responseText.replace(match[0], '').trim();
    } else {
      const tagRegex = /<\s*(div|section|article|main|header|footer|nav|ul|ol|li|p|h[1-6]|details|summary)[^>]*>/i;
      const tagMatch = tagRegex.exec(responseText);
      const startIdx = tagMatch ? tagMatch.index : responseText.indexOf('<');
      if (startIdx !== -1) {
        extractedHtml = responseText.slice(startIdx).trim();
        analysisPortion = responseText.slice(0, startIdx).trim();
      }
    }

    if (extractedHtml) {
      try {
        extractedHtml = this.postprocessHtmlFromAI(extractedHtml);
        extractedHtml = this.scrubLeadingNonElementNodes(extractedHtml);

        // Validate if the extracted HTML is non-empty after scrubbing
        const tempFragment = this.createFragmentFromHTML(extractedHtml);
        if (!tempFragment || tempFragment.childNodes.length === 0) {
            customWarn('[AIResponsePipeline DEBUG] extractHtmlFromResponse: Extraction produced empty or invalid HTML fragment after scrubbing.');
            extractedHtml = null; // Discard if empty/invalid
            // Keep analysisPortion as is if HTML is invalid
        }
      } catch (e) {
        customError('[AIResponsePipeline DEBUG] extractHtmlFromResponse: Error during postprocessing/validation:', e);
        extractedHtml = null;
      }
    }
    return { fixedHtml: extractedHtml, analysisPortion: analysisPortion || (extractedHtml === null ? responseText : null) }; // Ensure analysis is non-null if html is null
  }

  public processJsonPatchedHtml(patchedHtml: string): string {
    let processedHtml = patchedHtml;
    const firstTagIndex = processedHtml.indexOf('<');
    if (firstTagIndex > 0) {
      processedHtml = processedHtml.slice(firstTagIndex);
    }
    processedHtml = this.postprocessHtmlFromAI(processedHtml);
    processedHtml = this.scrubLeadingNonElementNodes(processedHtml);
    return processedHtml;
  }
} 