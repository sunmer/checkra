import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import fs from 'fs';
import path from 'path';

// Read package.json to get the version
const packageJsonPath = resolve(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const currentVersion = packageJson.version;

export default defineConfig(({ command, mode }) => {
  // console.log(`Vite Config - Command: ${command}, Mode: ${mode}`); // Optional: for debugging

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
      // No plugins needed specifically for dev serving in this case
      plugins: [],
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
            fileName: (format) => `checkra.${format === 'umd' ? 'umd.cjs' : 'js'}` // Match package.json
          },
          sourcemap: true, // Generate source maps for library
          rollupOptions: {
            // Specify external dependencies to avoid bundling them
            external: [], // Add peer dependencies here if needed
            output: {
              // Global variable names for UMD external dependencies
              globals: {} // e.g., { react: 'React' }
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
              playground: resolve(__dirname, 'demo/playground.html'),
              callback: resolve(__dirname, 'demo/auth/callback.html')
            }
          }
        },
        // Define the package version as an environment variable
        define: {
          'import.meta.env.PACKAGE_VERSION': JSON.stringify(currentVersion)
        },
        // No dts plugin needed for demo build
        plugins: [],
      };
    }

    // Fallback or handle other potential modes if necessary
    console.warn(`[Vite Config] Unhandled build mode: ${mode}. Using default build behavior.`);
    return {}; // Return default Vite build config or handle as needed
  }

  // Fallback for other commands (if any)
  return {};
});