import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Chrome classic-script bundles are self-contained", () => {
  // 直接用 node 跑构建脚本,避免 Windows 下 spawn npm.cmd 的问题
  execFileSync(process.execPath, ["scripts/build.mjs"], {
    cwd: extensionRoot,
    encoding: "utf8",
    stdio: "pipe"
  });
  execFileSync(process.execPath, ["scripts/copy-static.mjs"], {
    cwd: extensionRoot,
    encoding: "utf8",
    stdio: "pipe"
  });
  for (const relativePath of ["dist/js/xianyuContent.js", "dist/js/xianyuPageHook.js"]) {
    const source = readFileSync(resolve(extensionRoot, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /(?:^|[;}])\s*(?:import|export)\b/m,
      `${relativePath} must not contain ESM statements`
    );
    assert.doesNotMatch(
      source,
      /FILM_AI_XIANYU_CAPTURE_(?:REQUEST|RESPONSE)|CAPTURE_SCENARIOS/,
      `${relativePath} must not expose protocol capture commands in production`
    );
  }
});
