export interface VerifiedOrderAmounts {
  actualPaidAmountCents: number;
  itemTotalCents: number;
  postFeeCents: number;
}

export class XianyuOrderDetailRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "XianyuOrderDetailRequestError";
  }
}

export class XianyuOrderDetailProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "XianyuOrderDetailProtocolError";
  }
}

type RecordValue = Record<string, unknown>;
type Failure = (message: string) => never;

const adjustPriceApi = "mtop.taobao.idle.trade.user.adjust.price";
const orderDetailApi = "mtop.idle.web.trade.order.detail";

export function createAdjustPriceRequest(amountCents: number, orderId: string): Record<string, unknown> {
  if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new Error("amountCents must be a positive safe integer");
  }
  return { modifyFee: amountCents, newTransportFee: "0", orderId: requireOrderId(orderId) };
}

export function createOrderDetailRequest(orderId: string): Record<string, unknown> {
  return { tid: requireOrderId(orderId) };
}

export function decodeAdjustPriceResponse(value: unknown): void {
  const response = requireRecord(value, "adjust price response", fail);
  literal(response.api, adjustPriceApi, "adjust price api mismatch", fail);
  const status = successStatus(response.ret, fail);
  if (status !== "SUCCESS") throw new Error("adjust price failed");

  exactKeys(response, ["api", "data", "ret", "traceId", "v"], "adjust price response", fail);

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

export function decodeOrderDetailResponse(value: unknown, expectedOrderId: string): VerifiedOrderAmounts {
  const expectedId = requireOrderId(expectedOrderId, protocol);
  const response = requireRecord(value, "order detail response", protocol);
  literal(response.api, orderDetailApi, "order detail api mismatch", protocol);
  const status = successStatus(response.ret, protocol);
  if (status !== "SUCCESS") throw new XianyuOrderDetailRequestError("order detail failed");
  rejectUnknownKeys(response, ["api", "orderInfoVO", "ret"], "order detail response", protocol);
  const orderInfoVO = requireOrderInfoVO(response.orderInfoVO);
  exactKeys(response, ["api", "orderInfoVO", "ret"], "order detail response", protocol);

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

export function decimalAmountToCents(value: unknown): number {
  return cents(value, fail);
}

function requireOrderInfoVO(value: unknown): RecordValue {
  if (!isRecord(value)) protocol("expected exactly one orderInfoVO");
  exactKeys(value, ["data", "render"], "orderInfoVO");
  literal(value.render, "orderInfoVO", "orderInfoVO render mismatch", protocol);
  return value;
}

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

function validateAmountDescription(value: unknown): void {
  const richText = requireArray(value, "deal amount descRichText", protocol);
  if (richText.length !== 1) protocol("deal amount descRichText must contain exactly one entry");
  const entry = requireRecord(richText[0], "deal amount descRichText entry", protocol);
  exactKeys(entry, ["fontSize", "text", "textColor"], "deal amount descRichText entry", protocol);
  literal(entry.fontSize, 12, "deal amount descRichText fontSize mismatch", protocol);
  literal(entry.text, "（在支付宝担保账户中）", "deal amount descRichText text mismatch", protocol);
  literal(entry.textColor, "0xFFA3A3A3", "deal amount descRichText textColor mismatch", protocol);
}

function tradeSnapshotUrl(value: unknown): URL {
  try {
    return new URL(nonEmptyString(value, "trade snapshot URL", protocol));
  } catch (error) {
    throw new XianyuOrderDetailProtocolError("trade snapshot URL must be valid", { cause: error });
  }
}

function confirmedBill(bills: RecordValue[], code: string, title: string): RecordValue {
  const matches = bills.filter(bill => bill.code === code);
  if (matches.length !== 1) protocol(`expected exactly one ${code}`);
  const bill = matches[0];
  literal(bill.expanded, true, `${code} expanded mismatch`, protocol);
  literal(bill.title, title, `${code} title mismatch`, protocol);
  return bill;
}

function successStatus(value: unknown, failWith: Failure): string {
  if (!Array.isArray(value) || value.length === 0) failWith("ret must be a non-empty array");
  if (value.some(entry => typeof entry !== "string" || entry.length === 0)) {
    failWith("ret must contain only non-empty strings");
  }
  const first = value[0];
  return first.split("::", 1)[0];
}

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

function requireOrderId(value: unknown, failWith: Failure = fail): string {
  return nonEmptyString(value, "orderId", failWith);
}

function exactKeys(value: RecordValue, expected: string[], context: string, failWith: Failure = protocol): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    failWith(`${context} has an unexpected structure`);
  }
}

function rejectUnknownKeys(value: RecordValue, allowed: string[], context: string, failWith: Failure): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) failWith(`${context} has an unexpected structure`);
  }
}

function emptyArray(value: unknown, context: string, failWith: Failure): void {
  const array = requireArray(value, context, failWith);
  if (array.length !== 0) failWith(`${context} must be an empty array`);
}

function requireArray(value: unknown, context: string, failWith: Failure): unknown[] {
  if (!Array.isArray(value)) failWith(`${context} must be an array`);
  return value;
}

function requireRecord(value: unknown, context: string, failWith: Failure): RecordValue {
  if (!isRecord(value)) failWith(`${context} must be an object`);
  return value;
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, context: string, failWith: Failure): string {
  if (typeof value !== "string" || value.length === 0) failWith(`${context} must be a non-empty string`);
  return value;
}

function literal<T>(value: unknown, expected: T, message: string, failWith: Failure): asserts value is T {
  if (value !== expected) failWith(message);
}

function fail(message: string): never {
  throw new Error(message);
}

function protocol(message: string): never {
  throw new XianyuOrderDetailProtocolError(message);
}
