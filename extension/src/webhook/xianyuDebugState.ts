/**
 * 页面 hook 的调试状态与脱敏工具。
 *
 * 集中管理 hook 运行时的调试状态（debugState）、控制台 trace 日志、DOM 调试属性
 * 发布，以及日志中所有标识符/敏感词的脱敏与摘要工具。页面主 hook 模块只负责
 * 业务分发，不再混入这些诊断细节。所有标识符（chatId、orderId 等）与敏感内容
 * 在日志中一律脱敏，Token/票码/图片内容绝不进入日志。
 */
import type { XianyuInboundEvent } from "./xianyuProtocol.ts";

/** 控制台日志前缀。 */
export const LOG_PREFIX = "[xianyu-ticket]";
/** hook 版本标识。 */
export const HOOK_VERSION = "2026-08-01-detailed-flow-logging";
/** 调试状态查询的响应事件名。 */
export const STATUS_RESPONSE_EVENT = "FILM_AI_XIANYU_STATUS_RESPONSE";

/** 最近收到的消息摘要（供调试面板查看，最多保留 10 条）。 */
export interface DebugMessage {
  at: string;
  stage: string;
  kind: XianyuInboundEvent["kind"];
  chatId: string;
  senderId: string;
  messageId: string;
}

/** hook 的完整调试状态：连接、消息计数、最近请求/响应与错误。 */
export interface DebugState {
  hookVersion: string;
  injectedAt: string;
  hookEnabled: boolean;
  socketHookInstalled: boolean;
  socketConnected: boolean;
  rawMessages: number;
  decodedMessages: number;
  lastRawAt: string;
  lastDecodedAt: string;
  lastSocketFrameShape: string;
  lastContent: string;
  lastChatId: string;
  lastSenderId: string;
  lastReply: string;
  lastError: string;
  msgpackAvailable: boolean;
  lastSendOk: boolean;
  lastSendCid: string;
  lastSendReceiverId: string;
  lastWaitPayRequest: string;
  lastWaitPayResponse: string;
  lastAdjustRequest: string;
  lastAdjustResponse: string;
  lastAdjustFailure: string;
  lastAdjustAttempt: number;
  lastAdjustStartedAt: string;
  lastAdjustFinishedAt: string;
  lastHeadInfoRequest: string;
  lastHeadInfoResponse: string;
  lastPaidRequest: string;
  lastPaidResponse: string;
  lastCancelRequest: string;
  lastCancelResponse: string;
  lastCancelFailure: string;
  lastCancelAttempt: number;
  lastCancelStartedAt: string;
  lastCancelFinishedAt: string;
  recentMessages: DebugMessage[];
}

let traceSequence = 0;

/**
 * 日志总开关：临时关闭全部控制台输出（含 warn/error）。
 * 开发调试期保持 true；上线前恢复 false 保持生产静默。
 */
const LOGGING_ENABLED = true;

/**
 * 是否启用常规业务日志（info 级）：开发构建默认开启；正式构建需显式设置
 * VITE_TRACE_ENABLED=true 才打印，避免生产环境刷屏。受 LOGGING_ENABLED 总开关控制。
 */
const INFO_LOGGING_ENABLED = (import.meta.env.DEV || import.meta.env.VITE_TRACE_ENABLED === "true") && LOGGING_ENABLED;

/** 调试状态单例，各页面桥接模块共享。 */
export const debugState: DebugState = {
  hookVersion: HOOK_VERSION,
  injectedAt: new Date().toISOString(),
  hookEnabled: false,
  socketHookInstalled: false,
  socketConnected: false,
  rawMessages: 0,
  decodedMessages: 0,
  lastRawAt: "",
  lastDecodedAt: "",
  lastSocketFrameShape: "",
  lastContent: "",
  lastChatId: "",
  lastSenderId: "",
  lastReply: "",
  lastError: "",
  msgpackAvailable: false,
  lastSendOk: false,
  lastSendCid: "",
  lastSendReceiverId: "",
  lastWaitPayRequest: "",
  lastWaitPayResponse: "",
  lastAdjustRequest: "",
  lastAdjustResponse: "",
  lastAdjustFailure: "",
  lastAdjustAttempt: 0,
  lastAdjustStartedAt: "",
  lastAdjustFinishedAt: "",
  lastHeadInfoRequest: "",
  lastHeadInfoResponse: "",
  lastPaidRequest: "",
  lastPaidResponse: "",
  lastCancelRequest: "",
  lastCancelResponse: "",
  lastCancelFailure: "",
  lastCancelAttempt: 0,
  lastCancelStartedAt: "",
  lastCancelFinishedAt: "",
  recentMessages: []
};

/** 记录一次常规业务日志（console.info）；受总开关与 info 开关控制。 */
export function trace(stage: string, details: Record<string, unknown> = {}): void {
  if (!INFO_LOGGING_ENABLED) {
    return;
  }
  console.info(LOG_PREFIX, {
    sequence: ++traceSequence,
    at: new Date().toISOString(),
    stage,
    ...details
  });
}

/** 记录一次警告日志（console.warn）；受总开关控制，当前已关闭。 */
export function traceWarn(stage: string, details: Record<string, unknown> = {}): void {
  if (!LOGGING_ENABLED) {
    return;
  }
  console.warn(LOG_PREFIX, {
    sequence: ++traceSequence,
    at: new Date().toISOString(),
    stage,
    ...details
  });
}

/** 记录一次错误日志（console.error）；受总开关控制，当前已关闭。 */
export function traceError(
  stage: string,
  error: unknown,
  details: Record<string, unknown> = {}
): void {
  if (!LOGGING_ENABLED) {
    return;
  }
  console.error(LOG_PREFIX, {
    sequence: ++traceSequence,
    at: new Date().toISOString(),
    stage,
    ...details,
    error: safeErrorMessage(error)
  });
}

/** 标识符脱敏：只保留后 4 位，其余替换为 ***。 */
export function maskIdentifier(value: string): string {
  if (!value) return "";
  return value.length <= 4 ? "***" : `***${value.slice(-4)}`;
}

/** 消息文本脱敏：把 QQ / Q群 等敏感词替换为 ***。 */
export function maskSensitiveWords(text: string): string {
  return ["QQ", "Q群"].reduce((value, word) => value.replaceAll(word, "***"), text);
}

/** 判断未知值是否为普通对象。 */
export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 获取完整调试状态（含 msgpack 可用性）。 */
export function getDebugStatus(): Record<string, unknown> {
  return {
    ...debugState,
    msgpackAvailable: Boolean((window as { msgpack?: unknown }).msgpack)
  };
}

/** 把调试状态写入 DOM 属性，供页面/插件读取，不打印到控制台。 */
export function publishDebugStatus(status: Record<string, unknown> = getDebugStatus()): void {
  document.documentElement.setAttribute("data-xianyu-movie-ticket-hook", HOOK_VERSION);
  document.documentElement.setAttribute("data-xianyu-movie-ticket-injected-at", debugState.injectedAt);
  document.documentElement.setAttribute("data-xianyu-movie-ticket-last-error", debugState.lastError);
  document.documentElement.setAttribute("data-xianyu-movie-ticket-status", safeJsonPreview(status));
}

/** 记录一次 WebSocket 消息解析失败：写状态、发布并输出错误日志。 */
export function recordSocketFailure(error: unknown, frame: unknown): void {
  debugState.lastError = safeErrorMessage(error);
  debugState.lastSocketFrameShape = describeSocketFrame(frame);
  publishDebugStatus();
  traceError("websocket:message-failed", error, { frame: debugState.lastSocketFrameShape });
}

/** 响应调试状态查询：发布 DOM 属性并派发响应事件。 */
export function emitDebugStatus(): Record<string, unknown> {
  const status = getDebugStatus();
  publishDebugStatus(status);
  window.dispatchEvent(new CustomEvent(STATUS_RESPONSE_EVENT, { detail: status }));
  return status;
}

/** 记录一条已解码事件到最近消息列表（保留最近 10 条）。 */
export function rememberDebugEvent(event: XianyuInboundEvent, stage: string): void {
  debugState.recentMessages.unshift({
    at: new Date().toISOString(),
    stage,
    kind: event.kind,
    chatId: "chatId" in event ? event.chatId : "",
    senderId: "senderId" in event ? event.senderId : "",
    messageId: "messageId" in event ? event.messageId : ""
  });
  debugState.recentMessages = debugState.recentMessages.slice(0, 10);
}

/**
 * 业务日志（始终打印，不受 LOGGING_ENABLED 总开关控制）。
 * 与参考插件一致的风格：每个业务动作打一条「参数」，完成后打一条「结果」，
 * 便于跟进报价/改价/验款/交付链路。标识符在 details 中自行脱敏。
 */
export function logBiz(stage: string, details: Record<string, unknown> = {}): void {
  console.info(LOG_PREFIX, {
    stage: `✅ ${stage}`,
    at: new Date().toISOString(),
    ...details
  });
}

/** 业务失败日志（始终打印），错误信息先脱敏。 */
export function logBizError(
  stage: string,
  error: unknown,
  details: Record<string, unknown> = {}
): void {
  console.error(LOG_PREFIX, {
    stage: `❌ ${stage}`,
    at: new Date().toISOString(),
    ...details,
    error: safeErrorMessage(error)
  });
}

/** 出站 WebSocket 消息摘要：只保留结构信息，不打印消息正文。 */
export function describeOutgoingWebSocketPayload(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecordValue(parsed)) return { type: Array.isArray(parsed) ? "array" : typeof parsed };
    const body = parsed.body;
    return {
      rootKeys: Object.keys(parsed).sort(),
      lwp: typeof parsed.lwp === "string" ? parsed.lwp : undefined,
      bodyType: body === null ? "null" : Array.isArray(body) ? "array" : typeof body,
      bodyLength: Array.isArray(body) ? body.length : undefined
    };
  } catch {
    return { type: "non-json", length: value.length };
  }
}

/** 入站消息帧摘要：只保留根键与 body 形状。 */
export function describeSocketFrame(value: unknown): string {
  if (typeof value !== "string") {
    return `transport=${typeof value}`;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return `json=${Array.isArray(parsed) ? "array" : typeof parsed}`;
    }
    const root = parsed as Record<string, unknown>;
    const body = root.body;
    const bodyType = body === null ? "null" : Array.isArray(body) ? "array" : typeof body;
    const bodyKeys = typeof body === "object" && body !== null && !Array.isArray(body)
      ? Object.keys(body as Record<string, unknown>).sort()
      : [];
    return safeJsonPreview({
      rootKeys: Object.keys(root).sort(),
      bodyType,
      bodyKeys,
      bodyLength: typeof body === "string" || Array.isArray(body) ? body.length : undefined
    });
  } catch {
    return "json=invalid";
  }
}

/** 把值序列化为 JSON 摘要（截断到 800 字符），不可序列化则抛错。 */
export function safeJsonPreview(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("diagnostic value is not JSON serializable");
  return serialized.slice(0, 800);
}

/** 错误消息脱敏：抹掉授权/Cookie/Token 等敏感值并压缩换行，截断到 240 字符。 */
export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : safeObjectErrorMessage(error);
  const redacted = message
    .replace(/(authorization|cookie|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/[\r\n]+/g, " ")
    .trim();
  return (redacted || "unknown error").slice(0, 240);
}

/** 非 Error 对象的错误摘要：提取 ret/code/message 等关键字段。 */
function safeObjectErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return String(error);
  }
  const record = error as Record<string, unknown>;
  const details: string[] = [];
  const ret = record.ret;
  if (Array.isArray(ret) && typeof ret[0] === "string") {
    details.push(`ret=${ret[0].split("::", 1)[0]}`);
  }
  for (const key of ["code", "errorCode", "type", "message", "errorMessage"]) {
    if (typeof record[key] === "string" && record[key]) {
      details.push(`${key}=${record[key]}`);
    }
  }
  if (details.length > 0) {
    return details.join(" ");
  }
  return `object error keys=${Object.keys(record).sort().join(",")}`;
}
