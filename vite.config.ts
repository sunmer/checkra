import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

const commonConfig = {
  define: {
    'process.env.BABEL_TYPES_8_BREAKING': JSON.stringify(true),
  },
};

export default defineConfig(({ command, mode }) => {
  if (command === 'serve') {
    // Development mode - serve the demo directory
    return {
      ...commonConfig,
      root: 'demo',
      server: {
        open: true
      },
      // Ensure deps like @babel/* are processed if needed (usually default is okay)
      optimizeDeps: {
         // include: ['@babel/parser', /* etc. if needed, but try without first */]
      }
    };
  } else {
    // Build mode - build the library
    return {
      ...commonConfig,
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