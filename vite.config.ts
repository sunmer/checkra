import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import fs from 'fs';
import path from 'path';

// Read package.json to get the version
const packageJsonPath = resolve(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const currentVersion = packageJson.version;

// Helper function to create the HTML transform plugin
function htmlTransformPlugin() {
  return {
    name: 'html-transform-checkra-loader',
    transformIndexHtml(html, ctx) {
      const isDevServer = !!ctx.server;
      // process.env.VITE_USER_NODE_ENV is set in defineConfig for build commands
      const buildMode = isDevServer ? 'development' : process.env.VITE_USER_NODE_ENV;

      let scriptSrc = '';
      let cssLink = '';

      if (isDevServer) { // Dev server (vite serve)
        const absoluteSrcPath = resolve(__dirname, 'src/index.ts');
        scriptSrc = `/@fs/${absoluteSrcPath}`;
        // In dev, Vite handles CSS injection from JS/TS imports, so no explicit CSS link needed here
      } else if (buildMode === 'preprod') { // Preprod build (npm run build:demo)
        scriptSrc = './checkra.js'; // Use ES module build
        cssLink = '<link rel="stylesheet" href="./style.css">'; // Relative to demo-dist
      } else { // Production library build or other modes (e.g. CDN usage for demo)
        scriptSrc = `https://unpkg.com/checkra@${currentVersion}/dist/checkra.js`; // Use ES module for CDN usage
        cssLink = `<link rel="stylesheet" href="https://unpkg.com/checkra@${currentVersion}/dist/style.css">`;
      }

      return html
        .replace('%CHECKRA_CSS_LINK%', cssLink)
        .replace('%CHECKRA_SCRIPT_TAG%', `<script type="module" src="${scriptSrc}" defer></script>`);
    }
  };
}

export default defineConfig(({ command, mode }) => {
  // Update the environment variable for more reliable mode detection in the plugin
  if (command === 'build') {
    process.env.VITE_USER_NODE_ENV = mode;
  } else if (command === 'serve') {
    // For dev server, explicitly set a development mode for the plugin if needed, though isDevServer is primary check
    process.env.VITE_USER_NODE_ENV = 'development'; 
  }


  // --- DEVELOPMENT SERVER (npm run dev) ---
  if (command === 'serve') {
    // Serve the demo directory directly
    return {
      root: 'demo',
      base: './', // Ensure assets load correctly in dev
      server: {
        open: true, // Open browser automatically
        watch: {
          ignored: ['!**/node_modules/**','!**/dist/**']
        }
      },
      plugins: [htmlTransformPlugin()], // Add plugin for dev server
      fs: {
        allow: [
          resolve(__dirname, '..'),
          resolve(__dirname, 'src')
        ]
      }
    };
  }

  // --- BUILD COMMANDS (npm run build:lib, npm run build:demo) ---
  if (command === 'build') {
    // --- LIBRARY BUILD (npm run build:lib, mode=production) ---
    if (mode === 'production') {
      return {
        // Building library from root
        build: {
          outDir: resolve(__dirname, 'dist'), // Output directory for library
          cssCodeSplit: true, // Keep CSS in JS for easier consumption? Or set to true if preferred.
          lib: {
            entry: resolve(__dirname, 'src/index.ts'), // Your library entry point
            name: 'checkra', // Global variable name for UMD build
            formats: ['es', 'umd'], // Generate ES and UMD formats
            fileName: (format) => `checkra.${format === 'umd' ? 'umd.js' : 'js'}` // Changed to .js for UMD
          },
          sourcemap: false, // Disable source maps to reduce package size
          rollupOptions: {
            // Bundle everything into a single file – avoids additional chunk requests and bare-specifier issues.
            output: {
              inlineDynamicImports: true
            }
          },
          emptyOutDir: true, // Clean the dist directory before building
          minify: 'terser', // Explicitly use terser, can also be true by default
          terserOptions: {
            compress: {
              drop_console: true,
              drop_debugger: true
            }
          }
        },
        // Ensure no leftover Node-specific globals leak into the bundle
        define: {
          'process.env.NODE_ENV': '"production"',
          'process.env': '{}',
          process: '{}'
        },
        plugins: [
          dts({
            insertTypesEntry: true, // Creates a single entry point type file
            rollupTypes: true // Roll up types into a single file (recommended)
          })
        ],
      };
    }

    // --- DEMO BUILD FOR PREPROD (npm run build:demo, mode=preprod) ---
    if (mode === 'preprod') {
      return {
        // Build the demo app, not the library
        root: 'demo', // Process demo/index.html
        base: './', // Important for correct relative paths in the built demo
        build: {
          outDir: resolve(__dirname, 'demo-dist'), // Output directory for the built demo
          emptyOutDir: true, // Clean the demo-dist directory before building
          sourcemap: true, // Generate source maps for the demo build
          // No 'lib' configuration here - build as a standard app
          rollupOptions: {
            input: {
              main: resolve(__dirname, 'demo/index.html'),
              privacy: resolve(__dirname, 'demo/privacy.html'),
              setup: resolve(__dirname, 'demo/setup.html'),
              playground_fintech: resolve(__dirname, 'demo/playground-fintech.html'),
              playground_ecom: resolve(__dirname, 'demo/playground-ecom.html'),
              callback: resolve(__dirname, 'demo/auth/callback.html')
            }
          }
        },
        // Define the package version as an environment variable
        define: {
          'import.meta.env.PACKAGE_VERSION': JSON.stringify(currentVersion)
        },
        plugins: [htmlTransformPlugin()], // Add plugin for demo build
      };
    }

    // Fallback or handle other potential modes if necessary
    console.warn(`[Vite Config] Unhandled build mode: ${mode}. Using default build behavior.`);
    return {}; // Return default Vite build config or handle as needed
  }

  // Fallback for other commands (if any)
  return {};
});