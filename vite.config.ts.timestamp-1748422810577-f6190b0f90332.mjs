// vite.config.ts
import { defineConfig } from "file:///Users/nimaboustanian/Desktop/projects/checkra/node_modules/vite/dist/node/index.js";
import { resolve } from "path";
import dts from "file:///Users/nimaboustanian/Desktop/projects/checkra/node_modules/vite-plugin-dts/dist/index.mjs";
import fs from "fs";
var __vite_injected_original_dirname = "/Users/nimaboustanian/Desktop/projects/checkra";
var packageJsonPath = resolve(__vite_injected_original_dirname, "package.json");
var packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
var currentVersion = packageJson.version;
function htmlTransformPlugin() {
  return {
    name: "html-transform-checkra-loader",
    transformIndexHtml(html, ctx) {
      const isDevServer = !!ctx.server;
      const buildMode = isDevServer ? "development" : process.env.VITE_USER_NODE_ENV;
      let scriptSrc = "";
      let cssLink = "";
      if (isDevServer) {
        const absoluteSrcPath = resolve(__vite_injected_original_dirname, "src/index.ts");
        scriptSrc = `/@fs/${absoluteSrcPath}`;
      } else if (buildMode === "preprod") {
        scriptSrc = "./checkra.js";
        cssLink = '<link rel="stylesheet" href="./style.css">';
      } else {
        scriptSrc = `https://unpkg.com/checkra@${currentVersion}/dist/checkra.js`;
        cssLink = `<link rel="stylesheet" href="https://unpkg.com/checkra@${currentVersion}/dist/style.css">`;
      }
      return html.replace("%CHECKRA_CSS_LINK%", cssLink).replace("%CHECKRA_SCRIPT_TAG%", `<script type="module" src="${scriptSrc}" defer></script>`);
    }
  };
}
var vite_config_default = defineConfig(({ command, mode }) => {
  if (command === "build") {
    process.env.VITE_USER_NODE_ENV = mode;
  } else if (command === "serve") {
    process.env.VITE_USER_NODE_ENV = "development";
  }
  if (command === "serve") {
    return {
      root: "demo",
      base: "./",
      // Ensure assets load correctly in dev
      server: {
        open: true,
        // Open browser automatically
        watch: {
          ignored: ["!**/node_modules/**", "!**/dist/**"]
        }
      },
      plugins: [htmlTransformPlugin()],
      // Add plugin for dev server
      fs: {
        allow: [
          resolve(__vite_injected_original_dirname, ".."),
          resolve(__vite_injected_original_dirname, "src")
        ]
      }
    };
  }
  if (command === "build") {
    if (mode === "production") {
      return {
        // Building library from root
        build: {
          outDir: resolve(__vite_injected_original_dirname, "dist"),
          // Output directory for library
          cssCodeSplit: true,
          // Keep CSS in JS for easier consumption? Or set to true if preferred.
          lib: {
            entry: resolve(__vite_injected_original_dirname, "src/index.ts"),
            // Your library entry point
            name: "checkra",
            // Global variable name for UMD build
            formats: ["es", "umd"],
            // Generate ES and UMD formats
            fileName: (format) => `checkra.${format === "umd" ? "umd.js" : "js"}`
            // Changed to .js for UMD
          },
          sourcemap: false,
          // Disable source maps to reduce package size
          rollupOptions: {
            // Bundle everything into a single file – avoids additional chunk requests and bare-specifier issues.
            output: {
              inlineDynamicImports: true
            }
          },
          emptyOutDir: true,
          // Clean the dist directory before building
          minify: "terser",
          // Explicitly use terser, can also be true by default
          terserOptions: {
            compress: {
              drop_console: true,
              drop_debugger: true
            }
          }
        },
        // Ensure no leftover Node-specific globals leak into the bundle
        define: {
          "process.env.NODE_ENV": '"production"',
          "process.env": "{}",
          process: "{}"
        },
        plugins: [
          dts({
            insertTypesEntry: true,
            // Creates a single entry point type file
            rollupTypes: true
            // Roll up types into a single file (recommended)
          })
        ]
      };
    }
    if (mode === "preprod") {
      return {
        // Build the demo app, not the library
        root: "demo",
        // Process demo/index.html
        base: "./",
        // Important for correct relative paths in the built demo
        build: {
          outDir: resolve(__vite_injected_original_dirname, "demo-dist"),
          // Output directory for the built demo
          emptyOutDir: true,
          // Clean the demo-dist directory before building
          sourcemap: true,
          // Generate source maps for the demo build
          // No 'lib' configuration here - build as a standard app
          rollupOptions: {
            input: {
              main: resolve(__vite_injected_original_dirname, "demo/index.html"),
              privacy: resolve(__vite_injected_original_dirname, "demo/privacy.html"),
              setup: resolve(__vite_injected_original_dirname, "demo/setup.html"),
              playground_fintech: resolve(__vite_injected_original_dirname, "demo/playground-fintech.html"),
              playground_ecom: resolve(__vite_injected_original_dirname, "demo/playground-ecom.html"),
              callback: resolve(__vite_injected_original_dirname, "demo/auth/callback.html")
            }
          }
        },
        // Define the package version as an environment variable
        define: {
          "import.meta.env.PACKAGE_VERSION": JSON.stringify(currentVersion)
        },
        plugins: [htmlTransformPlugin()]
        // Add plugin for demo build
      };
    }
    console.warn(`[Vite Config] Unhandled build mode: ${mode}. Using default build behavior.`);
    return {};
  }
  return {};
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvbmltYWJvdXN0YW5pYW4vRGVza3RvcC9wcm9qZWN0cy9jaGVja3JhXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvbmltYWJvdXN0YW5pYW4vRGVza3RvcC9wcm9qZWN0cy9jaGVja3JhL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy9uaW1hYm91c3Rhbmlhbi9EZXNrdG9wL3Byb2plY3RzL2NoZWNrcmEvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdwYXRoJztcbmltcG9ydCBkdHMgZnJvbSAndml0ZS1wbHVnaW4tZHRzJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuLy8gUmVhZCBwYWNrYWdlLmpzb24gdG8gZ2V0IHRoZSB2ZXJzaW9uXG5jb25zdCBwYWNrYWdlSnNvblBhdGggPSByZXNvbHZlKF9fZGlybmFtZSwgJ3BhY2thZ2UuanNvbicpO1xuY29uc3QgcGFja2FnZUpzb24gPSBKU09OLnBhcnNlKGZzLnJlYWRGaWxlU3luYyhwYWNrYWdlSnNvblBhdGgsICd1dGYtOCcpKTtcbmNvbnN0IGN1cnJlbnRWZXJzaW9uID0gcGFja2FnZUpzb24udmVyc2lvbjtcblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGNyZWF0ZSB0aGUgSFRNTCB0cmFuc2Zvcm0gcGx1Z2luXG5mdW5jdGlvbiBodG1sVHJhbnNmb3JtUGx1Z2luKCkge1xuICByZXR1cm4ge1xuICAgIG5hbWU6ICdodG1sLXRyYW5zZm9ybS1jaGVja3JhLWxvYWRlcicsXG4gICAgdHJhbnNmb3JtSW5kZXhIdG1sKGh0bWwsIGN0eCkge1xuICAgICAgY29uc3QgaXNEZXZTZXJ2ZXIgPSAhIWN0eC5zZXJ2ZXI7XG4gICAgICAvLyBwcm9jZXNzLmVudi5WSVRFX1VTRVJfTk9ERV9FTlYgaXMgc2V0IGluIGRlZmluZUNvbmZpZyBmb3IgYnVpbGQgY29tbWFuZHNcbiAgICAgIGNvbnN0IGJ1aWxkTW9kZSA9IGlzRGV2U2VydmVyID8gJ2RldmVsb3BtZW50JyA6IHByb2Nlc3MuZW52LlZJVEVfVVNFUl9OT0RFX0VOVjtcblxuICAgICAgbGV0IHNjcmlwdFNyYyA9ICcnO1xuICAgICAgbGV0IGNzc0xpbmsgPSAnJztcblxuICAgICAgaWYgKGlzRGV2U2VydmVyKSB7IC8vIERldiBzZXJ2ZXIgKHZpdGUgc2VydmUpXG4gICAgICAgIGNvbnN0IGFic29sdXRlU3JjUGF0aCA9IHJlc29sdmUoX19kaXJuYW1lLCAnc3JjL2luZGV4LnRzJyk7XG4gICAgICAgIHNjcmlwdFNyYyA9IGAvQGZzLyR7YWJzb2x1dGVTcmNQYXRofWA7XG4gICAgICAgIC8vIEluIGRldiwgVml0ZSBoYW5kbGVzIENTUyBpbmplY3Rpb24gZnJvbSBKUy9UUyBpbXBvcnRzLCBzbyBubyBleHBsaWNpdCBDU1MgbGluayBuZWVkZWQgaGVyZVxuICAgICAgfSBlbHNlIGlmIChidWlsZE1vZGUgPT09ICdwcmVwcm9kJykgeyAvLyBQcmVwcm9kIGJ1aWxkIChucG0gcnVuIGJ1aWxkOmRlbW8pXG4gICAgICAgIHNjcmlwdFNyYyA9ICcuL2NoZWNrcmEuanMnOyAvLyBVc2UgRVMgbW9kdWxlIGJ1aWxkXG4gICAgICAgIGNzc0xpbmsgPSAnPGxpbmsgcmVsPVwic3R5bGVzaGVldFwiIGhyZWY9XCIuL3N0eWxlLmNzc1wiPic7IC8vIFJlbGF0aXZlIHRvIGRlbW8tZGlzdFxuICAgICAgfSBlbHNlIHsgLy8gUHJvZHVjdGlvbiBsaWJyYXJ5IGJ1aWxkIG9yIG90aGVyIG1vZGVzIChlLmcuIENETiB1c2FnZSBmb3IgZGVtbylcbiAgICAgICAgc2NyaXB0U3JjID0gYGh0dHBzOi8vdW5wa2cuY29tL2NoZWNrcmFAJHtjdXJyZW50VmVyc2lvbn0vZGlzdC9jaGVja3JhLmpzYDsgLy8gVXNlIEVTIG1vZHVsZSBmb3IgQ0ROIHVzYWdlXG4gICAgICAgIGNzc0xpbmsgPSBgPGxpbmsgcmVsPVwic3R5bGVzaGVldFwiIGhyZWY9XCJodHRwczovL3VucGtnLmNvbS9jaGVja3JhQCR7Y3VycmVudFZlcnNpb259L2Rpc3Qvc3R5bGUuY3NzXCI+YDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGh0bWxcbiAgICAgICAgLnJlcGxhY2UoJyVDSEVDS1JBX0NTU19MSU5LJScsIGNzc0xpbmspXG4gICAgICAgIC5yZXBsYWNlKCclQ0hFQ0tSQV9TQ1JJUFRfVEFHJScsIGA8c2NyaXB0IHR5cGU9XCJtb2R1bGVcIiBzcmM9XCIke3NjcmlwdFNyY31cIiBkZWZlcj48L3NjcmlwdD5gKTtcbiAgICB9XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBjb21tYW5kLCBtb2RlIH0pID0+IHtcbiAgLy8gVXBkYXRlIHRoZSBlbnZpcm9ubWVudCB2YXJpYWJsZSBmb3IgbW9yZSByZWxpYWJsZSBtb2RlIGRldGVjdGlvbiBpbiB0aGUgcGx1Z2luXG4gIGlmIChjb21tYW5kID09PSAnYnVpbGQnKSB7XG4gICAgcHJvY2Vzcy5lbnYuVklURV9VU0VSX05PREVfRU5WID0gbW9kZTtcbiAgfSBlbHNlIGlmIChjb21tYW5kID09PSAnc2VydmUnKSB7XG4gICAgLy8gRm9yIGRldiBzZXJ2ZXIsIGV4cGxpY2l0bHkgc2V0IGEgZGV2ZWxvcG1lbnQgbW9kZSBmb3IgdGhlIHBsdWdpbiBpZiBuZWVkZWQsIHRob3VnaCBpc0RldlNlcnZlciBpcyBwcmltYXJ5IGNoZWNrXG4gICAgcHJvY2Vzcy5lbnYuVklURV9VU0VSX05PREVfRU5WID0gJ2RldmVsb3BtZW50JzsgXG4gIH1cblxuXG4gIC8vIC0tLSBERVZFTE9QTUVOVCBTRVJWRVIgKG5wbSBydW4gZGV2KSAtLS1cbiAgaWYgKGNvbW1hbmQgPT09ICdzZXJ2ZScpIHtcbiAgICAvLyBTZXJ2ZSB0aGUgZGVtbyBkaXJlY3RvcnkgZGlyZWN0bHlcbiAgICByZXR1cm4ge1xuICAgICAgcm9vdDogJ2RlbW8nLFxuICAgICAgYmFzZTogJy4vJywgLy8gRW5zdXJlIGFzc2V0cyBsb2FkIGNvcnJlY3RseSBpbiBkZXZcbiAgICAgIHNlcnZlcjoge1xuICAgICAgICBvcGVuOiB0cnVlLCAvLyBPcGVuIGJyb3dzZXIgYXV0b21hdGljYWxseVxuICAgICAgICB3YXRjaDoge1xuICAgICAgICAgIGlnbm9yZWQ6IFsnISoqL25vZGVfbW9kdWxlcy8qKicsJyEqKi9kaXN0LyoqJ11cbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHBsdWdpbnM6IFtodG1sVHJhbnNmb3JtUGx1Z2luKCldLCAvLyBBZGQgcGx1Z2luIGZvciBkZXYgc2VydmVyXG4gICAgICBmczoge1xuICAgICAgICBhbGxvdzogW1xuICAgICAgICAgIHJlc29sdmUoX19kaXJuYW1lLCAnLi4nKSxcbiAgICAgICAgICByZXNvbHZlKF9fZGlybmFtZSwgJ3NyYycpXG4gICAgICAgIF1cbiAgICAgIH1cbiAgICB9O1xuICB9XG5cbiAgLy8gLS0tIEJVSUxEIENPTU1BTkRTIChucG0gcnVuIGJ1aWxkOmxpYiwgbnBtIHJ1biBidWlsZDpkZW1vKSAtLS1cbiAgaWYgKGNvbW1hbmQgPT09ICdidWlsZCcpIHtcbiAgICAvLyAtLS0gTElCUkFSWSBCVUlMRCAobnBtIHJ1biBidWlsZDpsaWIsIG1vZGU9cHJvZHVjdGlvbikgLS0tXG4gICAgaWYgKG1vZGUgPT09ICdwcm9kdWN0aW9uJykge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLy8gQnVpbGRpbmcgbGlicmFyeSBmcm9tIHJvb3RcbiAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICBvdXREaXI6IHJlc29sdmUoX19kaXJuYW1lLCAnZGlzdCcpLCAvLyBPdXRwdXQgZGlyZWN0b3J5IGZvciBsaWJyYXJ5XG4gICAgICAgICAgY3NzQ29kZVNwbGl0OiB0cnVlLCAvLyBLZWVwIENTUyBpbiBKUyBmb3IgZWFzaWVyIGNvbnN1bXB0aW9uPyBPciBzZXQgdG8gdHJ1ZSBpZiBwcmVmZXJyZWQuXG4gICAgICAgICAgbGliOiB7XG4gICAgICAgICAgICBlbnRyeTogcmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMvaW5kZXgudHMnKSwgLy8gWW91ciBsaWJyYXJ5IGVudHJ5IHBvaW50XG4gICAgICAgICAgICBuYW1lOiAnY2hlY2tyYScsIC8vIEdsb2JhbCB2YXJpYWJsZSBuYW1lIGZvciBVTUQgYnVpbGRcbiAgICAgICAgICAgIGZvcm1hdHM6IFsnZXMnLCAndW1kJ10sIC8vIEdlbmVyYXRlIEVTIGFuZCBVTUQgZm9ybWF0c1xuICAgICAgICAgICAgZmlsZU5hbWU6IChmb3JtYXQpID0+IGBjaGVja3JhLiR7Zm9ybWF0ID09PSAndW1kJyA/ICd1bWQuanMnIDogJ2pzJ31gIC8vIENoYW5nZWQgdG8gLmpzIGZvciBVTURcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNvdXJjZW1hcDogZmFsc2UsIC8vIERpc2FibGUgc291cmNlIG1hcHMgdG8gcmVkdWNlIHBhY2thZ2Ugc2l6ZVxuICAgICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgICAgICAgIC8vIEJ1bmRsZSBldmVyeXRoaW5nIGludG8gYSBzaW5nbGUgZmlsZSBcdTIwMTMgYXZvaWRzIGFkZGl0aW9uYWwgY2h1bmsgcmVxdWVzdHMgYW5kIGJhcmUtc3BlY2lmaWVyIGlzc3Vlcy5cbiAgICAgICAgICAgIG91dHB1dDoge1xuICAgICAgICAgICAgICBpbmxpbmVEeW5hbWljSW1wb3J0czogdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0sXG4gICAgICAgICAgZW1wdHlPdXREaXI6IHRydWUsIC8vIENsZWFuIHRoZSBkaXN0IGRpcmVjdG9yeSBiZWZvcmUgYnVpbGRpbmdcbiAgICAgICAgICBtaW5pZnk6ICd0ZXJzZXInLCAvLyBFeHBsaWNpdGx5IHVzZSB0ZXJzZXIsIGNhbiBhbHNvIGJlIHRydWUgYnkgZGVmYXVsdFxuICAgICAgICAgIHRlcnNlck9wdGlvbnM6IHtcbiAgICAgICAgICAgIGNvbXByZXNzOiB7XG4gICAgICAgICAgICAgIGRyb3BfY29uc29sZTogdHJ1ZSxcbiAgICAgICAgICAgICAgZHJvcF9kZWJ1Z2dlcjogdHJ1ZVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgLy8gRW5zdXJlIG5vIGxlZnRvdmVyIE5vZGUtc3BlY2lmaWMgZ2xvYmFscyBsZWFrIGludG8gdGhlIGJ1bmRsZVxuICAgICAgICBkZWZpbmU6IHtcbiAgICAgICAgICAncHJvY2Vzcy5lbnYuTk9ERV9FTlYnOiAnXCJwcm9kdWN0aW9uXCInLFxuICAgICAgICAgICdwcm9jZXNzLmVudic6ICd7fScsXG4gICAgICAgICAgcHJvY2VzczogJ3t9J1xuICAgICAgICB9LFxuICAgICAgICBwbHVnaW5zOiBbXG4gICAgICAgICAgZHRzKHtcbiAgICAgICAgICAgIGluc2VydFR5cGVzRW50cnk6IHRydWUsIC8vIENyZWF0ZXMgYSBzaW5nbGUgZW50cnkgcG9pbnQgdHlwZSBmaWxlXG4gICAgICAgICAgICByb2xsdXBUeXBlczogdHJ1ZSAvLyBSb2xsIHVwIHR5cGVzIGludG8gYSBzaW5nbGUgZmlsZSAocmVjb21tZW5kZWQpXG4gICAgICAgICAgfSlcbiAgICAgICAgXSxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gLS0tIERFTU8gQlVJTEQgRk9SIFBSRVBST0QgKG5wbSBydW4gYnVpbGQ6ZGVtbywgbW9kZT1wcmVwcm9kKSAtLS1cbiAgICBpZiAobW9kZSA9PT0gJ3ByZXByb2QnKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICAvLyBCdWlsZCB0aGUgZGVtbyBhcHAsIG5vdCB0aGUgbGlicmFyeVxuICAgICAgICByb290OiAnZGVtbycsIC8vIFByb2Nlc3MgZGVtby9pbmRleC5odG1sXG4gICAgICAgIGJhc2U6ICcuLycsIC8vIEltcG9ydGFudCBmb3IgY29ycmVjdCByZWxhdGl2ZSBwYXRocyBpbiB0aGUgYnVpbHQgZGVtb1xuICAgICAgICBidWlsZDoge1xuICAgICAgICAgIG91dERpcjogcmVzb2x2ZShfX2Rpcm5hbWUsICdkZW1vLWRpc3QnKSwgLy8gT3V0cHV0IGRpcmVjdG9yeSBmb3IgdGhlIGJ1aWx0IGRlbW9cbiAgICAgICAgICBlbXB0eU91dERpcjogdHJ1ZSwgLy8gQ2xlYW4gdGhlIGRlbW8tZGlzdCBkaXJlY3RvcnkgYmVmb3JlIGJ1aWxkaW5nXG4gICAgICAgICAgc291cmNlbWFwOiB0cnVlLCAvLyBHZW5lcmF0ZSBzb3VyY2UgbWFwcyBmb3IgdGhlIGRlbW8gYnVpbGRcbiAgICAgICAgICAvLyBObyAnbGliJyBjb25maWd1cmF0aW9uIGhlcmUgLSBidWlsZCBhcyBhIHN0YW5kYXJkIGFwcFxuICAgICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgICAgICAgIGlucHV0OiB7XG4gICAgICAgICAgICAgIG1haW46IHJlc29sdmUoX19kaXJuYW1lLCAnZGVtby9pbmRleC5odG1sJyksXG4gICAgICAgICAgICAgIHByaXZhY3k6IHJlc29sdmUoX19kaXJuYW1lLCAnZGVtby9wcml2YWN5Lmh0bWwnKSxcbiAgICAgICAgICAgICAgc2V0dXA6IHJlc29sdmUoX19kaXJuYW1lLCAnZGVtby9zZXR1cC5odG1sJyksXG4gICAgICAgICAgICAgIHBsYXlncm91bmRfZmludGVjaDogcmVzb2x2ZShfX2Rpcm5hbWUsICdkZW1vL3BsYXlncm91bmQtZmludGVjaC5odG1sJyksXG4gICAgICAgICAgICAgIHBsYXlncm91bmRfZWNvbTogcmVzb2x2ZShfX2Rpcm5hbWUsICdkZW1vL3BsYXlncm91bmQtZWNvbS5odG1sJyksXG4gICAgICAgICAgICAgIGNhbGxiYWNrOiByZXNvbHZlKF9fZGlybmFtZSwgJ2RlbW8vYXV0aC9jYWxsYmFjay5odG1sJylcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8vIERlZmluZSB0aGUgcGFja2FnZSB2ZXJzaW9uIGFzIGFuIGVudmlyb25tZW50IHZhcmlhYmxlXG4gICAgICAgIGRlZmluZToge1xuICAgICAgICAgICdpbXBvcnQubWV0YS5lbnYuUEFDS0FHRV9WRVJTSU9OJzogSlNPTi5zdHJpbmdpZnkoY3VycmVudFZlcnNpb24pXG4gICAgICAgIH0sXG4gICAgICAgIHBsdWdpbnM6IFtodG1sVHJhbnNmb3JtUGx1Z2luKCldLCAvLyBBZGQgcGx1Z2luIGZvciBkZW1vIGJ1aWxkXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIG9yIGhhbmRsZSBvdGhlciBwb3RlbnRpYWwgbW9kZXMgaWYgbmVjZXNzYXJ5XG4gICAgY29uc29sZS53YXJuKGBbVml0ZSBDb25maWddIFVuaGFuZGxlZCBidWlsZCBtb2RlOiAke21vZGV9LiBVc2luZyBkZWZhdWx0IGJ1aWxkIGJlaGF2aW9yLmApO1xuICAgIHJldHVybiB7fTsgLy8gUmV0dXJuIGRlZmF1bHQgVml0ZSBidWlsZCBjb25maWcgb3IgaGFuZGxlIGFzIG5lZWRlZFxuICB9XG5cbiAgLy8gRmFsbGJhY2sgZm9yIG90aGVyIGNvbW1hbmRzIChpZiBhbnkpXG4gIHJldHVybiB7fTtcbn0pOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBNFQsU0FBUyxvQkFBb0I7QUFDelYsU0FBUyxlQUFlO0FBQ3hCLE9BQU8sU0FBUztBQUNoQixPQUFPLFFBQVE7QUFIZixJQUFNLG1DQUFtQztBQU96QyxJQUFNLGtCQUFrQixRQUFRLGtDQUFXLGNBQWM7QUFDekQsSUFBTSxjQUFjLEtBQUssTUFBTSxHQUFHLGFBQWEsaUJBQWlCLE9BQU8sQ0FBQztBQUN4RSxJQUFNLGlCQUFpQixZQUFZO0FBR25DLFNBQVMsc0JBQXNCO0FBQzdCLFNBQU87QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLG1CQUFtQixNQUFNLEtBQUs7QUFDNUIsWUFBTSxjQUFjLENBQUMsQ0FBQyxJ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
