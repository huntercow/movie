import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contentSource = readFileSync(new URL("../src/webhook/xianyuContent.ts", import.meta.url), "utf8");
const pageHookSource = readFileSync(new URL("../src/webhook/xianyuPageHook.ts", import.meta.url), "utf8");
const debugSource = readFileSync(new URL("../src/webhook/xianyuDebugState.ts", import.meta.url), "utf8");

test("local hook settings control page hook processing", () => {
  assert.match(contentSource, /const HOOK_CONTROL_EVENT = "FILM_AI_XIANYU_HOOK_CONTROL"/);
  assert.match(contentSource, /const HOOK_STATE_REQUEST_EVENT = "FILM_AI_XIANYU_HOOK_STATE_REQUEST"/);
  assert.match(contentSource, /HOOK_SETTINGS_STORAGE_KEY/);
  assert.match(contentSource, /decodeHookSettings\(value\)\)\.enabled/);
  assert.match(contentSource, /window\.dispatchEvent\(new CustomEvent\(HOOK_CONTROL_EVENT/);

  assert.match(pageHookSource, /let hookEnabled = false/);
  assert.match(pageHookSource, /installHookControlEvents\(\)/);
  assert.match(pageHookSource, /requestHookState\(\)/);
  assert.match(pageHookSource, /setHookEnabled\(requireBoolean\(detail\.enabled/);
  assert.match(pageHookSource, /debugState\.hookEnabled = enabled/);
});

test("disabled hook stops active processing and outbound socket sends", () => {
  assert.match(pageHookSource, /if \(!hookEnabled\) \{\s*return false;\s*\}/);
  assert.match(pageHookSource, /if \(!hookEnabled\) \{\s*return;\s*\}\s*debugState\.rawMessages \+= 1/);
  assert.match(pageHookSource, /if \(!hookEnabled\) \{\s*return false;\s*\}\s*return \(await getAutomationConfig\(\)\)\.autoReply/);
  assert.match(pageHookSource, /setHookEnabled\(enabled: boolean\): void \{/);
  assert.match(pageHookSource, /debugState\.hookEnabled = enabled;/);
  assert.match(contentSource, /if \(!currentHookEnabled\) \{\s*return;\s*\}\s*const disconnected = findElementByExactText/);
});

test("hook enabled state is visible in debug status", () => {
  assert.match(debugSource, /hookEnabled: boolean/);
  assert.match(debugSource, /hookEnabled: false/);
  assert.match(debugSource, /getDebugStatus\(\): Record<string, unknown>/);
  assert.match(debugSource, /\.\.\.debugState/);
});
