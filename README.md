# Checkra, a js library for getting inline feedback for your website

Inspect any part of your website and get helpful recommendations, all previewed inline. Checkra aims to make it easier for technical and non-technical people to collaborate on improving websites.

 ## Features

- ✨ **Suggestions**: Get AI-powered improvement ideas for UI, UX, and content
- 💬 **Conversion tips**: Get conversion tips on any part of your website
- ⚙️ **Simple Integration**: Add Checkra to your site with a single script tag or npm install.
- 🎨 **Minimal UI**: Floating button and modal interface stay out of the way until needed.

## Installation

### Easy Installation Using a CDN

Add the following lines inside the `<head>` section of your HTML file:

```html
<!-- Inside the <head> section -->
<link rel="stylesheet" href="https://unpkg.com/checkra@latest/dist/style.css">
<script src="https://unpkg.com/checkra@latest/dist/checkra.umd.cjs" defer></script>

```

### Using npm/yarn/pnpm

```bash
# Using npm
npm install checkra
# Using yarn
yarn add checkra
# Using pnpm
pnpm add checkra
```

**Basic Usage (ES Module):**

```javascript
import { initCheckra } from 'checkra';

// Initialize Checkra (typically on DOMContentLoaded or later)
const checkraInstance = initCheckra({
  isVisible: true // Default is true
});

// Example: Trigger feedback capture programmatically (e.g., on a custom button click)
if (checkraInstance) {
  const myCustomButton = document.getElementById('my-feedback-button');
  if (myCustomButton) {
    myCustomButton.addEventListener('click', () => {
      checkraInstance.showFeedback();
    });
  }
}
```

## API

The `initCheckra(options)` function returns an API object (or `null` on failure) with the following methods:

*   `showFeedback(): void`: Programmatically triggers the feedback capture UI flow. Does nothing if the UI was initialized with `isVisible: false`.
*   `showSettings(): void`: Programmatically shows the settings modal. Does nothing if the UI was initialized with `isVisible: false`.
*   `destroy(): void`: Removes the Checkra UI elements and cleans up resources.

## Configuration Options

The `initCheckra` function accepts an optional configuration object:

```typescript
interface CheckraOptions {
  /**
   * Whether to render the Checkra UI elements (button, viewer) in the DOM.
   * If set to false, the library will not add any UI elements, but API methods
   * like destroy() might still be relevant.
   * @default true
   */
  isVisible?: boolean;

  /**
   * Custom CSS styles for UI elements (if needed in the future).
   * Currently unused.
   */
  // style?: Partial<CSSStyleDeclaration>; // Example if needed later
}
```

