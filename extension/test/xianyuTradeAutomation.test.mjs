import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyPaidVerificationResult,
  completeClaimedDeliveryAttempt,
  createXianyuTradeAutomation,
  decodeClaimDeliveryResult,
  decodeAdjustedOrderResult,
  decodeDeliveryFailureResult,
  decodeDeliveryPollResult,
  decodeDeliverySuccessResult,
  decodePendingRecoveryOrders,
  decodeVerificationFailureResult,
  decodeXianyuOrderPayload
} from "../src/xianyuTradeAutomation.ts";
import {
  XianyuOrderDetailProtocolError,
  XianyuOrderDetailRequestError
} from "../src/xianyuTradeProtocol.ts";

const waitingPaymentEvent = {
  kind: "WAITING_PAYMENT_CARD",
  chatId: "CHAT_001",
  messageId: "MESSAGE_001",
  senderId: "BUYER_001",
  itemId: "ITEM_001",
  orderId: "ORDER_001"
};
const paidCardEvent = { ...waitingPaymentEvent, kind: "PAID_CARD" };
const paymentSummaryEvent = {
  kind: "PAYMENT_SUMMARY",
  chatId: "CHAT_001",
  redReminder: "等待卖家发货"
};
const amounts = {
  actualPaidAmountCents: 12_34,
  itemTotalCents: 12_34,
  postFeeCents: 0
};

function fakePorts(overrides = {}) {
  const calls = [];
  const call = (name, result) => async (...args) => {
    calls.push({ name, args });
    return typeof result === "function" ? result(...args) : result;
  };
  return {
    calls,
    ports: {
      registerWaitingPayment: call("registerWaitingPayment", {
        platformOrderId: "ORDER_001",
        quoteNo: "QUOTE_001",
        totalPriceCents: 12_34,
        status: "WAIT_BUYER_PAY"
      }),
      adjustPrice: call("adjustPrice"),
      recordAdjusted: call("recordAdjusted"),
      resolveActiveOrder: call("resolveActiveOrder", { platformOrderId: "ORDER_001" }),
      fetchOrderDetail: call("fetchOrderDetail", amounts),
      verifyPaid: call("verifyPaid"),
      recordVerificationFailure: call("recordVerificationFailure", platformOrderId => ({
        platformOrderId,
        status: "NEED_MANUAL",
        shouldPoll: false,
        shouldDeliver: false
      })),
      recordUnboundProtocolEvent: call("recordUnboundProtocolEvent"),
      sendEditPriceSuccess: call("sendEditPriceSuccess"),
      ...overrides
    }
  };
}

test("waiting payment persists before adjusting and records success", async () => {
  const { ports, calls } = fakePorts();
  await createXianyuTradeAutomation(ports).handle(waitingPaymentEvent);
  assert.deepEqual(calls.map(call => call.name), [
    "registerWaitingPayment",
    "adjustPrice",
    "recordAdjusted",
    "sendEditPriceSuccess"
  ]);
  assert.deepEqual(calls[1].args, [12_34, "ORDER_001"]);
  assert.deepEqual(calls[2].args, ["ORDER_001", 12_34]);
  assert.deepEqual(calls[3].args, ["CHAT_001", "BUYER_001"]);
});

test("waiting payment rejects a mismatched persisted order before adjusting", async () => {
  const { ports, calls } = fakePorts({
    registerWaitingPayment: async () => ({
      platformOrderId: "ORDER_002",
      quoteNo: "QUOTE_001",
      totalPriceCents: 12_34,
      status: "WAIT_BUYER_PAY"
    })
  });
  await assert.rejects(
    () => createXianyuTradeAutomation(ports).handle(waitingPaymentEvent),
    /registered waiting-payment order id mismatch/
  );
  assert.deepEqual(calls, []);
});

for (const [field, value, pattern] of [
  ["quoteNo", "", /quoteNo/],
  ["totalPriceCents", 12.34, /totalPriceCents/],
  ["status", "QUOTED", /WAIT_BUYER_PAY/]
]) {
  test(`waiting payment strictly validates ${field}`, async () => {
    const response = {
      platformOrderId: "ORDER_001",
      quoteNo: "QUOTE_001",
      totalPriceCents: 12_34,
      status: "WAIT_BUYER_PAY",
      [field]: value
    };
    const { ports } = fakePorts({ registerWaitingPayment: async () => response });
    await assert.rejects(() => createXianyuTradeAutomation(ports).handle(waitingPaymentEvent), pattern);
  });
}

test("adjust price rejection records failure and does not record adjusted or send success", async () => {
  const rejection = new Error("adjust rejected");
  const { ports, calls } = fakePorts({
    adjustPrice: async (...args) => {
      calls.push({ name: "adjustPrice", args });
      throw rejection;
    }
  });
  await assert.rejects(
    () => createXianyuTradeAutomation(ports).handle(waitingPaymentEvent),
    error => error === rejection
  );
  assert.deepEqual(calls.map(call => call.name), [
    "registerWaitingPayment",
    "adjustPrice",
    "recordVerificationFailure"
  ]);
  assert.deepEqual(calls.at(-1).args, ["ORDER_001", "ADJUST_PRICE_REJECTED"]);
});

test("message update does not trigger a trade action", async () => {
  const { ports, calls } = fakePorts();
  await createXianyuTradeAutomation(ports).handle({
    kind: "MESSAGE_UPDATE",
    chatId: "CHAT_001",
    messageId: "MESSAGE_001",
    orderId: "ORDER_001",
    updateType: "TRADE_MODIFY_FEE_BUYER"
  });
  assert.deepEqual(calls, []);
});

test("paid summary resolves one persisted order before querying detail", async () => {
  const { ports, calls } = fakePorts();
  await createXianyuTradeAutomation(ports).handle(paymentSummaryEvent);
  assert.deepEqual(calls.map(call => call.name), [
    "resolveActiveOrder",
    "fetchOrderDetail",
    "verifyPaid"
  ]);
  assert.deepEqual(calls[2].args, ["ORDER_001", amounts]);
});

test("unbound payment summary records only a protocol event and rethrows", async () => {
  const resolutionError = new Error("expected exactly one active order");
  const { ports, calls } = fakePorts({
    resolveActiveOrder: async (...args) => {
      calls.push({ name: "resolveActiveOrder", args });
      throw resolutionError;
    }
  });
  await assert.rejects(
    () => createXianyuTradeAutomation(ports).handle(paymentSummaryEvent),
    error => error === resolutionError
  );
  assert.deepEqual(calls.map(call => call.name), ["resolveActiveOrder", "recordUnboundProtocolEvent"]);
  assert.deepEqual(calls.at(-1).args, ["CHAT_001", "UNBOUND_PAYMENT_SUMMARY"]);
});

test("unbound paid card records only a protocol event and rethrows", async () => {
  const resolutionError = new Error("resolver response is malformed");
  const { ports, calls } = fakePorts({
    resolveActiveOrder: async (...args) => {
      calls.push({ name: "resolveActiveOrder", args });
      throw resolutionError;
    }
  });
  await assert.rejects(
    () => createXianyuTradeAutomation(ports).handle(paidCardEvent),
    error => error === resolutionError
  );
  assert.deepEqual(calls.map(call => call.name), ["resolveActiveOrder", "recordUnboundProtocolEvent"]);
  assert.deepEqual(calls.at(-1).args, ["CHAT_001", "UNBOUND_PAID_CARD"]);
});

test("paid card rejects an order mismatch before querying detail", async () => {
  const { ports, calls } = fakePorts({
    resolveActiveOrder: async (...args) => {
      calls.push({ name: "resolveActiveOrder", args });
      return { platformOrderId: "ORDER_002" };
    }
  });
  await assert.rejects(
    () => createXianyuTradeAutomation(ports).handle(paidCardEvent),
    /paid card order id mismatch/
  );
  assert.deepEqual(calls.map(call => call.name), ["resolveActiveOrder", "recordVerificationFailure"]);
  assert.deepEqual(calls.at(-1).args, ["ORDER_002", "ORDER_ID_MISMATCH"]);
});

test("order detail request failure records failure and rethrows", async () => {
  const failure = new XianyuOrderDetailRequestError("order detail request failed");
  const { ports, calls } = fakePorts({
    fetchOrderDetail: async (...args) => {
      calls.push({ name: "fetchOrderDetail", args });
      throw failure;
    }
  });
  await assert.rejects(
    () => createXianyuTradeAutomation(ports).handle(paymentSummaryEvent),
    error => error === failure
  );
  assert.equal(calls.at(-1).name, "recordVerificationFailure");
  assert.deepEqual(calls.at(-1).args, ["ORDER_001", "ORDER_DETAIL_REQUEST_FAILED"]);
});

test("order detail protocol failure records failure and rethrows", async () => {
  const failure = new XianyuOrderDetailProtocolError("order detail protocol failed");
  const { ports, calls } = fakePorts({
    fetchOrderDetail: async (...args) => {
      calls.push({ name: "fetchOrderDetail", args });
      throw failure;
    }
  });
  await assert.rejects(
    () => createXianyuTradeAutomation(ports).handle(paidCardEvent),
    error => error === failure
  );
  assert.equal(calls.at(-1).name, "recordVerificationFailure");
  assert.deepEqual(calls.at(-1).args, ["ORDER_001", "ORDER_DETAIL_PROTOCOL_ERROR"]);
});

test("unclassified order-detail failures propagate without recording", async () => {
  const failure = new TypeError("unexpected implementation failure");
  const { ports, calls } = fakePorts({
    fetchOrderDetail: async (...args) => {
      calls.push({ name: "fetchOrderDetail", args });
      throw failure;
    }
  });
  await assert.rejects(
    () => createXianyuTradeAutomation(ports).handle(paymentSummaryEvent),
    error => error === failure
  );
  assert.equal(calls.at(-1).name, "fetchOrderDetail");
});

test("verification-failure recording preserves both the detail and recording errors", async () => {
  const detailFailure = new XianyuOrderDetailProtocolError("order detail protocol failed");
  const recordFailure = new Error("failure record unavailable");
  const { ports } = fakePorts({
    fetchOrderDetail: async () => { throw detailFailure; },
    recordVerificationFailure: async () => { throw recordFailure; }
  });
  await assert.rejects(
    () => createXianyuTradeAutomation(ports).handle(paymentSummaryEvent),
    error => error instanceof AggregateError
      && error.errors[0] === detailFailure
      && error.errors[1] === recordFailure
  );
});

test("verification-failure response protocol error participates in AggregateError", async () => {
  const detailFailure = new XianyuOrderDetailProtocolError("order detail protocol failed");
  const { ports } = fakePorts({
    fetchOrderDetail: async () => { throw detailFailure; },
    recordVerificationFailure: async () => ({
      platformOrderId: "ORDER_001",
      status: "WAIT_BUYER_PAY",
      shouldPoll: false,
      shouldDeliver: false
    })
  });
  await assert.rejects(
    () => createXianyuTradeAutomation(ports).handle(paymentSummaryEvent),
    error => error instanceof AggregateError
      && error.errors[0] === detailFailure
      && /NEED_MANUAL/.test(error.errors[1]?.message)
  );
});

for (const scenario of [
  {
    name: "adjust rejection",
    event: waitingPaymentEvent,
    override(calls, original) {
      return { adjustPrice: async () => { calls.push({ name: "adjustPrice", args: [] }); throw original; } };
    }
  },
  {
    name: "unbound summary",
    event: paymentSummaryEvent,
    override(calls, original) {
      return { resolveActiveOrder: async () => { calls.push({ name: "resolveActiveOrder", args: [] }); throw original; } };
    },
    recordPort: "recordUnboundProtocolEvent"
  },
  {
    name: "unbound paid card",
    event: paidCardEvent,
    override(calls, original) {
      return { resolveActiveOrder: async () => { calls.push({ name: "resolveActiveOrder", args: [] }); throw original; } };
    },
    recordPort: "recordUnboundProtocolEvent"
  },
  {
    name: "paid card mismatch",
    event: paidCardEvent,
    override() {
      return { resolveActiveOrder: async () => ({ platformOrderId: "ORDER_002" }) };
    }
  },
  {
    name: "order detail request failure",
    event: paymentSummaryEvent,
    original: new XianyuOrderDetailRequestError("request failed"),
    override(_calls, original) {
      return { fetchOrderDetail: async () => { throw original; } };
    }
  },
  {
    name: "order detail protocol failure",
    event: paymentSummaryEvent,
    original: new XianyuOrderDetailProtocolError("protocol failed"),
    override(_calls, original) {
      return { fetchOrderDetail: async () => { throw original; } };
    }
  }
]) {
  test(`${scenario.name} exposes both business and recording errors`, async () => {
    const original = scenario.original ?? new Error(`${scenario.name} business error`);
    const recordError = new Error(`${scenario.name} record error`);
    const { ports, calls } = fakePorts();
    Object.assign(ports, scenario.override(calls, original));
    ports[scenario.recordPort ?? "recordVerificationFailure"] = async () => { throw recordError; };
    await assert.rejects(
      () => createXianyuTradeAutomation(ports).handle(scenario.event),
      error => error instanceof AggregateError
        && (scenario.name === "paid card mismatch"
          ? /paid card order id mismatch/.test(error.errors[0]?.message)
          : error.errors[0] === original)
        && error.errors[1] === recordError
    );
  });
}

test("adjusted response requires the same order and exact waiting-payment status", () => {
  assert.doesNotThrow(() => decodeAdjustedOrderResult({
    platformOrderId: "ORDER_001",
    status: "WAIT_BUYER_PAY",
    shouldPoll: false,
    shouldDeliver: false
  }, "ORDER_001"));
  assert.throws(
    () => decodeAdjustedOrderResult({
      platformOrderId: "ORDER_002",
      status: "WAIT_BUYER_PAY",
      shouldPoll: false,
      shouldDeliver: false
    }, "ORDER_001"),
    /platformOrderId mismatch/
  );
  for (const status of ["NEED_MANUAL", "PAID_WAIT_SUBMIT", "UNKNOWN"]) {
    assert.throws(
      () => decodeAdjustedOrderResult({
        platformOrderId: "ORDER_001",
        status,
        shouldPoll: false,
        shouldDeliver: false
      }, "ORDER_001"),
      /WAIT_BUYER_PAY/
    );
  }
  for (const flags of [
    { shouldPoll: true, shouldDeliver: false },
    { shouldPoll: false, shouldDeliver: true },
    { shouldPoll: true, shouldDeliver: true }
  ]) {
    assert.throws(
      () => decodeAdjustedOrderResult({
        platformOrderId: "ORDER_001",
        status: "WAIT_BUYER_PAY",
        ...flags
      }, "ORDER_001"),
      /must not request polling or delivery/
    );
  }
});

const orderResponse = (overrides = {}) => ({
  platformOrderId: "ORDER_001",
  tradeNo: null,
  chatId: "CHAT_001",
  buyerUserId: "BUYER_001",
  status: "PAID_WAIT_SUBMIT",
  lastError: null,
  shouldPoll: true,
  shouldDeliver: false,
  deliveryMessage: null,
  ticketCodeInfo: null,
  deliveryAttemptId: null,
  deliveryAttemptOutcome: null,
  ...overrides
});

test("new order responses do not require legacy tradeNo", () => {
  const withNull = decodeXianyuOrderPayload(orderResponse(), "order response");
  const missing = orderResponse();
  delete missing.tradeNo;
  assert.deepEqual(decodeXianyuOrderPayload(missing, "order response"), withNull);
  assert.equal(Object.hasOwn(withNull, "tradeNo"), false);
});

for (const [status, shouldDeliver] of [
  ["PAID_WAIT_SUBMIT", false],
  ["TICKETING", false],
  ["ISSUED_WAIT_DELIVER", true]
]) {
  test(`paid verification requires exact work flags for ${status}`, () => {
    assert.equal(classifyPaidVerificationResult(orderResponse({ status, shouldDeliver })).kind, "ACTIVE");
    for (const flags of [
      { shouldPoll: false, shouldDeliver: false },
      { shouldPoll: false, shouldDeliver: true },
      { shouldPoll: true, shouldDeliver: !shouldDeliver }
    ]) {
      assert.throws(
        () => classifyPaidVerificationResult(orderResponse({ status, ...flags })),
        /exact work flags/
      );
    }
  });
}

test("paid verification has explicit manual and terminal branches", () => {
  assert.equal(classifyPaidVerificationResult(orderResponse({ status: "NEED_MANUAL", shouldPoll: false })).kind, "NEED_MANUAL");
  assert.throws(
    () => classifyPaidVerificationResult(orderResponse({ status: "NEED_MANUAL", shouldDeliver: true })),
    /must not request polling or delivery/
  );
  for (const status of ["DELIVERED", "REFUNDED", "CLOSED"]) {
    assert.equal(classifyPaidVerificationResult(orderResponse({ status, shouldPoll: false })).kind, "TERMINAL");
    assert.throws(
      () => classifyPaidVerificationResult(orderResponse({ status, shouldPoll: true })),
      /must not request polling or delivery/
    );
  }
});

test("paid verification rejects pre-payment and unknown states", () => {
  for (const status of ["WAIT_IMAGE", "QUOTED", "WAIT_BUYER_PAY", "UNKNOWN"]) {
    assert.throws(() => classifyPaidVerificationResult(orderResponse({ status })), /paid verification status/);
  }
});

test("delivery poll validates the authoritative order id and closed status branches", () => {
  assert.equal(decodeDeliveryPollResult(orderResponse({ status: "TICKETING", shouldDeliver: false }), "ORDER_001").kind, "WAIT");
  assert.equal(decodeDeliveryPollResult(orderResponse({ status: "ISSUED_WAIT_DELIVER", shouldDeliver: true }), "ORDER_001").kind, "READY");
  assert.equal(decodeDeliveryPollResult(orderResponse({ status: "NEED_MANUAL", shouldPoll: false }), "ORDER_001").kind, "NEED_MANUAL");
  assert.equal(decodeDeliveryPollResult(orderResponse({ status: "DELIVERED", shouldPoll: false }), "ORDER_001").kind, "TERMINAL");
  assert.equal(decodeDeliveryPollResult(orderResponse({
    status: "DELIVERY_OUTCOME_PENDING",
    shouldPoll: false,
    deliveryAttemptId: "ATTEMPT_001"
  }), "ORDER_001").kind, "NO_REPLAY");
  assert.throws(
    () => decodeDeliveryPollResult(orderResponse({ platformOrderId: "ORDER_002" }), "ORDER_001"),
    /platformOrderId mismatch/
  );
  assert.throws(
    () => decodeDeliveryPollResult(orderResponse({ status: "WAIT_BUYER_PAY" }), "ORDER_001"),
    /delivery poll status/
  );
});

test("delivery claim accepts only a persisted matching attempt and one-time permission", () => {
  const claimed = decodeClaimDeliveryResult(orderResponse({
    status: "DELIVERY_OUTCOME_PENDING",
    shouldPoll: false,
    shouldDeliver: true,
    deliveryAttemptId: "ATTEMPT_001",
    deliveryMessage: "出票完成",
    ticketCodeInfo: "取票码: 123456"
  }), "ORDER_001");
  assert.equal(claimed.kind, "CLAIMED");
  assert.equal(claimed.order.deliveryAttemptId, "ATTEMPT_001");
  const repeated = decodeClaimDeliveryResult(orderResponse({
    status: "DELIVERY_OUTCOME_PENDING",
    shouldPoll: false,
    shouldDeliver: false,
    deliveryAttemptId: "ATTEMPT_001"
  }), "ORDER_001");
  assert.equal(repeated.kind, "NOT_CLAIMED");
  assert.equal(repeated.order.deliveryMessage, undefined);
  assert.equal(repeated.order.ticketCodeInfo, undefined);
  assert.throws(
    () => decodeClaimDeliveryResult(orderResponse({
      platformOrderId: "ORDER_002",
      status: "DELIVERY_OUTCOME_PENDING",
      shouldPoll: false,
      shouldDeliver: true,
      deliveryAttemptId: "ATTEMPT_001"
    }), "ORDER_001"),
    /platformOrderId mismatch/
  );
  for (const status of ["PAID_WAIT_SUBMIT", "TICKETING", "DELIVERED", "NEED_MANUAL", "WAIT_BUYER_PAY"]) {
    assert.throws(
      () => decodeClaimDeliveryResult(orderResponse({ status, shouldDeliver: true }), "ORDER_001"),
      /delivery claim status/
    );
  }
  for (const invalid of [
    { deliveryAttemptId: null },
    { deliveryAttemptId: "", shouldDeliver: true },
    { deliveryAttemptId: "ATTEMPT_001", shouldPoll: true },
    { deliveryAttemptId: "ATTEMPT_001", shouldDeliver: true, ticketCodeInfo: null }
  ]) {
    assert.throws(() => decodeClaimDeliveryResult(orderResponse({
      status: "DELIVERY_OUTCOME_PENDING",
      shouldPoll: false,
      shouldDeliver: false,
      ...invalid
    }), "ORDER_001"));
  }
});

test("verification failure result requires matching manual state without automatic work", () => {
  const valid = orderResponse({ status: "NEED_MANUAL", shouldPoll: false, shouldDeliver: false });
  assert.doesNotThrow(() => decodeVerificationFailureResult(valid, "ORDER_001"));
  assert.throws(
    () => decodeVerificationFailureResult({ ...valid, platformOrderId: "ORDER_002" }, "ORDER_001"),
    /platformOrderId mismatch/
  );
  assert.throws(
    () => decodeVerificationFailureResult({ ...valid, status: "WAIT_BUYER_PAY" }, "ORDER_001"),
    /NEED_MANUAL/
  );
  assert.throws(
    () => decodeVerificationFailureResult({ ...valid, shouldPoll: true }, "ORDER_001"),
    /must not request polling or delivery/
  );
});

test("pending recovery returns only exact active states and rejects duplicate ids", () => {
  const active = [
    orderResponse({ platformOrderId: "ORDER_001", status: "PAID_WAIT_SUBMIT" }),
    orderResponse({ platformOrderId: "ORDER_002", status: "TICKETING" }),
    orderResponse({ platformOrderId: "ORDER_003", status: "ISSUED_WAIT_DELIVER", shouldDeliver: true })
  ];
  const skipped = [
    orderResponse({ platformOrderId: "ORDER_004", status: "NEED_MANUAL", shouldPoll: false }),
    orderResponse({ platformOrderId: "ORDER_005", status: "DELIVERED", shouldPoll: false }),
    orderResponse({
      platformOrderId: "ORDER_006",
      status: "DELIVERY_OUTCOME_PENDING",
      shouldPoll: false,
      deliveryAttemptId: "ATTEMPT_001"
    })
  ];
  assert.deepEqual(
    decodePendingRecoveryOrders([...active, ...skipped]).map(order => order.platformOrderId),
    ["ORDER_001", "ORDER_002", "ORDER_003"]
  );
  assert.throws(
    () => decodePendingRecoveryOrders([active[0], { ...active[0], status: "TICKETING" }]),
    /duplicate platformOrderId/
  );
  assert.throws(
    () => decodePendingRecoveryOrders([orderResponse({ status: "WAIT_BUYER_PAY" })]),
    /pending recovery status/
  );
  assert.throws(
    () => decodePendingRecoveryOrders([orderResponse({ status: "TICKETING", shouldDeliver: true })]),
    /exact work flags/
  );
  assert.throws(
    () => decodePendingRecoveryOrders([orderResponse({
      status: "DELIVERY_OUTCOME_PENDING",
      shouldPoll: true,
      deliveryAttemptId: "ATTEMPT_001"
    })]),
    /must not request polling or delivery/
  );
});

test("delivery result decoders require exact matching attempt and terminal states", () => {
  const delivered = orderResponse({
    status: "DELIVERED",
    shouldPoll: false,
    shouldDeliver: false,
    deliveryAttemptId: "ATTEMPT_001",
    deliveryAttemptOutcome: "SUCCESS"
  });
  const failed = orderResponse({
    status: "NEED_MANUAL",
    shouldPoll: false,
    shouldDeliver: false,
    deliveryAttemptId: "ATTEMPT_001",
    deliveryAttemptOutcome: "FAILURE"
  });
  assert.doesNotThrow(() => decodeDeliverySuccessResult(delivered, "ORDER_001", "ATTEMPT_001"));
  assert.doesNotThrow(() => decodeDeliveryFailureResult(failed, "ORDER_001", "ATTEMPT_001"));
  for (const value of [
    { ...delivered, platformOrderId: "ORDER_002" },
    { ...delivered, status: "ISSUED_WAIT_DELIVER" },
    { ...delivered, shouldPoll: true },
    { ...delivered, shouldDeliver: true }
  ]) {
    assert.throws(() => decodeDeliverySuccessResult(value, "ORDER_001", "ATTEMPT_001"));
  }
  for (const value of [
    { ...failed, platformOrderId: "ORDER_002" },
    { ...failed, status: "DELIVERED" },
    { ...failed, shouldPoll: true },
    { ...failed, shouldDeliver: true }
  ]) {
    assert.throws(() => decodeDeliveryFailureResult(value, "ORDER_001", "ATTEMPT_001"));
  }
  assert.throws(() => decodeDeliverySuccessResult({ ...delivered, deliveryAttemptId: "ATTEMPT_002" }, "ORDER_001", "ATTEMPT_001"));
  assert.throws(() => decodeDeliveryFailureResult({ ...failed, deliveryAttemptId: null }, "ORDER_001", "ATTEMPT_001"));
});

for (const [failedPort, expectedSummary] of [
  ["sendTemplate", "DELIVERY_TEMPLATE_FAILED"],
  ["sendTicketCodes", "TICKET_CODE_SEND_FAILED"],
  ["consignDummy", "DUMMY_CONSIGN_FAILED"]
]) {
  test(`claimed delivery ${failedPort} failure records a fixed failure and rethrows`, async () => {
    const businessError = new Error("sensitive upstream detail");
    const calls = [];
    const failureResponse = orderResponse({
      status: "NEED_MANUAL",
      shouldPoll: false,
      deliveryAttemptId: "ATTEMPT_001",
      deliveryAttemptOutcome: "FAILURE"
    });
    const ports = {
      sendTemplate: async () => { calls.push("sendTemplate"); },
      sendTicketCodes: async () => { calls.push("sendTicketCodes"); },
      consignDummy: async () => { calls.push("consignDummy"); },
      removeActive: () => { calls.push("removeActive"); },
      recordDeliveryResult: async (attemptId, success, errorMessage) => {
        calls.push(["recordDeliveryResult", attemptId, success, errorMessage]);
        return failureResponse;
      }
    };
    ports[failedPort] = async () => { calls.push(failedPort); throw businessError; };
    await assert.rejects(
      () => completeClaimedDeliveryAttempt("ORDER_001", "ATTEMPT_001", ports),
      error => error === businessError
    );
    assert.equal(calls.includes("removeActive"), true);
    assert.equal(calls[0], "removeActive");
    assert.deepEqual(calls.at(-1), ["recordDeliveryResult", "ATTEMPT_001", false, expectedSummary]);
    assert.equal(JSON.stringify(calls).includes(businessError.message), false);
  });
}

test("claimed delivery preserves both business and failure-record errors", async () => {
  const businessError = new Error("ticket send failed");
  const recordError = new Error("failure response malformed");
  await assert.rejects(
    () => completeClaimedDeliveryAttempt("ORDER_001", "ATTEMPT_001", {
      sendTemplate: async () => {},
      sendTicketCodes: async () => { throw businessError; },
      consignDummy: async () => {},
      removeActive: () => {},
      recordDeliveryResult: async () => { throw recordError; }
    }),
    error => error instanceof AggregateError
      && error.errors[0] === businessError
      && error.errors[1] === recordError
  );
});

test("claimed delivery removes active before the first external side effect", async () => {
  const calls = [];
  await completeClaimedDeliveryAttempt("ORDER_001", "ATTEMPT_001", {
    sendTemplate: async () => { calls.push("sendTemplate"); },
    sendTicketCodes: async () => { calls.push("sendTicketCodes"); },
    consignDummy: async () => { calls.push("consignDummy"); },
    removeActive: () => { calls.push("removeActive"); },
    recordDeliveryResult: async (attemptId, success, errorMessage) => {
      calls.push(["recordDeliveryResult", attemptId, success, errorMessage]);
      return orderResponse({
        status: "DELIVERED",
        shouldPoll: false,
        deliveryAttemptId: "ATTEMPT_001",
        deliveryAttemptOutcome: "SUCCESS"
      });
    }
  });
  assert.deepEqual(calls, [
    "removeActive",
    "sendTemplate",
    "sendTicketCodes",
    "consignDummy",
    ["recordDeliveryResult", "ATTEMPT_001", true, ""]
  ]);

  let removed = false;
  let effectCount = 0;
  await assert.rejects(
    () => completeClaimedDeliveryAttempt("ORDER_001", "ATTEMPT_001", {
      sendTemplate: async () => { effectCount += 1; },
      sendTicketCodes: async () => { effectCount += 1; },
      consignDummy: async () => { effectCount += 1; },
      removeActive: () => { removed = true; },
      recordDeliveryResult: async () => orderResponse({
        status: "DELIVERY_OUTCOME_PENDING",
        shouldPoll: false,
        deliveryAttemptId: "ATTEMPT_001"
      })
    }),
    /DELIVERED/
  );
  assert.equal(removed, true);
  assert.equal(effectCount, 3);
  assert.deepEqual(decodePendingRecoveryOrders([orderResponse({
    status: "DELIVERY_OUTCOME_PENDING",
    shouldPoll: false,
    deliveryAttemptId: "ATTEMPT_001"
  })]), []);
});
