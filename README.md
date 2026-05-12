# 电影票后端

基于 Java 17 + Spring Boot 3 的电影票报价/下单后端。当前版本先完成接口骨架，默认使用 mock 上游，后续把票达人抓包接口参数填入 `PiaoDaRenClient` 即可切真实上游。

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

流程：上传图片到上游 → OCR → 上游报价 → 本地加价 → 保存报价。

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

### 查询订单

`GET /api/orders/{orderNo}`

### 登录票达人

`POST /api/upstream/piaodaren/login`

```json
{
  "userName": "票达人账号",
  "password": "票达人密码",
  "userTypeEnum": "Consume"
}
```

登录成功后，后端会在内存中保存本次返回的 `user-token`，后续 OCR、报价会自动使用它。也可以在配置文件里开启自动登录。

## 运行

```bash
mvn spring-boot:run
```

默认端口：`8080`

Swagger UI：`http://localhost:8080/swagger-ui/index.html`

OpenAPI JSON：`http://localhost:8080/v3/api-docs`

H2 控制台：`http://localhost:8080/h2-console`

JDBC URL：`jdbc:h2:file:./data/ticket-backend;MODE=MySQL;DATABASE_TO_UPPER=false`

## 切换真实票达人上游

旧 Python 项目里的票达人路径已经迁移到 Java：

- OCR：`/film/identify/filmIdentify`，表单字段 `imgUrl`
- 官方报价：`/film/order/officialQuotation`，分别请求 `LIMIT_PRICE` 和 `FIX_PRICE`，选择报价较大的一个
- 图片上传：使用阿里 OSS SDK 直传，路径 `ticket-img/{uuid}.jpg`

把 `src/main/resources/application.yml` 中：

```yaml
ticket:
  upstream:
    mock-enabled: false
    base-url: "http://business-api.liangpiao.net.cn"
    ocr-path: "/真实OCR路径"
    quote-path: "/真实报价路径"
    oss-region: "oss-cn-beijing"
    oss-bucket: "liangpiao-ticket-img"
    oss-access-key-id: "你的 OSS AccessKeyId"
    oss-access-key-secret: "你的 OSS AccessKeySecret"
    oss-upload-dir: "ticket-img"
    user-name: "票达人账号"
    password: "票达人密码"
    user-type-enum: "Consume"
    auto-login: true
    user-token: "可选，登录后会自动覆盖本次运行内存 token"
```

建议用环境变量或外部配置注入 OSS 密钥，不要提交到 Git。

## 下一步建议

- 把上传接口改成 `multipart/form-data`，避免前端直接传大 base64。
- 增加管理员后台接口：订单列表、利润统计、手动改价、补单。
- 增加微信用户表、返利规则表和渠道分佣表。
- 上线前从 H2 切到 MySQL/PostgreSQL。
