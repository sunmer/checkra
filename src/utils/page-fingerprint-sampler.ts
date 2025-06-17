import { parseColorString, rgbaToHex } from './color-utils';
import { PageFingerprint, ContainerFingerprint, AtomsFingerprint, PreferredContainer, TextStyles, BrandTokens } from '../types';
import { customLog, customWarn } from './logger';

// Alignment utilities regex (shared)
const ALIGN_RE = /^(text|items|self|place|content)-(center|left|right|justify)$/;

/**
 * Simple heuristic luminance check – returns perceived brightness (0-255).
 */
function getLuminance(rgb: { r: number; g: number; b: number }): number {
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

function rgbStringToHexOrNull(rgbStr: string | null): string | undefined {
  if (!rgbStr) return undefined;
  const parsed = parseColorString(rgbStr);
  return parsed ? rgbaToHex(parsed) : undefined;
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
  let idCounter = 1;

  sectionEls.forEach(el => {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width < viewportW * 0.6 || rect.height < 80) return; // Skip narrow/small blocks

      const st = getComputedStyle(el);
      const bgHex = rgbStringToHexOrNull(st.backgroundColor);

      // text colour – use first <p> or fallback to el
      let textHex: string | undefined;
      const p = el.querySelector('p');
      if (p) {
        textHex = rgbStringToHexOrNull(getComputedStyle(p).color);
      } else {
        textHex = rgbStringToHexOrNull(st.color);
      }

      // heading colour – first h2/h3
      let headingHex: string | undefined;
      const h = el.querySelector('h2, h3');
      if (h) {
        headingHex = rgbStringToHexOrNull(getComputedStyle(h as HTMLElement).color);
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
        else if (d === 'flex') layoutKind = 'flex';
        else layoutKind = 'single';
      } else if (directBlocks.length > 1) {
        layoutKind = 'stack';
      }

      // role heuristic – hero if near top, contrast if dark bg, etc.
      let role: ContainerFingerprint['role'] = 'body';
      if (rect.top < window.innerHeight * 0.3) role = 'hero';
      if (bgHex) {
        const parsed = parseColorString(st.backgroundColor);
        if (parsed) {
          const lum = getLuminance(parsed);
          if (lum < 50) role = 'contrast';
        }
      }

      const wrapperClasses = Array.from(el.classList);

      const cleanedWrapper = wrapperClasses.filter(c => !ALIGN_RE.test(c));

      // --- Background area histogram ---
      const areaPx = rect.width * rect.height;
      const bgHistogram: Record<string, number> = {};
      if (bgHex) {
        bgHistogram[bgHex] = areaPx;
      }
      let dominantSurfaceHex: string | undefined = undefined;
      if (bgHex) dominantSurfaceHex = bgHex;

      const sampleHtml = el.outerHTML.substring(0, 250);

      const container: ContainerFingerprint = {
        id: `c${idCounter++}`,
        role,
        bgHex,
        textHex,
        headingHex,
        wrapperClasses: cleanedWrapper,
        layoutKind,
        sampleHtml,
        bgHistogram: Object.keys(bgHistogram).length ? bgHistogram : undefined,
        totalAreaPx: areaPx,
        dominantSurfaceHex,
      } as ContainerFingerprint & { _top?: number };
      (container as any)._top = rect.top;
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

  // --- ATOMS ---
  const atoms: AtomsFingerprint = {};

  // Buttons – pick first visually primary button (bg-* utility, or <button class=...>)
  const btn = document.querySelector('button, a[class*="btn"], .btn-primary') as HTMLElement | null;
  if (btn) {
    atoms.buttonPrimary = Array.from(btn.classList);
  }

  // Inputs – pick first input[type=text/email] etc.
  const inputEl = document.querySelector('input[type="text"], input[type="email"], textarea') as HTMLElement | null;
  if (inputEl) {
    const stIn = getComputedStyle(inputEl);
    const bgHex = rgbStringToHexOrNull(stIn.backgroundColor);
    const variantKey = (() => {
      if (!bgHex) return 'inputLight';
      const parsed = parseColorString(stIn.backgroundColor);
      if (!parsed) return 'inputLight';
      const lum = getLuminance(parsed);
      return lum < 128 ? 'inputDark' : 'inputLight';
    })();
    const parentWrapper = inputEl.parentElement;
    const wrapperClasses = parentWrapper ? Array.from(parentWrapper.classList) : [];
    const variant = {
      wrapper: wrapperClasses,
      input: Array.from(inputEl.classList),
      label: parentWrapper?.querySelector('label') ? Array.from(parentWrapper.querySelector('label')!.classList) : undefined,
    };
    atoms[variantKey] = variant;
  }

  // Tailwind token digest – union of class lists
  const tokenSet = new Set<string>();
  finalContainers.forEach(c => c.wrapperClasses.forEach(cls => tokenSet.add(cls)));
  if (atoms.buttonPrimary) atoms.buttonPrimary.forEach(cls => tokenSet.add(cls));
  Object.values(atoms).forEach(v => {
    if (typeof v === 'object' && v !== null) {
      if ((v as any).wrapper) ((v as any).wrapper as string[]).forEach(cls => tokenSet.add(cls));
      if ((v as any).input) ((v as any).input as string[]).forEach(cls => tokenSet.add(cls));
      if ((v as any).label) ((v as any).label as string[]).forEach(cls => tokenSet.add(cls));
    }
  });

  const tailwindTokens = Array.from(tokenSet).filter(t => t.startsWith('bg-') || t.startsWith('text-') || t.startsWith('px-') || t.startsWith('py-'));

  const fingerprint: PageFingerprint = {
    fingerprintVersion: 1,
    containers: finalContainers,
    atoms,
    tailwindTokens,
    ...deriveBranding(finalContainers),
    meta: {
      generatedAt: Date.now(),
    },
  };

  customLog('[PageFingerprint] collected', fingerprint);
  return fingerprint;
}

// TODO: Remove legacy SectionSample usage once backend fully migrates to pageFingerprint 

// ---- Branding helpers ----

function isDecorative(cls: string): boolean {
  return /(bg-|border-|shadow-)/.test(cls);
}

function deriveBranding(containers: ContainerFingerprint[]): {
  preferredContainer?: PreferredContainer;
  textStyles?: TextStyles;
  brandTokens?: BrandTokens;
} {
  if (containers.length === 0) return {};

  // Representative candidates: having bg-/border-/shadow-
  const reps = containers.filter(c => c.wrapperClasses.some(isDecorative));
  if (reps.length < 2) {
    // fallback pick first two if less
    while (reps.length < Math.min(2, containers.length)) reps.push(containers[reps.length]);
  }

  // Preferred container: most frequent wrapper signature among reps
  const sigCounts: Record<string, { count: number; cont: ContainerFingerprint }> = {};
  reps.forEach(c => {
    const sig = c.wrapperClasses.join(' ');
    sigCounts[sig] = sigCounts[sig] ? { count: sigCounts[sig].count + 1, cont: c } : { count: 1, cont: c };
  });
  const bestSig = Object.values(sigCounts).sort((a, b) => b.count - a.count)[0];
  let preferredContainer: PreferredContainer | undefined;
  if (bestSig) {
    const cls = bestSig.cont.wrapperClasses;
    // heuristic variant
    let variant: PreferredContainer['variant'] = 'none';
    if (cls.some(c => /shadow-/.test(c))) variant = 'card';
    else if (cls.some(c => /bg-/.test(c))) variant = 'section';
    else if (cls.some(c => /border-/.test(c))) variant = 'surface';

    preferredContainer = {
      variant,
      classes: cls,
      layoutKind: bestSig.cont.layoutKind as any,
    };
  }

  // textStyles – gather from sampleHtml of reps; simple heuristic: collect classes from <p>, <h2>, <a>
  const bodySet = new Set<string>();
  const headingSet = new Set<string>();
  const linkSet = new Set<string>();
  const COLOR_RE = /(text-|bg-|border-)/;
  reps.forEach(c => {
    const tmp = document.createElement('div');
    tmp.innerHTML = c.sampleHtml || '';
    const p = tmp.querySelector('p');
    if (p) Array.from(p.classList).forEach(cls => { if (!COLOR_RE.test(cls) && !ALIGN_RE.test(cls)) bodySet.add(cls); });
    const h = tmp.querySelector('h2, h3');
    if (h) Array.from(h.classList).forEach(cls => { if (!COLOR_RE.test(cls) && !ALIGN_RE.test(cls)) headingSet.add(cls); });
    const a = tmp.querySelector('a');
    if (a) Array.from(a.classList).forEach(cls => { if (!COLOR_RE.test(cls) && !ALIGN_RE.test(cls)) linkSet.add(cls); });
  });
  const textStyles: TextStyles = {
    body: Array.from(bodySet),
    heading: Array.from(headingSet),
    link: linkSet.size ? Array.from(linkSet) : undefined,
  };

  // brandTokens – colors, typography, shapes allow-lists
  const colors: string[] = [];
  const typography: string[] = [];
  const shapes: string[] = [];
  const COLOR_ALLOW = /^(bg-|text-|border-|ring-|from-|to-)/;
  const TYPO_ALLOW = /^(font-|text-[\dxl]|leading-|tracking-)/;
  const SHAPE_ALLOW = /^(rounded-|shadow-)/;
  reps.forEach(c => {
    c.wrapperClasses.forEach(cls => {
      if (COLOR_ALLOW.test(cls)) colors.push(cls);
      else if (TYPO_ALLOW.test(cls)) typography.push(cls);
      else if (SHAPE_ALLOW.test(cls)) shapes.push(cls);
    });
  });

  const brandTokens: BrandTokens = {
    colors: Array.from(new Set(colors)),
    typography: Array.from(new Set(typography)),
    shapes: Array.from(new Set(shapes.filter((v, _, arr) => arr.indexOf(v) !== arr.lastIndexOf(v)))), // only common (>1 occur)
  };

  return { preferredContainer, textStyles, brandTokens };
} 