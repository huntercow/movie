/**
 * 运行时消息契约（跨进程边界）。
 *
 * 本模块定义 background service worker 与闲鱼页面内容脚本之间通过
 * chrome.runtime 传递的全部消息类型：页面 hook 把业务请求发给后台，
 * 后台代理后端接口或 MTop 协议后返回结果。所有消息都是固定命令 +
 * 严格结构，不接受任意参数透传。
 *
 * 消息流向：页面（MAIN world xianyuPageHook）→ 内容脚本（ISOLATED world
 * xianyuContent.ts，decodeToolRequest 校验白名单）→ service worker
 * （background.ts 按 type 分派到各 BackgroundController）。这里的类型是
 * 三端共用的唯一契约，新增动作必须同步维护 RuntimeRequest /
 * TOOL_ACTIONS / background.ts 分派三处，并补 decodeToolRequest 测试。
 */
import type {
  AiReplyRequest,
  CreateQuoteTaskRequest,
  UpdateOrderResultRequest,
  UpdateOrderStatusRequest
} from "./backendApi.ts";
import type { ActiveActionPermit } from "./automationLifecycle.ts";
import type {
  CompletePaidMismatchCancellationRequest
} from "./paidVerificationAutomation.ts";
import type { BackendConfig } from "../upstream/backendConfig.ts";

/**
 * 页面内容脚本发给后台的运行时请求：动作类型 + 携带的严格结构化数据。
 *
 * 按业务域分组（自上而下）：
 *   - 配置/开关：GET_HOOK_SETTINGS、SET_HOOK_ENABLED、GET_REPLY_CONFIG、GET_AUTOMATION_CONFIG
 *   - 客服回复：AI_CUSTOMER_SERVICE
 *   - 报价工作流：CLAIM/ABORT_QUOTE_WORKFLOW、CREATE/GET/COMPLETE_QUOTE_TASK、GET_QUOTE_RECOVERIES
 *   - 待付款（改价催付）：LOOKUP_WAITING_PAYMENT、BEGIN/SETTLE_PRICE_ADJUSTMENT
 *   - 已付款（出票校验）：LOOKUP_PAID_ORDER、BEGIN/COMPLETE_ORDER_DETAIL_READ、ADVANCE_PAID_ORDER、
 *     BEGIN/COMPLETE_MISMATCH_CANCELLATION
 *   - 出票交付：GET_TICKET_RESULTS、BEGIN/ABORT_TICKET_DELIVERY、SETTLE_TICKET_RESULT
 *   - 通用：FETCH_IMAGE_DATA_URL
 * 所有写操作（SETTLE/COMPLETE/ABORT/ADVANCE）都要求携带 ActiveActionPermit：
 * 后台先 authorizeAction 签发（含 automationRevision 版本），执行后
 * classifyActionCompletion 收尾，防止自动化被关闭后仍继续执行。
 */
export type RuntimeRequest =
  | { type: "GET_HOOK_SETTINGS" }
  | { type: "SET_HOOK_ENABLED"; data: { enabled: boolean } }
  | { type: "GET_REPLY_CONFIG" }
  | { type: "AI_CUSTOMER_SERVICE"; data: AiReplyRequest }
  | { type: "GET_AUTOMATION_CONFIG" }
  | { type: "QUOTE_IMAGE"; data: CreateQuoteTaskRequest }
  | { type: "LOOKUP_WAITING_PAYMENT"; data: { chatId: string } }
  | {
      type: "BEGIN_PRICE_ADJUSTMENT";
      data: { businessOrderId: string; xianyuOrderId: string };
    }
  | {
      type: "SETTLE_PRICE_ADJUSTMENT";
      data: {
        request: Extract<UpdateOrderStatusRequest, { status: 25 }>;
        permit: ActiveActionPermit;
      };
    }
  | { type: "LOOKUP_PAID_ORDER"; data: { chatId: string } }
  | { type: "BEGIN_ORDER_DETAIL_READ" }
  | {
      type: "COMPLETE_ORDER_DETAIL_READ";
      data: { permit: ActiveActionPermit };
    }
  | { type: "ADVANCE_PAID_ORDER"; data: { id: string; actualPaidAmountCents: number } }
  | { type: "BEGIN_MISMATCH_CANCELLATION"; data: { id: string } }
  | {
      type: "COMPLETE_MISMATCH_CANCELLATION";
      data: {
        request: CompletePaidMismatchCancellationRequest;
        permit: ActiveActionPermit;
      };
    }
  | { type: "GET_TICKET_RESULTS" }
  | { type: "BEGIN_TICKET_DELIVERY"; data: { id: string } }
  | {
      type: "ABORT_TICKET_DELIVERY";
      data: { id: string; permit: ActiveActionPermit };
    }
  | {
      type: "SETTLE_TICKET_RESULT";
      data: {
        request: UpdateOrderResultRequest;
        permit: ActiveActionPermit;
      };
    }
  | { type: "FETCH_IMAGE_DATA_URL"; data: { url: string } }
  | { type: "SAVE_BACKEND_CONFIG"; data: { config: BackendConfig } }
  | { type: "OPEN_MANAGE_PAGE" }
  | {
      type: "UPDATE_REPLY_CONFIG";
      data: {
        templates: Record<string, string>;
        keywordRules: Array<{
          id: string;
          keywords: string[];
          reply: string;
          enabled: boolean;
          priority: number;
        }>;
      };
    };

/**
 * 页面 hook 可调用的全部动作白名单，运行时请求只能使用这里的动作。
 * 这是安全边界：decodeToolRequest 会拒绝白名单外的动作，即使页面被注入
 * 任意脚本也无法让插件代理未授权的请求。新增动作必须同步维护：
 * TOOL_ACTIONS 数组、RuntimeRequest 联合、background.ts 的 type 分派。
 */
export const TOOL_ACTIONS = [
  "FETCH_IMAGE_DATA_URL",
  "GET_REPLY_CONFIG",
  "GET_AUTOMATION_CONFIG",
  "AI_CUSTOMER_SERVICE",
  "QUOTE_IMAGE",
  "LOOKUP_WAITING_PAYMENT",
  "BEGIN_PRICE_ADJUSTMENT",
  "SETTLE_PRICE_ADJUSTMENT",
  "LOOKUP_PAID_ORDER",
  "BEGIN_ORDER_DETAIL_READ",
  "COMPLETE_ORDER_DETAIL_READ",
  "ADVANCE_PAID_ORDER",
  "BEGIN_MISMATCH_CANCELLATION",
  "COMPLETE_MISMATCH_CANCELLATION",
  "GET_TICKET_RESULTS",
  "BEGIN_TICKET_DELIVERY",
  "ABORT_TICKET_DELIVERY",
  "SETTLE_TICKET_RESULT"
] as const;

export type ToolAction = typeof TOOL_ACTIONS[number];

/** 页面工具请求：固定动作 + 严格 payload，禁止透传任意 URL/method/headers。 */
export interface ToolRequest {
  requestId: string;
  action: ToolAction;
  payload: Record<string, unknown>;
}

/**
 * 解码并校验一个工具请求：requestId 非空、action 必须命中白名单、payload 必须是对象。
 * 不满足任一条件即抛错，调用方不得继续执行。
 */
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
