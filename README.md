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

**Note:** When installing via a package manager, you still need to include the CSS separately. Add the following line to the `<head>` of your HTML:
```html
<link rel="stylesheet" href="https://unpkg.com/checkra@latest/dist/style.css">
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

### Configuration Before Script Load (CDN/Script Tag Users)

If you are using the simple CDN script tag installation but need to configure Checkra *before* it initializes (e.g., to disable the UI conditionally), you can define a global `CheckraConfig` object in a `<script>` tag placed *before* the main Checkra script:

```html
<!-- Place this *before* the checkra.umd.cjs script -->
<script>
  // Example: Disable Checkra UI based on some condition
  if (window.location.hostname !== 'dev.mysite.com') {
    window.CheckraConfig = { isVisible: false };
  }
  // If CheckraConfig is not set, default options will be used (isVisible: true)
</script>

<!-- Standard Checkra Scripts -->
<link rel="stylesheet" href="https://unpkg.com/checkra@latest/dist/style.css">
<script src="https://unpkg.com/checkra@latest/dist/checkra.umd.cjs" defer></script>
```

### Loading Checkra Only in Development/Preview (for Platforms)

A common requirement when using platforms like Shopify, Squarespace, or Webflow is to load Checkra only during development or preview sessions, not on the live site. Instead of using `window.CheckraConfig`, it's generally better to conditionally include the Checkra `<link>` and `<script>` tags using your platform's specific templating or logic. Refer to the [Setup Guide](demo/setup.html) for platform-specific examples.

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

