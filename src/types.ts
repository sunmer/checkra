import type { CheckraAPI } from './core/index'; // type-only import to avoid runtime cycle
import { DetectedFramework } from './utils/framework-detector';
import { UiKitDetection } from './utils/ui-kit-detector';

/**
 * Configuration options for the Checkra feedback module.
 */
export interface CheckraOptions {
  /**
   * An optional API key for authenticated requests.
   * If provided, it will be sent as a Bearer token.
   * If omitted, an anonymous persistent UUID will be generated/used via localStorage
   * for rate-limiting purposes.
   * @default undefined (triggers anonymous UUID logic)
   */
  apiKey?: string;

  /**
   * Whether to render and show the Checkra UI elements (button, viewer) in the DOM upon initialization.
   * If set to false, the UI will be initialized but hidden. It can be shown later using the API.
   * Can be configured via script tag `data-checkra-config='{"isVisible": true}'`.
   * @default false (handled in initialization logic)
   */
  isVisible?: boolean;

  /**
   * Whether to enable the fix rating feature for end users.
   * If true, a rating button will appear on applied fixes.
   * @default false
   */
  enableRating?: boolean;
}

// --- Global Augmentation for window.Checkra --- 
declare global {
  interface Window {
    Checkra?: CheckraAPI; // Make it optional as it's loaded dynamically
  }
}

/**
 * Interface for AI model settings.
 */
export interface AiSettings {
  model: string;
  temperature: number;
}

// --- Updated and New Interfaces ---
export interface PageMetadataBrand {
  primary?: string | null;
  accent?: string | null;
  palette?: string[];
}

export interface PageMetadata {
  title: string | null;
  description: string | null;
  ogTitle: string | null;
  url: string;
  language: string | null;
  h1: string | null;
  viewport: {
    width: number;
    height: number;
  };
  brand?: PageMetadataBrand;
}

export interface BackendPayloadMetadata extends PageMetadata {
  cssDigests?: any; // Consider defining a more specific type for cssDigests if possible
  frameworkDetection?: DetectedFramework;
  uiKitDetection?: UiKitDetection;
}

export interface GenerateSuggestionRequestbody {
  prompt: string;
  html?: string | null;
  htmlCharCount?: number;
  metadata: BackendPayloadMetadata;
  aiSettings: AiSettings;
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter';
}

export interface AddRatingRequestBody extends GenerateSuggestionRequestbody {
  rating: 1 | 2 | 3 | 4;
}
// --- End Updated and New Interfaces ---