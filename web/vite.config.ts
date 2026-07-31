import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

function defaultBackendTarget(): string {
  if (!process.env.WSL_DISTRO_NAME) return "http://127.0.0.1:8080";
  const routes = execFileSync("ip", ["route", "show", "default"], { encoding: "utf8" });
  const gateway = routes.match(/default via ([^\s]+)/)?.[1];
  if (!gateway) throw new Error("unable to determine WSL default gateway; set VITE_BACKEND_TARGET explicitly");
  return `http://${gateway}:8080`;
}

const backendTarget = process.env.VITE_BACKEND_TARGET || defaultBackendTarget();

export default defineConfig({
  plugins: [vue()],
  base: "/console/",
  build: {
    outDir: fileURLToPath(new URL("../src/main/resources/static/console", import.meta.url)),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/api": backendTarget
    }
  }
});
