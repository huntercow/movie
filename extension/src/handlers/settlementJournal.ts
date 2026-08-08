import {
  validateUpdateOrderResultRequest,
  type UpdateOrderResultRequest,
  type UpdateOrderStatusRequest
} from "./backendApi.ts";
import { rmbAmountToCents } from "../protocol/xianyuTradeProtocol.ts";

export const ADJUSTMENT_SETTLEMENT_JOURNAL_STORAGE_KEY =
  "adjustmentSettlementJournalV1";
export const PAID_SETTLEMENT_JOURNAL_STORAGE_KEY = "paidSettlementJournalV1";
export const TICKET_SETTLEMENT_JOURNAL_STORAGE_KEY = "ticketSettlementJournalV1";

export type AdjustmentSettlement = Extract<
  UpdateOrderStatusRequest,
  { status: 25 }
>;
export type PaidAmountMismatchSettlement = Extract<
  UpdateOrderStatusRequest,
  { status: 90 }
>;

export interface SettlementJournal<T> {
  load(): Promise<T[]>;
  save(requests: readonly T[]): Promise<void>;
}

export type AdjustmentSettlementJournal = SettlementJournal<AdjustmentSettlement>;
export type PaidSettlementJournal = SettlementJournal<PaidAmountMismatchSettlement>;
export type TicketSettlementJournal = SettlementJournal<UpdateOrderResultRequest>;

interface ChromeStorageLocal {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}

interface ChromeForSettlementJournal {
  storage: { local: ChromeStorageLocal };
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string
): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (
    actual.length !== sorted.length ||
    actual.some((key, index) => key !== sorted[index])
  ) {
    throw new Error(`${context} has an unexpected structure`);
  }
}

function nonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function createChromeSettlementJournal<T>(
  chromeApi: ChromeForSettlementJournal,
  storageKey: string,
  decodeEntries: (value: unknown) => T[]
): SettlementJournal<T> {
  return {
    async load() {
      const stored = await chromeApi.storage.local.get(storageKey);
      const value = stored[storageKey];
      return value === undefined ? [] : decodeEntries(value);
    },
    async save(requests) {
      await chromeApi.storage.local.set({
        [storageKey]: decodeEntries([...requests])
      });
    }
  };
}

export function validateAdjustmentSettlement(
  value: unknown
): AdjustmentSettlement {
  const request = record(value, "adjustment settlement journal entry");
  exactKeys(
    request,
    ["id", "status", "xianyuOrderId"],
    "adjustment settlement journal entry"
  );
  if (request.status !== 25) {
    throw new Error("adjustment settlement journal status must be 25");
  }
  return {
    id: nonEmptyString(request.id, "adjustment settlement journal id"),
    status: 25,
    xianyuOrderId: nonEmptyString(
      request.xianyuOrderId,
      "adjustment settlement journal xianyuOrderId"
    )
  };
}

function decodeAdjustmentSettlements(value: unknown): AdjustmentSettlement[] {
  if (!Array.isArray(value)) {
    throw new Error("adjustment settlement journal must be an array");
  }
  const businessOrderIds = new Set<string>();
  const xianyuOrderIds = new Set<string>();
  return value.map((entry) => {
    const request = validateAdjustmentSettlement(entry);
    if (businessOrderIds.has(request.id)) {
      throw new Error(
        `adjustment settlement journal contains duplicate id ${request.id}`
      );
    }
    if (xianyuOrderIds.has(request.xianyuOrderId)) {
      throw new Error(
        "adjustment settlement journal contains duplicate xianyuOrderId " +
        request.xianyuOrderId
      );
    }
    businessOrderIds.add(request.id);
    xianyuOrderIds.add(request.xianyuOrderId);
    return request;
  });
}

export function validatePaidAmountMismatchSettlement(
  value: unknown
): PaidAmountMismatchSettlement {
  const request = record(value, "paid settlement journal entry");
  exactKeys(
    request,
    ["id", "status", "failureReason", "actualAmount", "cancelSucceeded"],
    "paid settlement journal entry"
  );
  if (request.status !== 90) {
    throw new Error("paid settlement journal status must be 90");
  }
  if (request.failureReason !== "AMOUNT_MISMATCH") {
    throw new Error("paid settlement journal failureReason must be AMOUNT_MISMATCH");
  }
  if (typeof request.actualAmount !== "number") {
    throw new Error("paid settlement journal actualAmount must be an RMB amount");
  }
  rmbAmountToCents(request.actualAmount);
  if (typeof request.cancelSucceeded !== "boolean") {
    throw new Error("paid settlement journal cancelSucceeded must be a boolean");
  }
  return {
    id: nonEmptyString(request.id, "paid settlement journal id"),
    status: 90,
    failureReason: "AMOUNT_MISMATCH",
    actualAmount: request.actualAmount,
    cancelSucceeded: request.cancelSucceeded
  };
}

function decodePaidSettlements(value: unknown): PaidAmountMismatchSettlement[] {
  if (!Array.isArray(value)) {
    throw new Error("paid settlement journal must be an array");
  }
  const businessOrderIds = new Set<string>();
  return value.map((entry) => {
    const request = validatePaidAmountMismatchSettlement(entry);
    if (businessOrderIds.has(request.id)) {
      throw new Error(`paid settlement journal contains duplicate id ${request.id}`);
    }
    businessOrderIds.add(request.id);
    return request;
  });
}

function decodeTicketSettlements(value: unknown): UpdateOrderResultRequest[] {
  if (!Array.isArray(value)) {
    throw new Error("ticket settlement journal must be an array");
  }
  return value.map((entry) => validateUpdateOrderResultRequest(entry));
}

export function createChromeAdjustmentSettlementJournal(
  chromeApi: ChromeForSettlementJournal
): AdjustmentSettlementJournal {
  return createChromeSettlementJournal(
    chromeApi,
    ADJUSTMENT_SETTLEMENT_JOURNAL_STORAGE_KEY,
    decodeAdjustmentSettlements
  );
}

export function createChromePaidSettlementJournal(
  chromeApi: ChromeForSettlementJournal
): PaidSettlementJournal {
  return createChromeSettlementJournal(
    chromeApi,
    PAID_SETTLEMENT_JOURNAL_STORAGE_KEY,
    decodePaidSettlements
  );
}

export function createChromeTicketSettlementJournal(
  chromeApi: ChromeForSettlementJournal
): TicketSettlementJournal {
  return createChromeSettlementJournal(
    chromeApi,
    TICKET_SETTLEMENT_JOURNAL_STORAGE_KEY,
    decodeTicketSettlements
  );
}
