import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BackendApiError } from "../src/handlers/backendApi.ts";
import {
  AutomationLifecycle,
  LifecycleOperationError
} from "../src/handlers/automationLifecycle.ts";
import { createInitialPluginState } from "../src/handlers/pluginState.ts";

const fixture = JSON.parse(await readFile(new URL(
  "./fixtures/backend/plugin-api-responses.json",
  import.meta.url
), "utf8"));
const replyConfig = fixture.success.replyConfig.data;
const now = () => "2026-08-02T12:00:00+08:00";

function clone(value) {
  return structuredClone(value);
}

class MemoryRepository {
  constructor(initial = createInitialPluginState()) {
    this.value = clone(initial);
    this.history = [clone(initial)];
  }

  async load() {
    return clone(this.value);
  }

  async save(value) {
    this.value = clone(value);
    this.history.push(clone(value));
  }
}

function authenticatedState(overrides = {}) {
  return {
    ...createInitialPluginState(),
    token: "TOKEN_SECRET",
    authStatus: "AUTHENTICATED",
    automationEnabled: false,
    automationRevision: 1,
    replyConfigVersion: replyConfig.version,
    replyConfig,
    safetyDisabled: false,
    ...overrides
  };
}

function backendApi(overrides = {}) {
  return {
    sync: async () => ({
      automationEnabled: false,
      automationRevision: 1,
      replyConfigVersion: replyConfig.version
    }),
    updateAutomation: async (enabled) => ({
      automationEnabled: enabled,
      automationRevision: 2
    }),
    getReplyConfig: async () => replyConfig,
    ...overrides
  };
}

function lifecycleWith(options = {}) {
  const repository = options.repository ?? new MemoryRepository();
  const tokens = [];
  const api = options.api ?? backendApi();
  const lifecycle = new AutomationLifecycle({
    repository,
    apiFactory(token) {
      tokens.push(token);
      return api;
    },
    now
  });
  return { lifecycle, repository, tokens, api };
}

test("login rejects a stale remote enabled value by saving remote disabled", async () => {
  const updates = [];
  const api = backendApi({
    sync: async () => ({
      automationEnabled: true,
      automationRevision: 9,
      replyConfigVersion: replyConfig.version
    }),
    updateAutomation: async (enabled) => {
      updates.push(enabled);
      return { automationEnabled: false, automationRevision: 10 };
    }
  });
  const { lifecycle } = lifecycleWith({ api });

  const state = await lifecycle.login("TOKEN_SECRET", "0.1.0");

  assert.deepEqual(updates, [false]);
  assert.equal(state.automationEnabled, false);
  assert.equal(state.automationRevision, 10);
  assert.equal(state.safetyDisabled, false);
  assert.equal(state.remoteDisablePending, false);
});

test("a minute sync applies a newer explicit management enable only when cached config is ready", async () => {
  const repository = new MemoryRepository(authenticatedState({
    automationEnabled: false,
    automationRevision: 4,
    safetyDisabled: true
  }));
  const { lifecycle } = lifecycleWith({
    repository,
    api: backendApi({
      sync: async () => ({
        automationEnabled: true,
        automationRevision: 5,
        replyConfigVersion: replyConfig.version
      })
    })
  });

  const state = await lifecycle.synchronize("ALARM", "0.1.0");
  assert.equal(state.automationEnabled, true);
  assert.equal(state.automationRevision, 5);
  assert.equal(state.safetyDisabled, false);
});

test("network failure while active immediately safe-disables locally and retains the token", async () => {
  const repository = new MemoryRepository(authenticatedState({ automationEnabled: true }));
  const { lifecycle } = lifecycleWith({
    repository,
    api: backendApi({
      sync: async () => { throw new BackendApiError("NETWORK", "offline"); }
    })
  });

  const state = await lifecycle.synchronize("ALARM", "0.1.0");
  assert.equal(state.authStatus, "AUTHENTICATED");
  assert.equal(state.token, "TOKEN_SECRET");
  assert.equal(state.automationEnabled, true);
  assert.equal(state.safetyDisabled, true);
  assert.equal(state.remoteDisablePending, false);
  assert.deepEqual(state.diagnostics.lastBackendFailure, {
    kind: "NETWORK",
    occurredAt: now()
  });
});

test("an active backend operation failure pauses locally without touching remote automation", async () => {
  const networkRepository = new MemoryRepository(authenticatedState({ automationEnabled: true }));
  const networkLifecycle = lifecycleWith({ repository: networkRepository }).lifecycle;
  const disabled = await networkLifecycle.handleBackendFailure(
    new BackendApiError("NETWORK", "offline")
  );
  assert.equal(disabled.authStatus, "AUTHENTICATED");
  // 后端故障只本地暂停:automationEnabled 保持用户期望,远端不受影响,
  // 后端恢复后下一次同步自动解除暂停(safetyDisabled → false)。
  assert.equal(disabled.automationEnabled, true);
  assert.equal(disabled.safetyDisabled, true);
  assert.equal(disabled.remoteDisablePending, false);
});

test("a new config version stops locally before fetching and never restores automation automatically", async () => {
  const repository = new MemoryRepository(authenticatedState({ automationEnabled: true }));
  const observations = [];
  const api = backendApi({
    sync: async () => ({
      automationEnabled: true,
      automationRevision: 1,
      replyConfigVersion: 4
    }),
    getReplyConfig: async () => {
      observations.push(await repository.load());
      return { ...replyConfig, version: 4 };
    },
    updateAutomation: async (enabled) => {
      observations.push({ updateEnabled: enabled, state: await repository.load() });
      return { automationEnabled: false, automationRevision: 2 };
    }
  });
  const { lifecycle } = lifecycleWith({ repository, api });

  const state = await lifecycle.synchronize("ALARM", "0.1.0");

  assert.equal(observations[0].automationEnabled, false);
  assert.equal(observations[0].safetyDisabled, true);
  assert.deepEqual(observations[0].replyConfig, replyConfig);
  assert.equal(observations[0].replyConfigVersion, 4);
  assert.equal(observations[1].updateEnabled, false);
  assert.equal(observations[1].state.automationEnabled, false);
  assert.equal(state.replyConfig.version, 4);
  assert.equal(state.automationEnabled, false);
  assert.equal(state.safetyDisabled, false);
});

test("configuration validation failure keeps safe-disabled and confirms remote disabled when reachable", async () => {
  const repository = new MemoryRepository(authenticatedState({ automationEnabled: true }));
  const updates = [];
  const { lifecycle } = lifecycleWith({
    repository,
    api: backendApi({
      sync: async () => ({
        automationEnabled: true,
        automationRevision: 1,
        replyConfigVersion: 4
      }),
      getReplyConfig: async () => { throw new BackendApiError("PROTOCOL", "bad config"); },
      updateAutomation: async (enabled) => {
        updates.push(enabled);
        return { automationEnabled: false, automationRevision: 2 };
      }
    })
  });

  const state = await lifecycle.synchronize("ALARM", "0.1.0");
  assert.deepEqual(updates, [false]);
  assert.deepEqual(state.replyConfig, replyConfig);
  assert.equal(state.replyConfigVersion, 4);
  assert.equal(state.automationEnabled, false);
  assert.equal(state.safetyDisabled, true);
  assert.equal(state.remoteDisablePending, false);
  assert.equal(state.diagnostics.lastBackendFailure.kind, "PROTOCOL");
});

test("explicit enable is rejected without current config and is applied only after backend confirmation", async () => {
  const missingRepository = new MemoryRepository(authenticatedState({ replyConfig: null }));
  let missingCalled = false;
  const missingLifecycle = lifecycleWith({
    repository: missingRepository,
    api: backendApi({
      updateAutomation: async () => {
        missingCalled = true;
        return { automationEnabled: true, automationRevision: 2 };
      }
    })
  }).lifecycle;
  await assert.rejects(
    missingLifecycle.setAutomation(true),
    (error) => error instanceof LifecycleOperationError && error.code === "CONFIG_NOT_READY"
  );
  assert.equal(missingCalled, false);

  const repository = new MemoryRepository(authenticatedState({ safetyDisabled: true }));
  let resolveUpdate;
  const updatePromise = new Promise((resolve) => { resolveUpdate = resolve; });
  const lifecycle = lifecycleWith({
    repository,
    api: backendApi({ updateAutomation: async () => updatePromise })
  }).lifecycle;
  const enabling = lifecycle.setAutomation(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await repository.load()).automationEnabled, false);

  resolveUpdate({ automationEnabled: true, automationRevision: 2 });
  const enabled = await enabling;
  assert.equal(enabled.automationEnabled, true);
  assert.equal(enabled.safetyDisabled, false);
});

test("explicit disable stops locally before requesting the backend", async () => {
  const repository = new MemoryRepository(authenticatedState({ automationEnabled: true }));
  let observed;
  const { lifecycle } = lifecycleWith({
    repository,
    api: backendApi({
      updateAutomation: async (enabled) => {
        observed = { enabled, state: await repository.load() };
        return { automationEnabled: false, automationRevision: 2 };
      }
    })
  });

  const state = await lifecycle.setAutomation(false);
  assert.equal(observed.enabled, false);
  assert.equal(observed.state.automationEnabled, false);
  assert.equal(observed.state.remoteDisablePending, true);
  assert.equal(state.automationEnabled, false);
  assert.equal(state.remoteDisablePending, false);
});

test("config recovery with the old remote revision stays disabled until a new explicit revision", async () => {
  const repository = new MemoryRepository(authenticatedState({
    automationEnabled: false,
    automationRevision: 5,
    replyConfig: null,
    safetyDisabled: true
  }));
  const { lifecycle } = lifecycleWith({
    repository,
    api: backendApi({
      sync: async () => ({
        automationEnabled: true,
        automationRevision: 5,
        replyConfigVersion: replyConfig.version
      }),
      updateAutomation: async () => ({ automationEnabled: false, automationRevision: 6 })
    })
  });

  const recovered = await lifecycle.synchronize("NETWORK_RESTORED", "0.1.0");
  assert.deepEqual(recovered.replyConfig, replyConfig);
  assert.equal(recovered.automationEnabled, false);
  assert.equal(recovered.safetyDisabled, false);
});

test("execution permits block new work after close but allow only in-flight write settlement", async () => {
  const repository = new MemoryRepository(authenticatedState({ automationEnabled: true }));
  const { lifecycle } = lifecycleWith({ repository });

  assert.deepEqual(await lifecycle.getExecutionState(), {
    canExecute: true,
    automationRevision: 1
  });
  const readPermit = await lifecycle.authorizeAction("READ");
  const writePermit = await lifecycle.authorizeAction("WRITE");
  assert.deepEqual(await lifecycle.classifyActionCompletion(readPermit), "CONTINUE");

  repository.value = authenticatedState({
    automationEnabled: false,
    safetyDisabled: false,
    automationRevision: 2
  });
  assert.deepEqual(await lifecycle.getExecutionState(), {
    canExecute: false,
    automationRevision: 2
  });
  assert.equal(await lifecycle.authorizeAction("READ"), null);
  assert.equal(await lifecycle.classifyActionCompletion(readPermit), "DISCARD");
  assert.equal(await lifecycle.classifyActionCompletion(writePermit), "SETTLE_ONLY");
});

test("parallel lifecycle operations are serialized", async () => {
  const repository = new MemoryRepository(authenticatedState({ safetyDisabled: true }));
  const calls = [];
  let resolveEnable;
  const enableResponse = new Promise((resolve) => { resolveEnable = resolve; });
  const { lifecycle } = lifecycleWith({
    repository,
    api: backendApi({
      updateAutomation: async (enabled) => {
        calls.push(enabled);
        if (enabled) return enableResponse;
        return { automationEnabled: false, automationRevision: 3 };
      }
    })
  });

  const enable = lifecycle.setAutomation(true);
  const disable = lifecycle.setAutomation(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [true]);
  resolveEnable({ automationEnabled: true, automationRevision: 2 });
  await Promise.all([enable, disable]);
  assert.deepEqual(calls, [true, false]);
  assert.equal((await repository.load()).automationEnabled, false);
});
