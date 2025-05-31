/*
 * Utility functions for extracting design tokens (colour, spacing, depth, motion) from DOM elements or HTML strings.
 * The pipeline follows stages:
 *  A. Utility-class regex (fast, zero-cost)
 *  B. CSS custom properties (--bs-primary, --brand-*)
 *  C. Cascaded computed styles (colour/background-colour)
 *  D. Screenshot fallback delegated to existing extractColorsFromElement() in ai-service
 */

export interface InferredColours {
  primary: string;
  accent: string;
  source: 'class' | 'var' | 'computed' | 'screenshot';
  contrastRatio: number;
  wasLightnessTweaked: boolean;
}

export interface PerfHints {
  branch: 'A' | 'B' | 'C' | 'D';
  ms: number;
  canvasMs?: number;
}

export interface LeverValues {
  spacingStep?: string;  // e.g., space-y-6 or gap-4
  depthPreset?: string;  // e.g., shadow-lg
  motionPreset?: string; // e.g., duration-300
}

/* --------------------------------------------------
 *  Helper – WCAG contrast calculator (approx.)
 * --------------------------------------------------*/
function luminance(rgb: string): number {
  // rgb(r, g, b) extractor – fall back to 0s
  const m = rgb.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return 0;
  const rsrgb = [+m[1], +m[2], +m[3]].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rsrgb[0] + 0.7152 * rsrgb[1] + 0.0722 * rsrgb[2];
}

export function contrastRatio(rgb1: string, rgb2: string): number {
  const L1 = luminance(rgb1) + 0.05;
  const L2 = luminance(rgb2) + 0.05;
  return L1 > L2 ? L1 / L2 : L2 / L1;
}

// Simple HSL tweak to bump contrast
function adjustLightness(rgb: string, makeDarker: boolean): string {
  // convert crudely via Canvas.
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return rgb;
  ctx.fillStyle = rgb;
  const computed = ctx.fillStyle as string; // now in rgb()
  const m = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return rgb;
  let [r, g, b] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  const factor = makeDarker ? 0.85 : 1.15;
  r = Math.max(0, Math.min(255, Math.round(r * factor)));
  g = Math.max(0, Math.min(255, Math.round(g * factor)));
  b = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `rgb(${r},${g},${b})`;
}

/* --------------------------------------------------
 *  Stage A – utility-class parsing on HTML string
 * --------------------------------------------------*/
const COLOR_UTILITY_REGEX = /(bg|text|from|to|border|stroke|fill)-([a-zA-Z0-9\[\]%-]+)/;
const SPACING_REGEX = /(gap|space-[xy]|p[trblxy]?|m[trblxy]?)-([0-9]+)/;
const DEPTH_REGEX = /(shadow)-([a-z]+)/;
const MOTION_REGEX = /(duration|ease|transition)-([a-z0-9]+)/;

function tokensFromClassList(classList: string[]): { colours?: InferredColours; lever?: LeverValues } {
  const lever: LeverValues = {};
  let primary: string | undefined;
  let accent: string | undefined;
  classList.forEach(cls => {
    if (!primary && COLOR_UTILITY_REGEX.test(cls) && cls.startsWith('text-')) {
      primary = cls;
    }
    if (!accent && COLOR_UTILITY_REGEX.test(cls) && cls.startsWith('bg-')) {
      accent = cls;
    }
    if (!lever.spacingStep && SPACING_REGEX.test(cls)) lever.spacingStep = cls;
    if (!lever.depthPreset && DEPTH_REGEX.test(cls)) lever.depthPreset = cls;
    if (!lever.motionPreset && MOTION_REGEX.test(cls)) lever.motionPreset = cls;
  });

  if (primary || accent) {
    const col: InferredColours = {
      primary: primary || accent || '#000',
      accent: accent || primary || '#fff',
      source: 'class',
      contrastRatio: 0,
      wasLightnessTweaked: false,
    };
    return { colours: col, lever };
  }
  return { lever };
}

export function extractTokensViaUtility(html: string): { colours?: InferredColours; lever?: LeverValues } {
  const matches = html.match(/class="([^"]*)"/g);
  if (!matches) return {};
  const classTokens: string[] = [];
  matches.forEach(m => {
    const inner = m.slice(7, -1); // remove class=" and ending "
    inner.split(/\s+/).forEach(c => c && classTokens.push(c));
  });
  return tokensFromClassList(classTokens);
}

/* --------------------------------------------------
 * Stage B – CSS custom properties
 * --------------------------------------------------*/
export function extractTokensFromCustomProps(el: HTMLElement): InferredColours | null {
  const styles = getComputedStyle(el);
  const primary = styles.getPropertyValue('--bs-primary').trim() || styles.getPropertyValue('--primary').trim();
  const accent = styles.getPropertyValue('--bs-secondary').trim() || styles.getPropertyValue('--accent').trim();
  if (primary || accent) {
    const ratio = primary && accent ? contrastRatio(primary, accent) : 0;
    return {
      primary: primary || accent,
      accent: accent || primary,
      source: 'var',
      contrastRatio: ratio,
      wasLightnessTweaked: false,
    } as InferredColours;
  }
  return null;
}

/* --------------------------------------------------
 * Stage C – Cascaded computed styles
 * --------------------------------------------------*/
export function bubbleComputedColors(el: HTMLElement): InferredColours | null {
  let node: HTMLElement | null = el;
  while (node) {
    const styles = getComputedStyle(node);
    const color = styles.color;
    const bg = styles.backgroundColor;
    if (color && bg && bg !== 'rgba(0, 0, 0, 0)') {
      const ratio = contrastRatio(color, bg);
      return {
        primary: color,
        accent: bg,
        source: 'computed',
        contrastRatio: ratio,
        wasLightnessTweaked: false,
      };
    }
    node = node.parentElement;
  }
  return null;
}

/* --------------------------------------------------
 * Contrast guard
 * --------------------------------------------------*/
export function ensureContrast(info: InferredColours): InferredColours {
  const ratio = contrastRatio(info.primary, info.accent);
  if (ratio >= 4.5) return { ...info, contrastRatio: ratio };

  const darkerPrimary = adjustLightness(info.primary, true);
  const newRatio = contrastRatio(darkerPrimary, info.accent);
  return {
    ...info,
    primary: darkerPrimary,
    contrastRatio: newRatio,
    wasLightnessTweaked: true,
  };
}

/* --------------------------------------------------
 * Orchestrator
 * --------------------------------------------------*/
import { DetectedFramework } from './framework-detector';

export async function resolveBrandColors(el: HTMLElement, framework: DetectedFramework, htmlContext?: string, screenshotFallback?: (el: HTMLElement) => Promise<{ primary?: string; accent?: string } | null>): Promise<{ colours: InferredColours | null; lever?: LeverValues; perf: PerfHints }> {
  const start = performance.now();

  // Stage selector
  let branch: PerfHints['branch'] = 'C';
  let colours: InferredColours | null = null;
  let lever: LeverValues | undefined = undefined;

  // A
  if (framework.utilityDensity >= 0.3 && htmlContext) {
    const res = extractTokensViaUtility(htmlContext);
    if (res.colours) {
      colours = res.colours;
      branch = 'A';
    }
    lever = res.lever;
  }

  // B
  if (!colours) {
    const vars = extractTokensFromCustomProps(el);
    if (vars) {
      colours = vars;
      branch = 'B';
    }
  }

  // C
  if (!colours) {
    const comp = bubbleComputedColors(el);
    if (comp) {
      colours = comp;
      branch = 'C';
    }
  }

  // D
  if (!colours && screenshotFallback) {
    const scStart = performance.now();
    const sc = await screenshotFallback(el);
    const scMs = performance.now() - scStart;
    if (sc && sc.primary && sc.accent) {
      colours = {
        primary: sc.primary,
        accent: sc.accent,
        source: 'screenshot',
        contrastRatio: contrastRatio(sc.primary, sc.accent),
        wasLightnessTweaked: false,
      };
      branch = 'D';
      return { colours, lever, perf: { branch, ms: performance.now() - start, canvasMs: scMs } };
    }
  }

  if (colours) {
    colours = ensureContrast(colours);
  }

  return { colours, lever, perf: { branch, ms: performance.now() - start } };
} 