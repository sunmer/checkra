export function generateStableSelector(element: Element): string {
  if (!element || typeof element.tagName !== 'string') {
    console.error('[Selector Utils] Invalid element provided to generateStableSelector:', element);
    return ''; // Or throw an error
  }

  // --- Helper: Check selector uniqueness and validity ---
  const isSelectorUnique = (selector: string, target: Element): boolean => {
    if (!selector) return false;
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === target;
    } catch (e) {
      // console.warn(`[Selector Utils] Selector "${selector}" is invalid or query failed:`, e);
      return false;
    }
  };

  // 1. Prioritize ID if unique and valid
  if (element.id) {
    const id = element.id;
    // More robust ID validation: starts with a letter, followed by letters, digits, hyphens, underscores.
    if (/^[a-zA-Z][a-zA-Z0-9_\\-]*$/.test(id)) {
      const idSelector = `#${CSS.escape(id)}`; // Use CSS.escape for robustness
      if (isSelectorUnique(idSelector, element)) {
        return idSelector;
      }
    }
  }

  // --- Anchor-based strategy ---
  let anchorElement: Element | null = null;
  let anchorSelector: string | null = null;
  let currentForAnchorSearch: Element | null = element;

  const MAX_ANCESTOR_DEPTH = 10; // Prevent excessively deep searches
  let depth = 0;

  while (currentForAnchorSearch && currentForAnchorSearch.parentElement && depth < MAX_ANCESTOR_DEPTH) {
    if (currentForAnchorSearch.id) {
      const id = currentForAnchorSearch.id;
      if (/^[a-zA-Z][a-zA-Z0-9_\\-]*$/.test(id)) {
        const tempAnchorSelector = `#${CSS.escape(id)}`;
        if (isSelectorUnique(tempAnchorSelector, currentForAnchorSearch)) {
          anchorElement = currentForAnchorSearch;
          anchorSelector = tempAnchorSelector;
          break;
        }
      }
    }

    if (!anchorElement) { // Only try class-based if ID anchor wasn't found for this element
      const tagName = currentForAnchorSearch.tagName.toLowerCase();
      const classes = Array.from(currentForAnchorSearch.classList)
        .filter(cls => !cls.startsWith('checkra-') && CSS.escape(cls)) // Filter and ensure valid
        .map(cls => `.${CSS.escape(cls)}`);
      
      if (classes.length > 0) {
        const tempAnchorSelector = tagName + classes.join('');
        if (isSelectorUnique(tempAnchorSelector, currentForAnchorSearch)) {
          anchorElement = currentForAnchorSearch;
          anchorSelector = tempAnchorSelector;
          break;
        }
      }
    }
    
    if (currentForAnchorSearch.tagName.toLowerCase() === 'body') {
        anchorElement = currentForAnchorSearch;
        anchorSelector = 'body'; // Default anchor
        break;
    }
    currentForAnchorSearch = currentForAnchorSearch.parentElement;
    depth++;
  }

  if (!anchorElement || !anchorSelector) {
    // Fallback to body if no better anchor was found
    anchorElement = document.body;
    anchorSelector = 'body';
  }

  // If the element itself is the chosen anchor
  if (anchorElement === element) {
    if (isSelectorUnique(anchorSelector, element)) {
      return anchorSelector;
    }
    // If anchorSelector (e.g. 'body') isn't specific enough for the element itself,
    // we need to try path from body anyway.
  }

  // Generate relative path from anchor to element
  const pathSegments: string[] = [];
  let currentForPath: Element | null = element;

  // Loop condition ensures currentForPath and currentForPath.parentElement are non-null inside.
  while (currentForPath && currentForPath !== anchorElement && currentForPath.parentElement) {
    const tagName = currentForPath.tagName.toLowerCase();
    let segment = tagName;

    const parent = currentForPath.parentElement; // parent is guaranteed non-null here by loop condition
    // if (parent) { // This check is redundant due to loop condition
    const siblingsOfType = Array.from(parent.children)
                                .filter(child => child.tagName === currentForPath!.tagName); // currentForPath is non-null
    if (siblingsOfType.length > 1) {
      const index = siblingsOfType.indexOf(currentForPath!) + 1; // currentForPath is non-null
      segment += `:nth-of-type(${index})`;
    }
    // }
    pathSegments.unshift(segment);
    currentForPath = currentForPath.parentElement; // Re-assign for next iteration
  }
  
  if (pathSegments.length > 0) {
    const combinedSelector = `${anchorSelector} > ${pathSegments.join(' > ')}`;
    if (isSelectorUnique(combinedSelector, element)) {
      return combinedSelector;
    }
  }
  
  // --- Fallback to original path-based logic if anchor strategy fails ---
  const fallbackPath: string[] = [];
  let currentElFallback: Element | null = element;
  // Loop condition ensures currentElFallback and currentElFallback.parentElement are non-null inside.
  while (currentElFallback && currentElFallback.parentElement) {
    let segment = currentElFallback.tagName.toLowerCase();
    if (currentElFallback.id) {
      const id = currentElFallback.id;
      if (/^[a-zA-Z][a-zA-Z0-9_\\-]*$/.test(id)) {
        segment = `${segment}#${CSS.escape(id)}`;
        const tempSel = fallbackPath.length > 0 ? `${segment} > ${fallbackPath.join(' > ')}` : segment;
        if (isSelectorUnique(tempSel, element)) {
          fallbackPath.unshift(segment);
          const finalFallback = fallbackPath.join(' > ');
          if (isSelectorUnique(finalFallback, element)) return finalFallback;
        }
      }
    }
    
    const parentFallback = currentElFallback.parentElement; // Guaranteed non-null by loop
    // if (parentFallback) { // This check is redundant
    const children = Array.from(parentFallback.children);
    const index = children.indexOf(currentElFallback!) + 1; // currentElFallback is non-null
    if (children.length > 1 && !segment.includes('#')) { 
        const potentialSegment = `${segment}:nth-child(${index})`;
        const testPath = [potentialSegment, ...fallbackPath].join(' > ');
        if (isSelectorUnique(testPath, element)) {
            segment = potentialSegment;
        } else { 
            const siblingsWithSameTag = children.filter(c => c.tagName === currentElFallback!.tagName);
            if (siblingsWithSameTag.length > 1) {
                 segment = `${segment}:nth-child(${index})`;
            }
        }
    }
    // }

    fallbackPath.unshift(segment);
    if (segment.includes('#') && currentElFallback !== element) break; 
    if (currentElFallback.tagName.toLowerCase() === 'body') break;
    currentElFallback = currentElFallback.parentElement;
  }
  
  const finalFallbackSelector = fallbackPath.join(' > ');
  if (isSelectorUnique(finalFallbackSelector, element)) {
    return finalFallbackSelector;
  }

  const tagNameSelector = element.tagName.toLowerCase();
  if (isSelectorUnique(tagNameSelector, element)) {
    console.warn(`[Selector Utils] All strategies failed, falling back to simple tagName for:`, element);
    return tagNameSelector;
  }

  console.error(`[Selector Utils] Could not generate a unique selector for element:`, element, `. Returning basic tagName.`);
  return element.tagName.toLowerCase();
} 