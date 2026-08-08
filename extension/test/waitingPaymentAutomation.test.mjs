import assert from "node:assert/strict";
import test from "node:test";
import {
  createWaitingPaymentAutomation
} from "../src/handlers/waitingPaymentAutomation.ts";

const order = {
  id: "ORDER_RECORD_001",
  status: 20,
  productId: "ITEM_001",
  customerId: "BUYER_001",
  cityName: "上海",
  cinemaName: "测试影院",
  amount: 39.99
};

const card = {
  kind: "WAITING_PAYMENT_CARD",
  chatId: "CHAT_001",
  messageId: "MSG_001",
  senderId: "BUYER_001",
  itemId: "ITEM_001",
  orderId: "XIANYU_ORDER_001"
};

const summary = {
  kind: "WAITING_PAYMENT_SUMMARY",
  chatId: "CHAT_001",
  redReminder: "等待买家付款"
};

function setup(overrides = {}) {
  const calls = [];
  const port = {
    canExecute: async () => true,
    lookupWaitingPayment: async (chatId) => {
      calls.push(["lookup", chatId]);
      return { kind: "FOUND", order };
    },
    resolveHeadInfoOrderId: async (chatId, productId) => {
      calls.push(["headinfo", chatId, productId]);
      return "XIANYU_ORDER_001";
    },
    beginAdjustment: async () => {
      calls.push(["begin"]);
      return { effect: "WRITE", automationRevision: 8 };
    },
    adjustPrice: async (amountCents, xianyuOrderId) => {
      calls.push(["adjust", amountCents, xianyuOrderId]);
    },
    settleAdjusted: async (request, permit) => {
      calls.push(["settle", request, permit]);
      return "CONTINUE";
    },
    deliverTemplate: async (templateKey, values = {}) => {
      calls.push(["template", templateKey, values]);
      return { success: true, stoppedByAutomation: false };
    },
    proposeSellerCancellation: async (xianyuOrderId) => {
      calls.push(["cancel-proposal", xianyuOrderId]);
    },
    ...overrides.port
  };
  return {
    automation: createWaitingPaymentAutomation(port),
    calls
  };
}

test("card uses only its confirmed bizOrderId and the backend amount", async () => {
  const { automation, calls } = setup();
  assert.deepEqual(await automation.handle(card), {
    kind: "ADJUSTED",
    businessOrderId: "ORDER_RECORD_001",
    xianyuOrderId: "XIANYU_ORDER_001",
    notified: true
  });
  assert.deepEqual(calls, [
    ["lookup", "CHAT_001"],
    ["begin"],
    ["adjust", 3999, "XIANYU_ORDER_001"],
    ["settle", {
      id: "ORDER_RECORD_001",
      status: 25,
      xianyuOrderId: "XIANYU_ORDER_001"
    }, { effect: "WRITE", automationRevision: 8 }],
    ["template", "edit_price_success", {
      businessOrderId: "ORDER_RECORD_001",
      cityName: "上海",
      cinemaName: "测试影院"
    }]
  ]);
  assert.equal(calls.some(([name]) => name === "headinfo"), false);
});

test("summary queries first and uses only productId + chatId headinfo", async () => {
  const { automation, calls } = setup();
  await automation.handle(summary);
  assert.deepEqual(calls.slice(0, 4), [
    ["lookup", "CHAT_001"],
    ["headinfo", "CHAT_001", "ITEM_001"],
    ["begin"],
    ["adjust", 3999, "XIANYU_ORDER_001"]
  ]);
});

test("missing headinfo order id fails without falling back to card fields or adjustment", async () => {
  const { automation, calls } = setup({
    port: {
      resolveHeadInfoOrderId: async (...args) => {
        calls.push(["headinfo", ...args]);
        throw new Error("orderId must be a non-empty string");
      }
    }
  });
  await assert.rejects(automation.handle(summary), /orderId/);
  assert.deepEqual(calls, [
    ["lookup", "CHAT_001"],
    ["headinfo", "CHAT_001", "ITEM_001"]
  ]);
});

test("no quote sends no_quote_record and proposes cancellation only when an order id is already known", async () => {
  for (const [event, expected] of [
    [card, [
      ["lookup", "CHAT_001"],
      ["template", "no_quote_record", {}],
      ["cancel-proposal", "XIANYU_ORDER_001"]
    ]],
    [summary, [
      ["lookup", "CHAT_001"],
      ["template", "no_quote_record", {}]
    ]]
  ]) {
    const { automation, calls } = setup({
      port: {
        lookupWaitingPayment: async (chatId) => {
          calls.push(["lookup", chatId]);
          return { kind: "NOT_FOUND" };
        }
      }
    });
    assert.deepEqual(await automation.handle(event), {
      kind: "NO_QUOTE",
      cancellationProposed: event.kind === "WAITING_PAYMENT_CARD"
    });
    assert.deepEqual(calls, expected);
  }
});

test("a discarded lookup or automation off performs no downstream action", async () => {
  const discarded = setup({
    port: {
      lookupWaitingPayment: async (chatId) => {
        discarded.calls.push(["lookup", chatId]);
        return { kind: "DISCARDED" };
      }
    }
  });
  assert.deepEqual(await discarded.automation.handle(card), { kind: "STOPPED" });
  assert.deepEqual(discarded.calls, [["lookup", "CHAT_001"]]);

  const off = setup({ port: { canExecute: async () => false } });
  assert.deepEqual(await off.automation.handle(card), { kind: "STOPPED" });
  assert.deepEqual(off.calls, []);
});

test("resolved MTop failures never settle status 25 or send success", async () => {
  for (const failure of [
    new Error("adjust price failed: FAIL_BIZ"),
    new Error("data.success must be true")
  ]) {
    const { automation, calls } = setup({
      port: {
        adjustPrice: async (...args) => {
          calls.push(["adjust", ...args]);
          throw failure;
        }
      }
    });
    await assert.rejects(automation.handle(card), failure);
    assert.equal(calls.some(([name]) => name === "settle"), false);
    assert.equal(calls.some(([name]) => name === "template"), false);
  }
});

test("automation closing during MTop write still settles status but sends no message", async () => {
  let enabled = true;
  const { automation, calls } = setup({
    port: {
      canExecute: async () => enabled,
      adjustPrice: async (amountCents, xianyuOrderId) => {
        calls.push(["adjust", amountCents, xianyuOrderId]);
        enabled = false;
      },
      settleAdjusted: async (request, permit) => {
        calls.push(["settle", request, permit]);
        return "SETTLE_ONLY";
      }
    }
  });
  assert.deepEqual(await automation.handle(card), {
    kind: "ADJUSTED",
    businessOrderId: "ORDER_RECORD_001",
    xianyuOrderId: "XIANYU_ORDER_001",
    notified: false
  });
  assert.equal(calls.some(([name]) => name === "settle"), true);
  assert.equal(calls.some(([name]) => name === "template"), false);
});

test("the same external or business order cannot be advanced twice", async () => {
  const cardSetup = setup();
  await cardSetup.automation.handle(card);
  assert.deepEqual(await cardSetup.automation.handle(card), { kind: "DUPLICATE" });
  assert.equal(cardSetup.calls.filter(([name]) => name === "adjust").length, 1);

  const summarySetup = setup({
    port: {
      resolveHeadInfoOrderId: async () => "XIANYU_OTHER"
    }
  });
  await summarySetup.automation.handle(summary);
  assert.deepEqual(await summarySetup.automation.handle(summary), { kind: "DUPLICATE" });
  assert.equal(summarySetup.calls.filter(([name]) => name === "adjust").length, 1);
});

test("begin carries both order ids and an explicit MTop failure aborts ownership", async () => {
  let claimed = false;
  let attempts = 0;
  const setupResult = setup({
    port: {
      async beginAdjustment(businessOrderId, xianyuOrderId) {
        setupResult.calls.push(["begin-owned", businessOrderId, xianyuOrderId]);
        if (claimed) return null;
        claimed = true;
        return { effect: "WRITE", automationRevision: 8 };
      },
      async abortAdjustment(businessOrderId, xianyuOrderId, permit) {
        setupResult.calls.push([
          "abort",
          businessOrderId,
          xianyuOrderId,
          permit
        ]);
        claimed = false;
      },
      async adjustPrice(amountCents, xianyuOrderId) {
        setupResult.calls.push(["adjust", amountCents, xianyuOrderId]);
        attempts += 1;
        if (attempts === 1) throw new Error("adjust rejected");
      }
    }
  });

  await assert.rejects(setupResult.automation.handle(card), /adjust rejected/);
  assert.deepEqual(
    setupResult.calls.find(([name]) => name === "begin-owned"),
    ["begin-owned", "ORDER_RECORD_001", "XIANYU_ORDER_001"]
  );
  assert.equal(setupResult.calls.filter(([name]) => name === "abort").length, 1);

  assert.equal((await setupResult.automation.handle(card)).kind, "ADJUSTED");
  assert.equal(attempts, 2);
});

test("an explicitly successful MTop write is never aborted when status settlement fails", async () => {
  let aborts = 0;
  const failure = new Error("status 25 offline");
  const { automation } = setup({
    port: {
      abortAdjustment: async () => { aborts += 1; },
      settleAdjusted: async () => { throw failure; }
    }
  });

  await assert.rejects(automation.handle(card), failure);
  assert.equal(aborts, 0);
  assert.deepEqual(await automation.handle(card), { kind: "DUPLICATE" });
});

test("two independent page workflows share one adjustment owner and one success notice", async () => {
  let claimed = false;
  let settled = false;
  let adjustCount = 0;
  let noticeCount = 0;
  const port = {
    canExecute: async () => true,
    lookupWaitingPayment: async () => ({ kind: "FOUND", order }),
    resolveHeadInfoOrderId: async () => "XIANYU_ORDER_001",
    async beginAdjustment() {
      if (claimed || settled) return null;
      claimed = true;
      return { effect: "WRITE", automationRevision: 8 };
    },
    async abortAdjustment() {
      claimed = false;
    },
    async adjustPrice() {
      adjustCount += 1;
      await Promise.resolve();
    },
    async settleAdjusted() {
      assert.equal(claimed, true);
      settled = true;
      claimed = false;
      return "CONTINUE";
    },
    async deliverTemplate(templateKey) {
      if (templateKey === "edit_price_success") noticeCount += 1;
      return { success: true, stoppedByAutomation: false };
    },
    proposeSellerCancellation: async () => {}
  };
  const firstPage = createWaitingPaymentAutomation(port);
  const secondPage = createWaitingPaymentAutomation(port);

  const results = await Promise.all([
    firstPage.handle(card),
    secondPage.handle(card)
  ]);
  assert.equal(results.filter(({ kind }) => kind === "ADJUSTED").length, 1);
  assert.equal(results.filter(({ kind }) => kind === "STOPPED").length, 1);
  assert.equal(adjustCount, 1);
  assert.equal(noticeCount, 1);
});

test("two page workflows claim a card no-record notification by xianyu order id", async () => {
  const seen = new Set();
  let notices = 0;
  let cancellationProposals = 0;
  const port = {
    canExecute: async () => true,
    lookupWaitingPayment: async () => ({ kind: "NOT_FOUND" }),
    resolveHeadInfoOrderId: async () => { throw new Error("not used"); },
    beginAdjustment: async () => { throw new Error("not used"); },
    adjustPrice: async () => { throw new Error("not used"); },
    settleAdjusted: async () => { throw new Error("not used"); },
    async claimNoQuoteNotification(xianyuOrderId) {
      if (seen.has(xianyuOrderId)) return false;
      seen.add(xianyuOrderId);
      return true;
    },
    async deliverTemplate(templateKey) {
      assert.equal(templateKey, "no_quote_record");
      notices += 1;
      return { success: true, stoppedByAutomation: false };
    },
    async proposeSellerCancellation() {
      cancellationProposals += 1;
    }
  };

  const results = await Promise.all([
    createWaitingPaymentAutomation(port).handle(card),
    createWaitingPaymentAutomation(port).handle(card)
  ]);
  assert.equal(results.filter(({ kind }) => kind === "NO_QUOTE").length, 1);
  assert.equal(results.filter(({ kind }) => kind === "DUPLICATE").length, 1);
  assert.equal(notices, 1);
  assert.equal(cancellationProposals, 1);
});
