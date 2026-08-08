import assert from "node:assert/strict";
import test from "node:test";
import {
  PAID_SETTLEMENT_JOURNAL_STORAGE_KEY,
  createChromePaidSettlementJournal
} from "../src/handlers/settlementJournal.ts";

const settlement = {
  id: "BUSINESS_ORDER_001",
  status: 90,
  failureReason: "AMOUNT_MISMATCH",
  actualAmount: 39,
  cancelSucceeded: false
};

function setupChrome() {
  const stored = {};
  return {
    stored,
    chromeApi: {
      storage: {
        local: {
          async get(key) {
            return { [key]: stored[key] };
          },
          async set(value) {
            Object.assign(stored, structuredClone(value));
          }
        }
      }
    }
  };
}

test("Chrome paid settlement journal survives repository instances", async () => {
  const { chromeApi } = setupChrome();
  await createChromePaidSettlementJournal(chromeApi).save([settlement]);
  assert.deepEqual(
    await createChromePaidSettlementJournal(chromeApi).load(),
    [settlement]
  );
});

test("paid settlement journal accepts only unique status-90 mismatch settlements", async () => {
  const { chromeApi, stored } = setupChrome();
  const journal = createChromePaidSettlementJournal(chromeApi);

  for (const invalid of [
    [{ ...settlement, status: 30 }],
    [{ ...settlement, failureReason: "UNKNOWN" }],
    [{ ...settlement, cancelSucceeded: "false" }],
    [settlement, settlement]
  ]) {
    stored[PAID_SETTLEMENT_JOURNAL_STORAGE_KEY] = invalid;
    await assert.rejects(journal.load());
  }
});
