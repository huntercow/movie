/**
 * 闲鱼 IM WebSocket 入站消息协议解码器。
 *
 * 把闲鱼 WebSocket 推送的 msgpack 帧解码为领域事件（XianyuInboundEvent）。
 * 每个帧形状都有严格校验：只接受已确认的字段组合，多一个字段、少一个字段、
 * 字段值不匹配都会抛错，绝不猜测式解析。参考插件有真实样本支撑的兼容路径
 * （选座截图消息）保留在严格解码之前。
 */

/**
 * 解码后的闲鱼入站事件（领域事件联合）。
 * 业务自动化只消费这些事件，不直接接触原始帧结构。
 *
 * kind 分组与消费方（详见 webhook/xianyuPageHook.ts 的 handleSocketMessage switch）：
 *  - no-op 组（isExplicitNoOp 直接丢弃，不触发业务）：
 *    ACK / SESSION_SIGNAL / PNM_STATUS / ORDER_CONTEXT / IGNORED_TIP_MESSAGE
 *  - 客户消息组（触发自动回复/报价）：TEXT_MESSAGE / IMAGE_MESSAGE
 *  - 支付状态卡组（触发查单/改价/出票校验）：WAITING_PAYMENT_CARD /
 *    WAITING_PAYMENT_SUMMARY / PAID_CARD / PAYMENT_SUMMARY
 *  - 其余：MESSAGE_UPDATE（当前显式忽略，保留解码以便观察协议演进）
 */
export type XianyuInboundEvent =
  // 建连回执：校验 code=200 与两种已确认的 headers 变体（见 decodeAck）。
  | { kind: "ACK" }
  // 单会话上下线信号：type=1，state ∈ {0,1}（见 decodeSessionSignal）。
  | { kind: "SESSION_SIGNAL"; chatId: string }
  // 消息状态标记：携带 .PNM 结尾的消息 id 列表，用于去重/已读判定。
  | { kind: "PNM_STATUS"; chatId: string; messageIds: string[] }
  // 订单上下文：pageHook 用它记录「chatId → 买家 userId」映射，供后续发话术兜底。
  | { kind: "ORDER_CONTEXT"; chatId: string; orderId: string; itemId: string; buyerUserId: string }
  // 客户文字消息 → handleTextMessage：关键词规则或 AI 客服自动回复。
  | { kind: "TEXT_MESSAGE"; chatId: string; messageId: string; senderId: string; itemId: string; text: string }
  // 客户选座截图 → handleImageMessage：异步报价工作流。
  | { kind: "IMAGE_MESSAGE"; chatId: string; messageId: string; senderId: string; itemId: string; customerName: string; imageUrl: string }
  // 「我已拍下，待付款」卡片 → 查待付款单 / 报价不一致自动改价 / 催付。
  | { kind: "WAITING_PAYMENT_CARD"; chatId: string; messageId: string; senderId: string; itemId: string; orderId: string }
  // 「我已付款，等待你发货」卡片 → 查单校验 / 推进出票 / 付款成功话术。
  | { kind: "PAID_CARD"; chatId: string; messageId: string; senderId: string; itemId: string; orderId: string }
  // 已付款系统摘要（redReminder=等待卖家发货）→ 与 PAID_CARD 同路处理。
  | { kind: "PAYMENT_SUMMARY"; chatId: string; redReminder: "等待卖家发货" }
  // 待付款系统摘要（redReminder=等待买家付款）→ 与 WAITING_PAYMENT_CARD 同路处理。
  | { kind: "WAITING_PAYMENT_SUMMARY"; chatId: string; redReminder: "等待买家付款" }
  // 改价更新通知（updateKey 形如 chatId:orderId:2:TRADE_MODIFY_FEE_BUYER:26），当前 switch 显式忽略。
  | { kind: "MESSAGE_UPDATE"; chatId: string; messageId: string; orderId: string; updateType: "TRADE_MODIFY_FEE_BUYER" }
  // 提示消息（如「对方拍下」引导，decodeTip），业务暂不消费。
  | { kind: "IGNORED_TIP_MESSAGE"; chatId: string; messageId: string }
  // 客户端请求的响应帧（body 为消息实体/会话数据，非业务推送），解码后忽略。
  | { kind: "IGNORED_RESPONSE" }
  // 已读状态帧（PNM）出现未确认变体：PNM 业务不消费，降级为忽略避免误报。
  | { kind: "IGNORED_MESSAGE_STATUS" };

/** 原始帧中的通用字段类型。 */
type RecordValue = Record<string, unknown>;
/** 消息公共标识：会话、消息、发送者与商品。 */
type Identity = { chatId: string; messageId: string; senderId: string; itemId: string };
/** 普通消息标识 + 买家昵称（来自 reminderTitle）。 */
type OrdinaryIdentity = Identity & { customerName: string };
/** 卡片消息公共元数据：标识 + 任务 ID + 扩展 JSON。 */
type CommonMetadata = Identity & { taskId: string; extJson: RecordValue };

/** 普通消息元数据的必填键集合（web/android 两变体共有的字段）。 */
const ordinaryMetadataKeys = [
  "_appVersion", "_platform", "bizTag", "detailNotice", "extJson",
  "reminderContent", "reminderNotice", "reminderTitle", "reminderUrl", "senderUserId",
  "senderUserType", "sessionType"
];
/** 普通消息元数据的可选键集合（仅移动端变体存在，web 端缺失不要求）。 */
const ordinaryMetadataOptionalKeys = ["clientIp", "port", "umid", "umidToken", "utdid"];
/** 卡片消息元数据的基础键集合。 */
const cardMetadataBase = [
  "bizTag", "closePushReceiver", "closeUnreadNumber", "detailNotice", "extJson", "receiver",
  "redReminder", "redReminderStyle", "reminderContent", "reminderNotice", "reminderTitle",
  "reminderUrl", "senderUserId", "senderUserType", "sessionType", "updateHead"
];
/** 提示消息元数据键集合。 */
const tipMetadataKeys = [
  "bizTag", "closePushReceiver", "closeUnreadNumber", "detailNotice", "extJson", "receiver",
  "reminderContent", "reminderNotice", "reminderTitle", "reminderUrl", "senderUserId",
  "senderUserType", "sessionType", "updateHead"
];
/** 多通道推送配置键集合。 */
const multiChannelKeys = ["huawei", "xiaomi", "oppo_notify_level", "honor", "agoo", "oppo_category", "vivo"];
/** bizTag 任务标签键集合。 */
const taskTagKeys = ["sourceId", "taskName", "materialId", "taskId"];

/**
 * 解码一条闲鱼 WebSocket 入站消息：按帧形状依次尝试各分支，
 * 无法识别时抛错。业务调用方从这里拿到领域事件。
 *
 * 判定顺序即优先级，各谓词互斥（同一帧不会命中两个分支）：
 *  1. 含 code 字段 → ACK 回执（帧最薄，最先试）；
 *  2. 仅含单个数组键 "1" → 会话信号（字段最少，第二试）；
 *  3. 参考插件兼容路径（[图片] 标记的旧版截图消息）→ 放在严格解码之前，
 *     因为它的形状不满足任何严格分支；
 *  4. 标准消息（needPush 推送标志）→ 按 contentType 再分文字/图片/交易卡/提示；
 *  5. 消息更新（extJson 元数据）→ 改价通知；
 *  6. PNM / 订单上下文 / 付款摘要（各按特有字段判定）。
 * 任何分支校验失败都直接抛错——宁可中断也不猜测，闲鱼协议一旦变化
 * 会立即暴露而不是被静默吞掉。
 */
export function decodeXianyuPayload(value: unknown): XianyuInboundEvent {
  const payload = requireRecord(value, "xianyu payload");

  if (Object.hasOwn(payload, "code")) {
    return decodeAckOrIgnore(payload);
  }
  if (Object.keys(payload).length === 1 && Array.isArray(payload["1"])) {
    return decodeSessionSignal(payload);
  }
  const referenceImage = decodeReferenceImageMessage(payload);
  if (referenceImage) {
    return referenceImage;
  }
  if (isStandard(payload)) {
    return decodeStandard(payload);
  }
  if (isMessageUpdate(payload)) {
    return decodeMessageUpdate(payload);
  }
  if (isPnm(payload)) {
    try {
      return decodePnm(payload);
    } catch {
      // PNM 仅携带已读状态（no-op，业务不消费）：出现未确认变体时降级为
      // 忽略而不是报错，避免已读回执刷错误噪音（如 type 标量取值演进）。
      return { kind: "IGNORED_MESSAGE_STATUS" };
    }
  }
  if (isOrderContext(payload)) {
    return decodeOrderContext(payload);
  }
  if (isSummary(payload)) {
    return decodeSummary(payload);
  }
  throw new Error("unknown xianyu payload shape");
}

/**
 * 参考插件兼容路径：普通选座截图消息以可见的 [图片] 标记识别，
 * 图片 JSON 从参考插件固定的旧路径读取；保留在严格解码之前。
 */
function decodeReferenceImageMessage(payload: RecordValue): XianyuInboundEvent | null {
  const envelope = requireRecordOrNull(payload["1"]);
  if (!envelope) {
    return null;
  }
  const content = requireRecordOrNull(envelope["6"]);
  const custom = content && requireRecordOrNull(content["3"]);
  if (!custom || custom["2"] !== "[图片]") {
    return null;
  }

  const sender = requireRecord(envelope["1"], "reference image sender");
  const chatId = chat(envelope["2"], "reference image chat");
  const metadata = requireRecord(envelope["10"], "reference image metadata");
  const reminder = referenceReminderUrl(metadata.reminderUrl);
  const inner = jsonRecord(custom["5"], "reference image inner");
  const image = requireRecord(inner.image, "reference image body");
  const pics = requireArray(image.pics, "reference image pics");
  if (pics.length === 0) {
    throw new Error("reference image pics cannot be empty");
  }
  const firstPic = requireRecord(pics[0], "reference image pic");

  return {
    kind: "IMAGE_MESSAGE",
    chatId,
    messageId: reminder.messageId,
    senderId: bareGoofish(sender["1"], "reference image sender"),
    itemId: reminder.itemId,
    customerName: nonEmpty(metadata.reminderTitle, "reference image reminderTitle"),
    imageUrl: httpUrl(firstPic.url, "reference image URL")
  };
}

/** 值非对象时返回 null（用于可选的嵌套结构）。 */
function requireRecordOrNull(value: unknown): RecordValue | null {
  return isRecord(value) ? value : null;
}

/** 从参考图片消息的 reminderUrl 提取 itemId 与 messageId。 */
function referenceReminderUrl(value: unknown): { itemId: string; messageId: string } {
  const parsed = url(value, "reference image reminderUrl");
  return {
    itemId: id(parsed.searchParams.get("itemId"), "reference image reminderUrl itemId"),
    messageId: id(parsed.searchParams.get("messageId"), "reference image reminderUrl messageId")
  };
}

/**
 * 分发带 code 的帧：只有已确认的 ACK 形状才严格解码，其余均为
 * 客户端请求的响应帧（body 为消息实体/会话数据等，非业务推送），
 * 业务无关，返回 IGNORED_RESPONSE 静默忽略。
 */
function decodeAckOrIgnore(payload: RecordValue): XianyuInboundEvent {
  const keys = Object.keys(payload).sort().join(",");
  if (keys === "body,code,headers") {
    if (typeof payload.body !== "object" || payload.body === null || Array.isArray(payload.body)) {
      return { kind: "IGNORED_RESPONSE" };
    }
    const body = payload.body as Record<string, unknown>;
    // channel 握手 ACK 的 body 含 channel 键；其余响应帧 body 是消息/会话数据
    if (Object.hasOwn(body, "channel")) {
      return decodeAck(payload);
    }
    return { kind: "IGNORED_RESPONSE" };
  }
  if (keys === "code,headers") {
    return decodeAck(payload);
  }
  return { kind: "IGNORED_RESPONSE" };
}

/** 解码连接 ACK 帧：校验 code 200 与已确认的 headers 变体。 */
function decodeAck(payload: RecordValue): XianyuInboundEvent {
  literal(payload.code, 200, "ACK code");
  const headers = requireRecord(payload.headers, "ACK headers");
  const payloadKeys = Object.keys(payload).sort().join(",");

  // 变体一：channel 握手 ACK（含 body）
  if (payloadKeys === "body,code,headers") {
    const body = requireRecord(payload.body, "channel ACK body");
    exactKeys(
      body,
      ["channel", "highPts", "pipeline", "pts", "seq", "timestamp", "tooLong2Tag", "topic"],
      "channel ACK body"
    );
    validateAckHeaders(headers);
    return { kind: "ACK" };
  }

  // 变体二：仅 headers + code
  exactKeys(payload, ["headers", "code"], "ACK");
  validateAckHeaders(headers);
  return { kind: "ACK" };
}

/** 校验 ACK 头：只接受两种已确认的键组合。 */
function validateAckHeaders(headers: RecordValue): void {
  const keys = Object.keys(headers).sort().join(",");
  if (keys === "mid,server-timestamp") {
    nonEmpty(headers.mid, "ACK headers.mid");
    nonEmpty(headers["server-timestamp"], "ACK headers.server-timestamp");
  } else if (keys === "dt,mid,sid") {
    literal(headers.dt, "j", "delivery ACK headers.dt");
    nonEmpty(headers.mid, "delivery ACK headers.mid");
    nonEmpty(headers.sid, "delivery ACK headers.sid");
  } else {
    throw new Error("ACK headers are not a confirmed variant");
  }
}

/** 解码会话信号帧：单个会话的上下线状态。 */
function decodeSessionSignal(payload: RecordValue): XianyuInboundEvent {
  exactKeys(payload, ["1"], "session signal");
  const entries = requireArray(payload["1"], "session signal entries");
  if (entries.length !== 1) {
    throw new Error("session signal entries must contain exactly one entry");
  }
  const signal = requireRecord(entries[0], "session signal entry");
  exactKeys(signal, ["1", "2", "3", "4"], "session signal entry");

  const chatId = chat(signal["1"], "session signal chatId");
  literal(signal["2"], 1, "session signal type");
  integerEnum(signal["3"], [0, 1], "session signal state");
  goofishId(signal["4"], "session signal seller");
  return { kind: "SESSION_SIGNAL", chatId };
}

/** 解码 PNM 帧（消息状态标记）：支持数组/标量/会话三种已确认变体。 */
function decodePnm(payload: RecordValue): XianyuInboundEvent {
  // 变体一：数组（多条消息已读）
  if (Array.isArray(payload["1"])) {
    exactKeys(payload, ["1", "2", "3", "4", "5"], "PNM array frame");
    literal(payload["2"], 2, "PNM array type");
    const messageIds = requireArray(payload["1"], "PNM array ids")
      .map((messageId, index) => pnm(messageId, `PNM array ids[${index}]`));
    if (messageIds.length === 0) {
      throw new Error("PNM array ids cannot be empty");
    }
    literal(payload["4"], 1, "PNM array state");
    timestamp(payload["5"], "PNM array timestamp");
    return { kind: "PNM_STATUS", chatId: chat(payload["3"], "PNM array chat"), messageIds };
  }

  // 变体二：标量（单条消息已读）
  if (typeof payload["4"] === "string") {
    exactKeys(payload, ["1", "2", "3", "4", "5", "6"], "PNM scalar frame");
    literal(payload["2"], 1, "PNM scalar type");
    literal(payload["3"], 0, "PNM scalar state");
    literal(payload["5"], 1, "PNM scalar flag");
    timestamp(payload["6"], "PNM scalar timestamp");
    return {
      kind: "PNM_STATUS",
      chatId: chat(payload["4"], "PNM scalar chat"),
      messageIds: [pnm(payload["1"], "PNM scalar id")]
    };
  }

  // 变体三：会话（单会话单消息）
  exactKeys(payload, ["1", "2", "3", "4"], "PNM session frame");
  literal(payload["2"], 1, "PNM session type");
  timestamp(payload["4"], "PNM session timestamp");
  return {
    kind: "PNM_STATUS",
    chatId: chat(payload["1"], "PNM session chat"),
    messageIds: [pnm(payload["3"], "PNM session id")]
  };
}

/** 解码订单上下文帧：包含订单号、商品与买卖双方信息。 */
function decodeOrderContext(payload: RecordValue): XianyuInboundEvent {
  exactKeys(payload, ["1", "2", "3", "4"], "order context");
  literal(payload["2"], 1, "order context type");
  timestamp(payload["4"], "order context timestamp");

  const details = requireRecord(payload["3"], "order context details");
  const buyerUserId = id(details.extUserId, "order context buyer");
  const sellerUserId = id(details.itemSellerId, "order context seller");
  exactKeys(
    details,
    [
      "extUserId", "extUserType", "itemFeatures", "itemId", "itemMainPic", "itemSellerId",
      "itemTitle", "orderId", "ownerUserId", "ownerUserType",
      `squadId_${sellerUserId}`, `squadId_${buyerUserId}`,
      `squadName_${sellerUserId}`, `squadName_${buyerUserId}`
    ],
    "order context details"
  );

  literal(details.extUserType, "0", "order context extUserType");
  const itemId = id(details.itemId, "order context itemId");
  const orderId = id(details.orderId, "order context orderId");
  literal(details.ownerUserId, sellerUserId, "order context owner");
  literal(details.ownerUserType, "0", "order context owner type");
  httpUrl(details.itemMainPic, "order context itemMainPic");
  nonEmpty(details.itemTitle, "order context itemTitle");

  const features = jsonRecord(details.itemFeatures, "order context itemFeatures");
  exactKeys(features, ["idle_cat_leaf"], "order context itemFeatures");
  const leaf = id(features.idle_cat_leaf, "order context idle_cat_leaf");

  literal(details[`squadId_${sellerUserId}`], itemId, "order context seller squad");
  literal(details[`squadId_${buyerUserId}`], leaf, "order context buyer squad");
  nonEmpty(details[`squadName_${sellerUserId}`], "order context seller squad name");
  nonEmpty(details[`squadName_${buyerUserId}`], "order context buyer squad name");

  return {
    kind: "ORDER_CONTEXT",
    chatId: chat(payload["1"], "order context chat"),
    orderId,
    itemId,
    buyerUserId
  };
}

/** 解码付款/待付款系统提醒：按 redReminder 文案区分两种事件。 */
function decodeSummary(payload: RecordValue): XianyuInboundEvent {
  exactKeys(payload, ["1", "2", "3", "4"], "payment summary");
  literal(payload["2"], 1, "payment summary type");
  timestamp(payload["4"], "payment summary timestamp");

  const details = requireRecord(payload["3"], "payment summary details");
  exactKeys(details, ["redReminder", "redReminderStyle"], "payment summary details");
  literal(details.redReminderStyle, "1", "payment summary style");
  const chatId = chat(payload["1"], "payment summary chat");

  if (details.redReminder === "等待卖家发货") {
    return { kind: "PAYMENT_SUMMARY", chatId, redReminder: "等待卖家发货" };
  }
  if (details.redReminder === "等待买家付款") {
    return { kind: "WAITING_PAYMENT_SUMMARY", chatId, redReminder: "等待买家付款" };
  }
  throw new Error("payment summary redReminder is unknown");
}

/** 解码消息更新帧（改价通知）：从 updateKey 解析订单号与更新类型。 */
function decodeMessageUpdate(payload: RecordValue): XianyuInboundEvent {
  exactKeys(payload, ["1", "2", "3", "4", "5"], "message update");
  pnm(payload["1"], "message update PNM");
  literal(payload["3"], 1, "message update type");
  timestamp(payload["5"], "message update timestamp");
  const chatId = chat(payload["2"], "message update chat");

  const metadata = requireRecord(payload["4"], "message update metadata");
  exactKeys(metadata, ["_CONTENT_MAP_UPDATE_PRE_dxCard.item.main.exContent.button", ...cardMetadataBase], "message update metadata");

  // 更新按钮：文案固定「已付款」，URL 里的 id 即订单号
  const button = jsonRecord(
    metadata["_CONTENT_MAP_UPDATE_PRE_dxCard.item.main.exContent.button"],
    "message update button"
  );
  exactKeys(button, ["bgColor", "borderColor", "fontColor", "targetUrl", "text"], "message update button");
  literal(button.text, "已付款", "message update button text");
  const buttonUrl = url(button.targetUrl, "message update button URL");

  // 元数据公共字段
  booleanString(metadata.closePushReceiver, "message update closePushReceiver");
  booleanString(metadata.closeUnreadNumber, "message update closeUnreadNumber");
  booleanString(metadata.updateHead, "message update updateHead");
  literal(metadata.detailNotice, "[我已修改价格，等待你付款]", "message update detailNotice");
  literal(metadata.reminderContent, "[我已付款，等待你发货]", "message update reminderContent");
  literal(metadata.reminderNotice, "我已修改价格，快来付款吧", "message update reminderNotice");
  literal(metadata.reminderTitle, "交易消息", "message update reminderTitle");
  literal(metadata.redReminder, "等待卖家发货", "message update redReminder");
  literal(metadata.redReminderStyle, "1", "message update redReminderStyle");
  const senderId = id(metadata.senderUserId, "message update sender");
  literal(metadata.senderUserType, "0", "message update sender type");
  literal(metadata.sessionType, "1", "message update session type");
  id(metadata.receiver, "message update receiver");

  const tag = taskTag(metadata.bizTag, "message update bizTag");
  const reminder = reminderUrl(metadata.reminderUrl, chatId, "message update reminderUrl");
  literal(reminder.peerUserId, senderId, "message update reminder peer");

  const ext = jsonRecord(metadata.extJson, "message update extJson");
  exactKeys(ext, ["msgArgs", "quickReply", "msgArg1", "updateKey", "messageId", "multiChannel", "contentType"], "message update extJson");
  literal(ext.quickReply, "1", "message update quickReply");
  literal(ext.msgArg1, "MsgCard", "message update msgArg1");
  literal(ext.contentType, "26", "message update contentType");
  const messageId = id(ext.messageId, "message update messageId");
  literal(reminder.messageId, messageId, "message update reminder message");
  const args = taskMessageArgs(ext.msgArgs, "message update msgArgs");
  literal(args.taskId, tag.taskId, "message update task");
  literal(args.messageId, messageId, "message update args message");
  multiChannel(ext.multiChannel, "message update multiChannel");

  // updateKey 形如 chatId:orderId:2:TRADE_MODIFY_FEE_BUYER:26
  const update = ext.updateKey;
  const parts = id(update, "message update updateKey").split(":");
  if (
    parts.length !== 5 ||
    parts[0] !== chatId ||
    parts[2] !== "2" ||
    parts[3] !== "TRADE_MODIFY_FEE_BUYER" ||
    parts[4] !== "26"
  ) {
    throw new Error("message update updateKey is invalid");
  }
  const orderId = id(parts[1], "message update order");
  literal(buttonUrl.searchParams.get("id"), orderId, "message update button order");

  return { kind: "MESSAGE_UPDATE", chatId, messageId, orderId, updateType: "TRADE_MODIFY_FEE_BUYER" };
}

/**
 * 解码标准消息帧（外层含 needPush 推送标志）：按 content 类型分派到
 * 普通文字/图片（1/2）、交易卡片（26）与提示消息（14）。
 */
function decodeStandard(payload: RecordValue): XianyuInboundEvent {
  // 外层：payload = { "1": envelope, "3": push }
  exactKeys(payload, ["1", "3"], "standard message payload");
  const push = requireRecord(payload["3"], "standard message push");
  exactKeys(push, ["needPush"], "standard message push");
  stringEnum(push.needPush, ["true", "false"], "standard message needPush");

  const envelope = requireRecord(payload["1"], "standard message envelope");
  exactKeys(envelope, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "12"], "standard message envelope");

  // 发送者与会话
  const sender = requireRecord(envelope["1"], "standard message sender");
  exactKeys(sender, ["1"], "standard message sender");
  const senderId = bareGoofish(sender["1"], "standard message sender");
  const chatId = chat(envelope["2"], "standard message chat");
  pnm(envelope["3"], "standard message PNM");
  literal(envelope["4"], 0, "standard message field 4");
  timestamp(envelope["5"], "standard message timestamp");
  literal(envelope["8"], 1, "standard message field 8");
  literal(envelope["12"], 1, "standard message field 12");

  // 内容层：code 101 + custom（display/outerType + 内层 JSON）
  const content = requireRecord(envelope["6"], "standard message content");
  exactKeys(content, ["1", "3"], "standard message content");
  literal(content["1"], 101, "standard message content code");
  const custom = requireRecord(content["3"], "standard message custom");
  exactKeys(custom, ["1", "2", "3", "4", "5"], "standard message custom");
  literal(custom["1"], "", "standard message custom 1");
  literal(custom["3"], "", "standard message custom 3");
  const display = nonEmpty(custom["2"], "standard message display");
  const outerType = integer(custom["4"], "standard message outer contentType");
  const inner = jsonRecord(custom["5"], "standard message inner");
  const innerType = integer(inner.contentType, "standard message inner contentType");
  if (outerType !== innerType) {
    throw new Error("standard message content types conflict");
  }

  const metadata = requireRecord(envelope["10"], "standard message metadata");

  // 按外层类型分派：文字/图片（1/2）、交易卡（26）、提示（14）
  if (outerType === 1 || outerType === 2) {
    literal(push.needPush, "true", "ordinary needPush");
    literal(envelope["7"], 2, "ordinary envelope field 7");
    literal(envelope["9"], 0, "ordinary envelope field 9");
    const identity = decodeOrdinaryMetadata(metadata, senderId, chatId, display);
    return decodeOrdinary(inner, outerType, identity, display);
  }
  if (outerType === 26) {
    // 交易卡片的 needPush 在真实推送中可为 true 或 false(外层已校验字符串枚举),
    // 不再要求固定 true,避免误拒真实卡片。
    literal(envelope["7"], 1, "card envelope field 7");
    literal(envelope["9"], 0, "card envelope field 9");
    return decodeCard(inner, metadata, { chatId, senderId, display });
  }
  if (outerType === 14) {
    literal(push.needPush, "false", "tip needPush");
    literal(envelope["7"], 1, "tip envelope field 7");
    // 真实 tip 帧的 field 9 存在未确认取值(曾见非 1),提示消息为 no-op,放行 0/1
    integerEnum(envelope["9"], [0, 1], "tip envelope field 9");
    return decodeTip(inner, metadata, { chatId, senderId, display });
  }
  throw new Error("unknown xianyu payload shape");
}

/** 解码普通消息（文字/图片）的元数据：严格校验字段并提取公共标识。 */
function decodeOrdinaryMetadata(
  metadata: RecordValue,
  senderId: string,
  chatId: string,
  display: string
): OrdinaryIdentity {
  // 元数据白名单 + 公共字段（web 12 键必填；移动端 5 键可选）
  keysSubset(metadata, ordinaryMetadataKeys, ordinaryMetadataOptionalKeys, "ordinary metadata");
  nonEmpty(metadata._appVersion, "ordinary app version");
  stringEnum(metadata._platform, ["web", "android"], "ordinary platform");
  literal(metadata.detailNotice, display, "ordinary detailNotice");
  literal(metadata.reminderContent, display, "ordinary reminderContent");
  nonEmpty(metadata.reminderNotice, "ordinary reminderNotice");
  nonEmpty(metadata.reminderTitle, "ordinary reminderTitle");
  literal(metadata.senderUserId, senderId, "ordinary sender");
  literal(metadata.senderUserType, "0", "ordinary sender type");
  literal(metadata.sessionType, "1", "ordinary session type");
  // 移动端变体独有字段：存在则校验非空，缺失（web 变体）不要求
  for (const key of ordinaryMetadataOptionalKeys) {
    if (Object.hasOwn(metadata, key)) {
      nonEmpty(metadata[key], `ordinary ${key}`);
    }
  }

  // extJson：消息 ID 的来源（移动端变体额外携带 utdid/umidToken）
  const ext = jsonRecord(metadata.extJson, "ordinary extJson");
  keysSubset(ext, ["quickReply", "messageId", "tag"], ["utdid", "umidToken"], "ordinary extJson");
  literal(ext.quickReply, "1", "ordinary quickReply");
  literal(ext.tag, "u", "ordinary ext tag");
  const messageId = id(ext.messageId, "ordinary extJson.messageId");
  if (Object.hasOwn(ext, "utdid")) {
    literal(ext.utdid, metadata.utdid, "ordinary ext utdid");
  }
  if (Object.hasOwn(ext, "umidToken")) {
    literal(ext.umidToken, metadata.umidToken, "ordinary ext token");
  }

  // bizTag：任务标签（S:1 来源）
  const tag = jsonRecord(metadata.bizTag, "ordinary bizTag");
  exactKeys(tag, ["sourceId", "messageId"], "ordinary bizTag");
  literal(tag.sourceId, "S:1", "ordinary bizTag source");
  literal(tag.messageId, messageId, "ordinary bizTag.messageId");

  // reminderUrl：提取 itemId 并核对 messageId/peer
  const reminder = reminderUrl(metadata.reminderUrl, chatId, "ordinary reminderUrl");
  literal(reminder.messageId, messageId, "ordinary reminder messageId");
  literal(reminder.peerUserId, senderId, "ordinary reminder peer");

  return {
    chatId,
    messageId,
    senderId,
    itemId: reminder.itemId,
    customerName: nonEmpty(metadata.reminderTitle, "ordinary reminderTitle")
  };
}

/** 解码普通消息内层：type 1 文字消息，type 2 图片消息（单图）。 */
function decodeOrdinary(
  inner: RecordValue,
  type: number,
  identity: OrdinaryIdentity,
  display: string
): XianyuInboundEvent {
  // type 1：文字消息（移动端变体额外携带 atUsers）
  if (type === 1) {
    keysSubset(inner, ["contentType", "text"], ["atUsers"], "text inner");
    if (Object.hasOwn(inner, "atUsers")) {
      emptyArray(inner.atUsers, "text atUsers");
    }
    literal(inner.contentType, 1, "text contentType");
    const text = requireRecord(inner.text, "text body");
    exactKeys(text, ["text"], "text body");
    const value = nonEmpty(text.text, "text value");
    literal(value, display, "text display");
    const { customerName: _customerName, ...textIdentity } = identity;
    return { kind: "TEXT_MESSAGE", ...textIdentity, text: value };
  }

  // type 2：图片消息（单图，取 pics[0].url 作为截图地址；移动端变体额外携带 atUsers）
  if (type === 2) {
    keysSubset(inner, ["contentType", "image"], ["atUsers"], "image inner");
    if (Object.hasOwn(inner, "atUsers")) {
      emptyArray(inner.atUsers, "image atUsers");
    }
    literal(inner.contentType, 2, "image contentType");
    const image = requireRecord(inner.image, "image body");
    exactKeys(image, ["pics"], "image body");
    const pics = requireArray(image.pics, "image pics");
    if (pics.length !== 1) {
      throw new Error("image pics must contain exactly one value");
    }
    const pic = requireRecord(pics[0], "image pic");
    exactKeys(pic, ["height", "type", "url", "width"], "image pic");
    positive(pic.height, "image height");
    literal(pic.type, 0, "image type");
    const imageUrl = httpsUrl(pic.url, "image URL");
    positive(pic.width, "image width");
    return { kind: "IMAGE_MESSAGE", ...identity, imageUrl };
  }
  throw new Error("unknown xianyu payload shape");
}

/**
 * 解码交易卡片：按标题区分待付款（[我已拍下，待付款]）与已付款（[我已付款，等待你发货]），
 * 闲鱼订单号分别来自按钮 URL 的 bizOrderId / orderId（两类分支严格分开）。
 */
function decodeCard(
  inner: RecordValue,
  metadata: RecordValue,
  base: { chatId: string; senderId: string; display: string }
): XianyuInboundEvent {
  // 卡片外层：contentType 26 + dxCard
  exactKeys(inner, ["contentType", "dxCard"], "trade card inner");
  literal(inner.contentType, 26, "trade card contentType");
  const card = requireRecord(inner.dxCard, "trade card dxCard");
  exactKeys(card, ["item", "template"], "trade card dxCard");
  const item = requireRecord(card.item, "trade card item");
  exactKeys(item, ["main"], "trade card item");
  const main = requireRecord(item.main, "trade card main");
  exactKeys(main, ["clickParam", "exContent", "targetUrl"], "trade card main");

  // 卡片点击参数：任务与消息 ID
  const click = requireRecord(main.clickParam, "trade card clickParam");
  exactKeys(click, ["arg1", "args"], "trade card clickParam");
  literal(click.arg1, "MsgCard", "trade card clickParam arg1");
  const clickArgs = taskMessageArgs(click.args, "trade card clickParam args");

  // 展示内容：标题区分待付款/已付款
  const content = requireRecord(main.exContent, "trade card exContent");
  exactKeys(content, ["bgColor", "button", "desc", "descColor", "title", "upgrade"], "trade card exContent");
  nonEmpty(content.bgColor, "trade card bgColor");
  nonEmpty(content.desc, "trade card desc");
  nonEmpty(content.descColor, "trade card descColor");
  const title = nonEmpty(content.title, "trade card title");
  const paid = title === "我已付款，等待你发货";
  const waiting = title === "我已拍下，待付款";
  if (!paid && !waiting) {
    throw new Error("trade card title is unknown");
  }
  literal(base.display, `[${title}]`, "trade card display");

  const upgrade = requireRecord(content.upgrade, "trade card upgrade");
  exactKeys(upgrade, ["targetUrl", "version"], "trade card upgrade");
  url(upgrade.targetUrl, "trade card upgrade URL");
  nonEmpty(upgrade.version, "trade card upgrade version");

  const template = requireRecord(card.template, "trade card template");
  exactKeys(template, ["name", "url", "version"], "trade card template");
  nonEmpty(template.name, "trade card template name");
  url(template.url, "trade card template URL");
  nonEmpty(template.version, "trade card template version");

  // 卡片元数据（含任务/消息关系校验）
  const physical = paid && Object.hasOwn(metadata, "csReception");
  const common = decodeCardMetadata(
    metadata,
    base.chatId,
    base.senderId,
    waiting || physical,
    waiting || physical,
    paid ? "等待卖家发货" : "等待买家付款"
  );
  literal(clickArgs.taskId, common.taskId, "trade card click task");
  literal(clickArgs.messageId, common.messageId, "trade card click message");

  // 按钮：文案与点击参数
  const button = requireRecord(content.button, "trade card button");
  exactKeys(button, ["bgColor", "borderColor", "clickParam", "fontColor", "targetUrl", "text"], "trade card button");
  nonEmpty(button.bgColor, "trade card button bgColor");
  nonEmpty(button.borderColor, "trade card button borderColor");
  nonEmpty(button.fontColor, "trade card button fontColor");
  const buttonText = nonEmpty(button.text, "trade card button text");
  const buttonClick = requireRecord(button.clickParam, "trade card button clickParam");
  exactKeys(buttonClick, ["arg1", "args"], "trade card button clickParam");
  literal(buttonClick.arg1, "MsgCardAction", "trade card button arg1");
  const buttonArgs = requireRecord(buttonClick.args, "trade card button args");
  exactKeys(buttonArgs, ["task_id", "source", "button_text", "msg_id"], "trade card button args");
  literal(buttonArgs.source, "im", "trade card button source");
  literal(buttonArgs.task_id, common.taskId, "trade card button task");
  literal(buttonArgs.msg_id, common.messageId, "trade card button message");
  literal(buttonArgs.button_text, buttonText, "trade card button text relation");

  // 主 URL：fleamarket://order_detail?id=xxx&role=xxx
  const mainUrl = url(main.targetUrl, "trade card main URL");
  literal(mainUrl.protocol, "fleamarket:", "trade card main protocol");
  literal(mainUrl.hostname, "order_detail", "trade card main host");
  literal(mainUrl.pathname, "", "trade card main path");
  literal(mainUrl.hash, "", "trade card main fragment");
  exactQuery(mainUrl, { id: "", role: "" }, "trade card main query");
  const mainOrderId = id(mainUrl.searchParams.get("id"), "trade card main order");

  const buttonUrl = url(button.targetUrl, "trade card button URL");

  // 待付款分支：按钮跳改价页，订单号取自 bizOrderId
  if (waiting) {
    literal(mainUrl.searchParams.get("role"), "seller", "waiting card role");
    literal(buttonUrl.protocol, "fleamarket:", "waiting card button protocol");
    literal(buttonUrl.hostname, "adjust_price", "waiting card button host");
    literal(buttonUrl.pathname, "", "waiting card button path");
    literal(buttonUrl.hash, "", "waiting card button fragment");
    exactQuery(buttonUrl, { flutter: "true", bizOrderId: "" }, "waiting card button query");
    const orderId = id(buttonUrl.searchParams.get("bizOrderId"), "waiting card button order");
    literal(mainOrderId, orderId, "waiting card order relation");
    literal(common.extJson.updateKey, `${base.chatId}:${orderId}:1_not_pay_seller`, "waiting card updateKey");
    return {
      kind: "WAITING_PAYMENT_CARD",
      chatId: common.chatId,
      messageId: common.messageId,
      senderId: common.senderId,
      itemId: common.itemId,
      orderId
    };
  }

  // 已付款分支：按钮跳发货页，订单号取自 orderId
  literal(mainUrl.searchParams.get("role"), "Seller", "paid card role");
  literal(buttonUrl.protocol, "https:", "paid card button protocol");
  const expectedPath = physical
    ? "/wow/moyu/moyu-project/idle-logistics/pages/idleDeliver"
    : "/wow/moyu/moyu-project/idle-logistics/pages/noPostageRequired";
  literal(buttonUrl.pathname, expectedPath, "paid card button path");
  literal(buttonUrl.hash, "", "paid card button fragment");
  exactQuery(
    buttonUrl,
    physical
      ? { kun: "true", titleVisible: "false", useCusFont: "'true'", orderId: "" }
      : { kun: "true", opaque: "false", orderId: "" },
    "paid card button query"
  );
  const orderId = id(buttonUrl.searchParams.get("orderId"), "paid card button order");
  literal(mainOrderId, orderId, "paid card order relation");
  const state = physical ? "63" : "64";
  literal(common.extJson.updateKey, `${base.chatId}:${orderId}:${state}:TRADE_PAID_DONE_SELLER:26`, "paid card updateKey");
  return {
    kind: "PAID_CARD",
    chatId: common.chatId,
    messageId: common.messageId,
    senderId: common.senderId,
    itemId: common.itemId,
    orderId
  };
}

/** 解码卡片元数据：校验字段关系并返回公共元数据（含任务 ID 与扩展 JSON）。 */
function decodeCardMetadata(
  metadata: RecordValue,
  chatId: string,
  senderId: string,
  hasCsReception: boolean,
  hasCorrelation: boolean,
  redReminder: string
): CommonMetadata {
  const expected = [...cardMetadataBase];
  if (hasCsReception) {
    expected.push("csReception");
  }
  exactKeys(metadata, expected, "card metadata");

  booleanString(metadata.closePushReceiver, "card closePushReceiver");
  booleanString(metadata.closeUnreadNumber, "card closeUnreadNumber");
  if (hasCsReception) {
    booleanString(metadata.csReception, "card csReception");
  }
  booleanString(metadata.updateHead, "card updateHead");
  literal(metadata.redReminder, redReminder, "card redReminder");
  literal(metadata.redReminderStyle, "1", "card redReminderStyle");
  literal(metadata.senderUserId, senderId, "card sender");
  literal(metadata.senderUserType, "0", "card sender type");
  literal(metadata.sessionType, "1", "card session type");

  const display = redReminder === "等待买家付款" ? "我已拍下，待付款" : "我已付款，等待你发货";
  literal(metadata.detailNotice, `[${display}]`, "card detailNotice");
  literal(metadata.reminderContent, `[${display}]`, "card reminderContent");
  nonEmpty(metadata.reminderNotice, "card reminderNotice");
  nonEmpty(metadata.reminderTitle, "card reminderTitle");

  const tag = taskTag(metadata.bizTag, "card bizTag");
  const reminder = reminderUrl(metadata.reminderUrl, chatId, "card reminderUrl");
  id(metadata.receiver, "card receiver");
  literal(reminder.peerUserId, senderId, "card reminder peer");

  const ext = jsonRecord(metadata.extJson, "card extJson");
  const extKeys = ["msgArgs", "quickReply", "msgArg1", "updateKey", "messageId", "multiChannel", "contentType"];
  if (hasCorrelation) {
    extKeys.push("correlationGroupId");
  }
  exactKeys(ext, extKeys, "card extJson");
  literal(ext.quickReply, "1", "card quickReply");
  literal(ext.msgArg1, "MsgCard", "card msgArg1");
  literal(ext.contentType, "26", "card contentType");
  const messageId = id(ext.messageId, "card messageId");
  literal(reminder.messageId, messageId, "card reminder message");

  const args = taskMessageArgs(ext.msgArgs, "card msgArgs");
  literal(args.taskId, tag.taskId, "card task relation");
  literal(args.messageId, messageId, "card message relation");
  multiChannel(ext.multiChannel, "card multiChannel");
  if (hasCorrelation) {
    id(ext.correlationGroupId, "card correlationGroupId");
  }

  return { chatId, messageId, senderId, itemId: reminder.itemId, taskId: tag.taskId, extJson: ext };
}

/** 解码提示消息（当前业务只记录为 IGNORED_TIP_MESSAGE，不触发动作）。 */
function decodeTip(
  inner: RecordValue,
  metadata: RecordValue,
  base: { chatId: string; senderId: string; display: string }
): XianyuInboundEvent {
  // 内层：contentType 14 + tip
  exactKeys(inner, ["contentType", "tip"], "tip inner");
  literal(inner.contentType, 14, "tip contentType");
  const tip = requireRecord(inner.tip, "tip body");
  exactKeys(tip, ["action", "tip"], "tip body");
  literal(tip.tip, base.display, "tip display");

  const action = requireRecord(tip.action, "tip action");
  exactKeys(action, ["actionType", "page"], "tip action");
  literal(action.actionType, 4, "tip actionType");

  const page = requireRecord(action.page, "tip page");
  exactKeys(page, ["actionName", "actionStyle", "actionType", "iosActionStyle", "showGuideAlways", "url", "utName", "utParams"], "tip page");
  nonEmpty(page.actionName, "tip actionName");
  literal(page.actionStyle, 0, "tip actionStyle");
  literal(page.actionType, 4, "tip page actionType");
  literal(page.iosActionStyle, 0, "tip iosActionStyle");
  literal(page.showGuideAlways, false, "tip showGuideAlways");

  const tipUrl = url(page.url, "tip URL");
  literal(tipUrl.protocol, "fleamarket:", "tip URL protocol");
  literal(tipUrl.hostname, "item", "tip URL host");
  literal(tipUrl.pathname, "", "tip URL path");
  literal(tipUrl.hash, "", "tip URL fragment");
  exactQuery(tipUrl, { id: "" }, "tip URL query");
  literal(page.utName, "MsgTips", "tip utName");
  const pageArgs = taskMessageArgs(page.utParams, "tip utParams");

  // 元数据
  exactKeys(metadata, tipMetadataKeys, "tip metadata");
  booleanString(metadata.closePushReceiver, "tip closePushReceiver");
  booleanString(metadata.closeUnreadNumber, "tip closeUnreadNumber");
  booleanString(metadata.updateHead, "tip updateHead");
  literal(metadata.detailNotice, base.display, "tip detailNotice");
  literal(metadata.reminderContent, base.display, "tip reminderContent");
  literal(metadata.senderUserId, base.senderId, "tip sender");
  literal(metadata.senderUserType, "0", "tip sender type");
  literal(metadata.sessionType, "1", "tip session type");

  const tag = taskTag(metadata.bizTag, "tip bizTag");
  const reminder = reminderUrl(metadata.reminderUrl, base.chatId, "tip reminderUrl");
  literal(tipUrl.searchParams.get("id"), reminder.itemId, "tip URL item");
  id(metadata.receiver, "tip receiver");
  literal(reminder.peerUserId, base.senderId, "tip reminder peer");

  const ext = jsonRecord(metadata.extJson, "tip extJson");
  exactKeys(ext, ["msgArgs", "msgArg1", "messageId", "contentType"], "tip extJson");
  literal(ext.msgArg1, "MsgTips", "tip msgArg1");
  literal(ext.contentType, "14", "tip contentType");
  const messageId = id(ext.messageId, "tip messageId");
  literal(reminder.messageId, messageId, "tip reminder message");

  const extArgs = taskMessageArgs(ext.msgArgs, "tip msgArgs");
  literal(pageArgs.taskId, tag.taskId, "tip task");
  literal(extArgs.taskId, tag.taskId, "tip ext task");
  literal(pageArgs.messageId, messageId, "tip page message");
  literal(extArgs.messageId, messageId, "tip ext message");

  return { kind: "IGNORED_TIP_MESSAGE", chatId: base.chatId, messageId };
}

/** 解码 bizTag 任务标签：materialId/sourceId 必须与 taskId 关联。 */
function taskTag(value: unknown, context: string): { taskId: string } {
  const tag = jsonRecord(value, context);
  exactKeys(tag, taskTagKeys, context);
  const taskId = id(tag.taskId, `${context}.taskId`);
  literal(tag.materialId, taskId, `${context}.materialId`);
  literal(tag.sourceId, `C2C:${taskId}`, `${context}.sourceId`);
  nonEmpty(tag.taskName, `${context}.taskName`);
  return { taskId };
}

/** 解码任务参数（task_id/source/msg_id）：source 必须为 im。 */
function taskMessageArgs(value: unknown, context: string): { taskId: string; messageId: string } {
  const args = requireRecord(value, context);
  exactKeys(args, ["task_id", "source", "msg_id"], context);
  literal(args.source, "im", `${context}.source`);
  return {
    taskId: id(args.task_id, `${context}.task_id`),
    messageId: id(args.msg_id, `${context}.msg_id`)
  };
}

/** 校验多通道推送配置：每个通道的值必须与已确认的常量一致。 */
function multiChannel(value: unknown, context: string): void {
  const channel = requireRecord(value, context);
  exactKeys(channel, multiChannelKeys, context);
  const expected: Record<string, string> = {
    huawei: "EXPRESS",
    xiaomi: "108000",
    oppo_notify_level: "16",
    honor: "NORMAL",
    agoo: "product",
    oppo_category: "ORDER",
    vivo: "ORDER"
  };
  for (const key of multiChannelKeys) {
    literal(channel[key], expected[key], `${context}.${key}`);
  }
}

/**
 * 解析并校验 reminderUrl：fleamarket 协议、固定键集，
 * 提取 itemId/messageId/peerUserId。
 */
function reminderUrl(value: unknown, chatId: string, context: string): {
  itemId: string;
  messageId: string;
  peerUserId: string;
} {
  const parsed = url(value, context);
  literal(parsed.protocol, "fleamarket:", `${context} protocol`);
  literal(parsed.hostname, "message_chat", `${context} host`);
  literal(parsed.pathname, "", `${context} path`);
  literal(parsed.hash, "", `${context} fragment`);

  const actual: string[] = [];
  parsed.searchParams.forEach((_, key) => actual.push(key));
  actual.sort();
  const expected = ["adv", "itemId", "messageId", "peerUserId", "sid"];
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${context} has unexpected query keys`);
  }

  literal(parsed.searchParams.get("adv"), "no", `${context} adv`);
  literal(parsed.searchParams.get("sid"), chatId, `${context} sid`);
  return {
    itemId: id(parsed.searchParams.get("itemId"), `${context} itemId`),
    messageId: id(parsed.searchParams.get("messageId"), `${context} messageId`),
    peerUserId: id(parsed.searchParams.get("peerUserId"), `${context} peerUserId`)
  };
}

/** 校验 URL 查询串：键集合必须完全等于预期，空值项取非空 ID，其余必须匹配常量。 */
function exactQuery(parsed: URL, expected: Record<string, string>, context: string): void {
  const keys: string[] = [];
  parsed.searchParams.forEach((_, key) => keys.push(key));
  keys.sort();
  const expectedKeys = Object.keys(expected).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`${context} has unexpected query keys`);
  }
  for (const key of expectedKeys) {
    const value = parsed.searchParams.get(key);
    if (expected[key] === "") {
      id(value, `${context}.${key}`);
    } else {
      literal(value, expected[key], `${context}.${key}`);
    }
  }
}

/** 帧形状判断：标准消息（含 needPush 推送标志）。 */
function isStandard(payload: RecordValue): boolean {
  return isRecord(payload["1"]) && isRecord(payload["3"]) && Object.hasOwn(payload["3"], "needPush");
}

/** 帧形状判断：消息更新帧（含 extJson 元数据）。 */
function isMessageUpdate(payload: RecordValue): boolean {
  return isRecord(payload["4"]) && Object.hasOwn(payload["4"], "extJson");
}

/** 帧形状判断：PNM 状态帧（数组或标量）。 */
function isPnm(payload: RecordValue): boolean {
  return Array.isArray(payload["1"]) ||
    (typeof payload["1"] === "string" && (typeof payload["3"] === "string" || payload["3"] === 0));
}

/** 帧形状判断：订单上下文帧（含 orderId）。 */
function isOrderContext(payload: RecordValue): boolean {
  return isRecord(payload["3"]) && Object.hasOwn(payload["3"], "orderId");
}

/** 帧形状判断：付款/待付款系统提醒帧（含 redReminder）。 */
function isSummary(payload: RecordValue): boolean {
  return isRecord(payload["3"]) && Object.hasOwn(payload["3"], "redReminder");
}

/** 严格校验对象只包含指定键且全部存在。 */
function exactKeys(value: RecordValue, expected: string[], context: string): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`${context} has an unexpected structure`);
  }
}

/**
 * 白名单校验：所有必填键必须存在，且实际键只能是必填 + 可选键的并集。
 * 用于同一消息的多种平台变体（如 web 端 12 键、移动端额外 5 键）。
 */
function keysSubset(value: RecordValue, required: string[], optional: string[], context: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`${context} is missing ${key}`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${context} has an unexpected structure`);
    }
  }
}

/** 校验未知值为普通对象。 */
function requireRecord(value: unknown, context: string): RecordValue {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value;
}

/** 判断未知值是否为普通对象。 */
function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验未知值为数组。 */
function requireArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  return value;
}

/** 校验字段为 JSON 对象字符串并解析。 */
function jsonRecord(value: unknown, context: string): RecordValue {
  const text = nonEmpty(value, context);
  try {
    return requireRecord(JSON.parse(text), context);
  } catch (error) {
    throw new Error(`${context} must be JSON object`, { cause: error });
  }
}

/** 校验字段为非空字符串。 */
function nonEmpty(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

/** 校验为不带 @ 后缀的裸 ID。 */
function id(value: unknown, context: string): string {
  const result = nonEmpty(value, context);
  if (result.includes("@")) {
    throw new Error(`${context} must be bare ID`);
  }
  return result;
}

/** 校验会话 ID 的 @goofish 后缀并去掉后缀返回裸值。 */
function chat(value: unknown, context: string): string {
  const raw = nonEmpty(value, context);
  if (!raw.endsWith("@goofish") || raw.length === 8) {
    throw new Error(`${context} must have @goofish suffix`);
  }
  return raw.slice(0, -8);
}

/** 校验带 @goofish 后缀的完整会话 ID。 */
function goofishId(value: unknown, context: string): string {
  const raw = nonEmpty(value, context);
  if (!raw.endsWith("@goofish") || raw.length === 8) {
    throw new Error(`${context} must have @goofish suffix`);
  }
  return raw;
}

/** 与 chat 相同：去 @goofish 后缀的裸会话 ID。 */
function bareGoofish(value: unknown, context: string): string {
  return chat(value, context);
}

/** 校验 PNM 消息标识（以 .PNM 结尾）。 */
function pnm(value: unknown, context: string): string {
  const result = nonEmpty(value, context);
  if (!result.endsWith(".PNM")) {
    throw new Error(`${context} must be PNM`);
  }
  return result;
}

/** 校验字段为整数。 */
function integer(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${context} must be integer`);
  }
  return value;
}

/** 校验字段为正整数。 */
function positive(value: unknown, context: string): number {
  const result = integer(value, context);
  if (result <= 0) {
    throw new Error(`${context} must be positive`);
  }
  return result;
}

/** 校验字段为正整数时间戳。 */
function timestamp(value: unknown, context: string): void {
  positive(value, context);
}

/** 校验整数必须在允许集合内。 */
function integerEnum(value: unknown, allowed: number[], context: string): void {
  if (!allowed.includes(integer(value, context))) {
    throw new Error(`${context} is not allowed`);
  }
}

/** 校验字符串必须在允许集合内。 */
function stringEnum(value: unknown, allowed: string[], context: string): void {
  if (!allowed.includes(nonEmpty(value, context))) {
    throw new Error(`${context} is not allowed`);
  }
}

/** 校验布尔字符串（"true"/"false"）。 */
function booleanString(value: unknown, context: string): void {
  stringEnum(value, ["true", "false"], context);
}

/** 校验字段为空数组。 */
function emptyArray(value: unknown, context: string): void {
  if (!Array.isArray(value) || value.length !== 0) {
    throw new Error(`${context} must be empty array`);
  }
}

/** 断言字段与预期字面量严格相等。 */
function literal<T>(value: unknown, expected: T, context: string): asserts value is T {
  if (value !== expected) {
    throw new Error(`${context} must equal ${String(expected)}`);
  }
}

/** 校验字段为合法 URL 并返回解析结果。 */
function url(value: unknown, context: string): URL {
  try {
    return new URL(nonEmpty(value, context));
  } catch (error) {
    throw new Error(`${context} must be URL`, { cause: error });
  }
}

/** 校验字段为 HTTP(S) URL。 */
function httpUrl(value: unknown, context: string): string {
  const parsed = url(value, context);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${context} must be HTTP(S)`);
  }
  return parsed.toString();
}

/** 校验字段为 HTTPS URL。 */
function httpsUrl(value: unknown, context: string): string {
  const parsed = url(value, context);
  if (parsed.protocol !== "https:") {
    throw new Error(`${context} must be HTTPS`);
  }
  return parsed.toString();
}
