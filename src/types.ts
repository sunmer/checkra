/**
 * Configuration options for the logger.
 */
export interface LoggerOptions {
  /**
   * Whether to render the error log div in the DOM.
   * @default true
   */
  renderErrorLogDiv?: boolean;

  /**
   * Custom CSS styles for the expanded error log div.
   */
  style?: Partial<CSSStyleDeclaration>;

  /**
   * Whether to attach the logger instance to the window object as 'window.logger'.
   * @default true
   */
  attachToWindow?: boolean;

  /**
   * Maximum number of characters for error messages before truncation.
   * Hovering over truncated messages shows the full text.
   * @default 100
   */
  maxMessageLength?: number;

  /**
   * Whether the error log should be initially collapsed.
   * @default true
   */
  startCollapsed?: boolean;
}

/**
 * Interface representing the logger object.
 */
export interface Logger {
  readonly errorCount: number;
  readonly errors: string[];
  readonly sourceMap: Map<string, ErrorInfo>;
  showSource: (errorId: string) => void;
}

/**
 * Interface for error information storage.
 */
export interface ErrorInfo {
  message: string;
  stack?: string;
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  codeContext?: string;
}

/**
 * Interface for AI fix response structure.
 */
export interface AIFixResponse {
  issue?: string;
  fix?: string[] | any;
  originalSource?: string;
  codeExample?: string;
}