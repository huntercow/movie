import assert from "node:assert/strict";
import test from "node:test";
import {
  decideTextReply,
  deliverTextSegmentsWithRetry,
  matchKeywordRule,
  renderReplyTemplate,
  writeOpenWebSocket
} from "../src/handlers/replyAutomation.ts";

const templates = {
  identify_success:
    "[订单号]|[城市]|[影院地址]|[影院名]|[影厅名]|[影片名]|[放映时间]|[座位信息]|[单座位报价]|[整单报价]",
  edit_price_success: "[订单号]|[城市]|[影院名]",
  payment_successful: "[订单号]",
  no_quote_record: "没有报价",
  text_message_replay: "不应自动发送",
  identify_wait: "正在识别",
  identify_fail: "识别失败",
  identify_success:
    "[订单号]|[城市]|[影院地址]|[影院名]|[影厅名]|[影片名]|[放映时间]|[座位信息]|[单座位报价]|[整单报价]",
  show_time_too_short: "时间太近",
  cancel_ticket: "[订单号]",
  send_ticket_success: "[订单号]|[取票码]",
};

function config(keywordRules = []) {
  return { version: 7, templates, keywordRules };
}

test("renders only the business order id and formats quote placeholders before stable splitting", () => {
  const segments = renderReplyTemplate("identify_success", config(), {
    businessOrderId: "BUSINESS_ORDER_001",
    cityName: "上海",
    cinemaAddress: "南京西路 1 号",
    cinemaName: "银幕影院",
    hallName: "1 号厅",
    filmName: "测试电影",
    showTime: "2026-08-02T20:05:00+08:00",
    seats: ["5排6座", "5排7座"],
    biddingPrice: 12.5,
    amount: 25,
    xianyuOrderId: "XIANYU_ORDER_999",
    tradeNo: "TRADE_999"
  });

  assert.deepEqual(segments, [
    "BUSINESS_ORDER_001|上海|南京西路 1 号|银幕影院|1 号厅|测试电影|2026-08-02 20:05|5排6座,5排7座|12.5|25"
  ]);
  assert.equal(segments[0].includes("XIANYU_ORDER_999"), false);
  assert.equal(segments[0].includes("TRADE_999"), false);
});

test("template rendering fails when a used event value is unavailable", () => {
  assert.throws(
    () => renderReplyTemplate("payment_successful", config()),
    /businessOrderId/
  );
});

test("keyword matching is case-insensitive, enabled-only, highest-priority, and stable on ties", () => {
  const rules = [
    { id: "disabled", keywords: ["HELLO"], reply: "disabled", enabled: false, priority: 99 },
    { id: "low", keywords: ["hello"], reply: "low", enabled: true, priority: 1 },
    { id: "first-high", keywords: ["ELLO"], reply: "first", enabled: true, priority: 10 },
    { id: "second-high", keywords: ["hello"], reply: "second", enabled: true, priority: 10 }
  ];

  assert.equal(matchKeywordRule("HeLLo there", rules)?.id, "first-high");
  assert.equal(matchKeywordRule("unmatched", rules), null);
});

test("ordinary text chooses keyword before AI and never invokes text_message_replay", async () => {
  let aiCalls = 0;
  const decision = await decideTextReply({
    event: {
      messageId: "MSG_001",
      chatId: "CHAT_001",
      buyerUserId: "BUYER_001",
      itemId: "ITEM_001",
      content: "HELLO"
    },
    config: config([
      { id: "hello", keywords: ["hello"], reply: "关键词回复", enabled: true, priority: 1 }
    ]),
    canExecute: async () => true,
    getAiReply: async () => {
      aiCalls += 1;
      return { reply: "AI 回复" };
    }
  });

  assert.deepEqual(decision, { kind: "KEYWORD", reply: "关键词回复", ruleId: "hello" });
  assert.equal(aiCalls, 0);
});

test("AI disabled, empty result, and provider failure fixtures are all silent null decisions", async () => {
  for (const reason of ["DISABLED", "NO_REPLY", "PROVIDER_FAILED"]) {
    const decision = await decideTextReply({
      event: {
        messageId: `MSG_${reason}`,
        chatId: "CHAT_001",
        buyerUserId: "BUYER_001",
        itemId: "ITEM_001",
        content: "几点开场"
      },
      config: config(),
      canExecute: async () => true,
      getAiReply: async () => ({ reply: null })
    });
    assert.deepEqual(decision, { kind: "SILENT" }, reason);
  }
});

test("automation off prevents keyword matching, AI calls, and sends", async () => {
  let aiCalls = 0;
  const decision = await decideTextReply({
    event: {
      messageId: "MSG_001",
      chatId: "CHAT_001",
      buyerUserId: "BUYER_001",
      itemId: "ITEM_001",
      content: "hello"
    },
    config: config([
      { id: "hello", keywords: ["hello"], reply: "关键词回复", enabled: true, priority: 1 }
    ]),
    canExecute: async () => false,
    getAiReply: async () => {
      aiCalls += 1;
      return { reply: "AI 回复" };
    }
  });
  assert.deepEqual(decision, { kind: "AUTOMATION_OFF" });
  assert.equal(aiCalls, 0);

  let sends = 0;
  const delivery = await deliverTextSegmentsWithRetry({
    segments: ["不会发送"],
    canExecute: async () => false,
    send: async () => {
      sends += 1;
      return true;
    },
    wait: async () => {}
  });
  assert.deepEqual(delivery, {
    success: false,
    sentSegmentCount: 0,
    stoppedByAutomation: true
  });
  assert.equal(sends, 0);
});

test("text retry continues only the failed current segment", async () => {
  const calls = [];
  const waits = [];
  let secondAttempts = 0;
  const result = await deliverTextSegmentsWithRetry({
    segments: ["第一段", "第二段"],
    canExecute: async () => true,
    send: async (segment) => {
      calls.push(segment);
      if (segment === "第二段") {
        secondAttempts += 1;
        return secondAttempts >= 3;
      }
      return true;
    },
    wait: async (milliseconds) => { waits.push(milliseconds); }
  });

  assert.deepEqual(calls, ["第一段", "第二段", "第二段", "第二段"]);
  assert.deepEqual(waits, [1_000, 1_000]);
  assert.deepEqual(result, {
    success: true,
    sentSegmentCount: 2,
    stoppedByAutomation: false
  });
});

test("text retry performs at most three retries and stops if automation closes during a wait", async () => {
  let attempts = 0;
  const exhausted = await deliverTextSegmentsWithRetry({
    segments: ["失败消息"],
    canExecute: async () => true,
    send: async () => {
      attempts += 1;
      return false;
    },
    wait: async () => {}
  });
  assert.equal(attempts, 4);
  assert.deepEqual(exhausted, {
    success: false,
    sentSegmentCount: 0,
    stoppedByAutomation: false
  });

  let enabled = true;
  attempts = 0;
  const stopped = await deliverTextSegmentsWithRetry({
    segments: ["关闭后不重试"],
    canExecute: async () => enabled,
    send: async () => {
      attempts += 1;
      return false;
    },
    wait: async () => { enabled = false; }
  });
  assert.equal(attempts, 1);
  assert.equal(stopped.stoppedByAutomation, true);
});

test("WebSocket write succeeds only while OPEN and send does not throw", () => {
  const payloads = [];
  assert.equal(writeOpenWebSocket(null, "payload"), false);
  assert.equal(writeOpenWebSocket({ readyState: 0, send() {} }, "payload"), false);
  assert.equal(writeOpenWebSocket({
    readyState: 1,
    send(payload) { payloads.push(payload); }
  }, "payload"), true);
  assert.deepEqual(payloads, ["payload"]);
  assert.equal(writeOpenWebSocket({
    readyState: 1,
    send() { throw new Error("socket closed"); }
  }, "payload"), false);
});
