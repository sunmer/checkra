import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

// Define common configuration options, including 'define'
const commonConfig = {
  define: {
    'process.env.BABEL_TYPES_8_BREAKING': JSON.stringify(true),
  },
};

export default defineConfig(({ command, mode }) => {
  if (command === 'serve') {
    // Development mode - serve the demo directory
    return {
      // Merge common config
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
      // Merge common config
      ...commonConfig,
      build: {
        lib: {
          entry: resolve(__dirname, 'src/index.ts'),
          name: 'AdvancedFrontendLogger',
          // Consider formats needed, e.g., ['es', 'cjs', 'umd']
          formats: ['es', 'cjs', 'umd'],
          fileName: (format) => `index.${format}.js`
        },
        sourcemap: true,
        rollupOptions: {
            // Make sure dependencies like @babel/* are NOT externalized
            // unless you intend for the consumer to provide them.
            // By default, Vite bundles dependencies for library mode.
            external: [
                // e.g., 'react', 'vue' if they are peer dependencies
            ],
             output: {
               // Provide global variables to use in the UMD build
               // for externalized deps (if any)
               globals: {
                 // vue: 'Vue',
               }
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