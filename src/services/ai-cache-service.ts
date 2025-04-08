import { ErrorInfo, AIFixResponse } from '../types';

/**
 * Service for caching AI-generated fixes.
 */
export class AIFixCache {
  private static instance: AIFixCache;
  private cache: Map<string, AIFixResponse> = new Map();

  /**
   * Private constructor for singleton pattern.
   */
  private constructor() {}

  /**
   * Gets the singleton instance of the cache.
   */
  public static getInstance(): AIFixCache {
    if (!AIFixCache.instance) {
      AIFixCache.instance = new AIFixCache();
    }
    return AIFixCache.instance;
  }

  /**
   * Generates a cache key for an error.
   * Uses the error's content rather than a unique ID to deduplicate
   * identical errors that may appear multiple times.
   */
  private generateCacheKey(errorInfo: ErrorInfo): string {
    // Create a composite key from the error's details
    const errorDetails = [
      errorInfo.message,
      errorInfo.fileName || '',
      errorInfo.lineNumber || '',
      errorInfo.columnNumber || '',
      errorInfo.codeContext || ''
    ].join('|');
    
    return errorDetails;
  }

  /**
   * Gets a cached fix if it exists.
   */
  public getCachedFix(errorInfo: ErrorInfo): AIFixResponse | undefined {
    const key = this.generateCacheKey(errorInfo);
    return this.cache.get(key);
  }

  /**
   * Stores a fix in the cache.
   */
  public cacheFix(errorInfo: ErrorInfo, fixResponse: AIFixResponse): void {
    const key = this.generateCacheKey(errorInfo);
    this.cache.set(key, fixResponse);
  }

  /**
   * Checks if a fix is cached for the given error.
   */
  public hasCachedFix(errorInfo: ErrorInfo): boolean {
    const key = this.generateCacheKey(errorInfo);
    return this.cache.has(key);
  }

  /**
   * Clears the entire cache.
   */
  public clearCache(): void {
    this.cache.clear();
  }
}