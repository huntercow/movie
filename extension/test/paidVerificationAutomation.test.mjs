import assert from "node:assert/strict";
import test from "node:test";
import { createPaidVerificationAutomation } from "../src/handlers/paidVerificationAutomation.ts";
import {
  XianyuOrderDetailProtocolError,
  XianyuOrderDetailRequestError
} from "../src/protocol/xianyuTradeProtocol.ts";

const order = {
  id: "BUSINESS_ORDER_001",
  xianyuOrderId: "XIANYU_ORDER_001",
  customerId: "BUYER_001",
  amount: 39.99
};

const paidCard = {
  kind: "PAID_CARD",
  chatId: "CHAT_001",
  messageId: "MESSAGE_001",
  senderId: "BUYER_OTHER",
  itemId: "ITEM_001",
  orderId: "CARD_ORDER_MUST_NOT_BE_USED"
};

const paymentSummary = {
  kind: "PAYMENT_SUMMARY",
  chatId: "CHAT_001",
  redReminder: "等待卖家发货"
};

function setup(overrides = {}) {
  const calls = [];
  const port = {
    canExecute: async () => true,
    lookupPaidOrder: async (chatId) => {
      calls.push(["lookup", chatId]);
      return { kind: "FOUND", order };
    },
    beginOrderDetailRead: async () => {
      calls.push(["begin-read"]);
      return { effect: "READ", automationRevision: 8 };
    },
    fetchOrderDetail: async (xianyuOrderId) => {
      calls.push(["detail", xianyuOrderId]);
      return { actualPaidAmountCents: 3999 };
    },
    completeOrderDetailRead: async (permit) => {
      calls.push(["complete-read", permit]);
      return "CONTINUE";
    },
    advancePaid: async (businessOrderId) => {
      calls.push(["advance", businessOrderId]);
      return "CONTINUE";
    },
    beginMismatchCancellation: async (businessOrderId) => {
      calls.push(["begin-cancel", businessOrderId]);
      return { effect: "WRITE", automationRevision: 8 };
    },
    cancelSellerOrder: async (xianyuOrderId) => {
      calls.push(["cancel", xianyuOrderId]);
      return { issued: true, succeeded: false };
    },
    completeMismatchCancellation: async (request, permit) => {
      calls.push(["complete-mismatch", request, permit]);
      return "CONTINUE";
    },
    deliverPaymentSuccessful: async (chatId, receiverId, businessOrderId) => {
      calls.push(["payment-template", chatId, receiverId, businessOrderId]);
      return { success: true, stoppedByAutomation: false };
    },
    deliverCancelNotice: async (chatId, receiverId, businessOrderId) => {
      calls.push(["cancel-notice", chatId, receiverId, businessOrderId]);
      return { success: true, stoppedByAutomation: false };
    },
    ...overrides.port
  };
  return { automation: createPaidVerificationAutomation(port), calls };
}

for (const event of [paidCard, paymentSummary]) {
  test(`${event.kind} uses the persisted Xianyu order and business id`, async () => {
    const { automation, calls } = setup();
    assert.deepEqual(await automation.handle(event), {
      kind: "PAID",
      businessOrderId: "BUSINESS_ORDER_001",
      notified: true
    });
    assert.deepEqual(calls, [
      ["lookup", "CHAT_001"],
      ["begin-read"],
      ["detail", "XIANYU_ORDER_001"],
      ["complete-read", { effect: "READ", automationRevision: 8 }],
      ["advance", "BUSINESS_ORDER_001"],
      ["payment-template", "CHAT_001", "BUYER_001", "BUSINESS_ORDER_001"]
    ]);
    assert.equal(calls.some(call => call.includes("CARD_ORDER_MUST_NOT_BE_USED")), false);
  });
}

test("no status-25 record is a silent diagnostic outcome", async () => {
  const { automation, calls } = setup({
    port: {
      lookupPaidOrder: async (chatId) => {
        calls.push(["lookup", chatId]);
        return { kind: "NOT_FOUND" };
      }
    }
  });
  assert.deepEqual(await automation.handle(paymentSummary), { kind: "NO_RECORD" });
  assert.deepEqual(calls, [["lookup", "CHAT_001"]]);
});

test("automation off or a discarded backend read performs no downstream work", async () => {
  const off = setup({ port: { canExecute: async () => false } });
  assert.deepEqual(await off.automation.handle(paymentSummary), { kind: "STOPPED" });
  assert.deepEqual(off.calls, []);

  const discarded = setup({
    port: {
      lookupPaidOrder: async (chatId) => {
        discarded.calls.push(["lookup", chatId]);
        return { kind: "DISCARDED" };
      }
    }
  });
  assert.deepEqual(await discarded.automation.handle(paymentSummary), { kind: "STOPPED" });
  assert.deepEqual(discarded.calls, [["lookup", "CHAT_001"]]);
});

test("closing during the MTop read discards the amount and changes no state", async () => {
  const { automation, calls } = setup({
    port: {
      completeOrderDetailRead: async (permit) => {
        calls.push(["complete-read", permit]);
        return "DISCARD";
      }
    }
  });
  assert.deepEqual(await automation.handle(paymentSummary), { kind: "STOPPED" });
  assert.equal(calls.some(([name]) => name === "advance" || name === "begin-cancel"), false);
});

test("order-detail failures and mismatched order ids leave status 25 unchanged", async () => {
  for (const failure of [
    new XianyuOrderDetailRequestError("order detail failed"),
    new XianyuOrderDetailProtocolError("order id mismatch"),
    new XianyuOrderDetailProtocolError("amount must be a two-decimal string")
  ]) {
    const { automation, calls } = setup({
      port: {
        fetchOrderDetail: async (xianyuOrderId) => {
          calls.push(["detail", xianyuOrderId]);
          throw failure;
        }
      }
    });
    await assert.rejects(automation.handle(paymentSummary), failure);
    assert.equal(calls.some(([name]) => name === "advance" || name === "complete-mismatch"), false);
  }
});

test("payment notification failure never rolls back or repeats status 30", async () => {
  const { automation, calls } = setup({
    port: {
      deliverPaymentSuccessful: async (...args) => {
        calls.push(["payment-template", ...args]);
        return { success: false, stoppedByAutomation: false };
      }
    }
  });
  assert.deepEqual(await automation.handle(paymentSummary), {
    kind: "PAID",
    businessOrderId: "BUSINESS_ORDER_001",
    notified: false
  });
  assert.equal(calls.filter(([name]) => name === "advance").length, 1);
  assert.deepEqual(await automation.handle(paymentSummary), { kind: "DUPLICATE" });
  assert.equal(calls.filter(([name]) => name === "advance").length, 1);
});

test("a settle-only status 30 completion sends no buyer message", async () => {
  const { automation, calls } = setup({
    port: { advancePaid: async (id) => { calls.push(["advance", id]); return "SETTLE_ONLY"; } }
  });
  assert.deepEqual(await automation.handle(paymentSummary), {
    kind: "PAID",
    businessOrderId: "BUSINESS_ORDER_001",
    notified: false
  });
  assert.equal(calls.some(([name]) => name === "payment-template"), false);
});

test("a background duplicate status 30 claim sends no buyer message", async () => {
  const { automation, calls } = setup({
    port: { advancePaid: async (id) => { calls.push(["advance", id]); return "DUPLICATE"; } }
  });
  assert.deepEqual(await automation.handle(paymentSummary), { kind: "DUPLICATE" });
  assert.equal(calls.some(([name]) => name === "payment-template"), false);
});

test("an amount mismatch cancels with xianyuOrderId and settles status 90 with actual result", async () => {
  for (const cancelSucceeded of [true, false]) {
    const { automation, calls } = setup({
      port: {
        fetchOrderDetail: async (id) => {
          calls.push(["detail", id]);
          return { actualPaidAmountCents: 3900 };
        },
        cancelSellerOrder: async (id) => {
          calls.push(["cancel", id]);
          return { issued: true, succeeded: cancelSucceeded };
        }
      }
    });
    assert.deepEqual(await automation.handle(paymentSummary), {
      kind: "AMOUNT_MISMATCH",
      businessOrderId: "BUSINESS_ORDER_001",
      actualAmount: 39,
      cancelSucceeded
    });
    assert.deepEqual(calls.slice(-2), [
      ["cancel", "XIANYU_ORDER_001"],
      ["complete-mismatch", {
        businessOrderId: "BUSINESS_ORDER_001",
        actualAmount: 39,
        failureReason: "AMOUNT_MISMATCH",
        cancellation: { issued: true, succeeded: cancelSucceeded }
      }, { effect: "WRITE", automationRevision: 8 }]
    ]);
    assert.equal(calls.some(([name]) => name === "advance"), false);
  }
});

test("an upstream order failure notifies, cancels, and settles status 90", async () => {
  const { automation, calls } = setup({
    port: {
      advancePaid: async () => {
        calls.push(["advance"]);
        throw new Error("backend request failed: 账户余额不足");
      }
    }
  });
  assert.deepEqual(await automation.handle(paymentSummary), {
    kind: "AMOUNT_MISMATCH",
    businessOrderId: "BUSINESS_ORDER_001",
    actualAmount: 39.99,
    cancelSucceeded: false
  });
  const completeCall = calls.find(([name]) => name === "complete-mismatch");
  assert.deepEqual(completeCall, [
    "complete-mismatch",
    {
      businessOrderId: "BUSINESS_ORDER_001",
      actualAmount: 39.99,
      failureReason: "UPSTREAM_ORDER_FAILED",
      cancellation: { issued: true, succeeded: false }
    },
    { effect: "WRITE", automationRevision: 8 }
  ]);
  // 通知 → 取消 → 回写 90 的顺序
  const names = calls.map(([name]) => name);
  assert.ok(names.indexOf("cancel-notice") < names.indexOf("cancel"));
  assert.ok(names.indexOf("cancel") < names.indexOf("complete-mismatch"));
});

test("an upstream order failure still cancels when the cancel notice fails", async () => {
  const { automation, calls } = setup({
    port: {
      advancePaid: async () => {
        calls.push(["advance"]);
        throw new Error("backend request failed: 账户余额不足");
      },
      deliverCancelNotice: async () => {
        calls.push(["cancel-notice"]);
        throw new Error("template send failed");
      }
    }
  });
  assert.deepEqual(await automation.handle(paymentSummary), {
    kind: "AMOUNT_MISMATCH",
    businessOrderId: "BUSINESS_ORDER_001",
    actualAmount: 39.99,
    cancelSucceeded: false
  });
  assert.equal(calls.some(([name]) => name === "complete-mismatch"), true);
});

test("closing during cancellation still settles the actual mismatch result", async () => {
  let enabled = true;
  const { automation, calls } = setup({
    port: {
      canExecute: async () => enabled,
      fetchOrderDetail: async () => ({ actualPaidAmountCents: 3900 }),
      cancelSellerOrder: async (id) => {
        calls.push(["cancel", id]);
        enabled = false;
        return { issued: true, succeeded: false };
      },
      completeMismatchCancellation: async (request, permit) => {
        calls.push(["complete-mismatch", request, permit]);
        return "SETTLE_ONLY";
      }
    }
  });
  assert.equal((await automation.handle(paymentSummary)).kind, "AMOUNT_MISMATCH");
  assert.equal(calls.some(([name]) => name === "complete-mismatch"), true);
});

test("a cancellation that was not issued never settles status 90", async () => {
  const { automation, calls } = setup({
    port: {
      fetchOrderDetail: async () => ({ actualPaidAmountCents: 3900 }),
      cancelSellerOrder: async (id) => {
        calls.push(["cancel", id]);
        return { issued: false };
      },
      completeMismatchCancellation: async (request, permit) => {
        calls.push(["complete-mismatch", request, permit]);
        return "NOT_ISSUED";
      }
    }
  });
  assert.deepEqual(await automation.handle(paymentSummary), { kind: "STOPPED" });
  assert.deepEqual(calls.slice(-2), [
    ["cancel", "XIANYU_ORDER_001"],
    ["complete-mismatch", {
      businessOrderId: "BUSINESS_ORDER_001",
      actualAmount: 39,
      failureReason: "AMOUNT_MISMATCH",
      cancellation: { issued: false }
    }, { effect: "WRITE", automationRevision: 8 }]
  ]);
});

test("missing action permits stop before MTop reads, cancellation, or status writes", async () => {
  const noRead = setup({ port: { beginOrderDetailRead: async () => null } });
  assert.deepEqual(await noRead.automation.handle(paymentSummary), { kind: "STOPPED" });
  assert.equal(noRead.calls.some(([name]) => name === "detail"), false);

  const noCancel = setup({
    port: {
      fetchOrderDetail: async () => ({ actualPaidAmountCents: 3900 }),
      beginMismatchCancellation: async () => null
    }
  });
  assert.deepEqual(await noCancel.automation.handle(paymentSummary), { kind: "STOPPED" });
  assert.equal(noCancel.calls.some(([name]) => name === "cancel"), false);
});
