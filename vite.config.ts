import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig(({ command, mode }) => {
  // console.log(`Vite Config - Command: ${command}, Mode: ${mode}`); // Optional: for debugging

  // --- DEVELOPMENT SERVER (npm run dev) ---
  if (command === 'serve') {
    // Serve the demo directory directly
    return {
      root: 'demo',
      base: './', // Ensure assets load correctly in dev
      server: {
        open: true // Open browser automatically
      },
      // No plugins needed specifically for dev serving in this case
      plugins: [],
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
          cssCodeSplit: false, // Keep CSS in JS for easier consumption? Or set to true if preferred.
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
          minify: true, // Minify library build
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