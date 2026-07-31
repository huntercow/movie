# 闲鱼电影票自动发货联调 Runbook

## 0. 安全开关

真实联调前建议先关闭自动履约：

```yaml
ticket:
  xianyu:
    auto-fulfillment-enabled: false
```

关闭后，闲鱼已付款事件会进入 `NEED_MANUAL`，不会创建本地订单，也不会触发良票上游提交/支付。

确认要真实出票时，再改为：

```yaml
ticket:
  xianyu:
    auto-fulfillment-enabled: true
```

## 1. 后端安全自检

```powershell
$env:JAVA_HOME='C:\Users\Admin\.jdks\ms-21.0.10'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
mvn test
```

启动后端后先访问：

- `GET /api/upstream/piaodaren/status`
- `GET /api/upstream/piaodaren/smoke`
- `POST /api/upstream/piaodaren/login/configured`
- `GET /api/upstream/piaodaren/h5/probe`

这些步骤不会下单或支付。

上述上游接口需要请求头：

```text
X-Admin-Token: local-admin-token
```

## 2. 插件检查

```powershell
cd D:\workspace\Movie\extension
npm run typecheck
npm run build
```

Chrome 加载目录：

```text
D:\workspace\Movie\extension\dist
```

插件 popup 检查：

- 后端地址正确。
- 插件 Token 与 `ticket.xianyu.plugin-api-token` 一致。
- 阿奇索状态显示 token 已获取。
- 关键词和话术配置可从后端加载/保存。

### 2.1 Windows Chrome 加载 WSL 构建

在 WSL 中构建：

```bash
cd /home/hunter/workspace/Movie/extension
npm test
npm run typecheck
npm run build
```

Windows Chrome 打开 `chrome://extensions`，启用“开发者模式”，点击“加载已解压的扩展程序”，选择：

```text
\\wsl.localhost\Ubuntu-22.04\home\hunter\workspace\Movie\extension\dist
```

代码重新构建后，在 `chrome://extensions` 中点击该扩展的“重新加载”，并刷新已打开的闲鱼页面。

### 2.2 闲鱼协议样本采集

样本包含原始业务数据，可能包括聊天内容、用户 ID、商品 ID、订单 ID、金额和带签名的图片 URL。只使用测试账号和测试内容，不要把未脱敏的导出文件提交到 Git 或发送给无关人员。

采集前关闭插件 popup 中的“自动回复”，然后每个文件只采集一种场景：

1. 切换到 `https://www.goofish.com/` 闲鱼页面，再打开插件 popup。
2. 在“闲鱼协议样本采集”中选择场景并点击“开始采样”。
3. 使用测试买家只触发一次目标事件。
4. 重新打开 popup，确认样本数量大于零，然后点击“停止采样”。
5. 点击“导出 JSON”，保存文件后点击“清空”。
6. 选择下一个场景并重复以上步骤。

需要分别导出：

- `TEXT`：买家发送普通文字。
- `IMAGE`：买家发送图片。
- `WAIT_PAYMENT`：买家拍下商品并进入待付款。
- `PAID`：买家完成付款并进入待发货；保持后端自动履约关闭。
- `OTHER`：其他需要确认结构的业务卡片或状态消息。

采样只保存在当前闲鱼页面内存中。刷新或关闭闲鱼页面会清空会话；达到 50 条或 5 MiB 时会进入 `ERROR` 并停止追加，不会静默截断。

## 3. 闲鱼安全联调

付款链路必须按以下顺序执行，不得从消息文案或字段是否存在猜测状态：

```text
WAITING_PAYMENT_CARD
-> POST /api/xianyu/orders/waiting-payment
-> mtop.idle.web.trade.adjust.price
-> POST /api/xianyu/orders/{platformOrderId}/adjusted
-> PAID_CARD 或 PAYMENT_SUMMARY
-> mtop.idle.web.trade.order.detail
-> POST /api/xianyu/orders/{platformOrderId}/paid-verification
```

`order.detail` 中 `priceInfo.amount.value` 是实付金额，`itemInfo.price` 是商品原价，不能互换。插件只提交严格解析出的整数分；报价金额、改价金额和实付金额必须完全一致，且运费必须明确为零。订单详情请求失败、协议错误、订单 ID 不一致或金额不一致时，必须记录固定失败码并停止，不能触发本地或上游下单。

在 `auto-fulfillment-enabled=false` 下验证：

- 买家发“你好”，插件自动回复。
- 买家发截图，后端报价，插件发送报价。
- 买家拍下后自动改价。
- 买家付款后，插件读取订单详情并提交结构化金额证据；订单进入 `NEED_MANUAL`，不触发上游提交。
- 人工处理台可看到该订单：
  - `http://localhost:8080/xianyu-manual.html`
- 人工处理台可查看订单详情和事件。
- 标记 `REFUNDED` 或 `CLOSED` 后，同一买家会话释放。

## 4. 真实出票验收

只在明确确认后执行：

- 设置 `auto-fulfillment-enabled=true`。
- 使用测试场次和可控座位。
- 确认报价金额（分）等于 MTop 改价 `modifyFee`，并等于 `order.detail` 成交价（分）。
- 买家付款后确认只创建一个本地订单。
- 后端提交良票上游并支付。
- 轮询出票状态。
- 出票成功后插件发送取票信息。
- 插件发送前先调用发货认领接口；后端持久化 `DELIVERY_OUTCOME_PENDING` 和唯一 `deliveryAttemptId` 后，才向一个页面返回一次性发货数据。
- 插件在第一个外部发货动作前移除本地 active 订单，并用同一 `platformOrderId + attemptId` 回写结果；回写超时或响应不明时不得重放外部动作。
- 插件虚拟发货只执行已确认的闲鱼 MTop 协议；失败后停止，不自动切换渠道。
- 后端订单进入 `DELIVERED`。

## 5. 失败处理

- 金额不一致：进入 `NEED_MANUAL`。
- 重复付款事件：不重复创建本地订单。
- 同会话第二个不同闲鱼订单：进入 `NEED_MANUAL`，提示严禁连下两单。
- 改价失败：保留 MTop/桥接错误并进入人工排查，不自动重试或切换阿奇索。
- 发货失败：只回写固定阶段摘要；回写不明时保留 `DELIVERY_OUTCOME_PENDING` 并人工核对，不回写伪造成功结果、不重放外部动作。
