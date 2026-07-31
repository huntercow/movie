import {
  ProtocolCaptureSession,
  decodeCaptureCommand,
  decodeSocketFrame,
  type CaptureCommand
} from "./protocolCapture";
import { decodeXianyuPayload, type XianyuInboundEvent } from "./xianyuProtocol";
import {
  classifyPaidVerificationResult,
  completeClaimedDeliveryAttempt,
  createXianyuTradeAutomation,
  decodeClaimDeliveryResult,
  decodeAdjustedOrderResult,
  decodeDeliveryPollResult,
  decodePendingRecoveryOrders,
  type WaitingPaymentResult,
  type XianyuOrderPayload,
  type XianyuVerificationFailureCode
} from "./xianyuTradeAutomation";
import {
  createAdjustPriceRequest,
  createOrderDetailRequest,
  decodeAdjustPriceResponse,
  decodeOrderDetailResponse,
  XianyuOrderDetailRequestError,
  type VerifiedOrderAmounts
} from "./xianyuTradeProtocol";

const REQUEST_EVENT = "FILM_AI_LOCAL_TOOL_REQUEST";
const RESPONSE_EVENT = "FILM_AI_LOCAL_TOOL_RESPONSE";
const HOOK_VERSION = "2026-07-09-manual-order-sync";
const STATUS_REQUEST_EVENT = "FILM_AI_XIANYU_STATUS_REQUEST";
const STATUS_RESPONSE_EVENT = "FILM_AI_XIANYU_STATUS_RESPONSE";
const CAPTURE_REQUEST_EVENT = "FILM_AI_XIANYU_CAPTURE_REQUEST";
const CAPTURE_RESPONSE_EVENT = "FILM_AI_XIANYU_CAPTURE_RESPONSE";
const processedMessages = new Map<string, number>();
const activeOrders = new Map<string, ActiveOrder>();
const deliveryPollsInFlight = new Set<string>();
const captureSession = new ProtocolCaptureSession();
const debugState: DebugState = {
  hookVersion: HOOK_VERSION,
  injectedAt: new Date().toISOString(),
  socketHookInstalled: false,
  socketConnected: false,
  rawMessages: 0,
  decodedMessages: 0,
  lastRawAt: "",
  lastDecodedAt: "",
  lastContent: "",
  lastChatId: "",
  lastSenderId: "",
  lastReply: "",
  lastError: "",
  msgpackAvailable: false,
  lastSendOk: false,
  lastSendCid: "",
  lastSendReceiverId: "",
  lastSendAckMessageId: "",
  lastSendAckContent: "",
  lastConversationId: "",
  lastImageUrl: "",
  lastQuoteRequest: "",
  lastQuoteResponse: "",
  lastBackendError: "",
  lastWaitPayRequest: "",
  lastLatestQuoteResponse: "",
  lastAdjustRequest: "",
  lastAdjustResponse: "",
  lastAdjustFailure: "",
  lastHeadInfoRequest: "",
  lastHeadInfoResponse: "",
  lastPaidRequest: "",
  lastPaidResponse: "",
  recentMessages: []
};
let activeGoofishSocket: WebSocket | null = null;
let replyConfigCache: ReplyConfig | null = null;
let replyConfigCacheAt = 0;
let automationConfigCache: AutomationConfig | null = null;
let automationConfigCacheAt = 0;
const tradeAutomation = createXianyuTradeAutomation({
  registerWaitingPayment,
  adjustPrice,
  recordAdjusted,
  resolveActiveOrder,
  fetchOrderDetail,
  verifyPaid,
  recordVerificationFailure,
  recordUnboundProtocolEvent,
  sendEditPriceSuccess
});

export {};

declare global {
  interface Window {
    lib?: { mtop?: { request(options: Record<string, unknown>): Promise<unknown> } };
    msgpack?: { decode(value: Uint8Array): unknown };
    sendWebSocketMessage?: (payload: string) => boolean;
    sendMsgText?: (chatId: string, receiverId: string, text: string) => Promise<boolean>;
    sendMsgImage?: (chatId: string, receiverId: string, imageUrl: string) => Promise<boolean>;
    xianyuMovieTicketDebug?: Record<string, unknown>;
  }
}

installWebSocketHook();
installGlobals();
publishDebugStatus();
startDeliveryPoller();
recoverPendingDeliveries();

function installWebSocketHook(): void {
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(NativeWebSocket, {
    construct(target, args) {
      const socket = Reflect.construct(target, args) as WebSocket;
      const url = String(args[0] || "");
      if (url.includes("wss-goofish.dingtalk.com")) {
        debugState.socketConnected = true;
        debugState.lastError = "";
        activeGoofishSocket = socket;
        socket.addEventListener("message", (event) => handleSocketMessage(event.data));
        socket.addEventListener("close", () => {
          debugState.socketConnected = false;
        });
      }
      return socket;
    }
  }) as typeof WebSocket;
  debugState.socketHookInstalled = true;
  window.sendWebSocketMessage = (payload) => {
    if (!activeGoofishSocket || activeGoofishSocket.readyState !== WebSocket.OPEN) {
      console.warn("[xianyu-ticket] goofish websocket unavailable");
      return false;
    }
    activeGoofishSocket.send(payload);
    return true;
  };
}

function installGlobals(): void {
  window.sendMsgText = async (chatId, receiverId, text) => {
    return sendText(chatId, receiverId, text);
  };
  window.sendMsgImage = async (chatId, receiverId, imageUrl) => {
    return sendImage(chatId, receiverId, imageUrl);
  };
  window.xianyuMovieTicketDebug = {
    sendText,
    sendImage,
    getReplyConfig,
    getAutomationConfig,
    status: () => getDebugStatus(),
    testKeyword: async (chatId: string, receiverId: string, content = "你好") => {
      const config = await getReplyConfig();
      const matched = matchKeywordRule(content, config.xianyuKeywordReplyRules);
      if (!matched?.reply) {
        return { matched: null, sent: false };
      }
      const sent = await sendText(chatId, receiverId, matched.reply);
      return { matched, sent };
    },
    quoteImage: (chatId: string, receiverId: string, imageUrl = debugState.lastImageUrl) => quoteImageFromUrl(chatId, receiverId, imageUrl),
    adjustPrice: (amountCents: number, orderId: string) => adjustPrice(amountCents, orderId),
    sendRaw: (chatId: string, receiverId: string, text: string) => sendTextByWebSocket(chatId, receiverId, text)
  };
  publishDebugStatus();
}

function installPageDebugEvents(): void {
  window.addEventListener("FILM_AI_XIANYU_DEBUG_SEND", ((event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    const ok = sendTextByWebSocket(String(detail.chatId || ""), String(detail.receiverId || ""), String(detail.text || ""));
    window.dispatchEvent(new CustomEvent("FILM_AI_XIANYU_DEBUG_SEND_RESULT", { detail: { ok } }));
  }) as EventListener);
  window.addEventListener(STATUS_REQUEST_EVENT, () => emitDebugStatus());
  window.addEventListener("message", ((event: MessageEvent) => {
    if (event.source !== window || event.data?.type !== "XIANYU_MOVIE_TICKET_STATUS") {
      return;
    }
    const status = emitDebugStatus();
    window.postMessage({ type: "XIANYU_MOVIE_TICKET_STATUS_RESPONSE", status }, "*");
  }) as EventListener);
}

function installProtocolCaptureEvents(): void {
  window.addEventListener(CAPTURE_REQUEST_EVENT, ((event: Event) => {
    const detail = requireRecord((event as CustomEvent<unknown>).detail, "capture page request");
    const requestId = requireNonEmptyString(detail.requestId, "capture page requestId");
    let response: Record<string, unknown>;
    try {
      const command = decodeCaptureCommand(detail.command);
      response = {
        requestId,
        success: true,
        payload: executeCaptureCommand(command)
      };
    } catch (error) {
      response = {
        requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    window.dispatchEvent(new CustomEvent(`${CAPTURE_RESPONSE_EVENT}:${requestId}`, { detail: response }));
  }) as EventListener);
}

function executeCaptureCommand(command: CaptureCommand): unknown {
  switch (command.action) {
    case "START":
      return captureSession.start(command.scenario);
    case "STOP":
      return captureSession.stop();
    case "CLEAR":
      return captureSession.clear();
    case "STATUS":
      return captureSession.status();
    case "EXPORT":
      return captureSession.exportDocument();
  }
}

function bootDebugEventsOnce(): void {
  if ((window as any).__FILM_AI_XIANYU_DEBUG_EVENTS__) {
    return;
  }
  (window as any).__FILM_AI_XIANYU_DEBUG_EVENTS__ = true;
  installPageDebugEvents();
  installProtocolCaptureEvents();
}

bootDebugEventsOnce();

async function handleSocketMessage(data: unknown): Promise<void> {
  debugState.rawMessages += 1;
  debugState.lastRawAt = new Date().toISOString();
  const frame = decodeSocketFrame(data, (bytes) => {
    const msgpack = findMsgpack();
    debugState.msgpackAvailable = Boolean(msgpack);
    if (!msgpack) {
      throw new Error("msgpack decoder unavailable");
    }
    return msgpack.decode(bytes);
  });
  if (captureSession.status().state === "CAPTURING") {
    captureSession.append(frame.transport, frame.payload);
  }
  const event = decodeXianyuPayload(frame.payload);
  debugState.decodedMessages += 1;
  debugState.lastDecodedAt = new Date().toISOString();
  rememberDebugEvent(event, "decoded");
  if (isExplicitNoOp(event)) return;
  switch (event.kind) {
    case "TEXT_MESSAGE":
      if (!isOwnSellerMessage(event.senderId)) {
        await handleTextMessage(event);
      }
      return;
    case "IMAGE_MESSAGE":
      if (!isOwnSellerMessage(event.senderId)) {
        await handleImageMessage(event);
      }
      return;
    case "WAITING_PAYMENT_CARD":
    case "PAID_CARD":
    case "PAYMENT_SUMMARY":
    case "MESSAGE_UPDATE":
      if (!recentlyHandled(event.kind, event.chatId, "messageId" in event ? event.messageId : event.redReminder)) {
        await tradeAutomation.handle(event);
      }
      return;
    default:
      return assertNever(event);
  }
}

async function startDeliveryPoller(): Promise<void> {
  setInterval(async () => {
    for (const order of activeOrders.values()) {
      if (deliveryPollsInFlight.has(order.platformOrderId)) {
        continue;
      }
      deliveryPollsInFlight.add(order.platformOrderId);
      void pollAndDeliver(order).finally(() => deliveryPollsInFlight.delete(order.platformOrderId));
    }
  }, 10_000);
}

async function recoverPendingDeliveries(): Promise<void> {
  setTimeout(async () => {
    const orders = decodePendingRecoveryOrders(await requestBackend("PENDING_DELIVERIES", {}));
    for (const order of orders) {
      activeOrders.set(order.platformOrderId, {
        platformOrderId: order.platformOrderId,
        chatId: order.chatId,
        receiverId: order.buyerUserId
      });
    }
  }, 3_000);
}

async function pollAndDeliver(order: ActiveOrder): Promise<void> {
  const pollResult = decodeDeliveryPollResult(
    await requestBackend("POLL_ORDER", { platformOrderId: order.platformOrderId }),
    order.platformOrderId
  );
  switch (pollResult.kind) {
    case "WAIT":
      return;
    case "NEED_MANUAL":
      await sendTemplate(
        order.chatId,
        order.receiverId,
        "cancel_ticket",
        orderIdPlaceholders(pollResult.order)
      );
      activeOrders.delete(order.platformOrderId);
      return;
    case "TERMINAL":
    case "NO_REPLAY":
      activeOrders.delete(order.platformOrderId);
      return;
    case "READY":
      break;
    default:
      return assertNever(pollResult);
  }
  const claimResult = decodeClaimDeliveryResult(
    await requestBackend("CLAIM_DELIVERY", { platformOrderId: order.platformOrderId }),
    order.platformOrderId
  );
  if (claimResult.kind === "NOT_CLAIMED") {
    return;
  }
  const deliveryPayload = claimResult.order;
  await completeClaimedDeliveryAttempt(
    order.platformOrderId,
    deliveryPayload.deliveryAttemptId,
    {
      removeActive: () => {
        activeOrders.delete(order.platformOrderId);
      },
      sendTemplate: async () => {
        await sendTemplate(
          order.chatId,
          order.receiverId,
          "send_ticket_success",
          deliveryPlaceholders(deliveryPayload)
        );
      },
      sendTicketCodes: async () => {
        const ticketItems = parseTicketItems(deliveryPayload.ticketCodeInfo);
        for (const item of ticketItems) {
          if (!await sendText(order.chatId, order.receiverId, ticketItemValue(item))) {
            throw new Error("failed to send ticket code");
          }
        }
      },
      consignDummy: async () => {
        await consignDummy(order.platformOrderId);
      },
      recordDeliveryResult: async (attemptId, success, errorMessage) => requestBackend("DELIVERY_RESULT", {
        platformOrderId: order.platformOrderId,
        attemptId,
        success,
        channel: "xianyu-mtop",
        errorMessage
      })
    }
  );
}

async function sendText(chatId: string, receiverId: string, text: string): Promise<boolean> {
  if (!sendTextByWebSocket(chatId, receiverId, text)) {
    throw new Error("xianyu websocket text send failed");
  }
  return true;
}

async function sendImage(chatId: string, receiverId: string, imageUrl: string): Promise<boolean> {
  return sendText(chatId, receiverId, imageUrl);
}

function sendTextByWebSocket(chatId: string, receiverId: string, text: string): boolean {
  if (!window.sendWebSocketMessage || !chatId || !receiverId || !text) {
      debugState.lastSendOk = false;
      debugState.lastError = `send skipped chatId=${chatId || "(empty)"} receiverId=${receiverId || "(empty)"}`;
    return false;
  }
  const sellerId = getCookie("unb");
  const actualReceivers = [`${receiverId}@goofish`, sellerId ? `${sellerId}@goofish` : ""].filter(Boolean);
  for (const part of splitReply(maskSensitiveWords(text))) {
    debugState.lastSendCid = chatId;
    debugState.lastSendReceiverId = receiverId;
    const content = {
      contentType: 1,
      text: { text: part }
    };
    const payload = {
      lwp: "/r/MessageSend/sendByReceiverScope",
      headers: { mid: messageMid() },
      body: [
        {
          uuid: messageUuid(),
          cid: `${chatId}@goofish`,
          conversationType: 1,
          content: {
            contentType: 101,
            custom: {
              type: 1,
              data: base64EncodeUtf8(JSON.stringify(content))
            }
          },
          redPointPolicy: 0,
          extension: { extJson: "{}" },
          ctx: { appVersion: "1.0", platform: "web" },
          mtags: {},
          msgReadStatusSetting: 1
        },
        { actualReceivers }
      ]
    };
    const sent = window.sendWebSocketMessage(JSON.stringify(payload));
    debugState.lastSendOk = sent;
    if (!sent) return false;
    debugState.lastReply = part;
  }
  return true;
}

async function adjustPrice(amountCents: number, orderId: string): Promise<void> {
  const data = createAdjustPriceRequest(amountCents, orderId);
  debugState.lastAdjustRequest = safeJsonPreview({ amountCents, orderId });
  debugState.lastAdjustResponse = "";
  if (!window.lib?.mtop?.request) {
    throw new Error("xianyu mtop unavailable");
  }
  const mtopResult = await window.lib.mtop.request({
    v: "1.0",
    type: "POST",
    appKey: "34839810",
    accountSite: "xianyu",
    dataType: "json",
    timeout: 20_000,
    needLoginPC: false,
    showErrorToast: false,
    api: "mtop.taobao.idle.trade.user.adjust.price",
    needLogin: false,
    sessionOption: "AutoLoginOnly",
    ecode: 0,
    data: createAdjustPriceRequest(amountCents, orderId)
  });
  decodeAdjustPriceResponse(mtopResult);
  debugState.lastAdjustResponse = safeJsonPreview({ channel: "xianyu-mtop", decoded: true, data });
}

async function fetchOrderDetail(orderId: string): Promise<VerifiedOrderAmounts> {
  if (!window.lib?.mtop?.request) {
    const cause = new Error("xianyu mtop unavailable");
    throw new XianyuOrderDetailRequestError("order detail request unavailable", { cause });
  }
  let mtopResult: unknown;
  try {
    mtopResult = await window.lib.mtop.request({
      v: "1.0",
      type: "POST",
      appKey: "34839810",
      accountSite: "xianyu",
      dataType: "json",
      timeout: 20_000,
      needLoginPC: false,
      showErrorToast: false,
      api: "mtop.idle.web.trade.order.detail",
      needLogin: false,
      sessionOption: "AutoLoginOnly",
      ecode: 0,
      data: createOrderDetailRequest(orderId)
    });
  } catch (error) {
    throw new XianyuOrderDetailRequestError("order detail request failed", { cause: error });
  }
  return decodeOrderDetailResponse(mtopResult, orderId);
}

async function consignDummy(platformOrderId: string): Promise<void> {
  if (!platformOrderId) {
    throw new Error("missing platform order id for xianyu dummy consign");
  }
  if (!window.lib?.mtop?.request) {
    throw new Error("xianyu mtop unavailable");
  }
  const mtopResult = await window.lib.mtop.request({
    v: "1.0",
    type: "POST",
    appKey: "34839810",
    accountSite: "xianyu",
    dataType: "json",
    api: "mtop.taobao.idle.logistic.consign.dummy",
    data: { orderId: platformOrderId, tradeText: "", picList: "[]", newUnconsign: true }
  });
  requireMtopSuccess(mtopResult, "xianyu mtop dummy consign");
}

async function request(action: string, payload: Record<string, unknown>): Promise<unknown> {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const responseEvent = `${RESPONSE_EVENT}:${requestId}`;
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener(responseEvent, handleResponse);
      reject(new Error(`extension bridge request timed out: ${action}`));
    }, 30_000);
    const handleResponse: EventListener = (event) => {
      window.clearTimeout(timeoutId);
      const detail = requireRecord((event as CustomEvent<unknown>).detail, `${action} bridge response`);
      const success = requireBoolean(detail.success, `${action} bridge response success`);
      if (!success) {
        reject(new Error(requireNonEmptyString(detail.error, `${action} bridge response error`)));
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(detail, "payload")) {
        reject(new Error(`${action} bridge response is missing payload`));
        return;
      }
      resolve(detail.payload);
    };
    window.addEventListener(responseEvent, handleResponse, { once: true });
    window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: { requestId, action, payload } }));
  });
}

async function requestBackend(action: string, payload: Record<string, unknown>): Promise<unknown> {
  return decodeBackendTransport(await request(action, payload), action);
}

async function registerWaitingPayment(
  event: Extract<XianyuInboundEvent, { kind: "WAITING_PAYMENT_CARD" }>
): Promise<WaitingPaymentResult> {
  const payload = requireRecord(await requestBackend("REGISTER_WAITING_PAYMENT", {
    platformOrderId: event.orderId,
    chatId: event.chatId,
    buyerUserId: event.senderId,
    sellerUserId: getCookie("unb") || undefined,
    itemId: event.itemId,
    messageId: event.messageId
  }), "waiting-payment response");
  return {
    platformOrderId: requireNonEmptyString(payload.platformOrderId, "waiting-payment platformOrderId"),
    quoteNo: requireNonEmptyString(payload.quoteNo, "waiting-payment quoteNo"),
    totalPriceCents: requirePositiveSafeInteger(payload.totalPriceCents, "waiting-payment totalPriceCents"),
    status: requireLiteral(payload.status, "WAIT_BUYER_PAY", "waiting-payment status")
  };
}

async function recordAdjusted(orderId: string, amountCents: number): Promise<void> {
  const response = await requestBackend("RECORD_ADJUSTED", {
    platformOrderId: orderId,
    adjustedAmountCents: requirePositiveSafeInteger(amountCents, "adjusted amount cents")
  });
  decodeAdjustedOrderResult(response, orderId);
}

async function resolveActiveOrder(chatId: string): Promise<{ platformOrderId: string }> {
  const payload = requireRecord(
    await requestBackend("RESOLVE_ACTIVE_ORDER", { chatId }),
    "resolved active order"
  );
  return { platformOrderId: requireNonEmptyString(payload.platformOrderId, "resolved platformOrderId") };
}

async function verifyPaid(orderId: string, amounts: VerifiedOrderAmounts): Promise<void> {
  const result = classifyPaidVerificationResult(await requestBackend("VERIFY_PAID", {
    platformOrderId: orderId,
    paidAmountCents: requirePositiveSafeInteger(amounts.actualPaidAmountCents, "paid amount cents"),
    itemTotalCents: requirePositiveSafeInteger(amounts.itemTotalCents, "item total cents"),
    postFeeCents: requireNonNegativeSafeInteger(amounts.postFeeCents, "post fee cents"),
    source: "XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT"
  }));
  if (result.order.platformOrderId !== orderId) {
    throw new Error("paid verification response platformOrderId mismatch");
  }
  switch (result.kind) {
    case "ACTIVE":
      activeOrders.set(result.order.platformOrderId, {
        platformOrderId: result.order.platformOrderId,
        chatId: result.order.chatId,
        receiverId: result.order.buyerUserId
      });
      await sendTemplate(
        result.order.chatId,
        result.order.buyerUserId,
        "payment_successful",
        orderIdPlaceholders(result.order)
      );
      return;
    case "NEED_MANUAL":
      activeOrders.delete(result.order.platformOrderId);
      await sendTemplate(
        result.order.chatId,
        result.order.buyerUserId,
        "cancel_ticket",
        orderIdPlaceholders(result.order)
      );
      return;
    case "TERMINAL":
      activeOrders.delete(result.order.platformOrderId);
      return;
    default:
      return assertNever(result);
  }
}

async function recordVerificationFailure(orderId: string, code: XianyuVerificationFailureCode): Promise<unknown> {
  return requestBackend("RECORD_VERIFICATION_FAILURE", { platformOrderId: orderId, code });
}

async function recordUnboundProtocolEvent(chatId: string, eventType: string): Promise<void> {
  await requestBackend("RECORD_PROTOCOL_EVENT", { chatId, eventType });
}

async function sendEditPriceSuccess(chatId: string, receiverId: string): Promise<void> {
  await sendTemplate(chatId, receiverId, "edit_price_success");
}

async function handleTextMessage(
  event: Extract<XianyuInboundEvent, { kind: "TEXT_MESSAGE" }>
): Promise<void> {
  if (!(await getAutomationConfig()).autoReply) {
    rememberDebugEvent(event, "auto-reply-off");
    return;
  }
  if (recentlyHandled(event.kind, event.chatId, event.messageId)) return;
  const config = await getReplyConfig();
  const matched = matchKeywordRule(event.text, config.xianyuKeywordReplyRules);
  if (matched?.reply) {
    await sendText(event.chatId, event.senderId, renderTemplate(matched.reply, {}));
    return;
  }
  if (config.xianyuAutoReplyTextFallback) {
    await sendTemplate(event.chatId, event.senderId, "text_message_replay");
  }
}

async function handleImageMessage(
  event: Extract<XianyuInboundEvent, { kind: "IMAGE_MESSAGE" }>
): Promise<void> {
  if (!(await getAutomationConfig()).autoReply) {
    rememberDebugEvent(event, "auto-reply-off");
    return;
  }
  if (recentlyHandled(event.kind, event.chatId, event.messageId)) return;
  debugState.lastImageUrl = event.imageUrl;
  debugState.lastBackendError = "";
  await sendTemplate(event.chatId, event.senderId, "identify_wait");
  const quoteRequest = {
    chatId: event.chatId,
    messageId: event.messageId,
    buyerUserId: event.senderId,
    itemId: event.itemId,
    imageUrl: event.imageUrl
  };
  debugState.lastQuoteRequest = safeJsonPreview(quoteRequest);
  const payload = requireRecord(await requestBackend("QUOTE_IMAGE", quoteRequest), "quote response data");
  debugState.lastQuoteResponse = safeJsonPreview(payload);
  requireRecord(payload.quote, "quote response quote");
  requireNonEmptyString(payload.replyMessage, "quote response replyMessage");
  await sendTemplate(event.chatId, event.senderId, "identify_success", quotePlaceholders(payload));
}

async function quoteImageFromUrl(chatId: string, receiverId: string, imageUrl: string): Promise<any> {
  const quoteRequest = {
    chatId,
    messageId: `debug-${Date.now()}`,
    buyerUserId: receiverId,
    buyerNickname: "",
    itemId: "",
    imageUrl
  };
  debugState.lastImageUrl = imageUrl;
  debugState.lastQuoteRequest = safeJsonPreview(quoteRequest);
  const payload = requireRecord(await requestBackend("QUOTE_IMAGE", quoteRequest), "debug quote response data");
  debugState.lastQuoteResponse = safeJsonPreview(payload);
  requireRecord(payload.quote, "debug quote response quote");
  const sent = await sendTemplate(chatId, receiverId, "identify_success", quotePlaceholders(payload));
  return { ok: true, sent, payload };
}

async function sendTemplate(
  chatId: string,
  receiverId: string,
  templateKey: string,
  placeholders: Record<string, string> = {}
): Promise<boolean> {
  const config = await getReplyConfig();
  const template = requireNonEmptyString(
    config.xianyuReplyMessageTemplates[templateKey],
    `reply template ${templateKey}`
  );
  for (const part of splitReply(renderTemplate(template, placeholders))) {
    if (!await sendText(chatId, receiverId, part)) {
      throw new Error(`failed to send reply template ${templateKey}`);
    }
  }
  return true;
}

async function getReplyConfig(): Promise<ReplyConfig> {
  if (replyConfigCache && Date.now() - replyConfigCacheAt < 30_000) {
    return replyConfigCache;
  }
  const payload = requireRecord(await request("GET_REPLY_CONFIG", {}), "reply config");
  replyConfigCache = {
    xianyuReplyMessageTemplates: requireTemplateMap(payload.xianyuReplyMessageTemplates, "reply config templates"),
    xianyuKeywordReplyRules: requireKeywordRules(payload.xianyuKeywordReplyRules, "reply config keyword rules"),
    xianyuAutoReplyTextFallback: requireBoolean(
      payload.xianyuAutoReplyTextFallback,
      "reply config text fallback enabled"
    )
  };
  replyConfigCacheAt = Date.now();
  return replyConfigCache;
}

async function getAutomationConfig(): Promise<AutomationConfig> {
  if (automationConfigCache && Date.now() - automationConfigCacheAt < 30_000) {
    return automationConfigCache;
  }
  const payload = requireRecord(await request("GET_AUTOMATION_CONFIG", {}), "automation config");
  automationConfigCache = {
    autoReply: requireBoolean(payload.autoReply, "automation config autoReply"),
    xianyuDeliverSendImageEnabled: requireBoolean(
      payload.xianyuDeliverSendImageEnabled,
      "automation config xianyuDeliverSendImageEnabled"
    )
  };
  automationConfigCacheAt = Date.now();
  return automationConfigCache;
}

function matchKeywordRule(text: string, rules: KeywordReplyRule[]): KeywordReplyRule | null {
  const lowerText = text.toLowerCase();
  return [...rules]
    .filter((rule) => rule.enabled)
    .sort((left, right) => left.priority - right.priority)
    .find((rule) => rule.keywords.some((keyword) => lowerText.includes(keyword.toLowerCase()))) ?? null;
}

function renderTemplate(template: string, placeholders: Record<string, string>): string {
  const rendered = Object.entries(placeholders).reduce((text, [key, value]) => {
    return text.replaceAll(`[${key}]`, value);
  }, template);
  const unresolved = rendered.replaceAll("[分割符]", "").match(/\[[^\[\]]+]/);
  if (unresolved) {
    throw new Error(`reply template contains unresolved placeholder: ${unresolved[0]}`);
  }
  return rendered;
}

function splitReply(text: string): string[] {
  return text
    .split("[分割符]")
    .map((part) => part.trim())
    .filter(Boolean);
}

function findMsgpack(): { decode(value: Uint8Array): unknown } | null {
  return window.msgpack ?? null;
}

function recentlyHandled(action: string, chatId: string, messageId: string): boolean {
  const now = Date.now();
  const key = `${action}:${chatId}:${messageId}`;
  const last = processedMessages.get(key) || 0;
  processedMessages.set(key, now);
  if (processedMessages.size > 500) {
    for (const [entryKey, handledAt] of processedMessages) {
      if (now - handledAt > 60_000) {
        processedMessages.delete(entryKey);
      }
    }
  }
  return now - last < 10_000;
}

type XianyuNoOpEvent = Extract<
  XianyuInboundEvent,
  { kind: "ACK" | "SESSION_SIGNAL" | "PNM_STATUS" | "ORDER_CONTEXT" | "WAITING_PAYMENT_SUMMARY" | "IGNORED_TIP_MESSAGE" }
>;

function isExplicitNoOp(event: XianyuInboundEvent): event is XianyuNoOpEvent {
  switch (event.kind) {
    case "ACK":
    case "SESSION_SIGNAL":
    case "PNM_STATUS":
    case "ORDER_CONTEXT":
    case "WAITING_PAYMENT_SUMMARY":
    case "IGNORED_TIP_MESSAGE":
      return true;
    default:
      return false;
  }
}

function decodeBackendTransport(value: unknown, context: string): unknown {
  const transport = requireRecord(value, `${context} HTTP transport`);
  const transportSuccess = requireBoolean(transport.success, `${context} HTTP transport success`);
  const status = requireInteger(transport.status, `${context} HTTP status`);
  if (!Object.prototype.hasOwnProperty.call(transport, "data")) {
    throw new Error(`${context} HTTP transport is missing data`);
  }
  const envelope = requireRecord(transport.data, `${context} backend envelope`);
  const businessSuccess = requireBoolean(envelope.success, `${context} backend success`);
  const message = requireNonEmptyString(envelope.message, `${context} backend message`);
  if (!Object.prototype.hasOwnProperty.call(envelope, "data")) {
    throw new Error(`${context} backend envelope is missing data`);
  }
  const httpSuccess = status >= 200 && status < 300;
  if (transportSuccess !== httpSuccess) {
    throw new Error(`${context} HTTP transport status mismatch: ${status}`);
  }
  if (httpSuccess !== businessSuccess) {
    throw new Error(`${context} backend status mismatch for HTTP ${status}: ${message}`);
  }
  if (!businessSuccess) {
    throw new Error(`${context} failed: ${message}`);
  }
  return envelope.data;
}

function quotePlaceholders(value: unknown): Record<string, string> {
  const payload = requireRecord(value, "quote placeholder payload");
  const quote = requireRecord(payload.quote, "quote placeholder payload.quote");
  const info = requireRecord(quote.ticketInfo, "quote ticketInfo");
  const seats = requireArray(info.seats, "quote ticketInfo seats")
    .map((seat, index) => requireNonEmptyString(seat, `quote ticketInfo seats[${index}]`));
  const seatCount = requireInteger(info.seatCount, "quote ticketInfo seatCount");
  if (seatCount <= 0 || seatCount !== seats.length) {
    throw new Error("quote ticketInfo seatCount must equal the non-empty seats array length");
  }
  return {
    订单号: requireNonEmptyString(payload.quoteNo, "quote number"),
    城市: requireNonEmptyString(info.cityName, "quote cityName"),
    影院地址: requireNonEmptyString(info.cinemaAddress, "quote cinemaAddress"),
    影院名: requireNonEmptyString(info.cinemaName, "quote cinemaName"),
    影厅名: requireNonEmptyString(info.hallName, "quote hallName"),
    影片名: requireNonEmptyString(info.movieName, "quote movieName"),
    放映时间: formatShowTime(requireNonEmptyString(info.showTime, "quote showTime")),
    座位信息: seats.join(","),
    单座位报价: money(requirePositiveNumber(quote.finalPrice, "quote finalPrice")),
    整单报价: money(requirePositiveNumber(quote.totalPrice, "quote totalPrice"))
  };
}

function orderIdPlaceholders(payload: XianyuOrderPayload): Record<string, string> {
  return { 订单号: payload.platformOrderId };
}

function deliveryPlaceholders(payload: XianyuOrderPayload): Record<string, string> {
  const ticketItems = parseTicketItems(payload.ticketCodeInfo);
  return {
    订单号: payload.platformOrderId,
    取票码: ticketItems.map((item) => item.ticket ?? item.ticketCode).join(",")
  };
}

function requireTemplateMap(value: unknown, context: string): Record<string, string> {
  const templates = requireRecord(value, context);
  return Object.fromEntries(Object.entries(templates).map(([key, template]) => [
    key,
    requireNonEmptyString(template, `${context}.${key}`)
  ]));
}

function requireKeywordRules(value: unknown, context: string): KeywordReplyRule[] {
  return requireArray(value, context).map((item, index) => {
    const rule = requireRecord(item, `${context}[${index}]`);
    const keywords = requireArray(rule.keywords, `${context}[${index}].keywords`)
      .map((keyword, keywordIndex) => requireNonEmptyString(keyword, `${context}[${index}].keywords[${keywordIndex}]`));
    if (keywords.length === 0) {
      throw new Error(`${context}[${index}].keywords cannot be empty`);
    }
    return {
      id: optionalString(rule.id, `${context}[${index}].id`),
      enabled: requireBoolean(rule.enabled, `${context}[${index}].enabled`),
      keywords,
      priority: requireInteger(rule.priority, `${context}[${index}].priority`),
      reply: requireNonEmptyString(rule.reply, `${context}[${index}].reply`)
    };
  });
}

function formatShowTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("quote showTime must be an ISO date-time string");
  }
  return value.replace("T", " ").slice(0, 16);
}

function money(value: number): string {
  return value.toFixed(2).replace(/\.00$/, "");
}

function parseTicketItems(ticketCodeInfo: unknown): TicketItem[] {
  const serialized = requireNonEmptyString(ticketCodeInfo, "ticketCodeInfo");
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error("ticketCodeInfo must be valid JSON", { cause: error });
  }
  const root = requireRecord(parsed, "ticketCodeInfo");
  const items = requireArray(root.ticketItems, "ticketCodeInfo.ticketItems");
  if (items.length === 0) {
    throw new Error("ticketCodeInfo.ticketItems cannot be empty for delivery");
  }
  return items.map((item, index) => {
    const record = requireRecord(item, `ticketCodeInfo.ticketItems[${index}]`);
    const ticket = optionalString(record.ticket, `ticketCodeInfo.ticketItems[${index}].ticket`);
    const ticketCode = optionalString(record.ticketCode, `ticketCodeInfo.ticketItems[${index}].ticketCode`);
    if (!ticket && !ticketCode) {
      throw new Error(`ticketCodeInfo.ticketItems[${index}] must contain ticket or ticketCode`);
    }
    return { ticket, ticketCode };
  });
}

function ticketItemValue(item: TicketItem): string {
  if (item.ticket) return item.ticket;
  return requireNonEmptyString(item.ticketCode, "ticket item ticketCode");
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  return value;
}

function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${context} must be boolean`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, context: string): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${context} must be a string or null`);
  }
  return value || undefined;
}

function requireInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${context} must be an integer`);
  }
  return value;
}

function requirePositiveSafeInteger(value: unknown, context: string): number {
  const result = requireNonNegativeSafeInteger(value, context);
  if (result === 0) throw new Error(`${context} must be positive`);
  return result;
}

function requireNonNegativeSafeInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative safe integer`);
  }
  return value;
}

function requireLiteral<T extends string>(value: unknown, expected: T, context: string): T {
  if (value !== expected) throw new Error(`${context} must equal ${expected}`);
  return expected;
}

function requirePositiveNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${context} must be a positive finite number`);
  }
  return value;
}

function base64EncodeUtf8(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function messageMid(): string {
  return `${Math.floor(Math.random() * 1000)}${Date.now()} 0`;
}

function messageUuid(): string {
  return `-${Date.now()}1`;
}

function getCookie(name: string): string {
  return document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`))
    ?.split("=")[1] || "";
}

function isOwnSellerMessage(senderId: string): boolean {
  const sellerId = getCookie("unb");
  return Boolean(senderId && sellerId && senderId === sellerId);
}

function maskSensitiveWords(text: string): string {
  return ["QQ", "Q群"].reduce((value, word) => value.replaceAll(word, "***"), text);
}

function requireMtopSuccess(value: unknown, context: string): Record<string, unknown> {
  const response = requireRecord(value, `${context} response`);
  const ret = requireArray(response.ret, `${context} response ret`)
    .map((item, index) => requireNonEmptyString(item, `${context} response ret[${index}]`));
  if (ret.length === 0) {
    throw new Error(`${context} response ret cannot be empty`);
  }
  const status = ret[0].split("::", 1)[0];
  if (status !== "SUCCESS") {
    throw new Error(`${context} failed: ${ret.join("; ")}`);
  }
  return requireRecord(response.data, `${context} response data`);
}

function getDebugStatus(): Record<string, unknown> {
  return {
    ...debugState,
    msgpackAvailable: Boolean(findMsgpack()),
    activeOrderIds: Array.from(activeOrders.keys()),
    deliveryPollsInFlight: Array.from(deliveryPollsInFlight)
  };
}

function publishDebugStatus(status: Record<string, unknown> = getDebugStatus()): void {
  document.documentElement.setAttribute("data-xianyu-movie-ticket-hook", HOOK_VERSION);
  document.documentElement.setAttribute("data-xianyu-movie-ticket-injected-at", debugState.injectedAt);
  document.documentElement.setAttribute("data-xianyu-movie-ticket-last-error", debugState.lastError);
  document.documentElement.setAttribute("data-xianyu-movie-ticket-status", safeJsonPreview(status));
}

function emitDebugStatus(): Record<string, unknown> {
  const status = getDebugStatus();
  publishDebugStatus(status);
  window.dispatchEvent(new CustomEvent(STATUS_RESPONSE_EVENT, { detail: status }));
  console.info("[xianyu-ticket] status", status);
  return status;
}

function rememberDebugEvent(event: XianyuInboundEvent, stage: string): void {
  debugState.recentMessages.unshift({
    at: new Date().toISOString(),
    stage,
    kind: event.kind,
    chatId: "chatId" in event ? event.chatId : "",
    senderId: "senderId" in event ? event.senderId : "",
    messageId: "messageId" in event ? event.messageId : ""
  });
  debugState.recentMessages = debugState.recentMessages.slice(0, 10);
}

function safeJsonPreview(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("diagnostic value is not JSON serializable");
  return serialized.slice(0, 800);
}

function assertNever(value: never): never {
  throw new Error(`unhandled xianyu event: ${JSON.stringify(value)}`);
}

interface ActiveOrder {
  platformOrderId: string;
  chatId: string;
  receiverId: string;
}

interface ReplyConfig {
  xianyuReplyMessageTemplates: Record<string, string>;
  xianyuKeywordReplyRules: KeywordReplyRule[];
  xianyuAutoReplyTextFallback: boolean;
}

interface AutomationConfig {
  autoReply: boolean;
  xianyuDeliverSendImageEnabled: boolean;
}

interface KeywordReplyRule {
  id?: string;
  enabled: boolean;
  keywords: string[];
  priority: number;
  reply: string;
}

interface TicketItem {
  ticket?: string;
  ticketCode?: string;
}

interface DebugState {
  hookVersion: string;
  injectedAt: string;
  socketHookInstalled: boolean;
  socketConnected: boolean;
  rawMessages: number;
  decodedMessages: number;
  lastRawAt: string;
  lastDecodedAt: string;
  lastContent: string;
  lastChatId: string;
  lastSenderId: string;
  lastReply: string;
  lastError: string;
  msgpackAvailable: boolean;
  lastSendOk: boolean;
  lastSendCid: string;
  lastSendReceiverId: string;
  lastSendAckMessageId: string;
  lastSendAckContent: string;
  lastConversationId: string;
  lastImageUrl: string;
  lastQuoteRequest: string;
  lastQuoteResponse: string;
  lastBackendError: string;
  lastWaitPayRequest: string;
  lastLatestQuoteResponse: string;
  lastAdjustRequest: string;
  lastAdjustResponse: string;
  lastAdjustFailure: string;
  lastHeadInfoRequest: string;
  lastHeadInfoResponse: string;
  lastPaidRequest: string;
  lastPaidResponse: string;
  recentMessages: DebugMessage[];
}

interface DebugMessage {
  at: string;
  stage: string;
  kind: XianyuInboundEvent["kind"];
  chatId: string;
  senderId: string;
  messageId: string;
}

void adjustPrice;
