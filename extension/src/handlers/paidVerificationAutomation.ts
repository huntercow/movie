/**
 * 付款金额校验自动化。
 *
 * 处理已付款事件（卡片 [我已付款，等待你发货] 与系统提醒 等待卖家发货）：
 * 按 chatId 查 status: 25 记录，用后端保存的 xianyuOrderId 读取闲鱼订单详情实际
 * 成交金额，按“分”与后端 amount 直接比较；一致回写 status: 30 并发送
 * payment_successful（后端开始出票）；不一致不回写 30、取消闲鱼订单并回写 90；
 * 金额不可读时不改变订单状态。
 */
import type {
  OrderByStatus
} from "./backendApi.ts";
import type {
  ActiveActionCompletion,
  ActiveActionPermit
} from "./automationLifecycle.ts";
import type { TextDeliveryResult } from "./replyAutomation.ts";
import type { XianyuInboundEvent } from "../webhook/xianyuProtocol.ts";
import {
  rmbAmountToCents,
  type VerifiedOrderAmounts
} from "../protocol/xianyuTradeProtocol.ts";

/** 已付款事件：卡片分支或系统提醒分支。 */
type PaidEvent = Extract<
  XianyuInboundEvent,
  { kind: "PAID_CARD" | "PAYMENT_SUMMARY" }
>;

/** 已付款业务记录查询结果：找到 / 没有记录 / 后台丢弃。 */
export type PaidOrderLookupResult =
  | { kind: "FOUND"; order: OrderByStatus }
  | { kind: "NOT_FOUND" }
  | { kind: "DISCARDED" };

/** 验款通过后推进订单的结果：继续 / 只收尾 / 丢弃 / 重复。 */
export type PaidAdvanceCompletion = Extract<
  ActiveActionCompletion,
  "CONTINUE" | "SETTLE_ONLY" | "DISCARD"
> | "DUPLICATE";

/** 卖家取消结果：issued false 未发出请求；issued true 时带明确成败。 */
export type PaidSellerCancellationResult =
  | { issued: false }
  | { issued: true; succeeded: boolean };

/** 金额不一致/上游失败取消后的回写请求：业务订单 ID、实际金额与取消结果。 */
export interface CompletePaidMismatchCancellationRequest {
  businessOrderId: string;
  actualAmount: number;
  failureReason: "AMOUNT_MISMATCH" | "UPSTREAM_ORDER_FAILED";
  cancellation: PaidSellerCancellationResult;
}

/** 金额不一致取消的回写结果：继续 / 只收尾 / 取消未发出。 */
export type PaidMismatchCancellationCompletion =
  | Extract<ActiveActionCompletion, "CONTINUE" | "SETTLE_ONLY">
  | "NOT_ISSUED";

/** 付款校验工作流依赖的外部端口：查询、订单详情读取许可、金额推进、取消与话术。 */
export interface PaidVerificationAutomationPort {
  canExecute(): Promise<boolean>;
  lookupPaidOrder(chatId: string): Promise<PaidOrderLookupResult>;
  beginOrderDetailRead(): Promise<ActiveActionPermit | null>;
  fetchOrderDetail(xianyuOrderId: string): Promise<Pick<VerifiedOrderAmounts, "actualPaidAmountCents">>;
  completeOrderDetailRead(
    permit: ActiveActionPermit
  ): Promise<Extract<ActiveActionCompletion, "CONTINUE" | "DISCARD">>;
  advancePaid(businessOrderId: string, actualPaidAmountCents: number): Promise<PaidAdvanceCompletion>;
  beginMismatchCancellation(businessOrderId: string): Promise<ActiveActionPermit | null>;
  cancelSellerOrder(xianyuOrderId: string): Promise<PaidSellerCancellationResult>;
  completeMismatchCancellation(
    request: CompletePaidMismatchCancellationRequest,
    permit: ActiveActionPermit
  ): Promise<PaidMismatchCancellationCompletion>;
  deliverPaymentSuccessful(
    chatId: string,
    receiverId: string,
    businessOrderId: string
  ): Promise<Pick<TextDeliveryResult, "success" | "stoppedByAutomation">>;
  deliverCancelNotice(
    chatId: string,
    receiverId: string,
    businessOrderId: string
  ): Promise<Pick<TextDeliveryResult, "success" | "stoppedByAutomation">>;
}

/**
 * 付款校验工作流结果：STOPPED 关闭/丢弃；DUPLICATE 重复；NO_RECORD 无记录（静默）；
 * PAID 验款通过（是否已通知）；AMOUNT_MISMATCH 金额不一致（含取消结果）。
 */
export type PaidVerificationWorkflowResult =
  | { kind: "STOPPED" }
  | { kind: "DUPLICATE" }
  | { kind: "NO_RECORD" }
  | { kind: "PAID"; businessOrderId: string; notified: boolean }
  | {
      kind: "AMOUNT_MISMATCH";
      businessOrderId: string;
      actualAmount: number;
      cancelSucceeded: boolean;
    };

/** 校验必填文本，空值抛错。 */
function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

/** 校验正整数（金额分等）。 */
function positiveSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value as number;
}

/** 把整数分转换为人民币元（两位小数），并校验可逆转换。 */
function centsToRmbAmount(value: number): number {
  const cents = positiveSafeInteger(value, "actual paid amount cents");
  const amount = Number(`${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`);
  rmbAmountToCents(amount);
  return amount;
}

/** 校验卖家取消结果结构：issued 必须与 succeeded 同时存在或同时不存在。 */
function cancellationResult(
  value: PaidSellerCancellationResult
): PaidSellerCancellationResult {
  if (value.issued === false) {
    return { issued: false };
  }
  if (value.issued === true && typeof value.succeeded === "boolean") {
    return { issued: true, succeeded: value.succeeded };
  }
  throw new Error("seller cancellation result has an unexpected structure");
}

/**
 * 创建付款校验自动化实例。内部按业务订单 ID 去重，
 * 防止同一消息重复到达时重复验款、重复推进或重复取消。
 */
export function createPaidVerificationAutomation(
  port: PaidVerificationAutomationPort
): { handle(event: PaidEvent): Promise<PaidVerificationWorkflowResult> } {
  const inFlightBusinessOrderIds = new Set<string>();
  const completedBusinessOrderIds = new Set<string>();

  /**
   * 良票下单失败(如余额不足)的处理:发 cancel_ticket 通知买家 → 取消闲鱼订单 →
   * 回写 status 90(UPSTREAM_ORDER_FAILED)。通知失败仍继续取消(买家必须退款),
   * 取消未发出时回写 90 会抛错(结算日志保护)。
   */
  async function handleUpstreamOrderFailed(options: {
    port: PaidVerificationAutomationPort;
    event: PaidEvent;
    order: OrderByStatus;
    businessOrderId: string;
    xianyuOrderId: string;
    actualPaidAmountCents: number;
    error: unknown;
  }): Promise<PaidVerificationWorkflowResult> {
    const {
      port,
      event,
      order,
      businessOrderId,
      xianyuOrderId,
      actualPaidAmountCents,
    } = options;
    if (!await port.canExecute()) {
      return { kind: "STOPPED" };
    }
    const writePermit = await port.beginMismatchCancellation(businessOrderId);
    if (writePermit === null) {
      return { kind: "STOPPED" };
    }
    // 先通知买家「出票失败将退款」;通知失败不阻断取消。
    try {
      await port.deliverCancelNotice(
        event.chatId,
        nonEmptyString(order.customerId, "paid customer id"),
        businessOrderId
      );
    } catch {
      // 通知失败:仍继续取消,退款优先。
    }
    if (!await port.canExecute()) {
      return { kind: "STOPPED" };
    }
    const cancellation = cancellationResult(
      await port.cancelSellerOrder(xianyuOrderId)
    );
    const actualAmount = centsToRmbAmount(actualPaidAmountCents);
    const completion = await port.completeMismatchCancellation({
      businessOrderId,
      actualAmount,
      failureReason: "UPSTREAM_ORDER_FAILED",
      cancellation
    }, writePermit);
    if (completion === "NOT_ISSUED") {
      return { kind: "STOPPED" };
    }
    if (!cancellation.issued) {
      throw new Error("an unissued cancellation cannot settle status 90");
    }
    completedBusinessOrderIds.add(businessOrderId);
    return {
      kind: "AMOUNT_MISMATCH",
      businessOrderId,
      actualAmount,
      cancelSucceeded: cancellation.succeeded
    };
  }

  return {
    async handle(event): Promise<PaidVerificationWorkflowResult> {
      if (!await port.canExecute()) {
        return { kind: "STOPPED" };
      }

      const lookup = await port.lookupPaidOrder(event.chatId);
      if (lookup.kind === "DISCARDED") {
        return { kind: "STOPPED" };
      }
      if (lookup.kind === "NOT_FOUND") {
        return { kind: "NO_RECORD" };
      }

      const order = lookup.order;
      const businessOrderId = nonEmptyString(order.id, "paid business order id");
      const xianyuOrderId = nonEmptyString(order.xianyuOrderId, "paid xianyu order id");
      if (
        inFlightBusinessOrderIds.has(businessOrderId) ||
        completedBusinessOrderIds.has(businessOrderId)
      ) {
        return { kind: "DUPLICATE" };
      }
      inFlightBusinessOrderIds.add(businessOrderId);

      try {
        if (!await port.canExecute()) {
          return { kind: "STOPPED" };
        }
        const readPermit = await port.beginOrderDetailRead();
        if (readPermit === null) {
          return { kind: "STOPPED" };
        }
        const detail = await port.fetchOrderDetail(xianyuOrderId);
        const actualPaidAmountCents = positiveSafeInteger(
          detail.actualPaidAmountCents,
          "actual paid amount cents"
        );
        if (await port.completeOrderDetailRead(readPermit) !== "CONTINUE") {
          return { kind: "STOPPED" };
        }

        if (actualPaidAmountCents === rmbAmountToCents(order.amount)) {
          let completion: PaidAdvanceCompletion;
          try {
            completion = await port.advancePaid(businessOrderId, actualPaidAmountCents);
          } catch (error) {
            // 后端良票下单失败(如余额不足): 已回退 25 并记录原因。
            // 不再重试下单,转入「通知买家 + 取消闲鱼订单 + 回写 90」。
            return await handleUpstreamOrderFailed({
              port,
              event,
              order,
              businessOrderId,
              xianyuOrderId,
              actualPaidAmountCents,
              error,
            });
          }
          if (completion === "DISCARD") {
            return { kind: "STOPPED" };
          }
          if (completion === "DUPLICATE") {
            completedBusinessOrderIds.add(businessOrderId);
            return { kind: "DUPLICATE" };
          }
          completedBusinessOrderIds.add(businessOrderId);
          let notified = false;
          if (completion === "CONTINUE" && await port.canExecute()) {
            notified = (await port.deliverPaymentSuccessful(
              event.chatId,
              nonEmptyString(order.customerId, "paid customer id"),
              businessOrderId
            )).success;
          }
          return { kind: "PAID", businessOrderId, notified };
        }

        if (!await port.canExecute()) {
          return { kind: "STOPPED" };
        }
        const writePermit = await port.beginMismatchCancellation(businessOrderId);
        if (writePermit === null) {
          return { kind: "STOPPED" };
        }
        const cancellation = cancellationResult(
          await port.cancelSellerOrder(xianyuOrderId)
        );
        const actualAmount = centsToRmbAmount(actualPaidAmountCents);
        const completion = await port.completeMismatchCancellation({
          businessOrderId,
          actualAmount,
          failureReason: "AMOUNT_MISMATCH",
          cancellation
        }, writePermit);
        if (completion === "NOT_ISSUED") {
          return { kind: "STOPPED" };
        }
        if (!cancellation.issued) {
          throw new Error("an unissued cancellation cannot settle status 90");
        }
        completedBusinessOrderIds.add(businessOrderId);
        return {
          kind: "AMOUNT_MISMATCH",
          businessOrderId,
          actualAmount,
          cancelSucceeded: cancellation.succeeded
        };
      } finally {
        inFlightBusinessOrderIds.delete(businessOrderId);
      }
    }
  };
}

/** 严格校验对象只包含指定键（用于跨进程消息解码）。 */
function exactKeys(value: Record<string, unknown>, expected: readonly string[], context: string): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`${context} has an unexpected structure`);
  }
}

/** 校验未知值为普通对象，否则抛错。 */
function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** 解码已付款业务记录：金额必须可转为整数分。 */
function paidOrder(value: unknown): OrderByStatus {
  const order = record(value, "paid order lookup order");
  exactKeys(order, ["id", "xianyuOrderId", "customerId", "amount"], "paid order lookup order");
  if (typeof order.amount !== "number") {
    throw new Error("paid order lookup amount must be a number");
  }
  rmbAmountToCents(order.amount);
  return {
    id: nonEmptyString(order.id, "paid order lookup id"),
    xianyuOrderId: nonEmptyString(order.xianyuOrderId, "paid order lookup xianyuOrderId"),
    customerId: nonEmptyString(order.customerId, "paid order lookup customerId"),
    amount: order.amount
  };
}

/** 解码跨进程的已付款订单查询结果。 */
export function decodePaidOrderLookupResult(value: unknown): PaidOrderLookupResult {
  const result = record(value, "paid order lookup result");
  if (result.kind === "FOUND") {
    exactKeys(result, ["kind", "order"], "paid order lookup result");
    return { kind: "FOUND", order: paidOrder(result.order) };
  }
  if (result.kind === "NOT_FOUND" || result.kind === "DISCARDED") {
    exactKeys(result, ["kind"], "paid order lookup result");
    return { kind: result.kind };
  }
  throw new Error("paid order lookup result kind is unknown");
}

/** 解码已付款动作许可：effect 必须与期望的 READ/WRITE 一致。 */
export function decodePaidActionPermit(
  value: unknown,
  expectedEffect: "READ" | "WRITE"
): ActiveActionPermit | null {
  if (value === null) return null;
  const permit = record(value, "paid action permit");
  exactKeys(permit, ["effect", "automationRevision"], "paid action permit");
  if (permit.effect !== expectedEffect) {
    throw new Error(`paid action permit effect must be ${expectedEffect}`);
  }
  if (!Number.isSafeInteger(permit.automationRevision) || (permit.automationRevision as number) < 0) {
    throw new Error("paid action permit automationRevision must be a non-negative safe integer");
  }
  return { effect: expectedEffect, automationRevision: permit.automationRevision as number };
}

/** 解码订单详情读取完成结果：只接受 CONTINUE 或 DISCARD。 */
export function decodePaidReadCompletion(
  value: unknown
): Extract<ActiveActionCompletion, "CONTINUE" | "DISCARD"> {
  if (value !== "CONTINUE" && value !== "DISCARD") {
    throw new Error("paid read completion must be CONTINUE or DISCARD");
  }
  return value;
}

/** 解码验款推进结果：CONTINUE / SETTLE_ONLY / DISCARD / DUPLICATE。 */
export function decodePaidAdvanceCompletion(value: unknown): PaidAdvanceCompletion {
  if (
    value !== "CONTINUE" &&
    value !== "SETTLE_ONLY" &&
    value !== "DISCARD" &&
    value !== "DUPLICATE"
  ) {
    throw new Error("paid advance completion is unknown");
  }
  return value;
}

/** 解码金额不一致取消回写结果：CONTINUE / SETTLE_ONLY / NOT_ISSUED。 */
export function decodePaidMismatchCancellationCompletion(
  value: unknown
): PaidMismatchCancellationCompletion {
  if (
    value !== "CONTINUE" &&
    value !== "SETTLE_ONLY" &&
    value !== "NOT_ISSUED"
  ) {
    throw new Error("paid mismatch cancellation completion is unknown");
  }
  return value;
}
