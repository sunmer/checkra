import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig(({ command, mode }) => {
  if (command === 'serve') {
    // Development mode - serve the demo directory
    return {
      root: 'demo',
      server: {
        open: true
      },
      plugins: [
      ],
    };
  } else {
    // Build mode - build the library
    return {
      build: {
        lib: {
          entry: resolve(__dirname, 'src/index.ts'),
          name: 'Checkra',
          // Build ESM and UMD formats
          formats: ['es', 'umd'],
          // Adjust filenames to match package.json entries
          fileName: (format) => `checkra.${format === 'umd' ? 'umd.cjs' : 'js'}`
        },
        sourcemap: true,
        rollupOptions: {
            // Ensure external dependencies are handled correctly if any
            // By default, Vite bundles dependencies for library mode.
            external: [], // Add peer dependencies here if needed (e.g., 'react' if it were a React lib)
             output: {
               // Provide global variables to use in the UMD build
               // for externalized deps (if any)
               globals: {} // e.g., react: 'React'
             }
        }
      },
      plugins: [
        dts({
          insertTypesEntry: true, // Creates a single entry point type file (e.g., dist/index.d.ts)
          rollupTypes: true // Roll up types into a single file
        })
      ],
    };
  }
});