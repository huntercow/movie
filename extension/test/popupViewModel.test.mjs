import assert from "node:assert/strict";
import test from "node:test";
import { createInitialPluginState } from "../src/handlers/pluginState.ts";
import { buildPopupViewState } from "../src/ui/popupViewModel.ts";

const replyConfig = {
  version: 1,
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

const idleHook = {
  checked: false,
  disabled: false,
  stateLabel: "已关闭",
  description: "关闭时不处理闲鱼页面消息，也不发起页面侧动作。",
  cue: "开启后自动开始工作"
};

test("initial logged-out state renders a standby view with a login prompt", () => {
  // 后端生产模式：初始为未登录，需先登录并同步后端配置。
  assert.deepEqual(buildPopupViewState(createInitialPluginState()), {
    visualState: "standby",
    stateLabel: "未登录",
    hook: idleHook,
    workNote: "请打开业务控制台登录后端"
  });
});

test("standby renders once local config is ready", () => {
  const view = buildPopupViewState(localState());
  assert.equal(view.visualState, "standby");
  assert.equal(view.stateLabel, "已暂停");
  assert.deepEqual(view.hook, idleHook);
  assert.equal(view.workNote, "开启页面 Hook 后自动开始工作");
});

test("active state requires hook enabled plus confirmed automation", () => {
  const active = buildPopupViewState(localState({ automationEnabled: true }), { hookEnabled: true });
  assert.equal(active.visualState, "active");
  assert.equal(active.stateLabel, "运行中");
  assert.equal(active.hook.checked, true);
  assert.equal(active.workNote, "自动回复、报价、付款校验与发货已开启");

  // hook 未开或后台未确认启用都不算 active。
  const hookOnly = buildPopupViewState(localState({ automationEnabled: false }), { hookEnabled: true });
  assert.equal(hookOnly.visualState, "standby");
  const autoOnly = buildPopupViewState(localState({ automationEnabled: true }), { hookEnabled: false });
  assert.equal(autoOnly.visualState, "standby");
});

test("safety pause and remote close block work with a specific note", () => {
  const unsafe = buildPopupViewState(localState({
    automationEnabled: false,
    safetyDisabled: true,
    remoteDisablePending: true
  }));
  assert.equal(unsafe.visualState, "standby");
  assert.equal(unsafe.stateLabel, "正在安全关闭");
  assert.equal(unsafe.workNote, "关闭确认后才可重新开启");
});

test("hook switch renders busy and independent notes", () => {
  const busy = buildPopupViewState(localState(), { busy: "HOOK", hookEnabled: true });
  assert.equal(busy.hook.checked, true);
  assert.equal(busy.hook.disabled, true);
  assert.equal(busy.hook.stateLabel, "正在更新…");
  assert.equal(busy.stateLabel, "正在更新…");
});

test("error message surfaces through the work note", () => {
  const view = buildPopupViewState(localState(), { errorMessage: "无法读取插件状态" });
  assert.equal(view.workNote, "无法读取插件状态");
});
