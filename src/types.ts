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
   * New, richer UI fingerprint describing page containers, atomic element
   * variants, and Tailwind utility digest. This will supersede `sectionSamples`
   * once migration is complete.
   */
  pageFingerprint?: PageFingerprint;
}

export interface GenerateSuggestionRequestbody {
  prompt: string;
  metadata: BackendPayloadMetadata;
  snippetLayout: SnippetLayout;
  aiSettings: AiSettings;
  insertionMode: 'replace' | 'insertBefore' | 'insertAfter';
}

export interface SnippetLayout {
  /** combined class list for the outer container element (max-width, centering, padding) */
  container: string | null;
  /** optional single wrapper div utilities between container and grid/content */
  wrapper: string | null;
  /** first descendant that establishes grid/flex layout */
  grid: string | null;
}

export interface AddRatingRequestBody extends Omit<GenerateSuggestionRequestbody, 'aiSettings'> {
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

// --- UI-Fingerprint (v1) ---

export interface ContainerFingerprint {
  id: string; // Stable within one fingerprint payload (e.g. "c1")
  /** Heuristic semantic role (hero, feature, body, contrast, …). May be "unknown" */
  role: 'hero' | 'feature' | 'body' | 'contrast' | 'unknown' | string;
  bgHex?: string;
  textHex?: string;
  headingHex?: string;
  /** Raw Tailwind (or other) classes applied to the section wrapper. */
  wrapperClasses: string[];
  /** Simplified layout descriptor. */
  layoutKind: 'stack' | 'grid' | 'feature' | 'single' | 'flex' | string;
  /** First 250 chars of outer HTML (debug-only). */
  sampleHtml?: string;
  /** Hex colour → pixel area (capped & cleaned in sampler) */
  bgHistogram?: Record<string, number>;
  /** Total pixel area of this element (width × height) */
  totalAreaPx?: number;
  /** Most dominant surface hex (≥40 % share if present) */
  dominantSurfaceHex?: string;
}

export interface AtomInputVariant {
  wrapper?: string[];
  input: string[];
  label?: string[];
}

export interface AtomsFingerprint {
  inputLight?: AtomInputVariant;
  inputDark?: AtomInputVariant;
  buttonPrimary?: string[];
  // Allow for arbitrary future keys
  [key: string]: any;
}

export interface PageFingerprint {
  fingerprintVersion: number;
  containers: ContainerFingerprint[];
  atoms: AtomsFingerprint;
  tailwindTokens?: string[];
  preferredContainer?: PreferredContainer;
  textStyles?: TextStyles;
  brandTokens?: BrandTokens;
  meta?: Record<string, any>;
}

// --- New enriched fingerprint sub-types ---
export interface PreferredContainer {
  variant: 'card' | 'surface' | 'section' | 'none';
  classes: string[];
  layoutKind: 'stack' | 'grid' | 'single';
}

export interface TextStyles {
  body: string[];
  heading: string[];
  link?: string[];
}

export interface BrandTokens {
  colors: string[];
  typography: string[];
  shapes: string[];
}
