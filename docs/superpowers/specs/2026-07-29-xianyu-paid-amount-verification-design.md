# 闲鱼实付金额校验设计

日期：2026-07-29

## 1. 背景

闲鱼 WebSocket 已确认会下发图片消息、订单上下文、待付款卡片、已付款卡片、付款摘要和消息状态帧，但已付款 WebSocket 报文不包含可信的实际成交金额。当前插件通过递归搜索 `amount`、`price` 等字段猜测 `paidAmount`，会把商品原价或无关金额误认为实付金额，不符合 Fail Fast 和严格协议处理要求。

真实订单详情样本已确认：

- 接口：`mtop.idle.web.trade.order.detail`
- 请求：`data.tid` 为闲鱼订单 ID。
- 成功状态：顶层 `ret` 为非空字符串数组，`ret[0]` 的首段为 `SUCCESS`。
- 订单组件：`data.components` 中唯一一个 `render == "orderInfoVO"` 的对象。
- 实际成交价：`orderInfoVO.data.priceInfo.amount.value`，样本类型为两位小数字符串。
- 商品总价：`priceInfo.billList` 中 `code == "ITEM_TOTAL_FEE"` 的 `value`。
- 运费：`priceInfo.billList` 中 `code == "POST_FEE"` 的 `value`。
- `itemInfo.price` 是商品原价，改价订单中不等于实际成交价，禁止用于实付校验。

## 2. 目标与非目标

### 目标

- 以闲鱼官方订单详情中的成交价作为实付金额唯一来源。
- 持久化待付款订单与会话、报价和改价结果的关系，使仅含 `chatId` 的付款摘要也能安全定位唯一订单。
- 使用整数分跨越 TypeScript/HTTP 边界，后端领域和数据库继续使用 `BigDecimal`。
- 只有报价金额、成功改价金额和实际成交金额完全一致时才允许自动履约。
- 对未知状态、缺失字段、类型错误、订单不一致和金额不一致显式失败；任何失败均不得触发上游下单。
- 只持久化业务需要的结构化证据，不保存完整 WebSocket 或订单详情响应。

### 非目标

- 不保存支付宝交易号；当前自动履约和对账没有使用它的业务需求。
- 不从商品原价、卡片文案、最后一次改价请求或报价金额反推实际支付结果。
- 不添加自动重试、Agiso fallback、缓存金额或人工价格作为自动履约替代路径。
- 不实现新的财务对账模块。

## 3. 方案选择

采用“已付款后查询官方订单详情”的方案。

未采用的方案：

- 将成功的 `modifyFee` 当作实付金额：只能证明卖家请求了改价，不能证明买家最终支付结果。
- 缺少金额时继续自动履约：会放过少付、错单或协议异常。
- 永久保持 `NEED_MANUAL`：安全但无法实现完整自动履约目标。

## 4. 协议分类与订单关联

插件必须先使用独立 decoder 将入站帧分类，禁止使用文案包含判断或递归字段搜索：

- JSON ACK：明确忽略。
- 会话信号帧：明确忽略。
- PNM 消息状态帧：明确忽略。
- 标准文本消息。
- 标准图片消息。
- 订单上下文帧：读取协议位置中的 `chatId`、`itemId`、`orderId`，但不单独宣称订单处于待付款。
- 待付款 `contentType == 26` 卡片：按已确认的卡片标题、`redReminder` 和卡片 URL 读取并交叉校验订单 ID。
- 已付款 `contentType == 26` 卡片：按 `TRADE_PAID_DONE_SELLER`、卡片标题和 `redReminder` 识别并交叉校验订单 ID。
- 付款摘要：只包含 `chatId` 和 `redReminder == "等待卖家发货"`，不包含订单 ID。
- `TRADE_MODIFY_FEE_BUYER` 消息更新帧：只更新消息状态，不触发新一轮改价。

订单上下文帧只用于临时建立并交叉校验候选关联，不能改变业务状态。只有完整待付款卡片同时通过状态、卡片结构和订单 ID 一致性校验后，插件才调用后端待付款登记接口。后端按当前用户保存 `chatId -> platformOrderId` 关系，并要求同一会话最多存在一个自动履约中的订单。不能使用“查询第一条”掩盖多条活动订单；零条或多条都必须显式失败。

## 5. 待付款与改价流程

```text
严格解析待付款卡片和订单 ID
-> 后端登记 WAIT_BUYER_PAY 并绑定最新 quoteNo
-> 后端返回 totalPriceCents
-> 插件调用 adjust.price，modifyFee 直接使用 totalPriceCents
-> 严格校验 ret SUCCESS 和 data.success == true
-> 插件通知后端记录 adjustedAmount 与 adjustedAt
```

待付款登记必须先于外部改价调用完成，避免页面刷新后丢失订单关联。后端请求结束后再调用闲鱼 MTop，不在数据库事务或锁中执行外部网络请求。

`mtop.taobao.idle.trade.user.adjust.price` 的已确认合同：

- `modifyFee`：整数分，JSON number。
- `newTransportFee`：精确字符串 `"0"`。
- `orderId`：非空字符串。
- `ret[0]` 首段必须为 `SUCCESS`。
- `data` 必须为对象，且 `data.success` 必须为 boolean `true`。

改价失败不自动重试，不发送改价成功话术，并把订单转为 `NEED_MANUAL`。

## 6. 已付款与订单详情流程

完整已付款卡片直接提供订单 ID；付款摘要必须通过后端已持久化的唯一活动订单取得订单 ID。取得订单 ID 后调用：

```text
POST mtop.idle.web.trade.order.detail
data = { tid: platformOrderId }
```

响应按以下顺序校验：

1. 响应是对象，`api` 精确等于 `mtop.idle.web.trade.order.detail`。
2. `ret` 是非空字符串数组，`ret[0]` 首段精确等于 `SUCCESS`。
3. `data` 是对象，`data.components` 是数组。
4. `render == "orderInfoVO"` 的组件必须恰好一个。
5. 组件 `data.orderInfoList` 中标题为 `订单编号` 的条目必须恰好一个，其字符串 `value` 必须等于请求的订单 ID。
6. `priceInfo.amount.value` 必须是格式为 `^[0-9]+\.[0-9]{2}$` 的字符串。
7. `billList` 中 `ITEM_TOTAL_FEE` 和 `POST_FEE` 必须各有且只有一个，二者 `value` 使用相同金额格式。
8. 成交价必须等于商品总价加运费；本流程的运费必须为零，因为改价请求明确设置 `newTransportFee = "0"`。

金额字符串使用严格十进制解析转换为安全整数分，禁止先转为 JavaScript 浮点数再乘 100。

## 7. 金额一致性与状态流转

自动履约必须同时满足：

```text
quotedAmountCents == adjustedAmountCents
adjustedAmountCents == actualPaidAmountCents
postFeeCents == 0
```

满足时，插件向后端提交已验证的 `paidAmountCents` 和固定来源枚举 `XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT`。后端重新校验保存的报价、改价金额和实付金额，并将整数分精确转换为 `BigDecimal` 元后写入 `paidAmount`。

状态流转：

```text
WAIT_BUYER_PAY
-> 记录改价成功
-> 收到付款信号并验证订单详情
-> PAID_WAIT_SUBMIT
-> 原有上游下单流程
```

已知唯一订单时，以下已定义业务情况进入 `NEED_MANUAL`：

- 支付订单 ID 与持久化订单不一致。
- 订单详情查询返回明确失败。
- 订单详情协议结构不符合本设计。
- 运费不为零。
- 报价、改价或实付金额不一致。
- 改价成功记录缺失。
- 自动履约配置关闭。

付款摘要找不到唯一活动订单时，后端记录不含敏感信息的用户范围协议事件并拒绝处理；因为此时不存在可安全选定的订单，禁止猜选某一订单并修改其状态。

协议解析异常在订单 ID 已唯一确定时，记录错误码、将该订单转为 `NEED_MANUAL` 后重新抛出；订单 ID 未确定时只记录用户范围协议事件并重新抛出。两种情况都不得吞掉异常或继续创建订单。

## 8. 后端数据与接口

`XianyuPlatformOrder` 保留现有字段，并增加最小必要字段：

- `adjustedAmount`：`BigDecimal(12,2)`。
- `adjustedAt`：改价成功时间。
- `amountVerificationSource`：固定枚举来源。
- `amountVerifiedAt`：订单详情金额通过校验的时间。

继续保存：`platformOrderId`、`chatId`、`itemId`、`quoteNo`、`quotedAmount`、`paidAmount`、`paidAt` 和履约状态。

新增或调整接口分别承担单一职责：

- `POST /api/xianyu/orders/waiting-payment`：登记待付款订单，绑定最新报价并返回 `platformOrderId`、`quoteNo`、`totalPriceCents` 和 `status`。
- `POST /api/xianyu/orders/{platformOrderId}/adjusted`：接收 `adjustedAmountCents`，要求其等于已保存的报价金额，然后记录改价成功时间。
- `GET /api/xianyu/orders/waiting-payment/{chatId}`：只为付款摘要解析返回恰好一条已记录改价的 `WAIT_BUYER_PAY` 订单；零条、多条或缺少改价记录均失败。
- `POST /api/xianyu/orders/{platformOrderId}/paid-verification`：接收 `paidAmountCents`、`itemTotalCents`、`postFeeCents` 和固定来源枚举；后端完成三方金额校验并仅在通过后进入原有创建订单流程。
- `POST /api/xianyu/orders/{platformOrderId}/verification-failures`：只接受项目定义的失败码，将已确定的订单转为 `NEED_MANUAL`，不接受客户端自由文本作为状态判断依据。
- `POST /api/xianyu/events`：订单 ID 无法唯一确定时记录用户范围协议事件，不改变任意订单状态。

所有查询和写入继续绑定插件 Token 对应的 `userId`，不得接受客户端传入 `userId` 作为授权依据。

## 9. 数据最小化

数据库不保存：

- 完整 WebSocket `rawPayload`。
- 完整订单详情响应。
- 支付宝交易号。
- Cookie、Token、签名、IP、UMID、UTDID。
- 与金额验证无关的买家昵称、地址、电话和图片 URL。

诊断与审计只记录结构化字段：协议类型、订单 ID、会话 ID、报价编号、金额、状态、错误码和时间。测试 fixture 对用户 ID、订单号、交易号、图片 URL 和设备信息做一致性脱敏，保留字段结构、类型、状态码和金额。

本次修改停止所有支付流程的 `rawPayload` 写入。现有 nullable `rawPayload` 列暂时保留但不再读取或写入；删除历史列和清理历史数据不属于本次范围，且不得修改已有 Flyway 文件。

## 10. 测试与验收

### 插件单元测试

- 已确认的 ACK、会话信号、PNM 状态、图片、待付款卡片、已付款卡片、付款摘要和消息更新帧均有脱敏 fixture。
- 每种帧只进入唯一 decoder；未知结构失败。
- 订单详情成功样本解析出成交价，而不是 `itemInfo.price`。
- 缺失/重复 `orderInfoVO`、错误 `api`、未知 `ret`、错误订单 ID、非法金额、缺失账单项和非零运费全部失败。
- 改价成功必须同时满足 `ret SUCCESS` 与 `data.success == true`。

### 后端测试

- 待付款订单关联持久化且受用户范围隔离。
- 同一会话零条、多条活动订单均不会被静默选中。
- 报价、改价、实付金额一致时才创建本地订单。
- 任一金额不一致、验证来源未知、重复回调或自动履约关闭时不调用上游。
- 重复已付款事件保持幂等，不产生重复本地订单。

### Windows 手工验收

```text
图片报价
-> 买家拍下
-> 插件按报价自动改价
-> 买家确认价格并付款
-> 插件查询订单详情
-> 后端保存实付金额
-> 金额一致时创建唯一一笔本地订单
```

手工验收同时验证金额不一致和订单详情协议异常时进入 `NEED_MANUAL`，且没有上游下单调用。
