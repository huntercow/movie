import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sourceFiles = [
  "background.ts",
  "handlers/types.ts",
  "webhook/xianyuContent.ts",
  "webhook/xianyuPageHook.ts"
].map((file) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"));
const productSource = sourceFiles.join("\n");
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("product source contains no removed Xianyu backend paths or bridge actions", () => {
  for (const forbidden of [
    "/api/xianyu",
    "/app/seatImageOcr",
    "/app/baojia",
    "CLAIM_DELIVERY",
    "POLL_ORDER",
    "PENDING_DELIVERIES",
    "DELIVERY_RESULT",
    "OCR_SEAT_IMAGE",
    "BAOJIA",
    "REGISTER_WAITING_PAYMENT",
    "VERIFY_PAID",
    "RECORD_VERIFICATION_FAILURE",
    "installationId",
    "deliveryAttemptId",
    "quoteId"
  ]) {
    assert.equal(productSource.includes(forbidden), false, forbidden);
  }
});

test("protocol capture remains development-only at source level", () => {
  const contentSource = sourceFiles[2];
  const pageHookSource = sourceFiles[3];
  assert.match(contentSource, /const ENABLE_PROTOCOL_CAPTURE = import\.meta\.env\.DEV;/);
  assert.match(pageHookSource, /const ENABLE_PROTOCOL_CAPTURE = import\.meta\.env\.DEV;/);
  assert.match(contentSource, /if \(ENABLE_PROTOCOL_CAPTURE\) \{/);
  assert.match(pageHookSource, /if \(ENABLE_PROTOCOL_CAPTURE\) \{/);
});

test("manifest has only explicit permissions and hosts", () => {
  assert.deepEqual(manifest.permissions, ["storage", "tabs", "alarms", "declarativeNetRequest"]);
  assert.equal(manifest.host_permissions.includes("http://*/*"), false);
  assert.equal(manifest.host_permissions.includes("https://*/*"), false);
  assert.equal(manifest.permissions.includes("notifications"), false);
});
