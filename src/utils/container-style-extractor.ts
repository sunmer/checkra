import { parseColorString } from './color-utils';
import { CardStyle } from '../types';
import { customLog } from './logger';

export interface Lab {
  L: number;
  a: number;
  b: number;
}

// ------------------ Color Conversion ------------------
// Converts sRGB component (0..255) to linear RGB
function srgbToLinear(v: number): number {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

// Convert RGB to CIE XYZ (D65)
function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  r = srgbToLinear(r);
  g = srgbToLinear(g);
  b = srgbToLinear(b);
  const x = r * 0.4124 + g * 0.3576 + b * 0.1805;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = r * 0.0193 + g * 0.1192 + b * 0.9505;
  return [x, y, z];
}

function xyzToLab(x: number, y: number, z: number): Lab {
  // D65 reference white
  const refX = 0.95047;
  const refY = 1.0;
  const refZ = 1.08883;
  let fx = pivotXyz(x / refX);
  let fy = pivotXyz(y / refY);
  let fz = pivotXyz(z / refZ);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function pivotXyz(v: number): number {
  return v > 0.008856 ? Math.cbrt(v) : (7.787 * v) + 16 / 116;
}

export function rgbStringToLab(rgbString: string): [number, number, number] {
  const rgba = parseColorString(rgbString);
  if (!rgba) return [0, 0, 0];
  const [x, y, z] = rgbToXyz(rgba.r, rgba.g, rgba.b);
  const lab = xyzToLab(x, y, z);
  return [lab.L, lab.a, lab.b];
}

function deltaE(lab1: [number, number, number], lab2: [number, number, number]): number {
  const dL = lab1[0] - lab2[0];
  const dA = lab1[1] - lab2[1];
  const dB = lab1[2] - lab2[2];
  return Math.sqrt(dL * dL + dA * dA + dB * dB);
}

// Determine body background baseline once
const bodyBgLab: [number, number, number] = (() => {
  const bodyBg = getComputedStyle(document.body).backgroundColor || 'rgb(255,255,255)';
  return rgbStringToLab(bodyBg);
})();

function isCheckraElement(el: HTMLElement): boolean {
  if (el.id && el.id.startsWith('checkra')) return true;
  for (const cls of Array.from(el.classList)) {
    if (cls.startsWith('checkra')) return true;
  }
  // walk up few ancestors
  let parent: HTMLElement | null = el.parentElement;
  let depth = 0;
  while (parent && depth < 3) {
    if (parent.id && parent.id.startsWith('checkra')) return true;
    depth++;
    parent = parent.parentElement;
  }
  return false;
}

// ------------------ Candidate Collection ------------------

function collectCandidates(): HTMLElement[] {
  const vpArea = window.innerWidth * window.innerHeight;
  const allEls = Array.from(document.querySelectorAll('*')) as HTMLElement[];
  const results: HTMLElement[] = [];
  const limit = 1500;
  const badTags = new Set(['TABLE','TR','TD','TH','THEAD','TBODY','TFOOT']);
  for (let i = 0; i < allEls.length && results.length < limit; i++) {
    const el = allEls[i];
    if (badTags.has(el.tagName)) continue; // Skip table structure
    if (isCheckraElement(el)) continue; // Skip internal Checkra UI widgets
    const st = getComputedStyle(el);
    const bgColorStr = st.backgroundColor;
    const hasBg = bgColorStr && bgColorStr !== 'rgba(0, 0, 0, 0)' && bgColorStr !== 'transparent';

    // Treat as "edge" only if there's a visible box-shadow OR a non-zero border width
    const borderWidth = parseFloat(st.borderTopWidth || '0') +
                        parseFloat(st.borderRightWidth || '0') +
                        parseFloat(st.borderBottomWidth || '0') +
                        parseFloat(st.borderLeftWidth || '0');
    const hasEdge = st.boxShadow !== 'none' || borderWidth > 0;

    // Require some decorative trait (rounded corners or shadow) to avoid generic blocks
    const radiusPx = parseFloat(st.borderRadius || '0');
    const hasDecor = st.boxShadow !== 'none' || radiusPx >= 4;

    if ((!hasBg && !hasEdge) || !hasDecor) continue;

    // Compare background similarity to body to favour neutral cards over brand/primary buttons
    const bgLab = rgbStringToLab(bgColorStr);
    const diff = deltaE(bgLab, bodyBgLab);
    if (diff > 35) continue; // too different from page background (likely buttons / brand elements)

    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area < vpArea * 0.01 || area > vpArea * 0.20) continue;
    results.push(el);
    if (results.length <= 20) {
      customLog('[CardStyle] Candidate', results.length, {
        el,
        bg: st.backgroundColor,
        boxShadow: st.boxShadow,
        borderRadius: st.borderRadius,
        borderWidth,
        area
      });
    }
  }
  customLog(`[CardStyle] Total candidates after filtering: ${results.length}`);
  return results;
}

function vectorize(el: HTMLElement): number[] {
  const st = getComputedStyle(el);
  const [L, a, b] = rgbStringToLab(st.backgroundColor);
  const shadow = st.boxShadow === 'none' ? 0 : 1;
  const radius = parseFloat(st.borderRadius || '0') || 0;
  return [L, a, b, shadow, radius];
}

function euclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function meanVector(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const mean = new Array(dim).fill(0);
  vectors.forEach(vec => {
    for (let i = 0; i < dim; i++) {
      mean[i] += vec[i];
    }
  });
  for (let i = 0; i < dim; i++) {
    mean[i] /= vectors.length;
  }
  return mean;
}

interface ClusterRes { centroid: number[]; indexes: number[]; }

function kMeans(vectors: number[][], k = 3, maxIter = 8): ClusterRes[] {
  if (vectors.length === 0) return [];
  // Initial centroids: first k vectors (or duplicates if fewer)
  const centroids: number[][] = [];
  for (let i = 0; i < k; i++) {
    centroids.push(vectors[i % vectors.length].slice());
  }
  let assignments = new Array(vectors.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    // Assign
    for (let i = 0; i < vectors.length; i++) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const dist = euclidean(vectors[i], centroids[c]);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = c;
        }
      }
      assignments[i] = bestIdx;
    }
    // Recompute centroids
    let changed = false;
    for (let c = 0; c < k; c++) {
      const clusterVecs = vectors.filter((_, idx) => assignments[idx] === c);
      if (clusterVecs.length === 0) continue;
      const newCentroid = meanVector(clusterVecs);
      if (euclidean(newCentroid, centroids[c]) > 1e-3) {
        changed = true;
        centroids[c] = newCentroid;
      }
    }
    if (!changed) break;
  }
  const clusters: ClusterRes[] = centroids.map((centroid, idx) => ({ centroid, indexes: [] }));
  for (let i = 0; i < assignments.length; i++) {
    clusters[assignments[i]].indexes.push(i);
  }
  return clusters;
}


const SCHEME_KEY = () => {
  const scheme = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  return `${location.hostname}:cardStyle:${scheme}`;
};

export async function getCardStyle(): Promise<CardStyle | null> {
  const key = SCHEME_KEY();
  try {
    const cachedStr = localStorage.getItem(key);
    if (cachedStr) {
      return JSON.parse(cachedStr) as CardStyle;
    }
  } catch (_) {}

  const candidates = collectCandidates();
  if (candidates.length === 0) return null;
  const vectors = candidates.map(vectorize);
  const clusters = kMeans(vectors, 3);
  if (clusters.length === 0) return null;
  clusters.sort((a, b) => b.indexes.length - a.indexes.length);
  const top = clusters[0];
  if (top.indexes.length === 0) return null;
  
  const style = {
    variant: 'card' as const
  };

  customLog('[CardStyle] Cluster sizes', clusters.map(c => c.indexes.length));
  customLog('[CardStyle] Selected variant card');

  try {
    localStorage.setItem(key, JSON.stringify(style));
  } catch (_) {}
  return style;
} 