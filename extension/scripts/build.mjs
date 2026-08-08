import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const extensionRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = resolve(extensionRoot, "dist");
const outputNames = {
  entryFileNames: "js/[name].js",
  chunkFileNames: "js/[name].js",
  assetFileNames: "assets/[name][extname]"
};

await build({
  root: extensionRoot,
  configFile: false,
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(extensionRoot, "src/background.ts"),
        popup: resolve(extensionRoot, "src/ui/popup.ts"),
        manage: resolve(extensionRoot, "src/ui/manage.ts")
      },
      output: outputNames
    }
  }
});

for (const entryName of ["xianyuContent", "xianyuPageHook", "xianyuWidget"]) {
  const entryPath = `src/webhook/${entryName}.ts`;
  await build({
    root: extensionRoot,
    configFile: false,
    build: {
      outDir: outputDirectory,
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(extensionRoot, entryPath),
        output: {
          ...outputNames,
          entryFileNames: `js/${entryName}.js`,
          inlineDynamicImports: true,
          // content script 与其它脚本共享同一隔离世界：IIFE 避免顶层声明冲突
          format: entryName === "xianyuWidget" ? "iife" : "es"
        }
      }
    }
  });
}
