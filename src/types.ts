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
  inferred?: BrandInferred;
  resolvedPrimaryColorInfo?: ColorResolutionDetails;
  resolvedAccentColorInfo?: ColorResolutionDetails;
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
  perfHints?: PerfHints;
  leverValues?: LeverValues;
  computedBackgroundColor?: string;

  /**
   * Dominant card / container style extracted from the page. Can be used by backend
   * to re-skin generated HTML so that it visually matches the host site.
   */
  containerStyle?: CardStyle;

  /** Site-wide typography style hints */
  typographyStyle?: TypographyStyle;
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
  rating: number; // e.g., 1-5
  fixId: string;
  generationId?: string;
  reason?: string; // Optional textual feedback
  originalHtml?: string;
  feedback?: string;
  generatedHtml?: string;
  tags?: string[];
  resolvedPrimaryColorInfo?: ColorResolutionDetails;
  resolvedAccentColorInfo?: ColorResolutionDetails;
  /** Optional screenshot of rendered HTML in base64 (JPEG or PNG) */
  imageData?: {
    mime: string; // e.g., 'image/jpeg'
    data: string; // base64 string WITHOUT the data URI prefix for compactness
    width: number;
    height: number;
  };
}

// --- New Shared Interfaces ---
export interface BrandInferred {
  primary: string;
  accent: string;
  source: 'class' | 'var' | 'computed' | 'screenshot';
  contrastRatio: number;
  wasLightnessTweaked: boolean;
}

export interface PerfHints {
  branch: 'A' | 'B' | 'C' | 'D';
  ms: number;
  canvasMs?: number;
}

export interface LeverValues {
  spacingStep?: string;
  depthPreset?: string;
  motionPreset?: string;
}
// --- End Updated and New Interfaces ---

export interface UiKitDetection {
  name: 'material-ui' | 'flowbite' | 'preline' | 'ant-design' | 'chakra-ui' | 'mantine' | 'headless-ui' | 'react-bootstrap' | null;
  confidence: number | null;
  version?: string;
}

export interface DetectedFramework {
  name: 'tailwind' | 'bootstrap' | 'custom';
  version: string | 'unknown';
  confidence: number; // 0 (no confidence) -> 1 (high confidence)
  utilityDensity: number;
  type: 'utility-first' | 'component-based' | 'unknown';
}

// --- ADDED: New Types for Color Resolution Event ---
export type ColorSource = 
  'input' 
  | 'palette-primary' 
  | 'palette-accent' 
  | 'fallback-white' 
  | 'fallback-black' 
  | 'adjusted-contrast' 
  | 'utility-class' 
  | 'css-variable';

export interface ColorResolutionDetails {
  originalColor?: string;
  resolvedColor: string;
  source: ColorSource;
  contrastAchieved?: number;
  wasAdjusted?: boolean;
  reason?: string;
}

export interface ResolvedColorInfo {
  primary?: ColorResolutionDetails;
  accent?: ColorResolutionDetails;
  // Potentially other color types if backend expands, e.g., resolvedTextColorInfo
}
// --- END: New Types for Color Resolution Event ---

// --- Gradient Descriptor for new gradient SSE event ---
export interface GradientDescriptor {
  kind: 'oklab' | 'lab' | 'hsl';
  from: string; // e.g. '#2563eb'
  to: string;   // e.g. '#ef4444'
  angle: number; // degrees, e.g. 45
}

// --- New: Card / Container Style ---
export interface CardStyle {
  backgroundColor?: string;
  border?: string;
  borderRadius?: string;
  boxShadow?: string;
  padding?: string;
  margin?: string;
  classes?: string[];
  /** optional layout / width / centering utilities from wrapper */
  layoutClasses?: string[];
}

// --- Typography extraction ---
export interface TypographyStyle {
  /** Dominant body text classes (colour, weight, size) */
  bodyClasses: string[];
  /** Dominant heading classes (usually h1–h3) */
  headingClasses: string[];
  /** Optional link colour/decoration classes */
  linkClasses?: string[];
  /** Optional mapping of scale utilities */
  scale?: { [tag: string]: string };
}
