import assert from "node:assert/strict";
import test from "node:test";
import { PopupController } from "../src/ui/popupController.ts";
import { createInitialPluginState } from "../src/handlers/pluginState.ts";
import { createDefaultHookSettings } from "../src/handlers/hookState.ts";

const replyConfig = {
  version: 1,
  templates: {
    edit_price_success: "改价", payment_successful: "付款", no_quote_record: "无报价", text_message_replay: "回复",
    identify_wait: "正在识别", identify_fail: "识别失败", identify_success: "报价成功",
    show_time_too_short: "时间太近", cancel_ticket: "已取消", send_ticket_success: "出票",
  },
  keywordRules: []
};

function localState(overrides = {}) {
  return {
    ...createInitialPluginState(),
    authStatus: "AUTHENTICATED",
    token: "TOKEN_SECRET",
    automationRevision: 1,
    replyConfigVersion: 1,
    replyConfig,
    ...overrides
  };
}

class FakeView {
  constructor() {
    this.renders = [];
  }
  render(value) {
    this.renders.push(structuredClone(value));
  }
}

function runtime(responses) {
  const calls = [];
  return {
    calls,
    async request(message) {
      calls.push(structuredClone(message));
      if (message.type === "GET_HOOK_SETTINGS") {
        return createDefaultHookSettings();
      }
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return structuredClone(response);
    }
  };
}

test("initialize uses only local lifecycle and hook messages", async () => {
  const view = new FakeView();
  const transport = runtime([localState()]);
  const controller = new PopupController({ view, runtime: transport, openIm: async () => {} });

  await controller.initialize();

  assert.deepEqual(transport.calls, [
    { type: "PLUGIN_GET_STATE" },
    { type: "GET_HOOK_SETTINGS" }
  ]);
  assert.equal(view.renders.at(-1).visualState, "standby");
});

test("hook switch uses only local hook messages and stays busy until confirmed", async () => {
  const view = new FakeView();
  let resolveHook;
  const hookResponse = new Promise((resolve) => { resolveHook = resolve; });
  const transport = {
    calls: [],
    async request(message) {
      this.calls.push(structuredClone(message));
      if (message.type === "PLUGIN_GET_STATE") return localState();
      if (message.type === "GET_HOOK_SETTINGS") return createDefaultHookSettings();
      if (message.type === "SET_HOOK_ENABLED") return hookResponse;
      throw new Error("unexpected request");
    }
  };
  const controller = new PopupController({ view, runtime: transport, openIm: async () => {} });
  await controller.initialize();
  const toggling = controller.toggleHook();
  await new Promise((resolve) => setImmediate(resolve));

  const pending = view.renders.at(-1);
  assert.equal(pending.hook.checked, true);
  assert.equal(pending.hook.disabled, true);
  assert.equal(pending.hook.stateLabel, "正在更新…");

  resolveHook({ schemaVersion: 1, enabled: true });
  await toggling;
  assert.equal(view.renders.at(-1).hook.checked, true);
  assert.equal(view.renders.at(-1).hook.stateLabel, "已开启");
  assert.deepEqual(transport.calls.at(-1), {
    type: "SET_HOOK_ENABLED", data: { enabled: true }
  });
});

test("failed hook update refreshes hook state and reports the error", async () => {
  const view = new FakeView();
  const transport = runtime([
    localState(),
    new Error("hook update rejected"),
    createDefaultHookSettings()
  ]);
  const controller = new PopupController({ view, runtime: transport, openIm: async () => {} });
  await controller.initialize();
  await controller.toggleHook();

  assert.equal(view.renders.at(-1).hook.checked, false);
  assert.match(view.renders.at(-1).workNote, /Hook 开关未更新/);
});

test("refresh reloads authoritative state after a storage change", async () => {
  const view = new FakeView();
  const transport = runtime([localState(), localState({ automationEnabled: true })]);
  const controller = new PopupController({ view, runtime: transport, openIm: async () => {} });
  await controller.initialize();
  await controller.refresh();
  assert.equal(view.renders.at(-1).stateLabel, "已暂停");
});

test("open IM delegates only to the navigator", async () => {
  const view = new FakeView();
  const transport = runtime([localState()]);
  let opens = 0;
  const controller = new PopupController({
    view,
    runtime: transport,
    openIm: async () => { opens += 1; }
  });
  await controller.initialize();
  await controller.openXianyuIm();
  assert.equal(opens, 1);
  assert.deepEqual(transport.calls, [
    { type: "PLUGIN_GET_STATE" },
    { type: "GET_HOOK_SETTINGS" }
  ]);
});

test("open IM failure gives a direct recovery message in the work note", async () => {
  const view = new FakeView();
  const transport = runtime([localState()]);
  const controller = new PopupController({
    view,
    runtime: transport,
    openIm: async () => { throw new Error("tabs unavailable"); }
  });
  await controller.initialize();
  await controller.openXianyuIm();
  assert.equal(view.renders.at(-1).workNote, "无法打开闲鱼 IM，请手动访问闲鱼消息页面。");
});
