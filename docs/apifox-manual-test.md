# ApiFox 手动测试指南

## 1. 导入接口

在 ApiFox 中选择“项目设置 -> 导入数据 -> 手动导入”，优先导入多用户平台文档：

```text
docs/apifox-platform-openapi.yaml
```

旧版业务接口的完整请求样例仍在：

```text
docs/apifox-openapi.yaml
```

数据格式选择 OpenAPI/Swagger，导入模式建议选择“智能合并”。本地服务地址已经设置为：

```text
http://127.0.0.1:8080
```

后端运行时也会提供动态文档：

- OpenAPI JSON：`http://127.0.0.1:8080/v3/api-docs`
- Swagger UI：`http://127.0.0.1:8080/swagger-ui/index.html`

仓库中的 YAML 是人工校对后的联调文档，包含风险说明和手测示例；动态文档适合后续核对代码是否新增接口。

## 2. 多用户模式鉴权

平台文档包含四种变量：

| 变量 | 来源 |
| --- | --- |
| `accessToken` | 登录或初始化响应的 `data.accessToken` |
| `pluginToken` | 用户控制台创建插件 Token 后唯一一次返回的明文 |
| `pluginInstallationId` | 插件本地生成并持久化的 UUID，手测可自行生成 |
| `botToken` / `botInstallationId` | 微信机器人对应的 Token 与本机 UUID |

`/api/v1/app/**` 与 `/api/v1/admin/**` 使用 `Authorization: Bearer {{accessToken}}`。插件和机器人先调用激活接口，再分别携带 Token 与 Installation ID。一个 Token 在解绑前不能换到另一个 Installation ID。Token 绑定的是插件安装，不是闲鱼账号。

## 3. 首次初始化与授权测试

1. `GET /api/v1/auth/bootstrap-status`。只有 `initialized=false` 时才能继续初始化。
2. `POST /api/v1/auth/bootstrap` 创建唯一管理员，并保存返回的 `accessToken`。
3. 管理员调用 `POST /api/v1/admin/users` 创建用户，只需填写用户名和初始密码。
4. 新用户登录后必须调用 `/api/v1/app/account/change-password` 修改初始密码。
5. 用户调用 `POST /api/v1/app/agents/tokens` 创建插件或机器人 Token，明文只返回一次，初始状态应为 `PENDING`。
6. 此时直接调用 `/api/v1/agents/activate`，应返回“等待管理员审批”的业务错误。
7. 管理员调用 `GET /api/v1/admin/agent-tokens` 找到该 Token，再调用 `PUT /api/v1/admin/agent-tokens/{tokenId}/expiry` 设置未来到期时间。
8. 用户重新用安装 ID 调 `/api/v1/agents/activate`，此时应激活成功；改用另一安装 ID 重试应返回 HTTP 400。
9. 激活后调用插件或机器人业务接口，验证请求被归属到该 Token 的用户。

### 插件切换闲鱼账号

同一插件安装只保留一个当前闲鱼账号快照。先用固定的 `pluginToken` 和 `pluginInstallationId` 激活并上报账号 A：

```json
{
  "token": "{{pluginToken}}",
  "agentType": "XIANYU_PLUGIN",
  "installationId": "{{pluginInstallationId}}",
  "clientVersion": "0.1.0",
  "currentXianyuAccountId": "seller-a",
  "currentXianyuNickname": "卖家 A"
}
```

然后调用同一个 `POST /api/v1/agents/heartbeat`，保持 Token 和安装 ID 不变，只把账号改成 `seller-b`。再次查询 `GET /api/v1/app/agents`，`data[].instance.currentXianyuAccountId` 应只显示 `seller-b`，不会保留 A 作为绑定关系。

插件明确检测到退出登录时，上报 `"currentXianyuAccountId": ""` 会清空当前账号；完全省略该字段则保留原快照，适用于浏览器刚启动但闲鱼页面尚未打开的情况。

## 4. 客户端业务请求鉴权

Token 审批并激活后，插件和机器人每次业务请求都必须同时携带 Token 和 installation ID：

| 接口范围 | 请求头 |
| --- | --- |
| `/api/xianyu/**` | `X-Plugin-Token: {{pluginToken}}`、`X-Plugin-Installation-Id: {{pluginInstallationId}}` |
| `/api/bot/**` | `X-Bot-Token: {{botToken}}`、`X-Bot-Installation-Id: {{botInstallationId}}` |
| `/api/quotes/**`、`/api/orders/**`、`/api/upstream/**` | `X-Admin-Token: local-admin-token` |

服务端不再接受全局插件或机器人 Token 旁路。不要把真实良票账号、密码或 Token 保存到共享环境。

建议增加以下 ApiFox 环境变量，便于串联请求：

| 变量 | 用途 |
| --- | --- |
| `ticketImageBase64` | 测试票务截图的完整 Base64 字符串 |
| `quoteNo` | 报价接口返回的 `data.quoteNo` |
| `paymentRecordNo` | 微信确认收款返回的 `data.paymentRecordNo` |
| `orderNo` | 创建订单返回的 `data.orderNo` |
| `upstreamUsername` | 良票测试账号，仅保存在私有环境 |
| `upstreamPassword` | 良票测试密码，仅保存在私有环境 |

## 5. 启动本地后端

本地 profile 依赖 MySQL `movie_ticket` 和 Redis。Linux/WSL：

```bash
bash scripts/dev-linux.sh
```

Windows PowerShell：

```powershell
.\scripts\test-windows.ps1
```

本地 profile 默认启用上游 mock，并关闭闲鱼自动履约：

```yaml
ticket:
  upstream:
    mock-enabled: true
  xianyu:
    auto-fulfillment-enabled: false
```

这是手动验证闲鱼状态流转的安全配置。要测试真实 OCR/报价，需要配置真实上游和 OSS；要测试真实出票，还要另外显式开启自动履约。

## 6. 推荐测试顺序

### A. 无下单风险的基础检查

1. `GET /api/upstream/piaodaren/status`
2. `GET /api/upstream/piaodaren/h5/probe`
3. `GET /api/upstream/piaodaren/smoke`
4. `POST /api/upstream/piaodaren/login/configured`，或使用私有变量调用 `/login`

预期统一响应结构：

```json
{
  "success": true,
  "message": "ok",
  "data": {}
}
```

Token 错误返回 HTTP 401，后端未配置相应 Token 返回 HTTP 503，参数或业务错误返回 HTTP 400。

### B. 闲鱼后端安全测试

保持 `auto-fulfillment-enabled=false`，按以下顺序测试：

1. `POST /api/xianyu/events`，再用 `GET /api/xianyu/events?chatId=apifox-chat-001` 核对写入。
2. `GET`、`PUT /api/xianyu/reply-config`，核对配置可读写。
3. 准备有效截图后调用 `POST /api/xianyu/messages/image`。
4. 保存返回的 `data.quoteNo`，查询 `GET /api/xianyu/quotes/latest/{chatId}`。
5. 收到待付款卡片后调用 `POST /api/xianyu/orders/waiting-payment`，使用响应中的 `totalPriceCents` 执行改价。
6. 改价成功后调用 `POST /api/xianyu/orders/{platformOrderId}/adjusted`，请求体只提交 `adjustedAmountCents`。
7. 买家付款后查询闲鱼订单详情，并调用 `POST /api/xianyu/orders/{platformOrderId}/paid-verification`。实付、商品合计和运费都使用整数分，来源固定为 `XIANYU_ORDER_DETAIL_PRICE_INFO_AMOUNT`。自动履约关闭时预期状态为 `NEED_MANUAL`，且不应生成 `localOrderNo`。
8. 订单详情请求或协议校验失败时调用 `POST /api/xianyu/orders/{platformOrderId}/verification-failures`，只提交文档定义的失败码。
9. 查询订单列表、活动订单和订单详情。
10. 用 `/manual` 将测试订单标为 `CLOSED` 或 `REFUNDED`，释放该测试会话。

测试幂等时，重复发送完全相同的 `chatId + messageId` 或 `platformOrderId`；测试新消息、新订单时必须更换 ID。

### C. 微信机器人接口合同测试

微信机器人本身暂时不可调试时，ApiFox 可以直接模拟机器人调用：

1. `POST /api/bot/messages/image`
2. `POST /api/bot/payments/confirm`
3. 确认真正允许出票后，才调用 `POST /api/bot/orders`
4. `GET /api/bot/orders/{orderNo}` 每 3 至 5 秒轮询一次，`shouldPoll=false` 后停止

`status=ISSUED` 时读取 `ticketCodeInfo`；`SUBMIT_FAILED` 或 `FAILED` 必须转人工，不要自动创建第二张订单。

## 7. 高风险接口

以下请求不要用于普通连通性测试：

| 接口 | 风险 |
| --- | --- |
| `POST /api/orders` | 创建本地订单并可能异步提交、支付上游 |
| `POST /api/bot/orders` | 收款后创建订单并可能异步提交、支付上游 |
| `POST /api/orders/{orderNo}/submit/retry` | 续跑已有上游订单，仍可能支付 |
| `POST /api/orders/{orderNo}/submit/repeat?force=true` | 可能重复下单和重复支付，风险最高 |
| `POST /api/xianyu/orders/{platformOrderId}/paid-verification` | 金额证据全部匹配且自动履约开启时，可能立即创建本地订单并异步提交、支付上游 |

`repeat` 接口默认 `force=false` 并拒绝强制重下。任何真实出票测试都应使用可控场次、可控金额和唯一的测试业务 ID，并在上游后台核对只生成了一张订单。

## 8. 图片 Base64

请求体中的 `imageBase64` 是 JSON 字符串，不是 `multipart/form-data` 文件。可以将图片转换成 Base64 后放到 ApiFox 私有环境变量 `ticketImageBase64`。图片较大时不要把 Base64 提交到仓库，也不要放进团队共享环境。

遇到失败时依次检查：后端是否监听 `8080`、MySQL/Redis 是否可用、请求头是否匹配接口分组、上游是否处于 mock、真实联调时 OSS 与良票登录态是否完整。
