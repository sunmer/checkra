/**
 * Configuration options for the Checkra feedback module.
 */
export interface CheckraOptions {
  /**
   * Whether to render the Checkra UI elements (button, viewer) in the DOM.
   * If set to false, the library will not add any UI elements.
   * @default true
   */
  isVisible?: boolean;

  /**
   * Custom CSS styles for UI elements (if needed in the future).
   * Currently unused by the simplified feedback module.
   */
  style?: Partial<CSSStyleDeclaration>;
}