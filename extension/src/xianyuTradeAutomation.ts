import type { XianyuInboundEvent } from "./xianyuProtocol.ts";
import {
  XianyuOrderDetailProtocolError,
  XianyuOrderDetailRequestError,
  type VerifiedOrderAmounts
} from "./xianyuTradeProtocol.ts";

export type XianyuVerificationFailureCode =
  | "ADJUST_PRICE_REJECTED"
  | "ORDER_DETAIL_REQUEST_FAILED"
  | "ORDER_DETAIL_PROTOCOL_ERROR"
  | "ORDER_ID_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "NON_ZERO_POST_FEE"
  | "MISSING_ADJUSTMENT";

type WaitingPaymentCard = Extract<XianyuInboundEvent, { kind: "WAITING_PAYMENT_CARD" }>;
type XianyuTradeEvent = Extract<
  XianyuInboundEvent,
  { kind: "WAITING_PAYMENT_CARD" | "PAID_CARD" | "PAYMENT_SUMMARY" | "MESSAGE_UPDATE" }
>;

export interface WaitingPaymentResult {
  platformOrderId: string;
  quoteNo: string;
  totalPriceCents: number;
  status: "WAIT_BUYER_PAY";
}

const XIANYU_ORDER_STATUSES = [
  "WAIT_IMAGE",
  "QUOTED",
  "WAIT_BUYER_PAY",
  "PAID_WAIT_SUBMIT",
  "TICKETING",
  "ISSUED_WAIT_DELIVER",
  "DELIVERY_OUTCOME_PENDING",
  "DELIVERED",
  "NEED_MANUAL",
  "REFUNDED",
  "CLOSED"
] as const;

export type XianyuOrderStatus = typeof XIANYU_ORDER_STATUSES[number];

export interface XianyuOrderPayload {
  platformOrderId: string;
  chatId: string;
  buyerUserId: string;
  status: XianyuOrderStatus;
  lastError?: string;
  shouldPoll: boolean;
  shouldDeliver: boolean;
  deliveryMessage?: string;
  ticketCodeInfo?: string;
  deliveryAttemptId?: string;
  deliveryAttemptOutcome?: "SUCCESS" | "FAILURE";
}

export type PaidVerificationResult =
  | { kind: "ACTIVE"; order: XianyuOrderPayload }
  | { kind: "NEED_MANUAL"; order: XianyuOrderPayload }
  | { kind: "TERMINAL"; order: XianyuOrderPayload };

export type DeliveryPollResult =
  | { kind: "WAIT"; order: XianyuOrderPayload }
  | { kind: "READY"; order: XianyuOrderPayload }
  | { kind: "NEED_MANUAL"; order: XianyuOrderPayload }
  | { kind: "NO_REPLAY"; order: XianyuOrderPayload }
  | { kind: "TERMINAL"; order: XianyuOrderPayload };

export type ClaimDeliveryResult =
  | {
      kind: "CLAIMED";
      order: XianyuOrderPayload & {
        deliveryAttemptId: string;
        deliveryMessage: string;
        ticketCodeInfo: string;
      };
    }
  | { kind: "NOT_CLAIMED"; order: XianyuOrderPayload };

export interface XianyuTradePorts {
  registerWaitingPayment(event: WaitingPaymentCard): Promise<WaitingPaymentResult>;
  adjustPrice(amountCents: number, orderId: string): Promise<void>;
  recordAdjusted(orderId: string, amountCents: number): Promise<void>;
  resolveActiveOrder(chatId: string): Promise<{ platformOrderId: string }>;
  fetchOrderDetail(orderId: string): Promise<VerifiedOrderAmounts>;
  verifyPaid(orderId: string, amounts: VerifiedOrderAmounts): Promise<void>;
  recordVerificationFailure(orderId: string, code: XianyuVerificationFailureCode): Promise<unknown>;
  recordUnboundProtocolEvent(chatId: string, eventType: string): Promise<void>;
  sendEditPriceSuccess(chatId: string, receiverId: string): Promise<void>;
}

export function createXianyuTradeAutomation(ports: XianyuTradePorts): {
  handle(event: XianyuTradeEvent): Promise<void>;
} {
  async function recordFailure(orderId: string, code: XianyuVerificationFailureCode): Promise<void> {
    decodeVerificationFailureResult(await ports.recordVerificationFailure(orderId, code), orderId);
  }

  async function verifyPersistedOrder(orderId: string): Promise<void> {
    let amounts: VerifiedOrderAmounts;
    try {
      amounts = await ports.fetchOrderDetail(orderId);
    } catch (error) {
      if (error instanceof XianyuOrderDetailRequestError) {
        await recordAndRethrow(
          error,
          () => recordFailure(orderId, "ORDER_DETAIL_REQUEST_FAILED"),
          "order detail request failure recording failed"
        );
      } else if (error instanceof XianyuOrderDetailProtocolError) {
        await recordAndRethrow(
          error,
          () => recordFailure(orderId, "ORDER_DETAIL_PROTOCOL_ERROR"),
          "order detail protocol failure recording failed"
        );
      }
      throw error;
    }
    await ports.verifyPaid(orderId, amounts);
  }

  async function resolveOrRecordUnbound(
    chatId: string,
    eventType: "UNBOUND_PAYMENT_SUMMARY" | "UNBOUND_PAID_CARD"
  ): Promise<{ platformOrderId: string }> {
    try {
      return requireResolvedOrder(await ports.resolveActiveOrder(chatId));
    } catch (error) {
      return recordAndRethrow(
        error,
        () => ports.recordUnboundProtocolEvent(chatId, eventType),
        `${eventType.toLowerCase()} recording failed`
      );
    }
  }

  return {
    async handle(event): Promise<void> {
      switch (event.kind) {
        case "WAITING_PAYMENT_CARD": {
          const result = requireWaitingPaymentResult(await ports.registerWaitingPayment(event), event.orderId);
          try {
            await ports.adjustPrice(result.totalPriceCents, result.platformOrderId);
          } catch (error) {
            await recordAndRethrow(
              error,
              () => recordFailure(result.platformOrderId, "ADJUST_PRICE_REJECTED"),
              "adjustment failure recording failed"
            );
          }
          await ports.recordAdjusted(result.platformOrderId, result.totalPriceCents);
          await ports.sendEditPriceSuccess(event.chatId, event.senderId);
          return;
        }
        case "PAYMENT_SUMMARY": {
          const resolved = await resolveOrRecordUnbound(event.chatId, "UNBOUND_PAYMENT_SUMMARY");
          await verifyPersistedOrder(resolved.platformOrderId);
          return;
        }
        case "PAID_CARD": {
          const resolved = await resolveOrRecordUnbound(event.chatId, "UNBOUND_PAID_CARD");
          if (resolved.platformOrderId !== event.orderId) {
            const mismatch = new Error("paid card order id mismatch");
            await recordAndRethrow(
              mismatch,
              () => recordFailure(resolved.platformOrderId, "ORDER_ID_MISMATCH"),
              "paid card order mismatch recording failed"
            );
          }
          await verifyPersistedOrder(resolved.platformOrderId);
          return;
        }
        case "MESSAGE_UPDATE":
          return;
        default:
          return assertNever(event);
      }
    }
  };
}

export function decodeAdjustedOrderResult(value: unknown, expectedOrderId: string): void {
  const result = decodeOrderStateResult(value, "adjusted order response");
  requireStateResultOrderId(result, expectedOrderId, "adjusted order response");
  if (result.status !== "WAIT_BUYER_PAY") {
    throw new Error("adjusted order response status must equal WAIT_BUYER_PAY");
  }
  requireNoAutomaticWork(result, "adjusted order response");
}

export function decodeVerificationFailureResult(value: unknown, expectedOrderId: string): void {
  decodeNeedManualResult(value, expectedOrderId, "verification failure response");
}

export function decodeDeliveryFailureResult(
  value: unknown,
  expectedOrderId: string,
  expectedAttemptId: string
): void {
  const result = decodeNeedManualResult(value, expectedOrderId, "delivery failure response");
  requireDeliveryResultAttempt(result, expectedAttemptId, "FAILURE", "delivery failure response");
}

export function decodeDeliverySuccessResult(
  value: unknown,
  expectedOrderId: string,
  expectedAttemptId: string
): void {
  const result = decodeOrderStateResult(value, "delivery success response");
  requireStateResultOrderId(result, expectedOrderId, "delivery success response");
  if (result.status !== "DELIVERED") {
    throw new Error("delivery success response status must equal DELIVERED");
  }
  requireNoAutomaticWork(result, "delivery success response");
  requireDeliveryResultAttempt(result, expectedAttemptId, "SUCCESS", "delivery success response");
}

export function decodeXianyuOrderPayload(value: unknown, context: string): XianyuOrderPayload {
  const payload = requireRecord(value, context);
  if (payload.tradeNo !== undefined && payload.tradeNo !== null) {
    requireNonEmptyString(payload.tradeNo, `${context}.tradeNo`);
  }
  const status = requireNonEmptyString(payload.status, `${context}.status`);
  if (!XIANYU_ORDER_STATUSES.includes(status as XianyuOrderStatus)) {
    throw new Error(`${context} status is unknown: ${status}`);
  }
  const decoded: XianyuOrderPayload = {
    platformOrderId: requireNonEmptyString(payload.platformOrderId, `${context}.platformOrderId`),
    chatId: requireNonEmptyString(payload.chatId, `${context}.chatId`),
    buyerUserId: requireNonEmptyString(payload.buyerUserId, `${context}.buyerUserId`),
    status: status as XianyuOrderStatus,
    lastError: optionalString(payload.lastError, `${context}.lastError`),
    shouldPoll: requireBoolean(payload.shouldPoll, `${context}.shouldPoll`),
    shouldDeliver: requireBoolean(payload.shouldDeliver, `${context}.shouldDeliver`),
    deliveryMessage: optionalString(payload.deliveryMessage, `${context}.deliveryMessage`),
    ticketCodeInfo: optionalString(payload.ticketCodeInfo, `${context}.ticketCodeInfo`),
    deliveryAttemptId: optionalString(payload.deliveryAttemptId, `${context}.deliveryAttemptId`),
    deliveryAttemptOutcome: optionalDeliveryAttemptOutcome(
      payload.deliveryAttemptOutcome,
      `${context}.deliveryAttemptOutcome`
    )
  };
  return decoded;
}

export function classifyPaidVerificationResult(value: unknown): PaidVerificationResult {
  const order = decodeXianyuOrderPayload(value, "paid verification");
  switch (order.status) {
    case "PAID_WAIT_SUBMIT":
    case "TICKETING":
      requireExactActiveWork(order, false, "paid verification active order");
      return { kind: "ACTIVE", order };
    case "ISSUED_WAIT_DELIVER":
      requireExactActiveWork(order, true, "paid verification active order");
      return { kind: "ACTIVE", order };
    case "DELIVERY_OUTCOME_PENDING":
      requirePendingNoReplayPayload(value, order, "paid verification pending delivery attempt");
      return { kind: "TERMINAL", order };
    case "NEED_MANUAL":
      requireNoAutomaticWork(order, "paid verification NEED_MANUAL order");
      return { kind: "NEED_MANUAL", order };
    case "DELIVERED":
    case "REFUNDED":
    case "CLOSED":
      requireNoAutomaticWork(order, "paid verification terminal order");
      return { kind: "TERMINAL", order };
    case "WAIT_IMAGE":
    case "QUOTED":
    case "WAIT_BUYER_PAY":
      throw new Error(`paid verification status is invalid: ${order.status}`);
    default:
      return assertNever(order.status);
  }
}

export function decodePendingRecoveryOrders(value: unknown): XianyuOrderPayload[] {
  const orders = requireArray(value, "pending deliveries");
  const seenOrderIds = new Set<string>();
  const activeOrders: XianyuOrderPayload[] = [];
  for (const [index, item] of orders.entries()) {
    const order = decodeXianyuOrderPayload(item, `pending deliveries[${index}]`);
    if (seenOrderIds.has(order.platformOrderId)) {
      throw new Error(`pending deliveries duplicate platformOrderId: ${order.platformOrderId}`);
    }
    seenOrderIds.add(order.platformOrderId);
    switch (order.status) {
      case "PAID_WAIT_SUBMIT":
      case "TICKETING":
        requireExactActiveWork(order, false, `pending deliveries[${index}]`);
        activeOrders.push(order);
        break;
      case "ISSUED_WAIT_DELIVER":
        requireExactActiveWork(order, true, `pending deliveries[${index}]`);
        activeOrders.push(order);
        break;
      case "DELIVERY_OUTCOME_PENDING":
        requirePendingNoReplayPayload(item, order, `pending deliveries[${index}]`);
        break;
      case "NEED_MANUAL":
      case "DELIVERED":
      case "REFUNDED":
      case "CLOSED":
        requireNoAutomaticWork(order, `pending deliveries[${index}]`);
        break;
      case "WAIT_IMAGE":
      case "QUOTED":
      case "WAIT_BUYER_PAY":
        throw new Error(`pending recovery status is invalid: ${order.status}`);
      default:
        assertNever(order.status);
    }
  }
  return activeOrders;
}

export interface ClaimedDeliveryAttemptPorts {
  sendTemplate(): Promise<void>;
  sendTicketCodes(): Promise<void>;
  consignDummy(): Promise<void>;
  recordDeliveryResult(attemptId: string, success: boolean, errorMessage: string): Promise<unknown>;
  removeActive(): void;
}

type DeliveryFailureSummary =
  | "DELIVERY_TEMPLATE_FAILED"
  | "TICKET_CODE_SEND_FAILED"
  | "DUMMY_CONSIGN_FAILED";

export async function completeClaimedDeliveryAttempt(
  orderId: string,
  attemptId: string,
  ports: ClaimedDeliveryAttemptPorts
): Promise<void> {
  requireNonEmptyString(attemptId, "delivery attempt id");
  ports.removeActive();
  let failureSummary: DeliveryFailureSummary = "DELIVERY_TEMPLATE_FAILED";
  try {
    await ports.sendTemplate();
    failureSummary = "TICKET_CODE_SEND_FAILED";
    await ports.sendTicketCodes();
    failureSummary = "DUMMY_CONSIGN_FAILED";
    await ports.consignDummy();
  } catch (businessError) {
    try {
      const response = await ports.recordDeliveryResult(attemptId, false, failureSummary);
      decodeDeliveryFailureResult(response, orderId, attemptId);
    } catch (recordError) {
      throw new AggregateError(
        [businessError, recordError],
        "delivery attempt failure recording failed"
      );
    }
    throw businessError;
  }
  const response = await ports.recordDeliveryResult(attemptId, true, "");
  decodeDeliverySuccessResult(response, orderId, attemptId);
}

export function decodeDeliveryPollResult(value: unknown, expectedOrderId: string): DeliveryPollResult {
  const order = decodeXianyuOrderPayload(value, "delivery poll");
  requireExpectedOrderId(order, expectedOrderId, "delivery poll");
  switch (order.status) {
    case "PAID_WAIT_SUBMIT":
    case "TICKETING":
      if (!order.shouldPoll || order.shouldDeliver) {
        throw new Error(`delivery poll ${order.status} order must poll without delivery permission`);
      }
      return { kind: "WAIT", order };
    case "ISSUED_WAIT_DELIVER":
      if (!order.shouldPoll || !order.shouldDeliver) {
        throw new Error("delivery poll issued order must poll with delivery permission");
      }
      return { kind: "READY", order };
    case "DELIVERY_OUTCOME_PENDING":
      requirePendingNoReplayPayload(value, order, "delivery poll pending attempt");
      return { kind: "NO_REPLAY", order };
    case "NEED_MANUAL":
      requireNoAutomaticWork(order, "delivery poll NEED_MANUAL order");
      return { kind: "NEED_MANUAL", order };
    case "DELIVERED":
    case "REFUNDED":
    case "CLOSED":
      requireNoAutomaticWork(order, "delivery poll terminal order");
      return { kind: "TERMINAL", order };
    case "WAIT_IMAGE":
    case "QUOTED":
    case "WAIT_BUYER_PAY":
      throw new Error(`delivery poll status is invalid: ${order.status}`);
    default:
      return assertNever(order.status);
  }
}

export function decodeClaimDeliveryResult(value: unknown, expectedOrderId: string): ClaimDeliveryResult {
  const order = decodeXianyuOrderPayload(value, "delivery claim");
  requireExpectedOrderId(order, expectedOrderId, "delivery claim");
  if (order.status !== "DELIVERY_OUTCOME_PENDING") {
    throw new Error(`delivery claim status is invalid: ${order.status}`);
  }
  if (order.shouldPoll || !order.deliveryAttemptId || order.deliveryAttemptOutcome !== undefined) {
    throw new Error("delivery claim must contain one persisted pending attempt without polling");
  }
  if (order.shouldDeliver) {
    if (!order.deliveryMessage || !order.ticketCodeInfo) {
      throw new Error("delivery claim permission requires delivery data");
    }
    return {
      kind: "CLAIMED",
      order: {
        ...order,
        deliveryAttemptId: order.deliveryAttemptId,
        deliveryMessage: order.deliveryMessage,
        ticketCodeInfo: order.ticketCodeInfo
      }
    };
  }
  requirePendingNoReplayPayload(value, order, "repeated delivery claim");
  return { kind: "NOT_CLAIMED", order };
}

function requireWaitingPaymentResult(value: WaitingPaymentResult, expectedOrderId: string): WaitingPaymentResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("waiting-payment response must be an object");
  }
  if (value.platformOrderId !== expectedOrderId) {
    throw new Error("registered waiting-payment order id mismatch");
  }
  if (typeof value.quoteNo !== "string" || value.quoteNo.length === 0) {
    throw new Error("waiting-payment response quoteNo must be a non-empty string");
  }
  if (!Number.isSafeInteger(value.totalPriceCents) || value.totalPriceCents <= 0) {
    throw new Error("waiting-payment response totalPriceCents must be a positive safe integer");
  }
  if (value.status !== "WAIT_BUYER_PAY") {
    throw new Error("waiting-payment response status must equal WAIT_BUYER_PAY");
  }
  return value;
}

function requireResolvedOrder(value: { platformOrderId: string }): { platformOrderId: string } {
  if (typeof value !== "object" || value === null || typeof value.platformOrderId !== "string" || value.platformOrderId.length === 0) {
    throw new Error("resolved active order platformOrderId must be a non-empty string");
  }
  return value;
}

function requireExpectedOrderId(order: XianyuOrderPayload, expectedOrderId: string, context: string): void {
  if (order.platformOrderId !== expectedOrderId) {
    throw new Error(`${context} response platformOrderId mismatch`);
  }
}

interface OrderStateResult {
  platformOrderId: string;
  status: string;
  shouldPoll: boolean;
  shouldDeliver: boolean;
  deliveryAttemptId?: string;
  deliveryAttemptOutcome?: "SUCCESS" | "FAILURE";
}

function decodeOrderStateResult(value: unknown, context: string): OrderStateResult {
  const payload = requireRecord(value, context);
  return {
    platformOrderId: requireNonEmptyString(payload.platformOrderId, `${context}.platformOrderId`),
    status: requireNonEmptyString(payload.status, `${context}.status`),
    shouldPoll: requireBoolean(payload.shouldPoll, `${context}.shouldPoll`),
    shouldDeliver: requireBoolean(payload.shouldDeliver, `${context}.shouldDeliver`),
    deliveryAttemptId: optionalString(payload.deliveryAttemptId, `${context}.deliveryAttemptId`),
    deliveryAttemptOutcome: optionalDeliveryAttemptOutcome(
      payload.deliveryAttemptOutcome,
      `${context}.deliveryAttemptOutcome`
    )
  };
}

function requireStateResultOrderId(result: OrderStateResult, expectedOrderId: string, context: string): void {
  if (result.platformOrderId !== expectedOrderId) {
    throw new Error(`${context} platformOrderId mismatch`);
  }
}

function decodeNeedManualResult(value: unknown, expectedOrderId: string, context: string): OrderStateResult {
  const result = decodeOrderStateResult(value, context);
  requireStateResultOrderId(result, expectedOrderId, context);
  if (result.status !== "NEED_MANUAL") {
    throw new Error(`${context} status must equal NEED_MANUAL`);
  }
  requireNoAutomaticWork(result, context);
  return result;
}

function requireDeliveryResultAttempt(
  result: OrderStateResult,
  expectedAttemptId: string,
  expectedOutcome: "SUCCESS" | "FAILURE",
  context: string
): void {
  if (result.deliveryAttemptId !== expectedAttemptId) {
    throw new Error(`${context} deliveryAttemptId mismatch`);
  }
  if (result.deliveryAttemptOutcome !== expectedOutcome) {
    throw new Error(`${context} deliveryAttemptOutcome must equal ${expectedOutcome}`);
  }
}

function requirePendingNoReplayPayload(
  value: unknown,
  order: XianyuOrderPayload,
  context: string
): void {
  requireNoAutomaticWork(order, context);
  if (!order.deliveryAttemptId || order.deliveryAttemptOutcome !== undefined) {
    throw new Error(`${context} must contain one unresolved delivery attempt`);
  }
  if (order.deliveryMessage !== undefined || order.ticketCodeInfo !== undefined) {
    throw new Error(`${context} must not expose delivery data`);
  }
  const payload = requireRecord(value, context);
  if (payload.order !== undefined && payload.order !== null) {
    throw new Error(`${context} must not expose nested order data`);
  }
}

function requireNoAutomaticWork(
  order: Pick<XianyuOrderPayload, "shouldPoll" | "shouldDeliver">,
  context: string
): void {
  if (order.shouldPoll || order.shouldDeliver) {
    throw new Error(`${context} must not request polling or delivery`);
  }
}

function requireExactActiveWork(order: XianyuOrderPayload, shouldDeliver: boolean, context: string): void {
  if (!order.shouldPoll || order.shouldDeliver !== shouldDeliver) {
    throw new Error(
      `${context} must use exact work flags shouldPoll=true and shouldDeliver=${shouldDeliver}`
    );
  }
}

async function recordAndRethrow(
  original: unknown,
  record: () => Promise<void>,
  context: string
): Promise<never> {
  try {
    await record();
  } catch (recordError) {
    throw new AggregateError([original, recordError], context);
  }
  throw original;
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, context: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireNonEmptyString(value, context);
}

function optionalDeliveryAttemptOutcome(
  value: unknown,
  context: string
): "SUCCESS" | "FAILURE" | undefined {
  if (value === undefined || value === null) return undefined;
  if (value !== "SUCCESS" && value !== "FAILURE") {
    throw new Error(`${context} is invalid`);
  }
  return value;
}

function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${context} must be boolean`);
  }
  return value;
}

function assertNever(value: never): never {
  throw new Error(`unhandled xianyu trade event: ${JSON.stringify(value)}`);
}
