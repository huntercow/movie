import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TOOL_ACTIONS,
  decodeToolRequest,
  mapDeliveryResultRequest,
  mapTradeBackendRequest
} from "../src/types.ts";

const contentSource = readFileSync(new URL("../src/xianyuContent.ts", import.meta.url), "utf8");

const expectedActions = [
  "FETCH_IMAGE_DATA_URL",
  "GET_REPLY_CONFIG",
  "GET_AUTOMATION_CONFIG",
  "QUOTE_IMAGE",
  "POLL_ORDER",
  "PENDING_DELIVERIES",
  "DELIVERY_RESULT",
  "CLAIM_DELIVERY",
  "AGISO_TRADE_LIST",
  "AGISO_ADJUST_PRICE",
  "AGISO_SEND_DUMMY",
  "RECORD_AGISO_FALLBACK",
  "REGISTER_WAITING_PAYMENT",
  "RECORD_ADJUSTED",
  "RESOLVE_ACTIVE_ORDER",
  "VERIFY_PAID",
  "RECORD_VERIFICATION_FAILURE",
  "RECORD_PROTOCOL_EVENT"
];

test("tool actions are the exact closed bridge protocol", () => {
  assert.deepEqual(TOOL_ACTIONS, expectedActions);
  for (const removed of [
    "ORDER_PAID",
    "ACTIVE_ORDER",
    "LATEST_QUOTE",
    "DUPLICATE_ORDER_BLOCKED",
    "ADJUST_PRICE_FAILED"
  ]) {
    assert.equal(TOOL_ACTIONS.includes(removed), false);
  }
});

test("tool request decoder accepts a defined action and validated envelope", () => {
  assert.deepEqual(decodeToolRequest({
    requestId: "REQUEST_001",
    action: "VERIFY_PAID",
    payload: { platformOrderId: "ORDER_001" }
  }), {
    requestId: "REQUEST_001",
    action: "VERIFY_PAID",
    payload: { platformOrderId: "ORDER_001" }
  });
});

test("tool request decoder rejects removed and unknown actions", () => {
  assert.throws(
    () => decodeToolRequest({ requestId: "REQUEST_001", action: "ORDER_PAID", payload: {} }),
    /tool action is not defined/
  );
  assert.throws(
    () => decodeToolRequest({ requestId: "REQUEST_001", action: "UNKNOWN", payload: {} }),
    /tool action is not defined/
  );
});

test("tool request decoder rejects malformed envelope fields", () => {
  assert.throws(
    () => decodeToolRequest({ requestId: "", action: "VERIFY_PAID", payload: {} }),
    /requestId/
  );
  assert.throws(
    () => decodeToolRequest({ requestId: "REQUEST_001", action: "VERIFY_PAID", payload: [] }),
    /payload/
  );
});

test("trade bridge maps all six backend actions to exact validated requests", () => {
  assert.deepEqual(mapTradeBackendRequest("REGISTER_WAITING_PAYMENT", {
    platformOrderId: "ORDER/001",
    chatId: "CHAT_001",
    buyerUserId: "BUYER_001",
    sellerUserId: "SELLER_001",
    itemId: "ITEM_001",
    messageId: "MESSAGE_001"
  }), {
    method: "POST",
    url: "/api/xianyu/orders/waiting-payment",
    body: {
      platformOrderId: "ORDER/001",
      chatId: "CHAT_001",
      buyerUserId: "BUYER_001",
      sellerUserId: "SELLER_001",
      itemId: "ITEM_001",
      messageId: "MESSAGE_001"
    }
  });
  assert.deepEqual(mapTradeBackendRequest("RECORD_ADJUSTED", {
    platformOrderId: "ORDER/001",
    adjustedAmountCents: 12_34
  }), {
    method: "POST",
    url: "/api/xianyu/orders/ORDER%2F001/adjusted",
    body: { adjustedAmountCents: 12_34 }
  });
  assert.deepEqual(mapTradeBackendRequest("RESOLVE_ACTIVE_ORDER", { chatId: "CHAT/001" }), {
    method: "GET",
    url: "/api/xianyu/orders/waiting-payment/CHAT%2F001"
  });
  assert.deepEqual(mapTradeBackendRequest("VERIFY_PAID", {
    platformOrderId: "ORDER/001",
    paidAmountCents: 12_34,
    itemTotalCents: 12_34,
    postFeeCents: 0,
    source: "XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT"
  }), {
    method: "POST",
    url: "/api/xianyu/orders/ORDER%2F001/paid-verification",
    body: {
      paidAmountCents: 12_34,
      itemTotalCents: 12_34,
      postFeeCents: 0,
      source: "XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT"
    }
  });
  assert.deepEqual(mapTradeBackendRequest("RECORD_VERIFICATION_FAILURE", {
    platformOrderId: "ORDER/001",
    code: "ORDER_ID_MISMATCH"
  }), {
    method: "POST",
    url: "/api/xianyu/orders/ORDER%2F001/verification-failures",
    body: { code: "ORDER_ID_MISMATCH" }
  });
  assert.deepEqual(mapTradeBackendRequest("RECORD_PROTOCOL_EVENT", {
    eventType: "UNBOUND_PAID_CARD",
    chatId: "CHAT_001"
  }), {
    method: "POST",
    url: "/api/xianyu/events",
    body: {
      eventType: "UNBOUND_PAID_CARD",
      chatId: "CHAT_001",
      messageId: "UNBOUND_PAID_CARD:CHAT_001"
    }
  });
});

test("trade bridge rejects malformed action payloads instead of forwarding them", () => {
  for (const [action, payload, pattern] of [
    ["REGISTER_WAITING_PAYMENT", { platformOrderId: "ORDER_001" }, /chatId/],
    ["RECORD_ADJUSTED", { platformOrderId: "ORDER_001", adjustedAmountCents: 12.34 }, /safe integer/],
    ["RESOLVE_ACTIVE_ORDER", { chatId: "" }, /chatId/],
    ["VERIFY_PAID", {
      platformOrderId: "ORDER_001",
      paidAmountCents: 12_34,
      itemTotalCents: 12_34,
      postFeeCents: 0,
      source: "UNKNOWN"
    }, /source/],
    ["RECORD_VERIFICATION_FAILURE", { platformOrderId: "ORDER_001", code: "UNKNOWN" }, /code/],
    ["RECORD_PROTOCOL_EVENT", { eventType: "", chatId: "CHAT_001" }, /eventType/]
  ]) {
    assert.throws(() => mapTradeBackendRequest(action, payload), pattern);
  }
  assert.doesNotMatch(contentSource, /\.\.\.request\.payload|postBackend\([^\n]+request\.payload|rawPayload/);
});

test("delivery result mapper permits only fixed success or stage-failure bodies", () => {
  assert.deepEqual(mapDeliveryResultRequest({
    platformOrderId: "ORDER/001",
    attemptId: "ATTEMPT_001",
    success: true,
    channel: "xianyu-mtop",
    errorMessage: ""
  }), {
    method: "POST",
    url: "/api/xianyu/deliveries/ORDER%2F001/result",
    body: { attemptId: "ATTEMPT_001", success: true, channel: "xianyu-mtop", errorMessage: "" }
  });
  for (const errorMessage of [
    "DELIVERY_TEMPLATE_FAILED",
    "TICKET_CODE_SEND_FAILED",
    "DUMMY_CONSIGN_FAILED"
  ]) {
    assert.deepEqual(mapDeliveryResultRequest({
      platformOrderId: "ORDER/001",
      attemptId: "ATTEMPT_001",
      success: false,
      channel: "xianyu-mtop",
      errorMessage
    }), {
      method: "POST",
      url: "/api/xianyu/deliveries/ORDER%2F001/result",
      body: { attemptId: "ATTEMPT_001", success: false, channel: "xianyu-mtop", errorMessage }
    });
  }
  assert.throws(
    () => mapDeliveryResultRequest({
      platformOrderId: "ORDER_001",
      attemptId: "ATTEMPT_001",
      success: false,
      channel: "xianyu-mtop",
      errorMessage: "sensitive upstream response"
    }),
    /errorMessage/
  );
  assert.throws(
    () => mapDeliveryResultRequest({
      platformOrderId: "ORDER_001",
      attemptId: "",
      success: true,
      channel: "xianyu-mtop",
      errorMessage: ""
    }),
    /attemptId/
  );
});

test("unconfirmed Agiso payload contracts fail fast instead of guessing amount units", () => {
  assert.match(
    contentSource,
    /case "AGISO_TRADE_LIST":[\s\S]*?case "AGISO_ADJUST_PRICE":[\s\S]*?case "AGISO_SEND_DUMMY":[\s\S]*?throw new Error\("Agiso bridge payload contract is not confirmed"\)/
  );
  assert.doesNotMatch(contentSource, /function agisoPost|amountCents:[\s\S]*?aldsidle\.agiso\.com/);
});
