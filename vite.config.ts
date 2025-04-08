import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig(({ command, mode }) => {
  if (command === 'serve') {
    // Development mode - just serve the demo directory
    return {
      root: 'demo',
      server: {
        open: true
      }
    };
  } else {
    // Build mode - build the library
    return {
      build: {
        lib: {
          entry: resolve(__dirname, 'src/index.ts'),
          name: 'AdvancedFrontendLogger',
          fileName: (format) => `index.${format}.js`
        },
        sourcemap: true
      },
      plugins: [
        dts({
          include: ['src/**/*.ts'],
          rollupTypes: true
        })
      ]
    };
  }
});