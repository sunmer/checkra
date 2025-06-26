import { parseColorString } from './color-utils';
import { PageFingerprint, ContainerFingerprint } from '../types';
import { customLog, customWarn } from './logger';
import { collectAtoms } from './atom-sampler';

// Alignment utilities regex (shared)
const ALIGN_RE = /^(text|items|self|place|content)-(center|left|right|justify)$/;

function colorStringToRgbaOrNull(colStr: string | null): string | undefined {
  if (!colStr) return undefined;
  const parsed = parseColorString(colStr);
  if (!parsed) return undefined;
  const { r, g, b, a } = parsed;
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Collects the new UI-fingerprint payload for the current page.
 * This is an initial implementation that will be refined over time.
 */
export function collectPageFingerprint(): PageFingerprint {
  const containers: ContainerFingerprint[] = [];

  // Strategy: query all <section> and large <div> wrappers similar to old sampler.
  const sectionEls = Array.from(document.querySelectorAll('section')) as HTMLElement[];
  if (sectionEls.length === 0) {
    // Fallback to big divs inside main/body
    const bigDivs = Array.from(document.querySelectorAll('main div, body > div')) as HTMLElement[];
    bigDivs.forEach(d => sectionEls.push(d));
  }

  const viewportW = window.innerWidth;
  // Width occupied by the Checkra viewer (if present). We will treat everything to its left as the
  // main working area. This allows width checks to be relative to the usable viewport.
  let usableViewportW = viewportW;
  const viewerEl = document.getElementById('checkra-feedback-viewer');
  if (viewerEl) {
    const viewerRect = viewerEl.getBoundingClientRect();
    // If the viewer sits on the right side, subtract its width from usable area
    if (viewerRect.left >= 0 && viewerRect.width > 0) {
      usableViewportW = Math.max(50, viewportW - viewerRect.width);
    }
  }
  let idCounter = 1;

  sectionEls.forEach(el => {
    try {
      const rect = el.getBoundingClientRect();
      // Skip containers that are inside or overlap the Checkra viewer sidebar
      if (el.closest('#checkra-feedback-viewer')) {
        return;
      }
      // Also skip if the element is positioned to the right of the viewer (i.e., entirely within the viewer area)
      if (viewerEl) {
        const viewerRect = viewerEl.getBoundingClientRect();
        if (rect.left >= viewerRect.left) {
          return;
        }
      }

      // Relaxed threshold: consider sections as containers if they occupy at least 40 % of the usable viewport width
      // or are wider than 300 px (helps with mobile-optimised layouts).
      const MIN_ABS_WIDTH = 300;
      const MIN_WIDTH_RATIO = 0.4; // 40 %
      if (rect.width < Math.max(MIN_ABS_WIDTH, usableViewportW * MIN_WIDTH_RATIO) || rect.height < 80) {
        return; // Skip narrow/small blocks
      }

      const st = getComputedStyle(el);

      // ---- Text & Heading colour detection ----
      let textRgba: string | undefined;
      let headingRgba: string | undefined;

      // Helper to locate first descendant with a colour utility and return its RGBA string
      const findColourInfo = (selector: string): { rgba?: string } => {
        const nodes = el.querySelectorAll(selector);
        for (const node of Array.from(nodes)) {
          const clsTokens = safeSplitClassNames(node as Element);
          const colourToken = clsTokens.find(isColorUtility);
          if (colourToken) {
            const c = colorStringToRgbaOrNull(getComputedStyle(node as HTMLElement).color);
            if (c) return { rgba: c };
          }
        }
        return {};
      };

      // 1) Try colour utilities first
      const textInfo = findColourInfo('p, li, span');
      textRgba = textInfo.rgba;

      const headingInfo = findColourInfo('h1, h2, h3, h4');
      headingRgba = headingInfo.rgba;

      // 2) Fallbacks – computed colour even without utility
      if (!textRgba) {
        const p = el.querySelector('p');
        if (p) textRgba = colorStringToRgbaOrNull(getComputedStyle(p).color);
        if (!textRgba) textRgba = colorStringToRgbaOrNull(st.color);
      }

      if (!headingRgba) {
        const h = el.querySelector('h1, h2, h3, h4');
        if (h) headingRgba = colorStringToRgbaOrNull(getComputedStyle(h as HTMLElement).color);
      }

      // layoutKind heuristic – similar rules as old sampler
      let layoutKind: ContainerFingerprint['layoutKind'] = 'stack';
      const directBlocks = Array.from(el.children).filter(c => {
        const cs = getComputedStyle(c as HTMLElement);
        return cs.display !== 'inline' && cs.display !== 'contents' && cs.display !== 'none';
      });
      if (directBlocks.length === 1) {
        const d = getComputedStyle(directBlocks[0] as HTMLElement).display;
        if (d === 'grid') layoutKind = 'grid';
        else layoutKind = 'single';
      } else if (directBlocks.length > 1) {
        layoutKind = 'stack';
      }

      // role heuristic – hero if near top, contrast if dark bg, etc.
      const role: ContainerFingerprint['role'] = 'contrast';

      const wrapperClasses = Array.from(el.classList);

      const cleanedWrapper = wrapperClasses.filter(c => !ALIGN_RE.test(c));

      // Pixel area (rect.width * rect.height) could be useful for future heuristics – ignored for payload

      // --- Compute effective background (first opaque ancestor background) ---
      const resolveEffectiveBg = (startEl: HTMLElement): string | undefined => {
        let cur: HTMLElement | null = startEl;
        while (cur) {
          const bgStr = getComputedStyle(cur).backgroundColor;
          const parsed = parseColorString(bgStr);
          if (parsed && parsed.a !== undefined && parsed.a >= 0.99) {
            return `rgba(${parsed.r},${parsed.g},${parsed.b},${parsed.a})`;
          }
          cur = cur.parentElement;
        }
        return 'rgba(255,255,255,1)'; // default white
      };

      const effectiveBg = resolveEffectiveBg(el);

      // --- Dominant background via area tally ---
      const areaByColor: Record<string, number> = {};
      const tallyArea = (elem: HTMLElement) => {
        const styleBg = getComputedStyle(elem).backgroundColor;
        const parsed = parseColorString(styleBg);
        if (parsed && parsed.a !== undefined && parsed.a >= 0.99) {
          const key = `rgba(${parsed.r},${parsed.g},${parsed.b},${parsed.a})`;
          const r = elem.getBoundingClientRect();
          areaByColor[key] = (areaByColor[key] || 0) + r.width * r.height;
        }
      };

      tallyArea(el);
      // Scan descendants but keep cost low (≤300 nodes)
      const descendents = Array.from(el.querySelectorAll('*')).slice(0, 300) as HTMLElement[];
      descendents.forEach(tallyArea);

      let dominantBg = effectiveBg;
      const sortedArea = Object.entries(areaByColor).sort((a, b) => b[1] - a[1]);
      if (sortedArea.length > 0) dominantBg = sortedArea[0][0];

      // Muted text detection – any element with text utility differing from body/heading
      let mutedClass: string | undefined;
      let computedMutedColor: string | undefined;
      if (textRgba || headingRgba) {
        const nodes = el.querySelectorAll('span, p, li, small');
        for (const node of Array.from(nodes)) {
          const clsTokens = safeSplitClassNames(node as Element);
          const colourToken = clsTokens.find(isColorUtility);
          if (!colourToken) continue;
          const currentColor = colorStringToRgbaOrNull(getComputedStyle(node as HTMLElement).color);
          if (currentColor === textRgba || currentColor === headingRgba) continue;
          const c = colorStringToRgbaOrNull(getComputedStyle(node as HTMLElement).color);
          if (c) {
            mutedClass = colourToken;
            computedMutedColor = c;
            break;
          }
        }
      }

      const container: ContainerFingerprint = {
        id: `c${idCounter++}`,
        role,
        dominantBg,
        computedHeadingColor: headingRgba || '',
        computedBodyColor: textRgba || '',
        mutedClass,
        computedMutedColor,
        wrapperClasses: cleanedWrapper,
        layoutKind,
      } as ContainerFingerprint & { _top?: number };
      (container as any)._top = rect.top;
      (el as any).__checkra_containerId = container.id;
      containers.push(container);
    } catch (err) {
      customWarn('[PageFingerprint] failed to process section', err);
    }
  });

  // Sort by visual prominence (top-down order and area)
  containers.sort((a: any, b: any) => (a._top || 0) - (b._top || 0));
  containers.forEach(c => delete (c as any)._top);

  // Trim to 5 most prominent
  const finalContainers = containers.slice(0, 5);

  // Fallback – ensure we always have at least one container so the caller
  // receives useful data even on very simple pages.
  if (finalContainers.length === 0 && sectionEls.length > 0) {
    const fallbackEl = sectionEls[0];
    // Fallback container when none detected
    finalContainers.push({
      id: 'c0',
      role: 'body',
      wrapperClasses: Array.from(fallbackEl.classList),
      layoutKind: 'stack',
    } as any);
  }

  const atoms = collectAtoms(finalContainers);

  const fingerprint: PageFingerprint = {
    fingerprintVersion: 2,
    containers: finalContainers,
    atoms,
    meta: { generatedAt: Date.now() },
  } as any;

  customLog('[PageFingerprint] collected', fingerprint);
  return fingerprint;
}

// TODO: Remove legacy SectionSample usage once backend fully migrates to pageFingerprint 

// Helper: safely split an element's class attribute into tokens, accounting for SVGAnimatedString
function safeSplitClassNames(el: Element): string[] {
  try {
    const raw = (typeof (el as any).className === 'string')
      ? (el as any).className as string
      : ((el as any).className && typeof (el as any).className.baseVal === 'string')
        ? (el as any).className.baseVal as string
        : (el.getAttribute ? el.getAttribute('class') || '' : '');
    return raw.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

// Helper: determine whether a Tailwind class is a text color utility (and not size/alignment)
function isColorUtility(cls: string): boolean {
  if (!cls.startsWith('text-')) return false;
  // Exclude non-colour utilities
  if (/^text-transparent$/.test(cls)) return false;
  if (/^text-current$/.test(cls)) return false;
  if (/^text-\[/.test(cls)) return false;          // arbitrary value e.g. text-[rgb(…)]
  if (/\/[^/]+$/.test(cls)) return false;           // opacity variants e.g. text-white/60
  if (/^(text-(left|center|right|justify|start|end))$/.test(cls)) return false; // alignment
  if (/^text-(xs|sm|base|lg|xl|\d+xl)$/.test(cls)) return false; // font-size utilities
  return true;
} 