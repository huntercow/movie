import {
  BackendApiError,
  decodeReplyConfig,
  type ReplyConfig
} from "./backendApi.ts";

export type PluginAuthStatus = "LOGGED_OUT" | "AUTHENTICATED" | "TOKEN_INVALID";
export type DiagnosticFailureKind = "NETWORK" | "HTTP" | "PROTOCOL";

export interface QuoteSendContext {
  messageId: string;
  chatId: string;
  customerId: string;
}

export interface QuoteRecovery {
  quoteTaskId: string;
  sendContext: QuoteSendContext;
  startedAt: string;
}

export interface PluginDiagnostics {
  lastBackendFailure: {
    kind: DiagnosticFailureKind;
    occurredAt: string;
  } | null;
}

export interface StoredPluginState {
  schemaVersion: 1;
  token: string | null;
  authStatus: PluginAuthStatus;
  automationEnabled: boolean;
  automationRevision: number;
  replyConfigVersion: number;
  replyConfig: ReplyConfig | null;
  safetyDisabled: boolean;
  remoteDisablePending: boolean;
  quoteRecoveries: QuoteRecovery[];
  diagnostics: PluginDiagnostics;
}

const STATE_KEYS = [
  "schemaVersion",
  "token",
  "authStatus",
  "automationEnabled",
  "automationRevision",
  "replyConfigVersion",
  "replyConfig",
  "safetyDisabled",
  "remoteDisablePending",
  "quoteRecoveries",
  "diagnostics"
] as const;

function invalid(message: string): BackendApiError {
  return new BackendApiError("PROTOCOL", `stored plugin state ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw invalid(`${path} has unknown field ${key}`);
    }
  }
  for (const key of keys) {
    if (!(key in value)) {
      throw invalid(`${path} is missing ${key}`);
    }
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(`${path} must be a non-empty string`);
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw invalid(`${path} must be a boolean`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalid(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

function timestamp(value: unknown, path: string): string {
  const result = nonEmptyString(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(result) ||
    Number.isNaN(Date.parse(result))
  ) {
    throw invalid(`${path} must be an ISO 8601 timestamp with timezone`);
  }
  return result;
}

export function createInitialPluginState(): StoredPluginState {
  return {
    schemaVersion: 1,
    // 后端生产模式：初始为未登录，登录后经 PLUGIN_LOGIN 走
    // 「sync 验证 Token → 拉取并校验话术配置」链路；token 与配置由后端统一管理。
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
}

export function decodeStoredPluginState(value: unknown): StoredPluginState {
  const state = record(value, "root");
  exactKeys(state, STATE_KEYS, "root");

  if (state.schemaVersion !== 1) {
    throw invalid("schemaVersion must be 1");
  }
  if (
    state.authStatus !== "LOGGED_OUT" &&
    state.authStatus !== "AUTHENTICATED" &&
    state.authStatus !== "TOKEN_INVALID"
  ) {
    throw invalid("authStatus is unknown");
  }
  const authStatus = state.authStatus;
  let token: string | null;
  if (authStatus === "AUTHENTICATED") {
    token = nonEmptyString(state.token, "token");
  } else {
    if (state.token !== null) {
      throw invalid(`${authStatus} must not retain a token`);
    }
    token = null;
  }

  const automationEnabled = booleanValue(state.automationEnabled, "automationEnabled");
  const safetyDisabled = booleanValue(state.safetyDisabled, "safetyDisabled");
  const remoteDisablePending = booleanValue(state.remoteDisablePending, "remoteDisablePending");
  const automationRevision = nonNegativeInteger(state.automationRevision, "automationRevision");
  const replyConfigVersion = nonNegativeInteger(state.replyConfigVersion, "replyConfigVersion");

  let replyConfig: ReplyConfig | null = null;
  if (state.replyConfig !== null) {
    replyConfig = decodeReplyConfig(state.replyConfig);
    if (replyConfig.version !== replyConfigVersion && !safetyDisabled) {
      throw invalid("only a safely disabled state may retain a non-current replyConfig");
    }
  }

  if (automationEnabled) {
    if (authStatus !== "AUTHENTICATED") {
      throw invalid("automationEnabled requires AUTHENTICATED");
    }
    // safetyDisabled 允许与 automationEnabled 并存:automationEnabled 是用户期望
    // (远端权威),safetyDisabled 是后端故障本地暂停;后端恢复同步成功后自动解除。
    if (remoteDisablePending) {
      throw invalid("automationEnabled cannot be true while remoteDisablePending is true");
    }
    if (replyConfig === null || replyConfig.version !== replyConfigVersion) {
      throw invalid("automationEnabled requires a current replyConfig");
    }
  }
  if (remoteDisablePending && (!safetyDisabled || automationEnabled)) {
    throw invalid("remoteDisablePending requires local safetyDisabled state");
  }
  if (authStatus !== "AUTHENTICATED" && replyConfig !== null) {
    throw invalid(`${authStatus} must not retain replyConfig`);
  }

  if (!Array.isArray(state.quoteRecoveries)) {
    throw invalid("quoteRecoveries must be an array");
  }
  if (authStatus !== "AUTHENTICATED" && state.quoteRecoveries.length > 0) {
    throw invalid(`${authStatus} must not retain quoteRecoveries`);
  }
  const seenQuoteTaskIds = new Set<string>();
  const quoteRecoveries = state.quoteRecoveries.map((value, index): QuoteRecovery => {
    const recovery = record(value, `quoteRecoveries[${index}]`);
    exactKeys(recovery, ["quoteTaskId", "sendContext", "startedAt"], `quoteRecoveries[${index}]`);
    const quoteTaskId = nonEmptyString(recovery.quoteTaskId, `quoteRecoveries[${index}].quoteTaskId`);
    if (seenQuoteTaskIds.has(quoteTaskId)) {
      throw invalid(`quoteRecoveries contains duplicate quoteTaskId ${quoteTaskId}`);
    }
    seenQuoteTaskIds.add(quoteTaskId);
    const context = record(recovery.sendContext, `quoteRecoveries[${index}].sendContext`);
    exactKeys(context, ["messageId", "chatId", "customerId"], `quoteRecoveries[${index}].sendContext`);
    return {
      quoteTaskId,
      sendContext: {
        messageId: nonEmptyString(context.messageId, "sendContext.messageId"),
        chatId: nonEmptyString(context.chatId, "sendContext.chatId"),
        customerId: nonEmptyString(context.customerId, "sendContext.customerId")
      },
      startedAt: timestamp(recovery.startedAt, `quoteRecoveries[${index}].startedAt`)
    };
  });

  const rawDiagnostics = record(state.diagnostics, "diagnostics");
  exactKeys(rawDiagnostics, ["lastBackendFailure"], "diagnostics");
  let lastBackendFailure: PluginDiagnostics["lastBackendFailure"] = null;
  if (rawDiagnostics.lastBackendFailure !== null) {
    const failure = record(rawDiagnostics.lastBackendFailure, "diagnostics.lastBackendFailure");
    exactKeys(failure, ["kind", "occurredAt"], "diagnostics.lastBackendFailure");
    if (failure.kind !== "NETWORK" && failure.kind !== "HTTP" && failure.kind !== "PROTOCOL") {
      throw invalid("diagnostics.lastBackendFailure.kind is unknown");
    }
    lastBackendFailure = {
      kind: failure.kind,
      occurredAt: timestamp(failure.occurredAt, "diagnostics.lastBackendFailure.occurredAt")
    };
  }

  return {
    schemaVersion: 1,
    token,
    authStatus,
    automationEnabled,
    automationRevision,
    replyConfigVersion,
    replyConfig,
    safetyDisabled,
    remoteDisablePending,
    quoteRecoveries,
    diagnostics: { lastBackendFailure }
  };
}
