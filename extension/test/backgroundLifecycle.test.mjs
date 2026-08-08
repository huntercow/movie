import assert from "node:assert/strict";
import test from "node:test";
import {
  PLUGIN_STATE_STORAGE_KEY,
  PLUGIN_SYNC_ALARM,
  createChromePluginStateRepository,
  handleAutomationLifecycleRequest,
  registerAutomationLifecycleEvents
} from "../src/handlers/backgroundLifecycle.ts";
import { createInitialPluginState } from "../src/handlers/pluginState.ts";

function event() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) { listeners.push(listener); }
  };
}

function fakeChrome() {
  const storage = {};
  return {
    storageData: storage,
    runtime: {
      onInstalled: event(),
      onStartup: event(),
      getManifest: () => ({ version: "0.1.0" })
    },
    alarms: {
      created: [],
      existing: new Set(),
      onAlarm: event(),
      async get(name) { return this.existing.has(name) ? { name } : undefined; },
      create(name, options) {
        this.created.push([name, options]);
        this.existing.add(name);
      }
    },
    storage: {
      local: {
        async get(key) { return { [key]: storage[key] }; },
        async set(value) { Object.assign(storage, structuredClone(value)); }
      }
    }
  };
}

test("Chrome repository initializes and strictly round-trips the single final state object", async () => {
  const chromeApi = fakeChrome();
  const repository = createChromePluginStateRepository(chromeApi);
  assert.deepEqual(await repository.load(), createInitialPluginState());
  assert.deepEqual(chromeApi.storageData[PLUGIN_STATE_STORAGE_KEY], createInitialPluginState());

  // 后端已登录态：开自动化 + 就绪配置也必须严格 round-trip。
  const stored = {
    ...createInitialPluginState(),
    token: "TOKEN_ABC",
    authStatus: "AUTHENTICATED",
    automationEnabled: true,
    automationRevision: 2,
    replyConfig: {
      version: 1,
      templates: {
        edit_price_success: "改价", payment_successful: "付款", no_quote_record: "无报价",
        text_message_replay: "回复",
        identify_wait: "正在识别",
        identify_fail: "识别失败",
        identify_success: "报价成功",
        show_time_too_short: "时间太近",
        cancel_ticket: "已取消",
        send_ticket_success: "取票码：[取票码]",
      },
      keywordRules: []
    }
  };
  await repository.save(stored);
  assert.deepEqual(await repository.load(), stored);

  chromeApi.storageData[PLUGIN_STATE_STORAGE_KEY] = {
    ...stored,
    installationId: "INSTALLATION_001"
  };
  await assert.rejects(repository.load(), /unknown field installationId/);
});

test("stored authenticated state without reply config is preserved on load", async () => {
  const chromeApi = fakeChrome();
  const repository = createChromePluginStateRepository(chromeApi);
  // 后端已登录但配置尚未拉取（replyConfig: null）：原样保留，
  // 配置就绪由登录/同步链路负责，仓库不做本地迁移。
  chromeApi.storageData[PLUGIN_STATE_STORAGE_KEY] = {
    schemaVersion: 1,
    token: "TOKEN_ABC",
    authStatus: "AUTHENTICATED",
    automationEnabled: false,
    automationRevision: 1,
    replyConfigVersion: 1,
    replyConfig: null,
    safetyDisabled: false,
    remoteDisablePending: false,
    quoteRecoveries: [],
    diagnostics: { lastBackendFailure: null }
  };

  const loaded = await repository.load();
  assert.equal(loaded.authStatus, "AUTHENTICATED");
  assert.equal(loaded.token, "TOKEN_ABC");
  assert.equal(loaded.replyConfig, null);
  assert.deepEqual(chromeApi.storageData[PLUGIN_STATE_STORAGE_KEY], loaded);
});

test("stored logged-out state stays logged out on load", async () => {
  const chromeApi = fakeChrome();
  const repository = createChromePluginStateRepository(chromeApi);
  // 后端未登录状态：不迁移、不补 token 与本地配置。
  chromeApi.storageData[PLUGIN_STATE_STORAGE_KEY] = {
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
  };

  const loaded = await repository.load();
  assert.equal(loaded.authStatus, "LOGGED_OUT");
  assert.equal(loaded.token, null);
  assert.equal(loaded.replyConfig, null);
  assert.deepEqual(chromeApi.storageData[PLUGIN_STATE_STORAGE_KEY], loaded);
});

test("stored stale reply config version is preserved until the backend sync replaces it", async () => {
  const chromeApi = fakeChrome();
  const repository = createChromePluginStateRepository(chromeApi);
  // 后端已登录但话术版本与后端不同：仓库原样保留，由同步链路拉新配置。
  chromeApi.storageData[PLUGIN_STATE_STORAGE_KEY] = {
    ...createInitialPluginState(),
    token: "TOKEN_ABC",
    authStatus: "AUTHENTICATED",
    replyConfigVersion: 3,
    replyConfig: {
      version: 3,
      templates: {
        edit_price_success: "x", payment_successful: "x", no_quote_record: "x", text_message_replay: "x",
        identify_wait: "x", identify_fail: "x", identify_success: "x",
        show_time_too_short: "x", cancel_ticket: "x", send_ticket_success: "x",
      },
      keywordRules: []
    }
  };

  const loaded = await repository.load();
  assert.equal(loaded.replyConfigVersion, 3);
  assert.equal(loaded.replyConfig.version, 3);
});

test("background registers a reliable one-minute sync for install, startup, alarm, and network recovery", async () => {
  const chromeApi = fakeChrome();
  const networkEvents = event();
  const calls = [];
  const lifecycle = {
    async synchronize(trigger, clientVersion) {
      calls.push([trigger, clientVersion]);
    }
  };

  registerAutomationLifecycleEvents({ chromeApi, networkEvents, lifecycle });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(chromeApi.alarms.created, [[PLUGIN_SYNC_ALARM, { periodInMinutes: 1 }]]);

  chromeApi.runtime.onInstalled.listeners[0]();
  chromeApi.runtime.onStartup.listeners[0]();
  chromeApi.alarms.onAlarm.listeners[0]({ name: "unrelated" });
  chromeApi.alarms.onAlarm.listeners[0]({ name: PLUGIN_SYNC_ALARM });
  networkEvents.listeners[0]();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, [
    ["INSTALLED", "0.1.0"],
    ["STARTUP", "0.1.0"],
    ["ALARM", "0.1.0"],
    ["NETWORK_RESTORED", "0.1.0"]
  ]);

  registerAutomationLifecycleEvents({ chromeApi, networkEvents: event(), lifecycle });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(chromeApi.alarms.created.length, 1);
});

test("runtime lifecycle messages expose login, shared automation, logout, and execution settlement only", async () => {
  const calls = [];
  const lifecycle = {
    login: async (token, version) => { calls.push(["login", token, version]); return { authStatus: "AUTHENTICATED" }; },
    getState: async () => { calls.push(["state"]); return { authStatus: "AUTHENTICATED" }; },
    setAutomation: async (enabled) => { calls.push(["automation", enabled]); return { automationEnabled: enabled }; },
    logout: async () => { calls.push(["logout"]); return { authStatus: "LOGGED_OUT" }; },
    getExecutionState: async () => { calls.push(["execution"]); return { canExecute: false, automationRevision: 1 }; },
    authorizeAction: async (effect) => { calls.push(["authorize", effect]); return { effect, automationRevision: 1 }; },
    classifyActionCompletion: async (permit) => { calls.push(["complete", permit]); return "SETTLE_ONLY"; }
  };

  assert.deepEqual(await handleAutomationLifecycleRequest(lifecycle, "0.1.0", {
    type: "PLUGIN_LOGIN", data: { token: "TOKEN_SECRET" }
  }), { authStatus: "AUTHENTICATED" });
  assert.deepEqual(await handleAutomationLifecycleRequest(lifecycle, "0.1.0", {
    type: "PLUGIN_GET_STATE"
  }), { authStatus: "AUTHENTICATED" });
  assert.deepEqual(await handleAutomationLifecycleRequest(lifecycle, "0.1.0", {
    type: "PLUGIN_SET_AUTOMATION", data: { enabled: true }
  }), { automationEnabled: true });
  await handleAutomationLifecycleRequest(lifecycle, "0.1.0", { type: "PLUGIN_LOGOUT" });
  assert.deepEqual(await handleAutomationLifecycleRequest(lifecycle, "0.1.0", {
    type: "PLUGIN_GET_EXECUTION_STATE"
  }), { canExecute: false, automationRevision: 1 });
  const permit = await handleAutomationLifecycleRequest(lifecycle, "0.1.0", {
    type: "PLUGIN_AUTHORIZE_ACTION", data: { effect: "WRITE" }
  });
  assert.deepEqual(await handleAutomationLifecycleRequest(lifecycle, "0.1.0", {
    type: "PLUGIN_CLASSIFY_ACTION_COMPLETION", data: { permit }
  }), "SETTLE_ONLY");

  assert.deepEqual(calls, [
    ["login", "TOKEN_SECRET", "0.1.0"],
    ["state"],
    ["automation", true],
    ["logout"],
    ["execution"],
    ["authorize", "WRITE"],
    ["complete", { effect: "WRITE", automationRevision: 1 }]
  ]);
  await assert.rejects(handleAutomationLifecycleRequest(lifecycle, "0.1.0", {
    type: "PLUGIN_LOGIN", data: { token: "" }
  }), /token/);
  await assert.rejects(handleAutomationLifecycleRequest(lifecycle, "0.1.0", {
    type: "PLUGIN_AUTHORIZE_ACTION", data: { effect: "DELETE" }
  }), /effect/);
});
