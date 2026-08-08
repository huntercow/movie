import { matchKeywordRule } from "../handlers/replyAutomation.ts";
import { REPLY_TEMPLATE_KEYS } from "../handlers/backendApi.ts";
import type {
  KeywordRule,
  ReplyConfig,
  ReplyTemplateKey
} from "../handlers/backendApi.ts";

/**
 * 话术与关键字管理页的纯视图模型。
 *
 * 只做「配置 → 展示状态」的转换与关键词测试判定，不碰任何 DOM / chrome API，
 * 便于独立单测。展示数据全部来自后端已校验的 ReplyConfig（只读，不修改）。
 */

/** 管理页整体状态。 */
export type ManageViewStatus = "LOADING" | "UNAUTHENTICATED" | "READY" | "ERROR";

/** 一条话术模板的展示形态：key、全文、占位符列表与折叠预览。 */
export interface TemplateEntry {
  key: ReplyTemplateKey;
  text: string;
  placeholders: string[];
  preview: string;
}

/** 一条关键字规则的展示形态。 */
export interface RuleEntry {
  id: string;
  keywords: string[];
  reply: string;
  enabled: boolean;
  priority: number;
}

/** 管理页完整展示状态。 */
export interface ManageViewState {
  status: ManageViewStatus;
  version: number | null;
  templates: TemplateEntry[];
  rules: RuleEntry[];
}

/** 关键词测试结果：命中返回规则摘要，未命中标记将走 AI 客服。 */
export type KeywordTestResult =
  | { matched: true; ruleId: string; priority: number; keywords: string[]; reply: string }
  | { matched: false };

/** 提取模板文本中的全部 [占位符]（去重、按出现顺序）。 */
export function templatePlaceholders(text: string): string[] {
  const seen: string[] = [];
  const regex = /\[[^\[\]]+\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const placeholder = match[0];
    if (!seen.includes(placeholder)) {
      seen.push(placeholder);
    }
  }
  return seen;
}

/** 折叠预览：单行化、去 [分割符] 标记，截断到 80 字符。 */
function templatePreview(text: string): string {
  const singleLine = text
    .replace(/\[分割符\]/g, " ⏎ ")
    .replace(/\s+/g, " ")
    .trim();
  return singleLine.length > 80 ? `${singleLine.slice(0, 80)}…` : singleLine;
}

/**
 * 把已解码的 ReplyConfig 转为管理页展示状态。
 * 模板按 REPLY_TEMPLATE_KEYS 固定顺序输出；规则按 priority 降序（高优先级在前）。
 */
export function buildManageViewState(config: ReplyConfig): ManageViewState {
  const templates: TemplateEntry[] = REPLY_TEMPLATE_KEYS.map((key) => {
    const text = config.templates[key];
    return {
      key,
      text,
      placeholders: templatePlaceholders(text),
      preview: templatePreview(text)
    };
  });
  const rules: RuleEntry[] = [...config.keywordRules].sort(
    (a, b) => b.priority - a.priority
  );
  return {
    status: "READY",
    version: config.version,
    templates,
    rules
  };
}

/** 未登录/配置未就绪时的展示状态。 */
export function buildUnauthenticatedViewState(): ManageViewState {
  return { status: "UNAUTHENTICATED", version: null, templates: [], rules: [] };
}

/** 加载失败时的展示状态。 */
export function buildErrorViewState(): ManageViewState {
  return { status: "ERROR", version: null, templates: [], rules: [] };
}

/** 测试一条买家消息命中哪条关键字规则；未命中返回 matched: false（将走 AI 客服）。 */
export function testKeyword(text: string, rules: readonly KeywordRule[]): KeywordTestResult {
  const matched = matchKeywordRule(text, rules);
  if (matched === null) {
    return { matched: false };
  }
  return {
    matched: true,
    ruleId: matched.id,
    priority: matched.priority,
    keywords: matched.keywords,
    reply: matched.reply
  };
}
