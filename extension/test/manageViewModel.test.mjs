import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManageViewState,
  buildUnauthenticatedViewState,
  templatePlaceholders,
  testKeyword
} from "../src/ui/manageViewModel.ts";
import { REPLY_TEMPLATE_KEYS } from "../src/handlers/backendApi.ts";

function sampleConfig() {
  return {
    version: 7,
    templates: {
      edit_price_success: "已改好价格，请核对[订单号]",
      payment_successful: "系统已下单，请耐心等待",
      no_quote_record: "未找到报价记录，请先发送选座截图",
      text_message_replay: "购票流程：1.发截图 2.等报价 3.拍下 4.取票",
      identify_wait: "正在识别",
      identify_fail: "识别失败",
      identify_success: "报价成功",
      show_time_too_short: "时间太近",
      cancel_ticket: "已取消",
      send_ticket_success: "取票码：[取票码]",
    },
    keywordRules: [
      { id: "r1", keywords: ["你好", "您好", "在吗"], reply: "您可以发选座截图给我哦", enabled: true, priority: 2 },
      { id: "r2", keywords: ["多少钱", "票价"], reply: "系统自动报价", enabled: true, priority: 10 },
      { id: "r3", keywords: ["座位少了"], reply: "请分多次下单", enabled: false, priority: 5 }
    ]
  };
}

test("buildManageViewState outputs READY with templates in canonical key order", () => {
  const state = buildManageViewState(sampleConfig());
  assert.equal(state.status, "READY");
  assert.equal(state.version, 7);
  assert.deepEqual(
    state.templates.map((entry) => entry.key),
    [...REPLY_TEMPLATE_KEYS]
  );
});

test("buildManageViewState extracts placeholders and collapses preview", () => {
  const state = buildManageViewState(sampleConfig());
  const entry = state.templates.find((item) => item.key === "edit_price_success");
  assert.ok(entry);
  assert.deepEqual(entry.placeholders, ["[订单号]"]);
  assert.ok(entry.preview.length <= 80);
  assert.equal(entry.preview.includes("[分割符]"), false);
});

test("buildManageViewState sorts rules by priority descending", () => {
  const state = buildManageViewState(sampleConfig());
  assert.deepEqual(
    state.rules.map((rule) => rule.id),
    ["r2", "r3", "r1"]
  );
});

test("templatePlaceholders deduplicates and preserves order", () => {
  assert.deepEqual(
    templatePlaceholders("a[订单号]b[订单号]c[取票码]"),
    ["[订单号]", "[取票码]"]
  );
  assert.deepEqual(templatePlaceholders("no placeholders"), []);
});

test("testKeyword hits the highest-priority enabled rule", () => {
  const config = sampleConfig();
  const hit = testKeyword("票价多少", config.keywordRules);
  assert.equal(hit.matched, true);
  if (hit.matched) {
    assert.equal(hit.ruleId, "r2");
    assert.equal(hit.priority, 10);
  }
});

test("testKeyword ignores disabled rules", () => {
  const config = sampleConfig();
  // 「座位少了」只命中停用的 r3，应视为未命中。
  const hit = testKeyword("座位少了", config.keywordRules);
  assert.equal(hit.matched, false);
});

test("testKeyword reports unmatched text for AI fallback", () => {
  const config = sampleConfig();
  const hit = testKeyword("随便聊聊电影", config.keywordRules);
  assert.deepEqual(hit, { matched: false });
});

test("unauthenticated view state has no data", () => {
  const state = buildUnauthenticatedViewState();
  assert.equal(state.status, "UNAUTHENTICATED");
  assert.equal(state.version, null);
  assert.equal(state.templates.length, 0);
  assert.equal(state.rules.length, 0);
});
