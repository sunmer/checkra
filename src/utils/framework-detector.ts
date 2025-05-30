export interface DetectedFramework {
  name: 'tailwind' | 'bootstrap' | 'material-ui' | 'custom';
  version: string | 'unknown';
  confidence: number; // 0 (no confidence) -> 1 (high confidence)
}

/**
 * Very lightweight runtime detector that inspects link/script URLs and common class patterns.
 * Falls back to `custom` if nothing matches.
 */
export function detectCssFramework(): DetectedFramework {
  // 1. Look at href/src attributes
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"], script[src]')) as (HTMLLinkElement | HTMLScriptElement)[];
  for (const el of links) {
    const url = (el as any).href || (el as any).src || '';
    if (/tailwind/i.test(url)) {
      const m = url.match(/@([0-9]+\.[0-9]+\.[0-9]+)/);
      return { name: 'tailwind', version: m ? m[1] : 'unknown', confidence: 0.95 };
    }
    if (/bootstrap/i.test(url)) {
      const m = url.match(/v([0-9]+\.[0-9]+\.[0-9]+)/);
      return { name: 'bootstrap', version: m ? m[1] : 'unknown', confidence: 0.95 };
    }
    if (/mui|material-ui/i.test(url)) {
      const m = url.match(/@([0-9]+\.[0-9]+\.[0-9]+)/);
      return { name: 'material-ui', version: m ? m[1] : 'unknown', confidence: 0.95 };
    }
  }

  // 2. Sample class tokens
  const bodyClassTokens = new Set<string>();
  const maxTokens = 2000;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode() && bodyClassTokens.size < maxTokens) {
    const node = walker.currentNode as Element;
    let classString = '';
    if (node instanceof HTMLElement) {
      classString = node.className;
    } else if (node instanceof SVGElement) {
      classString = node.getAttribute('class') || '';
    }
    if (classString) {
      classString.split(/\s+/).forEach(t => t && bodyClassTokens.add(t));
    }
  }

  // Simple scoring
  let tailwindScore = 0;
  let bootstrapScore = 0;
  let muiScore = 0;
  bodyClassTokens.forEach(token => {
    if (/sm:|lg:|\[.*\]/.test(token)) tailwindScore += 2;
    if (/^col-\d|^g-\d|^fs-/.test(token)) bootstrapScore += 2;
    if (/^Mui[A-Z]/.test(token)) muiScore += 3;
  });

  const maxScore = Math.max(tailwindScore, bootstrapScore, muiScore);
  if (maxScore === 0) return { name: 'custom', version: new Date().toISOString().split('T')[0], confidence: 0.0 };

  const total = tailwindScore + bootstrapScore + muiScore;
  const conf = total > 0 ? maxScore / total : 0.0;

  if (maxScore === tailwindScore) return { name: 'tailwind', version: 'unknown', confidence: conf };
  if (maxScore === bootstrapScore) return { name: 'bootstrap', version: 'unknown', confidence: conf };
  return { name: 'material-ui', version: 'unknown', confidence: conf };
} 