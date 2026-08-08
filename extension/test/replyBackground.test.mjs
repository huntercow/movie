import assert from "node:assert/strict";
import test from "node:test";
import { BackendApiError } from "../src/handlers/backendApi.ts";
import { ReplyBackgroundController } from "../src/handlers/replyBackground.ts";

const replyConfig = {
  version: 3,
  templates: {
    edit_price_success: "改价成功",
    payment_successful: "付款成功",
    no_quote_record: "没有报价",
    text_message_replay: "流程说明",
    identify_wait: "正在识别",
    identify_fail: "识别失败",
    identify_success: "报价成功",
    show_time_too_short: "时间太近",
    cancel_ticket: "已取消",
    send_ticket_success: "取票码：[取票码]",
  },
  keywordRules: []
};

function state(overrides = {}) {
  return {
    token: "TOKEN_SECRET",
    authStatus: "AUTHENTICATED",
    automationEnabled: true,
    automationRevision: 8,
    replyConfigVersion: 3,
    replyConfig,
    safetyDisabled: false,
    remoteDisablePending: false,
    ...overrides
  };
}

function setup(overrides = {}) {
  const calls = [];
  const lifecycle = {
    getState: async () => state(),
    getExecutionState: async () => ({ canExecute: true, automationRevision: 8 }),
    authorizeAction: async () => ({ effect: "READ", automationRevision: 8 }),
    classifyActionCompletion: async () => "CONTINUE",
    handleBackendFailure: async (error) => { calls.push(["failure", error]); },
    ...overrides.lifecycle
  };
  const api = {
    getAiReply: async (request) => {
      calls.push(["ai", request]);
      return { reply: "AI 回复" };
    },
    getReplyConfig: async () => {
      calls.push(["reply-config", "local"]);
      return replyConfig;
    },
    ...overrides.api
  };
  const tokens = [];
  const controller = new ReplyBackgroundController({
    lifecycle,
    apiFactory(token) {
      tokens.push(token);
      return api;
    }
  });
  return { controller, lifecycle, api, calls, tokens };
}

test("exposes only the current cached config and the unified execution state", async () => {
  const { controller } = setup();
  assert.deepEqual(await controller.getReplyConfig(), replyConfig);
  assert.deepEqual(await controller.getAutomationConfig(), {
    autoReply: true,
    xianyuDeliverSendImageEnabled: true
  });

  // 本地驱动：state 缓存未就绪时兜底从本地加载器拉取，不抛错。
  const stale = setup({
    lifecycle: { getState: async () => state({ replyConfigVersion: 4 }) }
  });
  assert.deepEqual(await stale.controller.getReplyConfig(), replyConfig);
  assert.deepEqual(stale.tokens, ["local"]);
  assert.deepEqual(stale.calls, [["reply-config", "local"]]);
});

test("AI uses the authenticated backend client and exact final request", async () => {
  const { controller, calls, tokens } = setup();
  const request = {
    messageId: "MSG_001",
    chatId: "CHAT_001",
    buyerUserId: "BUYER_001",
    itemId: "ITEM_001",
    content: "几点开场"
  };

  assert.deepEqual(await controller.getAiReply(request), { reply: "AI 回复" });
  assert.deepEqual(tokens, ["TOKEN_SECRET"]);
  assert.deepEqual(calls, [["ai", request]]);
});

test("AI is silent when automation is off before the call or closes while in flight", async () => {
  const off = setup({ lifecycle: { authorizeAction: async () => null } });
  assert.deepEqual(await off.controller.getAiReply({
    messageId: "MSG_001",
    chatId: "CHAT_001",
    buyerUserId: "BUYER_001",
    itemId: "ITEM_001",
    content: "几点开场"
  }), { reply: null });
  assert.deepEqual(off.tokens, []);

  const closedBeforeRequest = setup({
    lifecycle: {
      getState: async () => state({
        automationEnabled: false,
        safetyDisabled: true,
        remoteDisablePending: true
      })
    }
  });
  assert.deepEqual(await closedBeforeRequest.controller.getAiReply({
    messageId: "MSG_LOCAL_CLOSE",
    chatId: "CHAT_001",
    buyerUserId: "BUYER_001",
    itemId: "ITEM_001",
    content: "几点开场"
  }), { reply: null });
  assert.deepEqual(closedBeforeRequest.tokens, []);

  const closed = setup({
    lifecycle: { classifyActionCompletion: async () => "DISCARD" }
  });
  assert.deepEqual(await closed.controller.getAiReply({
    messageId: "MSG_002",
    chatId: "CHAT_001",
    buyerUserId: "BUYER_001",
    itemId: "ITEM_001",
    content: "几点开场"
  }), { reply: null });
});

test("backend AI failures enter the global lifecycle failure path", async () => {
  const failure = new BackendApiError("NETWORK", "offline");
  const { controller, calls } = setup({
    api: { getAiReply: async () => { throw failure; } }
  });

  await assert.rejects(controller.getAiReply({
    messageId: "MSG_001",
    chatId: "CHAT_001",
    buyerUserId: "BUYER_001",
    itemId: "ITEM_001",
    content: "几点开场"
  }), failure);
  assert.deepEqual(calls, [["failure", failure]]);
});
