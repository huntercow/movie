import {
  ProtocolCaptureSession,
  decodeCaptureCommand,
  decodeSocketFrame,
  type CaptureCommand,
} from "./protocolCapture.ts";
import {
  decodeXianyuPayload,
  type XianyuInboundEvent,
} from "./xianyuProtocol.ts";
import {
  decodeTicketResults,
  decodeQuoteTaskResult,
  decodeReplyConfig,
  type QuoteTaskResult,
  type ReplyConfig,
  type ReplyTemplateKey,
} from "../handlers/backendApi.ts";
import type { ActiveActionPermit } from "../handlers/automationLifecycle.ts";
import {
  decideTextReply,
  deliverTextSegmentsWithRetry,
  matchKeywordRule,
  renderReplyTemplate,
  writeOpenWebSocket,
  type ReplyTemplateValues,
  type TextDeliveryResult,
} from "../handlers/replyAutomation.ts";
import {
  createWaitingPaymentAutomation,
  decodeAdjustmentCompletion,
  decodeAdjustmentPermit,
  decodeWaitingPaymentLookupResult,
} from "../handlers/waitingPaymentAutomation.ts";
import {
  createPaidVerificationAutomation,
  decodePaidActionPermit,
  decodePaidAdvanceCompletion,
  decodePaidMismatchCancellationCompletion,
  decodePaidOrderLookupResult,
  decodePaidReadCompletion,
} from "../handlers/paidVerificationAutomation.ts";
import { handleTicketResult } from "../handlers/ticketDeliveryAutomation.ts";
import { uploadGoofishTicketImage } from "../handlers/ticketImageUpload.ts";
import { createTicketResultPoller } from "../handlers/ticketResultPoller.ts";
import {
  HOOK_VERSION,
  debugState,
  describeOutgoingWebSocketPayload,
  emitDebugStatus,
  getDebugStatus,
  logBiz,
  logBizError,
  maskIdentifier,
  publishDebugStatus,
  recordSocketFailure,
  rememberDebugEvent,
  safeErrorMessage,
  safeJsonPreview,
  trace,
  traceError,
  traceWarn,
} from "./xianyuDebugState.ts";
import {
  getCookie,
  sendImage,
  sendText,
  sendTextByWebSocket,
  sendTicketImageByWebSocket,
  setSocketOpenChecker,
} from "./xianyuMessageSender.ts";
import { createXianyuMtopExecutor } from "./xianyuMtopExecutor.ts";

const REQUEST_EVENT = "FILM_AI_LOCAL_TOOL_REQUEST";
const RESPONSE_EVENT = "FILM_AI_LOCAL_TOOL_RESPONSE";
const STATUS_REQUEST_EVENT = "FILM_AI_XIANYU_STATUS_REQUEST";
const CAPTURE_REQUEST_EVENT = "FILM_AI_XIANYU_CAPTURE_REQUEST";
const CAPTURE_RESPONSE_EVENT = "FILM_AI_XIANYU_CAPTURE_RESPONSE";
const TICKET_POLL_NOW_EVENT = "FILM_AI_XIANYU_TICKET_POLL_NOW";
const HOOK_CONTROL_EVENT = "FILM_AI_XIANYU_HOOK_CONTROL";
const HOOK_STATE_REQUEST_EVENT = "FILM_AI_XIANYU_HOOK_STATE_REQUEST";
const ENABLE_PROTOCOL_CAPTURE = import.meta.env.DEV;
const processedMessages = new Map<string, number>();
const buyerUserIdsByChatId = new Map<string, string>();
const captureSession = new ProtocolCaptureSession();
let activeGoofishSocket: WebSocket | null = null;
let hookEnabled = false;

const mtopExecutor = createXianyuMtopExecutor({
  canExecute: canExecuteAutomation,
  getMtop: () => window.lib?.mtop ?? null,
});

const waitingPaymentAutomation = createWaitingPaymentAutomation({
  canExecute: canExecuteAutomation,
  async lookupWaitingPayment(chatId) {
    return decodeWaitingPaymentLookupResult(
      await request("LOOKUP_WAITING_PAYMENT", { chatId }),
    );
  },
  resolveHeadInfoOrderId: (chatId, productId) =>
    mtopExecutor.fetchWaitingPaymentHeadInfo(chatId, productId),
  async beginAdjustment(businessOrderId, xianyuOrderId) {
    return decodeAdjustmentPermit(
      await request("BEGIN_PRICE_ADJUSTMENT", { businessOrderId, xianyuOrderId }),
    );
  },
  adjustPrice: (amountCents, xianyuOrderId) =>
    mtopExecutor.adjustPrice(amountCents, xianyuOrderId),
  async settleAdjusted(statusRequest, permit) {
    return decodeAdjustmentCompletion(
      await request("SETTLE_PRICE_ADJUSTMENT", {
        ...statusRequest,
        effect: permit.effect,
        automationRevision: permit.automationRevision,
      }),
    );
  },
  async deliverTemplate(templateKey, values, chatId, receiverId) {
    const targetReceiverId =
      receiverId ?? buyerUserIdsByChatId.get(chatId) ?? null;
    if (targetReceiverId === null) {
      trace("message:template-skipped", {
        templateKey,
        reason: "waiting-payment-receiver-unavailable",
        chatId: maskIdentifier(chatId),
      });
      return { success: false, stoppedByAutomation: false };
    }
    return deliverTemplate(chatId, targetReceiverId, templateKey, values);
  },
  async proposeSellerCancellation(xianyuOrderId) {
    try {
      const ok = await mtopExecutor.cancelOrder(xianyuOrderId);
      trace("seller-cancel:proposed", {
        xianyuOrderId: maskIdentifier(xianyuOrderId),
        ok,
      });
    } catch (error) {
      traceWarn("seller-cancel:unavailable", {
        xianyuOrderId: maskIdentifier(xianyuOrderId),
        error: safeErrorMessage(error),
      });
    }
  },
});
const paidVerificationAutomation = createPaidVerificationAutomation({
  canExecute: canExecuteAutomation,
  async lookupPaidOrder(chatId) {
    return decodePaidOrderLookupResult(
      await request("LOOKUP_PAID_ORDER", { chatId }),
    );
  },
  async beginOrderDetailRead() {
    return decodePaidActionPermit(
      await request("BEGIN_ORDER_DETAIL_READ", {}),
      "READ",
    );
  },
  fetchOrderDetail: (xianyuOrderId) =>
    mtopExecutor.fetchOrderDetail(xianyuOrderId),
  async completeOrderDetailRead(permit) {
    return decodePaidReadCompletion(
      await request("COMPLETE_ORDER_DETAIL_READ", {
        effect: permit.effect,
        automationRevision: permit.automationRevision,
      }),
    );
  },
  async advancePaid(businessOrderId, actualPaidAmountCents) {
    return decodePaidAdvanceCompletion(
      await request("ADVANCE_PAID_ORDER", {
        id: businessOrderId,
        actualPaidAmountCents,
      }),
    );
  },
  async beginMismatchCancellation(businessOrderId) {
    return decodePaidActionPermit(
      await request("BEGIN_MISMATCH_CANCELLATION", { id: businessOrderId }),
      "WRITE",
    );
  },
  async cancelSellerOrder(xianyuOrderId) {
    try {
      const ok = await mtopExecutor.cancelOrder(xianyuOrderId);
      const result = ok
        ? { issued: true, succeeded: true }
        : { issued: true, succeeded: false };
      trace("seller-cancel:result", {
        xianyuOrderId: maskIdentifier(xianyuOrderId),
        result,
      });
      return result;
    } catch (error) {
      traceWarn("seller-cancel:unavailable", {
        xianyuOrderId: maskIdentifier(xianyuOrderId),
        error: safeErrorMessage(error),
      });
      return { issued: false };
    }
  },
  async completeMismatchCancellation(completionRequest, permit) {
    return decodePaidMismatchCancellationCompletion(
      await request("COMPLETE_MISMATCH_CANCELLATION", {
        ...completionRequest,
        effect: permit.effect,
        automationRevision: permit.automationRevision,
      }),
    );
  },
  async deliverPaymentSuccessful(chatId, receiverId, businessOrderId) {
    return deliverTemplate(chatId, receiverId, "payment_successful", {
      businessOrderId,
    });
  },
  async deliverCancelNotice(chatId, receiverId, businessOrderId) {
    return deliverTemplate(chatId, receiverId, "cancel_ticket", {
      businessOrderId,
    });
  },
});
const ticketResultPoller = createTicketResultPoller({
  clock: {
    setInterval: (callback, milliseconds) =>
      window.setInterval(callback, milliseconds),
    clearInterval: (handle) => window.clearInterval(handle as number),
  },
  port: {
    canExecute: canExecuteAutomation,
    isSocketOpen: isGoofishSocketOpen,
    async getTicketResults() {
      return decodeTicketResults(await request("GET_TICKET_RESULTS", {}));
    },
    handleTicketResult: handlePolledTicketResult,
    reportError(error) {
      debugState.lastError = safeErrorMessage(error);
      traceError("ticket-delivery:poll-failed", error);
      publishDebugStatus();
    },
  },
});

export {};

declare global {
  interface Window {
    lib?: {
      mtop?: { request(options: Record<string, unknown>): Promise<unknown> };
    };
    msgpack?: { decode(value: Uint8Array): unknown };
    sendWebSocketMessage?: (payload: string) => boolean;
    sendMsgText?: (
      chatId: string,
      receiverId: string,
      text: string,
    ) => Promise<boolean>;
    sendMsgImage?: (
      chatId: string,
      receiverId: string,
      imageUrl: string,
    ) => Promise<boolean>;
    xianyuMovieTicketDebug?: Record<string, unknown>;
  }
}

installWebSocketHook();
setSocketOpenChecker(isGoofishSocketOpen);
installGlobals();
installTicketPollEvents();
installHookControlEvents();
publishDebugStatus();
requestHookState();
trace("hook:ready", {
  hookVersion: HOOK_VERSION,
  hookEnabled,
  socketHookInstalled: debugState.socketHookInstalled,
  msgpackAvailable: Boolean(findMsgpack()),
});

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
        socket.addEventListener("open", () => {
          debugState.socketConnected = true;
          publishDebugStatus();
          if (hookEnabled) {
            void ticketResultPoller.socketOpened();
          }
        });
        socket.addEventListener("message", (event) => {
          if (!hookEnabled) {
            return;
          }
          void handleSocketMessage(event.data).catch((error) =>
            recordSocketFailure(error, event.data),
          );
        });
        socket.addEventListener("close", () => {
          debugState.socketConnected = false;
          if (activeGoofishSocket === socket) {
            activeGoofishSocket = null;
          }
          publishDebugStatus();
          // 连接一死立即刷新重连（参考插件行为）：close 是明确的连接死亡
          // 信号，刷新让闲鱼页面重建连接、插件重新注入 hook，防止断开期间漏单。
          // 仅插件启用时生效，避免用户关闭插件后断线还打扰页面。
          if (hookEnabled) {
            window.location.reload();
          }
        });
        socket.addEventListener("error", () => {
          traceWarn("websocket:error", { readyState: socket.readyState });
        });
      }
      return socket;
    },
  }) as typeof WebSocket;
  debugState.socketHookInstalled = true;
  window.sendWebSocketMessage = (payload) => {
    if (!hookEnabled) {
      traceWarn("websocket:send-skipped", {
        reason: "hook-disabled",
        payload: describeOutgoingWebSocketPayload(payload),
      });
      return false;
    }
    const sent = writeOpenWebSocket(activeGoofishSocket, payload);
    if (!sent) {
      traceWarn("websocket:send-skipped", {
        reason: "socket-unavailable",
        payload: describeOutgoingWebSocketPayload(payload),
      });
      return false;
    }
    return true;
  };
}

function installTicketPollEvents(): void {
  window.addEventListener(TICKET_POLL_NOW_EVENT, () => {
    if (!hookEnabled) {
      return;
    }
    void ticketResultPoller.pollNow();
  });
}

function installHookControlEvents(): void {
  window.addEventListener(HOOK_CONTROL_EVENT, ((event: Event) => {
    try {
      const detail = requireRecord(
        (event as CustomEvent<unknown>).detail,
        "hook control detail",
      );
      setHookEnabled(requireBoolean(detail.enabled, "hook control enabled"));
    } catch (error) {
      traceWarn("hook:control-ignored", { error: safeErrorMessage(error) });
    }
  }) as EventListener);
}

function requestHookState(): void {
  window.dispatchEvent(new CustomEvent(HOOK_STATE_REQUEST_EVENT));
}

function setHookEnabled(enabled: boolean): void {
  if (hookEnabled === enabled) {
    debugState.hookEnabled = enabled;
    publishDebugStatus();
    return;
  }
  hookEnabled = enabled;
  debugState.hookEnabled = enabled;
  if (enabled) {
    void ticketResultPoller.start();
    if (isGoofishSocketOpen()) {
      void ticketResultPoller.socketOpened();
    }
  } else {
    ticketResultPoller.stop();
  }
  publishDebugStatus();
  trace("hook:state-changed", { enabled });
}

function isGoofishSocketOpen(): boolean {
  return hookEnabled && activeGoofishSocket?.readyState === WebSocket.OPEN;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function handlePolledTicketResult(
  result: import("../handlers/backendApi.ts").TicketResult,
): Promise<void> {
  const permit = decodeTicketDeliveryPermit(
    await request("BEGIN_TICKET_DELIVERY", { id: result.id }),
  );
  if (permit === null) {
    trace("ticket-delivery:stopped", {
      businessOrderId: maskIdentifier(result.id),
      reason: "automation-off-before-delivery",
    });
    return;
  }
  const workflow = await handleTicketResult(result, {
    async canExecute() {
      return isGoofishSocketOpen() && (await canExecuteAutomation());
    },
    downloadAndUploadImage: downloadAndUploadTicketImage,
    sendImage: sendTicketImageByWebSocket,
    async deliverTemplate(templateKey, values, chatId, receiverId) {
      return deliverTemplate(chatId, receiverId, templateKey, values);
    },
    async cancelSellerOrder(xianyuOrderId) {
      try {
        const ok = await mtopExecutor.cancelOrder(xianyuOrderId);
        const result = ok
          ? { issued: true, succeeded: true }
          : { issued: true, succeeded: false };
        trace("seller-cancel:result", {
          xianyuOrderId: maskIdentifier(xianyuOrderId),
          result,
        });
        return result;
      } catch (error) {
        traceWarn("seller-cancel:unavailable", {
          xianyuOrderId: maskIdentifier(xianyuOrderId),
          error: safeErrorMessage(error),
        });
        return { issued: false };
      }
    },
    async updateOrderResult(settlement) {
      await request("SETTLE_TICKET_RESULT", {
        ...settlement,
        effect: permit.effect,
        automationRevision: permit.automationRevision,
      });
    },
  });
  if (workflow.kind === "STOPPED") {
    await request("ABORT_TICKET_DELIVERY", {
      id: result.id,
      effect: permit.effect,
      automationRevision: permit.automationRevision,
    });
  }
  logBiz("交付票码_RESPONSE", {
    businessOrderId: result.id,
    result: workflow.kind,
  });
}

function decodeTicketDeliveryPermit(value: unknown): ActiveActionPermit | null {
  if (value === null) {
    return null;
  }
  const permit = requireRecord(value, "ticket delivery permit");
  requireExactKeys(
    permit,
    ["effect", "automationRevision"],
    "ticket delivery permit",
  );
  return {
    effect: requireLiteral(
      permit.effect,
      "WRITE",
      "ticket delivery permit effect",
    ),
    automationRevision: requireNonNegativeSafeInteger(
      permit.automationRevision,
      "ticket delivery permit automationRevision",
    ),
  };
}

async function downloadAndUploadTicketImage(
  sourceUrl: string,
): Promise<
  import("../handlers/ticketDeliveryAutomation.ts").UploadedTicketImage
> {
  const response = requireRecord(
    await request("FETCH_IMAGE_DATA_URL", { url: sourceUrl }),
    "ticket image download response",
  );
  if (
    !requireBoolean(response.success, "ticket image download response success")
  ) {
    throw new Error(
      requireNonEmptyString(
        response.error,
        "ticket image download response error",
      ),
    );
  }
  const dataUrl = requireNonEmptyString(
    response.dataUrl,
    "ticket image download response dataUrl",
  );
  if (!dataUrl.startsWith("data:")) {
    throw new Error(
      "ticket image download response dataUrl must be a data URL",
    );
  }
  const downloaded = await fetch(dataUrl);
  const blob = await downloaded.blob();
  return uploadGoofishTicketImage(
    new File([blob], "image.jpg", {
      type: "image/jpeg",
    }),
  );
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
    testKeyword: async (
      chatId: string,
      receiverId: string,
      content = "你好",
    ) => {
      const config = await getReplyConfig();
      const matched = matchKeywordRule(content, config.keywordRules);
      if (!matched?.reply) {
        return { matched: null, sent: false };
      }
      const sent = await sendText(chatId, receiverId, matched.reply);
      return { matched, sent };
    },
    adjustPrice: (amountCents: number, orderId: string) =>
      mtopExecutor.adjustPrice(amountCents, orderId),
    sendRaw: (chatId: string, receiverId: string, text: string) =>
      sendTextByWebSocket(chatId, receiverId, text),
  };
  publishDebugStatus();
}

function installPageDebugEvents(): void {
  window.addEventListener("FILM_AI_XIANYU_DEBUG_SEND", ((event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    const ok = sendTextByWebSocket(
      String(detail.chatId || ""),
      String(detail.receiverId || ""),
      String(detail.text || ""),
    );
    window.dispatchEvent(
      new CustomEvent("FILM_AI_XIANYU_DEBUG_SEND_RESULT", { detail: { ok } }),
    );
  }) as EventListener);
  window.addEventListener(STATUS_REQUEST_EVENT, () => emitDebugStatus());
  window.addEventListener("message", ((event: MessageEvent) => {
    if (
      event.source !== window ||
      event.data?.type !== "XIANYU_MOVIE_TICKET_STATUS"
    ) {
      return;
    }
    const status = emitDebugStatus();
    window.postMessage(
      { type: "XIANYU_MOVIE_TICKET_STATUS_RESPONSE", status },
      "*",
    );
  }) as EventListener);
}

function installProtocolCaptureEvents(): void {
  window.addEventListener(CAPTURE_REQUEST_EVENT, ((event: Event) => {
    const detail = requireRecord(
      (event as CustomEvent<unknown>).detail,
      "capture page request",
    );
    const requestId = requireNonEmptyString(
      detail.requestId,
      "capture page requestId",
    );
    let response: Record<string, unknown>;
    try {
      const command = decodeCaptureCommand(detail.command);
      response = {
        requestId,
        success: true,
        payload: executeCaptureCommand(command),
      };
    } catch (error) {
      response = {
        requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    window.dispatchEvent(
      new CustomEvent(`${CAPTURE_RESPONSE_EVENT}:${requestId}`, {
        detail: response,
      }),
    );
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

if (ENABLE_PROTOCOL_CAPTURE) {
  bootDebugEventsOnce();
}

/**
 * 闲鱼 WebSocket 入站消息的统一入口（由 installWebSocketHook 里 Proxy
 * 拦截的 socket message 事件调用，仅 hookEnabled 时生效）。
 *
 * 流程：decodeSocketFrame 拆外层帧（必要时 msgpack 解码）→
 * decodeXianyuPayload 严格解码为领域事件 → 记忆会话上下文 →
 * 过滤 no-op 与重复推送 → 按 event.kind 分派到各自动化。
 * 注意：本函数运行在 MAIN world，只能访问页面全局（window.WebSocket 等），
 * 任何需要后台/内容脚本的能力都必须经 request() 桥接。
 */
async function handleSocketMessage(data: unknown): Promise<void> {
  if (!hookEnabled) {
    return;
  }
  debugState.rawMessages += 1;
  debugState.lastRawAt = new Date().toISOString();
  const frames = decodeSocketFrame(data, (bytes) => {
    const msgpack = findMsgpack();
    debugState.msgpackAvailable = Boolean(msgpack);
    if (!msgpack) {
      throw new Error("msgpack decoder unavailable");
    }
    return msgpack.decode(bytes);
  });
  // 同一推送包可携带多条同步数据（如 /s/vulcan 的多会话唤起），逐条解码处理。
  for (const frame of frames) {
    if (
      ENABLE_PROTOCOL_CAPTURE &&
      captureSession.status().state === "CAPTURING"
    ) {
      captureSession.append(frame.transport, frame.payload);
    }
    const event = decodeXianyuPayload(frame.payload);
    // 记录「会话 → 买家 userId」映射：发话术需要 receiverId 时，
    // 若事件本身未带 senderId，可从 buyerUserIdsByChatId 兜底取买家 id。
    if (event.kind === "ORDER_CONTEXT") {
      buyerUserIdsByChatId.set(event.chatId, event.buyerUserId);
    } else if ("senderId" in event && !isOwnSellerMessage(event.senderId)) {
      buyerUserIdsByChatId.set(event.chatId, event.senderId);
    }
    debugState.decodedMessages += 1;
    debugState.lastDecodedAt = new Date().toISOString();
    rememberDebugEvent(event, "decoded");
    // 连接/会话类帧（ACK、SESSION_SIGNAL、PNM_STATUS、ORDER_CONTEXT、
    // IGNORED_TIP_MESSAGE）不触发任何业务，提前返回；
    // ORDER_CONTEXT 的用途仅止于上面的「买家映射」记录。
    if (isExplicitNoOp(event)) {
      continue;
    }
    switch (event.kind) {
      case "TEXT_MESSAGE": // 买家文字 → 关键词规则 / AI 客服自动回复（handleTextMessage）
        if (!isOwnSellerMessage(event.senderId)) {
          await handleTextMessage(event);
        }
        continue;
      case "IMAGE_MESSAGE": // 买家选座截图 → 异步报价工作流（handleImageMessage）
        if (!isOwnSellerMessage(event.senderId)) {
          await handleImageMessage(event);
        }
        continue;
      case "WAITING_PAYMENT_CARD":
      case "WAITING_PAYMENT_SUMMARY": // 待付款 → 查后端订单，报价不一致则 MTop 改价，发催付话术
        // chat 级去重（参考插件 y()）：同一买家 10 秒内只处理一次待付款事件，
        // 卡片与摘要共用 key；等价覆盖参考插件的 y(chatId + "_price_edit")——
        // 窗口内最多改一次价。
        if (!recentlyHandledChat("WAITING_PAYMENT", event.chatId)) {
          debugState.lastWaitPayRequest = safeJsonPreview({
            chatId: event.chatId,
            ...(event.kind === "WAITING_PAYMENT_CARD"
              ? {
                  messageId: event.messageId,
                  itemId: event.itemId,
                  xianyuOrderId: event.orderId,
                }
              : { source: "summary" }),
          });
          const result = await waitingPaymentAutomation.handle(event);
          debugState.lastWaitPayResponse = safeJsonPreview(result);
          publishDebugStatus();
          logBiz("待付款_RESPONSE", { kind: event.kind, result: result.kind });
        }
        continue;
      case "PAID_CARD":
      case "PAYMENT_SUMMARY": // 已付款 → 查单校验，推进出票，发付款成功话术
        // chat 级去重（参考插件 y(chat_id)）：同一买家 10 秒内只处理一次
        // 「等待卖家发货」，卡片与摘要共用 key，连下两单会被吞掉（刻意设计）。
        if (!recentlyHandledChat("PAID", event.chatId)) {
          const result = await paidVerificationAutomation.handle(event);
          if (result.kind === "NO_RECORD") {
            logBiz("付款校验_RESPONSE", {
              chatId: event.chatId,
              result: "NO_RECORD",
            });
          } else {
            logBiz("付款校验_RESPONSE", {
              kind: event.kind,
              result: result.kind,
            });
          }
        }
        continue;
      case "MESSAGE_UPDATE": // 改价更新：仅解码记录，暂不消费（协议演进观察点）
        continue;
      default:
        // 穷尽性兜底：未来新增 kind 未在此处理时，编译期 assertNever 即报错。
        return assertNever(event);
    }
  }
}

async function request(
  action: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const responseEvent = `${RESPONSE_EVENT}:${requestId}`;
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener(responseEvent, handleResponse);
      traceError(
        "bridge:timeout",
        new Error(`extension bridge request timed out: ${action}`),
        {
          action,
          requestId,
        },
      );
      reject(new Error(`extension bridge request timed out: ${action}`));
    }, 30_000);
    const handleResponse: EventListener = (event) => {
      window.clearTimeout(timeoutId);
      const detail = requireRecord(
        (event as CustomEvent<unknown>).detail,
        `${action} bridge response`,
      );
      const success = requireBoolean(
        detail.success,
        `${action} bridge response success`,
      );
      if (!success) {
        reject(
          new Error(
            requireNonEmptyString(
              detail.error,
              `${action} bridge response error`,
            ),
          ),
        );
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(detail, "payload")) {
        reject(new Error(`${action} bridge response is missing payload`));
        return;
      }
      resolve(detail.payload);
    };
    window.addEventListener(responseEvent, handleResponse, { once: true });
    window.dispatchEvent(
      new CustomEvent(REQUEST_EVENT, {
        detail: { requestId, action, payload },
      }),
    );
  });
}

/**
 * 处理买家文字消息：autoReply 开关门禁 → 拉话术配置 →
 * decideTextReply（关键词规则命中优先，否则走后端 AI，AI 返回 null 则静默）→
 * 分段发送（每段失败隔 1 秒重试、最多 3 次，重试期间自动化关闭立即停）。
 * 发送判定：WebSocket OPEN 且 send() 未抛异常即算成功，不等服务端回执。
 * 去重：与参考插件一致，只靠 chat 级窗口（handleSocketMessage 已挡重复推送）。
 */
async function handleTextMessage(
  event: Extract<XianyuInboundEvent, { kind: "TEXT_MESSAGE" }>,
): Promise<void> {
  logBiz("文字回复", {
    chatId: event.chatId,
    messageId: event.messageId,
    textLength: event.text.length,
    text:
      event.text.length > 200 ? `${event.text.slice(0, 200)}...` : event.text,
  });
  if (!(await getAutomationConfig()).autoReply) {
    rememberDebugEvent(event, "auto-reply-off");
    return;
  }
  const config = await getReplyConfig();
  const decision = await decideTextReply({
    event: {
      messageId: event.messageId,
      chatId: event.chatId,
      buyerUserId: event.senderId,
      itemId: event.itemId,
      content: event.text,
    },
    config,
    canExecute: canExecuteAutomation,
    getAiReply: async (aiRequest) => {
      const payload = requireRecord(
        await request("AI_CUSTOMER_SERVICE", { ...aiRequest }),
        "AI customer service response",
      );
      if (payload.reply === null) {
        return { reply: null };
      }
      return {
        reply: requireNonEmptyString(
          payload.reply,
          "AI customer service reply",
        ),
      };
    },
  });
  if (decision.kind === "AUTOMATION_OFF" || decision.kind === "SILENT") {
    logBiz("文字回复_RESPONSE", { mode: decision.kind.toLowerCase() });
    return;
  }
  const delivery = await deliverTextSegmentsWithRetry({
    segments: [decision.reply],
    canExecute: canExecuteAutomation,
    send: (segment) =>
      sendTextByWebSocket(event.chatId, event.senderId, segment),
    wait,
  });
  logBiz("文字回复_RESPONSE", {
    mode: decision.kind.toLowerCase(),
    sent: delivery.success,
    stoppedByAutomation: delivery.stoppedByAutomation,
  });
}

/**
 * 处理买家选座截图：autoReply 门禁 → 发「正在识别」→ 同步调后台报价
 * （下载/上传/OCR/双通道报价/定价一次完成）→ 按结果发话术。
 * 网络/协议错误简单重试（最多 2 次、间隔 2 秒），仍失败按识别失败处理；
 * 业务失败（识别不了/场次太近）直接发对应话术，不重试。
 * 去重：后台按 messageId 幂等缓存，重复推送直接复用结果。
 */
async function handleImageMessage(
  event: Extract<XianyuInboundEvent, { kind: "IMAGE_MESSAGE" }>,
): Promise<void> {
  logBiz("选座图报价", {
    chatId: event.chatId,
    messageId: event.messageId,
    imageUrl: event.imageUrl,
  });
  if (!(await getAutomationConfig()).autoReply) {
    rememberDebugEvent(event, "auto-reply-off");
    return;
  }
  const receiverId = event.senderId;
  const quoteRequest = {
    messageId: event.messageId,
    originPlatform: "xianyu" as const,
    chatId: event.chatId,
    customerId: event.senderId,
    customerName: event.customerName,
    productId: event.itemId,
    seatsImage: event.imageUrl,
  };

  // 先回「正在识别」，再同步等报价结果（发送失败则不继续报价）。
  const waitDelivery = await deliverTemplate(
    event.chatId,
    receiverId,
    "identify_wait",
    {},
  );
  if (!waitDelivery.success) {
    logBiz("选座图报价_RESPONSE", { mode: "wait-message-failed" });
    return;
  }

  // 简单有限重试：最多 2 次，间隔 2 秒。
  let task: QuoteTaskResult | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (!(await canExecuteAutomation())) {
      return;
    }
    try {
      task = decodeQuoteTaskResult(await request("QUOTE_IMAGE", quoteRequest));
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        traceWarn("quote:retry", {
          messageId: maskIdentifier(event.messageId),
          attempt,
          error: safeErrorMessage(error),
        });
        await wait(2_000);
      }
    }
  }
  if (task === null) {
    logBizError("选座图报价", lastError, {
      messageId: maskIdentifier(event.messageId),
    });
    return;
  }

  // 按终态发话术
  if (task.status === "SUCCEEDED") {
    const values = {
      businessOrderId: task.quote.id,
      cityName: task.quote.cityName,
      cinemaAddress: task.quote.cinemaAddress,
      cinemaName: task.quote.cinemaName,
      hallName: task.quote.hallName,
      filmName: task.quote.filmName,
      showTime: task.quote.showTime,
      seats: task.quote.seats,
      biddingPrice: task.quote.biddingPrice,
      amount: task.quote.amount,
    };
    await deliverTemplate(event.chatId, receiverId, "identify_success", values);
  } else if (
    task.status === "FAILED" &&
    task.failureCode === "SHOW_TIME_TOO_SHORT"
  ) {
    await deliverTemplate(event.chatId, receiverId, "show_time_too_short", {});
  } else if (task.status === "FAILED") {
    await deliverTemplate(event.chatId, receiverId, "identify_fail", {});
  } else {
    // 同步报价不返回 PROCESSING；出现则忽略（防御）。
    return;
  }
  logBiz("选座图报价_RESPONSE", {
    mode: "sync-quote",
    result: task.status,
    failureCode: task.status === "FAILED" ? task.failureCode : undefined,
  });
}

async function sendTemplate(
  chatId: string,
  receiverId: string,
  templateKey: ReplyTemplateKey,
  values: ReplyTemplateValues = {},
): Promise<boolean> {
  return (await deliverTemplate(chatId, receiverId, templateKey, values))
    .success;
}

async function deliverTemplate(
  chatId: string,
  receiverId: string,
  templateKey: ReplyTemplateKey,
  values: ReplyTemplateValues = {},
): Promise<TextDeliveryResult> {
  trace("message:template-start", {
    templateKey,
    chatId: maskIdentifier(chatId),
    receiverId: maskIdentifier(receiverId),
    placeholderKeys: Object.keys(values).sort(),
  });
  if (!(await canExecuteAutomation())) {
    trace("message:template-skipped", {
      templateKey,
      reason: "automation-off",
    });
    return {
      success: false,
      sentSegmentCount: 0,
      stoppedByAutomation: true,
    };
  }
  const config = await getReplyConfig();
  const parts = renderReplyTemplate(templateKey, config, values);
  const delivery = await deliverTextSegmentsWithRetry({
    segments: parts,
    canExecute: canExecuteAutomation,
    send: (segment) => sendTextByWebSocket(chatId, receiverId, segment),
    wait,
    maxRetries: templateKey === "send_ticket_success" ? 0 : 3,
  });
  trace("message:template-complete", { templateKey, partCount: parts.length });
  return delivery;
}

async function getReplyConfig(): Promise<ReplyConfig> {
  const replyConfig = decodeReplyConfig(await request("GET_REPLY_CONFIG", {}));
  trace("config:reply-loaded", {
    version: replyConfig.version,
    templateCount: Object.keys(replyConfig.templates).length,
    keywordRuleCount: replyConfig.keywordRules.length,
  });
  return replyConfig;
}

async function getAutomationConfig(): Promise<AutomationConfig> {
  const payload = requireRecord(
    await request("GET_AUTOMATION_CONFIG", {}),
    "automation config",
  );
  const automationConfig = {
    autoReply: requireBoolean(payload.autoReply, "automation config autoReply"),
    xianyuDeliverSendImageEnabled: requireBoolean(
      payload.xianyuDeliverSendImageEnabled,
      "automation config xianyuDeliverSendImageEnabled",
    ),
  };
  trace("config:automation-loaded", { ...automationConfig });
  return automationConfig;
}

async function canExecuteAutomation(): Promise<boolean> {
  if (!hookEnabled) {
    return false;
  }
  return (await getAutomationConfig()).autoReply;
}

function findMsgpack(): { decode(value: Uint8Array): unknown } | null {
  return window.msgpack ?? null;
}

/**
 * 滑动窗口去重核心：同一 key 在 windowMs 内重复出现返回 true。
 * 参考插件 xianyuImHook.y() 的 TS 化；记录超过 500 条时顺带清理
 * 60 秒前的旧记录，避免内存无界增长。
 */
function markHandled(key: string, windowMs: number): boolean {
  const now = Date.now();
  const last = processedMessages.get(key) || 0;
  processedMessages.set(key, now);
  if (processedMessages.size > 500) {
    for (const [entryKey, handledAt] of processedMessages) {
      if (now - handledAt > 60_000) {
        processedMessages.delete(entryKey);
      }
    }
  }
  return now - last < windowMs;
}

/**
 * chat 级去重：同一 (动作, 会话) 在 10 秒内只处理一次（参考插件 y() 语义）。
 * 用于待付款/已付款这类「动作事件」——同一买家 10 秒内连下两单会被吞掉，
 * 与参考插件「严禁连下两单」的刻意设计一致；动作前缀区分改价/发货等动作。
 */
function recentlyHandledChat(action: string, chatId: string): boolean {
  return markHandled(`${action}:${chatId}`, 10_000);
}

type XianyuNoOpEvent = Extract<
  XianyuInboundEvent,
  {
    kind:
      | "ACK"
      | "SESSION_SIGNAL"
      | "PNM_STATUS"
      | "ORDER_CONTEXT"
      | "IGNORED_TIP_MESSAGE"
      | "IGNORED_RESPONSE"
      | "IGNORED_MESSAGE_STATUS";
  }
>;

function isExplicitNoOp(event: XianyuInboundEvent): event is XianyuNoOpEvent {
  switch (event.kind) {
    case "ACK":
    case "SESSION_SIGNAL":
    case "PNM_STATUS":
    case "ORDER_CONTEXT":
    case "IGNORED_TIP_MESSAGE":
    case "IGNORED_RESPONSE":
    case "IGNORED_MESSAGE_STATUS":
      return true;
    default:
      return false;
  }
}

function requireRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  context: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${context} has an unexpected structure`);
  }
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

function requireInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${context} must be an integer`);
  }
  return value;
}

function requireNonNegativeSafeInteger(
  value: unknown,
  context: string,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative safe integer`);
  }
  return value;
}

function requireLiteral<T extends string>(
  value: unknown,
  expected: T,
  context: string,
): T {
  if (value !== expected) throw new Error(`${context} must equal ${expected}`);
  return expected;
}

function requirePositiveNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${context} must be a positive finite number`);
  }
  return value;
}

function isOwnSellerMessage(senderId: string): boolean {
  const sellerId = getCookie("unb");
  return Boolean(senderId && sellerId && senderId === sellerId);
}

function assertNever(value: never): never {
  throw new Error(`unhandled xianyu event: ${JSON.stringify(value)}`);
}

interface AutomationConfig {
  autoReply: boolean;
  xianyuDeliverSendImageEnabled: boolean;
}
