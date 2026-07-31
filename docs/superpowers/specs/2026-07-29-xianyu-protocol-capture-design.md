# 闲鱼 WebSocket 协议样本采集设计

日期：2026-07-29
状态：已批准

## 1. 背景与目标

当前 Chrome 扩展能够 Hook 闲鱼网页已建立的 WebSocket，并能解码外层 JSON 以及 `syncPushPackage` 中的 Base64 + MessagePack 数据。但是，`xianyuPageHook.ts` 对聊天 ID、发送者、消息内容、商品、订单和金额仍存在多路径猜测。没有当前闲鱼网页产生的正式入站样本，就不能在遵守 Fail Fast 原则的前提下把这些解析器收敛为唯一协议结构。

本功能用于让用户在 Windows Chrome 中选择业务场景、采集已解码的闲鱼入站消息并手动导出 JSON。导出的样本将用于后续协议分析、脱敏 fixture 和严格 TypeScript decoder，不直接参与正常业务判断。

本功能不解决协议解析本身，也不改变自动回复、改价、订单创建、付款确认或发货流程。

## 2. 用户操作

插件 popup 增加“协议样本采集”面板，包含：

- 场景选择：`普通文字`、`图片`、`待付款`、`已付款`、`其他`。
- `开始采样`：以选中的单一场景创建新采样会话。已有未清空样本时立即拒绝开始，避免混合场景。
- `停止采样`：停止记录，但保留当前页面内存中的样本。
- `清空`：清除当前会话及全部样本；执行前要求用户确认。
- `导出 JSON`：仅在会话已停止且至少包含一条样本时可用。通过浏览器本地下载生成文件。
- 状态区域：显示当前状态、场景、样本数量、累计序列化字节数和最后错误。

popup 可以关闭后再打开；采样状态保存在闲鱼页面的 page-hook 内存中，因此关闭 popup 不会结束采样。刷新或关闭闲鱼页面会清除采样状态，popup 必须明确显示“页面中没有采样会话”。

## 3. 组件边界与通信

### 3.1 Popup

`popup.ts` 只负责 UI、校验用户操作、向当前闲鱼标签页发送采样命令，以及将 page hook 返回的导出对象下载为文件。它不解析闲鱼消息，也不保存样本。

### 3.2 Content script

`xianyuContent.ts` 作为 Chrome 隔离世界与页面世界之间的严格消息桥：

1. 接收 popup 通过 `chrome.tabs.sendMessage` 发出的采样命令。
2. 校验命令结构和动作枚举。
3. 使用专用 `CustomEvent` 将命令发送给 page hook。
4. 校验 page hook 的响应结构，再返回 popup。

只支持 `START`、`STOP`、`CLEAR`、`STATUS`、`EXPORT` 五个动作。未知动作、字段缺失或类型错误必须显式失败。

### 3.3 Page hook

page hook 拥有唯一的内存采样会话。WebSocket 入站数据成功完成现有传输层解码后、进入任何业务字段提取和自动化分支之前，将解码结果交给采样器。

采样器只记录消息，不判断它是聊天、卡片、ACK、心跳还是订单消息。这样未知结构也能被观察，且不会把当前猜测写进采样协议。

## 4. 采样数据格式

导出根对象采用明确版本：

```json
{
  "schemaVersion": 1,
  "scenario": "TEXT",
  "startedAt": "2026-07-29T00:00:00.000Z",
  "stoppedAt": "2026-07-29T00:01:00.000Z",
  "exportedAt": "2026-07-29T00:02:00.000Z",
  "records": [
    {
      "sequence": 1,
      "receivedAt": "2026-07-29T00:00:10.000Z",
      "transport": "SYNC_PUSH_MSGPACK",
      "payload": {}
    }
  ]
}
```

约束如下：

- `scenario` 只接受 `TEXT`、`IMAGE`、`WAIT_PAYMENT`、`PAID`、`OTHER`。
- `transport` 只接受 `JSON` 或 `SYNC_PUSH_MSGPACK`，由传输层实际走过的解码分支确定，不根据内容猜测。
- `payload` 是传输层解码后的完整值，不使用 `safeJsonPreview`，不截取字段，不运行现有业务 extractor。
- MessagePack 二进制值必须序列化为带显式类型标记的 Base64 对象；无法无损转换为导出格式的值使采样会话进入错误状态。
- 文件名格式为 `xianyu-protocol-<scenario>-<UTC timestamp>.json`。

## 5. 状态机与 Fail Fast

采样会话状态为：

```text
EMPTY -> CAPTURING -> STOPPED -> EXPORTED
                    -> ERROR
```

- 只有 `EMPTY` 可以 `START`。
- 只有 `CAPTURING` 可以 `STOP` 和追加消息。
- 只有 `STOPPED` 可以 `EXPORT`。
- `CLEAR` 可以从非 `EMPTY` 状态回到 `EMPTY`。
- 非法状态操作立即返回明确错误，不自动开始、停止、清空或导出。
- 采集上限为 50 条或 5 MiB JSON 数据。新增一条记录会超过任一上限时，该记录不加入，会话进入 `ERROR` 并显示原因；禁止静默丢弃、截断或覆盖旧记录。
- WebSocket 传输层解码失败继续沿用现有显式异常，不把原始未验证内容伪装成已解码样本。
- 采样器异常不得被转换成正常状态，也不得改变 WebSocket、自动回复或宿主页面的协议处理结果。

## 6. 隐私与安全边界

- 样本仅保存在当前闲鱼页面内存中，不进入 `chrome.storage`，不发送到项目后端或任何第三方。
- 不新增 Chrome `permissions`、`host_permissions` 或网络请求。
- 导出是用户主动点击触发的本地 Blob 下载。
- 导出文件是原始业务样本，可能包含聊天内容、用户 ID、商品 ID、订单 ID、金额和带签名的图片 URL。UI 必须在开始和导出位置显示敏感数据警告。
- 本阶段不实现自动脱敏，因为未知协议字段无法证明完整脱敏；伪装成安全文件会带来更高泄漏风险。优先使用测试账号和测试内容。样本进入仓库前再通过独立离线流程脱敏，并由人工确认。
- 不采集 Cookie、HTTP 请求头、插件 Token 或浏览器存储内容。

## 7. Windows 与 WSL 工作流

1. 在 WSL 的 `extension/` 中执行类型检查和构建。
2. Windows Chrome 打开 `chrome://extensions`，启用开发者模式。
3. 选择“加载已解压的扩展程序”，通过 `\\wsl.localhost\Ubuntu-22.04\home\hunter\workspace\Movie\extension\dist` 加载。
4. 打开闲鱼 IM，在 popup 中选择一个场景并开始采样。
5. 使用测试买家账号只触发该场景，然后停止并导出。
6. 每个场景使用独立文件；清空后再开始下一个场景。

构建完成时应给出当前机器可直接复制的 Windows UNC 路径，并说明扩展重载步骤。

## 8. 测试与验收

采样状态和导出构造逻辑提取为不依赖 DOM/Chrome API 的独立 TypeScript 模块，并采用测试先行方式覆盖：

- 合法状态流转。
- 每种场景枚举。
- 非法动作和非法状态立即失败。
- 只在采样状态追加解码消息。
- 保留嵌套消息结构和明确的传输类型。
- 50 条和 5 MiB 边界；超限进入错误状态且不静默截断。
- 空会话、未停止会话不能导出。
- 导出 schema 和文件名稳定。
- 二进制值的显式序列化以及不可序列化值的失败行为。

实现完成后执行：

```bash
cd extension
npm test
npm run typecheck
npm run build
```

Windows 手工验收至少确认：

- Chrome 能从 WSL 构建目录加载扩展。
- popup 关闭再打开后仍能看到同一页面的采样状态。
- 普通文字场景可导出非截断 JSON。
- 刷新闲鱼页面后旧会话消失并明确展示为空状态。
- 自动回复开关关闭时仍可采样，且采样不会触发后端请求。

## 9. 非目标

- 不直接复制 `xianyu-auto-reply` 的 AGPL 实现。
- 不在本阶段收紧闲鱼业务 decoder。
- 不自动识别场景或按消息内容猜测类别。
- 不上传、同步或长期保存样本。
- 不增加自动重试、降级或未知协议兼容逻辑。
