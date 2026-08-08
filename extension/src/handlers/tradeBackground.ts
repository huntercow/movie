import type {
  BackendApiClient,
  UpdateOrderStatusRequest
} from "./backendApi.ts";
import type {
  ActiveActionCompletion,
  ActiveActionPermit
} from "./automationLifecycle.ts";
import type { StoredPluginState } from "./pluginState.ts";
import type {
  CompletePaidMismatchCancellationRequest,
  PaidMismatchCancellationCompletion,
  PaidOrderLookupResult
} from "./paidVerificationAutomation.ts";
import type {
  AdjustmentSettlement,
  AdjustmentSettlementJournal,
  PaidAmountMismatchSettlement,
  PaidSettlementJournal
} from "./settlementJournal.ts";
import type { WaitingPaymentLookupResult } from "./waitingPaymentAutomation.ts";

/** 分 → 元:用于 status 30 回写的实付金额(与 paidVerificationAutomation 同口径)。 */
function centsToRmbAmount(cents: number): number {
  return Number(
    `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`,
  );
}

interface TradeLifecycle {
  getState(): Promise<StoredPluginState>;
  authorizeAction(effect: "READ" | "WRITE"): Promise<ActiveActionPermit | null>;
  classifyActionCompletion(permit: ActiveActionPermit): Promise<ActiveActionCompletion>;
  handleBackendFailure(error: unknown): Promise<StoredPluginState>;
}

interface TradeBackgroundControllerOptions {
  lifecycle: TradeLifecycle;
  apiFactory(token: string): Pick<
    BackendApiClient,
    "getWaitingPaymentOrder" | "getOrderByStatus" | "updateOrderStatus"
  >;
  adjustmentSettlementJournal?: AdjustmentSettlementJournal;
  paidSettlementJournal?: PaidSettlementJournal;
}

interface AdjustmentClaim {
  xianyuOrderId: string;
  automationRevision: number;
}

function activeToken(state: StoredPluginState, permit: ActiveActionPermit): string | null {
  return (
    state.authStatus === "AUTHENTICATED" &&
    state.token !== null &&
    state.automationEnabled &&
    !state.safetyDisabled &&
    !state.remoteDisablePending &&
    state.automationRevision === permit.automationRevision
  ) ? state.token : null;
}

function authenticatedToken(state: StoredPluginState): string | null {
  return state.authStatus === "AUTHENTICATED" && state.token !== null
    ? state.token
    : null;
}

function requirePermit(
  value: ActiveActionPermit | null,
  effect: "READ" | "WRITE",
  context: string
): ActiveActionPermit {
  if (
    value === null ||
    value.effect !== effect ||
    !Number.isSafeInteger(value.automationRevision) ||
    value.automationRevision < 0
  ) {
    throw new Error(`${context} requires a valid ${effect} permit`);
  }
  return value;
}

function nonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function sameSettlement(
  left: PaidAmountMismatchSettlement,
  right: PaidAmountMismatchSettlement
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameAdjustmentSettlement(
  left: AdjustmentSettlement,
  right: AdjustmentSettlement
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class TradeBackgroundController {
  private readonly lifecycle: TradeLifecycle;
  private readonly apiFactory: TradeBackgroundControllerOptions["apiFactory"];
  private readonly adjustmentSettlementJournal: AdjustmentSettlementJournal | null;
  private readonly paidSettlementJournal: PaidSettlementJournal | null;
  private readonly adjustmentClaims = new Map<string, AdjustmentClaim>();
  private readonly claimedAdjustmentBusinessOrderIdsByXianyuOrderId =
    new Map<string, string>();
  private readonly settledAdjustmentBusinessOrderIds = new Set<string>();
  private readonly settledAdjustmentXianyuOrderIds = new Set<string>();
  private readonly notifiedNoQuoteXianyuOrderIds = new Set<string>();
  private readonly advancedPaidBusinessOrderIds = new Set<string>();
  private readonly mismatchCancellationClaims = new Set<string>();
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(options: TradeBackgroundControllerOptions) {
    this.lifecycle = options.lifecycle;
    this.apiFactory = options.apiFactory;
    this.adjustmentSettlementJournal =
      options.adjustmentSettlementJournal ?? null;
    this.paidSettlementJournal = options.paidSettlementJournal ?? null;
  }

  lookupWaitingPayment(chatId: string): Promise<WaitingPaymentLookupResult> {
    return this.exclusive(async () => {
      const permit = await this.lifecycle.authorizeAction("READ");
      if (permit === null) return { kind: "DISCARDED" };
      const state = await this.lifecycle.getState();
      const token = activeToken(state, permit);
      if (token === null) return { kind: "DISCARDED" };
      const settledIds = await this.retryPendingAdjustmentSettlements(token);
      if (
        settledIds.size > 0 &&
        await this.lifecycle.classifyActionCompletion(permit) !== "CONTINUE"
      ) {
        return { kind: "DISCARDED" };
      }
      let order;
      try {
        order = await this.apiFactory(token).getWaitingPaymentOrder(chatId);
      } catch (error) {
        await this.lifecycle.handleBackendFailure(error);
        throw error;
      }
      if (await this.lifecycle.classifyActionCompletion(permit) !== "CONTINUE") {
        return { kind: "DISCARDED" };
      }
      if (order === null) {
        return settledIds.size > 0
          ? { kind: "DUPLICATE" }
          : { kind: "NOT_FOUND" };
      }
      return (
        settledIds.has(order.id) ||
        this.settledAdjustmentBusinessOrderIds.has(order.id) ||
        this.adjustmentClaims.has(order.id)
      )
        ? { kind: "DUPLICATE" }
        : { kind: "FOUND", order };
    });
  }

  beginAdjustment(
    businessOrderIdValue?: string,
    xianyuOrderIdValue?: string
  ): Promise<ActiveActionPermit | null> {
    return this.exclusive(async () => {
      const businessOrderId = nonEmptyString(
        businessOrderIdValue,
        "adjustment business order id"
      );
      const xianyuOrderId = nonEmptyString(
        xianyuOrderIdValue,
        "adjustment xianyu order id"
      );
      const pending = await this.requireAdjustmentSettlementJournal().load();
      if (
        this.adjustmentClaims.has(businessOrderId) ||
        this.claimedAdjustmentBusinessOrderIdsByXianyuOrderId.has(xianyuOrderId) ||
        this.settledAdjustmentBusinessOrderIds.has(businessOrderId) ||
        this.settledAdjustmentXianyuOrderIds.has(xianyuOrderId) ||
        pending.some((request) =>
          request.id === businessOrderId ||
          request.xianyuOrderId === xianyuOrderId
        )
      ) {
        return null;
      }
      const permit = await this.lifecycle.authorizeAction("WRITE");
      if (permit === null) return null;
      this.adjustmentClaims.set(businessOrderId, {
        xianyuOrderId,
        automationRevision: permit.automationRevision
      });
      this.claimedAdjustmentBusinessOrderIdsByXianyuOrderId.set(
        xianyuOrderId,
        businessOrderId
      );
      return permit;
    });
  }

  abortAdjustment(
    businessOrderIdValue: string,
    xianyuOrderIdValue: string,
    permitValue: ActiveActionPermit | null
  ): Promise<void> {
    return this.exclusive(async () => {
      const businessOrderId = nonEmptyString(
        businessOrderIdValue,
        "adjustment abort business order id"
      );
      const xianyuOrderId = nonEmptyString(
        xianyuOrderIdValue,
        "adjustment abort xianyu order id"
      );
      const permit = requirePermit(permitValue, "WRITE", "adjustment abort");
      this.requireAdjustmentClaim(businessOrderId, xianyuOrderId, permit);
      const pending = await this.requireAdjustmentSettlementJournal().load();
      if (pending.some((request) => request.id === businessOrderId)) {
        throw new Error("a successful price adjustment cannot be aborted");
      }
      this.releaseAdjustmentClaim(businessOrderId, xianyuOrderId);
    });
  }

  claimNoQuoteNotification(xianyuOrderIdValue: string): Promise<boolean> {
    return this.exclusive(async () => {
      const xianyuOrderId = nonEmptyString(
        xianyuOrderIdValue,
        "no-quote xianyu order id"
      );
      if (this.notifiedNoQuoteXianyuOrderIds.has(xianyuOrderId)) {
        return false;
      }
      this.notifiedNoQuoteXianyuOrderIds.add(xianyuOrderId);
      return true;
    });
  }

  settleAdjusted(
    requestValue: Extract<UpdateOrderStatusRequest, { status: 25 }>,
    permitValue: ActiveActionPermit | null
  ): Promise<Extract<ActiveActionCompletion, "CONTINUE" | "SETTLE_ONLY">> {
    return this.exclusive(async () => {
      const permit = requirePermit(
        permitValue,
        "WRITE",
        "adjustment settlement"
      );
      const request: AdjustmentSettlement = {
        id: nonEmptyString(requestValue.id, "adjustment settlement business order id"),
        status: 25,
        xianyuOrderId: nonEmptyString(
          requestValue.xianyuOrderId,
          "adjustment settlement xianyu order id"
        )
      };
      this.requireAdjustmentClaim(request.id, request.xianyuOrderId, permit);
      const journal = this.requireAdjustmentSettlementJournal();
      const pending = await journal.load();
      const existing = pending.find((entry) => entry.id === request.id);
      if (existing !== undefined && !sameAdjustmentSettlement(existing, request)) {
        throw new Error("adjustment settlement journal contains a conflicting result");
      }
      if (existing === undefined) {
        if (pending.some((entry) => entry.xianyuOrderId === request.xianyuOrderId)) {
          throw new Error(
            "adjustment settlement journal contains a conflicting xianyuOrderId"
          );
        }
        await journal.save([...pending, request]);
      }

      const state = await this.lifecycle.getState();
      const token = authenticatedToken(state);
      if (token === null) {
        throw new Error("authenticated token is unavailable for adjustment settlement");
      }
      try {
        await this.apiFactory(token).updateOrderStatus(request);
      } catch (error) {
        await this.lifecycle.handleBackendFailure(error);
        throw error;
      }
      await this.removeAdjustmentSettlement(request);
      this.rememberSettledAdjustment(request);
      this.releaseAdjustmentClaim(request.id, request.xianyuOrderId);
      const completion = await this.lifecycle.classifyActionCompletion(permit);
      return completion === "CONTINUE" ? "CONTINUE" : "SETTLE_ONLY";
    });
  }

  lookupPaidOrder(chatId: string): Promise<PaidOrderLookupResult> {
    return this.exclusive(async () => {
      const permit = await this.lifecycle.authorizeAction("READ");
      if (permit === null) return { kind: "DISCARDED" };
      const state = await this.lifecycle.getState();
      const token = activeToken(state, permit);
      if (token === null) return { kind: "DISCARDED" };
      const settledIds = await this.retryPendingPaidSettlements(token);
      let order;
      try {
        order = await this.apiFactory(token).getOrderByStatus(chatId);
      } catch (error) {
        await this.lifecycle.handleBackendFailure(error);
        throw error;
      }
      if (await this.lifecycle.classifyActionCompletion(permit) !== "CONTINUE") {
        return { kind: "DISCARDED" };
      }
      return order === null || settledIds.has(order.id)
        ? { kind: "NOT_FOUND" }
        : { kind: "FOUND", order };
    });
  }

  beginOrderDetailRead(): Promise<ActiveActionPermit | null> {
    return this.exclusive(() => this.lifecycle.authorizeAction("READ"));
  }

  completeOrderDetailRead(
    permitValue: ActiveActionPermit | null
  ): Promise<Extract<ActiveActionCompletion, "CONTINUE" | "DISCARD">> {
    return this.exclusive(async () => {
      const permit = requirePermit(
        permitValue,
        "READ",
        "order detail completion"
      );
      return await this.lifecycle.classifyActionCompletion(permit) === "CONTINUE"
        ? "CONTINUE"
        : "DISCARD";
    });
  }

  advancePaid(
    businessOrderId: string,
    actualPaidAmountCents: number
  ): Promise<
    Extract<ActiveActionCompletion, "CONTINUE" | "SETTLE_ONLY" | "DISCARD"> |
    "DUPLICATE"
  > {
    return this.exclusive(async () => {
      const id = nonEmptyString(businessOrderId, "paid business order id");
      if (this.advancedPaidBusinessOrderIds.has(id)) {
        return "DUPLICATE";
      }
      const permit = await this.lifecycle.authorizeAction("WRITE");
      if (permit === null) return "DISCARD";
      const state = await this.lifecycle.getState();
      const token = activeToken(state, permit);
      if (token === null) return "DISCARD";
      try {
        await this.apiFactory(token).updateOrderStatus({
          id,
          status: 30,
          actualAmount: centsToRmbAmount(actualPaidAmountCents)
        });
      } catch (error) {
        await this.lifecycle.handleBackendFailure(error);
        throw error;
      }
      this.advancedPaidBusinessOrderIds.add(id);
      return await this.lifecycle.classifyActionCompletion(permit) === "CONTINUE"
        ? "CONTINUE"
        : "SETTLE_ONLY";
    });
  }

  beginMismatchCancellation(
    businessOrderId: string
  ): Promise<ActiveActionPermit | null> {
    return this.exclusive(async () => {
      const id = nonEmptyString(
        businessOrderId,
        "mismatch cancellation business order id"
      );
      const journal = this.requirePaidSettlementJournal();
      const pending = await journal.load();
      if (
        pending.some((request) => request.id === id) ||
        this.mismatchCancellationClaims.has(id)
      ) {
        return null;
      }
      const permit = await this.lifecycle.authorizeAction("WRITE");
      if (permit === null) return null;
      this.mismatchCancellationClaims.add(id);
      return permit;
    });
  }

  completeMismatchCancellation(
    requestValue: CompletePaidMismatchCancellationRequest,
    permitValue: ActiveActionPermit | null
  ): Promise<PaidMismatchCancellationCompletion> {
    return this.exclusive(async () => {
      const businessOrderId = nonEmptyString(
        requestValue.businessOrderId,
        "mismatch cancellation business order id"
      );
      const permit = requirePermit(
        permitValue,
        "WRITE",
        "amount mismatch completion"
      );
      if (!this.mismatchCancellationClaims.has(businessOrderId)) {
        throw new Error("amount mismatch completion does not own the business order claim");
      }

      try {
        if (!requestValue.cancellation.issued) {
          return "NOT_ISSUED";
        }
        const request: PaidAmountMismatchSettlement = {
          id: businessOrderId,
          status: 90,
          failureReason: requestValue.failureReason,
          actualAmount: requestValue.actualAmount,
          cancelSucceeded: requestValue.cancellation.succeeded
        };
        const journal = this.requirePaidSettlementJournal();
        const pending = await journal.load();
        const existing = pending.find((entry) => entry.id === businessOrderId);
        if (existing !== undefined && !sameSettlement(existing, request)) {
          throw new Error("paid settlement journal contains a conflicting result");
        }
        if (existing === undefined) {
          await journal.save([...pending, request]);
        }

        const state = await this.lifecycle.getState();
        const token = authenticatedToken(state);
        if (token === null) {
          throw new Error("authenticated token is unavailable for amount mismatch settlement");
        }
        try {
          await this.apiFactory(token).updateOrderStatus(request);
        } catch (error) {
          await this.lifecycle.handleBackendFailure(error);
          throw error;
        }
        await this.removePaidSettlement(request);
        return await this.lifecycle.classifyActionCompletion(permit) === "CONTINUE"
          ? "CONTINUE"
          : "SETTLE_ONLY";
      } finally {
        this.mismatchCancellationClaims.delete(businessOrderId);
      }
    });
  }

  clearAdjustmentSettlements(): Promise<void> {
    return this.exclusive(async () => {
      this.adjustmentClaims.clear();
      this.claimedAdjustmentBusinessOrderIdsByXianyuOrderId.clear();
      this.settledAdjustmentBusinessOrderIds.clear();
      this.settledAdjustmentXianyuOrderIds.clear();
      this.notifiedNoQuoteXianyuOrderIds.clear();
      if (this.adjustmentSettlementJournal !== null) {
        await this.adjustmentSettlementJournal.save([]);
      }
    });
  }

  clearAdjustmentSettlementsIfUnauthenticated(): Promise<void> {
    return this.exclusive(async () => {
      if (authenticatedToken(await this.lifecycle.getState()) === null) {
        this.adjustmentClaims.clear();
        this.claimedAdjustmentBusinessOrderIdsByXianyuOrderId.clear();
        this.settledAdjustmentBusinessOrderIds.clear();
        this.settledAdjustmentXianyuOrderIds.clear();
        this.notifiedNoQuoteXianyuOrderIds.clear();
        if (this.adjustmentSettlementJournal !== null) {
          await this.adjustmentSettlementJournal.save([]);
        }
      }
    });
  }

  clearPaidSettlements(): Promise<void> {
    return this.exclusive(async () => {
      this.advancedPaidBusinessOrderIds.clear();
      this.mismatchCancellationClaims.clear();
      if (this.paidSettlementJournal !== null) {
        await this.paidSettlementJournal.save([]);
      }
    });
  }

  clearPaidSettlementsIfUnauthenticated(): Promise<void> {
    return this.exclusive(async () => {
      if (authenticatedToken(await this.lifecycle.getState()) === null) {
        this.advancedPaidBusinessOrderIds.clear();
        this.mismatchCancellationClaims.clear();
        if (this.paidSettlementJournal !== null) {
          await this.paidSettlementJournal.save([]);
        }
      }
    });
  }

  private requirePaidSettlementJournal(): PaidSettlementJournal {
    if (this.paidSettlementJournal === null) {
      throw new Error("paid settlement journal is not configured");
    }
    return this.paidSettlementJournal;
  }

  private requireAdjustmentSettlementJournal(): AdjustmentSettlementJournal {
    if (this.adjustmentSettlementJournal === null) {
      throw new Error("adjustment settlement journal is not configured");
    }
    return this.adjustmentSettlementJournal;
  }

  private requireAdjustmentClaim(
    businessOrderId: string,
    xianyuOrderId: string,
    permit: ActiveActionPermit
  ): void {
    const claim = this.adjustmentClaims.get(businessOrderId);
    if (
      claim === undefined ||
      claim.xianyuOrderId !== xianyuOrderId ||
      claim.automationRevision !== permit.automationRevision ||
      this.claimedAdjustmentBusinessOrderIdsByXianyuOrderId.get(xianyuOrderId) !==
        businessOrderId
    ) {
      throw new Error("price adjustment does not own the requested order claim");
    }
  }

  private releaseAdjustmentClaim(
    businessOrderId: string,
    xianyuOrderId: string
  ): void {
    this.adjustmentClaims.delete(businessOrderId);
    if (
      this.claimedAdjustmentBusinessOrderIdsByXianyuOrderId.get(xianyuOrderId) ===
      businessOrderId
    ) {
      this.claimedAdjustmentBusinessOrderIdsByXianyuOrderId.delete(xianyuOrderId);
    }
  }

  private rememberSettledAdjustment(request: AdjustmentSettlement): void {
    this.settledAdjustmentBusinessOrderIds.add(request.id);
    this.settledAdjustmentXianyuOrderIds.add(request.xianyuOrderId);
  }

  private async retryPendingAdjustmentSettlements(
    token: string
  ): Promise<Set<string>> {
    if (this.adjustmentSettlementJournal === null) {
      return new Set();
    }
    const pending = await this.adjustmentSettlementJournal.load();
    const settledIds = new Set<string>();
    for (const request of pending) {
      try {
        await this.apiFactory(token).updateOrderStatus(request);
      } catch (error) {
        await this.lifecycle.handleBackendFailure(error);
        throw error;
      }
      await this.removeAdjustmentSettlement(request);
      this.rememberSettledAdjustment(request);
      this.releaseAdjustmentClaim(request.id, request.xianyuOrderId);
      settledIds.add(request.id);
    }
    return settledIds;
  }

  private async removeAdjustmentSettlement(
    request: AdjustmentSettlement
  ): Promise<void> {
    const journal = this.requireAdjustmentSettlementJournal();
    const pending = await journal.load();
    await journal.save(
      pending.filter((entry) => !sameAdjustmentSettlement(entry, request))
    );
  }

  private async retryPendingPaidSettlements(token: string): Promise<Set<string>> {
    if (this.paidSettlementJournal === null) {
      return new Set();
    }
    const pending = await this.paidSettlementJournal.load();
    const settledIds = new Set<string>();
    for (const request of pending) {
      try {
        await this.apiFactory(token).updateOrderStatus(request);
      } catch (error) {
        await this.lifecycle.handleBackendFailure(error);
        throw error;
      }
      await this.removePaidSettlement(request);
      this.mismatchCancellationClaims.delete(request.id);
      settledIds.add(request.id);
    }
    return settledIds;
  }

  private async removePaidSettlement(
    request: PaidAmountMismatchSettlement
  ): Promise<void> {
    const journal = this.requirePaidSettlementJournal();
    const pending = await journal.load();
    await journal.save(
      pending.filter((entry) => !sameSettlement(entry, request))
    );
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
