import { DetectedFramework } from "@/types";

const MAX_CLASSES_TO_SAMPLE_GLOBAL = 2000;
const MAX_CLASSES_TO_SAMPLE_SNIPPET = 500; // Analyze fewer classes for a snippet

// --- Signal Weights ---
const W_LINK_SCRIPT_URL = 0.4; // Reduced: Moderate signal for URL presence
const W_DATA_ATTR_BS = 0.5;    // Strong signal for Bootstrap data attributes
const W_CLASS_PATTERN_STRONG = 0.7; // Strong signal from distinctive class patterns
const W_CLASS_PATTERN_MODERATE = 0.4;
const W_VERSION_PARSED = 0.1;
const W_CSS_VARIABLES = 0.6; // Strong signal from CSS custom properties
const W_LOCAL_CSS_VARIABLES = 0.75; // Even stronger for element-local CSS vars
const W_ELEMENT_ATTRIBUTE_MATCH = 0.6; // For direct attribute checks on an element


// Enhanced runtime detection using CSS custom properties
function detectFrameworkFromCssVariables(element?: HTMLElement): { name: DetectedFramework['name']; confidence: number } {
    const targetElement = element || document.documentElement;
    const rootStyles = getComputedStyle(targetElement);
    let tailwindScore = 0;
    let bootstrapScore = 0;
    let muiScore = 0;

    // Tailwind CSS variables (v3+)
    const tailwindVars = [
        '--tw-ring-shadow', '--tw-shadow', '--tw-blur', '--tw-brightness',
        '--tw-contrast', '--tw-grayscale', '--tw-hue-rotate', '--tw-invert',
        '--tw-saturate', '--tw-sepia', '--tw-drop-shadow', '--tw-backdrop-blur'
    ];
    
    // Bootstrap CSS variables
    const bootstrapVars = [
        '--bs-blue', '--bs-indigo', '--bs-purple', '--bs-pink', '--bs-red',
        '--bs-orange', '--bs-yellow', '--bs-green', '--bs-teal', '--bs-cyan',
        '--bs-primary', '--bs-secondary', '--bs-success', '--bs-info', '--bs-warning',
        '--bs-danger', '--bs-light', '--bs-dark', '--bs-font-sans-serif'
    ];

    // MUI CSS variables (emotion-based)
    const muiVars = [
        '--mui-palette-primary-main', '--mui-palette-secondary-main',
        '--mui-palette-error-main', '--mui-palette-warning-main',
        '--mui-palette-info-main', '--mui-palette-success-main'
    ];

    tailwindVars.forEach(varName => {
        if (rootStyles.getPropertyValue(varName)) tailwindScore++;
    });

    bootstrapVars.forEach(varName => {
        if (rootStyles.getPropertyValue(varName)) bootstrapScore++;
    });

    muiVars.forEach(varName => {
        if (rootStyles.getPropertyValue(varName)) muiScore++;
    });

    const maxScore = Math.max(tailwindScore, bootstrapScore, muiScore);
    if (maxScore === 0) return { name: 'custom', confidence: 0 };

    let confidenceBoost = element ? W_LOCAL_CSS_VARIABLES : W_CSS_VARIABLES;

    if (tailwindScore === maxScore && tailwindScore >= 2) { // Lowered threshold for local checks
        return { name: 'tailwind', confidence: Math.min(0.85, (tailwindScore / Math.max(1,tailwindVars.length)) * confidenceBoost) };
    }
    if (bootstrapScore === maxScore && bootstrapScore >= 3) { // Lowered threshold for local checks
        return { name: 'bootstrap', confidence: Math.min(0.85, (bootstrapScore / Math.max(1,bootstrapVars.length)) * confidenceBoost) };
    }
    if (muiScore === maxScore && muiScore >= 1) { // Lowered threshold for local checks
        return { name: 'material-ui', confidence: Math.min(0.85, (muiScore / Math.max(1,muiVars.length)) * confidenceBoost) };
    }

    return { name: 'custom', confidence: 0 };
}

// Better utility class detection specific to Tailwind
function isTailwindUtility(className: string): boolean {
    // More precise Tailwind utility patterns
    const tailwindPatterns = [
        // Spacing: p-4, px-2, mt-auto, etc.
        /^[mp][xytrblse]?-(?:\d+(?:\.\d+)?|auto|px)$/,
        // Colors: text-red-500, bg-blue-50, border-gray-300
        /^(?:text|bg|border|ring|divide|placeholder|accent)-(?:[a-z]+-)?(?:50|100|200|300|400|500|600|700|800|900|950|current|transparent|inherit)$/,
        // Sizing: w-full, h-screen, max-w-lg, min-h-0
        /^(?:w|h|max-w|min-w|max-h|min-h)-(?:\d+(?:\.\d+)?\/\d+|\d+(?:\.\d+)?|auto|full|screen|min|max|fit)$/,
        // Flexbox: flex-1, justify-center, items-start
        /^(?:flex|justify|items|self|content)-(?:1|auto|start|end|center|between|around|evenly|stretch|baseline)$/,
        // Grid: grid-cols-12, col-span-2, gap-4
        /^(?:grid-cols|col-span|row-span|gap)-(?:\d+|auto|none)$/,
        // Typography: text-lg, font-bold, leading-tight
        /^(?:text|font|leading|tracking|whitespace)-(?:xs|sm|base|lg|xl|\d*xl|thin|light|normal|medium|semibold|bold|extrabold|black|tight|snug|normal|relaxed|loose)$/,
        // Display: block, hidden, inline-flex
        /^(?:block|inline|inline-block|flex|inline-flex|table|inline-table|table-caption|table-cell|table-column|table-column-group|table-footer-group|table-header-group|table-row-group|table-row|flow-root|grid|inline-grid|contents|list-item|hidden)$/,
        // Position: absolute, relative, top-0, left-1/2
        /^(?:static|fixed|absolute|relative|sticky|top|right|bottom|left|inset)-(?:\d+(?:\.\d+)?\/\d+|\d+(?:\.\d+)?|auto|full|px)$/,
        // Responsive/state prefixes
        /^(?:sm|md|lg|xl|2xl):/, /^(?:hover|focus|active|visited|disabled):/, /^(?:dark|light):/,
        // Arbitrary values
        /-\[.*\]$/
    ];

    return tailwindPatterns.some(pattern => pattern.test(className));
}

// Enhanced Bootstrap class detection
function isBootstrapClass(className: string): boolean {
    const bootstrapPatterns = [
        // Layout
        /^(?:container|container-fluid)$/,
        /^row$/,
        /^col(?:-(?:sm|md|lg|xl|xxl))?(?:-(?:[1-9]|1[0-2]|auto))?$/,
        /^offset-(?:sm|md|lg|xl|xxl)?-(?:[1-9]|1[0-1])$/,
        /^order-(?:sm|md|lg|xl|xxl)?-(?:[1-9]|1[0-2]|first|last)$/,
        
        // Components
        /^btn(?:-(?:primary|secondary|success|danger|warning|info|light|dark|link|outline-(?:primary|secondary|success|danger|warning|info|light|dark)))?(?:-(?:sm|lg))?$/,
        /^alert(?:-(?:primary|secondary|success|danger|warning|info|light|dark))?$/,
        /^badge(?:-(?:primary|secondary|success|danger|warning|info|light|dark))?$/,
        /^card(?:-(?:header|body|footer|title|subtitle|text|link|img|img-overlay))?$/,
        /^nav(?:-(?:link|item|pills|tabs|fill|justified))?$/,
        /^navbar(?:-(?:brand|nav|toggler|text|light|dark|expand|expand-sm|expand-md|expand-lg|expand-xl|expand-xxl))?$/,
        /^modal(?:-(?:dialog|content|header|title|body|footer|sm|lg|xl|static|centered))?$/,
        
        // Utilities
        /^[mp][xytrblse]?-[0-5]$/,
        /^g[xy]?-[0-5]$/,
        /^(?:d|display)-(?:none|inline|inline-block|block|table|table-cell|table-row|flex|inline-flex|grid)$/,
        /^(?:text|bg)-(?:primary|secondary|success|danger|warning|info|light|dark|white|muted)$/,
        /^border(?:-(?:primary|secondary|success|danger|warning|info|light|dark|white))?$/,
        /^rounded(?:-(?:top|end|bottom|start|circle|pill))?$/,
        /^shadow(?:-(?:sm|lg|none))?$/
    ];

    return bootstrapPatterns.some(pattern => pattern.test(className));
}

// Enhanced MUI detection
function detectMuiElements(element?: HTMLElement): number {
    let score = 0;
    const baseElement = element || document.body; // Fallback to document.body for global checks

    // Check for MUI class patterns on the element or its descendants
    const muiClassSelector = '[class*="Mui"], [class*="css-"], [class*="makeStyles"]';
    const elements = element ? (element.matches(muiClassSelector) ? [element] : Array.from(element.querySelectorAll(muiClassSelector))) : Array.from(document.querySelectorAll(muiClassSelector));
    score += Math.min(elements.length / (element ? 2 : 10), 5); // Cap at 5 points, higher sensitivity for local element

    // Check for emotion-based styles (MUI v5+) on the element or its descendants
    const emotionSelector = '[class*="css-"][class*="-"]'; // More specific to avoid general 'css-' classes if possible
    const emotionElements = element ? (element.matches(emotionSelector) ? [element] : Array.from(element.querySelectorAll(emotionSelector))) : Array.from(document.querySelectorAll(emotionSelector));
    score += Math.min(emotionElements.length / (element ? 5 : 20), 3); // Cap at 3 points, higher sensitivity for local

    // Check for common MUI component signatures on the element itself (if provided)
    if (element) {
        if (element.matches('div[role="button"], div[role="tab"], div[role="tabpanel"]')) {
            score += 1.5; // Direct match on selected element is a good sign
        }
        // Check for data-mui-internal or data-emotion attributes if they exist
        if (element.matches('[data-mui-internal], [data-emotion*="Mui"]')) {
            score += 2 * W_ELEMENT_ATTRIBUTE_MATCH;
        }
    } else {
        // Global check for component signatures (less targeted)
        const muiComponents = document.querySelectorAll('div[role="button"], div[role="tab"], div[role="tabpanel"]');
        score += Math.min(muiComponents.length / 5, 2);
    }
    
    return score;
}

function extractClassesFromHtml(htmlString: string, maxClasses: number): Set<string> {
    const classes = new Set<string>();
    if (!htmlString) return classes;
    const classRegex = /class="([^"]*)"/g;
    let match;
    let iterations = 0;
    const maxIterations = maxClasses * 10; // Adjusted iteration limit slightly

    while ((match = classRegex.exec(htmlString)) !== null && classes.size < maxClasses && iterations < maxIterations) {
        iterations++;
        const classGroup = match[1].split(/\s+/);
        classGroup.forEach(cls => {
            if (cls.trim() && classes.size < maxClasses) {
                classes.add(cls.trim());
            }
        });
    }
    return classes;
}

// More comprehensive Tailwind distinctive patterns
// 1. Responsive/State prefixes (sm:, md:, dark:, group-hover:, etc.)
// 2. Arbitrary values ( -[ ... ] )
// 3. Common utility colour / spacing / sizing tokens that **do not exist** in Bootstrap (e.g., text-gray-600, bg-blue-50, max-w-2xl)
// These additions improve recall for utility-dense snippets that might not use responsive prefixes.
const TAILWIND_DISTINCTIVE_REGEXES = [
    /^(sm|md|lg|xl|2xl):/,                       // responsive prefix
    /-\[/,                                      // arbitrary value syntax
    /^group(?:-hover)?:/,                        // group hover/focus etc.
    /^(dark|motion-safe|motion-reduce):/,        // dark mode / motion prefixes
    /^(text|bg|border|from|to|via)-(?:[a-z]+-)?(?:50|100|200|300|400|500|600|700|800|900|950)$/, // colour scales
    /^max-w-(?:xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|full)$/ // max-width scale
];
const BOOTSTRAP_DISTINCTIVE_CLASSES_REGEXES: RegExp[] = [
    /^(container|row|col(?:-(?:sm|md|lg|xl|xxl))?(?:-[1-9]|-[1-9][0-2])?)$/,
    /^btn(?:-(?:primary|secondary|success|danger|warning|info|light|dark|link|outline-[a-z]+))?$/,
    /^alert(?:-(?:primary|secondary|success|danger|warning|info|light|dark))?$/,
    /^nav(?:-link|-item)?$/,
    /^navbar(?:-brand|-nav|-text)?$/,
    /^card(?:-header|-body|-title|-text|-footer)?$/,
    /^modal(?:-dialog|-content|-header|-title|-body|-footer)?$/,
    /^form-control$/, /^form-select$/, /^form-check$/,
    /^g-[0-5]$/, /^gx-[0-5]$/, /^gy-[0-5]$/,
    /^p[xytrblse]?-[0-5]$/, /^m[xytrblse]?-[0-5]$/,
];
const MUI_DISTINCTIVE_REGEXES = [/^Mui[A-Z]/, /^css-[a-z0-9]+(?:-[a-zA-Z0-9]+)*$/]; // More specific MUI class pattern

function analyzeClassesForFramework(
    classesToAnalyze: Set<string>,
    selectedElement?: HTMLElement
): {
    name: DetectedFramework['name'];
    type: DetectedFramework['type'];
    confidence: number;
    utilityDensity: number;
} {
    let detectedName: DetectedFramework['name'] = 'custom';
    let confidence = 0.0;
    let frameworkType: DetectedFramework['type'] = 'unknown';
    let utilityDensity = 0;

    if (classesToAnalyze.size === 0) {
        return { name: 'custom', type: 'unknown', confidence: 0, utilityDensity };
    }

    let tailwindPoints = 0;
    let bootstrapPoints = 0;
    let muiPoints = 0;

    // Pre-compute utility density using more accurate detection
    let tailwindUtilityMatches = 0;
    let bootstrapUtilityMatches = 0;
    let totalUtilityMatches = 0;

    classesToAnalyze.forEach(cls => {
        // Framework-specific pattern matching
        if (TAILWIND_DISTINCTIVE_REGEXES.some(regex => regex.test(cls))) tailwindPoints += 2;
        if (BOOTSTRAP_DISTINCTIVE_CLASSES_REGEXES.some(regex => regex.test(cls))) bootstrapPoints += 1;
        if (MUI_DISTINCTIVE_REGEXES.some(regex => regex.test(cls))) muiPoints += 2;

        // More accurate utility detection
        if (isTailwindUtility(cls)) {
            tailwindUtilityMatches++;
            totalUtilityMatches++;
        } else if (isBootstrapClass(cls)) {
            bootstrapUtilityMatches++;
            totalUtilityMatches++;
        }
    });

    const totalClassesSampled = classesToAnalyze.size;
    utilityDensity = totalClassesSampled > 0 ? totalUtilityMatches / totalClassesSampled : 0;
    const tailwindUtilityDensity = totalClassesSampled > 0 ? tailwindUtilityMatches / totalClassesSampled : 0;

    // Add runtime MUI detection, localized if selectedElement is provided
    muiPoints += detectMuiElements(selectedElement);

    // Normalize points by number of regex categories to avoid bias if one framework has more regexes
    const normTailwind = tailwindPoints / (TAILWIND_DISTINCTIVE_REGEXES.length || 1);
    const normBootstrap = bootstrapPoints / (BOOTSTRAP_DISTINCTIVE_CLASSES_REGEXES.length || 1);
    const normMui = muiPoints / (MUI_DISTINCTIVE_REGEXES.length || 1);
    
    // Enhanced decision logic with utility density consideration
    if (tailwindUtilityDensity > 0.2 || (normTailwind > 0.05 && normTailwind > normBootstrap && normTailwind > normMui)) {
        detectedName = 'tailwind';
        frameworkType = 'utility-first';
        confidence = W_CLASS_PATTERN_STRONG * Math.min(1, (tailwindPoints / 5) + (tailwindUtilityDensity * 2));
    } else if (normBootstrap > 0.05 && normBootstrap > normTailwind && normBootstrap > normMui) {
        detectedName = 'bootstrap';
        frameworkType = 'component-based';
        confidence = W_CLASS_PATTERN_STRONG * Math.min(1, bootstrapPoints / 10);
    } else if (normMui > 0.05 && normMui > normTailwind && normMui > normBootstrap) {
        detectedName = 'material-ui';
        frameworkType = 'component-based';
        confidence = W_CLASS_PATTERN_STRONG * Math.min(1, muiPoints / 3);
    } else if (tailwindPoints > 0 && tailwindPoints >= bootstrapPoints && tailwindPoints >= muiPoints) {
        detectedName = 'tailwind';
        frameworkType = 'utility-first';
        confidence = W_CLASS_PATTERN_MODERATE * Math.min(1, tailwindPoints / 3);
    } else if (bootstrapPoints > 0 && bootstrapPoints >= tailwindPoints && bootstrapPoints >= muiPoints) {
        detectedName = 'bootstrap';
        frameworkType = 'component-based';
        confidence = W_CLASS_PATTERN_MODERATE * Math.min(1, bootstrapPoints / 5);

        // If Bootstrap evidence is weak but Tailwind utility density is high, re-classify
        if (bootstrapPoints <= 1 && tailwindUtilityDensity >= 0.15) {
            detectedName = 'tailwind';
            frameworkType = 'utility-first';
            confidence = W_CLASS_PATTERN_MODERATE * Math.min(1, tailwindUtilityDensity * 3);
        }
    }

    if (detectedName === 'tailwind') {
        // Boost tailwind confidence with utility density
        if (tailwindUtilityDensity > 0.05) confidence = Math.min(1.0, confidence + tailwindUtilityDensity * 0.3);
    }

    return { name: detectedName, type: frameworkType, confidence: Math.min(1.0, confidence), utilityDensity };
}

export function detectCssFramework(htmlSnippet?: string, selectedElement?: HTMLElement): DetectedFramework {
  let finalName: DetectedFramework['name'] = 'custom';
  let finalVersion: string = 'unknown';
  let finalConfidence = 0.0;
  let finalFrameworkType: DetectedFramework['type'] = 'unknown';
  let finalUtilityDensity = 0;

  // --- Stage 1: Element-Specific Analysis (if selectedElement is provided) ---
  let elementBasedName: DetectedFramework['name'] = 'custom';
  let elementBasedConfidence = 0;
  let elementBasedFrameworkType: DetectedFramework['type'] = 'unknown';

  if (selectedElement) {
      const elementCssVarResult = detectFrameworkFromCssVariables(selectedElement);
      if (elementCssVarResult.name !== 'custom' && elementCssVarResult.confidence > elementBasedConfidence) {
          elementBasedName = elementCssVarResult.name;
          elementBasedConfidence = elementCssVarResult.confidence; // Already incorporates W_LOCAL_CSS_VARIABLES
          elementBasedFrameworkType = elementCssVarResult.name === 'tailwind' ? 'utility-first' : 'component-based';
      }

      // Localized MUI element check (scores are additive within analyzeClassesForFramework)
      // The primary class analysis will use selectedElement.outerHTML if htmlSnippet isn't more specific.
      const elementHtml = htmlSnippet && htmlSnippet.includes(selectedElement.outerHTML) ? htmlSnippet : selectedElement.outerHTML;
      const elementClasses = extractClassesFromHtml(elementHtml, MAX_CLASSES_TO_SAMPLE_SNIPPET);
      const elementClassAnalysis = analyzeClassesForFramework(elementClasses, selectedElement);

      if (elementClassAnalysis.name !== 'custom' && elementClassAnalysis.confidence > elementBasedConfidence) {
          elementBasedName = elementClassAnalysis.name;
          elementBasedConfidence = elementClassAnalysis.confidence;
          elementBasedFrameworkType = elementClassAnalysis.type;
          finalUtilityDensity = elementClassAnalysis.utilityDensity; // Prioritize density from element
      } else if (elementClassAnalysis.name === elementBasedName) { // Agreement boosts confidence
          elementBasedConfidence = Math.min(1.0, elementBasedConfidence + elementClassAnalysis.confidence * 0.5);
          finalUtilityDensity = elementClassAnalysis.utilityDensity;
      }

      // If element-specific checks yield high confidence, prioritize this
      if (elementBasedName !== 'custom' && elementBasedConfidence >= 0.65) { // Increased threshold for strong local signal
          finalName = elementBasedName;
          finalConfidence = elementBasedConfidence;
          finalFrameworkType = elementBasedFrameworkType;
          // Version from URL if it matches, and URL analysis has run (it runs later if this path isn't taken)
          // This might be revisited if URL scan needs to be forced earlier for version info.
      }
  }

  // If Stage 1 gave a very strong signal, we can potentially return early or significantly down-weight globals.
  // For now, let global signals also run and combine, but element-based signals will have higher weight or priority in combination.
  
  // --- Stage 2: Global CSS Variables & URL/Data Attributes (Run if not already super confident from element) ---
  // These are run regardless, but their influence is determined in the combination stage.

  const globalCssVarResult = detectFrameworkFromCssVariables(); // Global check
  let globalCssVarConfidence = globalCssVarResult.confidence; // Already incorporates W_CSS_VARIABLES

  let urlConfidence = 0;
  let urlDetectedName: DetectedFramework['name'] = 'custom';
  let urlVersion = 'unknown';
  let urlFrameworkType: DetectedFramework['type'] = 'unknown';

  const linksAndScripts = Array.from(document.querySelectorAll('link[rel="stylesheet"], script[src]')) as (HTMLLinkElement | HTMLScriptElement)[];
  for (const el of linksAndScripts) {
    const url = (el.tagName === 'LINK' ? (el as HTMLLinkElement).href : (el as HTMLScriptElement).src) || '';
    if (!url) continue;

    let identifiedInUrl = false;
    if (/tailwind(?:css)?(?:\.min)?\.css/i.test(url) || /tailwindcss/i.test(url)) {
      if (urlDetectedName === 'custom' || urlConfidence < W_LINK_SCRIPT_URL) {
        urlDetectedName = 'tailwind';
        urlFrameworkType = 'utility-first';
        urlConfidence = W_LINK_SCRIPT_URL;
        identifiedInUrl = true;
      }
      const twVersionMatch = url.match(/@([0-9]+\.[0-9]+(?:\.[0-9]+)?)/);
      if (twVersionMatch?.[1]) {
        urlVersion = twVersionMatch[1];
        if(identifiedInUrl) urlConfidence = Math.min(1.0, urlConfidence + W_VERSION_PARSED);
      }
    } else if (url.match(/bootstrap(?:\.bundle|\.min)?\.(css|js)/i)) {
      if (urlDetectedName === 'custom' || urlConfidence < W_LINK_SCRIPT_URL) {
        urlDetectedName = 'bootstrap';
        urlFrameworkType = 'component-based';
        urlConfidence = W_LINK_SCRIPT_URL;
        urlVersion = 'unknown'; 
        identifiedInUrl = true;
      }
      const bsVersionMatch = url.match(/(?:bootstrap(?:@|\/)|\/bootstrap\.(?:css|js)\?v=|\/v)([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
      if (bsVersionMatch?.[1]) {
        urlVersion = bsVersionMatch[1];
        if(identifiedInUrl && urlDetectedName === 'bootstrap') urlConfidence = Math.min(1.0, urlConfidence + W_VERSION_PARSED);
      }
    } else if (/mui|material-ui/i.test(url)) {
        if (urlDetectedName === 'custom' || urlConfidence < W_LINK_SCRIPT_URL) {
            urlDetectedName = 'material-ui';
            urlFrameworkType = 'component-based';
            urlConfidence = W_LINK_SCRIPT_URL;
            urlVersion = 'unknown';
            identifiedInUrl = true;
        }
        const muiVersionMatch = url.match(/@([0-9]+\.[0-9]+(?:\.[0-9]+)?)/);
        if (muiVersionMatch?.[1]) {
            urlVersion = muiVersionMatch[1];
            if(identifiedInUrl && urlDetectedName === 'material-ui') urlConfidence = Math.min(1.0, urlConfidence + W_VERSION_PARSED);
        }
    }
    if (urlConfidence > 0.7 && (urlDetectedName === 'tailwind' || urlDetectedName === 'bootstrap')) break; // Break if high confidence from URL for major frameworks
  }

  let globalBsDataAttrConfidence = 0;
  if (document.querySelector('[data-bs-toggle]')) {
    globalBsDataAttrConfidence = W_DATA_ATTR_BS;
    if (urlDetectedName === 'custom' || (urlDetectedName === 'bootstrap' && urlConfidence < globalBsDataAttrConfidence)) {
        urlDetectedName = 'bootstrap';
        urlFrameworkType = 'component-based';
        urlConfidence = Math.max(urlConfidence, globalBsDataAttrConfidence);
    } else if (urlDetectedName === 'bootstrap') {
        urlConfidence = Math.min(1.0, urlConfidence + globalBsDataAttrConfidence * 0.5); // Boost if already BS
    }
  }

  // --- Stage 3: Class Analysis (Snippet or Global, if not focused on selectedElement already) ---
  let classAnalysisResult: ReturnType<typeof analyzeClassesForFramework>;

  if (finalName !== 'custom' && finalConfidence >= 0.65) {
      // Element-specific analysis was strong enough, classAnalysisResult might not be needed or is for density backup
      if (!finalUtilityDensity && selectedElement) { // Ensure density is captured
        const elementHtml = htmlSnippet && htmlSnippet.includes(selectedElement.outerHTML) ? htmlSnippet : selectedElement.outerHTML;
        const elementClasses = extractClassesFromHtml(elementHtml, MAX_CLASSES_TO_SAMPLE_SNIPPET);
        classAnalysisResult = analyzeClassesForFramework(elementClasses, selectedElement);
        finalUtilityDensity = classAnalysisResult.utilityDensity;
      } else if (!finalUtilityDensity && htmlSnippet) {
        const snippetClasses = extractClassesFromHtml(htmlSnippet, MAX_CLASSES_TO_SAMPLE_SNIPPET);
        classAnalysisResult = analyzeClassesForFramework(snippetClasses, undefined); // No specific element for snippet-only
        finalUtilityDensity = classAnalysisResult.utilityDensity;
      } else if (!finalUtilityDensity) {
        const globalClasses = extractClassesFromHtml(document.body.outerHTML, MAX_CLASSES_TO_SAMPLE_GLOBAL);
        classAnalysisResult = analyzeClassesForFramework(globalClasses, undefined); // Global, no element
        finalUtilityDensity = classAnalysisResult.utilityDensity;
      }
      // Assign a placeholder if not set, to avoid errors later if classAnalysisResult is used
      if (!classAnalysisResult!) classAnalysisResult = {name: 'custom', confidence: 0, type:'unknown', utilityDensity: finalUtilityDensity};
  } else if (htmlSnippet && !selectedElement) { // Snippet provided, no specific element focused (or element analysis was weak)
    const snippetClasses = extractClassesFromHtml(htmlSnippet, MAX_CLASSES_TO_SAMPLE_SNIPPET);
    classAnalysisResult = analyzeClassesForFramework(snippetClasses, undefined); // Pass undefined for selectedElement
    finalUtilityDensity = classAnalysisResult.utilityDensity;
  } else if (!selectedElement) { // No snippet, no element -> global class analysis
    const globalClasses = extractClassesFromHtml(document.body.outerHTML, MAX_CLASSES_TO_SAMPLE_GLOBAL);
    classAnalysisResult = analyzeClassesForFramework(globalClasses, undefined); // Pass undefined for selectedElement
    finalUtilityDensity = classAnalysisResult.utilityDensity;
  } else {
    // This case implies selectedElement was provided, but its analysis wasn't strong enough (finalName is still 'custom' or low conf)
    // We already performed elementClassAnalysis, so we can reuse its results.
    // However, the flow above should have already assigned it to classAnalysisResult if needed.
    // For safety, re-run for the element if classAnalysisResult is somehow not defined.
    const elementHtml = htmlSnippet && htmlSnippet.includes(selectedElement.outerHTML) ? htmlSnippet : selectedElement.outerHTML;
    const elementClasses = extractClassesFromHtml(elementHtml, MAX_CLASSES_TO_SAMPLE_SNIPPET);
    classAnalysisResult = analyzeClassesForFramework(elementClasses, selectedElement);
    finalUtilityDensity = classAnalysisResult.utilityDensity;
  }

  // --- Stage 4: Combine all signals with priority order ---
  // Priority: Element-Specific > Snippet-Specific > Global CSS Vars > URL/Data Attributes > Global Class Analysis

  // Current finalName, finalConfidence are from element-specific if it was strong.
  if (elementBasedName !== 'custom' && elementBasedConfidence > finalConfidence) {
      finalName = elementBasedName;
      finalConfidence = elementBasedConfidence;
      finalFrameworkType = elementBasedFrameworkType;
      // finalUtilityDensity already set if this path taken
  }

  // Consider classAnalysisResult (which could be from snippet, global, or re-analysis of element)
  if (classAnalysisResult.name !== 'custom' && classAnalysisResult.confidence > finalConfidence) {
      finalName = classAnalysisResult.name;
      finalConfidence = classAnalysisResult.confidence;
      finalFrameworkType = classAnalysisResult.type;
      finalUtilityDensity = classAnalysisResult.utilityDensity; // Ensure this is updated
  } else if (classAnalysisResult.name === finalName && classAnalysisResult.name !== 'custom') {
      finalConfidence = Math.min(1.0, finalConfidence + classAnalysisResult.confidence * 0.4); // Boost if class analysis agrees
      finalUtilityDensity = classAnalysisResult.utilityDensity; // Ensure this is updated
  }

  // Consider globalCssVarResult
  if (globalCssVarResult.name !== 'custom' && globalCssVarResult.confidence > finalConfidence) {
      finalName = globalCssVarResult.name;
      finalConfidence = globalCssVarResult.confidence;
      finalFrameworkType = globalCssVarResult.name === 'tailwind' ? 'utility-first' : 'component-based';
  } else if (globalCssVarResult.name === finalName && globalCssVarResult.name !== 'custom') {
      finalConfidence = Math.min(1.0, finalConfidence + globalCssVarResult.confidence * 0.3); // Boost
  }
  
  // Consider URL/Data Attributes
  const urlAndDataAttrDetectedName = urlDetectedName;
  const urlAndDataAttrConfidence = urlConfidence; // Already includes data-bs boost
  const urlAndDataAttrFrameworkType = urlFrameworkType;

  if (urlAndDataAttrDetectedName !== 'custom' && urlAndDataAttrConfidence > finalConfidence) {
      finalName = urlAndDataAttrDetectedName;
      finalConfidence = urlAndDataAttrConfidence;
      finalFrameworkType = urlAndDataAttrFrameworkType;
      finalVersion = urlVersion; // URL is the main source for version
  } else if (urlAndDataAttrDetectedName === finalName && urlAndDataAttrDetectedName !== 'custom') {
      finalConfidence = Math.min(1.0, finalConfidence + urlAndDataAttrConfidence * 0.25);
      if (finalVersion === 'unknown') finalVersion = urlVersion;
  }

  // If after all this, version is unknown, but a framework was detected, re-check against URL if names match.
  if (finalVersion === 'unknown' && finalName !== 'custom' && urlDetectedName === finalName) {
      finalVersion = urlVersion;
  }

  // Ensure utilityDensity is taken from the most relevant analysis
  if (finalUtilityDensity === 0 && classAnalysisResult && classAnalysisResult.utilityDensity > 0) {
    finalUtilityDensity = classAnalysisResult.utilityDensity;
  }

  // Apply minimum confidence threshold
  if (finalName !== 'custom' && finalConfidence < 0.1) {
    finalConfidence = 0.1; 
  }
  finalConfidence = Math.min(1.0, finalConfidence);

  return {
    name: finalName,
    version: finalVersion,
    confidence: parseFloat(finalConfidence.toFixed(2)),
    utilityDensity: parseFloat(finalUtilityDensity.toFixed(2)),
    type: finalFrameworkType,
  };
} 