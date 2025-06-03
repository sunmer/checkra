export const SPECIFIC_HTML_REGEX = /# Complete HTML with All Fixes\s*```(?:html)?\n([\s\S]*?)\n```/i;
export const GENERIC_HTML_REGEX = /```(?:html)?\n([\s\S]*?)\n```/i;
export const SVG_PLACEHOLDER_REGEX = /<svg\s+data-checkra-id="([^\"")]+)".*?>[\s\S]*?<\/svg>/g; 