import {
  decodeToolRequest,
  mapDeliveryResultRequest,
  mapTradeBackendRequest,
  type ToolRequest
} from "./types";

const REQUEST_EVENT = "FILM_AI_LOCAL_TOOL_REQUEST";
const RESPONSE_EVENT = "FILM_AI_LOCAL_TOOL_RESPONSE";
const CONTENT_VERSION = "2026-07-04-debug-bridge";
const CAPTURE_MESSAGE_TYPE = "XIANYU_PROTOCOL_CAPTURE";
const CAPTURE_REQUEST_EVENT = "FILM_AI_XIANYU_CAPTURE_REQUEST";
const CAPTURE_RESPONSE_EVENT = "FILM_AI_XIANYU_CAPTURE_RESPONSE";
const CAPTURE_RESPONSE_TIMEOUT_MS = 5_000;
const CAPTURE_ACTIONS = ["START", "STOP", "CLEAR", "STATUS", "EXPORT"] as const;
const CAPTURE_SCENARIOS = ["TEXT", "IMAGE", "WAIT_PAYMENT", "PAID", "OTHER"] as const;

document.documentElement.setAttribute("data-xianyu-movie-ticket-content", CONTENT_VERSION);

void injectPageScripts();
startXianyuAccountWatcher();

window.addEventListener(REQUEST_EVENT, (event) => {
  const detail = decodeToolRequest((event as CustomEvent<unknown>).detail);
  handleToolRequest(detail)
    .then((payload) => respond(detail.requestId, { success: true, payload }))
    .catch((error) => respond(detail.requestId, { success: false, error: error instanceof Error ? error.message : String(error) }));
});

chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
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

async function injectPageScripts(): Promise<void> {
  const msgpackReady = injectScript("libs/msgpack.min.js");
  await injectScript("js/xianyuPageHook.js");
  await msgpackReady;
  document.documentElement.setAttribute("data-xianyu-movie-ticket-content-ready", CONTENT_VERSION);
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

function startXianyuAccountWatcher(): void {
  let lastReportedAccountId: string | null = null;
  const reportIfChanged = () => {
    const accountId = readCookie("unb");
    if (accountId === lastReportedAccountId) return;
    lastReportedAccountId = accountId;
    void chrome.runtime.sendMessage({
      type: "REPORT_XIANYU_ACCOUNT",
      data: { accountId, observedAt: new Date().toISOString() }
    });
  };
  reportIfChanged();
  window.setInterval(reportIfChanged, 5000);
}

function readCookie(name: string): string {
  const prefix = `${name}=`;
  const item = document.cookie.split("; ").find((entry) => entry.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : "";
}

function injectScript(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(path);
    script.onload = () => {
      script.remove();
      resolve();
    };
    script.onerror = () => reject(new Error(`inject failed: ${path}`));
    (document.head || document.documentElement).appendChild(script);
  });
}

async function handleToolRequest(request: ToolRequest): Promise<unknown> {
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
    case "QUOTE_IMAGE": {
      const imageBase64 = request.payload.imageBase64 === undefined
        ? await imageUrlToDataUrl(optionalString(request.payload.imageUrl, "imageUrl"))
        : requireString(request.payload.imageBase64, "imageBase64");
      return postBackend("/api/xianyu/messages/image", {
        chatId: requireString(request.payload.chatId, "chatId"),
        messageId: requireString(request.payload.messageId, "messageId"),
        buyerUserId: requireString(request.payload.buyerUserId, "buyerUserId"),
        buyerNickname: optionalString(request.payload.buyerNickname, "buyerNickname"),
        itemId: requireString(request.payload.itemId, "itemId"),
        imageBase64
      });
    }
    case "POLL_ORDER": {
      const platformOrderId = requireString(request.payload.platformOrderId, "platformOrderId");
      return getBackend(`/api/xianyu/orders/${encodeURIComponent(platformOrderId)}`);
    }
    case "PENDING_DELIVERIES":
      requireEmptyPayload(request.payload, request.action);
      return getBackend("/api/xianyu/deliveries/pending");
    case "DELIVERY_RESULT":
      return chrome.runtime.sendMessage({
        type: "API_REQUEST",
        data: mapDeliveryResultRequest(request.payload)
      });
    case "CLAIM_DELIVERY": {
      const platformOrderId = requireString(request.payload.platformOrderId, "platformOrderId");
      return postBackend(`/api/xianyu/deliveries/${encodeURIComponent(platformOrderId)}/claim`, {});
    }
    case "AGISO_TRADE_LIST":
    case "AGISO_ADJUST_PRICE":
    case "AGISO_SEND_DUMMY":
      throw new Error("Agiso bridge payload contract is not confirmed");
    case "RECORD_AGISO_FALLBACK":
      return chrome.runtime.sendMessage({
        type: "RECORD_AGISO_FALLBACK",
        data: {
          action: requireString(request.payload.action, "action"),
          reason: requireString(request.payload.reason, "reason"),
          orderId: optionalString(request.payload.orderId, "orderId"),
          tradeNo: optionalString(request.payload.tradeNo, "tradeNo"),
          ok: optionalBoolean(request.payload.ok, "ok")
        }
      });
    case "REGISTER_WAITING_PAYMENT":
    case "RECORD_ADJUSTED":
    case "RESOLVE_ACTIVE_ORDER":
    case "VERIFY_PAID":
    case "RECORD_VERIFICATION_FAILURE":
    case "RECORD_PROTOCOL_EVENT":
      return chrome.runtime.sendMessage({
        type: "API_REQUEST",
        data: mapTradeBackendRequest(request.action, request.payload)
      });
    default:
      return assertNever(request.action);
  }
}

function respond(requestId: string, detail: unknown): void {
  window.dispatchEvent(new CustomEvent(`${RESPONSE_EVENT}:${requestId}`, { detail }));
}

async function postBackend(url: string, body: unknown): Promise<unknown> {
  return chrome.runtime.sendMessage({ type: "API_REQUEST", data: { method: "POST", url, body } });
}

async function getBackend(url: string): Promise<unknown> {
  return chrome.runtime.sendMessage({ type: "API_REQUEST", data: { method: "GET", url } });
}

async function imageUrlToDataUrl(url?: string): Promise<string> {
  if (!url) {
    throw new Error("missing image url");
  }
  const result = await chrome.runtime.sendMessage({ type: "FETCH_IMAGE_DATA_URL", data: { url } });
  const response = requireRecord(result, "image fetch response");
  if (response.success !== true) {
    throw new Error(requireString(response.error, "image fetch error"));
  }
  return requireString(response.dataUrl, "image fetch dataUrl");
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

function optionalBoolean(value: unknown, context: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return requireBoolean(value, context);
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], context: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${context} is not defined: ${String(value)}`);
  }
  return value as T;
}

function optionalString(value: unknown, context: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, context);
}

function requirePositiveSafeInteger(value: unknown, context: string): number {
  const result = requireNonNegativeSafeInteger(value, context);
  if (result === 0) throw new Error(`${context} must be positive`);
  return result;
}

function requireNonNegativeSafeInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative safe integer`);
  }
  return value;
}

function requireEmptyPayload(value: Record<string, unknown>, context: string): void {
  if (Object.keys(value).length !== 0) throw new Error(`${context} payload must be empty`);
}

function assertNever(value: never): never {
  throw new Error(`unhandled tool action: ${String(value)}`);
}

type CaptureAction = typeof CAPTURE_ACTIONS[number];
type CaptureScenario = typeof CAPTURE_SCENARIOS[number];
type CaptureCommand =
  | { action: "START"; scenario: CaptureScenario }
  | { action: Exclude<CaptureAction, "START">; scenario?: never };
