import {
  decodeToolRequest,
  type ToolRequest
} from "../handlers/types.ts";
import { PLUGIN_STATE_STORAGE_KEY } from "../handlers/backgroundLifecycle.ts";
import { decodeStoredPluginState } from "../handlers/pluginState.ts";
import {
  HOOK_SETTINGS_STORAGE_KEY,
  createDefaultHookSettings,
  decodeHookSettings
} from "../handlers/hookState.ts";

const REQUEST_EVENT = "FILM_AI_LOCAL_TOOL_REQUEST";
const RESPONSE_EVENT = "FILM_AI_LOCAL_TOOL_RESPONSE";
const CONTENT_VERSION = "2026-07-04-debug-bridge";
const CAPTURE_MESSAGE_TYPE = "XIANYU_PROTOCOL_CAPTURE";
const CAPTURE_REQUEST_EVENT = "FILM_AI_XIANYU_CAPTURE_REQUEST";
const CAPTURE_RESPONSE_EVENT = "FILM_AI_XIANYU_CAPTURE_RESPONSE";
const CAPTURE_RESPONSE_TIMEOUT_MS = 5_000;
const TICKET_POLL_NOW_EVENT = "FILM_AI_XIANYU_TICKET_POLL_NOW";
const HOOK_CONTROL_EVENT = "FILM_AI_XIANYU_HOOK_CONTROL";
const HOOK_STATE_REQUEST_EVENT = "FILM_AI_XIANYU_HOOK_STATE_REQUEST";
const CAPTURE_ACTIONS = ["START", "STOP", "CLEAR", "STATUS", "EXPORT"] as const;
const CAPTURE_SCENARIOS = ["TEXT", "IMAGE", "WAIT_PAYMENT", "PAID", "OTHER"] as const;
const ENABLE_PROTOCOL_CAPTURE = import.meta.env.DEV;
let currentHookEnabled = false;

document.documentElement.setAttribute("data-xianyu-movie-ticket-content", CONTENT_VERSION);
// 页面 hook 由 manifest 直接以 MAIN world 注入，必须在 document_start 阶段安装 WebSocket 监听。
// 这里仅负责隔离世界与页面世界之间的事件桥接，避免异步插入脚本错过闲鱼首次建连。
document.documentElement.setAttribute("data-xianyu-movie-ticket-content-ready", CONTENT_VERSION);

// —— 注入状态日志（仿参考插件风格：页面加载时一次性输出，便于确认插件工作状态）——
console.log("[xianyu-ticket] 闲鱼IM页面，注入hook脚本");
console.log("[xianyu-ticket] msgpack.min.js 已由 manifest 声明注入（MAIN world）");
reportHookInjectionStatus();
reportAutomationStatus();

startHookSwitchBridge();
startXianyuConnectionRecovery();
startTicketPollOnAutomationEnable();

window.addEventListener(REQUEST_EVENT, (event) => {
  const detail = decodeToolRequest((event as CustomEvent<unknown>).detail);
  handleToolRequest(detail)
    .then((payload) => respond(detail.requestId, { success: true, payload }))
    .catch((error) => respond(detail.requestId, { success: false, error: error instanceof Error ? error.message : String(error) }));
});

if (ENABLE_PROTOCOL_CAPTURE) {
  chrome.runtime.onMessage.addListener((
    message: unknown,
    _sender: unknown,
    sendResponse: (response: unknown) => void
  ) => {
    if (!isCaptureRuntimeMessage(message)) {
      return undefined;
    }
    forwardCaptureRuntimeMessage(message)
      .then((payload) => sendResponse({ success: true, payload }))
      .catch((error) => sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return true;
  });
}

function isCaptureRuntimeMessage(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (value as Record<string, unknown>).type === CAPTURE_MESSAGE_TYPE;
}

function decodeCaptureCommand(value: unknown): CaptureCommand {
  const command = requireRecord(value, "capture command");
  const action = requireEnum(command.action, CAPTURE_ACTIONS, "capture command action");
  if (action === "START") {
    return {
      action,
      scenario: requireEnum(command.scenario, CAPTURE_SCENARIOS, "capture command scenario")
    };
  }
  if (command.scenario !== undefined) {
    throw new Error(`capture command ${action} must not include scenario`);
  }
  return { action };
}

async function forwardCaptureRuntimeMessage(value: unknown): Promise<unknown> {
  const message = requireRecord(value, "capture runtime message");
  if (message.type !== CAPTURE_MESSAGE_TYPE) {
    throw new Error(`capture runtime message type is not defined: ${String(message.type)}`);
  }
  const requestId = requireString(message.requestId, "capture runtime requestId");
  const command = decodeCaptureCommand(message.command);
  return new Promise((resolve, reject) => {
    const responseEvent = `${CAPTURE_RESPONSE_EVENT}:${requestId}`;
    const onResponse = (event: Event) => {
      cleanup();
      try {
        const response = requireRecord((event as CustomEvent<unknown>).detail, "capture page response");
        if (requireString(response.requestId, "capture page response requestId") !== requestId) {
          throw new Error("capture page response requestId mismatch");
        }
        const success = requireBoolean(response.success, "capture page response success");
        if (!success) {
          throw new Error(requireString(response.error, "capture page response error"));
        }
        if (!Object.prototype.hasOwnProperty.call(response, "payload")) {
          throw new Error("capture page response is missing payload");
        }
        resolve(response.payload);
      } catch (error) {
        reject(error);
      }
    };
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("xianyu capture page hook response timeout"));
    }, CAPTURE_RESPONSE_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(responseEvent, onResponse as EventListener);
    };
    window.addEventListener(responseEvent, onResponse as EventListener);
    window.dispatchEvent(new CustomEvent(CAPTURE_REQUEST_EVENT, {
      detail: { requestId, command }
    }));
  });
}

/** 页面 hook 就绪时写入的 DOM 属性（由 xianyuDebugState.publishDebugStatus 设置）。 */
const HOOK_READY_ATTRIBUTE = "data-xianyu-movie-ticket-hook";

/** 轮询检测页面 hook 是否已注入成功（content script 先于 MAIN world hook 注入，需等待）。 */
function reportHookInjectionStatus(): void {
  let attempts = 0;
  const check = () => {
    const hookVersion = document.documentElement.getAttribute(HOOK_READY_ATTRIBUTE);
    if (hookVersion !== null) {
      console.log(`[xianyu-ticket] xianyuPageHook.js 注入成功（${hookVersion}）`);
      return;
    }
    attempts += 1;
    if (attempts >= 10) {
      console.warn("[xianyu-ticket] xianyuPageHook.js 未检测到，请检查 manifest 注入配置");
      return;
    }
    window.setTimeout(check, 500);
  };
  window.setTimeout(check, 500);
}

/** 读取插件本地状态，打印自动工作开关状态（仿参考插件"自动回复未开启"提示）。 */
function reportAutomationStatus(): void {
  chrome.storage.local.get(PLUGIN_STATE_STORAGE_KEY, (stored: Record<string, unknown>) => {
    try {
      const state = decodeStoredPluginState(stored[PLUGIN_STATE_STORAGE_KEY]);
      console.log(state.automationEnabled
        ? "[xianyu-ticket] 自动工作已开启"
        : "[xianyu-ticket] 自动工作未开启");
    } catch {
      console.log("[xianyu-ticket] 插件尚未登录，自动工作未开启");
    }
  });
}

function startHookSwitchBridge(): void {
  window.addEventListener(HOOK_STATE_REQUEST_EVENT, () => {
    readAndPublishHookState();
  });
  readAndPublishHookState();
  chrome.storage.onChanged.addListener((changes: Record<string, unknown>, areaName: string) => {
    if (areaName !== "local") {
      return;
    }
    const change = changes[HOOK_SETTINGS_STORAGE_KEY];
    if (typeof change !== "object" || change === null || Array.isArray(change)) {
      return;
    }
    const newValue = (change as Record<string, unknown>).newValue;
    publishHookState(readHookEnabledFromStoredValue(newValue));
  });
}

function readAndPublishHookState(): void {
  chrome.storage.local.get(HOOK_SETTINGS_STORAGE_KEY, (stored: Record<string, unknown>) => {
    publishHookState(readHookEnabledFromStoredValue(stored[HOOK_SETTINGS_STORAGE_KEY]), true);
  });
}

function readHookEnabledFromStoredValue(value: unknown): boolean {
  try {
    return (value === undefined
      ? createDefaultHookSettings()
      : decodeHookSettings(value)).enabled;
  } catch {
    return false;
  }
}

function publishHookState(enabled: boolean, force = false): void {
  const changed = currentHookEnabled !== enabled;
  currentHookEnabled = enabled;
  document.documentElement.setAttribute("data-xianyu-movie-ticket-hook-enabled", String(enabled));
  if (!force && !changed) {
    return;
  }
  window.dispatchEvent(new CustomEvent(HOOK_CONTROL_EVENT, {
    detail: { enabled }
  }));
  console.log(enabled
    ? "[xianyu-ticket] 页面 hook 已开启"
    : "[xianyu-ticket] 页面 hook 已关闭");
}

function startXianyuConnectionRecovery(): void {
  window.setInterval(() => {
    if (!currentHookEnabled) {
      return;
    }
    const disconnected = findElementByExactText("连接中断，请重连");
    if (disconnected) {
      window.location.reload();
      return;
    }
    const quickEnter = findElementByExactText("快速进入");
    if (quickEnter) {
      quickEnter.click();
    }
  }, 10_000);
}

function startTicketPollOnAutomationEnable(): void {
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
    let wasExecutable = false;
    try {
      state = decodeStoredPluginState(newValue);
      const oldValue = (change as Record<string, unknown>).oldValue;
      wasExecutable = oldValue === undefined
        ? false
        : isExecutablePluginState(decodeStoredPluginState(oldValue));
    } catch {
      return;
    }
    if (!wasExecutable && isExecutablePluginState(state)) {
      window.dispatchEvent(new CustomEvent(TICKET_POLL_NOW_EVENT));
    }
  });
}

function isExecutablePluginState(
  state: import("../handlers/pluginState.ts").StoredPluginState
): boolean {
  return state.authStatus === "AUTHENTICATED" &&
    state.automationEnabled &&
    !state.safetyDisabled &&
    !state.remoteDisablePending;
}

function findElementByExactText(text: string): HTMLElement | null {
  return document.evaluate(
    `//*[text()="${text}"]`,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue as HTMLElement | null;
}

async function handleToolRequest(request: ToolRequest): Promise<unknown> {
  const response = await routeToolRequest(request);
  // background 失败时 sendResponse({success:false, error})，此处解包抛错，
  // 避免把错误包装当业务数据透传给页面（页面解码器会误报结构错误）。
  if (
    typeof response === "object" &&
    response !== null &&
    !Array.isArray(response) &&
    (response as Record<string, unknown>).success === false
  ) {
    const error = (response as Record<string, unknown>).error;
    throw new Error(typeof error === "string" && error.length > 0 ? error : "background request failed");
  }
  return response;
}

async function routeToolRequest(request: ToolRequest): Promise<unknown> {
  switch (request.action) {
    case "FETCH_IMAGE_DATA_URL":
      return chrome.runtime.sendMessage({
        type: "FETCH_IMAGE_DATA_URL",
        data: { url: requireString(request.payload.url, "url") }
      });
    case "GET_REPLY_CONFIG":
      requireEmptyPayload(request.payload, request.action);
      return chrome.runtime.sendMessage({ type: "GET_REPLY_CONFIG" });
    case "GET_AUTOMATION_CONFIG":
      requireEmptyPayload(request.payload, request.action);
      return chrome.runtime.sendMessage({ type: "GET_AUTOMATION_CONFIG" });
    case "AI_CUSTOMER_SERVICE":
      return chrome.runtime.sendMessage({
        type: "AI_CUSTOMER_SERVICE",
        data: {
          messageId: requireString(request.payload.messageId, "messageId"),
          chatId: requireString(request.payload.chatId, "chatId"),
          buyerUserId: requireString(request.payload.buyerUserId, "buyerUserId"),
          itemId: requireString(request.payload.itemId, "itemId"),
          content: requireString(request.payload.content, "content")
        }
      });
    case "QUOTE_IMAGE":
      return chrome.runtime.sendMessage({
        type: "QUOTE_IMAGE",
        data: {
          messageId: requireString(request.payload.messageId, "messageId"),
          originPlatform: requireEnum(request.payload.originPlatform, ["xianyu"] as const, "originPlatform"),
          chatId: requireString(request.payload.chatId, "chatId"),
          customerId: requireString(request.payload.customerId, "customerId"),
          customerName: requireString(request.payload.customerName, "customerName"),
          productId: requireString(request.payload.productId, "productId"),
          seatsImage: requireString(request.payload.seatsImage, "seatsImage")
        }
      });
    case "LOOKUP_WAITING_PAYMENT":
      return chrome.runtime.sendMessage({
        type: "LOOKUP_WAITING_PAYMENT",
        data: { chatId: requireString(request.payload.chatId, "chatId") }
      });
    case "BEGIN_PRICE_ADJUSTMENT":
      return chrome.runtime.sendMessage({
        type: "BEGIN_PRICE_ADJUSTMENT",
        data: {
          businessOrderId: requireString(request.payload.businessOrderId, "businessOrderId"),
          xianyuOrderId: requireString(request.payload.xianyuOrderId, "xianyuOrderId")
        }
      });
    case "SETTLE_PRICE_ADJUSTMENT":
      return chrome.runtime.sendMessage({
        type: "SETTLE_PRICE_ADJUSTMENT",
        data: {
          request: {
            id: requireString(request.payload.id, "id"),
            status: requireLiteral(request.payload.status, 25, "status"),
            xianyuOrderId: requireString(request.payload.xianyuOrderId, "xianyuOrderId")
          },
          permit: {
            effect: requireEnum(request.payload.effect, ["WRITE"] as const, "effect"),
            automationRevision: requireNonNegativeSafeInteger(
              request.payload.automationRevision,
              "automationRevision"
            )
          }
        }
      });
    case "LOOKUP_PAID_ORDER":
      return chrome.runtime.sendMessage({
        type: "LOOKUP_PAID_ORDER",
        data: { chatId: requireString(request.payload.chatId, "chatId") }
      });
    case "BEGIN_ORDER_DETAIL_READ":
      requireEmptyPayload(request.payload, request.action);
      return chrome.runtime.sendMessage({ type: "BEGIN_ORDER_DETAIL_READ" });
    case "COMPLETE_ORDER_DETAIL_READ":
      return chrome.runtime.sendMessage({
        type: "COMPLETE_ORDER_DETAIL_READ",
        data: {
          permit: {
            effect: requireEnum(request.payload.effect, ["READ"] as const, "effect"),
            automationRevision: requireNonNegativeSafeInteger(
              request.payload.automationRevision,
              "automationRevision"
            )
          }
        }
      });
    case "ADVANCE_PAID_ORDER":
      return chrome.runtime.sendMessage({
        type: "ADVANCE_PAID_ORDER",
        data: {
          id: requireString(request.payload.id, "id"),
          actualPaidAmountCents: requireNonNegativeSafeInteger(
            request.payload.actualPaidAmountCents,
            "actualPaidAmountCents"
          )
        }
      });
    case "BEGIN_MISMATCH_CANCELLATION":
      requireExactPayloadKeys(request.payload, ["id"], request.action);
      return chrome.runtime.sendMessage({
        type: "BEGIN_MISMATCH_CANCELLATION",
        data: { id: requireString(request.payload.id, "id") }
      });
    case "COMPLETE_MISMATCH_CANCELLATION":
      requireExactPayloadKeys(request.payload, [
        "businessOrderId",
        "actualAmount",
        "cancellation",
        "effect",
        "automationRevision"
      ], request.action);
      return chrome.runtime.sendMessage({
        type: "COMPLETE_MISMATCH_CANCELLATION",
        data: {
          request: {
            businessOrderId: requireString(
              request.payload.businessOrderId,
              "businessOrderId"
            ),
            actualAmount: requirePositiveAmount(request.payload.actualAmount, "actualAmount"),
            cancellation: decodePaidSellerCancellation(request.payload.cancellation)
          },
          permit: {
            effect: requireEnum(request.payload.effect, ["WRITE"] as const, "effect"),
            automationRevision: requireNonNegativeSafeInteger(
              request.payload.automationRevision,
              "automationRevision"
            )
          }
        }
      });
    case "GET_TICKET_RESULTS":
      requireEmptyPayload(request.payload, request.action);
      return chrome.runtime.sendMessage({ type: "GET_TICKET_RESULTS" });
    case "BEGIN_TICKET_DELIVERY":
      requireExactPayloadKeys(request.payload, ["id"], request.action);
      return chrome.runtime.sendMessage({
        type: "BEGIN_TICKET_DELIVERY",
        data: { id: requireString(request.payload.id, "id") }
      });
    case "ABORT_TICKET_DELIVERY":
      requireExactPayloadKeys(
        request.payload,
        ["id", "effect", "automationRevision"],
        request.action
      );
      return chrome.runtime.sendMessage({
        type: "ABORT_TICKET_DELIVERY",
        data: {
          id: requireString(request.payload.id, "id"),
          permit: {
            effect: requireEnum(request.payload.effect, ["WRITE"] as const, "effect"),
            automationRevision: requireNonNegativeSafeInteger(
              request.payload.automationRevision,
              "automationRevision"
            )
          }
        }
      });
    case "SETTLE_TICKET_RESULT":
      return chrome.runtime.sendMessage({
        type: "SETTLE_TICKET_RESULT",
        data: {
          request: decodeTicketSettlementRequest(request.payload),
          permit: {
            effect: requireEnum(request.payload.effect, ["WRITE"] as const, "effect"),
            automationRevision: requireNonNegativeSafeInteger(
              request.payload.automationRevision,
              "automationRevision"
            )
          }
        }
      });
    default:
      return assertNever(request.action);
  }
}

function respond(requestId: string, detail: unknown): void {
  window.dispatchEvent(new CustomEvent(`${RESPONSE_EVENT}:${requestId}`, { detail }));
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, context: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value)) {
    throw new Error(`${context} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
  return value;
}

function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${context} must be a boolean`);
  }
  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], context: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${context} is not defined: ${String(value)}`);
  }
  return value as T;
}


function requirePositiveSafeInteger(value: unknown, context: string): number {
  const result = requireNonNegativeSafeInteger(value, context);
  if (result === 0) throw new Error(`${context} must be positive`);
  return result;
}

function requirePositiveAmount(value: unknown, context: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(value))
  ) {
    throw new Error(`${context} must be a positive RMB amount with at most two decimals`);
  }
  return value;
}

function requireNonNegativeSafeInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative safe integer`);
  }
  return value;
}

function requireLiteral<T extends string | number | boolean>(
  value: unknown,
  expected: T,
  context: string
): T {
  if (value !== expected) {
    throw new Error(`${context} must equal ${String(expected)}`);
  }
  return expected;
}

function requireEmptyPayload(value: Record<string, unknown>, context: string): void {
  if (Object.keys(value).length !== 0) throw new Error(`${context} payload must be empty`);
}

function decodePaidSellerCancellation(
  value: unknown
): import("../handlers/paidVerificationAutomation.ts").PaidSellerCancellationResult {
  const cancellation = requireRecord(value, "cancellation");
  if (cancellation.issued === false) {
    requireExactPayloadKeys(cancellation, ["issued"], "cancellation");
    return { issued: false };
  }
  requireExactPayloadKeys(
    cancellation,
    ["issued", "succeeded"],
    "cancellation"
  );
  return {
    issued: requireLiteral(cancellation.issued, true, "cancellation issued"),
    succeeded: requireBoolean(cancellation.succeeded, "cancellation succeeded")
  };
}

function decodeTicketSettlementRequest(
  payload: Record<string, unknown>
): import("../handlers/backendApi.ts").UpdateOrderResultRequest {
  const id = requireString(payload.id, "id");
  const result = requireEnum(payload.result, [
    "DELIVERY_SUCCEEDED",
    "DELIVERY_FAILED",
    "TICKET_FAILURE_HANDLED"
  ] as const, "result");
  if (result === "DELIVERY_SUCCEEDED") {
    requireExactPayloadKeys(
      payload,
      ["id", "result", "effect", "automationRevision"],
      "DELIVERY_SUCCEEDED"
    );
    return { id, result };
  }
  if (result === "DELIVERY_FAILED") {
    requireExactPayloadKeys(
      payload,
      [
        "id",
        "result",
        "failureStage",
        "sentImageCount",
        "effect",
        "automationRevision"
      ],
      "DELIVERY_FAILED"
    );
    return {
      id,
      result,
      failureStage: requireEnum(
        payload.failureStage,
        ["TICKET_IMAGE", "SUCCESS_MESSAGE"] as const,
        "failureStage"
      ),
      sentImageCount: requireNonNegativeSafeInteger(
        payload.sentImageCount,
        "sentImageCount"
      )
    };
  }
  requireExactPayloadKeys(
    payload,
    [
      "id",
      "result",
      "noticeSent",
      "cancelSucceeded",
      "effect",
      "automationRevision"
    ],
    "TICKET_FAILURE_HANDLED"
  );
  return {
    id,
    result,
    noticeSent: requireBoolean(payload.noticeSent, "noticeSent"),
    cancelSucceeded: requireBoolean(payload.cancelSucceeded, "cancelSucceeded")
  };
}

function requireExactPayloadKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  context: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${context} payload has an unexpected structure`);
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled tool action: ${String(value)}`);
}

type CaptureAction = typeof CAPTURE_ACTIONS[number];
type CaptureScenario = typeof CAPTURE_SCENARIOS[number];
type CaptureCommand =
  | { action: "START"; scenario: CaptureScenario }
  | { action: Exclude<CaptureAction, "START">; scenario?: never };
