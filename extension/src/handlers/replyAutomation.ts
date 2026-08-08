/**
 * 回复自动化：话术模板渲染、关键词匹配、AI 决策与文字消息发送。
 *
 * 本模块负责把业务话术模板按占位符渲染并拆段、按关键词规则选择回复、
 * 调用后端 AI 获取回复，以及按“每 1 秒重试、最多 3 次”的规则发送文字消息。
 * 发送成功判定：WebSocket 处于 OPEN 且 send() 未抛异常（见 writeOpenWebSocket）。
 */
import type {
  AiReplyRequest,
  AiReplyResult,
  KeywordRule,
  ReplyConfig,
  ReplyTemplateKey
} from "./backendApi.ts";

/** 合法分段标记：渲染完成后按它拆分多条消息。 */
const DIVIDER = "[分割符]";
/** 文字话术重试间隔：1 秒。 */
const TEXT_RETRY_DELAY_MS = 1_000;
/** 文字话术最多重试次数（不含首次发送）。 */
const TEXT_MAX_RETRIES = 3;

/** 话术模板渲染所需的动态占位符值；缺少的字段在渲染时会抛错。 */
export interface ReplyTemplateValues {
  businessOrderId?: string;
  cityName?: string;
  cinemaAddress?: string;
  cinemaName?: string;
  hallName?: string;
  filmName?: string;
  showTime?: string;
  seats?: string[];
  biddingPrice?: number;
  amount?: number;
  ticketCodes?: string[];
}

/**
 * 买家文字消息的回复决策：
 * AUTOMATION_OFF 自动工作关闭；KEYWORD 命中关键词；AI 返回 AI 回复；SILENT 静默结束。
 */
export type TextReplyDecision =
  | { kind: "AUTOMATION_OFF" }
  | { kind: "KEYWORD"; reply: string; ruleId: string }
  | { kind: "AI"; reply: string }
  | { kind: "SILENT" };

/** 文字消息发送结果：是否全部发送成功、已发送段数、是否因自动化关闭而停止。 */
export interface TextDeliveryResult {
  success: boolean;
  sentSegmentCount: number;
  stoppedByAutomation: boolean;
}

/** WebSocket 发送器的最小接口（readyState 1 表示 OPEN）。 */
interface WebSocketWriter {
  readyState: number;
  send(payload: string): void;
}

/** 校验必填文本，空值抛错。 */
function requiredText(value: string | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

/** 校验必填非空字符串数组（逐项非空）。 */
function requiredTextArray(value: string[] | undefined, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must be a non-empty string array`);
  }
  return value.map((item, index) => requiredText(item, `${field}[${index}]`));
}

/** 金额渲染：去除无意义的末尾零，最多保留两位小数。 */
function rmb(value: number | undefined, field: string): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive amount`);
  }
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** 放映时间渲染：ISO 8601 统一显示为 YYYY-MM-DD HH:mm。 */
function showTime(value: string | undefined): string {
  const result = requiredText(value, "showTime");
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(result);
  if (match === null || Number.isNaN(Date.parse(result))) {
    throw new Error("showTime must be an ISO 8601 timestamp with timezone");
  }
  return `${match[1]} ${match[2]}`;
}

/** 取单个占位符对应的渲染值；不支持的占位符直接抛错。 */
function placeholderValue(placeholder: string, values: ReplyTemplateValues): string {
  switch (placeholder) {
    case "[订单号]":
      return requiredText(values.businessOrderId, "businessOrderId");
    case "[城市]":
      return requiredText(values.cityName, "cityName");
    case "[影院地址]":
      return requiredText(values.cinemaAddress, "cinemaAddress");
    case "[影院名]":
      return requiredText(values.cinemaName, "cinemaName");
    case "[影厅名]":
      return requiredText(values.hallName, "hallName");
    case "[影片名]":
      return requiredText(values.filmName, "filmName");
    case "[放映时间]":
      return showTime(values.showTime);
    case "[座位信息]":
      return requiredTextArray(values.seats, "seats").join(",");
    case "[单座位报价]":
      return rmb(values.biddingPrice, "biddingPrice");
    case "[整单报价]":
      return rmb(values.amount, "amount");
    case "[取票码]":
      return requiredTextArray(values.ticketCodes, "ticketCodes").join(",");
    default:
      throw new Error(`reply template contains unsupported placeholder ${placeholder}`);
  }
}

/**
 * 渲染业务话术模板：替换全部动态占位符，按 [分割符] 拆段、去首尾空白、丢弃空段，
 * 按原顺序返回多条非空消息。模板来自已校验的完整配置。
 */
export function renderReplyTemplate(
  templateKey: ReplyTemplateKey,
  config: ReplyConfig,
  values: ReplyTemplateValues = {}
): string[] {
  const template = config.templates[templateKey];
  const rendered = template.replace(/\[[^\[\]]+\]/g, (placeholder) => {
    return placeholder === DIVIDER ? DIVIDER : placeholderValue(placeholder, values);
  });
  return rendered
    .split(DIVIDER)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/**
 * 关键词匹配：不区分大小写的包含匹配，只匹配 enabled 规则；
 * 多条命中时 priority 数字大的优先，同优先级取数组靠前的规则。
 */
export function matchKeywordRule(
  text: string,
  rules: readonly KeywordRule[]
): KeywordRule | null {
  const normalized = text.toLowerCase();
  let selected: KeywordRule | null = null;
  for (const rule of rules) {
    if (
      rule.enabled &&
      rule.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())) &&
      (selected === null || rule.priority > selected.priority)
    ) {
      selected = rule;
    }
  }
  return selected;
}

/**
 * 文字回复决策：自动工作关闭直接返回 AUTOMATION_OFF；命中关键词返回 KEYWORD；
 * 否则调用后端 AI——reply 为 null（AI 静默）时返回 SILENT，不发送任何消息。
 */
export async function decideTextReply(options: {
  event: AiReplyRequest;
  config: ReplyConfig;
  canExecute(): Promise<boolean>;
  getAiReply(request: AiReplyRequest): Promise<AiReplyResult>;
}): Promise<TextReplyDecision> {
  if (!await options.canExecute()) {
    return { kind: "AUTOMATION_OFF" };
  }
  const keyword = matchKeywordRule(options.event.content, options.config.keywordRules);
  if (keyword !== null) {
    return { kind: "KEYWORD", reply: keyword.reply, ruleId: keyword.id };
  }
  if (!await options.canExecute()) {
    return { kind: "AUTOMATION_OFF" };
  }
  const ai = await options.getAiReply(options.event);
  return ai.reply === null ? { kind: "SILENT" } : { kind: "AI", reply: ai.reply };
}

/**
 * 按段发送文字消息并重试：每段首次失败后每隔 1 秒重试、最多 3 次；
 * 重试期间自动工作关闭则立即停止；前段成功后不重发前段。
 */
export async function deliverTextSegmentsWithRetry(options: {
  segments: readonly string[];
  canExecute(): Promise<boolean>;
  send(segment: string): Promise<boolean> | boolean;
  wait(milliseconds: number): Promise<void>;
  retryDelayMs?: number;
  maxRetries?: number;
}): Promise<TextDeliveryResult> {
  const retryDelayMs = options.retryDelayMs ?? TEXT_RETRY_DELAY_MS;
  const maxRetries = options.maxRetries ?? TEXT_MAX_RETRIES;
  let sentSegmentCount = 0;

  for (const segment of options.segments) {
    let sent = false;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        if (!await options.canExecute()) {
          return { success: false, sentSegmentCount, stoppedByAutomation: true };
        }
        await options.wait(retryDelayMs);
      }
      if (!await options.canExecute()) {
        return { success: false, sentSegmentCount, stoppedByAutomation: true };
      }
      try {
        sent = await options.send(segment);
      } catch {
        sent = false;
      }
      if (sent) {
        break;
      }
    }
    if (!sent) {
      return { success: false, sentSegmentCount, stoppedByAutomation: false };
    }
    sentSegmentCount += 1;
  }

  return { success: true, sentSegmentCount, stoppedByAutomation: false };
}

/**
 * 仅在 WebSocket 处于 OPEN（readyState 1）且 send() 未抛异常时返回 true，
 * 这是第一版“消息发送成功”的判定标准；不等待服务端回执，也不自动补发。
 */
export function writeOpenWebSocket(
  socket: WebSocketWriter | null,
  payload: string
): boolean {
  if (socket === null || socket.readyState !== 1) {
    return false;
  }
  try {
    socket.send(payload);
    return true;
  } catch {
    return false;
  }
}
