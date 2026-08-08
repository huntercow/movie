import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");

test("Popup contains the hook master switch, work note, manage link, and Xianyu IM without login controls", () => {
  assert.match(html, /id="hookSwitch"[^>]*role="switch"/s);
  assert.match(html, /id="workNote"/);
  assert.match(html, /id="manageLink"/);
  assert.equal((html.match(/class="[^"]*open-im/g) ?? []).length, 1);

  for (const removed of [
    "tokenInput", "loginForm", "logoutButton", "tokenMask", "登录", "Token",
    "automationSwitch", "workView", "workTitle"
  ]) {
    assert.equal(html.includes(removed), false, removed);
  }
  for (const forbidden of [
    "backendBaseUrl", "installationId", "replyTemplates", "keywordRules", "aiEndpoint",
    "openAgiso", "captureScenario", "sendTicketImage", "textFallback", "保存到后端"
  ]) {
    assert.equal(html.includes(forbidden), false, forbidden);
  }
});

test("Popup preserves keyboard, live-region, and reduced-motion support", () => {
  assert.match(html, /:focus-visible/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /<script type="module" src="\/js\/popup\.js"><\/script>/);
});
