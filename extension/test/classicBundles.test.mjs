import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Chrome classic-script bundles are self-contained", () => {
  execFileSync("npm", ["run", "build"], {
    cwd: extensionRoot,
    encoding: "utf8",
    stdio: "pipe"
  });
  for (const relativePath of ["dist/js/xianyuContent.js", "dist/js/xianyuPageHook.js"]) {
    const source = readFileSync(resolve(extensionRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /^\s*(?:import|export)\b/m, `${relativePath} must not contain ESM statements`);
  }
});
