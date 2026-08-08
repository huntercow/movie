import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BackendApiError
} from "../src/handlers/backendApi.ts";
import {
  createBackendApiClientImpl
} from "../src/handlers/backendApiClient.ts";

const fixture = JSON.parse(await readFile(new URL(
  "./fixtures/backend/plugin-api-responses.json",
  import.meta.url
), "utf8"));

const token = "TEST_TOKEN_SECRET";
const backendBaseUrl = "http://127.0.0.1:8080/";

/** 后端统一信封：code===0 成功。 */
function backendEnvelope(data) {
  return { code: 0, message: "success", data, requestId: "req-1" };
}

function responseTransport(status, body, requests = []) {
  return async (request) => {
    requests.push(request);
    return { status, body };
  };
}

function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      if (typeof keys === "string") {
        return { [keys]: data[keys] };
      }
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((key) => [key, data[key]]));
      }
      if (keys === null) {
        return { ...data };
      }
      return Object.fromEntries(
        Object.keys(keys).map((key) => [key, data[key]])
      );
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
    async remove(keys) {
      for (const key of typeof keys === "string" ? [keys] : keys) {
        delete data[key];
      }
    }
  };
}

function clientFor(body, requests = [], status = 200, storage = fakeStorage()) {
  return createBackendApiClientImpl({
    token,
    baseUrl: backendBaseUrl,
    storage,
    transport: responseTransport(status, body, requests)
  });
}

test("client fixes the backend origin and puts the token only in the Authorization header", async () => {
  const requests = [];
  const storage = fakeStorage({ backendDeviceIdV1: "device-abc" });
  await clientFor(backendEnvelope(fixture.success.sync.data), requests, 200, storage)
    .sync("0.1.0");

  assert.deepEqual(requests, [{
    method: "POST",
    url: "http://127.0.0.1:8080/api/v1/plugin/sync",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ clientVersion: "0.1.0", deviceId: "device-abc" })
  }]);
  assert.equal(requests[0].url.includes(token), false);
  assert.equal(requests[0].body.includes(token), false);
});

test("all client methods use the backend endpoint paths and request bodies", async () => {
  const calls = [
    ["sync", backendEnvelope(fixture.success.sync.data), ["0.1.0"], "POST", "/api/v1/plugin/sync"],
    ["updateAutomation", backendEnvelope(fixture.success.automation.data), [true], "PUT", "/api/v1/plugin/automation"],
    ["getReplyConfig", backendEnvelope(fixture.success.replyConfig.data), [], "GET", "/api/v1/plugin/reply-config"],
    ["getAiReply", backendEnvelope(fixture.success.aiReply.data), [{
      messageId: "MSG_001", chatId: "CHAT_001", buyerUserId: "BUYER_001",
      itemId: "ITEM_001", content: "这个电影几点开场？"
    }], "POST", "/api/v1/plugin/ai-reply"],
    ["getWaitingPaymentOrder", backendEnvelope(fixture.success.waitingPayment.data), ["CHAT_001"], "POST", "/api/v1/plugin/orders/waiting-payment"],
    ["getOrderByStatus", backendEnvelope(fixture.success.byStatus.data), ["CHAT_001"], "POST", "/api/v1/plugin/orders/by-status"],
    ["getTicketResults", backendEnvelope(fixture.success.ticketResults.data), [], "POST", "/api/v1/plugin/orders/ticket-results"]
  ];

  const requests = [];
  const storage = fakeStorage({ backendDeviceIdV1: "device-abc" });
  const client = createBackendApiClientImpl({
    token,
    baseUrl: backendBaseUrl,
    storage,
    transport: async (request) => {
      requests.push(request);
      return { status: 200, body: backendEnvelope(null) };
    }
  });
  for (const [method, , args, httpMethod, path] of calls) {
    await client[method](...args).catch(() => {});
    const request = requests[requests.length - 1];
    assert.equal(request.method, httpMethod, `${method} method`);
    assert.equal(request.url, `http://127.0.0.1:8080${path}`, `${method} url`);
  }
});

test("status 25/30/90 route to dedicated backend order endpoints with exact bodies", async () => {
  const requests = [];
  const storage = fakeStorage({ backendDeviceIdV1: "device-abc" });
  const client = createBackendApiClientImpl({
    token,
    baseUrl: backendBaseUrl,
    storage,
    transport: async (request) => {
      requests.push(request);
      return { status: 200, body: backendEnvelope(null) };
    }
  });

  await client.updateOrderStatus({ id: "O1", status: 25, xianyuOrderId: "XY1" });
  await client.updateOrderStatus({ id: "O2", status: 30, actualAmount: 34 });
  await client.updateOrderStatus({
    id: "O3", status: 90, failureReason: "AMOUNT_MISMATCH",
    actualAmount: 33.99, cancelSucceeded: true
  });

  assert.deepEqual(requests.map((request) => [request.url, request.body]), [
    ["http://127.0.0.1:8080/api/v1/plugin/orders/price-adjusted",
      JSON.stringify({ id: "O1", xianyuOrderId: "XY1" })],
    ["http://127.0.0.1:8080/api/v1/plugin/orders/buyer-paid",
      JSON.stringify({ id: "O2", actualAmount: 34 })],
    ["http://127.0.0.1:8080/api/v1/plugin/orders/platform-cancel-result",
      JSON.stringify({
        id: "O3", failureReason: "AMOUNT_MISMATCH",
        actualAmount: 33.99, cancelSucceeded: true
      })]
  ]);
});

test("delivery result routes to delivery-result with its full request body", async () => {
  const requests = [];
  const storage = fakeStorage({ backendDeviceIdV1: "device-abc" });
  const client = createBackendApiClientImpl({
    token,
    baseUrl: backendBaseUrl,
    storage,
    transport: async (request) => {
      requests.push(request);
      return { status: 200, body: backendEnvelope(null) };
    }
  });

  await client.updateOrderResult({ id: "O1", result: "DELIVERY_SUCCEEDED" });
  await client.updateOrderResult({
    id: "O2", result: "DELIVERY_FAILED",
    failureStage: "TICKET_IMAGE", sentImageCount: 1
  });
  await client.updateOrderResult({
    id: "O3", result: "TICKET_FAILURE_HANDLED",
    noticeSent: true, cancelSucceeded: true
  });

  assert.deepEqual(requests.map((request) => [
    request.url, request.body
  ]), [
    ["http://127.0.0.1:8080/api/v1/plugin/orders/delivery-result",
      JSON.stringify({ id: "O1", result: "DELIVERY_SUCCEEDED" })],
    ["http://127.0.0.1:8080/api/v1/plugin/orders/delivery-result",
      JSON.stringify({
        id: "O2", result: "DELIVERY_FAILED",
        failureStage: "TICKET_IMAGE", sentImageCount: 1
      })],
    ["http://127.0.0.1:8080/api/v1/plugin/orders/delivery-result",
      JSON.stringify({
        id: "O3", result: "TICKET_FAILURE_HANDLED",
        noticeSent: true, cancelSucceeded: true
      })]
  ]);
});

test("decodes each successful backend response without recalculation", async () => {
  const storage = fakeStorage({ backendDeviceIdV1: "device-abc" });
  const sync = await clientFor(backendEnvelope(fixture.success.sync.data), [], 200, storage).sync("0.1.0");
  assert.deepEqual(sync, fixture.success.sync.data);

  const automation = await clientFor(backendEnvelope(fixture.success.automation.data)).updateAutomation(true);
  assert.deepEqual(automation, fixture.success.automation.data);

  const replyConfig = await clientFor(backendEnvelope(fixture.success.replyConfig.data)).getReplyConfig();
  assert.equal(replyConfig.version, 3);
  assert.equal(Object.keys(replyConfig.templates).length, 10);

  const aiReply = await clientFor(backendEnvelope(fixture.success.aiReply.data)).getAiReply({
    messageId: "MSG_001", chatId: "CHAT_001", buyerUserId: "BUYER_001",
    itemId: "ITEM_001", content: "你好"
  });
  assert.deepEqual(aiReply, { reply: "该场电影晚上八点开场。" });

  const quote = await clientFor(backendEnvelope(fixture.success.quoteSucceeded.data)).quoteImage({
    messageId: "MSG_001", originPlatform: "xianyu", chatId: "CHAT_001",
    customerId: "BUYER_001", customerName: "买家", productId: "ITEM_001",
    seatsImage: "https://img.example.com/seats.jpg"
  });
  assert.equal(quote.status, "SUCCEEDED");
  assert.equal(quote.quote.id, "ORDER_RECORD_001");

  assert.deepEqual(
    await clientFor(backendEnvelope(null)).updateOrderStatus({ id: "O1", status: 25, xianyuOrderId: "XY1" }),
    null
  );
  assert.equal(
    await clientFor(backendEnvelope(null)).updateOrderResult({ id: "O1", result: "DELIVERY_SUCCEEDED" }),
    null
  );
});

test("empty lookups decode null and ticket results decode strict arrays", async () => {
  assert.equal(
    await clientFor(backendEnvelope(null)).getWaitingPaymentOrder("CHAT_001"),
    null
  );
  assert.equal(
    await clientFor(backendEnvelope(null)).getOrderByStatus("CHAT_001"),
    null
  );

  const results = await clientFor(backendEnvelope(fixture.success.ticketResults.data)).getTicketResults();
  assert.equal(results.length, 2);
  assert.equal(results[0].status, 50);
  assert.equal(results[0].ticketCodeInfo.ticketItems[0].ticketCode, "123456");
  assert.equal(results[1].status, 450);
  assert.equal(results[1].xianyuOrderId, "987654321");
});

test("HTTP 401 maps to TOKEN_INVALID while preserving code and message", async () => {
  await assert.rejects(
    clientFor(
      { code: 11002, message: "未登录", data: null, requestId: "req-1" },
      [],
      401
    ).sync("0.1.0"),
    (error) => error instanceof BackendApiError &&
      error.kind === "TOKEN_INVALID" &&
      error.status === 401 &&
      error.code === 11002 &&
      error.message === "未登录"
  );
});

test("business errors keep the backend code and message", async () => {
  await assert.rejects(
    clientFor(
      { code: 14003, message: "实付金额与报价快照不一致", data: null, requestId: "req-1" },
      [],
      422
    ).updateOrderStatus({ id: "O1", status: 30, actualAmount: 33.99 }),
    (error) => error instanceof BackendApiError &&
      error.kind === "HTTP" &&
      error.status === 422 &&
      error.code === 14003 &&
      error.message === "实付金额与报价快照不一致"
  );
});

test("HTTP 200 with a non-zero code is a protocol error", async () => {
  await assert.rejects(
    clientFor({ code: 14001, message: "订单不存在", data: null, requestId: "req-1" })
      .getTicketResults(),
    /HTTP status and backend response\.code disagree/
  );
});

test("missing requestId or code in a success envelope is a protocol error", async () => {
  await assert.rejects(
    clientFor({ code: 0, message: "success", data: null }).getTicketResults(),
    /missing requestId/
  );
  await assert.rejects(
    clientFor({ message: "success", data: null, requestId: "req-1" }).getTicketResults(),
    /missing code/
  );
});

test("rejects empty tokens and backend URLs containing credentials or query state", () => {
  assert.throws(() => createBackendApiClientImpl({
    token: " ", baseUrl: backendBaseUrl, storage: fakeStorage(),
    transport: async () => ({ status: 200, body: backendEnvelope(null) })
  }), /token/);
  assert.throws(() => createBackendApiClientImpl({
    token,
    baseUrl: "https://user:pass@example.com/api?target=other",
    storage: fakeStorage(),
    transport: async () => ({ status: 200, body: backendEnvelope(null) })
  }), /backendBaseUrl/);
});

test("device id is generated once, persisted, and reused across syncs", async () => {
  const requests = [];
  const storage = fakeStorage();
  const client = createBackendApiClientImpl({
    token,
    baseUrl: backendBaseUrl,
    storage,
    transport: async (request) => {
      requests.push(request);
      return { status: 200, body: backendEnvelope(fixture.success.sync.data) };
    }
  });

  await client.sync("0.1.0");
  const firstBody = JSON.parse(requests[0].body);
  assert.equal(typeof firstBody.deviceId, "string");
  assert.ok(firstBody.deviceId.length > 0);
  assert.equal(typeof storage.data.backendDeviceIdV1, "string");
  assert.equal(storage.data.backendDeviceIdV1, firstBody.deviceId);

  await client.sync("0.1.0");
  assert.equal(JSON.parse(requests[1].body).deviceId, firstBody.deviceId);
  assert.equal(storage.data.backendDeviceIdV1, firstBody.deviceId);
});

test("does not disguise a transport rejection as an invalid token", async () => {
  const storage = fakeStorage({ backendDeviceIdV1: "device-abc" });
  const client = createBackendApiClientImpl({
    token,
    baseUrl: backendBaseUrl,
    storage,
    transport: async () => {
      throw new Error("offline");
    }
  });
  await assert.rejects(
    client.sync("0.1.0"),
    (error) => error instanceof BackendApiError &&
      error.kind === "NETWORK" &&
      error.message.includes("offline")
  );
});

test("quote request validation rejects non-xianyu platforms before transport", async () => {
  const requests = [];
  const client = clientFor(backendEnvelope(null), requests);
  await assert.rejects(
    client.quoteImage({
      messageId: "MSG_001", originPlatform: "pdd", chatId: "CHAT_001",
      customerId: "BUYER_001", customerName: "买家", productId: "ITEM_001",
      seatsImage: "https://img.example.com/seats.jpg"
    }),
    /originPlatform must be xianyu/
  );
  assert.equal(requests.length, 0);
});
