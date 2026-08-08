/**
 * 后端后端客户端（生产路径）。
 *
 * 生产调用链：插件 → FastAPI/SQLite → 后端内部良票服务。
 * 本模块实现 BackendApiClient 领域契约，底层请求 后端的 /api/v1/plugin/* 接口：
 *   - 统一信封 { code, message, data, requestId }，code === 0 为成功；
 *   - 请求头携带 Bearer Token（用户 ID 由后端从 JWT 解析，插件不传）；
 *   - HTTP 401 → TOKEN_INVALID；其他业务错误保留 code 与 message；
 *   - sync 自动注册本地持久化的设备 ID（plugin_device）。
 */
import {
  BackendApiError,
  createFetchBackendTransport,
  decodeAiReply,
  decodeAutomation,
  decodeNull,
  decodeOrderByStatus,
  decodeQuoteTaskResult,
  decodeReplyConfig,
  decodeReplyConfigVersion,
  decodeSync,
  decodeTicketResults,
  decodeWaitingPaymentOrder,
  type AiReplyRequest,
  type AiReplyResult,
  type AutomationState,
  type BackendApiClient,
  type BackendTransport,
  type CreateQuoteTaskRequest,
  type OrderByStatus,
  type QuoteTaskResult,
  type ReplyConfig,
  type SyncState,
  type TicketResult,
  type UpdateOrderResultRequest,
  type UpdateOrderStatusRequest,
  type WaitingPaymentOrder,
  validateCreateQuoteTaskRequest,
  validateUpdateOrderStatusRequest,
  validateUpdateOrderResultRequest,
} from "./backendApi.ts";
import type { KeyValueStorage } from "../upstream/backendConfig.ts";

/** 设备 ID 存储 key（插件本地生成一次，后端 plugin_device 按用户+设备 upsert）。 */
const BACKEND_DEVICE_ID_STORAGE_KEY = "backendDeviceIdV1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function protocol(message: string): BackendApiError {
  return new BackendApiError("PROTOCOL", message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw protocol(`${path} must be an object`);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw protocol(`${path} has unknown field ${key}`);
    }
  }
  for (const key of keys) {
    if (!(key in value)) {
      throw protocol(`${path} is missing ${key}`);
    }
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw protocol(`${path} must be a non-empty string`);
  }
  return value;
}

/** 生成一次性设备 ID（优先 crypto.randomUUID）。 */
function newDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** 读取或生成本机设备 ID（持久化在 chrome.storage.local）。 */
async function loadOrCreateDeviceId(storage: KeyValueStorage): Promise<string> {
  const stored = await storage.get(BACKEND_DEVICE_ID_STORAGE_KEY);
  const value = stored[BACKEND_DEVICE_ID_STORAGE_KEY];
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  const deviceId = newDeviceId();
  await storage.set({ [BACKEND_DEVICE_ID_STORAGE_KEY]: deviceId });
  return deviceId;
}

/** 规范化 后端地址：HTTP(S) 绝对 URL，去尾斜杠。 */
function normalizeBackendBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw protocol("backendBaseUrl must be an absolute URL");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw protocol(
      "backendBaseUrl must be an HTTP(S) origin/path without credentials, query, or hash",
    );
  }
  return url.href.replace(/\/+$/, "");
}

/**
 * 解析 后端统一信封：code === 0 且 2xx 才视为成功；
 * 401 → TOKEN_INVALID；其余非零 code 保留 message 与 code（HTTP 业务错误）。
 */
function decodeEnvelope(
  response: { status: number; body: unknown },
): unknown {
  if (
    !Number.isInteger(response.status) ||
    response.status < 100 ||
    response.status > 599
  ) {
    throw protocol("backend response has an invalid HTTP status");
  }
  const envelope = record(response.body, "backend response");
  exactKeys(envelope, ["code", "message", "data", "requestId"], "backend response");
  if (!Number.isInteger(envelope.code)) {
    throw protocol("backend response.code must be an integer");
  }
  const code = envelope.code as number;
  const message = nonEmptyString(envelope.message, "backend response.message");
  const isHttpSuccess = response.status >= 200 && response.status < 300;

  if (code === 0) {
    if (!isHttpSuccess) {
      throw protocol("HTTP status and backend response.code disagree");
    }
    return envelope.data;
  }
  if (isHttpSuccess) {
    throw protocol("HTTP status and backend response.code disagree");
  }
  if (response.status === 401) {
    throw new BackendApiError("TOKEN_INVALID", message, 401, code);
  }
  throw new BackendApiError("HTTP", message, response.status, code);
}

/**
 * 创建 后端后端客户端。
 * baseUrl 支持函数形式（后台保存配置后无需重建客户端）；
 * storage 用于持久化设备 ID；transport 可注入（测试用假传输）。
 */
export function createBackendApiClientImpl(options: {
  token: string;
  baseUrl: string | (() => string);
  storage: KeyValueStorage;
  transport?: BackendTransport;
}): BackendApiClient {
  const token = nonEmptyString(options.token, "token");
  if (typeof options.baseUrl === "string") {
    normalizeBackendBaseUrl(options.baseUrl);
  }
  const resolveBaseUrl = (): string => {
    const value =
      typeof options.baseUrl === "function"
        ? options.baseUrl()
        : options.baseUrl;
    return normalizeBackendBaseUrl(value);
  };
  const transport =
    options.transport ?? createFetchBackendTransport();
  const storage = options.storage;

  async function request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    body: unknown | undefined,
    decode: (value: unknown) => T,
  ): Promise<T> {
    const transportRequest: {
      method: "GET" | "POST" | "PUT";
      url: string;
      headers: {
        Authorization: string;
        "Content-Type": "application/json";
      };
      body?: string;
    } = {
      method,
      url: `${resolveBaseUrl()}${path}`,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json" as const,
      },
    };
    if (body !== undefined) {
      transportRequest.body = JSON.stringify(body);
    }

    let response: { status: number; body: unknown };
    try {
      response = await transport(transportRequest);
    } catch (error) {
      if (error instanceof BackendApiError) {
        throw error;
      }
      throw new BackendApiError(
        "NETWORK",
        error instanceof Error
          ? `backend transport failed: ${error.message}`
          : "backend transport failed",
      );
    }
    return decode(decodeEnvelope(response));
  }

  return {
    async sync(clientVersion) {
      const deviceId = await loadOrCreateDeviceId(storage);
      return request(
        "POST",
        "/api/v1/plugin/sync",
        {
          clientVersion: nonEmptyString(clientVersion, "clientVersion"),
          deviceId,
        },
        decodeSync,
      );
    },
    async updateAutomation(enabled) {
      return request(
        "PUT",
        "/api/v1/plugin/automation",
        { enabled },
        decodeAutomation,
      );
    },
    async getReplyConfig() {
      return request("GET", "/api/v1/plugin/reply-config", undefined, decodeReplyConfig);
    },
    async updateReplyConfig(templates, keywordRules) {
      return request(
        "PUT",
        "/api/v1/plugin/reply-config",
        {
          templates,
          keywordRules,
        },
        decodeReplyConfigVersion,
      );
    },
    async getAiReply(value: AiReplyRequest): Promise<AiReplyResult> {
      return request("POST", "/api/v1/plugin/ai-reply", value, decodeAiReply);
    },
    async quoteImage(value: CreateQuoteTaskRequest): Promise<QuoteTaskResult> {
      return request(
        "POST",
        "/api/v1/plugin/quote-image",
        validateCreateQuoteTaskRequest(value),
        decodeQuoteTaskResult,
      );
    },
    async getWaitingPaymentOrder(chatId): Promise<WaitingPaymentOrder | null> {
      return request(
        "POST",
        "/api/v1/plugin/orders/waiting-payment",
        { chatId: nonEmptyString(chatId, "chatId") },
        decodeWaitingPaymentOrder,
      );
    },
    async updateOrderStatus(value: UpdateOrderStatusRequest): Promise<null> {
      const validated = validateUpdateOrderStatusRequest(value);
      if (validated.status === 25) {
        return request(
          "POST",
          "/api/v1/plugin/orders/price-adjusted",
          { id: validated.id, xianyuOrderId: validated.xianyuOrderId },
          decodeNull,
        );
      }
      if (validated.status === 30) {
        return request(
          "POST",
          "/api/v1/plugin/orders/buyer-paid",
          { id: validated.id, actualAmount: validated.actualAmount },
          decodeNull,
        );
      }
      return request(
        "POST",
        "/api/v1/plugin/orders/platform-cancel-result",
        {
          id: validated.id,
          failureReason: validated.failureReason,
          actualAmount: validated.actualAmount,
          cancelSucceeded: validated.cancelSucceeded,
        },
        decodeNull,
      );
    },
    async getOrderByStatus(chatId): Promise<OrderByStatus | null> {
      return request(
        "POST",
        "/api/v1/plugin/orders/by-status",
        { chatId: nonEmptyString(chatId, "chatId"), status: 25 },
        decodeOrderByStatus,
      );
    },
    async getTicketResults(): Promise<TicketResult[]> {
      return request(
        "POST",
        "/api/v1/plugin/orders/ticket-results",
        {},
        decodeTicketResults,
      );
    },
    async updateOrderResult(value: UpdateOrderResultRequest): Promise<null> {
      return request(
        "POST",
        "/api/v1/plugin/orders/delivery-result",
        validateUpdateOrderResultRequest(value),
        decodeNull,
      );
    },
  };
}
