import {
  type ActiveActionEffect,
  type ActiveActionPermit,
  type AutomationLifecycle,
  type LifecycleSyncTrigger,
  type PluginStateRepository
} from "./automationLifecycle.ts";
import {
  createInitialPluginState,
  decodeStoredPluginState,
  type StoredPluginState
} from "./pluginState.ts";

export const PLUGIN_STATE_STORAGE_KEY = "pluginRuntimeStateV1";
export const PLUGIN_SYNC_ALARM = "plugin-runtime-sync";

export type AutomationLifecycleRequest =
  | { type: "PLUGIN_LOGIN"; data: { token: string } }
  | { type: "PLUGIN_GET_STATE" }
  | { type: "PLUGIN_SET_AUTOMATION"; data: { enabled: boolean } }
  | { type: "PLUGIN_LOGOUT" }
  | { type: "PLUGIN_GET_EXECUTION_STATE" }
  | { type: "PLUGIN_AUTHORIZE_ACTION"; data: { effect: ActiveActionEffect } }
  | {
      type: "PLUGIN_CLASSIFY_ACTION_COMPLETION";
      data: { permit: ActiveActionPermit };
    };

interface ChromeStorageLocal {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}

interface ChromeForRepository {
  storage: { local: ChromeStorageLocal };
}

interface ChromeEvent<T extends (...args: never[]) => unknown> {
  addListener(listener: T): void;
}

interface ChromeForLifecycleEvents {
  runtime: {
    onInstalled: ChromeEvent<() => void>;
    onStartup: ChromeEvent<() => void>;
    getManifest(): { version: string };
  };
  alarms: {
    get(name: string): Promise<{ name: string } | undefined>;
    create(name: string, options: { periodInMinutes: number }): void;
    onAlarm: ChromeEvent<(alarm: { name: string }) => void>;
  };
}

interface NetworkEvents {
  addListener(listener: () => void): void;
}

interface LifecycleEventTarget {
  synchronize(trigger: LifecycleSyncTrigger, clientVersion: string): Promise<unknown>;
}

type LifecycleRuntimeTarget = Pick<
  AutomationLifecycle,
  | "login"
  | "getState"
  | "setAutomation"
  | "logout"
  | "getExecutionState"
  | "authorizeAction"
  | "classifyActionCompletion"
>;

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], context: string): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(`${context} has unknown field ${key}`);
    }
  }
  for (const key of keys) {
    if (!(key in value)) {
      throw new Error(`${context} is missing ${key}`);
    }
  }
}

function nonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function booleanValue(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${context} must be a boolean`);
  }
  return value;
}

function effectValue(value: unknown): ActiveActionEffect {
  if (value !== "READ" && value !== "WRITE") {
    throw new Error("effect must be READ or WRITE");
  }
  return value;
}

function permitValue(value: unknown): ActiveActionPermit {
  const permit = record(value, "permit");
  exactKeys(permit, ["effect", "automationRevision"], "permit");
  if (!Number.isSafeInteger(permit.automationRevision) || (permit.automationRevision as number) < 0) {
    throw new Error("permit automationRevision must be a non-negative safe integer");
  }
  return {
    effect: effectValue(permit.effect),
    automationRevision: permit.automationRevision as number
  };
}

export function createChromePluginStateRepository(
  chromeApi: ChromeForRepository
): PluginStateRepository {
  return {
    async load(): Promise<StoredPluginState> {
      const stored = await chromeApi.storage.local.get(PLUGIN_STATE_STORAGE_KEY);
      const value = stored[PLUGIN_STATE_STORAGE_KEY];
      if (value === undefined) {
        const initial = createInitialPluginState();
        await chromeApi.storage.local.set({ [PLUGIN_STATE_STORAGE_KEY]: initial });
        return initial;
      }
      // 后端生产模式：插件状态由登录/同步链路维护，不做本地激活迁移。
      // 未初始化时写入初始未登录状态；已存储状态原样严格解码返回。
      return decodeStoredPluginState(value);
    },
    async save(state: StoredPluginState): Promise<void> {
      await chromeApi.storage.local.set({
        [PLUGIN_STATE_STORAGE_KEY]: decodeStoredPluginState(state)
      });
    }
  };
}

export function registerAutomationLifecycleEvents(options: {
  chromeApi: ChromeForLifecycleEvents;
  networkEvents: NetworkEvents;
  lifecycle: LifecycleEventTarget;
}): void {
  const { chromeApi, networkEvents, lifecycle } = options;
  const clientVersion = chromeApi.runtime.getManifest().version;
  const synchronize = (trigger: LifecycleSyncTrigger): void => {
    void lifecycle.synchronize(trigger, clientVersion);
  };

  void chromeApi.alarms.get(PLUGIN_SYNC_ALARM).then((alarm) => {
    if (alarm === undefined) {
      chromeApi.alarms.create(PLUGIN_SYNC_ALARM, { periodInMinutes: 1 });
    }
  });
  chromeApi.runtime.onInstalled.addListener(() => synchronize("INSTALLED"));
  chromeApi.runtime.onStartup.addListener(() => synchronize("STARTUP"));
  chromeApi.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PLUGIN_SYNC_ALARM) {
      synchronize("ALARM");
    }
  });
  networkEvents.addListener(() => synchronize("NETWORK_RESTORED"));
}

export function isAutomationLifecycleRequest(
  value: unknown
): value is AutomationLifecycleRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const type = (value as Record<string, unknown>).type;
  return typeof type === "string" && type.startsWith("PLUGIN_");
}

export async function handleAutomationLifecycleRequest(
  lifecycle: LifecycleRuntimeTarget,
  clientVersion: string,
  requestValue: unknown
): Promise<unknown> {
  const request = record(requestValue, "lifecycle request");
  const type = nonEmptyString(request.type, "lifecycle request type");

  if (type === "PLUGIN_LOGIN") {
    exactKeys(request, ["type", "data"], type);
    const data = record(request.data, `${type} data`);
    exactKeys(data, ["token"], `${type} data`);
    return lifecycle.login(nonEmptyString(data.token, "token"), clientVersion);
  }
  if (type === "PLUGIN_GET_STATE") {
    exactKeys(request, ["type"], type);
    return lifecycle.getState();
  }
  if (type === "PLUGIN_SET_AUTOMATION") {
    exactKeys(request, ["type", "data"], type);
    const data = record(request.data, `${type} data`);
    exactKeys(data, ["enabled"], `${type} data`);
    return lifecycle.setAutomation(booleanValue(data.enabled, "enabled"));
  }
  if (type === "PLUGIN_LOGOUT") {
    exactKeys(request, ["type"], type);
    return lifecycle.logout();
  }
  if (type === "PLUGIN_GET_EXECUTION_STATE") {
    exactKeys(request, ["type"], type);
    return lifecycle.getExecutionState();
  }
  if (type === "PLUGIN_AUTHORIZE_ACTION") {
    exactKeys(request, ["type", "data"], type);
    const data = record(request.data, `${type} data`);
    exactKeys(data, ["effect"], `${type} data`);
    return lifecycle.authorizeAction(effectValue(data.effect));
  }
  if (type === "PLUGIN_CLASSIFY_ACTION_COMPLETION") {
    exactKeys(request, ["type", "data"], type);
    const data = record(request.data, `${type} data`);
    exactKeys(data, ["permit"], `${type} data`);
    return lifecycle.classifyActionCompletion(permitValue(data.permit));
  }
  throw new Error(`unknown lifecycle request type: ${type}`);
}
