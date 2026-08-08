/**
 * 业务后端契约：类型、严格字段级解码与请求校验。
 *
 * 生产路径为 后端 API client（handlers/backendApiClient.ts，请求
 * /api/v1/plugin/*）；本模块保留 BackendApiClient 契约与全部解码/校验函数，
 * 被 domain/application 层与测试广泛使用，是业务订单状态机
 * （20/25/30/90/50/450）的领域形状来源。任何接口返回结构不合法都会抛
 * BackendApiError，调用方按 kind 区分 Token 失效、网络故障、HTTP 失败与协议失败。
 */

/** 后端错误的类别：Token 失效 / 网络 / HTTP / 协议结构不合法。 */
export type BackendApiErrorKind =
  "TOKEN_INVALID" | "NETWORK" | "HTTP" | "PROTOCOL";

/** 业务后端调用失败时抛出的错误，携带类别与可选 HTTP 状态码。 */
export class BackendApiError extends Error {
  readonly kind: BackendApiErrorKind;
  readonly status: number | undefined;
  /** 后端业务错误码（后端 ApiResponse.code）；无业务码时为 undefined。 */
  readonly code: number | undefined;

  constructor(kind: BackendApiErrorKind, message: string, status?: number, code?: number) {
    super(message);
    this.name = "BackendApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** 底层传输层请求：方法、URL、鉴权头与可选 JSON 字符串请求体。 */
export interface BackendTransportRequest {
  method: "GET" | "POST" | "PUT";
  url: string;
  headers: {
    Authorization: string;
    "Content-Type": "application/json";
  };
  body?: string;
}

/** 底层传输层响应：HTTP 状态码 + 已解析的 JSON 响应体。 */
export interface BackendTransportResponse {
  status: number;
  body: unknown;
}

/** 可注入的底层传输实现（测试中使用假 transport 返回 fixture）。 */
export type BackendTransport = (
  request: BackendTransportRequest,
) => Promise<BackendTransportResponse>;

/** 业务话术模板的固定键集合（第一版保留的 10 个模板）。 */
export const REPLY_TEMPLATE_KEYS = [
  "identify_wait",
  "identify_fail",
  "identify_success",
  "edit_price_success",
  "payment_successful",
  "no_quote_record",
  "show_time_too_short",
  "cancel_ticket",
  "text_message_replay",
  "send_ticket_success",
] as const;

export type ReplyTemplateKey = (typeof REPLY_TEMPLATE_KEYS)[number];
/** 全部业务话术模板的映射：模板键 -> 模板文本。 */
export type ReplyTemplates = Record<ReplyTemplateKey, string>;

/** 关键词回复规则：命中关键字后回复固定文本，支持启用状态与优先级。 */
export interface KeywordRule {
  id: string;
  keywords: string[];
  reply: string;
  enabled: boolean;
  priority: number;
}

/** 已发布的完整回复配置快照：版本号 + 话术模板 + 关键词规则。 */
export interface ReplyConfig {
  version: number;
  templates: ReplyTemplates;
  keywordRules: KeywordRule[];
}

/** 插件状态同步结果：自动化开关、修订号与话术配置版本。 */
export interface SyncState {
  automationEnabled: boolean;
  automationRevision: number;
  replyConfigVersion: number;
}

/** 自动化开关修改后的后端确认状态。 */
export interface AutomationState {
  automationEnabled: boolean;
  automationRevision: number;
}

/** AI 客服回复请求：以 messageId 保证幂等。 */
export interface AiReplyRequest {
  messageId: string;
  chatId: string;
  buyerUserId: string;
  itemId: string;
  content: string;
}

/** AI 客服回复结果：reply 为 null 表示正常的 AI 静默结果。 */
export interface AiReplyResult {
  reply: string | null;
}

/** 创建异步识别与报价任务的请求（originPlatform 固定为 xianyu）。 */
export interface CreateQuoteTaskRequest {
  messageId: string;
  originPlatform: "xianyu";
  chatId: string;
  customerId: string;
  customerName: string;
  productId: string;
  seatsImage: string;
}

/** 报价任务创建成功后的响应：只返回异步任务 ID。 */
export interface CreatedQuoteTask {
  quoteTaskId: string;
}

/**
 * 后端固化的报价结果。amount（整单）是话术、改价与付款校验的唯一价格依据，
 * 插件不得用 biddingPrice × ticketNum 重算。id 即业务订单记录 ID，贯穿后续流程。
 */
export interface Quote {
  id: string;
  cityName: string;
  cinemaAddress: string;
  cinemaName: string;
  hallName: string;
  filmName: string;
  showTime: string;
  seats: string[];
  ticketNum: number;
  biddingPrice: number;
  amount: number;
  marketPrice: number;
}

/**
 * 报价任务查询结果：处理中 / 成功（含完整报价）/ 失败（含固定失败码）。
 * SHOW_TIME_TOO_SHORT 表示距开场不足 40 分钟，其余失败统一为 IDENTIFY_FAIL。
 */
export type QuoteTaskResult =
  | { status: "PROCESSING" }
  | { status: "SUCCEEDED"; quote: Quote }
  | { status: "FAILED"; failureCode: "SHOW_TIME_TOO_SHORT" | "IDENTIFY_FAIL" };

/** 待付款业务记录（status: 20）：用于改价与渲染改价成功话术。 */
export interface WaitingPaymentOrder {
  id: string;
  status: 20;
  productId: string;
  customerId: string;
  cityName: string;
  cinemaName: string;
  amount: number;
}

/**
 * 业务订单状态回写请求：25 改价成功（必带闲鱼订单号）、30 验款成功、90 金额不一致。
 */
export type UpdateOrderStatusRequest =
  | { id: string; status: 25; xianyuOrderId: string }
  | { id: string; status: 30; actualAmount: number }
  | {
      id: string;
      status: 90;
      failureReason: "AMOUNT_MISMATCH" | "UPSTREAM_ORDER_FAILED";
      actualAmount: number;
      cancelSucceeded: boolean;
    };

/** 按会话与状态查询到的已改价订单（status: 25），用于付款金额校验。 */
export interface OrderByStatus {
  id: string;
  xianyuOrderId: string;
  customerId: string;
  amount: number;
}

/** 一张票的取票码与其原始票码图片。 */
export interface TicketItem {
  ticketCode: string;
  ticketCodeOriginImage: string;
}

/**
 * 出票结果轮询返回的订单：50 出票成功（含全部票码），450 出票失败（含取消用闲鱼订单号）。
 */
export type TicketResult =
  | {
      id: string;
      status: 50;
      chatId: string;
      customerId: string;
      ticketCodeInfo: { ticketItems: TicketItem[] };
    }
  | {
      id: string;
      status: 450;
      chatId: string;
      customerId: string;
      xianyuOrderId: string;
    };

/**
 * 出票结果处理回写：交付成功 / 交付失败（含失败阶段与已发图片数）/ 出票失败已处理。
 */
export type UpdateOrderResultRequest =
  | { id: string; result: "DELIVERY_SUCCEEDED" }
  | {
      id: string;
      result: "DELIVERY_FAILED";
      failureStage: "TICKET_IMAGE" | "SUCCESS_MESSAGE";
      sentImageCount: number;
    }
  | {
      id: string;
      result: "TICKET_FAILURE_HANDLED";
      noticeSent: boolean;
      cancelSucceeded: boolean;
    };

/** 业务后端客户端的领域接口：11 个操作与后端接口一一对应。 */
export interface BackendApiClient {
  sync(clientVersion: string): Promise<SyncState>;
  updateAutomation(enabled: boolean): Promise<AutomationState>;
  getReplyConfig(): Promise<ReplyConfig>;
  updateReplyConfig(templates: Record<ReplyTemplateKey, string>, keywordRules: KeywordRule[]): Promise<{ version: number }>;
  getAiReply(request: AiReplyRequest): Promise<AiReplyResult>;
  quoteImage(request: CreateQuoteTaskRequest): Promise<QuoteTaskResult>;
  getWaitingPaymentOrder(chatId: string): Promise<WaitingPaymentOrder | null>;
  updateOrderStatus(request: UpdateOrderStatusRequest): Promise<null>;
  getOrderByStatus(chatId: string): Promise<OrderByStatus | null>;
  getTicketResults(): Promise<TicketResult[]>;
  updateOrderResult(request: UpdateOrderResultRequest): Promise<null>;
}

/** 每个话术模板允许使用的占位符集合；[分割符] 是全部模板的合法分段标记。 */
const PLACEHOLDERS: Record<ReplyTemplateKey, ReadonlySet<string>> = {
  identify_wait: new Set(["[分割符]"]),
  identify_fail: new Set(["[分割符]"]),
  identify_success: new Set([
    "[订单号]",
    "[城市]",
    "[影院地址]",
    "[影院名]",
    "[影厅名]",
    "[影片名]",
    "[放映时间]",
    "[座位信息]",
    "[单座位报价]",
    "[整单报价]",
    "[分割符]",
  ]),
  edit_price_success: new Set(["[订单号]", "[城市]", "[影院名]", "[分割符]"]),
  payment_successful: new Set(["[订单号]", "[分割符]"]),
  no_quote_record: new Set(["[分割符]"]),
  show_time_too_short: new Set(["[分割符]"]),
  cancel_ticket: new Set(["[订单号]", "[分割符]"]),
  text_message_replay: new Set(["[分割符]"]),
  send_ticket_success: new Set(["[订单号]", "[取票码]", "[分割符]"]),
};

/** 构造协议错误：响应结构不合法时统一抛 BackendApiError(PROTOCOL)。 */
function protocol(message: string): BackendApiError {
  return new BackendApiError("PROTOCOL", message);
}

/** 判断未知值是否为普通对象（非 null、非数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验未知值是对象，否则抛协议错误，返回带类型的对象。 */
function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw protocol(`${path} must be an object`);
  }
  return value;
}

/** 严格校验对象只包含指定的键且全部存在：多一个或少一个都抛协议错误。 */
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

/** 校验字段为非空字符串（去除首尾空白后仍有内容）。 */
function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw protocol(`${path} must be a non-empty string`);
  }
  return value;
}

/** 校验字段为布尔值。 */
function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw protocol(`${path} must be a boolean`);
  }
  return value;
}

/** 校验字段为非负安全整数（修订号、已发图片数等）。 */
function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw protocol(`${path} must be a non-negative safe integer`);
  }
  return value as number;
}

/** 校验字段为正安全整数（票数等）。 */
function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw protocol(`${path} must be a positive safe integer`);
  }
  return value as number;
}

/**
 * 校验人民币金额：有限数字、允许正数或非负（allowZero）、最多两位小数。
 * 后端金额必须为定点小数，插件只按原值使用，不参与浮点计算。
 */
function money(value: unknown, path: string, allowZero: boolean): number {
  const minimumValid = allowZero
    ? (value as number) >= 0
    : (value as number) > 0;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !minimumValid ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(value))
  ) {
    throw protocol(
      `${path} must be a ${allowZero ? "non-negative" : "positive"} RMB amount with at most two decimals`,
    );
  }
  return value;
}

/** 校验 ISO 8601 带时区时间字符串（如 2026-08-01T20:00:00+08:00）。 */
function isoDateTime(value: unknown, path: string): string {
  const result = nonEmptyString(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      result,
    ) ||
    Number.isNaN(Date.parse(result))
  ) {
    throw protocol(`${path} must be an ISO 8601 timestamp with timezone`);
  }
  return result;
}

/** 校验非空字符串数组，逐项校验为非空字符串。 */
function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw protocol(`${path} must be a non-empty array`);
  }
  return value.map((item, index) => nonEmptyString(item, `${path}[${index}]`));
}

/** 解码 /api/plugin/sync 响应：自动化开关、修订号与配置版本。 */
export function decodeSync(value: unknown): SyncState {
  const data = record(value, "sync data");
  exactKeys(
    data,
    ["automationEnabled", "automationRevision", "replyConfigVersion"],
    "sync data",
  );
  return {
    automationEnabled: booleanValue(
      data.automationEnabled,
      "automationEnabled",
    ),
    automationRevision: nonNegativeInteger(
      data.automationRevision,
      "automationRevision",
    ),
    replyConfigVersion: nonNegativeInteger(
      data.replyConfigVersion,
      "replyConfigVersion",
    ),
  };
}

/** 解码 /api/plugin/automation 响应。 */
export function decodeAutomation(value: unknown): AutomationState {
  const data = record(value, "automation data");
  exactKeys(
    data,
    ["automationEnabled", "automationRevision"],
    "automation data",
  );
  return {
    automationEnabled: booleanValue(
      data.automationEnabled,
      "automationEnabled",
    ),
    automationRevision: nonNegativeInteger(
      data.automationRevision,
      "automationRevision",
    ),
  };
}

/**
 * 解码 /api/plugin/reply-config 响应并执行二次校验：模板键必须齐全、
 * 每个模板只能使用该事件允许的占位符、关键词规则结构完整。
 * 校验失败抛协议错误，调用方不得用部分配置替换已有有效缓存。
 */
export function decodeReplyConfigVersion(value: unknown): { version: number } {
  const data = record(value, "reply config version");
  exactKeys(data, ["version"], "reply config version");
  return {
    version: nonNegativeInteger(data.version, "reply config version"),
  };
}

/** 校验单个模板的全部占位符都在该模板允许集合内；非法时抛出协议错误。 */
export function validateTemplatePlaceholders(
  key: ReplyTemplateKey,
  text: string,
): void {
  for (const match of text.matchAll(/\[[^\[\]]+\]/g)) {
    if (!PLACEHOLDERS[key].has(match[0])) {
      throw protocol(
        `templates.${key} contains unsupported placeholder ${match[0]}`,
      );
    }
  }
}

export function decodeReplyConfig(value: unknown): ReplyConfig {
  const data = record(value, "reply config");
  exactKeys(data, ["version", "templates", "keywordRules"], "reply config");
  const rawTemplates = record(data.templates, "templates");
  exactKeys(rawTemplates, REPLY_TEMPLATE_KEYS, "templates");
  const templates = {} as ReplyTemplates;

  for (const key of REPLY_TEMPLATE_KEYS) {
    const template = nonEmptyString(rawTemplates[key], `templates.${key}`);
    validateTemplatePlaceholders(key, template);
    templates[key] = template;
  }

  if (!Array.isArray(data.keywordRules)) {
    throw protocol("keywordRules must be an array");
  }
  const keywordRules = data.keywordRules.map((value, index): KeywordRule => {
    const rule = record(value, `keywordRules[${index}]`);
    exactKeys(
      rule,
      ["id", "keywords", "reply", "enabled", "priority"],
      `keywordRules[${index}]`,
    );
    if (!Number.isSafeInteger(rule.priority)) {
      throw protocol(`keywordRules[${index}].priority must be an integer`);
    }
    return {
      id: nonEmptyString(rule.id, `keywordRules[${index}].id`),
      keywords: stringArray(rule.keywords, `keywordRules[${index}].keywords`),
      reply: nonEmptyString(rule.reply, `keywordRules[${index}].reply`),
      enabled: booleanValue(rule.enabled, `keywordRules[${index}].enabled`),
      priority: rule.priority as number,
    };
  });

  return {
    version: nonNegativeInteger(data.version, "reply config version"),
    templates,
    keywordRules,
  };
}

/** 解码 AI 回复响应：reply 只能是非空字符串或 null（null 为 AI 静默结果）。 */
export function decodeAiReply(value: unknown): AiReplyResult {
  const data = record(value, "AI reply data");
  exactKeys(data, ["reply"], "AI reply data");
  if (
    data.reply !== null &&
    (typeof data.reply !== "string" || data.reply.trim().length === 0)
  ) {
    throw protocol("AI reply must be a non-empty string or null");
  }
  return { reply: data.reply as string | null };
}

/** 解码创建报价任务响应：只取 quoteTaskId。 */
function decodeCreatedQuoteTask(value: unknown): CreatedQuoteTask {
  const data = record(value, "created quote task data");
  exactKeys(data, ["quoteTaskId"], "created quote task data");
  return { quoteTaskId: nonEmptyString(data.quoteTaskId, "quoteTaskId") };
}

/** 解码报价对象：严格校验字段、票数与座位数一致、金额格式。 */
function decodeQuote(value: unknown): Quote {
  const data = record(value, "quote");
  exactKeys(
    data,
    [
      "id",
      "cityName",
      "cinemaAddress",
      "cinemaName",
      "hallName",
      "filmName",
      "showTime",
      "seats",
      "ticketNum",
      "biddingPrice",
      "amount",
      "marketPrice",
    ],
    "quote",
  );
  const seats = stringArray(data.seats, "quote.seats");
  const ticketNum = positiveInteger(data.ticketNum, "quote.ticketNum");
  if (ticketNum !== seats.length) {
    throw protocol("quote.ticketNum must equal seats length");
  }
  return {
    id: nonEmptyString(data.id, "quote.id"),
    cityName: nonEmptyString(data.cityName, "quote.cityName"),
    cinemaAddress: nonEmptyString(data.cinemaAddress, "quote.cinemaAddress"),
    cinemaName: nonEmptyString(data.cinemaName, "quote.cinemaName"),
    hallName: nonEmptyString(data.hallName, "quote.hallName"),
    filmName: nonEmptyString(data.filmName, "quote.filmName"),
    showTime: isoDateTime(data.showTime, "quote.showTime"),
    seats,
    ticketNum,
    biddingPrice: money(data.biddingPrice, "quote.biddingPrice", false),
    amount: money(data.amount, "quote.amount", false),
    marketPrice: money(data.marketPrice, "quote.marketPrice", true),
  };
}

/**
 * 解码报价任务查询结果：PROCESSING / SUCCEEDED / FAILED 三者互斥，
 * 只允许各自的字段组合，failureCode 只接受 SHOW_TIME_TOO_SHORT 与 IDENTIFY_FAIL。
 */
export function decodeQuoteTaskResult(value: unknown): QuoteTaskResult {
  const data = record(value, "quote task data");
  const status = nonEmptyString(data.status, "quote task status");
  if (status === "PROCESSING") {
    exactKeys(data, ["status"], "PROCESSING quote task");
    return { status };
  }
  if (status === "SUCCEEDED") {
    exactKeys(data, ["status", "quote"], "SUCCEEDED quote task");
    return { status, quote: decodeQuote(data.quote) };
  }
  if (status === "FAILED") {
    exactKeys(data, ["status", "failureCode"], "FAILED quote task");
    if (
      data.failureCode !== "SHOW_TIME_TOO_SHORT" &&
      data.failureCode !== "IDENTIFY_FAIL"
    ) {
      throw protocol("FAILED quote task failureCode is unknown");
    }
    return { status, failureCode: data.failureCode };
  }
  throw protocol("quote task status is unknown");
}

/** 解码待付款业务记录；data 为 null 表示没有可改价的报价记录。 */
export function decodeWaitingPaymentOrder(value: unknown): WaitingPaymentOrder | null {
  if (value === null) {
    return null;
  }
  const data = record(value, "waiting-payment data");
  exactKeys(
    data,
    [
      "id",
      "status",
      "productId",
      "customerId",
      "cityName",
      "cinemaName",
      "amount",
    ],
    "waiting-payment data",
  );
  if (data.status !== 20) {
    throw protocol("waiting-payment status must be 20");
  }
  return {
    id: nonEmptyString(data.id, "waiting-payment id"),
    status: 20,
    productId: nonEmptyString(data.productId, "waiting-payment productId"),
    customerId: nonEmptyString(data.customerId, "waiting-payment customerId"),
    cityName: nonEmptyString(data.cityName, "waiting-payment cityName"),
    cinemaName: nonEmptyString(data.cinemaName, "waiting-payment cinemaName"),
    amount: money(data.amount, "waiting-payment amount", false),
  };
}

/** 校验成功响应的 data 必须为 null（状态/结果回写类接口）。 */
export function decodeNull(value: unknown): null {
  if (value !== null) {
    throw protocol("response data must be null");
  }
  return null;
}

/** 解码按会话与状态查询到的已改价订单；data 为 null 表示没有记录。 */
export function decodeOrderByStatus(value: unknown): OrderByStatus | null {
  if (value === null) {
    return null;
  }
  const data = record(value, "order-by-status data");
  exactKeys(
    data,
    ["id", "xianyuOrderId", "customerId", "amount"],
    "order-by-status data",
  );
  return {
    id: nonEmptyString(data.id, "order-by-status id"),
    xianyuOrderId: nonEmptyString(
      data.xianyuOrderId,
      "order-by-status xianyuOrderId",
    ),
    customerId: nonEmptyString(data.customerId, "order-by-status customerId"),
    amount: money(data.amount, "order-by-status amount", false),
  };
}

/** 解码出票结果轮询数组：逐项按 status 50/450 分支严格解码。 */
export function decodeTicketResults(value: unknown): TicketResult[] {
  if (!Array.isArray(value)) {
    throw protocol("ticket-results data must be an array");
  }
  return value.map((item, index): TicketResult => {
    const data = record(item, `ticket-results[${index}]`);
    if (data.status === 50) {
      exactKeys(
        data,
        ["id", "status", "chatId", "customerId", "ticketCodeInfo"],
        `ticket-results[${index}]`,
      );
      const ticketCodeInfo = record(
        data.ticketCodeInfo,
        `ticket-results[${index}].ticketCodeInfo`,
      );
      exactKeys(
        ticketCodeInfo,
        ["ticketItems"],
        `ticket-results[${index}].ticketCodeInfo`,
      );
      if (
        !Array.isArray(ticketCodeInfo.ticketItems) ||
        ticketCodeInfo.ticketItems.length === 0
      ) {
        throw protocol(
          `ticket-results[${index}].ticketItems must be a non-empty array`,
        );
      }
      const ticketItems = ticketCodeInfo.ticketItems.map(
        (ticket, ticketIndex): TicketItem => {
          const value = record(
            ticket,
            `ticket-results[${index}].ticketItems[${ticketIndex}]`,
          );
          exactKeys(
            value,
            ["ticketCode", "ticketCodeOriginImage"],
            `ticket-results[${index}].ticketItems[${ticketIndex}]`,
          );
          return {
            ticketCode: nonEmptyString(value.ticketCode, "ticketCode"),
            ticketCodeOriginImage: nonEmptyString(
              value.ticketCodeOriginImage,
              "ticketCodeOriginImage",
            ),
          };
        },
      );
      return {
        id: nonEmptyString(data.id, "ticket result id"),
        status: 50,
        chatId: nonEmptyString(data.chatId, "ticket result chatId"),
        customerId: nonEmptyString(data.customerId, "ticket result customerId"),
        ticketCodeInfo: { ticketItems },
      };
    }
    if (data.status === 450) {
      exactKeys(
        data,
        ["id", "status", "chatId", "customerId", "xianyuOrderId"],
        `ticket-results[${index}]`,
      );
      return {
        id: nonEmptyString(data.id, "ticket result id"),
        status: 450,
        chatId: nonEmptyString(data.chatId, "ticket result chatId"),
        customerId: nonEmptyString(data.customerId, "ticket result customerId"),
        xianyuOrderId: nonEmptyString(
          data.xianyuOrderId,
          "ticket result xianyuOrderId",
        ),
      };
    }
    throw protocol(`ticket-results[${index}].status is unknown`);
  });
}

/** 校验 AI 回复请求：全部字段为非空字符串。 */
function validateAiReplyRequest(value: AiReplyRequest): AiReplyRequest {
  const data = record(value, "AI reply request");
  exactKeys(
    data,
    ["messageId", "chatId", "buyerUserId", "itemId", "content"],
    "AI reply request",
  );
  return {
    messageId: nonEmptyString(data.messageId, "messageId"),
    chatId: nonEmptyString(data.chatId, "chatId"),
    buyerUserId: nonEmptyString(data.buyerUserId, "buyerUserId"),
    itemId: nonEmptyString(data.itemId, "itemId"),
    content: nonEmptyString(data.content, "content"),
  };
}

/** 校验创建报价任务请求：originPlatform 必须为 xianyu，其余字段非空。 */
export function validateCreateQuoteTaskRequest(
  value: CreateQuoteTaskRequest,
): CreateQuoteTaskRequest {
  const data = record(value, "create quote task request");
  exactKeys(
    data,
    [
      "messageId",
      "originPlatform",
      "chatId",
      "customerId",
      "customerName",
      "productId",
      "seatsImage",
    ],
    "create quote task request",
  );
  if (data.originPlatform !== "xianyu") {
    throw protocol("originPlatform must be xianyu");
  }
  return {
    messageId: nonEmptyString(data.messageId, "messageId"),
    originPlatform: "xianyu",
    chatId: nonEmptyString(data.chatId, "chatId"),
    customerId: nonEmptyString(data.customerId, "customerId"),
    customerName: nonEmptyString(data.customerName, "customerName"),
    productId: nonEmptyString(data.productId, "productId"),
    seatsImage: nonEmptyString(data.seatsImage, "seatsImage"),
  };
}

/** 校验状态回写请求：按 status 25/30/90 各分支只接受允许的字段组合。 */
export function validateUpdateOrderStatusRequest(
  value: UpdateOrderStatusRequest,
): UpdateOrderStatusRequest {
  const data = record(value, "order status request");
  if (data.status === 25) {
    exactKeys(data, ["id", "status", "xianyuOrderId"], "status 25 request");
    return {
      id: nonEmptyString(data.id, "status 25 id"),
      status: 25,
      xianyuOrderId: nonEmptyString(
        data.xianyuOrderId,
        "status 25 xianyuOrderId",
      ),
    };
  }
  if (data.status === 30) {
    exactKeys(data, ["id", "status", "actualAmount"], "status 30 request");
    return {
      id: nonEmptyString(data.id, "status 30 id"),
      status: 30,
      actualAmount: money(data.actualAmount, "status 30 actualAmount", false),
    };
  }
  if (data.status === 90) {
    exactKeys(
      data,
      ["id", "status", "failureReason", "actualAmount", "cancelSucceeded"],
      "status 90 request",
    );
    if (
      data.failureReason !== "AMOUNT_MISMATCH" &&
      data.failureReason !== "UPSTREAM_ORDER_FAILED"
    ) {
      throw protocol(
        "status 90 failureReason must be AMOUNT_MISMATCH or UPSTREAM_ORDER_FAILED",
      );
    }
    return {
      id: nonEmptyString(data.id, "status 90 id"),
      status: 90,
      failureReason: data.failureReason,
      actualAmount: money(data.actualAmount, "status 90 actualAmount", false),
      cancelSucceeded: booleanValue(
        data.cancelSucceeded,
        "status 90 cancelSucceeded",
      ),
    };
  }
  throw protocol("order status request status must be 25, 30, or 90");
}

/** 校验出票结果回写请求：按 result 分支只接受允许的字段组合。 */
export function validateUpdateOrderResultRequest(
  value: UpdateOrderResultRequest,
): UpdateOrderResultRequest {
  const data = record(value, "order result request");
  if (data.result === "DELIVERY_SUCCEEDED") {
    exactKeys(data, ["id", "result"], "DELIVERY_SUCCEEDED request");
    return {
      id: nonEmptyString(data.id, "result id"),
      result: "DELIVERY_SUCCEEDED",
    };
  }
  if (data.result === "DELIVERY_FAILED") {
    exactKeys(
      data,
      ["id", "result", "failureStage", "sentImageCount"],
      "DELIVERY_FAILED request",
    );
    if (
      data.failureStage !== "TICKET_IMAGE" &&
      data.failureStage !== "SUCCESS_MESSAGE"
    ) {
      throw protocol("DELIVERY_FAILED failureStage is unknown");
    }
    return {
      id: nonEmptyString(data.id, "result id"),
      result: "DELIVERY_FAILED",
      failureStage: data.failureStage,
      sentImageCount: nonNegativeInteger(data.sentImageCount, "sentImageCount"),
    };
  }
  if (data.result === "TICKET_FAILURE_HANDLED") {
    exactKeys(
      data,
      ["id", "result", "noticeSent", "cancelSucceeded"],
      "TICKET_FAILURE_HANDLED request",
    );
    return {
      id: nonEmptyString(data.id, "result id"),
      result: "TICKET_FAILURE_HANDLED",
      noticeSent: booleanValue(data.noticeSent, "noticeSent"),
      cancelSucceeded: booleanValue(data.cancelSucceeded, "cancelSucceeded"),
    };
  }
  throw protocol("order result is unknown");
}

/**
 * 规范化后端基础地址：必须是 HTTP(S) 绝对 URL，不含用户名密码、查询串与 hash，
 * 去除末尾斜杠。插件不接受页面或 Popup 动态替换该地址。
 */
function normalizeBackendBaseUrl(value: unknown): string {
  const raw = nonEmptyString(value, "backendBaseUrl");
  let url: URL;
  try {
    url = new URL(raw);
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

/** 拼接后端基础地址与接口路径。 */
function endpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

/**
 * 创建基于 fetch 的底层传输实现：带超时（AbortController）与网络错误归一化，
 * 非 JSON 或空响应体抛协议错误。测试可注入自定义 fetch 与定时器。
 */
export function createFetchBackendTransport(
  options: {
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
    scheduleTimeout?: (callback: () => void, timeoutMs: number) => number;
    cancelTimeout?: (timer: number) => void;
  } = {},
): BackendTransport {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const scheduleTimeout =
    options.scheduleTimeout ??
    ((callback, delay) => setTimeout(callback, delay));
  const cancelTimeout =
    options.cancelTimeout ?? ((timer) => clearTimeout(timer));
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      "backend transport timeoutMs must be a positive safe integer",
    );
  }

  return async (request): Promise<BackendTransportResponse> => {
    const controller = new AbortController();
    const timer = scheduleTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImplementation(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: controller.signal,
        });
      } catch (error) {
        throw new BackendApiError(
          "NETWORK",
          error instanceof Error
            ? `backend request failed: ${error.message}`
            : "backend request failed",
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (controller.signal.aborted) {
          throw new BackendApiError(
            "NETWORK",
            error instanceof Error
              ? `backend request failed: ${error.message}`
              : "backend request timed out",
          );
        }
        throw protocol("backend response must be non-empty JSON");
      }
      return { status: response.status, body };
    } finally {
      cancelTimeout(timer);
    }
  };
}

/**
 * 创建后端客户端内部实现（仅测试入口使用）：封装统一请求流程——
 * 拼 URL、带 Bearer Token、发送请求、校验 HTTP 状态与 success 包装一致、
 * 401 归一为 TOKEN_INVALID，再交给各接口的解码函数。
 *
 * 旧 FastAPI 协议客户端实现（success/message/data 信封）：
 * 生产已切换到 后端客户端（backendApiClient.ts），本实现保留用于测试解码/校验契约。
 */
function createClient(
  tokenValue: string,
  backendBaseUrlValue: string,
  transport: BackendTransport,
): BackendApiClient {
  const token = nonEmptyString(tokenValue, "token");
  const backendBaseUrl = normalizeBackendBaseUrl(backendBaseUrlValue);

  async function request<T>(
    method: BackendTransportRequest["method"],
    path: string,
    body: unknown | undefined,
    decode: (value: unknown) => T,
  ): Promise<T> {
    const transportRequest: BackendTransportRequest = {
      method,
      url: endpointUrl(backendBaseUrl, path),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };
    if (body !== undefined) {
      transportRequest.body = JSON.stringify(body);
    }

    let response: BackendTransportResponse;
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

    if (
      !Number.isInteger(response.status) ||
      response.status < 100 ||
      response.status > 599
    ) {
      throw protocol("backend response has an invalid HTTP status");
    }
    const envelope = record(response.body, "response");
    exactKeys(envelope, ["success", "message", "data"], "response");
    const success = booleanValue(envelope.success, "response.success");
    const message = nonEmptyString(envelope.message, "response.message");
    const isHttpSuccess = response.status >= 200 && response.status < 300;
    if (success !== isHttpSuccess) {
      throw protocol("HTTP status and response.success disagree");
    }
    if (!success) {
      if (envelope.data !== null) {
        throw protocol("failed response data must be null");
      }
      if (response.status === 401) {
        throw new BackendApiError("TOKEN_INVALID", message, 401);
      }
      throw new BackendApiError("HTTP", message, response.status);
    }

    return decode(envelope.data);
  }

  return {
    async sync(clientVersion) {
      return request(
        "POST",
        "/api/plugin/sync",
        {
          clientVersion: nonEmptyString(clientVersion, "clientVersion"),
        },
        decodeSync,
      );
    },
    async updateAutomation(enabled) {
      return request(
        "PUT",
        "/api/plugin/automation",
        {
          enabled: booleanValue(enabled, "enabled"),
        },
        decodeAutomation,
      );
    },
    async getReplyConfig() {
      return request(
        "GET",
        "/api/plugin/reply-config",
        undefined,
        decodeReplyConfig,
      );
    },
    async updateReplyConfig(templates, keywordRules) {
      return request(
        "PUT",
        "/api/plugin/reply-config",
        {
          templates,
          keywordRules,
        },
        decodeReplyConfigVersion,
      );
    },
    async getAiReply(value) {
      return request(
        "POST",
        "/api/plugin/ai-reply",
        validateAiReplyRequest(value),
        decodeAiReply,
      );
    },
    async quoteImage(value) {
      return request(
        "POST",
        "/api/plugin/quote-image",
        validateCreateQuoteTaskRequest(value),
        decodeQuoteTaskResult,
      );
    },
    async getWaitingPaymentOrder(chatId) {
      return request(
        "POST",
        "/api/plugin/orders/waiting-payment",
        {
          chatId: nonEmptyString(chatId, "chatId"),
        },
        decodeWaitingPaymentOrder,
      );
    },
    async updateOrderStatus(value) {
      return request(
        "POST",
        "/api/plugin/orders/status",
        validateUpdateOrderStatusRequest(value),
        decodeNull,
      );
    },
    async getOrderByStatus(chatId) {
      return request(
        "POST",
        "/api/plugin/orders/by-status",
        {
          chatId: nonEmptyString(chatId, "chatId"),
          status: 25,
        },
        decodeOrderByStatus,
      );
    },
    async getTicketResults() {
      return request(
        "POST",
        "/api/plugin/orders/ticket-results",
        {},
        decodeTicketResults,
      );
    },
    async updateOrderResult(value) {
      return request(
        "POST",
        "/api/plugin/orders/result",
        validateUpdateOrderResultRequest(value),
        decodeNull,
      );
    },
  };
}

/** 创建测试用后端客户端：显式指定后端地址与假 transport。 */
export function createBackendApiClientForTest(options: {
  token: string;
  backendBaseUrl: string;
  transport: BackendTransport;
}): BackendApiClient {
  return createClient(options.token, options.backendBaseUrl, options.transport);
}
