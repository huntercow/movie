import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { decodeXianyuPayload } from "../src/xianyuProtocol.ts";

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/xianyu/${name}.json`, import.meta.url), "utf8"));
const clone = value => structuredClone(value);
const parseInner = payload => JSON.parse(payload["1"]["6"]["3"]["5"]);
const writeInner = (payload, value) => { payload["1"]["6"]["3"]["5"] = JSON.stringify(value); };
const parseExtJson = payload => JSON.parse(payload["1"]["10"].extJson);
const writeExtJson = (payload, value) => { payload["1"]["10"].extJson = JSON.stringify(value); };
const rejects = (value, label = "protocol violation") => assert.throws(() => decodeXianyuPayload(value), Error, label);

test("decodes both confirmed ACK header variants", () => {
  assert.deepEqual(decodeXianyuPayload(fixture("ack")), { kind: "ACK" });
  assert.deepEqual(decodeXianyuPayload({ headers: { dt: "j", mid: "MESSAGE_001", sid: "CHAT_001" }, code: 200 }), { kind: "ACK" });
});

test("decodes the true session signal rather than a PNM status", () => {
  assert.deepEqual(decodeXianyuPayload(fixture("session-signal")), { kind: "SESSION_SIGNAL", chatId: "CHAT_001" });
  const multiple = clone(fixture("session-signal")); multiple["1"].push(clone(multiple["1"][0])); rejects(multiple);
});

test("decodes complete ordinary image and text messages", () => {
  assert.deepEqual(decodeXianyuPayload(fixture("image-message")), {
    kind: "IMAGE_MESSAGE", chatId: "CHAT_001", messageId: "MESSAGE_001", senderId: "BUYER_001", itemId: "ITEM_001", imageUrl: "https://example.test/image-001.jpg"
  });
  const text = clone(fixture("image-message"));
  text["1"]["6"]["3"]["2"] = "你好呀";
  text["1"]["6"]["3"]["4"] = 1;
  writeInner(text, { atUsers: [], contentType: 1, text: { text: "你好呀" } });
  text["1"]["10"].detailNotice = "你好呀";
  text["1"]["10"].reminderContent = "你好呀";
  assert.deepEqual(decodeXianyuPayload(text), {
    kind: "TEXT_MESSAGE", chatId: "CHAT_001", messageId: "MESSAGE_001", senderId: "BUYER_001", itemId: "ITEM_001", text: "你好呀"
  });
});

test("decodes full order context and all PNM variants", () => {
  assert.deepEqual(decodeXianyuPayload(fixture("order-context")), {
    kind: "ORDER_CONTEXT", chatId: "CHAT_001", orderId: "ORDER_001", itemId: "ITEM_001", buyerUserId: "BUYER_001"
  });
  assert.deepEqual(decodeXianyuPayload(fixture("pnm-status")), { kind: "PNM_STATUS", chatId: "CHAT_001", messageIds: ["PNM_001.PNM"] });
  assert.deepEqual(decodeXianyuPayload({ "1": "PNM_001.PNM", "2": 1, "3": 0, "4": "CHAT_001@goofish", "5": 1, "6": 1785326894840 }), { kind: "PNM_STATUS", chatId: "CHAT_001", messageIds: ["PNM_001.PNM"] });
  assert.deepEqual(decodeXianyuPayload({ "1": "CHAT_001@goofish", "2": 1, "3": "PNM_001.PNM", "4": 1785326894840 }), { kind: "PNM_STATUS", chatId: "CHAT_001", messageIds: ["PNM_001.PNM"] });
});

test("decodes complete waiting and both paid trade card variants", () => {
  const expected = (kind) => ({ kind, chatId: "CHAT_001", messageId: "MESSAGE_001", senderId: "BUYER_001", itemId: "ITEM_001", orderId: "ORDER_001" });
  assert.deepEqual(decodeXianyuPayload(fixture("waiting-payment-card")), expected("WAITING_PAYMENT_CARD"));
  assert.deepEqual(decodeXianyuPayload(fixture("paid-card")), expected("PAID_CARD"));
  assert.deepEqual(decodeXianyuPayload(fixture("paid-card-no-postage")), expected("PAID_CARD"));
});

test("decodes paid and known waiting-payment summaries without inventing an order id", () => {
  assert.deepEqual(decodeXianyuPayload(fixture("payment-summary")), { kind: "PAYMENT_SUMMARY", chatId: "CHAT_001", redReminder: "等待卖家发货" });
  const waiting = clone(fixture("payment-summary"));
  waiting["3"].redReminder = "等待买家付款";
  assert.deepEqual(decodeXianyuPayload(waiting), { kind: "WAITING_PAYMENT_SUMMARY", chatId: "CHAT_001", redReminder: "等待买家付款" });
});

test("decodes complete message update as an ignored event", () => {
  assert.deepEqual(decodeXianyuPayload(fixture("message-update")), {
    kind: "MESSAGE_UPDATE", chatId: "CHAT_001", messageId: "MESSAGE_001", orderId: "ORDER_001", updateType: "TRADE_MODIFY_FEE_BUYER"
  });
});

test("decodes a complete MsgTips frame only as an explicit ignored tip", () => {
  const result = decodeXianyuPayload(fixture("tip-message"));
  assert.deepEqual(result, { kind: "IGNORED_TIP_MESSAGE", chatId: "CHAT_001", messageId: "MESSAGE_001" });
  assert.notEqual(result.kind, "SESSION_SIGNAL");
});

test("rejects unknown top-level, envelope, metadata, and inner JSON keys", () => {
  const top = clone(fixture("image-message")); top.unexpected = true; rejects(top);
  const envelope = clone(fixture("image-message")); envelope["1"].unexpected = true; rejects(envelope);
  const metadata = clone(fixture("image-message")); metadata["1"]["10"].unexpected = true; rejects(metadata);
  const inner = clone(fixture("image-message")); const parsed = parseInner(inner); parsed.image.unexpected = true; writeInner(inner, parsed); rejects(inner);
});

test("rejects missing required keys and wrong value types", () => {
  const missingEnvelope = clone(fixture("image-message")); delete missingEnvelope["1"]["12"]; rejects(missingEnvelope);
  const missingCardMetadata = clone(fixture("waiting-payment-card")); delete missingCardMetadata["1"]["10"].updateHead; rejects(missingCardMetadata);
  const missingUpdate = clone(fixture("message-update")); const updateExt = JSON.parse(missingUpdate["4"].extJson); delete updateExt.multiChannel; missingUpdate["4"].extJson = JSON.stringify(updateExt); rejects(missingUpdate);
  const wrongBoolean = clone(fixture("paid-card")); wrongBoolean["1"]["10"].closeUnreadNumber = false; rejects(wrongBoolean);
  const wrongTimestamp = clone(fixture("order-context")); wrongTimestamp["4"] = "1785326880501"; rejects(wrongTimestamp);
  const wrongSessionArray = clone(fixture("session-signal")); wrongSessionArray["1"] = []; rejects(wrongSessionArray);
});

test("rejects conflicting IDs, status, content type, and update state", () => {
  const invalidAuthority = clone(fixture("image-message")); const invalidAuthorityExt = parseExtJson(invalidAuthority); invalidAuthorityExt.messageId = 1; writeExtJson(invalidAuthority, invalidAuthorityExt); assert.throws(() => decodeXianyuPayload(invalidAuthority), /ordinary extJson\.messageId/);
  const messageConflict = clone(fixture("image-message")); const ordinaryExt = parseExtJson(messageConflict); ordinaryExt.messageId = "MESSAGE_002"; writeExtJson(messageConflict, ordinaryExt); rejects(messageConflict);
  const peerConflict = clone(fixture("image-message")); peerConflict["1"]["10"].reminderUrl = peerConflict["1"]["10"].reminderUrl.replace("peerUserId=BUYER_001", "peerUserId=SELLER_001"); rejects(peerConflict);
  const orderConflict = clone(fixture("paid-card")); const paidInner = parseInner(orderConflict); paidInner.dxCard.item.main.exContent.button.targetUrl = "https://example.test/idle-delivery?orderId=ORDER_002"; writeInner(orderConflict, paidInner); rejects(orderConflict);
  const cardDisplayConflict = clone(fixture("waiting-payment-card")); cardDisplayConflict["1"]["6"]["3"]["2"] = "我已拍下，待付款"; rejects(cardDisplayConflict);
  const cardNestedUnknown = clone(fixture("paid-card")); const cardInner = parseInner(cardNestedUnknown); cardInner.dxCard.template.unexpected = true; writeInner(cardNestedUnknown, cardInner); rejects(cardNestedUnknown);
  const typeConflict = clone(fixture("image-message")); const imageInner = parseInner(typeConflict); imageInner.contentType = 1; writeInner(typeConflict, imageInner); rejects(typeConflict);
  const reminderConflict = clone(fixture("waiting-payment-card")); reminderConflict["1"]["10"].redReminder = "等待卖家发货"; rejects(reminderConflict);
  const updateConflict = clone(fixture("message-update")); const updateExt = JSON.parse(updateConflict["4"].extJson); updateExt.updateKey = "CHAT_001:ORDER_001:2:TRADE_PAID_DONE_SELLER:26"; updateConflict["4"].extJson = JSON.stringify(updateExt); rejects(updateConflict);
  const updateTaskConflict = clone(fixture("message-update")); const updateTask = JSON.parse(updateTaskConflict["4"].extJson); updateTask.msgArgs.task_id = "TASK_002"; updateTaskConflict["4"].extJson = JSON.stringify(updateTask); rejects(updateTaskConflict);
});

test("rejects trade-card button URL paths, fragments, query keys, and literals outside the confirmed variants", () => {
  const waitingExtra = clone(fixture("waiting-payment-card")); const waitingExtraInner = parseInner(waitingExtra); waitingExtraInner.dxCard.item.main.exContent.button.targetUrl = "fleamarket://adjust_price?flutter=true&bizOrderId=ORDER_001&extra=true"; writeInner(waitingExtra, waitingExtraInner); rejects(waitingExtra);
  const waitingMissing = clone(fixture("waiting-payment-card")); const waitingMissingInner = parseInner(waitingMissing); waitingMissingInner.dxCard.item.main.exContent.button.targetUrl = "fleamarket://adjust_price?bizOrderId=ORDER_001"; writeInner(waitingMissing, waitingMissingInner); rejects(waitingMissing);
  const waitingPath = clone(fixture("waiting-payment-card")); const waitingPathInner = parseInner(waitingPath); waitingPathInner.dxCard.item.main.exContent.button.targetUrl = "fleamarket://wrong?flutter=true&bizOrderId=ORDER_001"; writeInner(waitingPath, waitingPathInner); rejects(waitingPath);
  const waitingUnconfirmedPath = clone(fixture("waiting-payment-card")); const waitingUnconfirmedPathInner = parseInner(waitingUnconfirmedPath); waitingUnconfirmedPathInner.dxCard.item.main.exContent.button.targetUrl = "fleamarket://adjust_price/unconfirmed?flutter=true&bizOrderId=ORDER_001"; writeInner(waitingUnconfirmedPath, waitingUnconfirmedPathInner); rejects(waitingUnconfirmedPath);
  const waitingHash = clone(fixture("waiting-payment-card")); const waitingHashInner = parseInner(waitingHash); waitingHashInner.dxCard.item.main.exContent.button.targetUrl += "#fragment"; writeInner(waitingHash, waitingHashInner); rejects(waitingHash);
  const paidLiteral = clone(fixture("paid-card")); const paidLiteralInner = parseInner(paidLiteral); paidLiteralInner.dxCard.item.main.exContent.button.targetUrl = "https://example.test/wow/moyu/moyu-project/idle-logistics/pages/idleDeliver?kun=true&titleVisible=false&useCusFont=true&orderId=ORDER_001"; writeInner(paidLiteral, paidLiteralInner); rejects(paidLiteral);
  const paidPath = clone(fixture("paid-card")); const paidPathInner = parseInner(paidPath); paidPathInner.dxCard.item.main.exContent.button.targetUrl = "https://example.test/wrong?kun=true&titleVisible=false&useCusFont=true&orderId=ORDER_001"; writeInner(paidPath, paidPathInner); rejects(paidPath);
  const paidHash = clone(fixture("paid-card")); const paidHashInner = parseInner(paidHash); paidHashInner.dxCard.item.main.exContent.button.targetUrl += "#fragment"; writeInner(paidHash, paidHashInner); rejects(paidHash);
  const noPostageMissing = clone(fixture("paid-card-no-postage")); const noPostageInner = parseInner(noPostageMissing); noPostageInner.dxCard.item.main.exContent.button.targetUrl = "https://example.test/wow/moyu/moyu-project/idle-logistics/pages/noPostageRequired?kun=true&orderId=ORDER_001"; writeInner(noPostageMissing, noPostageInner); rejects(noPostageMissing);
  const noPostageHash = clone(fixture("paid-card-no-postage")); const noPostageHashInner = parseInner(noPostageHash); noPostageHashInner.dxCard.item.main.exContent.button.targetUrl += "#fragment"; writeInner(noPostageHash, noPostageHashInner); rejects(noPostageHash);
});

test("rejects main, reminder, and MsgTips URLs outside their exact confirmed structure", () => {
  const mainHost = clone(fixture("paid-card")); const mainHostInner = parseInner(mainHost); mainHostInner.dxCard.item.main.targetUrl = "fleamarket://wrong?id=ORDER_001&role=Seller"; writeInner(mainHost, mainHostInner); rejects(mainHost);
  const mainHash = clone(fixture("paid-card")); const mainHashInner = parseInner(mainHash); mainHashInner.dxCard.item.main.targetUrl += "#fragment"; writeInner(mainHash, mainHashInner); rejects(mainHash);
  const mainExtra = clone(fixture("paid-card")); const mainExtraInner = parseInner(mainExtra); mainExtraInner.dxCard.item.main.targetUrl += "&extra=true"; writeInner(mainExtra, mainExtraInner); rejects(mainExtra);
  const reminderPath = clone(fixture("image-message")); reminderPath["1"]["10"].reminderUrl = reminderPath["1"]["10"].reminderUrl.replace("message_chat?", "message_chat/path?"); rejects(reminderPath);
  const reminderHash = clone(fixture("image-message")); reminderHash["1"]["10"].reminderUrl += "#fragment"; rejects(reminderHash);
  const reminderExtra = clone(fixture("image-message")); reminderExtra["1"]["10"].reminderUrl += "&extra=true"; rejects(reminderExtra);
  const tipPath = clone(fixture("tip-message")); const tipPathInner = parseInner(tipPath); tipPathInner.tip.action.page.url = tipPathInner.tip.action.page.url.replace("item?", "item/path?"); writeInner(tipPath, tipPathInner); rejects(tipPath);
  const tipHash = clone(fixture("tip-message")); const tipHashInner = parseInner(tipHash); tipHashInner.tip.action.page.url += "#fragment"; writeInner(tipHash, tipHashInner); rejects(tipHash);
  const tipExtra = clone(fixture("tip-message")); const tipExtraInner = parseInner(tipExtra); tipExtraInner.tip.action.page.url += "&extra=true"; writeInner(tipExtra, tipExtraInner); rejects(tipExtra);
});

test("fixtures retain required protocol fields while containing no sensitive values", () => {
  const names = readdirSync(new URL("./fixtures/xianyu/", import.meta.url)).filter(name => name.endsWith(".json"));
  for (const name of names) {
    const content = readFileSync(new URL(`./fixtures/xianyu/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(content, /(?:\b(?:\d{1,3}\.){3}\d{1,3}\b|alicdn|taobaocdn|tbcdn|mmstat|token_[a-z0-9])/i, name);
  }
  assert.deepEqual(Object.keys(fixture("image-message")["1"]).sort(), ["1", "10", "12", "2", "3", "4", "5", "6", "7", "8", "9"]);
  assert.ok(Object.hasOwn(fixture("order-context")["3"], "itemFeatures"));
  assert.ok(Object.hasOwn(fixture("message-update")["4"], "closePushReceiver"));
});
