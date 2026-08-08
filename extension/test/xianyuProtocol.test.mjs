import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import msgpack from "msgpack-lite";
import { decodeXianyuPayload } from "../src/webhook/xianyuProtocol.ts";
import { decodeSocketFrame } from "../src/webhook/protocolCapture.ts";

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/xianyu/${name}.json`, import.meta.url), "utf8"));
const clone = value => structuredClone(value);
const parseInner = payload => JSON.parse(payload["1"]["6"]["3"]["5"]);
const writeInner = (payload, value) => { payload["1"]["6"]["3"]["5"] = JSON.stringify(value); };
const parseExtJson = payload => JSON.parse(payload["1"]["10"].extJson);
const writeExtJson = (payload, value) => { payload["1"]["10"].extJson = JSON.stringify(value); };
const rejects = (value, label = "protocol violation") => assert.throws(() => decodeXianyuPayload(value), Error, label);

test("request-response frames with code are ignored, not mis-parsed as ACK", () => {
  // 客户端请求的响应帧:body 是消息实体(非 channel 握手结构)→ 必须忽略而非报错
  const messageResponse = {
    headers: { dt: "j", mid: "MESSAGE_001 0", sid: "SID_001" },
    code: 200,
    body: {
      extension: { _platform: "web", reminderContent: "你好" },
      receiverCount: 2,
      messageId: "4245085434294.PNM",
      unreadCount: 1,
      msgReadStatusSetting: 1,
      uuid: "-17860253748651",
      createAt: 1786025383685,
      content: { contentType: 101, custom: { type: 1 } },
      msgReadStatusDowngrade: 0
    }
  };
  assert.deepEqual(decodeXianyuPayload(messageResponse), { kind: "IGNORED_RESPONSE" });
  // 数组 body 的响应帧(会话列表)同样忽略
  const listResponse = { headers: { dt: "j" }, code: 200, body: [{ type: 1 }] };
  assert.deepEqual(decodeXianyuPayload(listResponse), { kind: "IGNORED_RESPONSE" });
});

test("ack frames still decode strictly", () => {
  assert.deepEqual(decodeXianyuPayload({ headers: { dt: "j", mid: "MESSAGE_001", sid: "CHAT_001" }, code: 200 }), { kind: "ACK" });
  assert.deepEqual(decodeXianyuPayload(fixture("ack")), { kind: "ACK" });
});

test("unconfirmed PNM variants degrade to ignored instead of failing", () => {
  // 已读状态帧(type=2 等未确认变体):PNM 业务不消费,降级忽略不报错
  const variant = { "1": "PNM_001.PNM", "2": 2, "3": 0, "4": "CHAT_001@goofish", "5": 1, "6": 1785326894840 };
  assert.deepEqual(decodeXianyuPayload(variant), { kind: "IGNORED_MESSAGE_STATUS" });
  // 已确认的标量变体仍正常解码
  assert.deepEqual(decodeXianyuPayload(fixture("pnm-status")), { kind: "PNM_STATUS", chatId: "CHAT_001", messageIds: ["PNM_001.PNM"] });
});

test("decodes a mobile (android) message variant with utdid/umid fields", () => {
  // 买家手机端发的消息：metadata 17 键（含 clientIp/port/umid/utdid/umidToken），
  // inner 带 atUsers，_platform=android —— 必须与 web 变体同样可解码。
  const event = decodeXianyuPayload(fixture("android-message"));
  assert.deepEqual(event, {
    kind: "TEXT_MESSAGE",
    chatId: "CHAT_001",
    messageId: "cacbbc111f84475786ac8141610ef890",
    senderId: "4118587726",
    itemId: "ITEM_001",
    text: "你好"
  });
});

test("decodes a real web-frame text message through the full capture pipeline", () => {
  const raw = readFileSync(new URL("./fixtures/xianyu/real-sync-frame.json", import.meta.url), "utf8");
  const frames = decodeSocketFrame(raw, (bytes) => msgpack.decode(bytes));
  assert.equal(frames.length, 1);
  assert.deepEqual(decodeXianyuPayload(frames[0].payload), {
    kind: "TEXT_MESSAGE",
    chatId: "64880747262",
    messageId: "0b8ad0f583cc4073af4acc88beded671",
    senderId: "2222709433085",
    itemId: "1068982735413",
    text: "你好"
  });
});

test("a real web-frame message without android-only fields is decodable", () => {
  // 真实 web 端 metadata 只有 12 个键，且 extJson 不含 utdid/umidToken：
  // 解码器不得再要求 android 专属字段。
  const payload = {
    "1": {
      "1": { "1": "2222709433085@goofish" },
      "2": "64880747262@goofish",
      "3": "4244965115143.PNM",
      "4": 0,
      "5": 1786020461039,
      "6": { "1": 101, "3": { "1": "", "2": "你好", "3": "", "4": 1, "5": "{\"contentType\":1,\"text\":{\"text\":\"你好\"}}" } },
      "7": 2, "8": 1, "9": 0,
      "10": {
        "_appVersion": "1.0", "_platform": "web",
        "bizTag": "{\"sourceId\":\"S:1\",\"messageId\":\"0b8ad0f583cc4073af4acc88beded671\"}",
        "detailNotice": "你好", "extJson": "{\"quickReply\":\"1\",\"messageId\":\"0b8ad0f583cc4073af4acc88beded671\",\"tag\":\"u\"}",
        "reminderContent": "你好", "reminderNotice": "发来一条新消息", "reminderTitle": "Hunter",
        "reminderUrl": "fleamarket://message_chat?itemId=1068982735413&peerUserId=2222709433085&sid=64880747262&messageId=0b8ad0f583cc4073af4acc88beded671&adv=no",
        "senderUserId": "2222709433085", "senderUserType": "0", "sessionType": "1"
      },
      "12": 1
    },
    "3": { "needPush": "true" }
  };
  assert.deepEqual(decodeXianyuPayload(payload), {
    kind: "TEXT_MESSAGE",
    chatId: "64880747262",
    messageId: "0b8ad0f583cc4073af4acc88beded671",
    senderId: "2222709433085",
    itemId: "1068982735413",
    text: "你好"
  });
});

test("decodes both confirmed ACK header variants", () => {
  assert.deepEqual(decodeXianyuPayload(fixture("ack")), { kind: "ACK" });
  assert.deepEqual(decodeXianyuPayload({ headers: { dt: "j", mid: "MESSAGE_001", sid: "CHAT_001" }, code: 200 }), { kind: "ACK" });
  assert.deepEqual(decodeXianyuPayload({
    body: {
      channel: "CHANNEL_001",
      highPts: 0,
      pipeline: "PIPELINE_001",
      pts: 1,
      seq: 1,
      timestamp: 1785326880501,
      tooLong2Tag: false,
      topic: "TOPIC_001"
    },
    headers: { mid: "MESSAGE_001", "server-timestamp": "1785326880501" },
    code: 200
  }), { kind: "ACK" });
});

test("decodes the true session signal rather than a PNM status", () => {
  assert.deepEqual(decodeXianyuPayload(fixture("session-signal")), { kind: "SESSION_SIGNAL", chatId: "CHAT_001" });
  const multiple = clone(fixture("session-signal")); multiple["1"].push(clone(multiple["1"][0])); rejects(multiple);
});

test("decodes complete ordinary image and text messages", () => {
  assert.deepEqual(decodeXianyuPayload(fixture("image-message")), {
    kind: "IMAGE_MESSAGE", chatId: "CHAT_001", messageId: "MESSAGE_001", senderId: "BUYER_001", itemId: "ITEM_001", customerName: "REDACTED_NICKNAME", imageUrl: "https://example.test/image-001.jpg"
  });
  const text = clone(fixture("image-message"));
  text["1"]["6"]["3"]["2"] = "你好呀";
  text["1"]["6"]["3"]["4"] = 1;
  writeInner(text, { contentType: 1, text: { text: "你好呀" } });
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

test("reference image recognition tolerates extra fields around the fixed image path", () => {
  const top = clone(fixture("image-message")); top.unexpected = true;
  const envelope = clone(fixture("image-message")); envelope["1"].unexpected = true;
  const metadata = clone(fixture("image-message")); metadata["1"]["10"].unexpected = true;
  const inner = clone(fixture("image-message")); const parsed = parseInner(inner); parsed.image.unexpected = true; writeInner(inner, parsed);
  for (const value of [top, envelope, metadata, inner]) {
    assert.equal(decodeXianyuPayload(value).kind, "IMAGE_MESSAGE");
  }
});

test("rejects missing required keys and wrong value types", () => {
  const missingEnvelope = clone(fixture("image-message")); delete missingEnvelope["1"]["12"];
  assert.equal(decodeXianyuPayload(missingEnvelope).kind, "IMAGE_MESSAGE");
  const missingCardMetadata = clone(fixture("waiting-payment-card")); delete missingCardMetadata["1"]["10"].updateHead; rejects(missingCardMetadata);
  const missingUpdate = clone(fixture("message-update")); const updateExt = JSON.parse(missingUpdate["4"].extJson); delete updateExt.multiChannel; missingUpdate["4"].extJson = JSON.stringify(updateExt); rejects(missingUpdate);
  const wrongBoolean = clone(fixture("paid-card")); wrongBoolean["1"]["10"].closeUnreadNumber = false; rejects(wrongBoolean);
  const wrongTimestamp = clone(fixture("order-context")); wrongTimestamp["4"] = "1785326880501"; rejects(wrongTimestamp);
  const wrongSessionArray = clone(fixture("session-signal")); wrongSessionArray["1"] = []; rejects(wrongSessionArray);
});

test("rejects conflicting IDs, status, content type, and update state", () => {
  const invalidAuthority = clone(fixture("image-message")); const invalidAuthorityExt = parseExtJson(invalidAuthority); invalidAuthorityExt.messageId = 1; writeExtJson(invalidAuthority, invalidAuthorityExt); assert.equal(decodeXianyuPayload(invalidAuthority).kind, "IMAGE_MESSAGE");
  const messageConflict = clone(fixture("image-message")); const ordinaryExt = parseExtJson(messageConflict); ordinaryExt.messageId = "MESSAGE_002"; writeExtJson(messageConflict, ordinaryExt); assert.equal(decodeXianyuPayload(messageConflict).kind, "IMAGE_MESSAGE");
  const peerConflict = clone(fixture("image-message")); peerConflict["1"]["10"].reminderUrl = peerConflict["1"]["10"].reminderUrl.replace("peerUserId=BUYER_001", "peerUserId=SELLER_001"); assert.equal(decodeXianyuPayload(peerConflict).kind, "IMAGE_MESSAGE");
  const orderConflict = clone(fixture("paid-card")); const paidInner = parseInner(orderConflict); paidInner.dxCard.item.main.exContent.button.targetUrl = "https://example.test/idle-delivery?orderId=ORDER_002"; writeInner(orderConflict, paidInner); rejects(orderConflict);
  const cardDisplayConflict = clone(fixture("waiting-payment-card")); cardDisplayConflict["1"]["6"]["3"]["2"] = "我已拍下，待付款"; rejects(cardDisplayConflict);
  const cardNestedUnknown = clone(fixture("paid-card")); const cardInner = parseInner(cardNestedUnknown); cardInner.dxCard.template.unexpected = true; writeInner(cardNestedUnknown, cardInner); rejects(cardNestedUnknown);
  const typeConflict = clone(fixture("image-message")); const imageInner = parseInner(typeConflict); delete imageInner.image; writeInner(typeConflict, imageInner); rejects(typeConflict);
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
  const reminderPath = clone(fixture("image-message")); reminderPath["1"]["10"].reminderUrl = reminderPath["1"]["10"].reminderUrl.replace("message_chat?", "message_chat/path?"); assert.equal(decodeXianyuPayload(reminderPath).kind, "IMAGE_MESSAGE");
  const reminderHash = clone(fixture("image-message")); reminderHash["1"]["10"].reminderUrl += "#fragment"; assert.equal(decodeXianyuPayload(reminderHash).kind, "IMAGE_MESSAGE");
  const reminderExtra = clone(fixture("image-message")); reminderExtra["1"]["10"].reminderUrl += "&extra=true"; assert.equal(decodeXianyuPayload(reminderExtra).kind, "IMAGE_MESSAGE");
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
