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
   * Whether to render the Checkra UI elements (button, viewer) in the DOM.
   * If set to false, the library will not add any UI elements.
   * @default true
   */
  isVisible?: boolean;
}