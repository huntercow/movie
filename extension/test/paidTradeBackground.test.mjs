import assert from "node:assert/strict";
import test from "node:test";
import { BackendApiError } from "../src/handlers/backendApi.ts";
import { TradeBackgroundController } from "../src/handlers/tradeBackground.ts";

const order = {
  id: "BUSINESS_ORDER_001",
  xianyuOrderId: "XIANYU_ORDER_001",
  customerId: "BUYER_001",
  amount: 39.99
};

function setup(overrides = {}) {
  const calls = [];
  let journal = [];
  const lifecycle = {
    authorizeAction: async effect => ({ effect, automationRevision: 8 }),
    classifyActionCompletion: async () => "CONTINUE",
    getState: async () => ({
      token: "TOKEN_SECRET",
      authStatus: "AUTHENTICATED",
      automationEnabled: true,
      safetyDisabled: false,
      remoteDisablePending: false,
      automationRevision: 8
    }),
    handleBackendFailure: async error => { calls.push(["failure", error]); },
    ...overrides.lifecycle
  };
  const api = {
    getWaitingPaymentOrder: async () => null,
    getOrderByStatus: async chatId => { calls.push(["paid-lookup", chatId]); return order; },
    updateOrderStatus: async request => { calls.push(["status", request]); return null; },
    ...overrides.api
  };
  const paidSettlementJournal = {
    async load() {
      calls.push(["journal-load", journal.length]);
      return structuredClone(journal);
    },
    async save(value) {
      journal = structuredClone(value);
      calls.push(["journal-save", structuredClone(value)]);
    },
    ...overrides.paidSettlementJournal
  };
  return {
    controller: new TradeBackgroundController({
      lifecycle,
      apiFactory(token) { calls.push(["token", token]); return api; },
      paidSettlementJournal
    }),
    calls,
    journal: () => structuredClone(journal),
    setJournal(value) { journal = structuredClone(value); }
  };
}

test("paid-order lookup distinguishes null and discards a closed read", async () => {
  const missing = setup({ api: { getOrderByStatus: async () => null } });
  assert.deepEqual(await missing.controller.lookupPaidOrder("CHAT_001"), { kind: "NOT_FOUND" });

  const discarded = setup({
    lifecycle: { classifyActionCompletion: async () => "DISCARD" }
  });
  assert.deepEqual(await discarded.controller.lookupPaidOrder("CHAT_001"), { kind: "DISCARDED" });
});

test("the page-held order-detail READ permit is classified after MTop", async () => {
  const { controller } = setup({
    lifecycle: { classifyActionCompletion: async () => "DISCARD" }
  });
  const permit = await controller.beginOrderDetailRead();
  assert.deepEqual(permit, { effect: "READ", automationRevision: 8 });
  assert.equal(await controller.completeOrderDetailRead(permit), "DISCARD");
  await assert.rejects(
    controller.completeOrderDetailRead({ effect: "WRITE", automationRevision: 8 }),
    /READ permit/
  );
});

test("status 30 settles with the actual paid amount and reports settle-only closure", async () => {
  const { controller, calls } = setup({
    lifecycle: { classifyActionCompletion: async () => "SETTLE_ONLY" }
  });
  assert.equal(await controller.advancePaid("BUSINESS_ORDER_001", 3900), "SETTLE_ONLY");
  assert.deepEqual(calls.slice(-2), [
    ["token", "TOKEN_SECRET"],
    ["status", { id: "BUSINESS_ORDER_001", status: 30, actualAmount: 39 }]
  ]);
});

test("status 30 is atomically claimed by business order id across page callers", async () => {
  let releaseUpdate;
  const updateStarted = new Promise(resolve => { releaseUpdate = resolve; });
  let allowUpdate;
  const updateBlocked = new Promise(resolve => { allowUpdate = resolve; });
  const { controller, calls } = setup({
    api: {
      async updateOrderStatus(request) {
        calls.push(["status", request]);
        releaseUpdate();
        await updateBlocked;
        return null;
      }
    }
  });

  const first = controller.advancePaid("BUSINESS_ORDER_001", 3900);
  await updateStarted;
  const second = controller.advancePaid("BUSINESS_ORDER_001", 3900);
  allowUpdate();

  assert.deepEqual(await Promise.all([first, second]), ["CONTINUE", "DUPLICATE"]);
  assert.equal(calls.filter(([name]) => name === "status").length, 1);
});

test("amount mismatch uses its prior WRITE permit to settle status 90", async () => {
  const { controller, calls } = setup({
    lifecycle: { classifyActionCompletion: async () => "SETTLE_ONLY" }
  });
  const permit = await controller.beginMismatchCancellation("BUSINESS_ORDER_001");
  assert.equal(await controller.completeMismatchCancellation({
    businessOrderId: "BUSINESS_ORDER_001",
    actualAmount: 39,
    failureReason: "AMOUNT_MISMATCH",
    cancellation: { issued: true, succeeded: false }
  }, permit), "SETTLE_ONLY");
  assert.deepEqual(calls.find(([name]) => name === "status"), ["status", {
    id: "BUSINESS_ORDER_001",
    status: 90,
    failureReason: "AMOUNT_MISMATCH",
    actualAmount: 39,
    cancelSucceeded: false
  }]);
});

test("cross-page mismatch cancellation begins only once per business order", async () => {
  const { controller } = setup();
  const [first, second] = await Promise.all([
    controller.beginMismatchCancellation("BUSINESS_ORDER_001"),
    controller.beginMismatchCancellation("BUSINESS_ORDER_001")
  ]);
  assert.deepEqual(first, { effect: "WRITE", automationRevision: 8 });
  assert.equal(second, null);

  assert.equal(await controller.completeMismatchCancellation({
    businessOrderId: "BUSINESS_ORDER_001",
    actualAmount: 39,
    failureReason: "AMOUNT_MISMATCH",
    cancellation: { issued: false }
  }, first), "NOT_ISSUED");
  assert.deepEqual(
    await controller.beginMismatchCancellation("BUSINESS_ORDER_001"),
    { effect: "WRITE", automationRevision: 8 }
  );
});

test("an unissued cancellation releases its claim without writing status 90", async () => {
  const { controller, calls, journal } = setup();
  const permit = await controller.beginMismatchCancellation("BUSINESS_ORDER_001");
  assert.equal(await controller.completeMismatchCancellation({
    businessOrderId: "BUSINESS_ORDER_001",
    actualAmount: 39,
    failureReason: "AMOUNT_MISMATCH",
    cancellation: { issued: false }
  }, permit), "NOT_ISSUED");
  assert.equal(calls.some(([name]) => name === "status"), false);
  assert.deepEqual(journal(), []);
});

test("an issued cancellation is journaled before status 90 and API failure retries only settlement", async () => {
  let attempts = 0;
  const failure = new BackendApiError("NETWORK", "offline");
  const setupResult = setup({
    api: {
      async updateOrderStatus(request) {
        setupResult.calls.push(["status", request]);
        attempts += 1;
        if (attempts === 1) throw failure;
        return null;
      }
    }
  });
  const request = {
    id: "BUSINESS_ORDER_001",
    status: 90,
    failureReason: "AMOUNT_MISMATCH",
    actualAmount: 39,
    cancelSucceeded: false
  };
  const permit = await setupResult.controller.beginMismatchCancellation(request.id);

  await assert.rejects(setupResult.controller.completeMismatchCancellation({
    businessOrderId: request.id,
    actualAmount: request.actualAmount,
    failureReason: "AMOUNT_MISMATCH",
    cancellation: { issued: true, succeeded: false }
  }, permit), failure);
  assert.deepEqual(setupResult.journal(), [request]);
  assert.equal(await setupResult.controller.beginMismatchCancellation(request.id), null);

  const callsBeforeRetry = setupResult.calls.length;
  assert.deepEqual(
    await setupResult.controller.lookupPaidOrder("CHAT_001"),
    { kind: "NOT_FOUND" }
  );
  const retryCalls = setupResult.calls.slice(callsBeforeRetry);
  assert.equal(retryCalls.filter(([name]) => name === "status").length, 1);
  assert.ok(
    retryCalls.findIndex(([name]) => name === "status") <
    retryCalls.findIndex(([name]) => name === "paid-lookup")
  );
  assert.deepEqual(setupResult.journal(), []);
});

test("logout cleanup can remove paid settlements and runtime claims", async () => {
  const setupResult = setup();
  setupResult.setJournal([{
    id: "BUSINESS_ORDER_001",
    status: 90,
    failureReason: "AMOUNT_MISMATCH",
    actualAmount: 39,
    cancelSucceeded: false
  }]);
  await setupResult.controller.clearPaidSettlements();
  assert.deepEqual(setupResult.journal(), []);
  assert.deepEqual(
    await setupResult.controller.beginMismatchCancellation("BUSINESS_ORDER_001"),
    { effect: "WRITE", automationRevision: 8 }
  );
});

test("paid controller backend failures use the shared safe-disable path", async () => {
  const failure = new BackendApiError("NETWORK", "offline");
  const { controller, calls } = setup({
    api: { getOrderByStatus: async () => { throw failure; } }
  });
  await assert.rejects(controller.lookupPaidOrder("CHAT_001"), failure);
  assert.deepEqual(calls.slice(-1), [["failure", failure]]);
});

test("invalid permits and automation-off advances issue no backend writes", async () => {
  const invalid = setup();
  await invalid.controller.beginMismatchCancellation("BUSINESS_ORDER_001");
  await assert.rejects(invalid.controller.completeMismatchCancellation({
    businessOrderId: "BUSINESS_ORDER_001",
    actualAmount: 39,
    failureReason: "AMOUNT_MISMATCH",
    cancellation: { issued: true, succeeded: false }
  }, { effect: "READ", automationRevision: 8 }), /WRITE permit/);
  assert.equal(invalid.calls.some(([name]) => name === "status"), false);

  const off = setup({ lifecycle: { authorizeAction: async () => null } });
  assert.equal(await off.controller.advancePaid("BUSINESS_ORDER_001"), "DISCARD");
  assert.equal(off.calls.some(([name]) => name === "status"), false);
});
