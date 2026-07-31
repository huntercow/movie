# 微信机器人后端接口合同

微信机器人当前只依赖 HTTP 接口，不要求机器人客户端与后端同时开发。

## 通用约定

- Base URL：`http://127.0.0.1:8080`
- 新版机器人首次启动调用 `POST /api/v1/agents/activate`，传入用户创建且已由管理员设置有效期的机器人 Token、`agentType=WECHAT_BOT` 和本机持久化的 `installationId`。
- 激活后所有 `/api/bot/**` 请求必须同时携带 `X-Bot-Token` 和 `X-Bot-Installation-Id`。
- 机器人每 5 分钟调用 `POST /api/v1/agents/heartbeat`。重装前需要用户在控制台解绑旧安装，否则同一 Token 不能绑定第二台机器人。
- JSON 响应统一为 `success`、`message`、`data`。
- 业务参数错误返回 HTTP 400；Token 无效、未审批、过期或安装不匹配返回 HTTP 401。

## 1. 图片报价

`POST /api/bot/messages/image`

`wechatId + messageId` 是幂等键。机器人重试同一条图片消息时必须保持 `messageId` 不变；用户发送新图片时必须使用新的 `messageId`。

成功响应中的：

- `duplicated=true`：后端返回原报价，没有再次调用 OCR。
- `latest=false`：该消息对应的报价已经不是用户最新报价，机器人不应再次发送给用户。
- `quote.totalPrice`：整单应收金额。

## 2. 确认收款

`POST /api/bot/payments/confirm`

`paymentNo` 必填，应使用微信支付单号或机器人平台付款事件 ID。同一 `paymentNo` 重试时返回原收款记录；如果客户、报价或金额不同则拒绝请求。

只有当前用户的最新报价允许确认收款。

## 3. 创建订单

`POST /api/bot/orders`

请求传入 `wechatId`、`quoteNo` 和可选的 `paymentRecordNo`。未指定收款记录时，后端选择该报价最近一条 `CONFIRMED` 记录。

约束：

- 报价必须属于当前微信用户且仍是最新报价。
- 已确认金额不得低于报价总额。
- 一条收款记录只能消费一次。
- 同一报价重复创建订单时返回原订单，不会再次提交上游。

## 4. 查询订单

`GET /api/bot/orders/{orderNo}`

机器人根据以下字段轮询：

- `shouldPoll=true`：继续轮询，建议间隔 3 至 5 秒。
- `shouldPoll=false`：停止轮询。
- `terminal=true`：订单已经进入不可自动恢复的终态。
- `status=ISSUED`：使用 `ticketCodeInfo` 向用户发送取票信息。
- `status=SUBMIT_FAILED` 或 `FAILED`：转人工处理，不要自动创建第二张订单。

机器人接口不会直接提供“重新下单”能力。续跑和强制重新下单属于管理操作，必须使用带 `X-Admin-Token` 的 `/api/orders/**` 接口。
