# Checkra, a js library for getting inline feedback for your website

Inspect any part of your website and get helpful recommendations, all previewed inline. Checkra aims to make it easier for technical and non-technical people to collaborate on improving websites.

 ## Features

- ✨ **Suggestions**: Get AI-powered improvement ideas for UI, UX, and content
- 💬 **Conversion tips**: Get conversion tips on any part of your website
- ⚙️ **Simple Integration**: Add Checkra to your site with a single script tag or npm install.
- 🎨 **Minimal UI**: Floating button and modal interface stay out of the way until needed.
- 🤝 **Collaborative**: Share suggestions for changes with your team (coming soon)
- 🔌 **API Control**: Programmatically trigger feedback, settings, or destroy the instance.

## Installation

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

### Using CDN (UMD)

```html
<-- Replace 'latest' with a specific version for production -->
<script src="https://unpkg.com/checkra@latest/dist/checkra.umd.cjs"></script>
<script>
  // Optional: Configure Checkra directly via window.CheckraOptions
  // The library reads this *before* initializing if found.
  window.CheckraOptions = {
    isVisible: true // Default is true, set to false to initialize hidden
    // Add other configuration options here if needed
  };

  // Initialize Checkra and get the API instance
  // Checkra initializes automatically when the script loads.
  // The 'Checkra' global variable holds the init function.
  // Ensure the Checkra global and initCheckra function exist before calling
  let checkraInstance = null;
  if (window.Checkra && typeof window.Checkra.initCheckra === 'function') {
      checkraInstance = window.Checkra.initCheckra(window.CheckraOptions);
  } else {
      console.error("Checkra global object or initCheckra function not found.");
  }


  // Example: Trigger feedback from a custom button
  if (checkraInstance) {
    const myButton = document.getElementById('trigger-checkra');
    if (myButton) {
        myButton.addEventListener('click', () => {
            checkraInstance.showFeedback();
        });
    }
  } else {
    console.error("Failed to initialize Checkra or get instance.");
  }
</script>
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

