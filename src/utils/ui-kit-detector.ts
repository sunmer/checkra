import { UiKitDetection } from "../types";

/**
 * Signal weights for different detection methods
 */
const W_URL_SCRIPT = 0.6;
const W_CSS_VARIABLES = 0.7;
const W_CLASS_PATTERNS = 0.8;
const W_DATA_ATTRIBUTES = 0.9;
const W_GLOBAL_OBJECTS = 0.5;

/**
 * UI Kit Detection Patterns
 */
const UI_KIT_PATTERNS = {
  'material-ui': {
    cssVariables: [
      '--mui-palette-primary-main', '--mui-palette-secondary-main',
      '--mui-palette-error-main', '--mui-palette-warning-main',
      '--mui-palette-info-main', '--mui-palette-success-main'
    ],
    classPatterns: [
      /^Mui[A-Z][\w-]*/, // MUI component classes
      /^css-[a-z0-9]+(?:-[a-zA-Z0-9]+)*$/, // Emotion-based styles (MUI v5+)
      /^makeStyles-[\w-]+/, // MUI v4 styles
      /^jss[\d]+-[\w-]+/, // JSS styles
    ],
    dataAttributes: [
      /data-mui-[\w-]+/,
      /data-emotion[\w-]*/
    ],
    urlPatterns: [
      /@mui\/core/i,
      /@mui\/material/i,
      /@mui\/lab/i,
      /@mui\/icons/i,
      /material-ui/i
    ],
    globalObjects: ['MUI', 'MaterialUI']
  },
  'flowbite': {
    cssVariables: [],
    classPatterns: [
      /^flowbite/,
      /^fb-[\w-]+/
    ],
    dataAttributes: [
      /data-flowbite[\w-]*/,
      /data-popover-target/,
      /data-dropdown-toggle/,
      /data-modal-target/
    ],
    urlPatterns: [
      /flowbite/i
    ],
    globalObjects: ['Flowbite']
  },
  'preline': {
    cssVariables: [],
    classPatterns: [
      /^hs-[\w-]+/
    ],
    dataAttributes: [
      /data-hs-[\w-]+/
    ],
    urlPatterns: [
      /preline/i
    ],
    globalObjects: ['HSStaticMethods', 'HSDropdown', 'HSModal']
  },
  'ant-design': {
    cssVariables: [
      '--ant-primary-color',
      '--ant-success-color',
      '--ant-warning-color',
      '--ant-error-color'
    ],
    classPatterns: [
      /^ant-[\w-]+/
    ],
    dataAttributes: [],
    urlPatterns: [
      /antd/i,
      /ant-design/i
    ],
    globalObjects: ['antd']
  },
  'chakra-ui': {
    cssVariables: [
      '--chakra-colors-[\w-]+',
      '--chakra-space-[\w-]+',
      '--chakra-fontSizes-[\w-]+'
    ],
    classPatterns: [
      /^chakra-[\w-]+/,
      /^css-[\w-]+/ // Chakra uses emotion
    ],
    dataAttributes: [],
    urlPatterns: [
      /@chakra-ui/i
    ],
    globalObjects: ['ChakraProvider']
  },
  'mantine': {
    cssVariables: [
      '--mantine-color-[\w-]+',
      '--mantine-spacing-[\w-]+',
      '--mantine-radius-[\w-]+'
    ],
    classPatterns: [
      /^mantine-[\w-]+/,
      /^m_[\w-]+/ // Mantine CSS modules
    ],
    dataAttributes: [],
    urlPatterns: [
      /@mantine/i
    ],
    globalObjects: ['Mantine']
  },
  'headless-ui': {
    cssVariables: [],
    classPatterns: [],
    dataAttributes: [
      /data-headlessui-state/
    ],
    urlPatterns: [
      /@headlessui/i
    ],
    globalObjects: []
  },
  'react-bootstrap': {
    cssVariables: [],
    classPatterns: [
      /^react-bootstrap-[\w-]+/
    ],
    dataAttributes: [],
    urlPatterns: [
      /react-bootstrap/i
    ],
    globalObjects: ['ReactBootstrap']
  }
};

/**
 * Comprehensive UI kit detector that analyzes multiple signals
 */
export function detectUiKit(htmlStringOrContextElement?: string | HTMLElement): UiKitDetection {
  const detected: UiKitDetection = { 
    name: null, 
    confidence: null,
    version: undefined
  };

  let content = '';
  let contextElement: HTMLElement | Document = document;

  // Parse input and set context
  if (typeof htmlStringOrContextElement === 'string') {
    content = htmlStringOrContextElement.toLowerCase();
  } else if (htmlStringOrContextElement instanceof HTMLElement) {
    content = htmlStringOrContextElement.outerHTML.toLowerCase();
    contextElement = htmlStringOrContextElement;
  } else {
    content = document.body.outerHTML.toLowerCase();
  }

  let bestMatch: { name: UiKitDetection['name']; confidence: number; version?: string } = {
    name: null,
    confidence: 0
  };

  // Analyze each UI kit
  for (const [kitName, patterns] of Object.entries(UI_KIT_PATTERNS)) {
    let confidence = 0;
    let version: string | undefined;

    // 1. Check CSS Variables
    if (patterns.cssVariables.length > 0) {
      const element = contextElement instanceof HTMLElement ? contextElement : document.documentElement;
      const styles = getComputedStyle(element);
      let cssVarMatches = 0;

      patterns.cssVariables.forEach(varName => {
        if (styles.getPropertyValue(varName)) {
          cssVarMatches++;
        }
      });

      if (cssVarMatches > 0) {
        confidence += W_CSS_VARIABLES * (cssVarMatches / patterns.cssVariables.length);
      }
    }

    // 2. Check Class Patterns
    if (patterns.classPatterns.length > 0) {
      const classRegex = /class="([^"]*)"/g;
      let classMatches = 0;
      let totalClasses = 0;
      let match;

      while ((match = classRegex.exec(content)) !== null) {
        const classList = match[1].split(/\s+/);
        totalClasses += classList.length;

        classList.forEach(cls => {
          if (patterns.classPatterns.some(pattern => pattern.test(cls))) {
            classMatches++;
          }
        });
      }

      if (classMatches > 0 && totalClasses > 0) {
        confidence += W_CLASS_PATTERNS * Math.min(1, classMatches / Math.max(totalClasses * 0.1, 1));
      }
    }

    // 3. Check Data Attributes
    if (patterns.dataAttributes.length > 0) {
      let dataAttrMatches = 0;
      patterns.dataAttributes.forEach(pattern => {
        if (pattern.test(content)) {
          dataAttrMatches++;
        }
      });

      if (dataAttrMatches > 0) {
        confidence += W_DATA_ATTRIBUTES * (dataAttrMatches / patterns.dataAttributes.length);
      }
    }

    // 4. Check URL Patterns (script/link tags)
    if (patterns.urlPatterns.length > 0) {
      const links = Array.from(document.querySelectorAll('link[href], script[src]'));
      let urlMatches = 0;

      links.forEach(link => {
        const url = (link as HTMLLinkElement).href || (link as HTMLScriptElement).src || '';
        if (patterns.urlPatterns.some(pattern => pattern.test(url))) {
          urlMatches++;
          // Try to extract version from URL
          const versionMatch = url.match(/@([0-9]+\.[0-9]+(?:\.[0-9]+)?)/);
          if (versionMatch?.[1] && !version) {
            version = versionMatch[1];
          }
        }
      });

      if (urlMatches > 0) {
        confidence += W_URL_SCRIPT * Math.min(1, urlMatches / 2);
      }
    }

    // 5. Check Global Objects
    if (patterns.globalObjects.length > 0 && typeof window !== 'undefined') {
      let globalMatches = 0;
      patterns.globalObjects.forEach(objName => {
        if ((window as any)[objName]) {
          globalMatches++;
        }
      });

      if (globalMatches > 0) {
        confidence += W_GLOBAL_OBJECTS * (globalMatches / patterns.globalObjects.length);
      }
    }

    // Normalize confidence to 0-1 range
    confidence = Math.min(1, confidence);

    // Update best match if this is better
    if (confidence > bestMatch.confidence && confidence > 0.1) { // Minimum threshold
      bestMatch = {
        name: kitName as UiKitDetection['name'],
        confidence,
        version
      };
    }
  }

  // Return the best match
  if (bestMatch.name) {
    detected.name = bestMatch.name;
    detected.confidence = parseFloat(bestMatch.confidence.toFixed(2));
    detected.version = bestMatch.version;
  }

  return detected;
}