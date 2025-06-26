import { AtomEntry, AtomRole, ContainerFingerprint } from '../types';

const HTML_LIMIT = 2048; // 2 kB
const MAX_ATOMS  = 500;

function classifyElement(el: HTMLElement): AtomRole | null {
  // --- Interactive controls ---
  if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
    if (!el.textContent?.trim()) return 'buttonIcon';
    // Heuristic: coloured background -> primary, otherwise secondary
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && !/rgba?\(0, 0, 0, 0\)/.test(bg) && !/transparent/.test(bg)) {
      return 'buttonPrimary';
    }
    return 'buttonSecondary';
  }
  if (el.tagName === 'A' && el.hasAttribute('href')) {
    return el.closest('nav') ? 'navItem' : 'link';
  }

  // --- Inputs ---
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'text') return 'inputText';
  if (el.tagName === 'TEXTAREA') return 'textarea';
  if (el.tagName === 'SELECT') return 'select';

  // --- Typography ---
  if (/^H[1-6]$/.test(el.tagName)) return 'heading';
  if (['P','LI','SPAN'].includes(el.tagName)) return 'bodyText';

  // --- Decorative / identity ---
  if (el.classList.contains('badge')) return 'badge';
  if (el.tagName === 'IMG' && el.classList.contains('rounded-full')) return 'avatar';

  return null;
}

export function collectAtoms(containers: ContainerFingerprint[]): AtomEntry[] {
  const atoms: AtomEntry[] = [];
  const added = new Set<HTMLElement>();
  let idCounter = 1;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
  while (atoms.length < MAX_ATOMS && walker.nextNode()) {
    const el = walker.currentNode as HTMLElement;
    if (added.has(el)) continue;
    const role = classifyElement(el);
    if (!role) continue;

    // Find container id via __checkra_containerId flag we set earlier
    let containerId: string | undefined;
    let parent: HTMLElement | null = el;
    while (parent) {
      const cid = (parent as any).__checkra_containerId;
      if (cid) { containerId = cid; break; }
      parent = parent.parentElement;
    }
    if (!containerId) continue; // skip atoms outside primary containers

    const htmlStr = el.outerHTML.length > HTML_LIMIT ? el.outerHTML.slice(0, HTML_LIMIT) : el.outerHTML;

    atoms.push({
      id: `a${idCounter++}`,
      role,
      containerId,
      html: htmlStr,
    });
    added.add(el);
  }
  return atoms;
} 