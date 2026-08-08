import type {
  RuntimeRequest
} from "./handlers/types.ts";
import { AutomationLifecycle } from "./handlers/automationLifecycle.ts";
import { ReplyBackgroundController } from "./handlers/replyBackground.ts";
import { TradeBackgroundController } from "./handlers/tradeBackground.ts";
import {
  createChromeAdjustmentSettlementJournal,
  createChromePaidSettlementJournal,
  createChromeTicketSettlementJournal
} from "./handlers/settlementJournal.ts";
import { TicketBackgroundController } from "./handlers/ticketBackground.ts";
import {
  createChromePluginStateRepository,
  handleAutomationLifecycleRequest,
  isAutomationLifecycleRequest,
  PLUGIN_STATE_STORAGE_KEY,
  registerAutomationLifecycleEvents,
  type AutomationLifecycleRequest
} from "./handlers/backgroundLifecycle.ts";
import { decodeStoredPluginState } from "./handlers/pluginState.ts";
import {
  HOOK_SETTINGS_STORAGE_KEY,
  createDefaultHookSettings,
  decodeHookSettings,
  type HookSettings
} from "./handlers/hookState.ts";
import { createBackendApiClientImpl } from "./handlers/backendApiClient.ts";
import type { BackendApiClient, KeywordRule, ReplyTemplateKey } from "./handlers/backendApi.ts";
import {
  createInitialPluginState,
  type StoredPluginState
} from "./handlers/pluginState.ts";
import {
  decodeBackendConfig,
  readBackendConfig,
  saveBackendConfig
} from "./upstream/backendConfig.ts";
/** 后端地址（业务控制台保存后生效）。 */
const backendConfigRef: { baseUrl: string } = { baseUrl: "" };
void readBackendConfig(chrome.storage.local)
  .then((config) => {
    backendConfigRef.baseUrl = config.baseUrl;
  })
  .catch(() => {});

/**
 * 后端生产路径：插件 → FastAPI/SQLite → 良票。
 * token 由登录链路写入插件状态；baseUrl 复用管理页保存的后端地址配置。
 */
const backendApiFactory = (token: string): BackendApiClient => createBackendApiClientImpl({
  token,
  baseUrl: () => backendConfigRef.baseUrl,
  storage: chrome.storage.local
});

/** 读取当前登录 token 并构造 后端客户端（未登录时抛错）。 */
async function requireBackendApi(): Promise<BackendApiClient> {
  const state = await automationLifecycle.getState();
  if (state.authStatus !== "AUTHENTICATED" || state.token === null) {
    throw new Error("未登录：请先在业务控制台登录 后端");
  }
  return backendApiFactory(state.token);
}

const automationLifecycle = new AutomationLifecycle({
  repository: createChromePluginStateRepository(chrome),
  apiFactory: backendApiFactory,
  now: () => new Date().toISOString()
});
const replyBackground = new ReplyBackgroundController({
  lifecycle: automationLifecycle,
  apiFactory: backendApiFactory
});
const tradeBackground = new TradeBackgroundController({
  lifecycle: automationLifecycle,
  apiFactory: backendApiFactory,
  adjustmentSettlementJournal: createChromeAdjustmentSettlementJournal(chrome),
  paidSettlementJournal: createChromePaidSettlementJournal(chrome)
});
const ticketBackground = new TicketBackgroundController({
  lifecycle: automationLifecycle,
  apiFactory: backendApiFactory,
  journal: createChromeTicketSettlementJournal(chrome)
});
void ticketBackground.clearSettlementsIfUnauthenticated().catch((error) => {
  // console.error("failed to initialize ticket settlement journal", error);
});
void tradeBackground.clearPaidSettlementsIfUnauthenticated().catch((error) => {
  // console.error("failed to initialize paid settlement journal", error);
});
void tradeBackground.clearAdjustmentSettlementsIfUnauthenticated().catch((error) => {
  // console.error("failed to initialize adjustment settlement journal", error);
});

chrome.storage.onChanged.addListener((changes: Record<string, unknown>, areaName: string) => {
  if (areaName !== "local") {
    return;
  }
  const change = changes[PLUGIN_STATE_STORAGE_KEY];
  if (typeof change !== "object" || change === null || Array.isArray(change)) {
    return;
  }
  const newValue = (change as Record<string, unknown>).newValue;
  if (newValue === undefined) {
    return;
  }
  let state;
  try {
    state = decodeStoredPluginState(newValue);
  } catch {
    return;
  }
  if (state.authStatus !== "AUTHENTICATED" || state.token === null) {
    void ticketBackground.clearSettlements().catch((error) => {
      // console.error("failed to clear ticket settlement journal", error);
    });
    void tradeBackground.clearPaidSettlements().catch((error) => {
      // console.error("failed to clear paid settlement journal", error);
    });
  }
});

registerAutomationLifecycleEvents({
  chromeApi: chrome,
  networkEvents: {
    addListener(listener) {
      globalThis.addEventListener("online", listener);
    }
  },
  lifecycle: automationLifecycle
});

// 本地驱动：SW 每次启动立即同步一次，确保话术/规则配置尽快就绪
// （onInstalled/onStartup 只在安装或浏览器启动时触发，冷唤醒不触发）。
void automationLifecycle.synchronize("STARTUP", chrome.runtime.getManifest().version)
  .catch((error) => {
    // console.error("failed to synchronize on startup", error);
  });

// 良票已剥离到后端:不再需要 declarativeNetRequest 注入 Origin/Referer/UA。
// (原 installLiangPiaoHeaderRules 已删除;header 由后端服务端请求直接设置)

type PopupBackendLoginRequest = {
  type: "BACKEND_LOGIN";
  data: { username: string; password: string };
};

chrome.runtime.onMessage.addListener((
  message: RuntimeRequest | AutomationLifecycleRequest | PopupBackendLoginRequest,
  _sender: unknown,
  sendResponse: (value: unknown) => void
) => {
  handleMessage(message).then(sendResponse).catch((error) => {
    sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

async function handleMessage(
  message: RuntimeRequest | AutomationLifecycleRequest | PopupBackendLoginRequest
): Promise<unknown> {
  if (message.type === "BACKEND_LOGIN") {
    return backendLogin(message.data);
  }
  if (isAutomationLifecycleRequest(message)) {
    const result = await handleAutomationLifecycleRequest(
      automationLifecycle,
      chrome.runtime.getManifest().version,
      message
    );
    if (message.type === "PLUGIN_LOGOUT" || message.type === "PLUGIN_LOGIN") {
      await ticketBackground.clearSettlements();
      await tradeBackground.clearPaidSettlements();
    }
    return result;
  }
  if (message.type === "GET_HOOK_SETTINGS") {
    return getHookSettings();
  }
  if (message.type === "SET_HOOK_ENABLED") {
    return setHookEnabled(message.data.enabled);
  }
  if (message.type === "GET_REPLY_CONFIG") {
    return replyBackground.getReplyConfig();
  }
  if (message.type === "UPDATE_REPLY_CONFIG") {
    return updateReplyConfig(message.data);
  }
  if (message.type === "AI_CUSTOMER_SERVICE") {
    return replyBackground.getAiReply(message.data);
  }
  if (message.type === "GET_AUTOMATION_CONFIG") {
    return replyBackground.getAutomationConfig();
  }
  if (message.type === "QUOTE_IMAGE") {
    return (await requireBackendApi()).quoteImage(message.data);
  }
  if (message.type === "LOOKUP_WAITING_PAYMENT") {
    return tradeBackground.lookupWaitingPayment(message.data.chatId);
  }
  if (message.type === "BEGIN_PRICE_ADJUSTMENT") {
    return tradeBackground.beginAdjustment(
      message.data.businessOrderId,
      message.data.xianyuOrderId,
    );
  }
  if (message.type === "SETTLE_PRICE_ADJUSTMENT") {
    return tradeBackground.settleAdjusted(message.data.request, message.data.permit);
  }
  if (message.type === "LOOKUP_PAID_ORDER") {
    return tradeBackground.lookupPaidOrder(message.data.chatId);
  }
  if (message.type === "BEGIN_ORDER_DETAIL_READ") {
    return tradeBackground.beginOrderDetailRead();
  }
  if (message.type === "COMPLETE_ORDER_DETAIL_READ") {
    return tradeBackground.completeOrderDetailRead(message.data.permit);
  }
  if (message.type === "ADVANCE_PAID_ORDER") {
    return tradeBackground.advancePaid(
      message.data.id,
      message.data.actualPaidAmountCents,
    );
  }
  if (message.type === "BEGIN_MISMATCH_CANCELLATION") {
    return tradeBackground.beginMismatchCancellation(message.data.id);
  }
  if (message.type === "COMPLETE_MISMATCH_CANCELLATION") {
    return tradeBackground.completeMismatchCancellation(
      message.data.request,
      message.data.permit
    );
  }
  if (message.type === "GET_TICKET_RESULTS") {
    return ticketBackground.getTicketResults();
  }
  if (message.type === "BEGIN_TICKET_DELIVERY") {
    return ticketBackground.beginDelivery(message.data.id);
  }
  if (message.type === "ABORT_TICKET_DELIVERY") {
    await ticketBackground.abortDelivery(message.data.id, message.data.permit);
    return null;
  }
  if (message.type === "SETTLE_TICKET_RESULT") {
    await ticketBackground.settleTicketResult(message.data.request, message.data.permit);
    return null;
  }
  if (message.type === "FETCH_IMAGE_DATA_URL") {
    return fetchImageDataUrl(message.data.url);
  }
  if (message.type === "SAVE_BACKEND_CONFIG") {
    const config = decodeBackendConfig(message.data.config);
    await saveBackendConfig(chrome.storage.local, config);
    backendConfigRef.baseUrl = config.baseUrl;
    return { saved: true };
  }
  if (message.type === "OPEN_MANAGE_PAGE") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("manage.html") });
    return { opened: true };
  }
  throw new Error("unknown runtime message type");
}

/**
 * 后端登录：用系统账号换取 Bearer Token 并写入插件状态。
 * 只解析统一信封 { code, message, data, requestId }，Token 由
 * automationLifecycle.login 校验（sync + 话术配置）后落盘。
 */
async function backendLogin(data: {
  username: unknown;
  password: unknown;
}): Promise<StoredPluginState> {
  const username = requireNonEmptyString(data.username, "用户名");
  const password = requireNonEmptyString(data.password, "密码");
  const baseUrl = backendConfigRef.baseUrl;
  if (baseUrl.length === 0) {
    throw new Error("尚未配置后端地址：请先打开业务控制台保存 后端地址");
  }
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const body = await readJsonResponse(response, "后端登录");
  const envelope = requireRecord(body, "后端登录响应");
  const message = typeof envelope.message === "string" ? envelope.message : "后端登录失败";
  const dataValue = envelope.data;
  if (
    envelope.code !== 0 ||
    !isRecord(dataValue) ||
    typeof dataValue.accessToken !== "string" ||
    dataValue.accessToken.length === 0
  ) {
    throw new Error(message);
  }
  const accessToken = requireNonEmptyString(dataValue.accessToken, "accessToken");
  return automationLifecycle.login(accessToken, chrome.runtime.getManifest().version);
}

/**
 * 保存话术/关键词规则（manage 页）：PUT 后端 → 立即 sync 拉取新版本 →
 * 返回新版本号。保存后插件本地配置即与后端一致。
 */
async function updateReplyConfig(data: {
  templates: Record<string, string>;
  keywordRules: Array<{
    id: string;
    keywords: string[];
    reply: string;
    enabled: boolean;
    priority: number;
  }>;
}): Promise<{ version: number }> {
  const api = await requireBackendApi();
  const templates = isRecord(data.templates) ? data.templates : {};
  const keywordRules = requireArray(data.keywordRules, "keywordRules");
  const result = await api.updateReplyConfig(
    templates as Record<ReplyTemplateKey, string>,
    keywordRules as KeywordRule[],
  );
  // 立即同步，让本地配置跟随新版本（不等待下次事件触发）。
  await automationLifecycle.synchronize("MANUAL", chrome.runtime.getManifest().version);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getHookSettings(): Promise<HookSettings> {
  const stored = await chrome.storage.local.get(HOOK_SETTINGS_STORAGE_KEY);
  const value = stored[HOOK_SETTINGS_STORAGE_KEY];
  if (value === undefined) {
    const settings = createDefaultHookSettings();
    await chrome.storage.local.set({ [HOOK_SETTINGS_STORAGE_KEY]: settings });
    return settings;
  }
  return decodeHookSettings(value);
}

async function setHookEnabled(enabledValue: unknown): Promise<HookSettings> {
  const enabled = requireBoolean(enabledValue, "hook enabled");
  const settings = decodeHookSettings({
    ...createDefaultHookSettings(),
    enabled
  });
  await chrome.storage.local.set({ [HOOK_SETTINGS_STORAGE_KEY]: settings });
  // 本地驱动：页面 hook 开关即自动工作总开关。
  // 开启时确保本地配置就绪并启用自动化；关闭时停用。
  try {
    if (enabled) {
      const state = await automationLifecycle.getState();
      if (state.replyConfig === null || state.replyConfig.version !== state.replyConfigVersion) {
        await automationLifecycle.synchronize("MANUAL", chrome.runtime.getManifest().version);
      }
    }
    await automationLifecycle.setAutomation(enabled);
  } catch {
    // 状态写入失败不阻塞 hook 开关本身，下次开启自动重试。
  }
  return settings;
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

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object`);
  }
  return value as Record<string, unknown>;
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

function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${context} must be boolean`);
  return value;
}

function requireArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array`);
  return value;
}
