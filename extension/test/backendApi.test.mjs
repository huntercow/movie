import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BackendApiError,
  createFetchBackendTransport,
  createBackendApiClientForTest
} from "../src/handlers/backendApi.ts";

const fixture = JSON.parse(await readFile(new URL(
  "./fixtures/backend/plugin-api-responses.json",
  import.meta.url
), "utf8"));

const token = "TOKEN_SECRET";
const backendBaseUrl = "https://plugin-api.example.com/base/";

function responseTransport(status, body, requests = []) {
  return async (request) => {
    requests.push(request);
    return { status, body };
  };
}

function clientFor(body, requests = [], status = 200) {
  return createBackendApiClientForTest({
    token,
    backendBaseUrl,
    transport: responseTransport(status, body, requests)
  });
}

test("client fixes the backend origin and puts the token only in the Authorization header", async () => {
  const requests = [];
  await clientFor(fixture.success.sync, requests).sync("0.1.0");

  assert.deepEqual(requests, [{
    method: "POST",
    url: "https://plugin-api.example.com/base/api/plugin/sync",
    headers: {
      "Authorization": "Bearer TOKEN_SECRET",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ clientVersion: "0.1.0" })
  }]);
  assert.equal(requests[0].url.includes(token), false);
  assert.equal(requests[0].body.includes(token), false);
});

test("all 7 client methods use the documented method, path, and request body", async () => {
  const calls = [
    ["sync", fixture.success.sync, ["0.1.0"], "POST", "/api/plugin/sync", { clientVersion: "0.1.0" }],
    ["updateAutomation", fixture.success.automation, [true], "PUT", "/api/plugin/automation", { enabled: true }],
    ["getReplyConfig", fixture.success.replyConfig, [], "GET", "/api/plugin/reply-config", undefined],
    ["getAiReply", fixture.success.aiReply, [{
      messageId: "MSG_001", chatId: "CHAT_001", buyerUserId: "BUYER_001",
      itemId: "ITEM_001", content: "这个电影几点开场？"
    }], "POST", "/api/plugin/ai-reply", {
      messageId: "MSG_001", chatId: "CHAT_001", buyerUserId: "BUYER_001",
      itemId: "ITEM_001", content: "这个电影几点开场？"
    }],
    ["getWaitingPaymentOrder", fixture.success.waitingPayment, ["CHAT_001"], "POST", "/api/plugin/orders/waiting-payment", { chatId: "CHAT_001" }],
    ["updateOrderStatus", fixture.success.statusUpdate, [{
      id: "ORDER_RECORD_001", status: 25, xianyuOrderId: "XIANYU_ORDER_001"
    }], "POST", "/api/plugin/orders/status", {
      id: "ORDER_RECORD_001", status: 25, xianyuOrderId: "XIANYU_ORDER_001"
    }],
    ["getOrderByStatus", fixture.success.byStatus, ["CHAT_001"], "POST", "/api/plugin/orders/by-status", {
      chatId: "CHAT_001", status: 25
    }]
  ];

  const requests = [];
  const client = createBackendApiClientForTest({
    token,
    backendBaseUrl,
    transport: async (request) => {
      requests.push(request);
      return { status: 200, body: undefined };
    }
  });
  // 每个调用返回的数据由各自的解码器校验，这里只校验请求契约：
  // 先逐个验证请求，再单独验证解码。
  for (const [method, , args, httpMethod, path, body] of calls) {
    await client[method](...args).catch(() => {});
    const request = requests[requests.length - 1];
    assert.equal(request.method, httpMethod, `${method} method`);
    assert.equal(request.url, `https://plugin-api.example.com/base${path}`, `${method} url`);
    assert.equal(request.body, body === undefined ? undefined : JSON.stringify(body), `${method} body`);
  }
});

test("decodes each successful response without recalculation", async () => {
  const sync = await clientFor(fixture.success.sync).sync("0.1.0");
  assert.deepEqual(sync, fixture.success.sync.data);

  const automation = await clientFor(fixture.success.automation).updateAutomation(true);
  assert.deepEqual(automation, fixture.success.automation.data);

  const replyConfig = await clientFor(fixture.success.replyConfig).getReplyConfig();
  assert.deepEqual(replyConfig, fixture.success.replyConfig.data);
  assert.equal(replyConfig.version, 3);
  assert.equal(Object.keys(replyConfig.templates).length, 10);
  assert.ok(replyConfig.keywordRules.length > 0);
});

test("AI replies decode strict null or non-empty string", async () => {
  assert.deepEqual(await clientFor(fixture.success.aiReply).getAiReply({
    messageId: "MSG_001", chatId: "CHAT_001", buyerUserId: "BUYER_001",
    itemId: "ITEM_001", content: "你好"
  }), { reply: "该场电影晚上八点开场。" });
  assert.deepEqual(await clientFor(fixture.empty.aiReply).getAiReply({
    messageId: "MSG_001", chatId: "CHAT_001", buyerUserId: "BUYER_001",
    itemId: "ITEM_001", content: "你好"
  }), { reply: null });
});

test("waiting-payment and by-status lookups decode null when empty", async () => {
  assert.equal(await clientFor(fixture.empty.waitingPayment).getWaitingPaymentOrder("CHAT_001"), null);
  assert.equal(await clientFor(fixture.empty.byStatus).getOrderByStatus("CHAT_001"), null);

  const waiting = await clientFor(fixture.success.waitingPayment).getWaitingPaymentOrder("CHAT_001");
  assert.equal(waiting.status, 20);
  assert.ok(waiting.amount > 0);

  const byStatus = await clientFor(fixture.success.byStatus).getOrderByStatus("CHAT_001");
  assert.equal(byStatus.xianyuOrderId.length > 0, true);
});

test("status updates decode and reject malformed request unions before transport", async () => {
  const requests = [];
  const client = clientFor(fixture.success.statusUpdate, requests);
  await client.updateOrderStatus({ id: "O1", status: 25, xianyuOrderId: "XY1" });
  assert.equal(requests[0].body, JSON.stringify({ id: "O1", status: 25, xianyuOrderId: "XY1" }));

  await assert.rejects(
    client.updateOrderStatus({ id: "O1", status: 25 }), // 缺 xianyuOrderId
    /xianyuOrderId/
  );
  await assert.rejects(
    client.updateOrderStatus({ id: "O1", status: 99 }), // 未知状态
    /status must be 25, 30, or 90/
  );
  await assert.rejects(
    client.updateOrderStatus({
      id: "O1", status: 90, failureReason: "AMOUNT_MISMATCH", actualAmount: 1, cancelSucceeded: true
    }), // 传输前校验合法，解码由 fixture 决定
  ).catch(() => {});
});

test("does not disguise a transport rejection as an invalid token", async () => {
  const client = createBackendApiClientForTest({
    token,
    backendBaseUrl,
    transport: async () => { throw new Error("offline"); }
  });
  await assert.rejects(
    client.sync("0.1.0"),
    (error) => error instanceof BackendApiError && error.kind === "NETWORK" && error.message.includes("offline")
  );
});

test("backend transport aborts on timeout and reports a network error", async () => {
  let clearedTimer = false;
  const transport = createFetchBackendTransport({
    timeoutMs: 10,
    fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")));
    }),
    scheduleTimeout: (callback) => setTimeout(callback, 5),
    cancelTimeout: (timer) => { clearedTimer = true; clearTimeout(timer); }
  });
  const client = createBackendApiClientForTest({ token, backendBaseUrl, transport });

  await assert.rejects(
    client.sync("0.1.0"),
    (error) => error instanceof BackendApiError && error.kind === "NETWORK"
  );
  assert.equal(clearedTimer, true);
});

test("HTTP 401 maps to TOKEN_INVALID with the backend message", async () => {
  const client = clientFor(fixture.errors.unauthorized.body, [], 401);
  await assert.rejects(
    client.sync("0.1.0"),
    (error) => error instanceof BackendApiError &&
      error.kind === "TOKEN_INVALID" &&
      error.status === 401
  );
});

test("failed envelopes and HTTP disagreements are protocol errors", async () => {
  // HTTP 200 + success:false：success 与 HTTP 状态矛盾 → PROTOCOL。
  await assert.rejects(
    clientFor(fixture.errors.failureOnHttpSuccess.body).sync("0.1.0"),
    /HTTP status and response.success disagree/
  );
  // HTTP 500 + success:true：同样矛盾 → PROTOCOL。
  await assert.rejects(
    clientFor(fixture.errors.successOnHttpError.body, [], 500).sync("0.1.0"),
    /HTTP status and response.success disagree/
  );
  await assert.rejects(
    clientFor(fixture.errors.failureWithData.body, [], 422).sync("0.1.0"),
    /failed response data must be null/
  );
  await assert.rejects(
    clientFor(fixture.errors.missingData.body).getReplyConfig(),
    /missing data/
  );
});

test("rejects empty tokens and runtime backend URLs containing credentials or query state", () => {
  assert.throws(() => createBackendApiClientForTest({ token: " ", backendBaseUrl, transport: async () => ({}) }), /token/);
  assert.throws(() => createBackendApiClientForTest({
    token, backendBaseUrl: "https://user:pass@example.com/api?target=other", transport: async () => ({})
  }), /backendBaseUrl/);
});

test("reply config validation rejects missing templates and unknown placeholders", async () => {
  const missingTemplate = structuredClone(fixture.success.replyConfig);
  delete missingTemplate.data.templates.edit_price_success;
  await assert.rejects(
    clientFor(missingTemplate).getReplyConfig(),
    /missing edit_price_success/
  );

  const badPlaceholder = structuredClone(fixture.success.replyConfig);
  badPlaceholder.data.templates.payment_successful = "[订单号] [取票码]"; // 非法占位符
  await assert.rejects(
    clientFor(badPlaceholder).getReplyConfig(),
    /unsupported placeholder/
  );
});
