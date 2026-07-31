export type RuntimeRequest =
  | { type: "API_REQUEST"; data: ApiRequest }
  | { type: "AGISO_API_REQUEST"; data: ApiRequest }
  | { type: "GET_CONFIG" }
  | { type: "SAVE_CONFIG"; data: ExtensionConfig }
  | { type: "ACTIVATE_AGENT" }
  | { type: "GET_AGENT_STATUS" }
  | { type: "REPORT_XIANYU_ACCOUNT"; data: XianyuAccountSnapshot }
  | { type: "GET_REPLY_CONFIG" }
  | { type: "SAVE_REPLY_CONFIG"; data: ReplyConfig }
  | { type: "GET_AUTOMATION_CONFIG" }
  | { type: "SAVE_AUTOMATION_CONFIG"; data: AutomationConfig }
  | { type: "SET_AGISO_TOKEN"; data: { token: string } }
  | { type: "GET_AGISO_STATUS" }
  | { type: "RECORD_AGISO_FALLBACK"; data: AgisoFallbackRecord }
  | { type: "FETCH_IMAGE_DATA_URL"; data: { url: string } };

export interface ApiRequest {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

export interface ExtensionConfig {
  backendBaseUrl: string;
  pluginApiToken: string;
  installationId?: string;
}

export interface AgentRuntimeStatus {
  installationId: string;
  state: "UNCONFIGURED" | "ACTIVE" | "ERROR";
  message: string;
  checkedAt: string;
}

export interface XianyuAccountSnapshot {
  accountId: string;
  nickname?: string;
  observedAt: string;
}

export const TOOL_ACTIONS = [
  "FETCH_IMAGE_DATA_URL",
  "GET_REPLY_CONFIG",
  "GET_AUTOMATION_CONFIG",
  "QUOTE_IMAGE",
  "POLL_ORDER",
  "PENDING_DELIVERIES",
  "DELIVERY_RESULT",
  "CLAIM_DELIVERY",
  "AGISO_TRADE_LIST",
  "AGISO_ADJUST_PRICE",
  "AGISO_SEND_DUMMY",
  "RECORD_AGISO_FALLBACK",
  "REGISTER_WAITING_PAYMENT",
  "RECORD_ADJUSTED",
  "RESOLVE_ACTIVE_ORDER",
  "VERIFY_PAID",
  "RECORD_VERIFICATION_FAILURE",
  "RECORD_PROTOCOL_EVENT"
] as const;

export type ToolAction = typeof TOOL_ACTIONS[number];

export interface ToolRequest {
  requestId: string;
  action: ToolAction;
  payload: Record<string, unknown>;
}

export function decodeToolRequest(value: unknown): ToolRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("tool request must be an object");
  }
  const request = value as Record<string, unknown>;
  if (typeof request.requestId !== "string" || request.requestId.length === 0) {
    throw new Error("tool requestId must be a non-empty string");
  }
  if (typeof request.action !== "string" || !TOOL_ACTIONS.includes(request.action as ToolAction)) {
    throw new Error(`tool action is not defined: ${String(request.action)}`);
  }
  if (typeof request.payload !== "object" || request.payload === null || Array.isArray(request.payload)) {
    throw new Error("tool payload must be an object");
  }
  return {
    requestId: request.requestId,
    action: request.action as ToolAction,
    payload: request.payload as Record<string, unknown>
  };
}

const TRADE_BACKEND_ACTIONS = [
  "REGISTER_WAITING_PAYMENT",
  "RECORD_ADJUSTED",
  "RESOLVE_ACTIVE_ORDER",
  "VERIFY_PAID",
  "RECORD_VERIFICATION_FAILURE",
  "RECORD_PROTOCOL_EVENT"
] as const;

export type TradeBackendAction = typeof TRADE_BACKEND_ACTIONS[number];

const TRADE_VERIFICATION_FAILURE_CODES = [
  "ADJUST_PRICE_REJECTED",
  "ORDER_DETAIL_REQUEST_FAILED",
  "ORDER_DETAIL_PROTOCOL_ERROR",
  "ORDER_ID_MISMATCH",
  "AMOUNT_MISMATCH",
  "NON_ZERO_POST_FEE",
  "MISSING_ADJUSTMENT"
] as const;

export function mapTradeBackendRequest(
  action: TradeBackendAction,
  payload: Record<string, unknown>
): ApiRequest {
  switch (action) {
    case "REGISTER_WAITING_PAYMENT":
      return {
        method: "POST",
        url: "/api/xianyu/orders/waiting-payment",
        body: {
          platformOrderId: requireToolString(payload.platformOrderId, "platformOrderId"),
          chatId: requireToolString(payload.chatId, "chatId"),
          buyerUserId: requireToolString(payload.buyerUserId, "buyerUserId"),
          sellerUserId: optionalToolString(payload.sellerUserId, "sellerUserId"),
          itemId: requireToolString(payload.itemId, "itemId"),
          messageId: requireToolString(payload.messageId, "messageId")
        }
      };
    case "RECORD_ADJUSTED": {
      const platformOrderId = requireToolString(payload.platformOrderId, "platformOrderId");
      return {
        method: "POST",
        url: `/api/xianyu/orders/${encodeURIComponent(platformOrderId)}/adjusted`,
        body: {
          adjustedAmountCents: requireToolPositiveSafeInteger(
            payload.adjustedAmountCents,
            "adjustedAmountCents"
          )
        }
      };
    }
    case "RESOLVE_ACTIVE_ORDER": {
      const chatId = requireToolString(payload.chatId, "chatId");
      return {
        method: "GET",
        url: `/api/xianyu/orders/waiting-payment/${encodeURIComponent(chatId)}`
      };
    }
    case "VERIFY_PAID": {
      const platformOrderId = requireToolString(payload.platformOrderId, "platformOrderId");
      return {
        method: "POST",
        url: `/api/xianyu/orders/${encodeURIComponent(platformOrderId)}/paid-verification`,
        body: {
          paidAmountCents: requireToolPositiveSafeInteger(payload.paidAmountCents, "paidAmountCents"),
          itemTotalCents: requireToolPositiveSafeInteger(payload.itemTotalCents, "itemTotalCents"),
          postFeeCents: requireToolNonNegativeSafeInteger(payload.postFeeCents, "postFeeCents"),
          source: requireToolEnum(
            payload.source,
            ["XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT"] as const,
            "source"
          )
        }
      };
    }
    case "RECORD_VERIFICATION_FAILURE": {
      const platformOrderId = requireToolString(payload.platformOrderId, "platformOrderId");
      return {
        method: "POST",
        url: `/api/xianyu/orders/${encodeURIComponent(platformOrderId)}/verification-failures`,
        body: {
          code: requireToolEnum(payload.code, TRADE_VERIFICATION_FAILURE_CODES, "code")
        }
      };
    }
    case "RECORD_PROTOCOL_EVENT": {
      const eventType = requireToolString(payload.eventType, "eventType");
      const chatId = requireToolString(payload.chatId, "chatId");
      return {
        method: "POST",
        url: "/api/xianyu/events",
        body: {
          eventType,
          chatId,
          messageId: `${eventType}:${chatId}`
        }
      };
    }
    default:
      return assertNeverTradeBackendAction(action);
  }
}

const DELIVERY_FAILURE_SUMMARIES = [
  "DELIVERY_TEMPLATE_FAILED",
  "TICKET_CODE_SEND_FAILED",
  "DUMMY_CONSIGN_FAILED"
] as const;

export function mapDeliveryResultRequest(payload: Record<string, unknown>): ApiRequest {
  const platformOrderId = requireToolString(payload.platformOrderId, "platformOrderId");
  const attemptId = requireToolString(payload.attemptId, "attemptId");
  const success = requireToolBoolean(payload.success, "success");
  const channel = requireToolEnum(payload.channel, ["xianyu-mtop"] as const, "channel");
  let errorMessage: string;
  if (success) {
    if (payload.errorMessage !== "") {
      throw new Error("errorMessage must be empty for successful delivery");
    }
    errorMessage = "";
  } else {
    errorMessage = requireToolEnum(payload.errorMessage, DELIVERY_FAILURE_SUMMARIES, "errorMessage");
  }
  return {
    method: "POST",
    url: `/api/xianyu/deliveries/${encodeURIComponent(platformOrderId)}/result`,
    body: { attemptId, success, channel, errorMessage }
  };
}

function requireToolString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function optionalToolString(value: unknown, context: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireToolString(value, context);
}

function requireToolBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${context} must be a boolean`);
  }
  return value;
}

function requireToolPositiveSafeInteger(value: unknown, context: string): number {
  const result = requireToolNonNegativeSafeInteger(value, context);
  if (result === 0) throw new Error(`${context} must be positive`);
  return result;
}

function requireToolNonNegativeSafeInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative safe integer`);
  }
  return value;
}

function requireToolEnum<T extends string>(value: unknown, allowed: readonly T[], context: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${context} is not defined: ${String(value)}`);
  }
  return value as T;
}

function assertNeverTradeBackendAction(value: never): never {
  throw new Error(`unhandled trade backend action: ${String(value)}`);
}

export interface ReplyConfig {
  xianyuReplyMessageTemplates: ReplyTemplateMap;
  xianyuKeywordReplyRules: KeywordReplyRule[];
  xianyuAutoReplyTextFallback: boolean;
}

export interface AutomationConfig {
  autoReply: boolean;
  xianyuDeliverSendImageEnabled: boolean;
}

export interface AgisoFallbackRecord {
  action: string;
  reason: string;
  orderId?: string;
  tradeNo?: string;
  ok?: boolean;
  request?: unknown;
  response?: unknown;
}

export interface StoredAgisoFallbackRecord extends AgisoFallbackRecord {
  at: string;
}

export interface AgisoStatus {
  hasToken: boolean;
  tokenPreview: string;
  tokenUpdatedAt: string;
  lastRequestAt: string;
  lastRequestAction: string;
  lastRequestOk: boolean | null;
  lastRequestStatus: number | null;
  lastRequestSummary: string;
  fallbackRecords: StoredAgisoFallbackRecord[];
}

export type ReplyTemplateMap = Record<string, string>;

export interface KeywordReplyRule {
  id?: string;
  enabled: boolean;
  keywords: string[];
  priority: number;
  reply: string;
}
