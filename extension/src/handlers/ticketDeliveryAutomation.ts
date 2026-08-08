/**
 * 出票结果交付自动化。
 *
 * 处理出票结果轮询返回的订单：status 50 出票成功——按 ticketItems 原顺序下载上传
 * 并发送全部票码图片，再发一次 send_ticket_success，最后回写 DELIVERY_SUCCEEDED；
 * 任一环节失败回写 DELIVERY_FAILED（含失败阶段与已发图片数），不重发已发内容。
 * status 450 出票失败——发 cancel_ticket 通知买家、调用卖家取消、回写
 * TICKET_FAILURE_HANDLED，不重新报价或加价。
 */
import type {
  ReplyTemplateKey,
  TicketResult,
  UpdateOrderResultRequest
} from "./backendApi.ts";
import type {
  ReplyTemplateValues,
  TextDeliveryResult
} from "./replyAutomation.ts";

/** 已上传到闲鱼的票码图片：URL 与尺寸。 */
export interface UploadedTicketImage {
  url: string;
  width: number;
  height: number;
}

/** 卖家取消闲鱼订单的结果：issued false 未发出；issued true 带明确成败。 */
export type SellerCancellationResult =
  | { issued: false }
  | { issued: true; succeeded: boolean };

/** 交付工作流依赖的外部端口：图片上传/发送、话术、取消与结果回写。 */
export interface TicketDeliveryAutomationPort {
  canExecute(): Promise<boolean>;
  downloadAndUploadImage(sourceUrl: string): Promise<UploadedTicketImage>;
  sendImage(
    chatId: string,
    receiverId: string,
    image: UploadedTicketImage
  ): Promise<boolean>;
  deliverTemplate(
    templateKey: Extract<ReplyTemplateKey, "send_ticket_success" | "cancel_ticket">,
    values: ReplyTemplateValues,
    chatId: string,
    receiverId: string
  ): Promise<TextDeliveryResult>;
  cancelSellerOrder(xianyuOrderId: string): Promise<SellerCancellationResult>;
  updateOrderResult(request: UpdateOrderResultRequest): Promise<void>;
}

/**
 * 交付工作流结果：STOPPED 自动工作关闭；DELIVERY_SUCCEEDED 交付成功；
 * DELIVERY_FAILED 交付失败（含阶段与已发图片数）；TICKET_FAILURE_HANDLED 出票失败已处理。
 */
export type TicketDeliveryWorkflowResult =
  | { kind: "STOPPED" }
  | { kind: "DELIVERY_SUCCEEDED"; sentImageCount: number }
  | {
      kind: "DELIVERY_FAILED";
      failureStage: "TICKET_IMAGE" | "SUCCESS_MESSAGE";
      sentImageCount: number;
    }
  | {
      kind: "TICKET_FAILURE_HANDLED";
      noticeSent: boolean;
      cancelSucceeded: boolean;
    };

/** 按出票结果分发：status 50 走成功交付，status 450 走失败处理。 */
export async function handleTicketResult(
  result: TicketResult,
  port: TicketDeliveryAutomationPort
): Promise<TicketDeliveryWorkflowResult> {
  switch (result.status) {
    case 50:
      return deliverSuccessfulTicketResult(result, port);
    case 450:
      return handleFailedTicketResult(result, port);
    default:
      return assertNever(result);
  }
}

/**
 * 交付出票成功订单（status 50）：对每张带原始票码图的票发送图片 -> 一次
 * send_ticket_success（[取票码] 含全部票码）-> 回写 DELIVERY_SUCCEEDED。
 * 良票不提供票码原图（ticketCodeOriginImage 为空）时跳过该票的图片发送，
 * 票码由话术占位符交付；图片下载/上传或发送失败按 TICKET_IMAGE 阶段回写失败；
 * 成功话术失败按 SUCCESS_MESSAGE 阶段回写；中途自动化关闭仅回写已发图片数。
 */
async function deliverSuccessfulTicketResult(
  result: Extract<TicketResult, { status: 50 }>,
  port: TicketDeliveryAutomationPort
): Promise<TicketDeliveryWorkflowResult> {
  let sentImageCount = 0;

  for (const item of result.ticketCodeInfo.ticketItems) {
    if (item.ticketCodeOriginImage === "") {
      // 无原始票码图：不发送图片，票码走 send_ticket_success 话术。
      continue;
    }
    if (!await port.canExecute()) {
      return stopOrSettleSentImages(result.id, sentImageCount, port);
    }

    let image: UploadedTicketImage;
    try {
      image = await port.downloadAndUploadImage(item.ticketCodeOriginImage);
    } catch {
      if (!await port.canExecute()) {
        return stopOrSettleSentImages(result.id, sentImageCount, port);
      }
      return settleDeliveryFailure(result.id, "TICKET_IMAGE", sentImageCount, port);
    }

    if (!await port.canExecute()) {
      return stopOrSettleSentImages(result.id, sentImageCount, port);
    }

    let imageSent = false;
    try {
      imageSent = await port.sendImage(result.chatId, result.customerId, image);
    } catch {
      imageSent = false;
    }
    if (!imageSent) {
      if (!await port.canExecute()) {
        return stopOrSettleSentImages(result.id, sentImageCount, port);
      }
      return settleDeliveryFailure(result.id, "TICKET_IMAGE", sentImageCount, port);
    }
    sentImageCount += 1;
  }

  if (!await port.canExecute()) {
    return stopOrSettleSentImages(result.id, sentImageCount, port);
  }

  let messageDelivery: TextDeliveryResult;
  try {
    messageDelivery = await port.deliverTemplate(
      "send_ticket_success",
      {
        businessOrderId: result.id,
        ticketCodes: result.ticketCodeInfo.ticketItems.map((item) => item.ticketCode)
      },
      result.chatId,
      result.customerId
    );
  } catch {
    return settleDeliveryFailure(result.id, "SUCCESS_MESSAGE", sentImageCount, port);
  }
  if (!messageDelivery.success) {
    return settleDeliveryFailure(
      result.id,
      messageDelivery.stoppedByAutomation && messageDelivery.sentSegmentCount === 0
        ? "TICKET_IMAGE"
        : "SUCCESS_MESSAGE",
      sentImageCount,
      port
    );
  }

  await port.updateOrderResult({
    id: result.id,
    result: "DELIVERY_SUCCEEDED"
  });
  return { kind: "DELIVERY_SUCCEEDED", sentImageCount };
}

/**
 * 处理出票失败订单（status 450）：先发送 cancel_ticket（有限重试），
 * 无论通知成败都继续调用卖家取消，最后回写 TICKET_FAILURE_HANDLED 并结束；
 * 不重新报价、不重新加价、不重试出票。
 */
async function handleFailedTicketResult(
  result: Extract<TicketResult, { status: 450 }>,
  port: TicketDeliveryAutomationPort
): Promise<TicketDeliveryWorkflowResult> {
  if (!await port.canExecute()) {
    return { kind: "STOPPED" };
  }
  let noticeSent = false;
  let noticeStoppedByAutomation = false;
  try {
    const delivery = await port.deliverTemplate(
      "cancel_ticket",
      { businessOrderId: result.id },
      result.chatId,
      result.customerId
    );
    noticeSent = delivery.success;
    noticeStoppedByAutomation = delivery.stoppedByAutomation;
  } catch {
    noticeSent = false;
  }

  if (noticeStoppedByAutomation || !await port.canExecute()) {
    return { kind: "STOPPED" };
  }

  const cancellation = await port.cancelSellerOrder(result.xianyuOrderId);
  if (!cancellation.issued) {
    return { kind: "STOPPED" };
  }
  const cancelSucceeded = cancellation.succeeded;

  await port.updateOrderResult({
    id: result.id,
    result: "TICKET_FAILURE_HANDLED",
    noticeSent,
    cancelSucceeded
  });
  return {
    kind: "TICKET_FAILURE_HANDLED",
    noticeSent,
    cancelSucceeded
  };
}

/** 自动工作关闭时：未发送任何图片直接 STOPPED，否则按 TICKET_IMAGE 阶段收尾。 */
async function stopOrSettleSentImages(
  businessOrderId: string,
  sentImageCount: number,
  port: TicketDeliveryAutomationPort
): Promise<TicketDeliveryWorkflowResult> {
  if (sentImageCount === 0) {
    return { kind: "STOPPED" };
  }
  return settleDeliveryFailure(
    businessOrderId,
    "TICKET_IMAGE",
    sentImageCount,
    port
  );
}

/** 回写 DELIVERY_FAILED（失败阶段 + 已发图片数），后端停止返回该订单转人工。 */
async function settleDeliveryFailure(
  businessOrderId: string,
  failureStage: "TICKET_IMAGE" | "SUCCESS_MESSAGE",
  sentImageCount: number,
  port: TicketDeliveryAutomationPort
): Promise<TicketDeliveryWorkflowResult> {
  await port.updateOrderResult({
    id: businessOrderId,
    result: "DELIVERY_FAILED",
    failureStage,
    sentImageCount
  });
  return { kind: "DELIVERY_FAILED", failureStage, sentImageCount };
}

/** 穷尽检查：不支持的出票结果状态抛错。 */
function assertNever(value: never): never {
  throw new Error(`unexpected ticket result ${String(value)}`);
}
