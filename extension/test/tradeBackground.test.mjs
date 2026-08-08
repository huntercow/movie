import assert from "node:assert/strict";
import test from "node:test";
import { BackendApiError } from "../src/handlers/backendApi.ts";
import { TradeBackgroundController } from "../src/handlers/tradeBackground.ts";

const order = {
  id: "ORDER_RECORD_001",
  status: 20,
  productId: "ITEM_001",
  customerId: "BUYER_001",
  cityName: "上海",
  cinemaName: "测试影院",
  amount: 39.99
};

function setup(overrides = {}) {
  const calls = [];
  let adjustmentJournal = [];
  const lifecycle = {
    authorizeAction: async (effect) => ({ effect, automationRevision: 8 }),
    classifyActionCompletion: async () => "CONTINUE",
    getState: async () => ({
      token: "TOKEN_SECRET",
      authStatus: "AUTHENTICATED",
      automationEnabled: true,
      automationRevision: 8,
      safetyDisabled: false,
      remoteDisablePending: false
    }),
    handleBackendFailure: async (error) => { calls.push(["failure", error]); },
    ...overrides.lifecycle
  };
  const api = {
    getWaitingPaymentOrder: async (chatId) => {
      calls.push(["lookup", chatId]);
      return order;
    },
    updateOrderStatus: async (request) => {
      calls.push(["status", request]);
      return null;
    },
    ...overrides.api
  };
  const adjustmentSettlementJournal = {
    async load() {
      return structuredClone(adjustmentJournal);
    },
    async save(value) {
      adjustmentJournal = structuredClone(value);
      calls.push(["adjustment-journal-save", structuredClone(value)]);
    },
    ...overrides.adjustmentSettlementJournal
  };
  return {
    controller: new TradeBackgroundController({
      lifecycle,
      apiFactory(token) {
        calls.push(["token", token]);
        return api;
      },
      adjustmentSettlementJournal
    }),
    calls,
    adjustmentJournal: () => structuredClone(adjustmentJournal),
    setAdjustmentJournal(value) {
      adjustmentJournal = structuredClone(value);
    }
  };
}

test("waiting-payment lookup discards read results if automation closes", async () => {
  const { controller, calls } = setup({
    lifecycle: { classifyActionCompletion: async () => "DISCARD" }
  });
  assert.deepEqual(await controller.lookupWaitingPayment("CHAT_001"), { kind: "DISCARDED" });
  assert.deepEqual(calls, [["token", "TOKEN_SECRET"], ["lookup", "CHAT_001"]]);
});

test("waiting-payment null is a normal distinct no-quote result", async () => {
  const { controller } = setup({ api: { getWaitingPaymentOrder: async () => null } });
  assert.deepEqual(await controller.lookupWaitingPayment("CHAT_001"), { kind: "NOT_FOUND" });
});

test("a write permit is acquired before MTop and status settlement survives automation close", async () => {
  const { controller, calls } = setup({
    lifecycle: { classifyActionCompletion: async () => "SETTLE_ONLY" }
  });
  const permit = await controller.beginAdjustment(
    "ORDER_RECORD_001",
    "XIANYU_ORDER_001"
  );
  assert.deepEqual(permit, { effect: "WRITE", automationRevision: 8 });
  assert.equal(await controller.settleAdjusted({
    id: "ORDER_RECORD_001",
    status: 25,
    xianyuOrderId: "XIANYU_ORDER_001"
  }, permit), "SETTLE_ONLY");
  assert.deepEqual(calls.slice(-2), [
    ["status", { id: "ORDER_RECORD_001", status: 25, xianyuOrderId: "XIANYU_ORDER_001" }],
    ["adjustment-journal-save", []]
  ]);
});

test("backend failures enter the shared safe-disable path", async () => {
  const failure = new BackendApiError("NETWORK", "offline");
  const { controller, calls } = setup({
    api: { getWaitingPaymentOrder: async () => { throw failure; } }
  });
  await assert.rejects(controller.lookupWaitingPayment("CHAT_001"), failure);
  assert.deepEqual(calls.slice(-1), [["failure", failure]]);
});

test("status settlement requires the exact prior WRITE permit", async () => {
  const { controller, calls } = setup();
  await assert.rejects(controller.settleAdjusted({
    id: "ORDER_RECORD_001",
    status: 25,
    xianyuOrderId: "XIANYU_ORDER_001"
  }, { effect: "READ", automationRevision: 8 }), /WRITE/);
  assert.equal(calls.some(([name]) => name === "status"), false);
});

test("two page callers atomically receive only one price-adjustment ownership", async () => {
  let authorizations = 0;
  const { controller } = setup({
    lifecycle: {
      async authorizeAction(effect) {
        authorizations += 1;
        return { effect, automationRevision: 8 };
      }
    }
  });

  assert.deepEqual(await Promise.all([
    controller.beginAdjustment("ORDER_RECORD_001", "XIANYU_ORDER_001"),
    controller.beginAdjustment("ORDER_RECORD_001", "XIANYU_ORDER_001")
  ]), [
    { effect: "WRITE", automationRevision: 8 },
    null
  ]);
  assert.equal(authorizations, 1);

  assert.equal(
    await controller.beginAdjustment("ORDER_RECORD_002", "XIANYU_ORDER_001"),
    null
  );
  assert.equal(
    await controller.beginAdjustment("ORDER_RECORD_001", "XIANYU_ORDER_002"),
    null
  );
});

test("a pre-success abort releases the exact claim, but settled orders never re-enter", async () => {
  const { controller } = setup();
  const permit = await controller.beginAdjustment(
    "ORDER_RECORD_001",
    "XIANYU_ORDER_001"
  );
  await controller.abortAdjustment(
    "ORDER_RECORD_001",
    "XIANYU_ORDER_001",
    permit
  );
  const reacquired = await controller.beginAdjustment(
    "ORDER_RECORD_001",
    "XIANYU_ORDER_001"
  );
  assert.deepEqual(reacquired, permit);

  await controller.settleAdjusted({
    id: "ORDER_RECORD_001",
    status: 25,
    xianyuOrderId: "XIANYU_ORDER_001"
  }, reacquired);
  assert.equal(
    await controller.beginAdjustment("ORDER_RECORD_001", "XIANYU_ORDER_001"),
    null
  );
  await assert.rejects(
    controller.abortAdjustment(
      "ORDER_RECORD_001",
      "XIANYU_ORDER_001",
      reacquired
    ),
    /does not own/
  );
});

test("MTop success is journaled before status 25 and API failure keeps the lock", async () => {
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
    id: "ORDER_RECORD_001",
    status: 25,
    xianyuOrderId: "XIANYU_ORDER_001"
  };
  const permit = await setupResult.controller.beginAdjustment(
    request.id,
    request.xianyuOrderId
  );

  await assert.rejects(
    setupResult.controller.settleAdjusted(request, permit),
    failure
  );
  assert.deepEqual(setupResult.adjustmentJournal(), [request]);
  const persistedIndex = setupResult.calls.findIndex(
    ([name, value]) => name === "adjustment-journal-save" && value.length === 1
  );
  const firstUpdateIndex = setupResult.calls.findIndex(([name]) => name === "status");
  assert.ok(persistedIndex >= 0 && persistedIndex < firstUpdateIndex);
  assert.equal(
    await setupResult.controller.beginAdjustment(request.id, request.xianyuOrderId),
    null
  );
  await assert.rejects(
    setupResult.controller.abortAdjustment(
      request.id,
      request.xianyuOrderId,
      permit
    ),
    /cannot be aborted/
  );

  const beforeRetry = setupResult.calls.length;
  assert.deepEqual(
    await setupResult.controller.lookupWaitingPayment("CHAT_001"),
    { kind: "DUPLICATE" }
  );
  const retryCalls = setupResult.calls.slice(beforeRetry);
  assert.equal(retryCalls.filter(([name]) => name === "status").length, 1);
  assert.equal(retryCalls.filter(([name]) => name === "lookup").length, 1);
  assert.ok(
    retryCalls.findIndex(([name]) => name === "status") <
    retryCalls.findIndex(([name]) => name === "lookup")
  );
  assert.deepEqual(setupResult.adjustmentJournal(), []);
  assert.equal(
    await setupResult.controller.beginAdjustment(request.id, request.xianyuOrderId),
    null
  );
});

test("a restarted worker retries only persisted status 25 before exposing work", async () => {
  const request = {
    id: "ORDER_RECORD_001",
    status: 25,
    xianyuOrderId: "XIANYU_ORDER_001"
  };
  const setupResult = setup();
  setupResult.setAdjustmentJournal([request]);

  assert.deepEqual(
    await setupResult.controller.lookupWaitingPayment("CHAT_001"),
    { kind: "DUPLICATE" }
  );
  assert.equal(
    setupResult.calls.filter(([name]) => name === "status").length,
    1
  );
  assert.equal(
    await setupResult.controller.beginAdjustment(request.id, request.xianyuOrderId),
    null
  );
});

test("card no-record notification is claimed once per xianyu order in this worker", async () => {
  const { controller } = setup();
  assert.equal(
    await controller.claimNoQuoteNotification("XIANYU_ORDER_001"),
    true
  );
  assert.equal(
    await controller.claimNoQuoteNotification("XIANYU_ORDER_001"),
    false
  );
  assert.equal(
    await controller.claimNoQuoteNotification("XIANYU_ORDER_002"),
    true
  );
});
