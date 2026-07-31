import type {
  AgisoFallbackRecord,
  AgisoStatus,
  ApiRequest,
  ExtensionConfig,
  RuntimeRequest,
  StoredAgisoFallbackRecord,
  XianyuAccountSnapshot
} from "./types";
import {
  DEFAULT_KEYWORD_REPLY_RULES,
  DEFAULT_REPLY_TEMPLATES,
  AUTO_REPLY_STORAGE_KEY,
  DELIVER_SEND_IMAGE_STORAGE_KEY,
  KEYWORD_RULE_STORAGE_KEY,
  REPLY_TEMPLATE_STORAGE_KEY,
  TEXT_FALLBACK_STORAGE_KEY
} from "./replyDefaults";

const DEFAULT_CONFIG: ExtensionConfig = {
  backendBaseUrl: "http://172.30.1.151:8080",
  pluginApiToken: ""
};
const AGISO_TOKEN_STORAGE_KEY = "AGISO_TOKEN";
const AGISO_TOKEN_UPDATED_AT_KEY = "AGISO_TOKEN_UPDATED_AT";
const AGISO_LAST_REQUEST_KEY = "AGISO_LAST_REQUEST";
const AGISO_FALLBACK_RECORDS_KEY = "AGISO_FALLBACK_RECORDS";
const INSTALLATION_ID_STORAGE_KEY = "pluginInstallationId";
const AGENT_STATUS_STORAGE_KEY = "pluginAgentStatus";
const XIANYU_ACCOUNT_STORAGE_KEY = "currentXianyuAccount";
const HEARTBEAT_ALARM = "plugin-agent-heartbeat";

interface HttpRequestResult {
  success: boolean;
  status: number;
  data: unknown;
}

void initializeAgentRuntime();
chrome.runtime.onInstalled.addListener(() => void initializeAgentRuntime());
chrome.runtime.onStartup.addListener(() => void initializeAgentRuntime());
chrome.alarms.onAlarm.addListener((alarm: { name: string }) => {
  if (alarm.name === HEARTBEAT_ALARM) void heartbeatAgent();
});

chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender: unknown, sendResponse: (value: unknown) => void) => {
  handleMessage(message).then(sendResponse).catch((error) => {
    sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

async function handleMessage(message: RuntimeRequest): Promise<unknown> {
  if (message.type === "GET_CONFIG") {
    return getConfig();
  }
  if (message.type === "SAVE_CONFIG") {
    await chrome.storage.local.set({
      backendBaseUrl: requireNonEmptyString(message.data.backendBaseUrl, "backendBaseUrl"),
      pluginApiToken: requireNonEmptyString(message.data.pluginApiToken, "pluginApiToken")
    });
    return activateAgent();
  }
  if (message.type === "ACTIVATE_AGENT") {
    return activateAgent();
  }
  if (message.type === "GET_AGENT_STATUS") {
    return getAgentStatus();
  }
  if (message.type === "REPORT_XIANYU_ACCOUNT") {
    await chrome.storage.local.set({ [XIANYU_ACCOUNT_STORAGE_KEY]: message.data });
    return heartbeatAgent();
  }
  if (message.type === "GET_REPLY_CONFIG") {
    return getReplyConfig();
  }
  if (message.type === "SAVE_REPLY_CONFIG") {
    await chrome.storage.local.set({
      [REPLY_TEMPLATE_STORAGE_KEY]: normalizeTemplates(message.data.xianyuReplyMessageTemplates),
      [KEYWORD_RULE_STORAGE_KEY]: normalizeKeywordRules(message.data.xianyuKeywordReplyRules),
      [TEXT_FALLBACK_STORAGE_KEY]: requireBoolean(
        message.data.xianyuAutoReplyTextFallback,
        TEXT_FALLBACK_STORAGE_KEY
      )
    });
    return { success: true };
  }
  if (message.type === "GET_AUTOMATION_CONFIG") {
    return getAutomationConfig();
  }
  if (message.type === "SAVE_AUTOMATION_CONFIG") {
    await chrome.storage.local.set({
      [AUTO_REPLY_STORAGE_KEY]: requireBoolean(message.data.autoReply, AUTO_REPLY_STORAGE_KEY),
      [DELIVER_SEND_IMAGE_STORAGE_KEY]: requireBoolean(
        message.data.xianyuDeliverSendImageEnabled,
        DELIVER_SEND_IMAGE_STORAGE_KEY
      )
    });
    return { success: true };
  }
  if (message.type === "SET_AGISO_TOKEN") {
    await chrome.storage.local.set({
      [AGISO_TOKEN_STORAGE_KEY]: requireNonEmptyString(message.data.token, "Agiso token"),
      [AGISO_TOKEN_UPDATED_AT_KEY]: new Date().toISOString()
    });
    return { success: true };
  }
  if (message.type === "GET_AGISO_STATUS") {
    return getAgisoStatus();
  }
  if (message.type === "RECORD_AGISO_FALLBACK") {
    await recordAgisoFallback(message.data);
    return { success: true };
  }
  if (message.type === "FETCH_IMAGE_DATA_URL") {
    return fetchImageDataUrl(message.data.url);
  }
  if (message.type === "AGISO_API_REQUEST") {
    const { AGISO_TOKEN } = await chrome.storage.local.get(AGISO_TOKEN_STORAGE_KEY);
    if (typeof AGISO_TOKEN !== "string" || !AGISO_TOKEN) {
      throw new Error("Agiso token is not configured");
    }
    const headers = { ...(message.data.headers || {}), Authorization: `Bearer ${AGISO_TOKEN}` };
    const result = await sendRequest({ ...message.data, headers });
    await rememberAgisoRequest(message.data, result);
    return result;
  }
  if (message.type === "API_REQUEST") {
    const config = await getConfig();
    const installationId = await getInstallationId();
    const headers = {
      ...(message.data.headers || {}),
      "X-Plugin-Token": config.pluginApiToken,
      "X-Plugin-Installation-Id": installationId,
      "Content-Type": "application/json"
    };
    return sendRequest({ ...message.data, url: absoluteBackendUrl(config.backendBaseUrl, message.data.url), headers });
  }
  throw new Error("unknown runtime message type");
}

async function getAgisoStatus(): Promise<AgisoStatus> {
  const stored = await chrome.storage.local.get([
    AGISO_TOKEN_STORAGE_KEY,
    AGISO_TOKEN_UPDATED_AT_KEY,
    AGISO_LAST_REQUEST_KEY,
    AGISO_FALLBACK_RECORDS_KEY
  ]);
  const token = optionalStoredString(stored[AGISO_TOKEN_STORAGE_KEY], AGISO_TOKEN_STORAGE_KEY) ?? "";
  const lastRequestValue = stored[AGISO_LAST_REQUEST_KEY];
  const lastRequest = lastRequestValue === undefined
    ? null
    : requireRecord(lastRequestValue, "stored Agiso last request");
  const fallbackValue = stored[AGISO_FALLBACK_RECORDS_KEY];
  if (fallbackValue !== undefined && !Array.isArray(fallbackValue)) {
    throw new Error("stored Agiso fallback records must be an array");
  }
  return {
    hasToken: Boolean(token),
    tokenPreview: maskToken(token),
    tokenUpdatedAt: optionalStoredString(stored[AGISO_TOKEN_UPDATED_AT_KEY], AGISO_TOKEN_UPDATED_AT_KEY) ?? "",
    lastRequestAt: lastRequest === null ? "" : requireNonEmptyString(lastRequest.at, "stored Agiso last request at"),
    lastRequestAction: lastRequest === null ? "" : requireNonEmptyString(lastRequest.action, "stored Agiso last request action"),
    lastRequestOk: lastRequest === null ? null : requireBoolean(lastRequest.ok, "stored Agiso last request ok"),
    lastRequestStatus: lastRequest === null ? null : requireNumber(lastRequest.status, "stored Agiso last request status"),
    lastRequestSummary: lastRequest === null ? "" : requireString(lastRequest.summary, "stored Agiso last request summary"),
    fallbackRecords: fallbackValue === undefined
      ? []
      : (fallbackValue as unknown[]).map((record: unknown, index: number) => requireStoredFallbackRecord(record, index))
  };
}

async function rememberAgisoRequest(request: ApiRequest, result: HttpRequestResult): Promise<void> {
  await chrome.storage.local.set({
    [AGISO_LAST_REQUEST_KEY]: {
      at: new Date().toISOString(),
      action: agisoActionName(request.url),
      ok: result.success,
      status: result.status,
      summary: summarize(result.data)
    }
  });
}

async function recordAgisoFallback(record: AgisoFallbackRecord): Promise<void> {
  const stored = await chrome.storage.local.get(AGISO_FALLBACK_RECORDS_KEY);
  const storedRecords = stored[AGISO_FALLBACK_RECORDS_KEY];
  if (storedRecords !== undefined && !Array.isArray(storedRecords)) {
    throw new Error("stored Agiso fallback records must be an array");
  }
  const records = storedRecords === undefined ? [] : storedRecords as StoredAgisoFallbackRecord[];
  records.unshift({
    ...record,
    at: new Date().toISOString(),
    request: summarize(record.request),
    response: summarize(record.response)
  });
  await chrome.storage.local.set({
    [AGISO_FALLBACK_RECORDS_KEY]: records.slice(0, 20)
  });
}

async function getConfig(): Promise<ExtensionConfig> {
  const stored = await chrome.storage.local.get(["backendBaseUrl", "pluginApiToken", INSTALLATION_ID_STORAGE_KEY]);
  return {
    backendBaseUrl: optionalStoredString(stored.backendBaseUrl, "backendBaseUrl") ?? DEFAULT_CONFIG.backendBaseUrl,
    pluginApiToken: optionalStoredString(stored.pluginApiToken, "pluginApiToken") ?? DEFAULT_CONFIG.pluginApiToken,
    installationId: optionalStoredString(stored[INSTALLATION_ID_STORAGE_KEY], INSTALLATION_ID_STORAGE_KEY)
      ?? await getInstallationId()
  };
}

async function initializeAgentRuntime(): Promise<void> {
  await getInstallationId();
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 5 });
  await heartbeatAgent();
}

async function getInstallationId(): Promise<string> {
  const stored = await chrome.storage.local.get(INSTALLATION_ID_STORAGE_KEY);
  const existing = optionalStoredString(stored[INSTALLATION_ID_STORAGE_KEY], INSTALLATION_ID_STORAGE_KEY);
  if (existing) return existing;
  const installationId = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALLATION_ID_STORAGE_KEY]: installationId });
  return installationId;
}

async function getAgentStatus(): Promise<unknown> {
  const stored = await chrome.storage.local.get([INSTALLATION_ID_STORAGE_KEY, AGENT_STATUS_STORAGE_KEY]);
  if (stored[AGENT_STATUS_STORAGE_KEY] !== undefined) {
    return requireAgentRuntimeStatus(stored[AGENT_STATUS_STORAGE_KEY]);
  }
  return {
    installationId: optionalStoredString(stored[INSTALLATION_ID_STORAGE_KEY], INSTALLATION_ID_STORAGE_KEY)
      ?? await getInstallationId(),
    state: "UNCONFIGURED",
    message: "尚未激活",
    checkedAt: ""
  };
}

async function activateAgent(): Promise<unknown> {
  const config = await getConfig();
  const installationId = await getInstallationId();
  const account = await getCurrentXianyuAccount();
  return updateAgentState("/api/v1/agents/activate", {
    token: config.pluginApiToken,
    agentType: "XIANYU_PLUGIN",
    installationId,
    instanceName: "Chrome 闲鱼插件",
    clientVersion: chrome.runtime.getManifest().version,
    ...(account ? {
      currentXianyuAccountId: account.accountId,
      ...(account.nickname === undefined ? {} : { currentXianyuNickname: account.nickname })
    } : {})
  });
}

async function heartbeatAgent(): Promise<unknown> {
  const config = await getConfig();
  if (!config.pluginApiToken) return getAgentStatus();
  const account = await getCurrentXianyuAccount();
  return updateAgentState("/api/v1/agents/heartbeat", {
    token: config.pluginApiToken,
    agentType: "XIANYU_PLUGIN",
    installationId: await getInstallationId(),
    clientVersion: chrome.runtime.getManifest().version,
    ...(account ? {
      currentXianyuAccountId: account.accountId,
      ...(account.nickname === undefined ? {} : { currentXianyuNickname: account.nickname })
    } : {})
  });
}

async function getCurrentXianyuAccount(): Promise<XianyuAccountSnapshot | null> {
  const stored = await chrome.storage.local.get(XIANYU_ACCOUNT_STORAGE_KEY);
  const value = stored[XIANYU_ACCOUNT_STORAGE_KEY];
  if (value === undefined) return null;
  const account = requireRecord(value, "stored Xianyu account");
  return {
    accountId: requireNonEmptyString(account.accountId, "stored Xianyu accountId"),
    nickname: optionalStoredString(account.nickname, "stored Xianyu nickname"),
    observedAt: requireNonEmptyString(account.observedAt, "stored Xianyu observedAt")
  };
}

async function updateAgentState(path: string, body: unknown): Promise<unknown> {
  const config = await getConfig();
  const installationId = await getInstallationId();
  let state: Record<string, unknown>;
  try {
    const response = await fetch(absoluteBackendUrl(config.backendBaseUrl, path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await readJsonResponse(response, "agent activation");
    const envelope = requireBackendEnvelope(payload, "agent activation");
    if (!response.ok && envelope.success) {
      throw new Error(`agent activation protocol mismatch for HTTP ${response.status}`);
    }
    if (response.ok && !envelope.success) {
      throw new Error(envelope.message);
    }
    if (!response.ok) {
      throw new Error(envelope.message);
    }
    state = {
      installationId,
      state: "ACTIVE",
      message: "客户端已激活",
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    state = {
      installationId,
      state: "ERROR",
      message: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString()
    };
  }
  await chrome.storage.local.set({ [AGENT_STATUS_STORAGE_KEY]: state });
  return state;
}

async function getReplyConfig(): Promise<unknown> {
  const stored = await chrome.storage.local.get([
    REPLY_TEMPLATE_STORAGE_KEY,
    KEYWORD_RULE_STORAGE_KEY,
    TEXT_FALLBACK_STORAGE_KEY
  ]);
  const templatesValue = stored[REPLY_TEMPLATE_STORAGE_KEY];
  const rulesValue = stored[KEYWORD_RULE_STORAGE_KEY];
  const textFallbackValue = stored[TEXT_FALLBACK_STORAGE_KEY];
  if (templatesValue === undefined && rulesValue === undefined && textFallbackValue === undefined) {
    const replyConfig = {
      [REPLY_TEMPLATE_STORAGE_KEY]: DEFAULT_REPLY_TEMPLATES,
      [KEYWORD_RULE_STORAGE_KEY]: DEFAULT_KEYWORD_REPLY_RULES,
      [TEXT_FALLBACK_STORAGE_KEY]: false
    };
    await chrome.storage.local.set(replyConfig);
    return replyConfig;
  }
  if (templatesValue === undefined || rulesValue === undefined || textFallbackValue === undefined) {
    throw new Error("stored reply config is incomplete");
  }
  return {
    [REPLY_TEMPLATE_STORAGE_KEY]: normalizeTemplates(templatesValue),
    [KEYWORD_RULE_STORAGE_KEY]: normalizeKeywordRules(rulesValue),
    [TEXT_FALLBACK_STORAGE_KEY]: requireBoolean(textFallbackValue, TEXT_FALLBACK_STORAGE_KEY)
  };
}

async function getAutomationConfig(): Promise<unknown> {
  const stored = await chrome.storage.local.get([AUTO_REPLY_STORAGE_KEY, DELIVER_SEND_IMAGE_STORAGE_KEY]);
  if (stored[AUTO_REPLY_STORAGE_KEY] === undefined && stored[DELIVER_SEND_IMAGE_STORAGE_KEY] === undefined) {
    const initialConfig = {
      [AUTO_REPLY_STORAGE_KEY]: true,
      [DELIVER_SEND_IMAGE_STORAGE_KEY]: true
    };
    await chrome.storage.local.set(initialConfig);
    return initialConfig;
  }
  if (stored[AUTO_REPLY_STORAGE_KEY] === undefined || stored[DELIVER_SEND_IMAGE_STORAGE_KEY] === undefined) {
    throw new Error("stored automation config is incomplete");
  }
  const config = {
    [AUTO_REPLY_STORAGE_KEY]: requireBoolean(stored[AUTO_REPLY_STORAGE_KEY], AUTO_REPLY_STORAGE_KEY),
    [DELIVER_SEND_IMAGE_STORAGE_KEY]: requireBoolean(
      stored[DELIVER_SEND_IMAGE_STORAGE_KEY],
      DELIVER_SEND_IMAGE_STORAGE_KEY
    )
  };
  return config;
}

async function sendRequest(request: ApiRequest): Promise<HttpRequestResult> {
  const url = addParams(request.url, request.params);
  const response = await fetch(url, {
    method: request.method,
    headers: request.headers || {},
    body: request.body === undefined ? undefined : JSON.stringify(request.body)
  });
  const data = await readJsonResponse(response, request.url);
  return { success: response.ok, status: response.status, data };
}

async function fetchImageDataUrl(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    return { success: false, error: `image fetch failed: ${response.status}` };
  }
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { success: true, dataUrl };
}

function absoluteBackendUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function addParams(url: string, params?: ApiRequest["params"]): string {
  if (!params) {
    return url;
  }
  const parsed = new URL(url);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) {
      parsed.searchParams.set(key, String(value));
    }
  });
  return parsed.toString();
}

async function readJsonResponse(response: Response, context: string): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    throw new Error(`${context} returned an empty HTTP response`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${context} returned invalid JSON`, { cause: error });
  }
}

function requireBackendEnvelope(value: unknown, context: string): { success: boolean; message: string; data: unknown } {
  const payload = requireRecord(value, `${context} response`);
  if (typeof payload.success !== "boolean") {
    throw new Error(`${context} response success must be boolean`);
  }
  if (typeof payload.message !== "string" || !payload.message) {
    throw new Error(`${context} response message must be a non-empty string`);
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "data")) {
    throw new Error(`${context} response is missing data`);
  }
  return { success: payload.success, message: payload.message, data: payload.data };
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function agisoActionName(url: string): string {
  if (url.includes("/Trade/List")) {
    return "Trade/List";
  }
  if (url.includes("/Trade/AdjustPrice")) {
    return "Trade/AdjustPrice";
  }
  if (url.includes("/ManualSend/SendDummy")) {
    return "ManualSend/SendDummy";
  }
  return url;
}

function maskToken(token: string): string {
  if (!token) {
    return "";
  }
  if (token.length <= 12) {
    return `***(${token.length})`;
  }
  return `${token.slice(0, 6)}***${token.slice(-4)}(${token.length})`;
}

function summarize(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value.slice(0, 500);
  }
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch (error) {
    throw new Error("unable to serialize diagnostic value", { cause: error });
  }
}

function normalizeTemplates(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("reply templates must be an object");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  entries.forEach(([key, template]) => requireString(template, `reply template ${key}`));
  return Object.fromEntries(entries) as Record<string, string>;
}

function normalizeKeywordRules(value: unknown): typeof DEFAULT_KEYWORD_REPLY_RULES {
  if (!Array.isArray(value)) {
    throw new Error("keyword rules must be an array");
  }
  const list = value;
  return list
    .map((value, index) => {
      const rule = requireRecord(value, `keyword rule ${index}`);
      if (!Array.isArray(rule.keywords) || rule.keywords.length === 0) {
        throw new Error(`keyword rule ${index} keywords must be a non-empty array`);
      }
      return {
        id: optionalStoredString(rule.id, `keyword rule ${index} id`),
        enabled: requireBoolean(rule.enabled, `keyword rule ${index} enabled`),
        keywords: rule.keywords.map((keyword, keywordIndex) =>
          requireNonEmptyString(keyword, `keyword rule ${index} keywords[${keywordIndex}]`)),
        priority: requireNumber(rule.priority, `keyword rule ${index} priority`),
        reply: requireNonEmptyString(rule.reply, `keyword rule ${index} reply`)
      };
    });
}

function requireAgentRuntimeStatus(value: unknown): import("./types").AgentRuntimeStatus {
  const status = requireRecord(value, "stored agent status");
  const state = requireNonEmptyString(status.state, "stored agent state");
  if (state !== "UNCONFIGURED" && state !== "ACTIVE" && state !== "ERROR") {
    throw new Error(`stored agent state is unknown: ${state}`);
  }
  return {
    installationId: requireNonEmptyString(status.installationId, "stored agent installationId"),
    state,
    message: requireNonEmptyString(status.message, "stored agent message"),
    checkedAt: requireString(status.checkedAt, "stored agent checkedAt")
  };
}

function requireStoredFallbackRecord(value: unknown, index: number): StoredAgisoFallbackRecord {
  const record = requireRecord(value, `stored Agiso fallback record ${index}`);
  return {
    action: requireNonEmptyString(record.action, `stored Agiso fallback record ${index} action`),
    reason: requireNonEmptyString(record.reason, `stored Agiso fallback record ${index} reason`),
    orderId: optionalStoredString(record.orderId, `stored Agiso fallback record ${index} orderId`),
    tradeNo: optionalStoredString(record.tradeNo, `stored Agiso fallback record ${index} tradeNo`),
    ok: record.ok === undefined ? undefined : requireBoolean(record.ok, `stored Agiso fallback record ${index} ok`),
    request: record.request,
    response: record.response,
    at: requireNonEmptyString(record.at, `stored Agiso fallback record ${index} at`)
  };
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== "string") throw new Error(`${context} must be a string`);
  return value;
}

function requireNonEmptyString(value: unknown, context: string): string {
  const text = requireString(value, context);
  if (!text) throw new Error(`${context} cannot be empty`);
  return text;
}

function optionalStoredString(value: unknown, context: string): string | undefined {
  return value === undefined || value === null ? undefined : requireString(value, context);
}

function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${context} must be boolean`);
  return value;
}

function optionalStoredBoolean(value: unknown, context: string): boolean | undefined {
  return value === undefined || value === null ? undefined : requireBoolean(value, context);
}

function requireNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${context} must be a finite number`);
  return value;
}
