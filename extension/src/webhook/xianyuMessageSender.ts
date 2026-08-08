/**
 * 闲鱼 IM 消息发送器。
 *
 * 通过页面 hook 暴露的 window.sendWebSocketMessage 桥，按闲鱼 `sendByReceiverScope`
 * 协议发送文字消息与票码图片消息。发送成功判定沿用第一版协议限制：
 * WebSocket 为 OPEN 且 send() 未抛异常，不等待服务端回执，也不自动补发。
 * socket 的 OPEN 状态由页面主 hook 通过 setSocketOpenChecker 注册。
 */
import type { UploadedTicketImage } from "../handlers/ticketDeliveryAutomation.ts";
import { createTicketImageMessageContent } from "../handlers/ticketImageMessage.ts";
import {
  debugState,
  logBiz,
  logBizError,
  maskSensitiveWords
} from "./xianyuDebugState.ts";

let socketOpenChecker: (() => boolean) | null = null;

/** 注册闲鱼 WebSocket 的 OPEN 状态检查函数（由页面主 hook 提供）。 */
export function setSocketOpenChecker(checker: () => boolean): void {
  socketOpenChecker = checker;
}

function isGoofishSocketOpen(): boolean {
  return socketOpenChecker !== null && socketOpenChecker();
}

/** 发送文字消息；发送失败抛错。 */
export async function sendText(chatId: string, receiverId: string, text: string): Promise<boolean> {
  if (!sendTextByWebSocket(chatId, receiverId, text)) {
    throw new Error("xianyu websocket text send failed");
  }
  return true;
}

/** 发送图片消息（第一版按文字 URL 发送）。 */
export async function sendImage(chatId: string, receiverId: string, imageUrl: string): Promise<boolean> {
  return sendText(chatId, receiverId, imageUrl);
}

/** 通过 WebSocket 发送一张已上传的票码图片消息。 */
export async function sendTicketImageByWebSocket(
  chatId: string,
  receiverId: string,
  image: UploadedTicketImage
): Promise<boolean> {
  if (!window.sendWebSocketMessage || !isGoofishSocketOpen()) {
    return false;
  }
  const sellerId = getCookie("unb");
  const actualReceivers = [
    `${receiverId}@goofish`,
    sellerId ? `${sellerId}@goofish` : ""
  ].filter(Boolean);
  const content = createTicketImageMessageContent(image);
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
            type: 2,
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
  logBiz("发送票码图片", {
    chatId,
    receiverId,
    width: image.width,
    height: image.height
  });
  logBiz("发送票码图片_RESPONSE", { sent });
  return sent;
}

/** 通过 WebSocket 发送一段文字消息；返回是否成功。 */
export function sendTextByWebSocket(chatId: string, receiverId: string, text: string): boolean {
  if (!window.sendWebSocketMessage || !chatId || !receiverId || !text) {
    debugState.lastSendOk = false;
    debugState.lastError = "send skipped: websocket bridge or recipient/content is missing";
    logBizError("发送文字", new Error("websocket bridge or recipient/content is missing"), {
      chatId,
      receiverId,
      hasBridge: Boolean(window.sendWebSocketMessage),
      textLength: text.length
    });
    return false;
  }
  const sellerId = getCookie("unb");
  const actualReceivers = [`${receiverId}@goofish`, sellerId ? `${sellerId}@goofish` : ""].filter(Boolean);
  const part = maskSensitiveWords(text);
  logBiz("发送文字", {
    chatId,
    receiverId,
    receiverCount: actualReceivers.length,
    textLength: text.length
  });
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
          },
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
  logBiz("发送文字_RESPONSE", {
    chatId,
    receiverId,
    sent
  });
  return true;
}

/** 读取指定 Cookie 的值。 */
export function getCookie(name: string): string {
  return document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`))
    ?.split("=")[1] || "";
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
