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
          // Build only UMD format for direct browser script tag usage
          formats: ['umd'],
          // Output a simple filename
          fileName: (format) => `logger.js`
        },
        sourcemap: true,
        rollupOptions: {
            // Make sure dependencies like @babel/* are NOT externalized
            // unless you intend for the consumer to provide them.
            // By default, Vite bundles dependencies for library mode.
            external: [],
             output: {
               // Provide global variables to use in the UMD build
               // for externalized deps (if any)
               globals: {}
             }
        }
      },
      plugins: [
        dts({
          include: ['src/**/*.ts'],
          rollupTypes: true
        })
      ],
    };
  }
});