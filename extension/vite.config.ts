import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        xianyuContent: resolve(__dirname, "src/xianyuContent.ts"),
        xianyuPageHook: resolve(__dirname, "src/xianyuPageHook.ts"),
        agisoContent: resolve(__dirname, "src/agisoContent.ts"),
        popup: resolve(__dirname, "src/popup.ts")
      },
      output: {
        entryFileNames: "js/[name].js",
        chunkFileNames: "js/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});
