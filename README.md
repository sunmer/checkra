# Checkra, improve your website collaboratively with AI

Inspect any part of your website and get helpful recommendations, all previewed inline. Checkra aims to make it easier for technical and non-technical people to collaborate on improving websites.

 ## Features

- ✨ **Suggestions**: Get AI-powered improvement ideas for UI, UX, and content
- 💬 **Conversion tips**: Get conversion tips on any part of your website
- ⚙️ **Simple Integration**: Add Checkra to your site with a single script tag or npm install.
- 🎨 **Minimal UI**: Floating button and modal interface stay out of the way until needed.
- 🤝 **Collaborative**: Share suggestions for changes with your team (coming soon)

## Installation

# Using npm
npm install checkra
# Using yarn
yarn add checkra
# Using pnpm
pnpm add checkra

# html
<!-- Replace 'latest' with a specific version for production -->
<script src="https://unpkg.com/checkra@latest/dist/checkra.umd.cjs"></script>
<script>
// Optional: Configure Checkra directly
window.CheckraConfig = {
isVisible: true // Default is true, set to false to initialize hidden
// Add other configuration options here if needed
};
// Checkra initializes automatically when the script loads if window.CheckraConfig is found
</script>

### If using the CDN script:

Checkra will initialize automatically if you define `window.CheckraConfig` before the script loads (see CDN example above). If you don't define `window.CheckraConfig`, you can initialize it manually after the script has loaded:

