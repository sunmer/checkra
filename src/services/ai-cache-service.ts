import { ErrorInfo, AIFixResponse } from '../types';

/**
 * A basic in-memory cache for AI-generated error fixes.
 * Uses error message as a key to avoid duplicate API calls for similar errors.
 */
export class AIFixCache {
  private static instance: AIFixCache;
  private cache: Map<string, AIFixResponse>;
  private maxCacheSize: number;

  /**
   * Private constructor for singleton pattern.
   */
  private constructor(maxCacheSize = 20) {
    this.cache = new Map();
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Get the singleton instance.
   */
  public static getInstance(): AIFixCache {
    if (!AIFixCache.instance) {
      AIFixCache.instance = new AIFixCache();
    }
    return AIFixCache.instance;
  }

  /**
   * Generate a unique cache key from error info.
   * We primarily use the error message as it's the most unique identifier.
   */
  private generateCacheKey(errorInfo: ErrorInfo): string {
    return `${errorInfo.message}-${errorInfo.fileName || ''}-${errorInfo.lineNumber || ''}`;
  }

  /**
   * Store a fix in the cache.
   */
  public cacheFix(errorInfo: ErrorInfo, fixData: AIFixResponse): void {
    // Implement LRU-like behavior - if cache is full, remove oldest entry
    if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if(oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    // Store the fix data
    const key = this.generateCacheKey(errorInfo);
    this.cache.set(key, fixData);
  }

  /**
   * Get a cached fix for the given error info, if it exists.
   */
  public getCachedFix(errorInfo: ErrorInfo): AIFixResponse | null {
    const key = this.generateCacheKey(errorInfo);
    return this.cache.has(key) ? this.cache.get(key) || null : null;
  }

  /**
   * Clear all cached items.
   */
  public clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the current size of the cache.
   */
  public size(): number {
    return this.cache.size;
  }
}