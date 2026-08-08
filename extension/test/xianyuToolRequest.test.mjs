import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TOOL_ACTIONS,
  decodeToolRequest
} from "../src/handlers/types.ts";

const typesSource = readFileSync(new URL("../src/handlers/types.ts", import.meta.url), "utf8");
const contentSource = readFileSync(new URL("../src/webhook/xianyuContent.ts", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

const expectedActions = [
  "FETCH_IMAGE_DATA_URL",
  "GET_REPLY_CONFIG",
  "GET_AUTOMATION_CONFIG",
  "AI_CUSTOMER_SERVICE",
  "QUOTE_IMAGE",
  "LOOKUP_WAITING_PAYMENT",
  "BEGIN_PRICE_ADJUSTMENT",
  "SETTLE_PRICE_ADJUSTMENT",
  "LOOKUP_PAID_ORDER",
  "BEGIN_ORDER_DETAIL_READ",
  "COMPLETE_ORDER_DETAIL_READ",
  "ADVANCE_PAID_ORDER",
  "BEGIN_MISMATCH_CANCELLATION",
  "COMPLETE_MISMATCH_CANCELLATION",
  "GET_TICKET_RESULTS",
  "BEGIN_TICKET_DELIVERY",
  "ABORT_TICKET_DELIVERY",
  "SETTLE_TICKET_RESULT"
];

function sourceForCase(source, action, nextAction) {
  const start = source.indexOf(`case "${action}":`);
  assert.ok(start >= 0, `missing bridge case ${action}`);
  const end = nextAction === undefined
    ? source.length
    : source.indexOf(`case "${nextAction}":`, start);
  assert.ok(end > start, `missing bridge case boundary after ${action}`);
  return source.slice(start, end);
}

test("tool actions are the exact closed bridge protocol", () => {
  assert.deepEqual(TOOL_ACTIONS, expectedActions);
  for (const removed of [
    "ORDER_PAID",
    "ACTIVE_ORDER",
    "LATEST_QUOTE",
    "DUPLICATE_ORDER_BLOCKED",
    "ADJUST_PRICE_FAILED",
    "OCR_SEAT_IMAGE",
    "BAOJIA",
    "POLL_ORDER",
    "PENDING_DELIVERIES",
    "DELIVERY_RESULT",
    "CLAIM_DELIVERY",
    "REGISTER_WAITING_PAYMENT",
    "RESOLVE_WAITING_PAYMENT_CONTEXT",
    "REGISTER_WAITING_PAYMENT_SUMMARY",
    "RECORD_ADJUSTED",
    "RESOLVE_ACTIVE_ORDER",
    "VERIFY_PAID",
    "RECORD_VERIFICATION_FAILURE",
    "RECORD_PROTOCOL_EVENT",
    "AGISO_TRADE_LIST",
    "AGISO_ADJUST_PRICE",
    "AGISO_SEND_DUMMY",
    "RECORD_AGISO_FALLBACK"
  ]) {
    assert.equal(TOOL_ACTIONS.includes(removed), false, removed);
  }
});

test("tool request decoder accepts a defined action and validated envelope", () => {
  assert.deepEqual(decodeToolRequest({
    requestId: "REQUEST_001",
    action: "LOOKUP_PAID_ORDER",
    payload: { chatId: "CHAT_001" }
  }), {
    requestId: "REQUEST_001",
    action: "LOOKUP_PAID_ORDER",
    payload: { chatId: "CHAT_001" }
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
    () => decodeToolRequest({ requestId: "", action: "LOOKUP_PAID_ORDER", payload: {} }),
    /requestId/
  );
  assert.throws(
    () => decodeToolRequest({ requestId: "REQUEST_001", action: "LOOKUP_PAID_ORDER", payload: [] }),
    /payload/
  );
});

test("trade bridge forwards lookup, permit, settlement, and cancellation operations", () => {
  const waitingLookupSource = sourceForCase(contentSource, "LOOKUP_WAITING_PAYMENT", "BEGIN_PRICE_ADJUSTMENT");
  const beginAdjustmentSource = sourceForCase(contentSource, "BEGIN_PRICE_ADJUSTMENT", "SETTLE_PRICE_ADJUSTMENT");
  const settleAdjustmentSource = sourceForCase(contentSource, "SETTLE_PRICE_ADJUSTMENT", "LOOKUP_PAID_ORDER");
  const paidLookupSource = sourceForCase(contentSource, "LOOKUP_PAID_ORDER", "BEGIN_ORDER_DETAIL_READ");
  const beginReadSource = sourceForCase(contentSource, "BEGIN_ORDER_DETAIL_READ", "COMPLETE_ORDER_DETAIL_READ");
  const completeReadSource = sourceForCase(contentSource, "COMPLETE_ORDER_DETAIL_READ", "ADVANCE_PAID_ORDER");
  const advancePaidSource = sourceForCase(contentSource, "ADVANCE_PAID_ORDER", "BEGIN_MISMATCH_CANCELLATION");
  const beginCancellationSource = sourceForCase(
    contentSource,
    "BEGIN_MISMATCH_CANCELLATION",
    "COMPLETE_MISMATCH_CANCELLATION"
  );
  const completeCancellationSource = sourceForCase(
    contentSource,
    "COMPLETE_MISMATCH_CANCELLATION",
    "GET_TICKET_RESULTS"
  );

  assert.match(waitingLookupSource, /chatId: requireString\(request\.payload\.chatId/);
  assert.match(beginAdjustmentSource, /businessOrderId: requireString\(request\.payload\.businessOrderId/);
  assert.match(beginAdjustmentSource, /xianyuOrderId: requireString\(request\.payload\.xianyuOrderId/);
  assert.match(settleAdjustmentSource, /id: requireString\(request\.payload\.id/);
  assert.match(settleAdjustmentSource, /status: requireLiteral\(request\.payload\.status, 25/);
  assert.match(settleAdjustmentSource, /xianyuOrderId: requireString\(request\.payload\.xianyuOrderId/);
  assert.match(settleAdjustmentSource, /effect: requireEnum\(request\.payload\.effect, \["WRITE"\]/);
  assert.match(settleAdjustmentSource, /automationRevision/);
  assert.match(paidLookupSource, /chatId: requireString\(request\.payload\.chatId/);
  assert.match(beginReadSource, /requireEmptyPayload\(request\.payload/);
  assert.match(completeReadSource, /effect: requireEnum\(request\.payload\.effect, \["READ"\]/);
  assert.match(completeReadSource, /automationRevision/);
  assert.match(advancePaidSource, /id: requireString\(request\.payload\.id/);
  assert.match(beginCancellationSource, /requireExactPayloadKeys\(request\.payload, \["id"\]/);
  assert.match(beginCancellationSource, /id: requireString\(request\.payload\.id/);
  assert.match(completeCancellationSource, /businessOrderId/);
  assert.match(completeCancellationSource, /actualAmount/);
  assert.match(completeCancellationSource, /decodePaidSellerCancellation/);
  assert.match(completeCancellationSource, /effect: requireEnum\(request\.payload\.effect, \["WRITE"\]/);
  assert.match(completeCancellationSource, /automationRevision/);

  assert.match(backgroundSource, /tradeBackground\.lookupWaitingPayment\(message\.data\.chatId\)/);
  assert.match(backgroundSource, /tradeBackground\.beginAdjustment\(\s*message\.data\.businessOrderId,\s*message\.data\.xianyuOrderId,\s*\)/);
  assert.match(backgroundSource, /tradeBackground\.settleAdjusted\(message\.data\.request, message\.data\.permit\)/);
  assert.match(backgroundSource, /tradeBackground\.lookupPaidOrder\(message\.data\.chatId\)/);
  assert.match(backgroundSource, /tradeBackground\.beginOrderDetailRead\(\)/);
  assert.match(backgroundSource, /tradeBackground\.completeOrderDetailRead\(message\.data\.permit\)/);
  assert.match(backgroundSource, /tradeBackground\.advancePaid\(\s*message\.data\.id,\s*message\.data\.actualPaidAmountCents,\s*\)/);
  assert.match(backgroundSource, /tradeBackground\.beginMismatchCancellation\(message\.data\.id\)/);
  assert.match(backgroundSource, /tradeBackground\.completeMismatchCancellation\(/);
});

test("ticket bridge forwards result polling, delivery locks, and strict settlement", () => {
  const resultsSource = sourceForCase(contentSource, "GET_TICKET_RESULTS", "BEGIN_TICKET_DELIVERY");
  const beginSource = sourceForCase(contentSource, "BEGIN_TICKET_DELIVERY", "ABORT_TICKET_DELIVERY");
  const abortSource = sourceForCase(contentSource, "ABORT_TICKET_DELIVERY", "SETTLE_TICKET_RESULT");
  const settleSource = sourceForCase(contentSource, "SETTLE_TICKET_RESULT");

  assert.match(resultsSource, /requireEmptyPayload\(request\.payload/);
  assert.match(beginSource, /requireExactPayloadKeys\(request\.payload, \["id"\]/);
  assert.match(beginSource, /id: requireString\(request\.payload\.id/);
  assert.match(abortSource, /requireExactPayloadKeys\(/);
  assert.match(abortSource, /id: requireString\(request\.payload\.id/);
  assert.match(abortSource, /effect: requireEnum\(request\.payload\.effect, \["WRITE"\]/);
  assert.match(abortSource, /automationRevision/);
  assert.match(settleSource, /request: decodeTicketSettlementRequest\(request\.payload\)/);
  assert.match(settleSource, /effect: requireEnum\(request\.payload\.effect, \["WRITE"\]/);
  assert.match(settleSource, /automationRevision/);

  assert.match(backgroundSource, /ticketBackground\.getTicketResults\(\)/);
  assert.match(backgroundSource, /ticketBackground\.beginDelivery\(message\.data\.id\)/);
  assert.match(backgroundSource, /ticketBackground\.abortDelivery\(/);
  assert.match(backgroundSource, /ticketBackground\.settleTicketResult\(/);
});

test("removed backend routes and legacy bridge vocabulary are absent", () => {
  const bridgeSource = `${typesSource}\n${contentSource}\n${backgroundSource}`;
  for (const removedPath of [
    "/api/xianyu",
    "/app/seatImageOcr",
    "/app/baojia"
  ]) {
    assert.doesNotMatch(bridgeSource, new RegExp(removedPath.replaceAll("/", "\\/")), removedPath);
  }
  assert.doesNotMatch(typesSource, /\bmap[A-Z][A-Za-z]+BackendRequest\b/);
  for (const removedAction of [
    "OCR_SEAT_IMAGE",
    "BAOJIA",
    "POLL_ORDER",
    "PENDING_DELIVERIES",
    "DELIVERY_RESULT",
    "CLAIM_DELIVERY",
    "REGISTER_WAITING_PAYMENT",
    "RESOLVE_WAITING_PAYMENT_CONTEXT",
    "REGISTER_WAITING_PAYMENT_SUMMARY",
    "RECORD_ADJUSTED",
    "RESOLVE_ACTIVE_ORDER",
    "VERIFY_PAID",
    "RECORD_VERIFICATION_FAILURE",
    "RECORD_PROTOCOL_EVENT",
    "AGISO_TRADE_LIST",
    "AGISO_ADJUST_PRICE",
    "AGISO_SEND_DUMMY",
    "RECORD_AGISO_FALLBACK"
  ]) {
    assert.doesNotMatch(bridgeSource, new RegExp(`\\b${removedAction}\\b`), removedAction);
  }
});
