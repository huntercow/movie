/**
 * 闲鱼 MTop 交易执行器。
 *
 * 封装三个闲鱼 MTop 动作的请求构造、页面登录态调用、响应解码与重试：
 * 改价（adjust.price）、订单详情查询（order.detail，付款校验读取实际成交金额）、
 * 待付款 headinfo 查询（解析闲鱼订单号）。请求构造与响应解码来自
 * protocol/xianyuTradeProtocol.ts，这里只负责“调用页面 mtop + 成功判定 + 重试/调试记录”。
 *
 * mtop 客户端与 canExecute 由创建方注入，使本模块可脱离页面全局独立测试；
 * 每个主动动作发起前都会重新检查自动工作开关，动作中开关被关闭立即停止。
 */
import {
  XianyuOrderDetailRequestError,
  createAdjustPriceRequest,
  createCancelOrderRequest,
  createOrderDetailRequest,
  createWaitingPaymentHeadInfoRequest,
  decodeAdjustPriceResponse,
  decodeCancelOrderResponse,
  decodeOrderDetailResponse,
  decodeWaitingPaymentHeadInfoResponse,
  type VerifiedOrderAmounts
} from "../protocol/xianyuTradeProtocol.ts";
import {
  debugState,
  logBiz,
  logBizError,
  publishDebugStatus,
  safeErrorMessage,
  safeJsonPreview
} from "./xianyuDebugState.ts";

/** 改价前等待闲鱼订单状态落库的时长。 */
const ADJUST_PRICE_SETTLE_DELAY_MS = 5_000;
/** 改价最大尝试次数（含首次）。 */
const ADJUST_PRICE_MAX_ATTEMPTS = 5;
/** 可重试失败之间的退避间隔。 */
const ADJUST_PRICE_RETRY_DELAY_MS = 3_000;

/** 取消订单前等待闲鱼订单状态落库的时长（参考插件固定 5 秒）。 */
const CANCEL_ORDER_SETTLE_DELAY_MS = 5_000;
/** 取消订单最大尝试次数（含首次，参考插件 6 次）。 */
const CANCEL_ORDER_MAX_ATTEMPTS = 6;
/** 取消订单失败重试间隔。 */
const CANCEL_ORDER_RETRY_DELAY_MS = 3_000;

/** 页面 MTop 客户端的最小接口（保持 this 绑定，调用形式为 mtop.request(...)）。 */
export interface XianyuMtopClient {
  request(options: Record<string, unknown>): Promise<unknown>;
}

/** 执行器依赖：自动工作开关检查、页面 MTop 客户端获取器、可选等待实现。 */
export interface XianyuMtopExecutorOptions {
  canExecute(): Promise<boolean>;
  getMtop(): XianyuMtopClient | null;
  wait?: (milliseconds: number) => Promise<void>;
}

/** 执行器对外接口：改价 / 订单详情 / 待付款 headinfo / 取消订单。 */
export interface XianyuMtopExecutor {
  adjustPrice(amountCents: number, orderId: string): Promise<void>;
  fetchOrderDetail(orderId: string): Promise<VerifiedOrderAmounts>;
  fetchWaitingPaymentHeadInfo(chatId: string, itemId: string): Promise<string>;
  /** 取消闲鱼订单：成功返回 true，重试耗尽返回 false，mtop 不可用抛错。 */
  cancelOrder(orderId: string): Promise<boolean>;
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

/** 改价响应摘要：只保留 api、ret 前缀、data 键与 success 标志。 */
function summarizeAdjustPriceResponse(value: unknown): string {
  const response = requireRecord(value, "adjust price response summary");
  const ret = requireArray(response.ret, "adjust price response summary ret")
    .map((item, index) => requireNonEmptyString(item, `adjust price response summary ret[${index}]`));
  const data = requireRecord(response.data, "adjust price response summary data");
  return safeJsonPreview({
    api: requireNonEmptyString(response.api, "adjust price response summary api"),
    ret: ret.map((item) => item.split("::", 1)[0]),
    dataKeys: Object.keys(data).sort(),
    success: data.success
  });
}

/** 是否属于可重试的改价业务失败（订单金额不允许修改等瞬时业务状态）。 */
function isRetryableAdjustPriceError(error: unknown): boolean {
  return safeErrorMessage(error).includes("FAIL_BIZ_CANNOT_MODIFY_FEE");
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

function requireNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

/** 创建闲鱼 MTop 交易执行器。 */
export function createXianyuMtopExecutor(options: XianyuMtopExecutorOptions): XianyuMtopExecutor {
  const { canExecute, getMtop } = options;
  const wait = options.wait ?? defaultWait;

  return {
    /**
     * 修改闲鱼订单价格：等待订单落库后最多尝试 5 次，每次发起前重新检查
     * 自动工作开关；ret 成功且 data.success === true 才算业务成功。
     */
    async adjustPrice(amountCents: number, orderId: string): Promise<void> {
      const mtop = getMtop();
      logBiz("改价", { orderId, amountCents });
      const requestData = createAdjustPriceRequest(amountCents, orderId);
      debugState.lastAdjustRequest = safeJsonPreview({ amountCents, orderId, request: requestData });
      debugState.lastAdjustResponse = "";
      debugState.lastAdjustFailure = "";
      debugState.lastAdjustAttempt = 0;
      debugState.lastAdjustStartedAt = new Date().toISOString();
      debugState.lastAdjustFinishedAt = "";
      debugState.lastError = "";
      publishDebugStatus();
      if (!mtop?.request) {
        const error = new Error("xianyu mtop unavailable");
        debugState.lastAdjustFailure = error.message;
        debugState.lastAdjustFinishedAt = new Date().toISOString();
        publishDebugStatus();
        logBizError("改价", error, { orderId });
        throw error;
      }
      // 待付款卡片刚出现时，闲鱼订单状态可能仍在同步，沿用参考插件先等待平台落库。
      await wait(ADJUST_PRICE_SETTLE_DELAY_MS);
      for (let attempt = 1; attempt <= ADJUST_PRICE_MAX_ATTEMPTS; attempt += 1) {
        if (!await canExecute()) {
          throw new Error("automation stopped before adjust-price request");
        }
        debugState.lastAdjustAttempt = attempt;
        publishDebugStatus();
        try {
          const mtopResult = await mtop.request({
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
            data: requestData
          });
          decodeAdjustPriceResponse(mtopResult);
          debugState.lastAdjustResponse = summarizeAdjustPriceResponse(mtopResult);
          debugState.lastAdjustFailure = "";
          debugState.lastAdjustFinishedAt = new Date().toISOString();
          publishDebugStatus();
          logBiz("改价_RESPONSE", {
            orderId,
            amountCents,
            attempt,
            response: debugState.lastAdjustResponse
          });
          return;
        } catch (error) {
          debugState.lastAdjustFailure = safeErrorMessage(error);
          const retryable = isRetryableAdjustPriceError(error);
          logBizError("改价", error, {
            orderId,
            amountCents,
            attempt,
            retryable,
            willRetry: attempt < ADJUST_PRICE_MAX_ATTEMPTS && retryable
          });
          if (attempt === ADJUST_PRICE_MAX_ATTEMPTS || !retryable) {
            debugState.lastAdjustFinishedAt = new Date().toISOString();
            publishDebugStatus();
            throw error;
          }
          if (!await canExecute()) {
            throw new Error("automation stopped after adjust-price failure");
          }
          publishDebugStatus();
          await wait(ADJUST_PRICE_RETRY_DELAY_MS);
        }
      }
      throw new Error("adjust price attempts exhausted");
    },

    /**
     * 读取闲鱼订单详情实际成交金额：必须与预期订单号匹配，返回成交价/商品总价/运费
     * （整数分）。请求失败与协议失败分别抛 XianyuOrderDetailRequestError。
     */
    async fetchOrderDetail(orderId: string): Promise<VerifiedOrderAmounts> {
      const mtop = getMtop();
      logBiz("查询订单详情", { orderId });
      const requestData = createOrderDetailRequest(orderId);
      debugState.lastPaidRequest = safeJsonPreview({ orderId, request: requestData });
      debugState.lastPaidResponse = "";
      publishDebugStatus();
      if (!mtop?.request) {
        const cause = new Error("xianyu mtop unavailable");
        debugState.lastPaidResponse = safeErrorMessage(cause);
        publishDebugStatus();
        logBizError("查询订单详情", cause, { orderId });
        throw new XianyuOrderDetailRequestError("order detail request unavailable", { cause });
      }
      let mtopResult: unknown;
      try {
        mtopResult = await mtop.request({
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
          data: requestData
        });
      } catch (error) {
        debugState.lastPaidResponse = safeErrorMessage(error);
        publishDebugStatus();
        logBizError("查询订单详情", error, { orderId });
        throw new XianyuOrderDetailRequestError("order detail request failed", { cause: error });
      }
      try {
        const amounts = decodeOrderDetailResponse(mtopResult, orderId);
        debugState.lastPaidResponse = safeJsonPreview({ decoded: true, ...amounts });
        publishDebugStatus();
        logBiz("查询订单详情_RESPONSE", { orderId, ...amounts });
        return amounts;
      } catch (error) {
        debugState.lastPaidResponse = safeErrorMessage(error);
        publishDebugStatus();
        logBizError("查询订单详情", error, { orderId });
        throw error;
      }
    },

    /**
     * 待付款系统提醒分支：按 chatId + productId 查询闲鱼订单号；
     * 解码成功返回 orderId，否则抛错（由调用方按未取得订单号处理）。
     */
    async fetchWaitingPaymentHeadInfo(chatId: string, itemId: string): Promise<string> {
      const mtop = getMtop();
      logBiz("获取闲鱼订单号", { chatId, itemId });
      const data = createWaitingPaymentHeadInfoRequest(chatId, itemId);
      debugState.lastHeadInfoRequest = safeJsonPreview({ chatId, itemId });
      debugState.lastHeadInfoResponse = "";
      if (!mtop?.request) {
        const error = new Error("xianyu mtop unavailable");
        debugState.lastHeadInfoResponse = safeErrorMessage(error);
        publishDebugStatus();
        logBizError("获取闲鱼订单号", error, { chatId });
        throw error;
      }
      try {
        const response = await mtop.request({
          v: "1.0",
          type: "POST",
          appKey: "34839810",
          accountSite: "xianyu",
          dataType: "json",
          timeout: 20_000,
          needLoginPC: false,
          showErrorToast: false,
          api: "mtop.idle.trade.pc.message.headinfo",
          needLogin: false,
          sessionOption: "AutoLoginOnly",
          ecode: 0,
          data
        });
        const orderId = decodeWaitingPaymentHeadInfoResponse(response);
        debugState.lastHeadInfoResponse = safeJsonPreview({ decoded: true, platformOrderId: orderId });
        publishDebugStatus();
        logBiz("获取闲鱼订单号_RESPONSE", { chatId, orderId });
        return orderId;
      } catch (error) {
        debugState.lastHeadInfoResponse = safeErrorMessage(error);
        publishDebugStatus();
        logBizError("获取闲鱼订单号", error, { chatId });
        throw error;
      }
    },

    /**
     * 取消闲鱼订单（卖家侧关闭）：调用前固定等待 5 秒让订单状态落库，
     * 最多尝试 6 次、失败间隔 3 秒，每次发起前复查自动工作开关；
     * ret SUCCESS 即成功返回 true，重试耗尽返回 false（调用方据此决定
     * 后续处理），mtop 客户端不可用时抛错。
     */
    async cancelOrder(orderId: string): Promise<boolean> {
      const mtop = getMtop();
      logBiz("取消订单", { orderId });
      const requestData = createCancelOrderRequest(orderId);
      debugState.lastCancelRequest = safeJsonPreview({ orderId, request: requestData });
      debugState.lastCancelResponse = "";
      debugState.lastCancelFailure = "";
      debugState.lastCancelAttempt = 0;
      debugState.lastCancelStartedAt = new Date().toISOString();
      debugState.lastCancelFinishedAt = "";
      debugState.lastError = "";
      publishDebugStatus();
      if (!mtop?.request) {
        const error = new Error("xianyu mtop unavailable");
        debugState.lastCancelFailure = error.message;
        debugState.lastCancelFinishedAt = new Date().toISOString();
        publishDebugStatus();
        logBizError("取消订单", error, { orderId });
        throw error;
      }
      // 订单状态可能仍在同步，沿用参考插件先等待平台落库。
      await wait(CANCEL_ORDER_SETTLE_DELAY_MS);
      for (let attempt = 1; attempt <= CANCEL_ORDER_MAX_ATTEMPTS; attempt += 1) {
        if (!await canExecute()) {
          throw new Error("automation stopped before cancel-order request");
        }
        debugState.lastCancelAttempt = attempt;
        publishDebugStatus();
        try {
          const response = await mtop.request({
            v: "2.0",
            type: "POST",
            appKey: "34839810",
            accountSite: "xianyu",
            dataType: "json",
            timeout: 20_000,
            needLoginPC: false,
            showErrorToast: false,
            ext_querys: { spm_cnt: "a21ybx.im.0.0", spm_pre: "", log_id: "" },
            api: "mtop.taobao.idle.trade.close.by.seller",
            needLogin: false,
            sessionOption: "AutoLoginOnly",
            ecode: 0,
            data: requestData
          });
          // 协议成功判定：api 匹配且 ret[0] 为 SUCCESS（decodeCancelOrderResponse）。
          decodeCancelOrderResponse(response);
          debugState.lastCancelResponse = "SUCCESS";
          debugState.lastCancelFailure = "";
          debugState.lastCancelFinishedAt = new Date().toISOString();
          publishDebugStatus();
          logBiz("取消订单_RESPONSE", { orderId, attempt });
          return true;
        } catch (error) {
          debugState.lastCancelFailure = safeErrorMessage(error);
          logBizError("取消订单", error, {
            orderId,
            attempt,
            willRetry: attempt < CANCEL_ORDER_MAX_ATTEMPTS
          });
          if (attempt === CANCEL_ORDER_MAX_ATTEMPTS) {
            debugState.lastCancelFinishedAt = new Date().toISOString();
            publishDebugStatus();
            return false;
          }
          if (!await canExecute()) {
            throw new Error("automation stopped after cancel-order failure");
          }
          publishDebugStatus();
          await wait(CANCEL_ORDER_RETRY_DELAY_MS);
        }
      }
      throw new Error("cancel order attempts exhausted");
    }
  };
}
