import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialPluginState,
  decodeStoredPluginState
} from "../src/handlers/pluginState.ts";

const templates = {
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
};

function authenticatedState(overrides = {}) {
  return {
    ...createInitialPluginState(),
    authStatus: "AUTHENTICATED",
    token: "TOKEN_SECRET",
    automationEnabled: false,
    automationRevision: 3,
    replyConfigVersion: 3,
    replyConfig: { version: 3, templates, keywordRules: [] },
    safetyDisabled: false,
    ...overrides
  };
}

test("initial state is logged out without a token or reply config", () => {
  const initial = createInitialPluginState();
  assert.deepEqual(initial, {
    schemaVersion: 1,
    token: null,
    authStatus: "LOGGED_OUT",
    automationEnabled: false,
    automationRevision: 1,
    replyConfigVersion: 1,
    replyConfig: null,
    safetyDisabled: false,
    remoteDisablePending: false,
    quoteRecoveries: [],
    diagnostics: { lastBackendFailure: null }
  });
  // 后端生产模式：token 与话术配置由登录/同步链路写入。
  assert.equal(initial.replyConfig, null);
});

test("decodes the final authenticated state with diagnostics", () => {
  const stored = {
    schemaVersion: 1,
    token: "TOKEN_SECRET",
    authStatus: "AUTHENTICATED",
    automationEnabled: true,
    automationRevision: 7,
    replyConfigVersion: 3,
    replyConfig: {
      version: 3,
      templates,
      keywordRules: [{
        id: "greeting", keywords: ["你好"], reply: "请发截图", enabled: true, priority: 10
      }]
    },
    safetyDisabled: false,
    remoteDisablePending: false,
    quoteRecoveries: [],
    diagnostics: {
      lastBackendFailure: {
        kind: "NETWORK",
        occurredAt: "2026-08-02T10:01:00+08:00"
      }
    }
  };

  assert.deepEqual(decodeStoredPluginState(stored), stored);
});

test("authenticated state requires a non-empty token", () => {
  assert.throws(() => decodeStoredPluginState({
    ...authenticatedState(),
    token: ""
  }), /token/);

  assert.throws(() => decodeStoredPluginState({
    ...authenticatedState(),
    token: null
  }), /token/);
});

test("allows a stale validated config only while safely disabled", () => {
  const stale = decodeStoredPluginState(authenticatedState({
    replyConfigVersion: 4,
    safetyDisabled: true
  }));
  assert.equal(stale.replyConfig.version, 3);
  assert.equal(stale.replyConfigVersion, 4);
});

test("rejects unsafe or internally inconsistent stored state", () => {
  // 暂停态(后端故障):automationEnabled 与 safetyDisabled 并存合法,
  // 但 automationEnabled 仍要求当前配置就绪。
  assert.throws(() => decodeStoredPluginState(authenticatedState({
    automationEnabled: true,
    replyConfigVersion: 4,
    safetyDisabled: true
  })), /current replyConfig/);

  const paused = decodeStoredPluginState(authenticatedState({
    automationEnabled: true,
    safetyDisabled: true
  }));
  assert.equal(paused.automationEnabled, true);
  assert.equal(paused.safetyDisabled, true);

  assert.throws(() => decodeStoredPluginState(authenticatedState({
    automationEnabled: true,
    replyConfigVersion: 4,
    safetyDisabled: false
  })), /current replyConfig/);

  assert.throws(() => decodeStoredPluginState({
    ...createInitialPluginState(),
    installationId: "INSTALLATION_001"
  }), /installationId|unknown/);
});

test("final state rejects removed device binding, editable backend, local AI, and claim fields", () => {
  for (const removedField of [
    "installationId",
    "xianyuAccountId",
    "backendBaseUrl",
    "aiConfig",
    "localKeywordRules",
    "quoteId",
    "deliveryClaim",
    "attemptId"
  ]) {
    assert.throws(() => decodeStoredPluginState({
      ...createInitialPluginState(),
      [removedField]: "forbidden"
    }), /unknown field/);
  }
});
