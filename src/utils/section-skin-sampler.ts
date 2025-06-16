import { parseColorString, rgbaToHex } from './color-utils';
import { SectionSample } from '../types';
import { customLog } from './logger';

/**
 * Collects logical sections from the page and returns up to two distinct skin samples
 * (one with a heading and one without) according to the spec provided.
 */
export function collectSectionSkinSamples(): SectionSample[] {
  const rootSelectors = ['main', '[role="main"]', '.prose', '.page-wrapper', 'body'];
  let root: HTMLElement | null = null;
  for (const sel of rootSelectors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) { root = el; break; }
  }
  if (!root) root = document.body;

  const candidates: Array<{ el: HTMLElement; sample: SectionSample; area: number; key: string; }> = [];

  const viewportWidth = window.innerWidth;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);

  while (walker.nextNode()) {
    const el = walker.currentNode as HTMLElement;
    if (el === root) continue;

    // Skip hidden/off-screen elements
    const st = getComputedStyle(el);
    if (el.offsetParent === null && st.position !== 'fixed') continue; // position:fixed elements have null offsetParent
    if (st.visibility === 'hidden' || st.visibility === 'collapse') continue;
    if (st.display === 'none') continue;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    // Rule 1 – width / max-w heuristic
    const renderedWideEnough = rect.width / viewportWidth >= 0.7;
    let maxWpx = 0;
    const maxWprop = st.maxWidth;
    if (maxWprop && maxWprop !== 'none') {
      if (maxWprop.endsWith('rem')) {
        const rem = parseFloat(maxWprop);
        maxWpx = rem * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
      } else if (maxWprop.endsWith('px')) {
        maxWpx = parseFloat(maxWprop);
      }
    }
    const maxWenough = maxWpx >= 1024; // ≈64rem
    if (!renderedWideEnough && !maxWenough) continue;

    // Rule 2 – spacing top & bottom >= 24px each
    const topSpacing = parseFloat(st.marginTop) + parseFloat(st.paddingTop);
    const bottomSpacing = parseFloat(st.marginBottom) + parseFloat(st.paddingBottom);
    if (topSpacing < 24 || bottomSpacing < 24) continue;

    // Rule 3 – content richness
    const textLength = (el.innerText || '').trim().length;
    let blockChildren = 0;
    if (el.children && el.children.length > 0) {
      blockChildren = Array.from(el.children).filter(child => {
        const dst = getComputedStyle(child as HTMLElement);
        return dst.display !== 'inline' && dst.display !== 'inline-block' && dst.display !== 'contents';
      }).length;
    }
    if (textLength < 150 && blockChildren < 2) continue;

    // Heading presence rule
    let headingPresent = false;
    if (el.firstElementChild) {
      const firstTag = (el.firstElementChild as HTMLElement).tagName;
      headingPresent = /^H[2-4]$/.test(firstTag);
    }

    // layoutKind detection
    let layoutKind: 'single' | 'grid' | 'flex' | 'stack' = 'single';
    const firstNonTrivialChild = Array.from(el.children).find(c => {
      const dst = getComputedStyle(c as HTMLElement);
      return dst.display !== 'contents' && dst.display !== 'none';
    }) as HTMLElement | undefined;
    if (firstNonTrivialChild) {
      const d = getComputedStyle(firstNonTrivialChild).display;
      if (d === 'grid') layoutKind = 'grid';
      else if (d === 'flex') layoutKind = 'flex';
      else {
        const directBlocks = Array.from(el.children).filter(c => {
          const ds = getComputedStyle(c as HTMLElement);
          return ds.display !== 'inline' && ds.display !== 'inline-block' && ds.display !== 'contents' && ds.display !== 'none';
        }).length;
        layoutKind = directBlocks > 1 ? 'stack' : 'single';
      }
    }

    // Skin extraction
    const classListArr = Array.from(el.classList);
    const bgClass = classListArr.find(c => c.startsWith('bg-'));

    let bgColorHex: string | undefined;
    const bgColorStyle = st.backgroundColor;
    if (bgColorStyle && bgColorStyle !== 'rgba(0, 0, 0, 0)' && bgColorStyle !== 'transparent') {
      const parsed = parseColorString(bgColorStyle);
      if (parsed) bgColorHex = rgbaToHex(parsed);
    }

    const paddingPx = parseFloat(st.paddingLeft);
    const rounded = parseFloat(st.borderRadius) >= 8;

    // Shadow detection: blur-radius >= 2px
    let shadow = false;
    if (st.boxShadow && st.boxShadow !== 'none') {
      // Take the first numeric value after 2 offsets
      const numbers = st.boxShadow.match(/(-?\d+\.?\d*)px/g);
      if (numbers && numbers.length >= 3) {
        const blur = parseFloat(numbers[2]);
        shadow = blur >= 2;
      }
    }

    const spacingBelowPx = parseFloat(st.marginBottom) + parseFloat(st.paddingBottom);

    const sample: SectionSample = {
      skin: {
        bgClass,
        bgColor: bgColorHex,
        paddingPx,
        rounded,
        shadow,
      },
      headingPresent,
      layoutKind,
      widthPx: rect.width,
      spacingBelowPx,
    };

    const area = rect.width * rect.height;

    const key = `${bgColorHex || ''}|${paddingPx}|${rounded ? 1 : 0}|${shadow ? 1 : 0}`;

    candidates.push({ el, sample, area, key });
  }

  // Deduplicate: keep largest area per key
  const dedupMap = new Map<string, { sample: SectionSample; area: number; }>();
  for (const c of candidates) {
    const existing = dedupMap.get(c.key);
    if (!existing || c.area > existing.area) {
      dedupMap.set(c.key, { sample: c.sample, area: c.area });
    }
  }

  const dedupedSamples = Array.from(dedupMap.values()).map(v => v.sample);

  // Pick two: one with heading, one without, preferring larger area
  let withHeading: SectionSample | undefined;
  let withoutHeading: SectionSample | undefined;

  for (const s of dedupedSamples.sort((a, b) => (b.widthPx || 0) - (a.widthPx || 0))) {
    if (s.headingPresent && !withHeading) withHeading = s;
    if (!s.headingPresent && !withoutHeading) withoutHeading = s;
    if (withHeading && withoutHeading) break;
  }

  const result: SectionSample[] = [];
  if (withHeading) result.push(withHeading);
  if (withoutHeading) result.push(withoutHeading);

  customLog('[SectionSkinSampler] collected', result);
  return result;
} 