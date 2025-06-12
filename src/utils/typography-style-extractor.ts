import { TypographyStyle } from '../types';
import { customLog } from './logger';

// --- Whitelist patterns ---
const TAILWIND_SIZE_RE = /^text-(?:xs|sm|base|lg|xl|[1-9]xl)$/; // text-sm, text-2xl etc.
const TAILWIND_COLOR_RE = /^text-[a-z]+-\d{2,3}$/;              // text-gray-600
const BOOTSTRAP_COLOR_RE = /^text-(?:primary|secondary|success|danger|warning|info|light|dark|body|muted|black-50|white-50)$/;

const TEXT_CLASS_RE = new RegExp(`${TAILWIND_SIZE_RE.source}|${TAILWIND_COLOR_RE.source}|${BOOTSTRAP_COLOR_RE.source}`);

const FONT_TW_RE = /^font-(?:light|normal|medium|semibold|bold|extrabold|black)$/;
const FONT_BS_RE  = /^fw-(?:light|normal|bold|semibold|bolder)$/;
const FONT_WEIGHT_RE = new RegExp(`${FONT_TW_RE.source}|${FONT_BS_RE.source}`);

function tally(classes: string[], map: Record<string, number>) {
  classes.forEach(cls => {
    map[cls] = (map[cls] || 0) + 1;
  });
}

export function getTypographyStyle(root: HTMLElement = document.body): TypographyStyle | null {
  const textCounts: Record<string, number> = {};
  const weightCounts: Record<string, number> = {};

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;
  let elementsChecked = 0;
  while (node && elementsChecked < 3000) {
    const el = node as HTMLElement;
    if (el.classList) {
      const textClasses = Array.from(el.classList).filter(c => TEXT_CLASS_RE.test(c));
      const weightClasses = Array.from(el.classList).filter(c => FONT_WEIGHT_RE.test(c));
      if (textClasses.length) tally(textClasses, textCounts);
      if (weightClasses.length) tally(weightClasses, weightCounts);
    }
    node = walker.nextNode();
    elementsChecked++;
  }

  const pickTop = (map: Record<string, number>): string[] => {
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, 2).map(([k]) => k);
  };

  const bodyClasses = pickTop(textCounts);
  if (bodyClasses.length === 0) return null;

  // heading class: take first h1/h2 element
  let headingEl = document.querySelector('h1, h2');
  const headingClasses: string[] = [];
  if (headingEl) {
    headingClasses.push(...Array.from(headingEl.classList).filter(c => TEXT_CLASS_RE.test(c) || FONT_WEIGHT_RE.test(c)));
  }

  const style: TypographyStyle = {
    bodyClasses,
    headingClasses: headingClasses.length ? headingClasses : pickTop(weightCounts),
  };

  customLog('[TypographyStyle] extracted', style);
  return style;
} 