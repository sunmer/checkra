import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      // Entry point for the library
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'AdvancedFrontendLogger',
      fileName: (format) => `index.${format}.js`,
      formats: ['es', 'cjs', 'umd']
    },
    rollupOptions: {
      // Make sure to externalize deps that shouldn't be bundled
      external: [],
      output: {
        // Provide global variables to use in the UMD build
        globals: {},
      },
    },
    // Don't use the default index.html as entry
    emptyOutDir: true, 
    sourcemap: true,
    minify: 'terser',
  },
  plugins: [
    dts({
      include: ['src/**/*.ts'],
      rollupTypes: true,
    }),
  ],
});