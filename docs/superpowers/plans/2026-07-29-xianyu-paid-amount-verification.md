# 闲鱼实付金额校验实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 严格解析已确认的闲鱼入站和 MTop 协议，持久化待付款与改价状态，并只在报价、改价和订单详情实付金额完全一致时自动履约。

**架构：** 扩展把纯协议 decoder 与页面编排分离；待付款阶段先由后端持久化唯一订单关联，再执行 MTop 改价。付款后扩展查询 `mtop.idle.web.trade.order.detail`，把严格解析出的整数分提交给后端，后端用 `BigDecimal` 重做三方校验并驱动现有订单状态机。

**技术栈：** TypeScript 5.6、Chrome Manifest V3、Node test runner、Java 17、Spring Boot 3.3.5、Spring Data JPA、MySQL/Flyway、JUnit 5、Mockito。

**规格：** `docs/superpowers/specs/2026-07-29-xianyu-paid-amount-verification-design.md`

**工作区约束：** 当前仓库包含大量用户未提交改动，本计划不创建隔离 worktree、不执行 commit、不回退任何现有文件。每个任务结束只运行验证并检查定向 diff。

---

## 文件职责

### 扩展

- 创建 `extension/src/xianyuProtocol.ts`：只负责将已确认的 WebSocket payload 解码为互斥事件类型。
- 创建 `extension/src/xianyuTradeProtocol.ts`：只负责整数分转换、MTop 请求对象和改价/订单详情响应校验。
- 创建 `extension/src/xianyuTradeAutomation.ts`：只负责编排待付款、改价、付款验证三个业务动作，依赖注入页面与后端端口。
- 修改 `extension/src/xianyuPageHook.ts`：安装 Hook、调用 decoder、处理文本/图片、把交易事件交给 trade automation；删除递归订单/金额猜测。
- 修改 `extension/src/xianyuContent.ts`：将明确的交易 action 映射到后端接口，严格校验 payload。
- 修改 `extension/src/types.ts`：把 page/content bridge action 改为封闭枚举类型。
- 创建 `extension/test/xianyuProtocol.test.mjs`、`extension/test/xianyuTradeProtocol.test.mjs`、`extension/test/xianyuTradeAutomation.test.mjs`：纯函数和编排测试。
- 创建 `extension/test/fixtures/xianyu/*.json`：由实测报文一致性脱敏得到的协议 fixture。

### 后端

- 创建 `src/main/resources/db/migration/V6__xianyu_payment_verification.sql`：增加改价和金额验证字段及用户/会话/状态索引。
- 创建 `src/main/java/com/movie/ticket/entity/XianyuAmountVerificationSource.java`：定义唯一允许的实付来源。
- 创建 `src/main/java/com/movie/ticket/entity/XianyuVerificationFailureCode.java`：定义允许客户端上报的失败码。
- 创建四个请求 DTO 和一个待付款响应 DTO：明确每个状态转换的输入输出。
- 修改 `XianyuPlatformOrder`、`XianyuOrderResponse`：保存并返回结构化改价/验证状态。
- 修改 `XianyuPlatformOrderRepository`：返回活动订单列表，不再静默选择第一条。
- 修改 `XianyuService`：增加待付款登记、改价确认、付款验证、失败登记；停止支付 raw payload 落库。
- 修改 `XianyuController`：暴露单一职责端点，移除旧 `/orders/paid` 合同。
- 修改 `XianyuServiceTest`、`XianyuMvpFlowSimulationTest`、`UserDataIsolationTest`：覆盖状态机、金额、幂等和用户隔离。

### 文档

- 修改 `docs/apifox-openapi.yaml`、`docs/integration-runbook.md`、`docs/module-roadmap.md`、`README.md`：同步新接口、金额来源和验收流程。

---

### 任务 1：建立严格 WebSocket 入站 decoder

**文件：**

- 创建：`extension/src/xianyuProtocol.ts`
- 创建：`extension/test/xianyuProtocol.test.mjs`
- 创建：`extension/test/fixtures/xianyu/ack.json`
- 创建：`extension/test/fixtures/xianyu/image-message.json`
- 创建：`extension/test/fixtures/xianyu/order-context.json`
- 创建：`extension/test/fixtures/xianyu/waiting-payment-card.json`
- 创建：`extension/test/fixtures/xianyu/paid-card.json`
- 创建：`extension/test/fixtures/xianyu/payment-summary.json`
- 创建：`extension/test/fixtures/xianyu/message-update.json`
- 创建：`extension/test/fixtures/xianyu/pnm-status.json`

- [ ] **步骤 1：创建一致性脱敏 fixture**

保持金额、状态、类型和字段层级不变，将真实值固定替换为：

```json
{
  "chatId": "CHAT_001",
  "orderId": "ORDER_001",
  "itemId": "ITEM_001",
  "buyerUserId": "BUYER_001",
  "sellerUserId": "SELLER_001",
  "messageId": "MESSAGE_001",
  "imageUrl": "https://example.test/image-001.jpg"
}
```

fixture 不得包含 IP、UMID、UTDID、Token、支付宝交易号、昵称或原始图片域名。

- [ ] **步骤 2：编写失败的分类测试**

在 `extension/test/xianyuProtocol.test.mjs` 覆盖互斥事件类型和未知结构：

```js
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeXianyuPayload } from "../src/xianyuProtocol.ts";

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/xianyu/${name}.json`, import.meta.url), "utf8"));

test("decodes a paid summary without inventing an order id", () => {
  assert.deepEqual(decodeXianyuPayload(fixture("payment-summary")), {
    kind: "PAYMENT_SUMMARY",
    chatId: "CHAT_001",
    redReminder: "等待卖家发货"
  });
});

test("rejects an unknown payload shape", () => {
  assert.throws(() => decodeXianyuPayload({ "1": { unexpected: true } }), /unknown xianyu payload shape/);
});
```

再分别断言 ACK、图片、订单上下文、待付款卡片、已付款卡片、消息更新和 PNM 状态只产生一个预期 `kind`。

- [ ] **步骤 3：运行测试确认失败**

运行：

```bash
cd extension
node --test test/xianyuProtocol.test.mjs
```

预期：FAIL，提示无法导入 `src/xianyuProtocol.ts`。

- [ ] **步骤 4：实现最小严格 decoder**

在 `extension/src/xianyuProtocol.ts` 定义判别联合：

```ts
export type XianyuInboundEvent =
  | { kind: "ACK" }
  | { kind: "SESSION_SIGNAL"; chatId: string }
  | { kind: "PNM_STATUS"; chatId: string; messageIds: string[] }
  | { kind: "ORDER_CONTEXT"; chatId: string; orderId: string; itemId: string; buyerUserId: string }
  | { kind: "TEXT_MESSAGE"; chatId: string; messageId: string; senderId: string; itemId: string; text: string }
  | { kind: "IMAGE_MESSAGE"; chatId: string; messageId: string; senderId: string; itemId: string; imageUrl: string }
  | { kind: "WAITING_PAYMENT_CARD"; chatId: string; messageId: string; senderId: string; itemId: string; orderId: string }
  | { kind: "PAID_CARD"; chatId: string; messageId: string; senderId: string; itemId: string; orderId: string }
  | { kind: "PAYMENT_SUMMARY"; chatId: string; redReminder: "等待卖家发货" }
  | { kind: "MESSAGE_UPDATE"; chatId: string; messageId: string; orderId: string; updateType: "TRADE_MODIFY_FEE_BUYER" };

export function decodeXianyuPayload(value: unknown): XianyuInboundEvent {
  // 依次匹配互斥的已确认结构；每个 decoder 校验完整分支结构。
  // 没有任何已确认结构匹配时抛出 Error("unknown xianyu payload shape")。
}
```

实现要求：

- 标准消息 ID 从 `metadata.extJson.messageId` 读取，并与卡片 `msg_id`、`reminderUrl.messageId` 交叉校验；禁止使用时间戳字段 `payload["1"]["5"]`。
- 文字只接受外层类型 `1` 与内层 `contentType == 1`；图片只接受外层类型 `2` 与内层 `contentType == 2`。
- 图片 URL 只接受 `image.pics` 中协议位置，禁止递归 URL 搜索。
- 待付款卡片要求 `contentType == 26`、标题“我已拍下，待付款”、`redReminder == "等待买家付款"`，按钮 `bizOrderId` 与主卡片 `id` 必须一致。
- 已付款卡片要求 `contentType == 26`、`TRADE_PAID_DONE_SELLER`、标题“我已付款，等待你发货”、`redReminder == "等待卖家发货"`，按钮 `orderId`、主卡片 `id` 和 `updateKey` 订单 ID 必须一致。
- 已确认的忽略帧返回明确类型；未知帧不返回空对象或默认事件。

- [ ] **步骤 5：运行 decoder 测试和类型检查**

```bash
cd extension
node --test test/xianyuProtocol.test.mjs
npm run typecheck
```

预期：所有 decoder 测试 PASS，TypeScript 无错误。

---

### 任务 2：实现严格 MTop 与金额协议

**文件：**

- 创建：`extension/src/xianyuTradeProtocol.ts`
- 创建：`extension/test/xianyuTradeProtocol.test.mjs`
- 创建：`extension/test/fixtures/xianyu/adjust-price-success.json`
- 创建：`extension/test/fixtures/xianyu/order-detail-success.json`

- [ ] **步骤 1：编写金额与 MTop 失败测试**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  decimalAmountToCents,
  decodeAdjustPriceResponse,
  decodeOrderDetailResponse
} from "../src/xianyuTradeProtocol.ts";

const orderDetailFixture = JSON.parse(readFileSync(
  new URL("./fixtures/xianyu/order-detail-success.json", import.meta.url),
  "utf8"
));

test("converts exact two-decimal strings without floating point", () => {
  assert.equal(decimalAmountToCents("0.01"), 1);
  assert.equal(decimalAmountToCents("1234567890.12"), 123456789012);
  assert.throws(() => decimalAmountToCents("1"), /two-decimal/);
  assert.throws(() => decimalAmountToCents("1.001"), /two-decimal/);
});

test("requires both MTop SUCCESS and data.success for adjust price", () => {
  assert.throws(
    () => decodeAdjustPriceResponse({ ret: ["SUCCESS::调用成功"], data: { success: false } }),
    /data.success must be true/
  );
});

test("reads actual deal price instead of itemInfo.price", () => {
  const result = decodeOrderDetailResponse(orderDetailFixture, "ORDER_001");
  assert.equal(result.actualPaidAmountCents, 1);
  assert.equal(result.itemTotalCents, 1);
  assert.equal(result.postFeeCents, 0);
});
```

按下表逐项增加独立 `assert.throws`，每个测试只改变一个字段：

| 变更 | 预期错误 |
|---|---|
| `api = "unknown"` | `order detail api mismatch` |
| `ret = []` | `ret must be a non-empty array` |
| `ret = ["FAIL::调用失败"]` | `order detail failed` |
| 删除或复制 `orderInfoVO` | `expected exactly one orderInfoVO` |
| 订单编号改为 `ORDER_002` | `order id mismatch` |
| `amount.value = "1"` | `must be a two-decimal string` |
| 删除 `ITEM_TOTAL_FEE` 或 `POST_FEE` | `expected exactly one` |
| `POST_FEE.value = "1.00"` | `post fee must be zero` |
| `amount.value` 不等于两个账单项之和 | `deal amount mismatch` |

- [ ] **步骤 2：运行测试确认失败**

```bash
cd extension
node --test test/xianyuTradeProtocol.test.mjs
```

预期：FAIL，提示无法导入 `src/xianyuTradeProtocol.ts`。

- [ ] **步骤 3：实现请求构造器和响应 decoder**

```ts
export interface VerifiedOrderAmounts {
  actualPaidAmountCents: number;
  itemTotalCents: number;
  postFeeCents: number;
}

export class XianyuOrderDetailRequestError extends Error {}
export class XianyuOrderDetailProtocolError extends Error {}

export function createAdjustPriceRequest(amountCents: number, orderId: string): Record<string, unknown>;
export function decodeAdjustPriceResponse(value: unknown): void;
export function createOrderDetailRequest(orderId: string): Record<string, unknown>;
export function decodeOrderDetailResponse(value: unknown, expectedOrderId: string): VerifiedOrderAmounts;
export function decimalAmountToCents(value: unknown): number;
```

具体合同：

```ts
data: { modifyFee: amountCents, newTransportFee: "0", orderId }
data: { tid: orderId }
```

金额转换必须按字符串拆分整数和小数部分，并在组合后执行 `Number.isSafeInteger`；不得使用 `parseFloat(value) * 100`。订单详情必须校验唯一 `orderInfoVO`、唯一订单编号、唯一 `ITEM_TOTAL_FEE`、唯一 `POST_FEE` 和三项金额关系。

- [ ] **步骤 4：运行协议测试**

```bash
cd extension
node --test test/xianyuTradeProtocol.test.mjs
npm run typecheck
```

预期：全部 PASS。

---

### 任务 3：持久化待付款和改价状态

**文件：**

- 创建：`src/main/resources/db/migration/V6__xianyu_payment_verification.sql`
- 创建：`src/main/java/com/movie/ticket/entity/XianyuAmountVerificationSource.java`
- 创建：`src/main/java/com/movie/ticket/entity/XianyuVerificationFailureCode.java`
- 创建：`src/main/java/com/movie/ticket/dto/XianyuWaitingPaymentRequest.java`
- 创建：`src/main/java/com/movie/ticket/dto/XianyuWaitingPaymentResponse.java`
- 创建：`src/main/java/com/movie/ticket/dto/XianyuAdjustedOrderRequest.java`
- 修改：`src/main/java/com/movie/ticket/entity/XianyuPlatformOrder.java`
- 修改：`src/main/java/com/movie/ticket/dto/XianyuOrderResponse.java`
- 修改：`src/main/java/com/movie/ticket/repository/XianyuPlatformOrderRepository.java`
- 修改：`src/main/java/com/movie/ticket/controller/XianyuController.java`
- 修改：`src/main/java/com/movie/ticket/service/XianyuService.java`
- 测试：`src/test/java/com/movie/ticket/service/XianyuServiceTest.java`
- 测试：`src/test/java/com/movie/ticket/service/UserDataIsolationTest.java`

- [ ] **步骤 1：编写待付款登记失败测试**

在 `XianyuServiceTest` 增加：

```java
@Test
void registerWaitingPaymentPersistsQuoteAndExactCents() {
    var result = deps.service.registerWaitingPayment(new XianyuWaitingPaymentRequest(
            "ORDER_001", "CHAT_001", "BUYER_001", "SELLER_001", "ITEM_001", "MESSAGE_001"
    ));

    assertThat(result.totalPriceCents()).isEqualTo(8800L);
    assertThat(savedOrder.get().getStatus()).isEqualTo(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
    assertThat(savedOrder.get().getQuotedAmount()).isEqualByComparingTo("88.00");
    assertThat(savedOrder.get().getRawPayload()).isNull();
}
```

测试 setup 使用 `AtomicReference<XianyuPlatformOrder> savedOrder` 捕获 `platformOrderRepository.save`，并固定 mock：最新会话报价为 `Q1`、`quote("Q1", "88.00")`、活动订单列表为空。同文件增加五个具名测试：

```java
@Test void duplicateWaitingPaymentForSameOrderIsIdempotent()
@Test void differentActiveOrderInSameChatIsBlocked()
@Test void multipleActiveOrdersInSameChatFailExplicitly()
@Test void waitingPaymentLookupUsesCurrentUserScope()
@Test void resolveWaitingPaymentOrderRequiresExactlyOneAdjustedOrder()
```

五个测试分别断言：同订单只保留一个 `WAIT_BUYER_PAY`；不同订单返回 `NEED_MANUAL` 且不改动原单；两条活动订单抛出 `BusinessException("multiple active xianyu orders found for chat")`；设置 `UserScopeContext` 后只调用带 `userId` 的仓储方法；付款摘要解析只返回恰好一条同时具有 `WAIT_BUYER_PAY` 与 `adjustedAt` 的订单，零条、多条或未记录改价均显式失败。

- [ ] **步骤 2：运行单测确认失败**

```bash
mvn -Dtest=XianyuServiceTest,UserDataIsolationTest test
```

预期：FAIL，缺少 DTO、方法和实体字段。

- [ ] **步骤 3：增加 V6 迁移和实体字段**

`V6__xianyu_payment_verification.sql`：

```sql
ALTER TABLE xianyu_platform_order
    ADD COLUMN adjusted_amount DECIMAL(12, 2) NULL,
    ADD COLUMN adjusted_at DATETIME(6) NULL,
    ADD COLUMN amount_verification_source VARCHAR(64) NULL,
    ADD COLUMN amount_verified_at DATETIME(6) NULL,
    ADD INDEX idx_xianyu_platform_order_user_chat_status (user_id, chat_id, status);
```

实体字段使用 `BigDecimal`、`LocalDateTime` 和 `@Enumerated(EnumType.STRING)`；不修改 V1–V5。

`XianyuOrderResponse` 在现有字段后增加 `BigDecimal adjustedAmount`、`XianyuAmountVerificationSource amountVerificationSource`、`LocalDateTime adjustedAt`、`LocalDateTime amountVerifiedAt`；同步修改 `toResponse` 和 `withDeliveryPermission` 的全部构造调用，禁止用另一个响应类型绕过字段缺失。

- [ ] **步骤 4：增加严格 DTO**

```java
public record XianyuWaitingPaymentRequest(
        @NotBlank(message = "platformOrderId is required") String platformOrderId,
        @NotBlank(message = "chatId is required") String chatId,
        @NotBlank(message = "buyerUserId is required") String buyerUserId,
        String sellerUserId,
        @NotBlank(message = "itemId is required") String itemId,
        @NotBlank(message = "messageId is required") String messageId
) {}

public record XianyuWaitingPaymentResponse(
        String platformOrderId,
        String quoteNo,
        long totalPriceCents,
        XianyuFulfillmentStatus status
) {}

public record XianyuAdjustedOrderRequest(
        @Positive(message = "adjustedAmountCents must be positive") long adjustedAmountCents
) {}
```

请求不接受 `rawPayload` 或客户端 `userId`。

- [ ] **步骤 5：实现唯一活动订单查询**

仓储新增返回 `List<XianyuPlatformOrder>` 的加锁查询，Service 要求结果数量是 0 或 1；数量大于 1 时抛出 `BusinessException("multiple active xianyu orders found for chat")`。`ACTIVE_ORDER_STATUSES` 加入 `WAIT_BUYER_PAY`，删除自动流程对 `findFirst...` 的依赖。

- [ ] **步骤 6：实现待付款登记和改价确认**

```java
@Transactional
public XianyuWaitingPaymentResponse registerWaitingPayment(XianyuWaitingPaymentRequest request)

@Transactional
public XianyuOrderResponse recordAdjusted(String platformOrderId, XianyuAdjustedOrderRequest request)

@Transactional(readOnly = true)
public XianyuOrderResponse resolveWaitingPaymentOrder(String chatId)
```

`registerWaitingPayment` 必须绑定当前会话的 `latestQuoteNo`，用：

```java
quote.totalPrice()
    .setScale(2, RoundingMode.UNNECESSARY)
    .movePointRight(2)
    .longValueExact();
```

生成 `totalPriceCents`。`recordAdjusted` 只接受 `WAIT_BUYER_PAY`，并要求 `adjustedAmountCents` 精确等于保存的 `quotedAmount`；成功后写 `adjustedAmount` 和 `adjustedAt`。金额不一致时转 `NEED_MANUAL`，不抛出伪成功。

- [ ] **步骤 7：增加 Controller 端点并运行测试**

```java
@PostMapping("/orders/waiting-payment")
public ApiResponse<XianyuWaitingPaymentResponse> registerWaitingPayment(
        @Valid @RequestBody XianyuWaitingPaymentRequest request
) {
    return ApiResponse.ok(xianyuService.registerWaitingPayment(request));
}

@PostMapping("/orders/{platformOrderId}/adjusted")
public ApiResponse<XianyuOrderResponse> recordAdjusted(
        @PathVariable String platformOrderId,
        @Valid @RequestBody XianyuAdjustedOrderRequest request
) {
    return ApiResponse.ok(xianyuService.recordAdjusted(platformOrderId, request));
}

@GetMapping("/orders/waiting-payment/{chatId}")
public ApiResponse<XianyuOrderResponse> resolveWaitingPaymentOrder(
        @PathVariable String chatId
) {
    return ApiResponse.ok(xianyuService.resolveWaitingPaymentOrder(chatId));
}
```

`resolveWaitingPaymentOrder` 只查询 `WAIT_BUYER_PAY`，要求结果恰好一条且 `adjustedAt` 非空；它不复用包含 `NEED_MANUAL`、出票中订单的通用 active-order 查询。

运行：

```bash
mvn -Dtest=XianyuServiceTest,UserDataIsolationTest test
```

预期：PASS。

---

### 任务 4：实现三方金额验证和幂等履约

**文件：**

- 创建：`src/main/java/com/movie/ticket/dto/XianyuPaidVerificationRequest.java`
- 创建：`src/main/java/com/movie/ticket/dto/XianyuVerificationFailureRequest.java`
- 删除：`src/main/java/com/movie/ticket/dto/XianyuPaidOrderRequest.java`
- 修改：`src/main/java/com/movie/ticket/controller/XianyuController.java`
- 修改：`src/main/java/com/movie/ticket/service/XianyuService.java`
- 修改：`src/test/java/com/movie/ticket/service/XianyuServiceTest.java`
- 修改：`src/test/java/com/movie/ticket/service/XianyuMvpFlowSimulationTest.java`

- [ ] **步骤 1：编写付款验证失败测试**

先增加一个完整成功测试，并新增下列失败测试方法：

```java
@Test
void verifiedAmountsCreateExactlyOneLocalOrder() {
    XianyuPlatformOrder platformOrder = adjustedOrder("ORDER_001", "88.00");
    when(deps.platformOrderRepository.findByPlatformOrderIdForUpdate("ORDER_001"))
            .thenReturn(Optional.of(platformOrder));
    when(deps.orderService.createOrder(any())).thenReturn(order("O1", "Q1", "PAID", false));
    when(deps.platformOrderRepository.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

    var result = deps.service.verifyPaid("ORDER_001", new XianyuPaidVerificationRequest(
            8800L,
            8800L,
            0L,
            XianyuAmountVerificationSource.XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT
    ));

    assertThat(result.status()).isEqualTo(XianyuFulfillmentStatus.PAID_WAIT_SUBMIT);
    assertThat(result.paidAmount()).isEqualByComparingTo("88.00");
    assertThat(result.localOrderNo()).isEqualTo("O1");
    verify(deps.orderService, times(1)).createOrder(any());
}

private static XianyuPlatformOrder adjustedOrder(String platformOrderId, String amount) {
    XianyuPlatformOrder platformOrder = new XianyuPlatformOrder();
    platformOrder.setPlatformOrderId(platformOrderId);
    platformOrder.setTradeNo(platformOrderId);
    platformOrder.setChatId("CHAT_001");
    platformOrder.setBuyerUserId("BUYER_001");
    platformOrder.setItemId("ITEM_001");
    platformOrder.setQuoteNo("Q1");
    platformOrder.setQuotedAmount(new BigDecimal(amount));
    platformOrder.setAdjustedAmount(new BigDecimal(amount));
    platformOrder.setAdjustedAt(LocalDateTime.now());
    platformOrder.setStatus(XianyuFulfillmentStatus.WAIT_BUYER_PAY);
    return platformOrder;
}
```

再添加五个具名测试：`actualPaidAmountMismatchNeedsManualWithoutCreatingOrder`、`nonZeroPostFeeNeedsManualWithoutCreatingOrder`、`missingAdjustedAtNeedsManualWithoutCreatingOrder`、`duplicatePaidVerificationRequiresIdenticalEvidenceAndIsIdempotent`、`duplicatePaidVerificationWithDifferentAmountFails`。

前三个测试各构造一条 `WAIT_BUYER_PAY` 订单，只改变测试名对应的一个条件，并同时断言 `status == NEED_MANUAL`、`lastError` 包含固定错误语义、`orderService.createOrder` 从未调用。幂等测试第一次保存 `paidAmount = 88.00` 和 `localOrderNo = O1`，第二次提交相同四字段并断言仍为 `O1` 且总调用一次；不同金额测试第二次提交 `paidAmountCents = 1` 并断言抛出 `BusinessException` 且不覆盖已保存金额。

更新模拟测试为：图片报价 → 登记待付款 → 记录改价 → 验证付款 → 创建本地订单。

- [ ] **步骤 2：运行测试确认失败**

```bash
mvn -Dtest=XianyuServiceTest,XianyuMvpFlowSimulationTest test
```

预期：FAIL，缺少付款验证 DTO 和 Service 方法。

- [ ] **步骤 3：定义付款验证 DTO 与枚举**

```java
public enum XianyuAmountVerificationSource {
    XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT
}

public record XianyuPaidVerificationRequest(
        @Positive(message = "paidAmountCents must be positive") long paidAmountCents,
        @Positive(message = "itemTotalCents must be positive") long itemTotalCents,
        @PositiveOrZero(message = "postFeeCents cannot be negative") long postFeeCents,
        @NotNull(message = "source is required") XianyuAmountVerificationSource source
) {}

public record XianyuVerificationFailureRequest(
        @NotNull(message = "code is required") XianyuVerificationFailureCode code
) {}
```

失败码固定为：`ADJUST_PRICE_REJECTED`、`ORDER_DETAIL_REQUEST_FAILED`、`ORDER_DETAIL_PROTOCOL_ERROR`、`ORDER_ID_MISMATCH`、`AMOUNT_MISMATCH`、`NON_ZERO_POST_FEE`、`MISSING_ADJUSTMENT`。客户端不得提交自由文本原因。

- [ ] **步骤 4：实现付款验证状态机**

```java
@Transactional
public XianyuOrderResponse verifyPaid(String platformOrderId, XianyuPaidVerificationRequest request)

@Transactional
public XianyuOrderResponse recordVerificationFailure(
        String platformOrderId,
        XianyuVerificationFailureRequest request
)
```

`verifyPaid` 校验顺序：

1. 锁定当前用户的订单。
2. 对已创建本地订单的重复请求，先要求来源和三个金额与已保存证据一致，再返回已有结果。
3. 要求状态为 `WAIT_BUYER_PAY`，并存在 `quotedAmount`、`adjustedAmount`、`adjustedAt`。
4. 精确转换三个 cents 为 `BigDecimal`。
5. 要求 `paid == itemTotal + postFee`、`postFee == 0`、`quoted == adjusted == paid`。
6. 写入 `paidAmount`、`paidAt`、固定来源和 `amountVerifiedAt`。
7. 自动履约关闭时转 `NEED_MANUAL`；开启时调用现有 `orderService.createOrder` 并进入 `PAID_WAIT_SUBMIT`。

所有已定义不一致保存为 `NEED_MANUAL`；`orderService.createOrder` 抛出的异常继续向上抛出，不转换成正常响应。

- [ ] **步骤 5：替换旧接口**

删除 `/api/xianyu/orders/paid`，增加：

```java
@PostMapping("/orders/{platformOrderId}/paid-verification")
public ApiResponse<XianyuOrderResponse> verifyPaid(
        @PathVariable String platformOrderId,
        @Valid @RequestBody XianyuPaidVerificationRequest request
) {
    return ApiResponse.ok(xianyuService.verifyPaid(platformOrderId, request));
}

@PostMapping("/orders/{platformOrderId}/verification-failures")
public ApiResponse<XianyuOrderResponse> recordVerificationFailure(
        @PathVariable String platformOrderId,
        @Valid @RequestBody XianyuVerificationFailureRequest request
) {
    return ApiResponse.ok(xianyuService.recordVerificationFailure(platformOrderId, request));
}
```

删除旧 `markPaidAndCreateOrder` 和 `XianyuPaidOrderRequest` 的所有调用，禁止保留双合同兼容分支。

- [ ] **步骤 6：运行后端流程测试**

```bash
mvn -Dtest=XianyuServiceTest,XianyuMvpFlowSimulationTest,UserDataIsolationTest test
```

预期：PASS，且 Mockito 验证所有失败分支 `orderService.createOrder` 调用次数为 0。

---

### 任务 5：接入插件交易编排并停止金额猜测

**文件：**

- 创建：`extension/src/xianyuTradeAutomation.ts`
- 创建：`extension/test/xianyuTradeAutomation.test.mjs`
- 修改：`extension/src/types.ts`
- 修改：`extension/src/xianyuContent.ts`
- 修改：`extension/src/xianyuPageHook.ts`

- [ ] **步骤 1：编写纯编排失败测试**

使用内存 fake ports 覆盖：

```js
test("waiting payment persists before adjusting and records success", async () => {
  await automation.handle(waitingPaymentEvent);
  assert.deepEqual(calls.map(call => call.name), [
    "registerWaitingPayment",
    "adjustPrice",
    "recordAdjusted",
    "sendEditPriceSuccess"
  ]);
});

test("paid summary resolves one persisted order before querying detail", async () => {
  await automation.handle(paymentSummaryEvent);
  assert.deepEqual(calls.map(call => call.name), [
    "resolveActiveOrder",
    "fetchOrderDetail",
    "verifyPaid"
  ]);
});

test("order detail protocol failure records failure and rethrows", async () => {
  await assert.rejects(() => automation.handle(paidEvent), /order detail/);
  assert.equal(calls.at(-1).name, "recordVerificationFailure");
  assert.equal(calls.at(-1).code, "ORDER_DETAIL_PROTOCOL_ERROR");
});
```

同时测试：改价失败不记录 adjusted；消息更新帧不触发改价；付款摘要找不到唯一订单时只记录协议事件；已付款卡片订单 ID 与后端活动订单不一致时失败。

- [ ] **步骤 2：运行测试确认失败**

```bash
cd extension
node --test test/xianyuTradeAutomation.test.mjs
```

预期：FAIL，缺少 `xianyuTradeAutomation.ts`。

- [ ] **步骤 3：实现依赖注入的交易编排**

```ts
export interface XianyuTradePorts {
  registerWaitingPayment(event: WaitingPaymentCard): Promise<WaitingPaymentResult>;
  adjustPrice(amountCents: number, orderId: string): Promise<void>;
  recordAdjusted(orderId: string, amountCents: number): Promise<void>;
  resolveActiveOrder(chatId: string): Promise<{ platformOrderId: string }>;
  fetchOrderDetail(orderId: string): Promise<VerifiedOrderAmounts>;
  verifyPaid(orderId: string, amounts: VerifiedOrderAmounts): Promise<void>;
  recordVerificationFailure(orderId: string, code: XianyuVerificationFailureCode): Promise<void>;
  recordUnboundProtocolEvent(chatId: string, eventType: string): Promise<void>;
  sendEditPriceSuccess(chatId: string, receiverId: string): Promise<void>;
}

type WaitingPaymentCard = Extract<XianyuInboundEvent, { kind: "WAITING_PAYMENT_CARD" }>;

interface WaitingPaymentResult {
  platformOrderId: string;
  quoteNo: string;
  totalPriceCents: number;
  status: "WAIT_BUYER_PAY";
}

export type XianyuVerificationFailureCode =
  | "ADJUST_PRICE_REJECTED"
  | "ORDER_DETAIL_REQUEST_FAILED"
  | "ORDER_DETAIL_PROTOCOL_ERROR"
  | "ORDER_ID_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "NON_ZERO_POST_FEE"
  | "MISSING_ADJUSTMENT";
```

`handle` 只接受 decoder 产出的交易事件；所有 switch 分支穷尽，default 使用 `never` 编译检查。页面 MTop 调用拒绝时包装为 `XianyuOrderDetailRequestError`，响应结构校验失败时由 decoder 抛出 `XianyuOrderDetailProtocolError`。automation 只捕获这两个明确类型，分别登记 `ORDER_DETAIL_REQUEST_FAILED` 或 `ORDER_DETAIL_PROTOCOL_ERROR` 后重新抛出；其他异常不转换、不吞掉。

- [ ] **步骤 4：把 bridge action 改为封闭枚举**

在 `extension/src/types.ts` 定义：

```ts
export const TOOL_ACTIONS = [
  "FETCH_IMAGE_DATA_URL",
  "GET_REPLY_CONFIG",
  "GET_AUTOMATION_CONFIG",
  "QUOTE_IMAGE",
  "POLL_ORDER",
  "PENDING_DELIVERIES",
  "DELIVERY_RESULT",
  "CLAIM_DELIVERY",
  "AGISO_TRADE_LIST",
  "AGISO_ADJUST_PRICE",
  "AGISO_SEND_DUMMY",
  "RECORD_AGISO_FALLBACK",
  "REGISTER_WAITING_PAYMENT",
  "RECORD_ADJUSTED",
  "RESOLVE_ACTIVE_ORDER",
  "VERIFY_PAID",
  "RECORD_VERIFICATION_FAILURE",
  "RECORD_PROTOCOL_EVENT"
] as const;

export type ToolAction = typeof TOOL_ACTIONS[number];

export interface ToolRequest {
  requestId: string;
  action: ToolAction;
  payload: Record<string, unknown>;
}
```

`decodeToolRequest` 使用 `TOOL_ACTIONS` 拒绝未知 action。`xianyuContent.ts` 对每个 action 逐字段 `requireString` / `requireSafeInteger` / `requireEnum`，映射到任务 3、4 的端点；禁止 `{ ...request.payload }` 直接透传和未知 action fallback。旧 `ORDER_PAID`、`ACTIVE_ORDER`、`LATEST_QUOTE`、`DUPLICATE_ORDER_BLOCKED`、`ADJUST_PRICE_FAILED` action 随旧流程删除，不保留兼容分支。

- [ ] **步骤 5：接入页面 MTop**

在 `xianyuPageHook.ts` 中：

- `adjustPrice` 改为只接收整数分，并使用 `createAdjustPriceRequest`、`decodeAdjustPriceResponse`。
- 增加 `fetchOrderDetail`，使用 `createOrderDetailRequest`、`decodeOrderDetailResponse`。
- `handleSocketMessage` 先调用 `decodeXianyuPayload`，ACK/状态帧明确返回，交易事件交给 `xianyuTradeAutomation`。
- 删除 `extractOrderId`、`extractBizOrderId`、`extractPaidAmount`、`findNestedValue`、递归 URL 搜索和基于 `includes("待付款")` / `includes("已付款")` 的交易分支。
- 图片与文本只读取 decoder 返回的结构化字段。
- 支付和失败请求不发送 `rawPayload`。

- [ ] **步骤 6：运行扩展测试**

```bash
cd extension
npm test
npm run typecheck
npm run build
```

预期：全部测试 PASS，构建产物中的 `xianyuContent.js`、`xianyuPageHook.js` 不包含顶层 ESM import/export。

---

### 任务 6：同步契约、运行全量验证并准备 Windows 验收

**文件：**

- 修改：`docs/apifox-openapi.yaml`
- 修改：`docs/integration-runbook.md`
- 修改：`docs/module-roadmap.md`
- 修改：`README.md`
- 修改：`src/test/java/com/movie/ticket/service/UserDataIsolationTest.java`
- 创建：`src/test/java/com/movie/ticket/dto/XianyuPaymentRequestValidationTest.java`

- [ ] **步骤 1：更新 OpenAPI 合同**

删除旧 `/api/xianyu/orders/paid` 和 `XianyuPaidOrderRequest` schema，增加五个新端点、DTO、失败码枚举、金额来源枚举。所有 cents 字段定义为 `integer/int64`；实体响应中的元金额继续定义为 decimal number。

- [ ] **步骤 2：更新联调文档**

明确记录：

```text
WAITING_PAYMENT_CARD
-> /orders/waiting-payment
-> adjust.price
-> /orders/{id}/adjusted
-> PAID_CARD 或 PAYMENT_SUMMARY
-> order.detail
-> /orders/{id}/paid-verification
```

记录 `priceInfo.amount.value` 是实付金额，`itemInfo.price` 是原价；记录任何协议或金额失败都不会触发上游下单。

- [ ] **步骤 3：增加隔离与请求验证回归测试**

在 `UserDataIsolationTest` 验证用户 A 不能通过五个新 Service 路径读取或修改用户 B 的订单；验证活动订单查询按 `userId + chatId + status` 限定。

在 `XianyuPaymentRequestValidationTest` 使用 `Validation.buildDefaultValidatorFactory().getValidator()` 断言待付款空字段、非正改价金额、非正实付金额、负运费和空来源均产生约束错误；使用 Spring Boot 配置的 Jackson `ObjectMapper` 反序列化未知失败码并断言抛出枚举反序列化异常。测试数据不包含真实平台 ID。

- [ ] **步骤 4：运行全量验证**

```bash
mvn test
cd extension
npm test
npm run typecheck
npm run build
```

预期：Maven BUILD SUCCESS；扩展所有 Node 测试 PASS；TypeScript 无错误；Vite build 成功。

- [ ] **步骤 5：检查安全和工作区差异**

```bash
rg -n "331462|331522|2026072923|umidToken|utdid|clientIp|39\.144\." \
  extension/test src/test docs README.md
git diff --check
git status --short
```

预期：敏感值扫描无结果；`git diff --check` 无输出；状态仅包含用户原有改动和本计划授权修改，不包含 `node_modules`、`target`、Token、Cookie 或 HAR。

- [ ] **步骤 6：Windows 手工验收**

后端保持 `ticket.xianyu.auto-fulfillment-enabled=false` 先完成安全演练，确认完整协议链路后再由用户显式开启。验收观察：

```text
报价金额（分） = adjust modifyFee = order.detail 成交价（分）
```

关闭自动履约时结果必须为 `NEED_MANUAL` 且没有本地上游订单；开启后的单独验收必须只创建一个本地订单。异常样本不得通过修改 fixture 或 fallback 绕过。

---

## 完成标准

- 所有已确认帧被唯一分类，未知帧显式失败。
- 改价同时校验 MTop `SUCCESS` 和 `data.success == true`。
- 订单详情实付金额只来自 `priceInfo.amount.value`。
- 后端持久化报价、改价和实付金额，并严格三方比较。
- 支付摘要只使用已持久化的唯一活动订单，不猜订单 ID。
- 任一失败均不创建上游订单；重复事件不创建重复订单。
- 支付流程不落库完整 raw payload、支付交易号、设备标识或认证信息。
- 后端、扩展测试、类型检查和构建全部通过。
