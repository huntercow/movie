# 电影票报价后端

基于 Java 17 + Spring Boot 3.3.5 的电影票报价、下单、支付和出票状态同步后端。

当前已接入：

- MySQL：保存报价单、订单、上游返回数据
- Redis：缓存票达人登录后的 `user-token`
- SpringDoc OpenAPI / Swagger：接口调试
- 阿里云 OSS：上传影票图片，上游 OCR 只识别票达人可访问的图片 URL
- 票达人上游：登录、OCR、官方报价、下单、支付、取消订单、订单详情同步

## 技术栈

- Java 17
- Spring Boot 3.3.5
- Spring Web
- Spring Data JPA
- MySQL
- Redis
- Spring Validation
- SpringDoc OpenAPI / Swagger
- 阿里云 OSS SDK
- Maven

## 多用户控制台

生产控制台入口：`/console/`。系统首次启动进入初始化页创建唯一管理员，之后由管理员创建和管理用户。

- 每个用户只能访问自己的报价、订单、话术、客户端状态和良票上游账号。
- 用户可以创建多个浏览器插件或微信机器人 Token；新 Token 必须由管理员设置有效期后才能激活。
- 一个 Token 只能绑定一个客户端 installation ID；换机或重装前需要在控制台解绑。
- 一个插件安装同一时间只运行一个当前闲鱼账号，切换闲鱼登录后由插件自动更新后端快照。
- 良票账号按用户保存并加密，OSS 继续使用平台统一配置。
- 管理员负责用户账号、Token 有效期、吊销和操作审计，不进入用户业务工作区。

平台接口的 ApiFox 导入文件为 `docs/apifox-platform-openapi.yaml`，部署说明见 `docs/platform-deployment.md`。

## 核心流程

### 报价流程

`POST /api/quotes` 会执行：

```text
图片 base64
-> 上传到阿里云 OSS
-> 调用票达人 OCR：/film/identify/filmIdentify
-> 调用票达人官方报价 LIMIT_PRICE：/film/order/officialQuotation
-> 调用票达人官方报价 FIX_PRICE：/film/order/officialQuotation
-> 选择两个报价里较大的一个
-> 本地按利润规则计算最终报价
-> 保存报价单
-> 返回给客户端
```

### 下单流程

`POST /api/orders` 只创建本地订单并立即返回，真正的上游下单由数据库持久任务队列执行：

```text
创建本地订单，状态 WAIT_SUBMIT
-> Worker 调用票达人 /film/order/officialSubmitOrder
-> 保存 upstreamOrderNo
-> 自动调用票达人 /film/order/payOrder
-> 调用 /film/order/getOrderDetail?orderNumber=...
-> 保存 data.orderInfo.id 为 upstreamOrderId
-> 后台定时同步出票状态
```

注意：

- `upstreamOrderNo` 是票达人订单号，也就是 `orderNumber`
- `upstreamOrderId` 是票达人订单 ID，也就是 `data.orderInfo.id`
- 取消订单接口 `/film/order/cancelOrder` 需要的是 `upstreamOrderId`，不是 `upstreamOrderNo`

### 闲鱼付款验证流程

闲鱼插件不会根据消息文案或可选字段猜测付款状态和金额。待付款、改价与付款验证按固定协议链路执行：

```text
WAITING_PAYMENT_CARD
-> POST /api/xianyu/orders/waiting-payment
-> mtop.idle.web.trade.adjust.price
-> POST /api/xianyu/orders/{platformOrderId}/adjusted
-> PAID_CARD 或 PAYMENT_SUMMARY
-> mtop.idle.web.trade.order.detail
-> POST /api/xianyu/orders/{platformOrderId}/paid-verification
```

订单详情中的 `priceInfo.amount.value` 是实付金额，`itemInfo.price` 是原价。后端只在报价、改价、实付金额完全一致且运费明确为零时允许自动履约；协议错误、订单 ID 不一致或金额不一致都进入 `NEED_MANUAL`，不会创建上游订单。默认 `ticket.xianyu.auto-fulfillment-enabled=false`，完成安全演练并明确授权真实出票后才能开启。

## 接口

### 接口鉴权

插件和机器人业务请求必须携带用户创建且在有效期内的 Token，以及该客户端的 installation ID：

```text
/api/xianyu/**                         X-Plugin-Token + X-Plugin-Installation-Id
/api/bot/**                            X-Bot-Token + X-Bot-Installation-Id
/api/quotes/**、/api/orders/**、
/api/upstream/**                       X-Admin-Token: local-admin-token
```

插件与机器人 Token 由用户控制台创建，并由管理员设置有效期。旧业务管理接口仍通过 `ADMIN_API_TOKEN` 保护。

### 机器人私聊报价

`POST /api/bot/messages/image`

机器人收到用户私聊发送的电影票截图后调用。后端会创建或更新客户档案，并完成上传、OCR、报价。

```json
{
  "wechatId": "wx_13800138000",
  "nickname": "Hunter",
  "avatarUrl": "https://example.com/avatar.jpg",
  "messageId": "msg_10001",
  "imageBase64": "图片base64"
}
```

返回里的 `customerNo` 是本系统客户编号，后续报价、收款、订单都会绑定这个客户。

`messageId` 用于幂等：

```text
同一个 wechatId + messageId 重复请求：直接返回第一次生成的 quote，不重复 OCR/报价
同一个用户发送新的图片：必须传新的 messageId，系统会生成新的 quote，并把它设置为 latestQuoteNo
收款和创建订单只允许使用该客户 latestQuoteNo 对应的报价
```

机器人侧实际处理建议：

```text
用户每发一张新图，就用机器人平台的新消息 ID 调 /api/bot/messages/image
后端返回 duplicated=true，说明这是同一条消息重试，不要重复回复用户
后端返回 latest=false，说明这条重复消息对应的报价已经不是最新图，机器人应忽略它
```

### 机器人确认收款

`POST /api/bot/payments/confirm`

人工或机器人确认用户已转账后调用。没有确认收款前，不应该创建订单。

```json
{
  "wechatId": "wx_13800138000",
  "quoteNo": "Q20260516120000ABCDEFGH",
  "amount": 58.38,
  "paymentNo": "wx-transfer-10001",
  "proofImageUrl": "https://example.com/pay.jpg",
  "confirmer": "admin",
  "remark": "微信私聊转账"
}
```

### 机器人创建订单

`POST /api/bot/orders`

校验报价归属和已确认收款金额后创建订单。创建成功后，该收款记录会标记为 `USED`，避免重复使用。

```json
{
  "wechatId": "wx_13800138000",
  "quoteNo": "Q20260516120000ABCDEFGH",
  "paymentRecordNo": "P20260516120000ABCDEFGH"
}
```

如果 `paymentRecordNo` 为空，系统会自动使用该报价最近一条 `CONFIRMED` 收款记录。

### 机器人查询订单

`GET /api/bot/orders/{orderNo}`

机器人轮询该接口获取出票状态。`shouldPoll=false` 时停止轮询，并按 `status` 和 `ticketCodeInfo` 给用户发送最终结果。

### 创建报价

`POST /api/quotes`

```json
{
  "imageBase64": "图片base64",
  "customerId": "wx-user-001",
  "channel": "WECHAT"
}
```

`channel` 当前支持：

- `WECHAT`
- `GOOFISH`

### 查询报价

`GET /api/quotes/{quoteNo}`

### 创建订单

`POST /api/orders`

```json
{
  "quoteNo": "Q20260512120000ABCDEFGH",
  "customerId": "wx-user-001",
  "paymentNo": "微信支付单号"
}
```

返回里的 `orderNo` 是本系统订单号，后续查询、重试、重新下单都用它。

### 查询订单

`GET /api/orders/{orderNo}`

订单返回里前端重点看这些字段：

```text
status                机器可读状态
statusText            前端展示文案
terminal              是否终态
shouldPoll            是否继续轮询
upstreamOrderNo        上游订单号 orderNumber
upstreamOrderId        上游订单 ID，取消订单用
upstreamOrderStatus    票达人 orderInfo.orderStatus
ticketCodeInfo         出票成功后的票码/取票图信息 JSON
lastSubmitError        下单/支付失败原因
lastSyncError          出票状态同步失败或上游失败原因
```

微信端建议逻辑：

```text
创建订单后拿到 orderNo
-> 每 3~5 秒调用 GET /api/orders/{orderNo}
-> shouldPoll=true 继续轮询
-> shouldPoll=false 停止轮询
-> terminal=true 时按 status 展示最终结果
```

### 重试提交上游订单

`POST /api/orders/{orderNo}/submit/retry`

只续跑已经获得 `upstreamOrderNo` 的订单：先查上游状态，再按需要继续支付和查单，不会再次调用上游创建订单。若本地没有上游订单号，接口会拒绝自动重试，要求先人工核对上游订单列表。

### 取消旧上游单并重新下单支付

`POST /api/orders/{orderNo}/submit/repeat?force=false`

用于人工手动重新下单支付。流程：

```text
如果本地订单已有 upstreamOrderId
-> 调用票达人 /film/order/cancelOrder，参数 orderId=upstreamOrderId
-> 重新调用 /film/order/officialQuotation 刷新 officialQuotationId 和 upstreamPrice
-> 重新计算 finalPrice、totalPrice、profit
-> 清空旧的上游订单号、提交响应、支付响应
-> 重新 officialSubmitOrder
-> 重新 payOrder
```

当历史提交已经失败但本地没有 `upstreamOrderNo` 时，提交结果可能处于未知状态。必须先人工核对上游订单列表，再显式使用 `force=true` 新建订单。

### 手动同步订单状态

`POST /api/orders/{orderNo}/sync`

正常情况下不需要微信端调用。系统会自动同步已有 `upstreamOrderNo` 且未完成的订单，这个接口主要用于后台排查或人工补偿。

### 登录票达人

`POST /api/upstream/piaodaren/login`

```json
{
  "userName": "票达人账号",
  "password": "票达人密码",
  "userTypeEnum": "Consume"
}
```

登录成功后，`user-token` 会保存到 Redis，后续 OCR、报价、下单、支付、同步会自动使用。

## 订单状态

本地订单状态：

```text
CREATED         已创建
WAIT_SUBMIT     等待提交上游
SUBMITTING      提交上游中
SUBMITTED       已提交上游
SUBMIT_FAILED   提交失败，终态
WAIT_PAY        等待支付
PAID            已支付
TICKETING       出票中
ISSUED          已出票，终态
FAILED          出票失败，终态
REFUNDED        已退款，终态
```

前端停止轮询条件：

```text
ISSUED / FAILED / REFUNDED / SUBMIT_FAILED
```

## 出票状态同步

系统会自动扫描满足条件的订单：

```text
有 upstreamOrderNo
状态属于 SUBMITTED / WAIT_PAY / PAID / TICKETING
```

默认每 30 秒调用：

```text
/film/order/getOrderDetail?orderNumber=upstreamOrderNo
```

同步映射：

```text
orderInfo.orderStatus = 1   -> WAIT_PAY
orderInfo.orderStatus = 4   -> TICKETING
orderInfo.orderStatus = 5   -> ISSUED
orderInfo.orderStatus = 12  -> REFUNDED
```

出票成功时解析：

```text
data.ticketInfo[].ticket
data.ticketInfo[].ticketCode
```

并保存到 `ticketCodeInfo`。

失败原因优先级：

```text
failedReason > refundReason > cancelReason
```

最终保存到 `lastSyncError`。

## 报价利润规则

最终单价不会超过 OCR 识别出的单张最高票面价 `maxPrice`。

```text
如果 upstreamPrice > maxPrice：报价失败
可用利润空间 = maxPrice - upstreamPrice
期望利润 = 可用利润空间 * markup-rate + fixed-markup
实际利润 = min(期望利润, 可用利润空间)
finalPrice = upstreamPrice + 实际利润
totalPrice = finalPrice * seatCount
profit = 实际利润 * seatCount
```

示例：

```yaml
ticket:
  pricing:
    markup-rate: 0.10
    fixed-markup: 1.00
```

```text
upstreamPrice = 27.66
maxPrice = 33.00
可用利润空间 = 5.34
期望利润 = 5.34 * 0.10 + 1.00 = 1.534
实际利润 = min(1.534, 5.34) = 1.534
finalPrice = 29.19

如果 seatCount = 2：
totalPrice = 29.19 * 2 = 58.38
profit = 1.534 * 2 = 3.07
```

## 配置

真实配置文件 `src/main/resources/application.yml` 不提交到 Git。

首次运行复制模板：

```bash
cp src/main/resources/application.example.yml src/main/resources/application.yml
```

Windows PowerShell：

```powershell
Copy-Item src/main/resources/application.example.yml src/main/resources/application.yml
```

### MySQL

创建数据库和用户：

```sql
CREATE DATABASE movie_ticket DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'movie_ticket'@'%' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON movie_ticket.* TO 'movie_ticket'@'%';
FLUSH PRIVILEGES;
```

### Redis

默认连接：

```yaml
spring:
  data:
    redis:
      host: localhost
      port: 6379
      password:
      database: 0
```

### 票达人与 OSS

核心配置：

```yaml
ticket:
  upstream:
    mock-enabled: false
    base-url: "http://business-api.liangpiao.net.cn"
    ocr-path: "/film/identify/filmIdentify"
    quote-path: "/film/order/officialQuotation"
    oss-region: "oss-cn-beijing"
    oss-bucket: "liangpiao-ticket-img"
    oss-access-key-id: ""
    oss-access-key-secret: ""
    oss-upload-dir: "ticket-img"
    user-name: ""
    password: ""
    user-type-enum: "Consume"
    auto-login: true
    user-token: ""
    connect-timeout: 5s
    read-timeout: 20s
    max-image-size: 10MB
  xianyu:
    plugin-api-token: ${XIANYU_PLUGIN_API_TOKEN:}
    auto-fulfillment-enabled: ${XIANYU_AUTO_FULFILLMENT_ENABLED:false}
  admin:
    api-token: ${ADMIN_API_TOKEN:}
  bot:
    api-token: ${BOT_API_TOKEN:}
```

账号、密码、OSS 密钥不要提交到 Git，建议放在本地 `application.yml` 或环境变量。

## 运行

```bash
mvn spring-boot:run
```

默认端口：

```text
8080
```

Swagger UI：

```text
http://localhost:8080/swagger-ui/index.html
```

OpenAPI JSON：

```text
http://localhost:8080/v3/api-docs
```

## 本地测试建议

1. 先用 `mock-enabled: true` 跑通报价和订单接口。
2. 确认 MySQL、Redis 正常连接。
3. 再切换 `mock-enabled: false`，填写票达人账号和 OSS 配置。
4. 调用 `POST /api/upstream/piaodaren/login` 获取并缓存 `user-token`。
5. 用 Swagger 测试 `POST /api/quotes`。
6. 客户确认后调用 `POST /api/orders`。
7. 轮询 `GET /api/orders/{orderNo}`，直到 `shouldPoll=false`。
