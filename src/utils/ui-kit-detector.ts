import { UiKitDetection } from "../types";

/**
 * Lightweight runtime detector for common UI kits.
 * Looks for specific script tags, data attributes, or global objects.
 */
export function detectUiKit(htmlStringOrContextElement?: string | HTMLElement): UiKitDetection {
  const detected: UiKitDetection = { name: null, confidence: null };
  let content = '';
  // let elementContext: Document | HTMLElement = document; // Not used in current string-based logic

  if (typeof htmlStringOrContextElement === 'string') {
    content = htmlStringOrContextElement.toLowerCase();
  } else if (htmlStringOrContextElement instanceof HTMLElement) {
    content = htmlStringOrContextElement.outerHTML.toLowerCase();
    // elementContext = htmlStringOrContextElement.ownerDocument || document; // Not used
  } else {
    content = document.body.outerHTML.toLowerCase(); // Default to whole body
  }

  // Check for Flowbite (data-hs-* attributes are actually Preline, Flowbite uses data-popover-target etc. and specific classes)
  // Flowbite often relies on classes like 'flowbite' or specific component classes, and JS via `new Flowbite()` or similar.
  // More reliable for Flowbite might be checking for `window.Flowbite` or distinctive classes if no script tags are obvious.
  if (content.includes('flowbite') || (typeof window !== 'undefined' && (window as any).Flowbite)) {
    detected.name = 'flowbite';
    detected.confidence = 0.8;
    return detected;
  }
  // Check for Preline (data-hs-* attributes)
  if (/data-hs-[\w-]+/.test(content) || content.includes('preline.js')) {
    detected.name = 'preline';
    detected.confidence = 0.9; // data-hs attributes are quite specific
    return detected;
  }
  
  // Add checks for other UI kits like Bootstrap components (data-bs-*), MUI (Mui- class prefixes)
  // This requires more context or specific patterns for those libraries if not covered by detectCssFramework.

  // Example for Bootstrap components (if not already primary CSS framework)
  if (/data-bs-(toggle|target|dismiss)/.test(content)) {
    if (detected.name !== 'bootstrap') { // Avoid overriding if already detected as primary framework
        detected.name = 'bootstrap-components'; // Differentiate from Bootstrap as CSS framework
        detected.confidence = (detected.confidence || 0) + 0.7;
    }
  }

  // Example for MUI (often has Mui- class prefixes)
  if (/class="([^"]*\s)?mui-/.test(content)) {
     if (detected.name !== 'material-ui') { // Avoid overriding
        detected.name = 'material-ui-components';
        detected.confidence = (detected.confidence || 0) + 0.7;
     }
  }
  
  if (detected.name && detected.confidence) {
    detected.confidence = Math.min(1, detected.confidence);
  }

  return detected;
}