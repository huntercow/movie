# 电影票后端

基于 Java 17 + Spring Boot 3 的电影票报价/订单后端。当前已接入 MySQL、Redis、Swagger、阿里云 OSS 上传，以及票达人 OCR/官方报价流程。

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

## 核心流程

`POST /api/quotes` 会执行：

```text
图片 base64
→ 上传到阿里云 OSS
→ 调票达人 OCR：/film/identify/filmIdentify
→ 调票达人报价 LIMIT_PRICE：/film/order/officialQuotation
→ 调票达人报价 FIX_PRICE：/film/order/officialQuotation
→ 选择两个报价中较大的一个
→ 本地加价
→ 保存报价单
→ 返回最终报价
```

## 接口

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

创建本地订单后会立即返回，并异步提交票达人上游订单。订单初始状态为 `WAIT_SUBMIT`，后台任务会调用：

```text
/film/order/officialSubmitOrder
/film/order/payOrder
```

提交成功后保存 `upstreamOrderNo`，随后自动支付。支付成功后状态变为 `PAID`。提交或支付失败后状态变为 `SUBMIT_FAILED`，并保存失败原因。

支付成功后，后台会内部调用：

```text
/film/order/getOrderDetail?orderNumber=...
```

并从返回的 `data.orderInfo.id` 保存 `upstreamOrderId`。注意 `upstreamOrderId` 是取消订单用的 `orderId`，和 `upstreamOrderNo` 不是同一个字段。

### 查询订单

`GET /api/orders/{orderNo}`

系统会自动同步已有 `upstreamOrderNo` 且未完成的订单，默认每 30 秒扫描一次。也可以手动触发同步：

```http
POST /api/orders/{orderNo}/sync
```

同步逻辑：

```text
调用 /film/order/getOrderDetail?orderNumber=upstreamOrderNo
读取 data.orderInfo.orderStatus
1  → WAIT_PAY
4  → TICKETING
5  → ISSUED
12 → REFUNDED
```

如果 `orderStatus=5`，会解析 `data.ticketInfo[]` 下的：

```text
ticket
ticketCode
```

并保存到 `ticketCodeInfo`。失败原因按优先级保存到 `lastSyncError`：

```text
failedReason > refundReason > cancelReason
```

### 重试提交上游订单

`POST /api/orders/{orderNo}/submit/retry`

### 取消旧上游单并重新下单支付

`POST /api/orders/{orderNo}/submit/repeat`

用于人工手动重新下单支付。流程：

```text
如果本地订单已有 upstreamOrderId
→ 调票达人 /film/order/cancelOrder，参数 orderId
→ 重新调用 /film/order/officialQuotation 刷新 officialQuotationId 和 upstreamPrice
→ 更新本地 quote/order 的 finalPrice、totalPrice、profit
→ 清空旧的上游订单号/支付响应
→ 重新 officialSubmitOrder
→ 重新 payOrder
```

注意：票达人取消接口参数是 `orderId`，不是 `orderNumber`。如果本地只有 `upstreamOrderNo` 但没有 `upstreamOrderId`，系统会拒绝重下单，避免旧上游订单无法取消造成重复订单。

### 登录票达人

`POST /api/upstream/piaodaren/login`

```json
{
  "userName": "票达人账号",
  "password": "票达人密码",
  "userTypeEnum": "Consume"
}
```

登录成功后，`user-token` 会保存到 Redis，后续 OCR 和报价自动使用。

登录接口会结构化返回票达人用户资料：

```json
{
  "loggedIn": true,
  "userToken": "token",
  "profile": {
    "id": "1475639100836352000",
    "userName": "19934419145",
    "enable": 1,
    "regTime": "1771861377543",
    "openId": "openid",
    "headImg": "头像地址",
    "nickname": "Hunter.",
    "userBusinesses": [
      {
        "businessType": "Film"
      }
    ]
  },
  "raw": {}
}
```

## 配置

真实配置文件 `src/main/resources/application.yml` 不提交到 Git。首次运行可以复制模板：

```bash
cp src/main/resources/application.example.yml src/main/resources/application.yml
```

Windows PowerShell：

```powershell
Copy-Item src/main/resources/application.example.yml src/main/resources/application.yml
```

### MySQL

先创建数据库和用户，例如：

```sql
CREATE DATABASE movie_ticket DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'movie_ticket'@'%' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON movie_ticket.* TO 'movie_ticket'@'%';
FLUSH PRIVILEGES;
```

然后修改 `application.yml`：

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/movie_ticket?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true
    username: movie_ticket
    password: change-me
```

### Redis

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

```yaml
ticket:
  upstream:
    mock-enabled: false
    base-url: "http://business-api.liangpiao.net.cn"
    ocr-path: "/film/identify/filmIdentify"
    quote-path: "/film/order/officialQuotation"
    oss-region: "oss-cn-beijing"
    oss-bucket: "liangpiao-ticket-img"
    oss-access-key-id: "你的 OSS AccessKeyId"
    oss-access-key-secret: "你的 OSS AccessKeySecret"
    oss-upload-dir: "ticket-img"
    user-name: "票达人账号"
    password: "票达人密码"
    user-type-enum: "Consume"
    auto-login: true
    user-token: ""
```

建议使用环境变量或外部配置注入账号、密码、OSS 密钥，不要提交到 Git。

### 报价利润

最终报价不会超过 OCR 识别到的单张最高票面价 `maxPrice`。当前公式：

```text
如果 upstreamPrice > maxPrice：报价失败
可用利润空间 = maxPrice - upstreamPrice
期望利润 = 可用利润空间 × markup-rate + fixed-markup
实际利润 = min(期望利润, 可用利润空间)
finalPrice = upstreamPrice + 实际利润
totalPrice = finalPrice × ticketInfo.seatCount
profit = 实际利润 × ticketInfo.seatCount
```

例如：

```yaml
ticket:
  pricing:
    markup-rate: 0.10
    fixed-markup: 1.00
```

`upstreamPrice=27.66`，`maxPrice=33.00`：

```text
可用利润空间 = 33.00 - 27.66 = 5.34
期望利润 = 5.34 × 0.10 + 1.00 = 1.534
实际利润 = min(1.534, 5.34) = 1.534
finalPrice = 27.66 + 1.534 = 29.19
```

如果识别到 2 张票：

```text
totalPrice = 29.19 × 2 = 58.38
profit = 1.534 × 2 = 3.07
```

## 运行

```bash
mvn spring-boot:run
```

默认端口：`8080`

Swagger UI：`http://localhost:8080/swagger-ui/index.html`

OpenAPI JSON：`http://localhost:8080/v3/api-docs`

## 本地测试建议

1. 先用 `mock-enabled: true` 跑通报价和订单接口。
2. 确认 MySQL、Redis 正常连接。
3. 再切 `mock-enabled: false`，填入票达人账号和 OSS 配置。
4. 使用 Swagger 测试 `POST /api/quotes`。
5. 客户确认后调用 `POST /api/orders`，观察订单是否异步变成 `PAID`。
