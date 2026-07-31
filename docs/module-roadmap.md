# 闲鱼电影票自动发货模块路线图

## 当前原则

- 一个模块一个模块收口：每个模块都有已完成、待完成、验收方法。
- 真实出票、真实支付、取消订单都必须有明确触发入口，不放进普通健康检查。
- 闲鱼同一买家当前只认最近一次截图报价；已付款后严禁同一会话重复下单。
- 本地配置和账号密码只放未跟踪 `application.yml`，不提交 Git。

## Module 1：良票上游联调

状态：安全自检已完成，等待真实 OCR/下单验收。

已完成：

- 良票 H5 静态逆向已记录在 `docs/liangpiao-h5-api.md`。
- 后端已支持 `ticket.upstream.provider=liangpiao-h5`。
- `LiangPiaoH5Client` 已作为 `TicketUpstreamClient` 接入，复用良票 business API。
- 已有登录、登录态、H5 探测接口：
  - `GET /api/upstream/piaodaren/status`
  - `GET /api/upstream/piaodaren/smoke`
  - `POST /api/upstream/piaodaren/login/configured`
  - `POST /api/upstream/piaodaren/login`
  - `GET /api/upstream/piaodaren/h5/probe`
- smoke 自检只访问 H5 首页和只读城市列表 API，不会 OCR、报价、提交、支付、取消。
- 所有上游 HTTP 请求已有连接和读取超时，401 会清理失效 Token。
- Redis 不可用时登录态退回进程内缓存，不阻断当前进程联调。
- 图片类型、Base64、大小以及 OCR 场次、座位、价格已增加前置校验。
- 已增加 OCR、双通道报价和 401 契约测试。
- 登录 Token 不再写入账号表，启动时会清理历史敏感登录数据。

待完成：

- 用真实截图验证 OCR + 报价，不自动进入下单。
- 真实下单、支付、查单只在用户明确要求时跑。

验收：

- `GET /api/upstream/piaodaren/smoke` 返回配置、登录态和安全探测结果。
- `POST /api/upstream/piaodaren/login/configured` 能获取并保存 `user-token`。
- OCR/报价失败时错误可读，不影响闲鱼幂等状态。

## Module 2：闲鱼插件主链路

状态：基本完成，等待真实账号全链路验收。

已完成：

- MV3 插件可从 `extension/dist` 加载。
- 闲鱼 IM WebSocket hook、消息解码、关键词回复可用。
- 图片消息上报后端并自动发送报价。
- 等待付款消息后按已确认的闲鱼 MTop 协议改价，失败立即停止并暴露错误。
- 已付款后先从 `mtop.idle.web.trade.order.detail` 严格读取实付金额，再提交后端三方金额验证；不从消息内容猜测金额或订单 ID。
- 付款主链路固定为：登记待付款订单、MTop 改价、记录改价、查询订单详情、提交付款验证。
- 出票成功后发送取票信息并按已确认的闲鱼 MTop 协议虚拟发货，失败立即停止。
- 调试入口：`window.xianyuMovieTicketDebug` 和 DOM 状态属性。
- popup 可显示阿奇索连接状态和历史降级记录；当前主链路不会新增自动降级记录。

待完成：

- 继续补充更多闲鱼消息结构样本。
- 对同一买家连续多张截图只保留最后报价的行为做显式日志。

验收：

- 关键词“你好”自动回复。
- 买家发截图后自动报价。
- 改价成功时不再误发失败话术。
- 已付款只触发一次后端出票。

## Module 3：后端闲鱼履约状态机

状态：已完成第一轮加固。

已完成：

- `/api/xianyu/*` 主接口已实现。
- 图片消息、报价、付款、出票状态、发货回写都有幂等记录。
- 同一 `chatId` 有活动订单时阻止第二个不同 `platformOrderId` 下单。
- `REFUNDED`、`CLOSED` 会释放会话。
- 单测覆盖重复图片、金额不一致、同会话第二单、人工退款。
- 单测覆盖同一平台订单重复付款不重复创建本地订单。
- 单测覆盖本地订单出票后进入 `ISSUED_WAIT_DELIVER`。
- 单测覆盖发货回写成功后进入 `DELIVERED`。
- 已增加异常事件查询接口：
  - `GET /api/xianyu/events`
  - `GET /api/xianyu/events?chatId=xxx`
- 已支持无 `messageId` 的异常事件落库。
- 已接入自动履约总开关：
  - `ticket.xianyu.auto-fulfillment-enabled=false` 时，已付款停在 `NEED_MANUAL`，不会创建本地订单或触发上游提交。
- 自动履约配置缺失时按关闭处理。
- 同一会话、平台订单、报价和本地订单增加数据库锁与版本字段。
- 报价金额、改价金额和 `priceInfo.amount.value` 实付金额必须完全一致，且运费必须明确为零；任一不一致都进入人工处理且不创建上游订单。
- 出票后先持久化唯一 Delivery Attempt，再向一个页面授予一次性发货权限；结果未知时永久禁止自动重放外部动作。
- 发货结果严格绑定 `platformOrderId + attemptId`；完全相同的结果回写幂等，attempt、结果、渠道或失败摘要冲突时立即失败。
- 上游 retry 只续跑已知订单；未知提交结果必须人工核对后显式强制重下。

待完成：

- 真实环境下按 runbook 验证开关关闭时不会触发出票。

验收：

- `mvn test` 全绿。
- 重复付款事件不会重复创建上游订单。
- 金额不一致进入 `NEED_MANUAL`。
- 出票成功后进入待发货，发货回写成功后进入已发货。

## Module 4：人工异常处理台

状态：已完成第一轮可用版本。

已完成：

- 新增最小静态处理台页面：
  - `/xianyu-manual.html`
- 支持查询 `NEED_MANUAL`、`ISSUED_WAIT_DELIVER`、`PAID_WAIT_SUBMIT`、`TICKETING`、`DELIVERED`、`REFUNDED`、`CLOSED`。
- 支持按 `chatId` 筛选。
- 支持填写 `X-Plugin-Token` 调用受保护的闲鱼接口。
- 支持人工标记 `REFUNDED`、`CLOSED`、`DELIVERED`。
- 支持点击订单查看详情。
- 支持查看最近事件和按订单会话筛选事件。

待完成：

- 增加更精细的搜索、分页和操作审计。

验收：

- 人工退款/关闭后，同买家可以继续下一单。
- 页面可加载异常订单，并成功调用 `/api/xianyu/orders/{platformOrderId}/manual`。

## Module 5：阿奇索独立集成

状态：保留代理与可观测能力，未接入自动履约主链路。

已完成：

- 采集 `https://aldsidle.agiso.com/*` 的 `localStorage.TOKEN`。
- background 代理阿奇索接口并自动带 Bearer token。
- 已接入 `Trade/List`、`Trade/AdjustPrice`、`ManualSend/SendDummy`。
- popup 显示阿奇索 token 是否已获取、token 更新时间、最近一次阿奇索请求。
- 可读取历史上最近 20 条阿奇索降级记录：
  - 改价 fallback 原因。
  - 虚拟发货 fallback 原因。
  - 请求摘要。
  - 响应摘要。
  - 成功/失败结果。

启用前置条件：

- 明确由哪一个业务动作直接选择阿奇索，禁止把它作为 MTop 异常后的自动 fallback。
- 现场确认各接口唯一响应结构和状态字段后再实现分支。
- 使用真实登录态的任何写操作都需要单独授权。

## Module 6：配置和话术管理

状态：已完成第一轮持久化。

已完成：

- 插件内置默认关键词话术。
- 可加载 `extension/闲鱼关键词回复规则_2026-03-16.json` 和 `extension/闲鱼业务话术_2026-03-16.json`。
- 后端持久化默认话术配置：
  - `GET /api/xianyu/reply-config`
  - `PUT /api/xianyu/reply-config`
- 插件 popup 支持从后端加载话术配置。
- 插件 popup 支持保存当前话术配置到后端。
- 微信机器人接口已使用独立 `X-Bot-Token`，接口合同见 `docs/wechat-bot-api.md`。
- 同一微信图片消息、外部支付号和报价重复请求会返回原记录。

待完成：

- 增加多版本配置、回滚、按店铺区分配置。

验收：

- 修改话术后重载插件，关键词回复按新配置生效。

## Module 7：测试与真实联调

状态：持续进行。

已完成：

- 后端 `mvn test` 当前 122 个测试全绿。
- 插件 `npm test` 当前 139 个测试全绿，`npm run typecheck`、`npm run build` 当前通过。
- 已新增 `docs/integration-runbook.md` 作为真实联调步骤。

待完成：

- 每个模块完成后固定跑对应测试。
- 真实 Chrome + 闲鱼测试账号完整走一次：截图、报价、改价、付款、出票、发货。

验收：

- 每个步骤有明确日志；协议错误和未知状态立即失败，不自动降级。
- 不出现重复下单。
