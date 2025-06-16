import { CanonicalComponent } from '../types';
import { customLog } from './logger';
import { getCardStyle } from './container-style-extractor';

// Reuse candidate collection and clustering logic from container extractor via import
import { rgbStringToLab } from './container-style-extractor'; // just to ensure module loaded; candidates not exported.

// We'll reimplement simple candidate selection (duplicated) for isolation
function collectCandidates(): HTMLElement[] {
  const vpArea = window.innerWidth * window.innerHeight;
  const els = Array.from(document.querySelectorAll('*')) as HTMLElement[];
  const out: HTMLElement[] = [];
  for (const el of els) {
    const st = getComputedStyle(el);
    if (!(st.backgroundColor && st.backgroundColor !== 'rgba(0, 0, 0, 0)' && st.backgroundColor !== 'transparent')) continue;
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area < vpArea * 0.01 || area > vpArea * 0.4) continue;
    out.push(el);
    if (out.length > 3000) break;
  }
  return out;
}

function kMeans(vectors: number[][], k = 3, maxIter = 6): number[] {
  if (vectors.length === 0) return [];
  const centroids: number[][] = vectors.slice(0, k).map(v => v.slice());
  const assignment = new Array(vectors.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < vectors.length; i++) {
      let best = 0, bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = euclid(vectors[i], centroids[c]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      if (assignment[i] !== best) { assignment[i] = best; changed = true; }
    }
    if (!changed) break;
    for (let c = 0; c < k; c++) {
      const clusterVecs = vectors.filter((_, idx) => assignment[idx] === c);
      if (clusterVecs.length === 0) continue;
      centroids[c] = mean(clusterVecs);
    }
  }
  return assignment;
}

function euclid(a: number[], b: number[]): number { let s=0; for(let i=0;i<a.length;i++){const d=a[i]-b[i]; s+=d*d;} return Math.sqrt(s); }
function mean(vecs:number[][]): number[]{ const m=new Array(vecs[0].length).fill(0); vecs.forEach(v=>v.forEach((val,i)=>m[i]+=val)); return m.map(v=>v/vecs.length);} 

export function getCanonicalComponents(max = 3): CanonicalComponent[] {
  const cands = collectCandidates();
  const vecs = cands.map(el => { const st=getComputedStyle(el); return rgbStringToLab(st.backgroundColor); });
  const assign = kMeans(vecs, Math.min(max,3));
  const clusters: {idx:number, size:number}[] = [];
  const clusterCounts: Record<number, number[]> = {};
  assign.forEach((c,i)=>{ if(!clusterCounts[c]) clusterCounts[c]=[]; clusterCounts[c].push(i); });
  Object.entries(clusterCounts).forEach(([k,arr])=>clusters.push({idx:+k,size:arr.length}));
  clusters.sort((a,b)=>b.size-a.size);
  const result: CanonicalComponent[] = [];
  clusters.slice(0,max).forEach((cl,rank)=>{
    const indices=clusterCounts[cl.idx];
    const median=indices[Math.floor(indices.length/2)];
    const el=cands[median];
    if(!el) return;
    const role: CanonicalComponent['role'] = rank===0?'card':rank===1?'feature':'other';
    const html = el.outerHTML.slice(0,800);
    result.push({role, html});
  });
  customLog('[CanonicalComponents] extracted', result);
  return result;
} 