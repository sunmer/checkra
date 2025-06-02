import type { GenerateSuggestionRequestbody, ResolvedColorInfo } from '../types';

// TODO: Consider moving AppliedFixInfo to a central types file (e.g., src/types.ts)
// For now, co-locating it here for the initial refactor step.
export interface AppliedFixInfo {
  originalElementId: string;
  originalOuterHTML: string;
  fixedOuterHTML: string;
  markerStartNode: Comment | null;
  markerEndNode: Comment | null;
  actualAppliedElement: HTMLElement | null;
  isCurrentlyFixed: boolean;
  stableTargetSelector: string;
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter';
  requestBody: GenerateSuggestionRequestbody;
  isRated?: boolean;
  resolvedColors?: ResolvedColorInfo;
}

export class AppliedFixStore {
  private appliedFixes: Map<string, AppliedFixInfo> = new Map();

  public add(fixId: string, fixInfo: AppliedFixInfo): void {
    this.appliedFixes.set(fixId, fixInfo);
  }

  public get(fixId: string): AppliedFixInfo | undefined {
    return this.appliedFixes.get(fixId);
  }

  public delete(fixId: string): boolean {
    return this.appliedFixes.delete(fixId);
  }

  public getAll(): Map<string, AppliedFixInfo> {
    return this.appliedFixes;
  }

  public getValues(): IterableIterator<AppliedFixInfo> {
    return this.appliedFixes.values();
  }

  public getSize(): number {
    return this.appliedFixes.size;
  }

  public has(fixId: string): boolean {
    return this.appliedFixes.has(fixId);
  }

  public clear(): void {
    this.appliedFixes.clear();
  }
} 