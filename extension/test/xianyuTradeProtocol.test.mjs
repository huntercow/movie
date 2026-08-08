import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  XianyuOrderDetailProtocolError,
  XianyuOrderDetailRequestError,
  createAdjustPriceRequest,
  createOrderDetailRequest,
  createWaitingPaymentHeadInfoRequest,
  decimalAmountToCents,
  rmbAmountToCents,
  decodeAdjustPriceResponse,
  decodeOrderDetailResponse,
  decodeWaitingPaymentHeadInfoResponse
} from "../src/protocol/xianyuTradeProtocol.ts";

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/xianyu/${name}.json`, import.meta.url), "utf8"));
const clone = value => structuredClone(value);
const orderDetail = () => {
  const response = fixture("order-detail-success");
  const orderInfoVO = response.orderInfoVO;
  delete response.orderInfoVO;
  response.data = { components: [orderInfoVO] };
  Object.defineProperty(response, "orderInfoVO", {
    value: orderInfoVO,
    configurable: true,
    writable: true
  });
  return response;
};

test("constructs exact MTop business data with integer cents", () => {
  assert.deepEqual(createAdjustPriceRequest(1, "ORDER_001"), {
    modifyFee: 1,
    newTransportFee: "0",
    orderId: "ORDER_001"
  });
  assert.deepEqual(createOrderDetailRequest("ORDER_001"), { tid: "ORDER_001" });
});

test("constructs and decodes the confirmed waiting-payment headinfo contract", () => {
  assert.deepEqual(createWaitingPaymentHeadInfoRequest("CHAT_001", "ITEM_001"), {
    itemId: "ITEM_001",
    sessionId: "CHAT_001",
    sessionType: 1
  });
  assert.equal(
    decodeWaitingPaymentHeadInfoResponse(fixture("waiting-payment-headinfo-success")),
    "ORDER_001"
  );
  assert.throws(
    () => createWaitingPaymentHeadInfoRequest("", "ITEM_001"),
    /sessionId must be a non-empty string/
  );
  const failed = fixture("waiting-payment-headinfo-success");
  failed.ret = ["FAIL_BIZ::解析失败"];
  delete failed.data;
  assert.throws(
    () => decodeWaitingPaymentHeadInfoResponse(failed),
    /waiting-payment headinfo failed: FAIL_BIZ/
  );
});

test("headinfo requires the order id at the confirmed response path", () => {
  const response = fixture("waiting-payment-headinfo-success");
  delete response.data.commonData.utArgs.orderId;
  assert.throws(() => decodeWaitingPaymentHeadInfoResponse(response), /orderId/);
  const wrongApi = fixture("waiting-payment-headinfo-success");
  wrongApi.api = "unknown";
  assert.throws(() => decodeWaitingPaymentHeadInfoResponse(wrongApi), /api mismatch/);
});

test("rejects non-positive or unsafe adjust-price cents", () => {
  for (const amountCents of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createAdjustPriceRequest(amountCents, "ORDER_001"), /positive safe integer/);
  }
});

test("rejects an empty request order id", () => {
  assert.throws(() => createAdjustPriceRequest(1, ""), /orderId must be a non-empty string/);
  assert.throws(() => createOrderDetailRequest(""), /orderId must be a non-empty string/);
});

test("converts exact two-decimal strings without floating point", () => {
  assert.equal(decimalAmountToCents("0.01"), 1);
  assert.equal(decimalAmountToCents("1234567890.12"), 123456789012);
  assert.throws(() => decimalAmountToCents("1"), /two-decimal string/);
  assert.throws(() => decimalAmountToCents("1.001"), /two-decimal string/);
});

test("converts backend RMB numbers to integer cents without binary rounding", () => {
  assert.equal(rmbAmountToCents(0.01), 1);
  assert.equal(rmbAmountToCents(0.29), 29);
  assert.equal(rmbAmountToCents(39.99), 3999);
  assert.equal(rmbAmountToCents(40), 4000);
  assert.equal(rmbAmountToCents(40.5), 4050);
  for (const value of [0, -1, 1.001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => rmbAmountToCents(value), /positive RMB amount|safe integer/);
  }
});

test("rejects invalid decimal amount syntax and unsafe cent values", () => {
  for (const amount of ["-1.00", "+1.00", "1e2", " 1.00", "1.00 ", "90071992547409.92"]) {
    assert.throws(() => decimalAmountToCents(amount), /two-decimal string|safe integer/);
  }
});

test("accepts an adjust-price response only when ret SUCCESS and data.success true", () => {
  assert.doesNotThrow(() => decodeAdjustPriceResponse(fixture("adjust-price-success")));
});

test("accepts the window.lib.mtop.request response shape with responseHeaders/retType", () => {
  // 真实抓包:直接调用 window.lib.mtop.request 时响应额外携带 responseHeaders/retType
  assert.doesNotThrow(() => decodeAdjustPriceResponse(fixture("adjust-price-success-libmtop")));
  // 未知键(非 mtop 附加的 responseHeaders/retType)仍拒绝
  const response = fixture("adjust-price-success-libmtop"); response.unknown = true;
  assert.throws(() => decodeAdjustPriceResponse(response), /unexpected structure/);
});

test("rejects unknown keys in the successful adjust-price response and data", () => {
  const topLevel = fixture("adjust-price-success"); topLevel.unknown = true;
  assert.throws(() => decodeAdjustPriceResponse(topLevel), /unexpected structure/);
  const data = fixture("adjust-price-success"); data.data.unknown = true;
  assert.throws(() => decodeAdjustPriceResponse(data), /unexpected structure/);
});

test("validates the complete successful adjust-price structure before reading data.success", () => {
  const response = fixture("adjust-price-success"); response.data.unknown = true; response.data.success = false;
  assert.throws(() => decodeAdjustPriceResponse(response), /adjust price data has an unexpected structure/);
});

test("requires every adjust-price ret element to be a non-empty string", () => {
  const response = fixture("adjust-price-success"); response.ret.push(1);
  assert.throws(() => decodeAdjustPriceResponse(response), /ret must contain only non-empty strings/);
});

test("rejects adjust-price responses with a missing ret", () => {
  const response = fixture("adjust-price-success"); delete response.ret;
  assert.throws(() => decodeAdjustPriceResponse(response), /ret must be a non-empty array/);
});

test("rejects adjust-price responses with a non-array ret", () => {
  const response = fixture("adjust-price-success"); response.ret = "SUCCESS::调用成功";
  assert.throws(() => decodeAdjustPriceResponse(response), /ret must be a non-empty array/);
});

test("rejects an adjust-price response whose first ret segment is not SUCCESS before reading data", () => {
  const response = fixture("adjust-price-success"); response.ret = ["FAIL::调用失败"]; delete response.data;
  assert.throws(() => decodeAdjustPriceResponse(response), /adjust price failed/);
});

test("requires boolean data.success true for adjust price", () => {
  const falseResponse = fixture("adjust-price-success"); falseResponse.data.success = false;
  assert.throws(() => decodeAdjustPriceResponse(falseResponse), /data.success must be true/);
  const missingResponse = fixture("adjust-price-success"); delete missingResponse.data.success;
  assert.throws(() => decodeAdjustPriceResponse(missingResponse), /adjust price data has an unexpected structure/);
  const stringResponse = fixture("adjust-price-success"); stringResponse.data.success = "true";
  assert.throws(() => decodeAdjustPriceResponse(stringResponse), /data.success must be true/);
});

test("reads actual deal price instead of itemInfo.price", () => {
  const result = decodeOrderDetailResponse(orderDetail(), "ORDER_001");
  assert.deepEqual(result, { actualPaidAmountCents: 1, itemTotalCents: 1, postFeeCents: 0 });
});

test("rejects unknown top-level fields in a successful order detail response", () => {
  const response = orderDetail(); response.unknown = true;
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /unexpected structure/);
});

test("validates the complete successful order-detail envelope before reading orderInfoVO", () => {
  const response = orderDetail(); response.unknown = true; response.data.components[0] = null;
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /order detail response has an unexpected structure/);
});

test("rejects extra keys in every confirmed nested order-detail structure", () => {
  const mutations = [
    response => { response.orderInfoVO.unknown = true; },
    response => { response.orderInfoVO.data.unknown = true; },
    response => { response.orderInfoVO.data.itemInfo.unknown = true; },
    response => { response.orderInfoVO.data.priceInfo.unknown = true; },
    response => { response.orderInfoVO.data.priceInfo.amount.unknown = true; },
    response => { response.orderInfoVO.data.priceInfo.billList[0].unknown = true; },
    response => { response.orderInfoVO.data.orderInfoList[1].clickEvent.unknown = true; },
    response => { response.orderInfoVO.data.orderInfoList[1].clickEvent.data.unknown = true; },
    response => { response.orderInfoVO.data.orderInfoList[1].clickEvent.utParam.unknown = true; }
  ];
  for (const mutate of mutations) {
    const response = orderDetail(); mutate(response);
    assert.throws(
      () => decodeOrderDetailResponse(response, "ORDER_001"),
      error => error instanceof XianyuOrderDetailProtocolError && /unexpected structure/.test(error.message)
    );
  }
});

test("requires every order-detail ret element to be a non-empty string", () => {
  const response = orderDetail(); response.ret.push(1);
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /ret must contain only non-empty strings/);
});

test("rejects a mismatched order-detail API", () => {
  const response = orderDetail(); response.api = "unknown";
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /order detail api mismatch/);
});

test("rejects an empty order-detail ret array", () => {
  const response = orderDetail(); response.ret = [];
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /ret must be a non-empty array/);
});

test("raises request error for a failed order-detail ret status", () => {
  const response = orderDetail(); response.ret = ["FAIL::调用失败"];
  assert.throws(
    () => decodeOrderDetailResponse(response, "ORDER_001"),
    error => error instanceof XianyuOrderDetailRequestError && /order detail failed/.test(error.message)
  );
});

test("rejects missing and incorrectly typed order-detail ret values as protocol errors", () => {
  const missing = orderDetail(); delete missing.ret;
  assert.throws(() => decodeOrderDetailResponse(missing, "ORDER_001"), XianyuOrderDetailProtocolError);
  const typed = orderDetail(); typed.ret = [true];
  assert.throws(() => decodeOrderDetailResponse(typed, "ORDER_001"), XianyuOrderDetailProtocolError);
});

test("rejects missing orderInfoVO", () => {
  const response = orderDetail(); response.data.components = [];
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /expected exactly one orderInfoVO/);
});

test("rejects a duplicate orderInfoVO component", () => {
  const response = orderDetail(); response.data.components.push(clone(response.data.components[0]));
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /expected exactly one orderInfoVO/);
});

test("reads the orderInfoVO component from the reference data.components shape", () => {
  assert.deepEqual(decodeOrderDetailResponse(orderDetail(), "ORDER_001"), {
    actualPaidAmountCents: 1,
    itemTotalCents: 1,
    postFeeCents: 0
  });
});

test("rejects an order identifier that differs from the expected id", () => {
  const response = orderDetail(); response.orderInfoVO.data.orderInfoList[0].value = "ORDER_002";
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /order id mismatch/);
});

test("rejects an unconfirmed order-info title", () => {
  const response = orderDetail(); response.orderInfoVO.data.orderInfoList[5].title = "未知条目";
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /unconfirmed title/);
});

test("converts malformed snapshot URLs to the order-detail protocol error", () => {
  const response = orderDetail(); response.orderInfoVO.data.orderInfoList[1].clickEvent.data.url = "not a URL";
  assert.throws(
    () => decodeOrderDetailResponse(response, "ORDER_001"),
    error => error instanceof XianyuOrderDetailProtocolError && /trade snapshot URL/.test(error.message)
  );
});

test("rejects duplicate order-number entries", () => {
  const response = orderDetail(); response.orderInfoVO.data.orderInfoList.push({ title: "订单编号", value: "ORDER_001" });
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /expected exactly one order id/);
});

for (const [index, title] of ["订单编号", "交易快照", "支付宝交易号", "买家昵称", "下单时间", "付款时间"].entries()) {
  test(`rejects missing keys from the confirmed ${title} order-info variant`, () => {
    const response = orderDetail(); delete response.orderInfoVO.data.orderInfoList[index].value;
    assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /unexpected structure/);
  });

  test(`rejects extra keys in the confirmed ${title} order-info variant`, () => {
    const response = orderDetail(); response.orderInfoVO.data.orderInfoList[index].unknown = true;
    assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /unexpected structure/);
  });
}

test("rejects an invalid actual deal amount", () => {
  const response = orderDetail(); response.orderInfoVO.data.priceInfo.amount.value = "1";
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /must be a two-decimal string/);
});

test("rejects an amount with unconfirmed descRichText", () => {
  const response = orderDetail(); response.orderInfoVO.data.priceInfo.amount.descRichText[0].text = "错误说明";
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /descRichText/);
});

test("rejects an extra key in the confirmed amount descRichText entry", () => {
  const response = orderDetail(); response.orderInfoVO.data.priceInfo.amount.descRichText[0].unknown = true;
  assert.throws(
    () => decodeOrderDetailResponse(response, "ORDER_001"),
    error => error instanceof XianyuOrderDetailProtocolError && /descRichText entry has an unexpected structure/.test(error.message)
  );
});

test("rejects a missing item-total bill", () => {
  const response = orderDetail(); response.orderInfoVO.data.priceInfo.billList = response.orderInfoVO.data.priceInfo.billList.filter(item => item.code !== "ITEM_TOTAL_FEE");
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /expected exactly one ITEM_TOTAL_FEE/);
});

test("rejects a missing postage bill", () => {
  const response = orderDetail(); response.orderInfoVO.data.priceInfo.billList = response.orderInfoVO.data.priceInfo.billList.filter(item => item.code !== "POST_FEE");
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /expected exactly one POST_FEE/);
});

test("rejects duplicate item-total bill codes", () => {
  const response = orderDetail(); response.orderInfoVO.data.priceInfo.billList.push(clone(response.orderInfoVO.data.priceInfo.billList[0]));
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /expected exactly one ITEM_TOTAL_FEE/);
});

test("rejects an unknown bill code", () => {
  const response = orderDetail(); response.orderInfoVO.data.priceInfo.billList.push({ code: "UNKNOWN", expanded: true, title: "未知", value: "0.00" });
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /billList has an unexpected structure/);
});

test("requires confirmed empty arrays in order detail", () => {
  const extInfo = orderDetail(); extInfo.orderInfoVO.data.extInfoList.push({});
  assert.throws(() => decodeOrderDetailResponse(extInfo, "ORDER_001"), /extInfoList must be an empty array/);
  const tags = orderDetail(); tags.orderInfoVO.data.itemInfo.orderTagList.push({});
  assert.throws(() => decodeOrderDetailResponse(tags, "ORDER_001"), /orderTagList must be an empty array/);
  const fees = orderDetail(); fees.orderInfoVO.data.priceInfo.softwareServiceFeeList.push({});
  assert.throws(() => decodeOrderDetailResponse(fees, "ORDER_001"), /softwareServiceFeeList must be an empty array/);
});

test("rejects a non-zero postage fee", () => {
  const response = orderDetail(); response.orderInfoVO.data.priceInfo.billList[1].value = "1.00";
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /post fee must be zero/);
});

test("rejects deal amounts that do not equal item total plus postage", () => {
  const response = orderDetail(); response.orderInfoVO.data.priceInfo.amount.value = "0.02";
  assert.throws(() => decodeOrderDetailResponse(response, "ORDER_001"), /deal amount mismatch/);
});

test("reports malformed order detail as its protocol error class", () => {
  const response = orderDetail(); response.orderInfoVO.data.priceInfo.amount.value = "invalid";
  assert.throws(
    () => decodeOrderDetailResponse(response, "ORDER_001"),
    error => error instanceof XianyuOrderDetailProtocolError && /two-decimal string/.test(error.message)
  );
});

test("order-detail request errors preserve their original cause", () => {
  const cause = new Error("mtop rejected");
  const wrapped = new XianyuOrderDetailRequestError("order detail request failed", { cause });
  assert.equal(wrapped.cause, cause);
});
