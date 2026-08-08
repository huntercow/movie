import {
  validateUpdateOrderResultRequest,
  type BackendApiClient,
  type TicketResult,
  type UpdateOrderResultRequest
} from "./backendApi.ts";
import type {
  ActiveActionCompletion,
  ActiveActionPermit
} from "./automationLifecycle.ts";
import type { StoredPluginState } from "./pluginState.ts";
import type { TicketSettlementJournal } from "./settlementJournal.ts";

interface TicketLifecycle {
  getState(): Promise<StoredPluginState>;
  authorizeAction(effect: "READ" | "WRITE"): Promise<ActiveActionPermit | null>;
  classifyActionCompletion(permit: ActiveActionPermit): Promise<ActiveActionCompletion>;
  handleBackendFailure(error: unknown): Promise<StoredPluginState>;
}

interface TicketBackgroundControllerOptions {
  lifecycle: TicketLifecycle;
  apiFactory(token: string): Pick<
    BackendApiClient,
    "getTicketResults" | "updateOrderResult"
  >;
  journal: TicketSettlementJournal;
}

function authenticatedToken(state: StoredPluginState): string | null {
  return state.authStatus === "AUTHENTICATED" && state.token !== null
    ? state.token
    : null;
}

function activeToken(
  state: StoredPluginState,
  permit: ActiveActionPermit
): string | null {
  return (
    authenticatedToken(state) !== null &&
    state.automationEnabled &&
    !state.safetyDisabled &&
    !state.remoteDisablePending &&
    state.automationRevision === permit.automationRevision
  ) ? state.token : null;
}

function requireWritePermit(value: ActiveActionPermit): ActiveActionPermit {
  if (
    value.effect !== "WRITE" ||
    !Number.isSafeInteger(value.automationRevision) ||
    value.automationRevision < 0
  ) {
    throw new Error("ticket result settlement requires a valid WRITE permit");
  }
  return value;
}

function nonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function sameRequest(
  left: UpdateOrderResultRequest,
  right: UpdateOrderResultRequest
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class TicketBackgroundController {
  private readonly lifecycle: TicketLifecycle;
  private readonly apiFactory: TicketBackgroundControllerOptions["apiFactory"];
  private readonly journal: TicketSettlementJournal;
  private readonly activeDeliveries = new Map<string, number>();
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(options: TicketBackgroundControllerOptions) {
    this.lifecycle = options.lifecycle;
    this.apiFactory = options.apiFactory;
    this.journal = options.journal;
  }

  getTicketResults(): Promise<TicketResult[]> {
    return this.exclusive(async () => {
      const permit = await this.lifecycle.authorizeAction("READ");
      if (permit === null) {
        return [];
      }
      const state = await this.lifecycle.getState();
      const token = activeToken(state, permit);
      if (token === null) {
        if (authenticatedToken(state) === null) {
          await this.journal.save([]);
        }
        return [];
      }

      const settledIds = await this.retryPendingSettlements(token);
      if (await this.lifecycle.classifyActionCompletion(permit) !== "CONTINUE") {
        return [];
      }
      let results: TicketResult[];
      try {
        results = await this.apiFactory(token).getTicketResults();
      } catch (error) {
        await this.handleBackendFailure(error);
        throw error;
      }
      if (await this.lifecycle.classifyActionCompletion(permit) !== "CONTINUE") {
        return [];
      }
      return results.filter((result) =>
        !settledIds.has(result.id) && !this.activeDeliveries.has(result.id)
      );
    });
  }

  beginDelivery(businessOrderIdValue: string): Promise<ActiveActionPermit | null> {
    return this.exclusive(async () => {
      const businessOrderId = nonEmptyString(
        businessOrderIdValue,
        "ticket delivery businessOrderId"
      );
      if (this.activeDeliveries.has(businessOrderId)) {
        return null;
      }
      const permit = await this.lifecycle.authorizeAction("WRITE");
      if (permit === null) {
        return null;
      }
      this.activeDeliveries.set(businessOrderId, permit.automationRevision);
      return permit;
    });
  }

  abortDelivery(
    businessOrderIdValue: string,
    permitValue: ActiveActionPermit
  ): Promise<void> {
    return this.exclusive(async () => {
      const businessOrderId = nonEmptyString(
        businessOrderIdValue,
        "ticket delivery businessOrderId"
      );
      const permit = requireWritePermit(permitValue);
      if (this.activeDeliveries.get(businessOrderId) !== permit.automationRevision) {
        throw new Error("ticket delivery lock does not match its WRITE permit");
      }
      this.activeDeliveries.delete(businessOrderId);
    });
  }

  settleTicketResult(
    requestValue: UpdateOrderResultRequest,
    permitValue: ActiveActionPermit
  ): Promise<void> {
    return this.exclusive(async () => {
      const request = validateUpdateOrderResultRequest(requestValue);
      const permit = requireWritePermit(permitValue);
      if (this.activeDeliveries.get(request.id) !== permit.automationRevision) {
        throw new Error("ticket result settlement requires its active delivery lock");
      }
      const state = await this.lifecycle.getState();
      const token = authenticatedToken(state);
      if (token === null) {
        await this.journal.save([]);
        throw new Error("authenticated token is unavailable for ticket settlement");
      }

      const pending = await this.journal.load();
      const existing = pending.find((entry) => entry.id === request.id);
      if (existing !== undefined && !sameRequest(existing, request)) {
        throw new Error("ticket settlement journal contains a conflicting result");
      }
      if (existing === undefined) {
        await this.journal.save([...pending, request]);
      }

      try {
        await this.apiFactory(token).updateOrderResult(request);
      } catch (error) {
        await this.handleBackendFailure(error);
        throw error;
      }
      await this.removeSettlement(request);
      this.activeDeliveries.delete(request.id);
      await this.lifecycle.classifyActionCompletion(permit);
    });
  }

  clearSettlements(): Promise<void> {
    return this.exclusive(async () => {
      await this.journal.save([]);
      this.activeDeliveries.clear();
    });
  }

  clearSettlementsIfUnauthenticated(): Promise<void> {
    return this.exclusive(async () => {
      if (authenticatedToken(await this.lifecycle.getState()) === null) {
        await this.journal.save([]);
        this.activeDeliveries.clear();
      }
    });
  }

  private async retryPendingSettlements(token: string): Promise<Set<string>> {
    const pending = await this.journal.load();
    const settledIds = new Set<string>();
    for (const request of pending) {
      try {
        await this.apiFactory(token).updateOrderResult(request);
      } catch (error) {
        await this.handleBackendFailure(error);
        throw error;
      }
      await this.removeSettlement(request);
      this.activeDeliveries.delete(request.id);
      settledIds.add(request.id);
    }
    return settledIds;
  }

  private async removeSettlement(request: UpdateOrderResultRequest): Promise<void> {
    const pending = await this.journal.load();
    await this.journal.save(pending.filter((entry) => !sameRequest(entry, request)));
  }

  private async handleBackendFailure(error: unknown): Promise<void> {
    const state = await this.lifecycle.handleBackendFailure(error);
    if (authenticatedToken(state) === null) {
      await this.journal.save([]);
      this.activeDeliveries.clear();
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
