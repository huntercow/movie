import assert from "node:assert/strict";
import test from "node:test";
import {
  ADJUSTMENT_SETTLEMENT_JOURNAL_STORAGE_KEY,
  createChromeAdjustmentSettlementJournal
} from "../src/handlers/settlementJournal.ts";

const settlement = {
  id: "BUSINESS_ORDER_001",
  status: 25,
  xianyuOrderId: "XIANYU_ORDER_001"
};

function chromeStorage(initialValue) {
  const stored = {};
  if (initialValue !== undefined) {
    stored[ADJUSTMENT_SETTLEMENT_JOURNAL_STORAGE_KEY] = initialValue;
  }
  return {
    stored,
    chromeApi: {
      storage: {
        local: {
          async get(key) {
            return { [key]: structuredClone(stored[key]) };
          },
          async set(value) {
            Object.assign(stored, structuredClone(value));
          }
        }
      }
    }
  };
}

test("status-25 journal survives extension-worker repository instances", async () => {
  const { chromeApi } = chromeStorage();
  await createChromeAdjustmentSettlementJournal(chromeApi).save([settlement]);
  assert.deepEqual(
    await createChromeAdjustmentSettlementJournal(chromeApi).load(),
    [settlement]
  );
});

test("status-25 journal rejects malformed and conflicting entries", async () => {
  for (const value of [
    [{ ...settlement, status: 20 }],
    [{ ...settlement, extra: true }],
    [settlement, { ...settlement }],
    [settlement, { ...settlement, id: "BUSINESS_ORDER_002" }],
    "not-an-array"
  ]) {
    const { chromeApi } = chromeStorage(value);
    await assert.rejects(
      createChromeAdjustmentSettlementJournal(chromeApi).load()
    );
  }
});
