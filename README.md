# Checkra: Ship growth & UI experiments without a CMS or pull requests

Checkra empowers developers and teams to rapidly test and deploy UI changes, growth experiments, and content variations directly on their live website, bypassing traditional CMS limitations and lengthy pull request cycles.


## Key Features

*   ✨ **AI Live Editor:** Instantly make, test and analyze UI & content changes using an intuitive AI sidebar – without leaving your own website. Say goodbye to slow PRs and clunky CMS workflows
*   🚀 **Ship changes with one command:** Simply type `/publish` to generate a publicy shareable URL. A/B tests and demos made easy
*   📊 **Built-in Analytics:** Automatically track variant performance and get key stats directly from the AI sidebar for quick, data-driven decisions

## Use cases
* **Developers**: Rapid Prototyping & Validation of UI/UX hypotheses
* **Designers**: Iterate on live UI visuals, saving devs from tedious pixel-pushing tickets
* **Growth Teams**: Validate UI ideas quickly, preventing dev effort on unproven features

## Installation

### Easy Installation Using a CDN

Add the following lines inside the `<head>` section of your HTML file:

```html
<!-- Inside the <head> section -->
<link rel="stylesheet" href="https://unpkg.com/checkra@latest/dist/index.css">
<script type="module" src="https://unpkg.com/checkra@latest/dist/checkra.js" defer></script>

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
<link rel="stylesheet" href="https://unpkg.com/checkra@latest/dist/index.css">
```

**Basic Usage (ES Module / ESM CDN):**

```javascript
import { initCheckra } from 'checkra';

// Initialize Checkra (usually after the DOM is ready)
const checkra = initCheckra({
  isVisible: false // Start hidden, show later via API
});

// Show the viewer when a custom button is clicked
const btn = document.getElementById('show-sidepanel');
btn?.addEventListener('click', () => {
  checkra?.show();
});

// Optionally hide it again
const hideBtn = document.getElementById('hide-sidepanel');
hideBtn?.addEventListener('click', () => {
  checkra?.hide();
});
```

### Configuration Before Script Load (CDN/Script Tag Users)

If you are using the simple CDN script tag installation but need to configure Checkra *before* it initializes (e.g., to disable the UI conditionally), you can define a global `CheckraConfig` object in a `<script>` tag placed *before* the main Checkra script:

```html
<!-- Place this *before* the esm checkra.js script -->
<script>
  // Example: Disable Checkra UI based on some condition
  if (window.location.hostname !== 'dev.mysite.com') {
    window.CheckraConfig = { isVisible: false };
  }
  // If CheckraConfig is not set, default options will be used (isVisible: true)
</script>

<!-- Standard Checkra Scripts -->
<link rel="stylesheet" href="https://unpkg.com/checkra@latest/dist/index.css">
<script type="module" src="https://unpkg.com/checkra@latest/dist/checkra.js" defer></script>
```

### Loading Checkra Only in Development/Preview (for Platforms)

A common requirement when using platforms like Shopify, Squarespace, or Webflow is to load Checkra only during development or preview sessions, not on the live site. Instead of using `window.CheckraConfig`, it's generally better to conditionally include the Checkra `<link>` and `<script>` tags using your platform's specific templating or logic. Refer to the [Setup Guide](demo/setup.html) for platform-specific examples.

## API

The `initCheckra(options)` function returns an API object (or `null` on failure) with the following methods:

*   `show(): void` – show the AI sidepanel.
*   `hide(): void` – hide the AI sidepanel.
*   `showSettings(): void` – open the settings modal.
*   `destroy(): void` – tear down UI and listeners.
*   `startLogin(): Promise<void>` – begin Google OAuth flow.
*   `handleAuthCallback(): Promise<boolean>` – finalize OAuth on the callback page.
*   `logout(): Promise<void>` – clear session.
*   `isLoggedIn(): Promise<boolean>` – check session.
*   `getAuthToken(): Promise<string | null>` – get (and refresh) bearer token.

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

## Panel Docking Behavior

By default, the Checkra sidepanel will "dock" to the right side of your page by applying a `margin-right` to the `<html>` element. This pushes your page content to the left, making the panel sit alongside your website content rather than overlaying it.

- A class `checkra-panel-open` is added to the `<html>` element when the panel is visible.
- The width of the panel (and thus the margin applied) is controlled by the CSS custom property `--checkra-panel-width` (defaults to `360px`). You can override this in your own CSS if needed:
  ```css
  :root {
    --checkra-panel-width: 400px; /* Example: make panel wider */
  }
  ```
- On smaller screens (typically <= 768px wide), this docking behavior is disabled, and the panel will revert to an overlay, taking up the full width of the viewport. This is to ensure a better experience on mobile devices.

If this docking behavior interferes with your site's layout (e.g., sites with complex horizontal scrolling or full-width fixed elements), you can customize the behavior of `.checkra-panel-open` or `#checkra-feedback-viewer` in your own stylesheets.

