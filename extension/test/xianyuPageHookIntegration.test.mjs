import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/xianyuPageHook.ts", import.meta.url), "utf8");

test("page hook delegates socket payloads to the sole decoder and trade automation", () => {
  assert.match(source, /decodeXianyuPayload\(frame\.payload\)/);
  assert.match(source, /createXianyuTradeAutomation\(/);
  assert.match(source, /tradeAutomation\.handle\(event\)/);
});

test("page hook contains none of the removed trade guessing paths", () => {
  for (const forbidden of [
    "extractOrderId",
    "extractBizOrderId",
    "extractPaidAmount",
    "findNestedValue",
    "extractUrlsFromMessage",
    "collectNestedUrls",
    "LATEST_QUOTE",
    "ACTIVE_ORDER",
    "ORDER_PAID",
    "DUPLICATE_ORDER_BLOCKED",
    "ADJUST_PRICE_FAILED"
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`), forbidden);
  }
  assert.doesNotMatch(source, /includes\(["'](?:待付款|已付款|我已拍下|等待你发货|等待卖家发货)/);
});

test("page MTop integration uses only integer-cent protocol helpers", () => {
  assert.match(source, /data:\s*createAdjustPriceRequest\(amountCents, orderId\)/);
  assert.match(source, /decodeAdjustPriceResponse\(mtopResult\)/);
  assert.match(source, /api:\s*["']mtop\.idle\.web\.trade\.order\.detail["']/);
  assert.match(source, /data:\s*createOrderDetailRequest\(orderId\)/);
  assert.match(source, /decodeOrderDetailResponse\(mtopResult, orderId\)/);
  assert.doesNotMatch(source, /Math\.round\(amount\s*\*\s*100\)/);
});

test("trade routing is not disabled by the text and image auto-reply setting", () => {
  const handleStart = source.indexOf("async function handleSocketMessage");
  const handleEnd = source.indexOf("async function startDeliveryPoller", handleStart);
  const handleSource = source.slice(handleStart, handleEnd);
  assert.doesNotMatch(handleSource, /getAutomationConfig\(\)/);
  assert.match(handleSource, /tradeAutomation\.handle\(event\)/);
});

test("paid verification response immediately reconnects the order to delivery polling", () => {
  const verifyStart = source.indexOf("async function verifyPaid");
  const verifyEnd = source.indexOf("async function recordVerificationFailure", verifyStart);
  const verifySource = source.slice(verifyStart, verifyEnd);
  assert.match(verifySource, /classifyPaidVerificationResult\(/);
  assert.match(verifySource, /case "ACTIVE"/);
  assert.match(verifySource, /activeOrders\.set\(result\.order\.platformOrderId/);
  assert.match(verifySource, /case "NEED_MANUAL"/);
  assert.match(verifySource, /case "TERMINAL"/);
  assert.doesNotMatch(verifySource, /lastError|orderPlaceholders/);
});

test("delivery uses the authoritative platform order id without legacy tradeNo fallback", () => {
  assert.match(source, /consignDummy\(order\.platformOrderId\)/);
  assert.match(source, /decodeDeliveryPollResult\([\s\S]*?order\.platformOrderId/);
  assert.match(source, /decodeClaimDeliveryResult\([\s\S]*?order\.platformOrderId/);
  assert.doesNotMatch(source, /\btradeNo\b/);
});

test("delivery completion delegates partial-failure handling and strict result parsing", () => {
  const pollStart = source.indexOf("async function pollAndDeliver");
  const pollEnd = source.indexOf("async function sendText", pollStart);
  const pollSource = source.slice(pollStart, pollEnd);
  assert.match(pollSource, /completeClaimedDeliveryAttempt\(\s*order\.platformOrderId,\s*deliveryPayload\.deliveryAttemptId/);
  assert.match(pollSource, /attemptId/);
  assert.match(pollSource, /recordDeliveryResult:/);
  assert.match(pollSource, /removeActive:/);
  assert.doesNotMatch(pollSource, /error\.message|String\(error\)|rawPayload/);
});

test("persisted attempt removes the active order before any external delivery effect", () => {
  const pollStart = source.indexOf("async function pollAndDeliver");
  const pollEnd = source.indexOf("async function sendText", pollStart);
  const pollSource = source.slice(pollStart, pollEnd);
  const completionIndex = pollSource.indexOf("completeClaimedDeliveryAttempt");
  const completionSource = pollSource.slice(completionIndex);
  assert.ok(completionSource.indexOf("removeActive:") < completionSource.indexOf("sendTemplate:"));
  assert.match(completionSource, /platformOrderId:[\s\S]*?attemptId,[\s\S]*?success/);
});

test("pending recovery uses the dedicated classifier before mutating active orders", () => {
  const recoverStart = source.indexOf("async function recoverPendingDeliveries");
  const recoverEnd = source.indexOf("async function pollAndDeliver", recoverStart);
  const recoverSource = source.slice(recoverStart, recoverEnd);
  assert.match(recoverSource, /decodePendingRecoveryOrders\(/);
  assert.doesNotMatch(recoverSource, /decodeXianyuOrderPayload\(/);
});

test("unavailable MTop order-detail request is classified with a preserved cause", () => {
  const detailStart = source.indexOf("async function fetchOrderDetail");
  const detailEnd = source.indexOf("async function consignDummy", detailStart);
  const detailSource = source.slice(detailStart, detailEnd);
  assert.match(detailSource, /XianyuOrderDetailRequestError\("order detail request unavailable",\s*\{ cause/);
});
