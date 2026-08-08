/**
 * 闲鱼 MTop 交易协议：请求构造与严格响应解码。
 *
 * 覆盖三个 MTop 动作：改价（adjust.price）、订单详情查询（order.detail，
 * 付款校验读取实际成交金额）与待付款 headinfo 查询（解析闲鱼订单号）。
 * 响应必须同时满足“ret[0] 为 SUCCESS”的协议成功和当前动作要求的明确业务字段
 * （如改价 data.success === true）才算业务成功；Promise resolve 不等于成功。
 */

/** 验款从订单详情中读取的金额（单位：整数分）。 */
export interface VerifiedOrderAmounts {
  actualPaidAmountCents: number;
  itemTotalCents: number;
  postFeeCents: number;
}

/** 订单详情请求失败（MTop 层失败或 ret 非 SUCCESS）。 */
export class XianyuOrderDetailRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "XianyuOrderDetailRequestError";
  }
}

/** 订单详情响应结构不合法（协议层失败）。 */
export class XianyuOrderDetailProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "XianyuOrderDetailProtocolError";
  }
}

type RecordValue = Record<string, unknown>;
type Failure = (message: string) => never;

/** 改价 MTop API。 */
const adjustPriceApi = "mtop.taobao.idle.trade.user.adjust.price";
/** 订单详情 MTop API。 */
const orderDetailApi = "mtop.idle.web.trade.order.detail";
/** 待付款 headinfo MTop API。 */
const waitingPaymentHeadInfoApi = "mtop.idle.trade.pc.message.headinfo";
/** 卖家取消订单 MTop API。 */
const cancelOrderApi = "mtop.taobao.idle.trade.close.by.seller";

/** 构造改价请求：modifyFee 为整数分，新运费固定 0。 */
export function createAdjustPriceRequest(amountCents: number, orderId: string): Record<string, unknown> {
  if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("amountCents must be a positive safe integer");
  }
  return { modifyFee: amountCents, newTransportFee: "0", orderId: requireOrderId(orderId) };
}

/** 构造订单详情请求：按闲鱼订单号查询。 */
export function createOrderDetailRequest(orderId: string): Record<string, unknown> {
  return { tid: requireOrderId(orderId) };
}

/** 构造待付款 headinfo 请求：按会话与商品查询闲鱼订单号。 */
export function createWaitingPaymentHeadInfoRequest(chatId: string, itemId: string): Record<string, unknown> {
  return {
    itemId: nonEmptyString(itemId, "itemId", fail),
    sessionId: nonEmptyString(chatId, "sessionId", fail),
    sessionType: 1
  };
}

/**
 * 构造取消订单请求：closeReason 固定为「其他原因」（参考插件确认值），
 * bizOrderId 与 tid 同传闲鱼订单号。
 */
export function createCancelOrderRequest(orderId: string): Record<string, unknown> {
  const confirmed = requireOrderId(orderId);
  return { tid: confirmed, closeReason: "其他原因", bizOrderId: confirmed };
}

/**
 * 解码 headinfo 响应：ret 成功且解析出非空 commonData.utArgs.orderId，
 * 否则视为未取得闲鱼订单号。
 */
export function decodeWaitingPaymentHeadInfoResponse(value: unknown): string {
  const response = requireRecord(value, "waiting-payment headinfo response", fail);
  literal(response.api, waitingPaymentHeadInfoApi, "waiting-payment headinfo api mismatch", fail);
  const status = successStatus(response.ret, fail);
  if (status !== "SUCCESS") throw new Error(`waiting-payment headinfo failed: ${status}`);
  const data = requireRecord(response.data, "waiting-payment headinfo data", fail);
  const commonData = requireRecord(data.commonData, "waiting-payment headinfo commonData", fail);
  const utArgs = requireRecord(commonData.utArgs, "waiting-payment headinfo utArgs", fail);
  return requireOrderId(utArgs.orderId);
}

/**
 * 解码取消订单响应：api 匹配且 ret[0] 为 SUCCESS 即视为协议成功。
 * 响应 data 结构尚无真实样本（参考插件以 request resolve 即判成功），
 * 因此只做最小确认，不做 data 键校验，避免无样本时误拒真实响应。
 */
export function decodeCancelOrderResponse(value: unknown): void {
  const response = requireRecord(value, "cancel order response", fail);
  literal(response.api, cancelOrderApi, "cancel order api mismatch", fail);
  const status = successStatus(response.ret, fail);
  if (status !== "SUCCESS") throw new Error(`cancel order failed: ${status}`);
}

/**
 * 解码改价响应：ret 为 SUCCESS 且 data.success === true 才算业务成功；
 * 只接受已确认的字段集合，不允许猜测式解析。
 */
export function decodeAdjustPriceResponse(value: unknown): void {
  const response = requireRecord(value, "adjust price response", fail);
  literal(response.api, adjustPriceApi, "adjust price api mismatch", fail);
  const status = successStatus(response.ret, fail);
  if (status !== "SUCCESS") throw new Error(`adjust price failed: ${status}`);

  // 直接调用 window.lib.mtop.request 时响应额外携带 responseHeaders/retType(与页面内部封装不同)
  keysWithOptional(response, ["api", "data", "ret", "traceId", "v"], ["responseHeaders", "retType"], "adjust price response", fail);

  const data = requireRecord(response.data, "adjust price data", fail);
  exactKeys(data, ["needDecryptKeys", "needDecryptKeysV2", "serverDecryptKeys", "serverTime", "success"], "adjust price data", fail);
  emptyArray(data.needDecryptKeys, "adjust price data.needDecryptKeys", fail);
  emptyArray(data.needDecryptKeysV2, "adjust price data.needDecryptKeysV2", fail);
  emptyArray(data.serverDecryptKeys, "adjust price data.serverDecryptKeys", fail);
  nonEmptyString(data.serverTime, "adjust price data.serverTime", fail);
  if (data.success !== true) throw new Error("data.success must be true");
  nonEmptyString(response.traceId, "adjust price traceId", fail);
  literal(response.v, "1.0", "adjust price version mismatch", fail);
}

/**
 * 解码订单详情响应并校验：订单号必须匹配预期值，读取成交价（amount.value）、
 * 商品总价与运费账单并验证三者一致（运费必须为 0）。
 * 返回实际成交金额（整数分）。
 */
export function decodeOrderDetailResponse(value: unknown, expectedOrderId: string): VerifiedOrderAmounts {
  const expectedId = requireOrderId(expectedOrderId, protocol);
  const response = requireRecord(value, "order detail response", protocol);
  literal(response.api, orderDetailApi, "order detail api mismatch", protocol);
  const status = successStatus(response.ret, protocol);
  if (status !== "SUCCESS") throw new XianyuOrderDetailRequestError("order detail failed");
  rejectUnknownKeys(response, ["api", "data", "ret", "traceId", "v", "responseHeaders", "retType"], "order detail response", protocol);

  const responseData = requireRecord(response.data, "order detail response data", protocol);
  const components = requireArray(responseData.components, "order detail response data.components", protocol);
  const orderInfoComponents = components.filter((component) => {
    const record = requireRecord(component, "order detail component", protocol);
    return record.render === "orderInfoVO";
  });
  if (orderInfoComponents.length !== 1) protocol("expected exactly one orderInfoVO component");
  const orderInfoVO = requireOrderInfoVO(orderInfoComponents[0]);

  const data = requireRecord(orderInfoVO.data, "orderInfoVO.data", protocol);
  exactKeys(data, ["extInfoList", "itemInfo", "orderInfoList", "priceInfo"], "orderInfoVO.data");
  emptyArray(data.extInfoList, "orderInfoVO.data.extInfoList", protocol);
  validateItemInfo(data.itemInfo);

  const actualOrderId = validateOrderInfoList(data.orderInfoList, expectedId);
  if (actualOrderId !== expectedId) protocol("order id mismatch");

  const priceInfo = requireRecord(data.priceInfo, "orderInfoVO.data.priceInfo", protocol);
  exactKeys(priceInfo, ["amount", "billList", "softwareServiceFeeList"], "orderInfoVO.data.priceInfo");
  emptyArray(priceInfo.softwareServiceFeeList, "orderInfoVO.data.priceInfo.softwareServiceFeeList", protocol);
  const amount = requireRecord(priceInfo.amount, "orderInfoVO.data.priceInfo.amount", protocol);
  exactKeys(amount, ["descRichText", "expanded", "title", "value"], "orderInfoVO.data.priceInfo.amount");
  validateAmountDescription(amount.descRichText);
  literal(amount.expanded, true, "deal amount expanded mismatch", protocol);
  literal(amount.title, "成交价", "deal amount title mismatch", protocol);
  const actualPaidAmountCents = cents(amount.value, protocol);

  const bills = requireArray(priceInfo.billList, "orderInfoVO.data.priceInfo.billList", protocol).map((entry) => {
    const bill = requireRecord(entry, "orderInfoVO.data.priceInfo.billList entry", protocol);
    exactKeys(bill, ["code", "expanded", "title", "value"], "orderInfoVO.data.priceInfo.billList entry");
    return bill;
  });
  const itemTotal = confirmedBill(bills, "ITEM_TOTAL_FEE", "商品总价");
  const postFee = confirmedBill(bills, "POST_FEE", "运费");
  if (bills.length !== 2) protocol("billList has an unexpected structure");
  const itemTotalCents = cents(itemTotal.value, protocol);
  const postFeeCents = cents(postFee.value, protocol);
  if (postFeeCents !== 0) protocol("post fee must be zero");
  if (actualPaidAmountCents !== itemTotalCents + postFeeCents) protocol("deal amount mismatch");

  return { actualPaidAmountCents, itemTotalCents, postFeeCents };
}

/** 十进制金额字符串（两位小数）转为整数分。 */
export function decimalAmountToCents(value: unknown): number {
  return cents(value, fail);
}

/** 人民币元（最多两位小数的数字）转为整数分，用于后端 amount 与验款金额比较。 */
export function rmbAmountToCents(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(value))
  ) {
    throw new Error("amount must be a positive RMB amount with at most two decimals");
  }
  const [wholeText, fractionText = ""] = String(value).split(".");
  const centsText = `${wholeText}${fractionText.padEnd(2, "0")}`;
  const result = Number(centsText);
  if (!Number.isSafeInteger(result)) {
    throw new Error("amount cents must be a safe integer");
  }
  return result;
}

/** 校验 orderInfoVO 组件结构：只含 data 与 render=orderInfoVO。 */
function requireOrderInfoVO(value: unknown): RecordValue {
  if (!isRecord(value)) protocol("expected exactly one orderInfoVO");
  exactKeys(value, ["data", "render"], "orderInfoVO");
  literal(value.render, "orderInfoVO", "orderInfoVO render mismatch", protocol);
  return value;
}

/** 校验商品信息：标题、数量、价格与图片 URL 等字段齐全。 */
function validateItemInfo(value: unknown): void {
  const itemInfo = requireRecord(value, "orderInfoVO.data.itemInfo", protocol);
  exactKeys(itemInfo, ["buyAmount", "disableJump", "itemMainPictCdnUrl", "jumpUrl", "orderTagList", "price", "title"], "orderInfoVO.data.itemInfo");
  nonEmptyString(itemInfo.buyAmount, "itemInfo.buyAmount", protocol);
  if (typeof itemInfo.disableJump !== "boolean") protocol("itemInfo.disableJump must be boolean");
  nonEmptyString(itemInfo.itemMainPictCdnUrl, "itemInfo.itemMainPictCdnUrl", protocol);
  nonEmptyString(itemInfo.jumpUrl, "itemInfo.jumpUrl", protocol);
  emptyArray(itemInfo.orderTagList, "itemInfo.orderTagList", protocol);
  cents(itemInfo.price, protocol);
  nonEmptyString(itemInfo.title, "itemInfo.title", protocol);
}

/** 校验订单信息列表：标题去重，逐项按已确认标题严格解码，并取回订单编号。 */
function validateOrderInfoList(value: unknown, expectedOrderId: string): string {
  const entries = requireArray(value, "orderInfoVO.data.orderInfoList", protocol);
  const seen = new Set<string>();
  let orderId = "";
  for (const entry of entries) {
    const info = requireRecord(entry, "orderInfoVO.data.orderInfoList entry", protocol);
    const title = nonEmptyString(info.title, "order info title", protocol);
    if (seen.has(title)) {
      if (title === "订单编号") protocol("expected exactly one order id");
      protocol(`expected exactly one ${title} entry`);
    }
    seen.add(title);
    switch (title) {
      case "订单编号":
        exactKeys(info, ["copyable", "expanded", "needOutShow", "title", "value"], "order number entry", protocol);
        literal(info.copyable, true, "order number copyable mismatch", protocol);
        literal(info.expanded, true, "order number expanded mismatch", protocol);
        literal(info.needOutShow, true, "order number needOutShow mismatch", protocol);
        orderId = nonEmptyString(info.value, "order id", protocol);
        break;
      case "交易快照":
        exactKeys(info, ["clickEvent", "expanded", "title", "value"], "trade snapshot entry", protocol);
        literal(info.expanded, false, "trade snapshot expanded mismatch", protocol);
        literal(info.value, "发生交易争议时，可作为判断依据", "trade snapshot value mismatch", protocol);
        validateTradeSnapshot(info.clickEvent, expectedOrderId);
        break;
      case "支付宝交易号":
        exactKeys(info, ["copyable", "expanded", "title", "value"], "Alipay transaction entry", protocol);
        literal(info.copyable, true, "Alipay transaction copyable mismatch", protocol);
        literal(info.expanded, false, "Alipay transaction expanded mismatch", protocol);
        nonEmptyString(info.value, "Alipay transaction value", protocol);
        break;
      case "买家昵称":
        exactKeys(info, ["expanded", "iconUrls", "title", "value"], "buyer nickname entry", protocol);
        literal(info.expanded, false, "buyer nickname expanded mismatch", protocol);
        emptyArray(info.iconUrls, "buyer nickname iconUrls", protocol);
        nonEmptyString(info.value, "buyer nickname value", protocol);
        break;
      case "下单时间":
      case "付款时间":
        exactKeys(info, ["expanded", "title", "value"], `${title} entry`, protocol);
        literal(info.expanded, false, `${title} expanded mismatch`, protocol);
        nonEmptyString(info.value, `${title} value`, protocol);
        break;
      default:
        protocol("orderInfoList has an unconfirmed title");
    }
  }
  const requiredTitles = ["订单编号", "交易快照", "支付宝交易号", "买家昵称", "下单时间", "付款时间"];
  if (entries.length !== requiredTitles.length || requiredTitles.some(title => !seen.has(title))) {
    protocol("orderInfoList has an unexpected structure");
  }
  return orderId;
}

/** 校验交易快照点击事件：URL 与订单号必须匹配。 */
function validateTradeSnapshot(value: unknown, expectedOrderId: string): void {
  const event = requireRecord(value, "trade snapshot clickEvent", protocol);
  exactKeys(event, ["data", "type", "utParam"], "trade snapshot clickEvent", protocol);
  literal(event.type, "openPage", "trade snapshot clickEvent type mismatch", protocol);
  const data = requireRecord(event.data, "trade snapshot clickEvent data", protocol);
  exactKeys(data, ["url"], "trade snapshot clickEvent data", protocol);
  const parsed = tradeSnapshotUrl(data.url);
  literal(parsed.protocol, "fleamarket:", "trade snapshot URL protocol mismatch", protocol);
  literal(parsed.hostname, "item", "trade snapshot URL host mismatch", protocol);
  literal(parsed.pathname, "", "trade snapshot URL path mismatch", protocol);
  literal(parsed.hash, "", "trade snapshot URL fragment mismatch", protocol);
  const queryKeys: string[] = [];
  parsed.searchParams.forEach((_, key) => queryKeys.push(key));
  queryKeys.sort();
  if (queryKeys.length !== 3 || queryKeys[0] !== "id" || queryKeys[1] !== "isSnapshot" || queryKeys[2] !== "orderId") {
    protocol("trade snapshot URL query mismatch");
  }
  literal(parsed.searchParams.get("isSnapshot"), "true", "trade snapshot URL isSnapshot mismatch", protocol);
  literal(parsed.searchParams.get("orderId"), expectedOrderId, "trade snapshot URL orderId mismatch", protocol);
  nonEmptyString(parsed.searchParams.get("id"), "trade snapshot URL item id", protocol);
  const utParam = requireRecord(event.utParam, "trade snapshot utParam", protocol);
  exactKeys(utParam, ["arg1"], "trade snapshot utParam", protocol);
  literal(utParam.arg1, "OrderSnap", "trade snapshot utParam arg1 mismatch", protocol);
}

/** 校验成交价描述富文本：必须是指定的单一固定条目。 */
function validateAmountDescription(value: unknown): void {
  const richText = requireArray(value, "deal amount descRichText", protocol);
  if (richText.length !== 1) protocol("deal amount descRichText must contain exactly one entry");
  const entry = requireRecord(richText[0], "deal amount descRichText entry", protocol);
  exactKeys(entry, ["fontSize", "text", "textColor"], "deal amount descRichText entry", protocol);
  literal(entry.fontSize, 12, "deal amount descRichText fontSize mismatch", protocol);
  literal(entry.text, "（在支付宝担保账户中）", "deal amount descRichText text mismatch", protocol);
  literal(entry.textColor, "0xFFA3A3A3", "deal amount descRichText textColor mismatch", protocol);
}

/** 解析交易快照 URL，失败抛协议错误。 */
function tradeSnapshotUrl(value: unknown): URL {
  try {
    return new URL(nonEmptyString(value, "trade snapshot URL", protocol));
  } catch (error) {
    throw new XianyuOrderDetailProtocolError("trade snapshot URL must be valid", { cause: error });
  }
}

/** 按账单 code 找到唯一账单并校验标题与展开状态。 */
function confirmedBill(bills: RecordValue[], code: string, title: string): RecordValue {
  const matches = bills.filter(bill => bill.code === code);
  if (matches.length !== 1) protocol(`expected exactly one ${code}`);
  const bill = matches[0];
  literal(bill.expanded, true, `${code} expanded mismatch`, protocol);
  literal(bill.title, title, `${code} title mismatch`, protocol);
  return bill;
}

/** 读取 ret[0] 的状态部分（如 SUCCESS），校验数组非空且全为非空字符串。 */
function successStatus(value: unknown, failWith: Failure): string {
  if (!Array.isArray(value) || value.length === 0) failWith("ret must be a non-empty array");
  if (value.some(entry => typeof entry !== "string" || entry.length === 0)) {
    failWith("ret must contain only non-empty strings");
  }
  const first = value[0];
  return first.split("::", 1)[0];
}

/** 两位小数金额字符串（如 "40.00"）转为整数分。 */
function cents(value: unknown, failWith: Failure): number {
  if (typeof value !== "string" || !/^[0-9]+\.[0-9]{2}$/.test(value)) {
    failWith("amount must be a two-decimal string");
  }
  const [wholeText, fractionText] = value.split(".");
  const whole = Number(wholeText);
  const fraction = Number(fractionText);
  const result = whole * 100 + fraction;
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(result)) failWith("amount cents must be a safe integer");
  return result;
}

/** 校验订单号为非空字符串。 */
function requireOrderId(value: unknown, failWith: Failure = fail): string {
  return nonEmptyString(value, "orderId", failWith);
}

/** 严格校验对象只包含指定键且全部存在。 */
function exactKeys(value: RecordValue, expected: string[], context: string, failWith: Failure = protocol): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    failWith(`${context} has an unexpected structure`);
  }
}

/**
 * 白名单校验：必填键必须存在，且实际键只能是必填 + 可选键的并集。
 * 用于 mtop.request 响应：页面内部封装（oQ.G）返回 5 键，而直接调用
 * window.lib.mtop.request 时额外携带 responseHeaders/retType。
 */
function keysWithOptional(value: RecordValue, required: string[], optional: string[], context: string, failWith: Failure): void {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) failWith(`${context} is missing ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) failWith(`${context} has an unexpected structure`);
  }
}

/** 拒绝对象中出现任何白名单之外的键。 */
function rejectUnknownKeys(value: RecordValue, allowed: string[], context: string, failWith: Failure): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) failWith(`${context} has an unexpected structure`);
  }
}

/** 校验字段为空数组。 */
function emptyArray(value: unknown, context: string, failWith: Failure): void {
  const array = requireArray(value, context, failWith);
  if (array.length !== 0) failWith(`${context} must be an empty array`);
}

/** 校验未知值为数组。 */
function requireArray(value: unknown, context: string, failWith: Failure): unknown[] {
  if (!Array.isArray(value)) failWith(`${context} must be an array`);
  return value;
}

/** 校验未知值为普通对象。 */
function requireRecord(value: unknown, context: string, failWith: Failure): RecordValue {
  if (!isRecord(value)) failWith(`${context} must be an object`);
  return value;
}

/** 判断未知值是否为普通对象。 */
function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 校验字段为非空字符串。 */
function nonEmptyString(value: unknown, context: string, failWith: Failure): string {
  if (typeof value !== "string" || value.length === 0) failWith(`${context} must be a non-empty string`);
  return value;
}

/** 断言字段与预期字面量严格相等，否则用 failWith 失败。 */
function literal<T>(value: unknown, expected: T, message: string, failWith: Failure): asserts value is T {
  if (value !== expected) failWith(message);
}

/** 通用失败出口：抛普通 Error（请求级失败）。 */
function fail(message: string): never {
  throw new Error(message);
}

/** 协议失败出口：抛 XianyuOrderDetailProtocolError。 */
function protocol(message: string): never {
  throw new XianyuOrderDetailProtocolError(message);
}
