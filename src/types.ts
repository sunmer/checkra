import type { CheckraAPI } from './core/index'; // type-only import to avoid runtime cycle

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
}

// --- Global Augmentation for window.Checkra --- 
declare global {
  interface Window {
    Checkra?: CheckraAPI; // Make it optional as it's loaded dynamically
  }
}