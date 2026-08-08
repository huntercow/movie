/**
 * 待付款与改价自动化。
 *
 * 处理两类待付款消息（卡片 [我已拍下，待付款] 与系统提醒 等待买家付款）：
 * 按 chatId 查询 status: 20 业务记录、解析闲鱼订单号（卡片走 bizOrderId，
 * 系统提醒走 MTop headinfo，两类严格分开不互兑），调用 MTop 改价，
 * 业务成功后回写 status: 25 再发送 edit_price_success；无报价记录时发送
 * no_quote_record 并尝试取消已取得的闲鱼订单。
 */
import type {
  WaitingPaymentOrder,
  UpdateOrderStatusRequest
} from "./backendApi.ts";
import type {
  ActiveActionCompletion,
  ActiveActionPermit
} from "./automationLifecycle.ts";
import type { ReplyTemplateValues, TextDeliveryResult } from "./replyAutomation.ts";
import type { XianyuInboundEvent } from "../webhook/xianyuProtocol.ts";
import { rmbAmountToCents } from "../protocol/xianyuTradeProtocol.ts";

/** 待付款事件：卡片分支或系统提醒分支。 */
type WaitingPaymentEvent = Extract<
  XianyuInboundEvent,
  { kind: "WAITING_PAYMENT_CARD" | "WAITING_PAYMENT_SUMMARY" }
>;

/** 待付款业务记录查询结果：找到 / 没有记录 / 重复消息 / 后台丢弃。 */
export type WaitingPaymentLookupResult =
  | { kind: "FOUND"; order: WaitingPaymentOrder }
  | { kind: "NOT_FOUND" }
  | { kind: "DUPLICATE" }
  | { kind: "DISCARDED" };

/** 待付款工作流依赖的外部端口：查询、headinfo 解析、改价许可、MTop 改价与回写、话术发送。 */
export interface WaitingPaymentAutomationPort {
  canExecute(): Promise<boolean>;
  lookupWaitingPayment(chatId: string): Promise<WaitingPaymentLookupResult>;
  resolveHeadInfoOrderId(chatId: string, productId: string): Promise<string>;
  beginAdjustment(
    businessOrderId: string,
    xianyuOrderId: string
  ): Promise<ActiveActionPermit | null>;
  abortAdjustment?(
    businessOrderId: string,
    xianyuOrderId: string,
    permit: ActiveActionPermit
  ): Promise<void>;
  claimNoQuoteNotification?(xianyuOrderId: string): Promise<boolean>;
  adjustPrice(amountCents: number, xianyuOrderId: string): Promise<void>;
  settleAdjusted(
    request: Extract<UpdateOrderStatusRequest, { status: 25 }>,
    permit: ActiveActionPermit
  ): Promise<Extract<ActiveActionCompletion, "CONTINUE" | "SETTLE_ONLY">>;
  deliverTemplate(
    templateKey: "no_quote_record" | "edit_price_success",
    values: ReplyTemplateValues,
    chatId: string,
    receiverId: string | null
  ): Promise<Pick<TextDeliveryResult, "success" | "stoppedByAutomation">>;
  proposeSellerCancellation(xianyuOrderId: string): Promise<void>;
}

/**
 * 待付款工作流结果：STOPPED 自动工作关闭；DUPLICATE 重复消息；
 * NO_QUOTE 没有报价记录（是否已提议取消）；ADJUSTED 改价成功（是否已通知买家）。
 */
export type WaitingPaymentWorkflowResult =
  | { kind: "STOPPED" }
  | { kind: "DUPLICATE" }
  | { kind: "NO_QUOTE"; cancellationProposed: boolean }
  | {
      kind: "ADJUSTED";
      businessOrderId: string;
      xianyuOrderId: string;
      notified: boolean;
    };

/** 校验必填文本，空值抛错。 */
function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

/**
 * 创建待付款改价自动化实例。内部用业务订单 ID 与闲鱼订单号的去重集合
 * 防止同一消息重复到达时产生重复改价或重复通知。
 */
export function createWaitingPaymentAutomation(port: WaitingPaymentAutomationPort): {
  handle(event: WaitingPaymentEvent): Promise<WaitingPaymentWorkflowResult>;
} {
  const inFlightBusinessOrderIds = new Set<string>();
  const completedBusinessOrderIds = new Set<string>();
  const inFlightXianyuOrderIds = new Set<string>();
  const completedXianyuOrderIds = new Set<string>();

  function isBusinessDuplicate(id: string): boolean {
    return inFlightBusinessOrderIds.has(id) || completedBusinessOrderIds.has(id);
  }

  function isXianyuDuplicate(id: string): boolean {
    return inFlightXianyuOrderIds.has(id) || completedXianyuOrderIds.has(id);
  }

  return {
    async handle(event): Promise<WaitingPaymentWorkflowResult> {
      if (!await port.canExecute()) {
        return { kind: "STOPPED" };
      }

      let xianyuOrderId: string | null = event.kind === "WAITING_PAYMENT_CARD"
        ? nonEmptyString(event.orderId, "waiting-payment card xianyuOrderId")
        : null;
      let businessOrderId: string | null = null;
      let adjustmentSucceeded = false;
      let adjustmentPermit: ActiveActionPermit | null = null;

      if (xianyuOrderId !== null) {
        if (isXianyuDuplicate(xianyuOrderId)) {
          return { kind: "DUPLICATE" };
        }
        inFlightXianyuOrderIds.add(xianyuOrderId);
      }

      try {
        const lookup = await port.lookupWaitingPayment(event.chatId);
        if (lookup.kind === "DISCARDED") {
          return { kind: "STOPPED" };
        }
        if (lookup.kind === "DUPLICATE") {
          return { kind: "DUPLICATE" };
        }
        if (lookup.kind === "NOT_FOUND") {
          if (xianyuOrderId !== null) {
            const ownsNotification = port.claimNoQuoteNotification === undefined
              ? true
              : await port.claimNoQuoteNotification(xianyuOrderId);
            if (!ownsNotification) {
              return { kind: "DUPLICATE" };
            }
            completedXianyuOrderIds.add(xianyuOrderId);
          }
          const delivery = await port.deliverTemplate(
            "no_quote_record",
            {},
            event.chatId,
            event.kind === "WAITING_PAYMENT_CARD" ? event.senderId : null
          );
          let cancellationProposed = false;
          if (
            xianyuOrderId !== null &&
            !delivery.stoppedByAutomation &&
            await port.canExecute()
          ) {
            await port.proposeSellerCancellation(xianyuOrderId);
            completedXianyuOrderIds.add(xianyuOrderId);
            cancellationProposed = true;
          }
          return { kind: "NO_QUOTE", cancellationProposed };
        }

        const order = lookup.order;
        businessOrderId = order.id;
        if (isBusinessDuplicate(businessOrderId)) {
          return { kind: "DUPLICATE" };
        }
        inFlightBusinessOrderIds.add(businessOrderId);

        if (event.kind === "WAITING_PAYMENT_SUMMARY") {
          if (!await port.canExecute()) {
            return { kind: "STOPPED" };
          }
          xianyuOrderId = nonEmptyString(
            await port.resolveHeadInfoOrderId(event.chatId, order.productId),
            "waiting-payment headinfo xianyuOrderId"
          );
          if (isXianyuDuplicate(xianyuOrderId)) {
            return { kind: "DUPLICATE" };
          }
          inFlightXianyuOrderIds.add(xianyuOrderId);
        }

        if (!await port.canExecute()) {
          return { kind: "STOPPED" };
        }
        const confirmedXianyuOrderId = nonEmptyString(
          xianyuOrderId,
          "waiting-payment xianyuOrderId"
        );
        adjustmentPermit = await port.beginAdjustment(
          businessOrderId,
          confirmedXianyuOrderId
        );
        if (adjustmentPermit === null) {
          return { kind: "STOPPED" };
        }
        if (!await port.canExecute()) {
          if (port.abortAdjustment !== undefined) {
            await port.abortAdjustment(
              businessOrderId,
              confirmedXianyuOrderId,
              adjustmentPermit
            );
          }
          adjustmentPermit = null;
          return { kind: "STOPPED" };
        }
        await port.adjustPrice(rmbAmountToCents(order.amount), confirmedXianyuOrderId);
        adjustmentSucceeded = true;
        completedBusinessOrderIds.add(businessOrderId);
        completedXianyuOrderIds.add(confirmedXianyuOrderId);

        const completion = await port.settleAdjusted({
          id: businessOrderId,
          status: 25,
          xianyuOrderId: confirmedXianyuOrderId
        }, adjustmentPermit);
        let notified = false;
        if (completion === "CONTINUE" && await port.canExecute()) {
          const delivery = await port.deliverTemplate(
            "edit_price_success",
            {
              businessOrderId,
              cityName: order.cityName,
              cinemaName: order.cinemaName
            },
            event.chatId,
            order.customerId
          );
          notified = delivery.success;
        }
        return {
          kind: "ADJUSTED",
          businessOrderId,
          xianyuOrderId: confirmedXianyuOrderId,
          notified
        };
      } catch (error) {
        if (
          adjustmentPermit !== null &&
          !adjustmentSucceeded &&
          businessOrderId !== null &&
          xianyuOrderId !== null &&
          port.abortAdjustment !== undefined
        ) {
          await port.abortAdjustment(
            businessOrderId,
            xianyuOrderId,
            adjustmentPermit
          );
        }
        throw error;
      } finally {
        if (businessOrderId !== null) {
          inFlightBusinessOrderIds.delete(businessOrderId);
          if (!adjustmentSucceeded) {
            completedBusinessOrderIds.delete(businessOrderId);
          }
        }
        if (xianyuOrderId !== null) {
          inFlightXianyuOrderIds.delete(xianyuOrderId);
          if (!adjustmentSucceeded && !completedXianyuOrderIds.has(xianyuOrderId)) {
            completedXianyuOrderIds.delete(xianyuOrderId);
          }
        }
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

/** 解码待付款业务记录：status 必须为 20，金额必须可转为整数分。 */
function waitingPaymentOrder(value: unknown): WaitingPaymentOrder {
  const order = record(value, "waiting-payment lookup order");
  exactKeys(order, ["id", "status", "productId", "customerId", "cityName", "cinemaName", "amount"], "waiting-payment lookup order");
  if (order.status !== 20) throw new Error("waiting-payment lookup order status must be 20");
  if (typeof order.amount !== "number") throw new Error("waiting-payment lookup order amount must be a number");
  rmbAmountToCents(order.amount);
  return {
    id: nonEmptyString(order.id, "waiting-payment lookup order id"),
    status: 20,
    productId: nonEmptyString(order.productId, "waiting-payment lookup order productId"),
    customerId: nonEmptyString(order.customerId, "waiting-payment lookup order customerId"),
    cityName: nonEmptyString(order.cityName, "waiting-payment lookup order cityName"),
    cinemaName: nonEmptyString(order.cinemaName, "waiting-payment lookup order cinemaName"),
    amount: order.amount
  };
}

/** 解码跨进程的待付款查询结果（页面 hook -> background 返回值）。 */
export function decodeWaitingPaymentLookupResult(value: unknown): WaitingPaymentLookupResult {
  const result = record(value, "waiting-payment lookup result");
  if (result.kind === "FOUND") {
    exactKeys(result, ["kind", "order"], "waiting-payment lookup result");
    return { kind: "FOUND", order: waitingPaymentOrder(result.order) };
  }
  if (
    result.kind === "NOT_FOUND" ||
    result.kind === "DUPLICATE" ||
    result.kind === "DISCARDED"
  ) {
    exactKeys(result, ["kind"], "waiting-payment lookup result");
    return { kind: result.kind };
  }
  throw new Error("waiting-payment lookup result kind is unknown");
}

/** 解码改价执行许可：只接受 effect 为 WRITE 的非负修订号。 */
export function decodeAdjustmentPermit(value: unknown): ActiveActionPermit | null {
  if (value === null) return null;
  const permit = record(value, "adjustment permit");
  exactKeys(permit, ["effect", "automationRevision"], "adjustment permit");
  if (permit.effect !== "WRITE") throw new Error("adjustment permit effect must be WRITE");
  if (!Number.isSafeInteger(permit.automationRevision) || (permit.automationRevision as number) < 0) {
    throw new Error("adjustment permit automationRevision must be a non-negative safe integer");
  }
  return { effect: "WRITE", automationRevision: permit.automationRevision as number };
}

/** 解码改价回写完成结果：只接受 CONTINUE 或 SETTLE_ONLY。 */
export function decodeAdjustmentCompletion(
  value: unknown
): Extract<ActiveActionCompletion, "CONTINUE" | "SETTLE_ONLY"> {
  if (value !== "CONTINUE" && value !== "SETTLE_ONLY") {
    throw new Error("adjustment completion must be CONTINUE or SETTLE_ONLY");
  }
  return value;
}
