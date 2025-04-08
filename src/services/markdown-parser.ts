import { AIFixResponse } from '../types';

/**
 * Parses markdown content into structured data for the UI.
 * 
 * Expects markdown with sections:
 * # Issue
 * # Fix
 * # Code Example
 */
export function parseMarkdown(markdown: string): AIFixResponse {
  const result: AIFixResponse = {};
  
  // Extract Issue section
  const issueMatch = markdown.match(/# Issue\s+([^#]+)/s);
  if (issueMatch && issueMatch[1]) {
    result.issue = issueMatch[1].trim();
  }
  
  // Extract Fix section (as an array of numbered list items)
  const fixMatch = markdown.match(/# Fix\s+([^#]+)/s);
  if (fixMatch && fixMatch[1]) {
    const fixContent = fixMatch[1].trim();
    // Parse numbered list using regex
    const listItems = fixContent.split(/\n\s*\d+\.\s+/).filter(item => item.trim());
    
    // If it's a numbered list, extract each item
    if (listItems.length > 1 || fixContent.match(/^\d+\.\s+/)) {
      // Process each line to find numbered items
      const numberedItems: string[] = [];
      const lines = fixContent.split('\n');
      
      for (const line of lines) {
        const match = line.match(/^\s*\d+\.\s+(.*)/);
        if (match && match[1]) {
          numberedItems.push(match[1].trim());
        }
      }
      
      // If we found numbered items, use them
      if (numberedItems.length > 0) {
        result.fix = numberedItems;
      } else {
        // Fallback to treating each paragraph as an item
        result.fix = fixContent.split('\n\n')
          .map(item => item.trim())
          .filter(item => item.length > 0);
      }
    } else {
      // If it's not in list format, just use as is
      result.fix = [fixContent];
    }
  }
  
  // Extract Code Example section
  const codeMatch = markdown.match(/# Code Example\s+```(?:\w+)?\s*\n([\s\S]+?)```/s);
  if (codeMatch && codeMatch[1]) {
    result.codeExample = codeMatch[1].trim();
  } else {
    // Try a more relaxed match without code block formatting
    const fallbackMatch = markdown.match(/# Code Example\s+([^#]+)/s);
    if (fallbackMatch && fallbackMatch[1]) {
      let code = fallbackMatch[1].trim();
      
      // Remove additional markdown code block syntax if present
      const innerCodeMatch = code.match(/```(?:\w+)?\s*\n([\s\S]+?)```/s);
      if (innerCodeMatch && innerCodeMatch[1]) {
        code = innerCodeMatch[1].trim();
      } else if (code.startsWith('```') && code.endsWith('```')) {
        // Handle the case where we just have backticks without newlines
        code = code.substring(3, code.length - 3).trim();
        // Also remove language identifier if present
        const langMatch = code.match(/^(\w+)\s+/);
        if (langMatch) {
          code = code.substring(langMatch[0].length).trim();
        }
      }
      
      if (code !== 'N/A') {
        result.codeExample = code;
      }
    }
  }
  
  return result;
}