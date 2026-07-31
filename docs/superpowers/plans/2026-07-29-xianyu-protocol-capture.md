# 闲鱼 WebSocket 协议样本采集实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 Windows Chrome 插件 popup 中提供严格、仅本地、手动控制的闲鱼 WebSocket 解码样本采集与 JSON 导出能力。

**架构：** 将协议合同、WebSocket 传输判别和采样状态机放入纯 TypeScript 模块，通过 Node 内置测试运行器进行 TDD。page hook 持有唯一内存会话，content script 严格桥接 popup 与页面世界，popup 只控制会话和下载文件，不参与协议推断。

**技术栈：** TypeScript 5.6、Chrome Manifest V3、Vite 5、Node.js 22 内置 test runner、现有 msgpack-lite 浏览器脚本。

**工作区约束：** `extension/` 当前是用户未跟踪工作，不能通过新 worktree 可靠继承；在现有工作区中只修改本计划列出的文件。未经用户明确授权不执行 Git commit，每个任务用定向 `git diff --check` 和验证命令作为检查点。

---

## 文件结构

- 创建 `extension/src/protocolCapture.ts`：采样合同、严格解码器、传输层判别、无 DOM 状态机和导出构造。
- 创建 `extension/test/protocolCapture.test.mjs`：Node 22 直接导入 TypeScript 源码，覆盖合同、传输和状态机。
- 修改 `extension/package.json`：增加 `npm test`，不引入新依赖。
- 修改 `extension/src/xianyuPageHook.ts`：持有采样会话、记录已解码入站消息、处理页面世界采样命令。
- 修改 `extension/src/xianyuContent.ts`：严格桥接 Chrome 消息与 page hook CustomEvent。
- 修改 `extension/popup.html`：增加采样面板和敏感数据提示。
- 修改 `extension/src/popup.ts`：控制活动闲鱼标签页、显示状态并下载导出文件。
- 修改 `docs/integration-runbook.md`：记录 Windows 从 WSL 加载和五类场景采样步骤。

### 任务 1：建立采样协议合同与测试入口

**文件：**
- 创建：`extension/test/protocolCapture.test.mjs`
- 创建：`extension/src/protocolCapture.ts`
- 修改：`extension/package.json`

- [ ] **步骤 1：在 package scripts 中增加测试命令**

将 `extension/package.json` 的 scripts 改为：

```json
{
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "build": "vite build && node scripts/copy-static.mjs",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **步骤 2：编写合同解码失败测试**

创建 `extension/test/protocolCapture.test.mjs`：

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeCaptureCommand,
  decodeCaptureStatus
} from "../src/protocolCapture.ts";

test("decodeCaptureCommand accepts only defined actions and scenarios", () => {
  assert.deepEqual(decodeCaptureCommand({ action: "START", scenario: "TEXT" }), {
    action: "START",
    scenario: "TEXT"
  });
  assert.throws(
    () => decodeCaptureCommand({ action: "START", scenario: "UNKNOWN" }),
    /capture command scenario is not defined/
  );
  assert.throws(
    () => decodeCaptureCommand({ action: "RETRY" }),
    /capture command action is not defined/
  );
});

test("decodeCaptureStatus rejects incomplete status objects", () => {
  assert.throws(
    () => decodeCaptureStatus({ state: "EMPTY" }),
    /capture status scenario/
  );
});
```

- [ ] **步骤 3：运行测试并确认红灯**

运行：

```bash
cd extension
npm test
```

预期：FAIL，错误指出 `../src/protocolCapture.ts` 不存在或未导出目标函数。

- [ ] **步骤 4：实现合同类型和严格解码器**

创建 `extension/src/protocolCapture.ts`，先实现：

```ts
export const CAPTURE_SCENARIOS = ["TEXT", "IMAGE", "WAIT_PAYMENT", "PAID", "OTHER"] as const;
export const CAPTURE_ACTIONS = ["START", "STOP", "CLEAR", "STATUS", "EXPORT"] as const;
export const CAPTURE_STATES = ["EMPTY", "CAPTURING", "STOPPED", "EXPORTED", "ERROR"] as const;
export const CAPTURE_TRANSPORTS = ["JSON", "SYNC_PUSH_MSGPACK"] as const;

export type CaptureScenario = typeof CAPTURE_SCENARIOS[number];
export type CaptureAction = typeof CAPTURE_ACTIONS[number];
export type CaptureState = typeof CAPTURE_STATES[number];
export type CaptureTransport = typeof CAPTURE_TRANSPORTS[number];

export type CaptureCommand =
  | { action: "START"; scenario: CaptureScenario }
  | { action: Exclude<CaptureAction, "START">; scenario?: never };

export interface CaptureStatus {
  state: CaptureState;
  scenario: CaptureScenario | null;
  recordCount: number;
  byteCount: number;
  startedAt: string | null;
  stoppedAt: string | null;
  lastError: string | null;
}

export function decodeCaptureCommand(value: unknown): CaptureCommand {
  const record = requireRecord(value, "capture command");
  const action = requireEnum(record.action, CAPTURE_ACTIONS, "capture command action");
  if (action === "START") {
    return { action, scenario: requireEnum(record.scenario, CAPTURE_SCENARIOS, "capture command scenario") };
  }
  if (record.scenario !== undefined) throw new Error(`capture command ${action} must not include scenario`);
  return { action };
}

export function decodeCaptureStatus(value: unknown): CaptureStatus {
  const record = requireRecord(value, "capture status");
  return {
    state: requireEnum(record.state, CAPTURE_STATES, "capture status state"),
    scenario: record.scenario === null
      ? null
      : requireEnum(record.scenario, CAPTURE_SCENARIOS, "capture status scenario"),
    recordCount: requireNonNegativeInteger(record.recordCount, "capture status recordCount"),
    byteCount: requireNonNegativeInteger(record.byteCount, "capture status byteCount"),
    startedAt: requireNullableString(record.startedAt, "capture status startedAt"),
    stoppedAt: requireNullableString(record.stoppedAt, "capture status stoppedAt"),
    lastError: requireNullableString(record.lastError, "capture status lastError")
  };
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireEnum<T extends string>(value: unknown, values: readonly T[], context: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`${context} is not defined: ${String(value)}`);
  }
  return value as T;
}

function requireNonNegativeInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative integer`);
  }
  return value;
}

function requireNullableString(value: unknown, context: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value) throw new Error(`${context} must be null or a non-empty string`);
  return value;
}
```

- [ ] **步骤 5：运行合同测试并确认绿灯**

运行：`cd extension && npm test`

预期：当前全部测试通过，0 个失败。

- [ ] **步骤 6：检查本任务范围**

运行：

```bash
git diff --check -- extension/package.json extension/src/protocolCapture.ts extension/test/protocolCapture.test.mjs
```

预期：退出码 0，无输出。

### 任务 2：以 TDD 实现传输判别和无损 JSON 转换

**文件：**
- 修改：`extension/test/protocolCapture.test.mjs`
- 修改：`extension/src/protocolCapture.ts`

- [ ] **步骤 1：增加传输层和二进制转换测试**

在测试文件导入 `decodeSocketFrame`、`toCaptureJsonValue`，增加：

```js
test("decodeSocketFrame identifies direct JSON without content guessing", () => {
  const decoded = decodeSocketFrame('{"code":200}', () => assert.fail("msgpack must not run"));
  assert.deepEqual(decoded, { transport: "JSON", payload: { code: 200 } });
});

test("decodeSocketFrame decodes the defined syncPushPackage path", () => {
  const encoded = btoa(String.fromCharCode(1, 2, 3));
  const decoded = decodeSocketFrame(JSON.stringify({
    body: { syncPushPackage: { data: [{ data: encoded }] } }
  }), (bytes) => ({ bytes: [...bytes] }));
  assert.deepEqual(decoded, {
    transport: "SYNC_PUSH_MSGPACK",
    payload: { bytes: [1, 2, 3] }
  });
});

test("decodeSocketFrame rejects malformed defined sync packages", () => {
  assert.throws(
    () => decodeSocketFrame('{"body":{"syncPushPackage":{"data":[]}}}', () => ({})),
    /syncPushPackage data must contain exactly one entry/
  );
});

test("toCaptureJsonValue preserves structure and marks binary values", () => {
  assert.deepEqual(toCaptureJsonValue({ nested: [new Uint8Array([1, 2])] }), {
    nested: [{ $binaryBase64: "AQI=" }]
  });
  assert.throws(() => toCaptureJsonValue({ value: undefined }), /is not JSON-compatible/);
});
```

- [ ] **步骤 2：运行新增测试并确认红灯**

运行：`cd extension && npm test`

预期：FAIL，错误指出新函数未导出。

- [ ] **步骤 3：实现唯一传输分支和 JSON 转换**

在 `protocolCapture.ts` 增加：

```ts
export type CaptureJsonValue = null | boolean | number | string | CaptureJsonValue[] | {
  [key: string]: CaptureJsonValue;
};

export interface DecodedSocketFrame {
  transport: CaptureTransport;
  payload: unknown;
}

export function decodeSocketFrame(
  data: unknown,
  decodeMessagePack: (bytes: Uint8Array) => unknown
): DecodedSocketFrame {
  if (typeof data !== "string") throw new Error("xianyu websocket message must be a string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    throw new Error("xianyu websocket message is not valid JSON", { cause: error });
  }
  const root = requireRecord(parsed, "xianyu websocket JSON root");
  if (!Object.prototype.hasOwnProperty.call(root, "body")) return { transport: "JSON", payload: root };
  const body = requireRecord(root.body, "xianyu websocket body");
  if (!Object.prototype.hasOwnProperty.call(body, "syncPushPackage")) return { transport: "JSON", payload: root };
  const sync = requireRecord(body.syncPushPackage, "xianyu syncPushPackage");
  if (!Array.isArray(sync.data) || sync.data.length !== 1) {
    throw new Error("xianyu syncPushPackage data must contain exactly one entry");
  }
  const entry = requireRecord(sync.data[0], "xianyu syncPushPackage data[0]");
  if (typeof entry.data !== "string" || !entry.data) throw new Error("xianyu sync package data must be Base64 text");
  let binary: string;
  try {
    binary = atob(entry.data);
  } catch (error) {
    throw new Error("xianyu sync package data is not valid Base64", { cause: error });
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return { transport: "SYNC_PUSH_MSGPACK", payload: decodeMessagePack(bytes) };
}

export function toCaptureJsonValue(value: unknown, path = "payload", seen = new WeakSet<object>()): CaptureJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} is not JSON-compatible`);
    return value;
  }
  if (value instanceof Uint8Array) {
    let binary = "";
    for (const byte of value) binary += String.fromCharCode(byte);
    return { $binaryBase64: btoa(binary) };
  }
  if (typeof value !== "object" || value === null) throw new Error(`${path} is not JSON-compatible`);
  if (seen.has(value)) throw new Error(`${path} contains a cycle`);
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, index) => toCaptureJsonValue(item, `${path}[${index}]`, seen));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} has unsupported object type`);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      toCaptureJsonValue(item, `${path}.${key}`, seen)
    ]));
  } finally {
    seen.delete(value);
  }
}
```

- [ ] **步骤 4：运行测试并确认绿灯**

运行：`cd extension && npm test`

预期：全部 6 个测试通过。

### 任务 3：以 TDD 实现采样状态机和导出对象

**文件：**
- 修改：`extension/test/protocolCapture.test.mjs`
- 修改：`extension/src/protocolCapture.ts`

- [ ] **步骤 1：增加状态流转、边界和导出测试**

导入 `ProtocolCaptureSession`，增加测试：

```js
test("ProtocolCaptureSession follows the explicit capture lifecycle", () => {
  const session = new ProtocolCaptureSession({ now: () => "2026-07-29T00:00:00.000Z" });
  session.start("TEXT");
  session.append("JSON", { code: 200 });
  session.stop();
  const exported = session.exportDocument();
  assert.equal(exported.document.schemaVersion, 1);
  assert.equal(exported.document.scenario, "TEXT");
  assert.equal(exported.document.records.length, 1);
  assert.match(exported.fileName, /^xianyu-protocol-text-2026-07-29T00-00-00\.000Z\.json$/);
  assert.equal(session.status().state, "EXPORTED");
});

test("ProtocolCaptureSession rejects invalid state operations", () => {
  const session = new ProtocolCaptureSession();
  assert.throws(() => session.stop(), /cannot STOP while state is EMPTY/);
  assert.throws(() => session.exportDocument(), /cannot EXPORT while state is EMPTY/);
});

test("ProtocolCaptureSession enters ERROR without truncating when record limit is exceeded", () => {
  const session = new ProtocolCaptureSession({ maxRecords: 1 });
  session.start("IMAGE");
  session.append("JSON", { first: true });
  session.append("JSON", { second: true });
  assert.deepEqual(session.status().state, "ERROR");
  assert.equal(session.status().recordCount, 1);
  assert.match(session.status().lastError, /record limit 1 exceeded/);
});

test("ProtocolCaptureSession enters ERROR without truncating when byte limit is exceeded", () => {
  const session = new ProtocolCaptureSession({ maxBytes: 1 });
  session.start("TEXT");
  session.append("JSON", { content: "more than one byte" });
  assert.equal(session.status().state, "ERROR");
  assert.equal(session.status().recordCount, 0);
  assert.match(session.status().lastError, /byte limit 1 exceeded/);
});

test("ProtocolCaptureSession enters ERROR when payload is not serializable", () => {
  const session = new ProtocolCaptureSession();
  session.start("OTHER");
  session.append("JSON", { invalid: undefined });
  assert.equal(session.status().state, "ERROR");
  assert.equal(session.status().recordCount, 0);
  assert.match(session.status().lastError, /not JSON-compatible/);
});

test("ProtocolCaptureSession refuses to export an empty stopped session", () => {
  const session = new ProtocolCaptureSession();
  session.start("PAID");
  session.stop();
  assert.throws(() => session.exportDocument(), /cannot EXPORT an empty session/);
});
```

- [ ] **步骤 2：运行状态机测试并确认红灯**

运行：`cd extension && npm test`

预期：FAIL，错误指出 `ProtocolCaptureSession` 未导出。

- [ ] **步骤 3：实现状态机最小代码**

在 `protocolCapture.ts` 增加 `CaptureRecord`、`CaptureDocument`、`CaptureExport` 和 `ProtocolCaptureSession`。构造参数为：

```ts
interface CaptureSessionOptions {
  now?: () => string;
  maxRecords?: number;
  maxBytes?: number;
}

const DEFAULT_MAX_RECORDS = 50;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
```

实现必须满足以下明确规则：

```ts
start(scenario: CaptureScenario): CaptureStatus     // 仅 EMPTY
stop(): CaptureStatus                               // 仅 CAPTURING
clear(): CaptureStatus                              // 非 EMPTY；清空全部数据
append(transport: CaptureTransport, payload: unknown): CaptureStatus // 仅 CAPTURING
status(): CaptureStatus                             // 返回副本
exportDocument(): CaptureExport                     // 仅 STOPPED 且 records 非空；之后 EXPORTED
```

`append` 先使用 `toCaptureJsonValue` 创建完整候选记录，再以 `TextEncoder` 计算 JSON UTF-8 字节数。转换失败、候选记录使总数超过 `maxRecords` 或总字节超过 `maxBytes` 时，不加入候选记录，将状态设置为 `ERROR` 并保存明确 `lastError`。其他非法状态调用直接抛出，不修复状态。

同时实现并导出 `decodeCaptureExport(value)`，逐层校验 `fileName`、`document.schemaVersion === 1`、场景、三个时间字段、records 数组中每条记录的 sequence、receivedAt、transport 和 payload，以及最终 `status`。禁止只验证根对象或使用默认值补齐字段。增加一个删除 `records` 后必须失败的解码测试。

- [ ] **步骤 4：运行完整单元测试并确认绿灯**

运行：`cd extension && npm test`

预期：当前全部测试通过，0 个失败。

- [ ] **步骤 5：运行类型检查**

运行：`cd extension && npm run typecheck`

预期：退出码 0，无 TypeScript 错误。

### 任务 4：把采样会话接入 page hook

**文件：**
- 修改：`extension/src/xianyuPageHook.ts`

- [ ] **步骤 1：导入纯模块并声明专用事件**

在文件顶部导入：

```ts
import {
  ProtocolCaptureSession,
  decodeCaptureCommand,
  decodeSocketFrame,
  type CaptureCommand
} from "./protocolCapture";

const CAPTURE_REQUEST_EVENT = "FILM_AI_XIANYU_CAPTURE_REQUEST";
const CAPTURE_RESPONSE_EVENT = "FILM_AI_XIANYU_CAPTURE_RESPONSE";
const captureSession = new ProtocolCaptureSession();
```

- [ ] **步骤 2：用唯一传输判别替换 `parseMessage` 返回值**

将 `handleSocketMessage` 开头调整为：

```ts
const frame = decodeSocketFrame(data, (bytes) => {
  const msgpack = findMsgpack();
  debugState.msgpackAvailable = Boolean(msgpack);
  if (!msgpack) throw new Error("msgpack decoder unavailable");
  return msgpack.decode(bytes);
});
if (captureSession.status().state === "CAPTURING") {
  captureSession.append(frame.transport, frame.payload);
}
const message = frame.payload;
```

删除被完全替代的 `parseMessage`、`decodeGoofishSyncMessage` 和 `isGoofishSyncPackage`，避免同时存在两套传输协议逻辑。

- [ ] **步骤 3：增加严格的页面采样命令处理器**

注册 `CAPTURE_REQUEST_EVENT`，要求 detail 具有非空 `requestId` 和可由 `decodeCaptureCommand` 校验的 `command`。命令执行唯一映射：

```ts
function executeCaptureCommand(command: CaptureCommand): unknown {
  switch (command.action) {
    case "START": return captureSession.start(command.scenario);
    case "STOP": return captureSession.stop();
    case "CLEAR": return captureSession.clear();
    case "STATUS": return captureSession.status();
    case "EXPORT": return captureSession.exportDocument();
  }
}
```

响应事件名必须是 `${CAPTURE_RESPONSE_EVENT}:${requestId}`，detail 必须是：

```ts
{ requestId, success: true, payload }
```

或：

```ts
{ requestId, success: false, error: errorMessage }
```

捕获仅用于把命令错误转换为该内部桥明确规定的失败响应；不得继续执行另一动作或返回伪造状态。

- [ ] **步骤 4：运行单元测试和类型检查**

运行：

```bash
cd extension
npm test
npm run typecheck
```

预期：全部测试通过，类型检查退出码 0。

### 任务 5：实现 content script 的严格跨世界桥

**文件：**
- 修改：`extension/src/xianyuContent.ts`

- [ ] **步骤 1：定义 Chrome 消息入口**

新增 `chrome.runtime.onMessage.addListener`，只处理顶层 `type === "XIANYU_PROTOCOL_CAPTURE"` 的消息。其余消息返回 `undefined`，不抢占现有 runtime 处理。

入口严格要求：

```ts
{
  type: "XIANYU_PROTOCOL_CAPTURE",
  requestId: string,
  command: CaptureCommand
}
```

其中 `requestId` 必须非空，`command` 使用共享 `decodeCaptureCommand` 校验。

- [ ] **步骤 2：实现一次性 CustomEvent 请求/响应**

为每个请求监听 `${CAPTURE_RESPONSE_EVENT}:${requestId}`，先注册监听器再派发：

```ts
window.dispatchEvent(new CustomEvent(CAPTURE_REQUEST_EVENT, {
  detail: { requestId, command }
}));
```

page hook 必须使用同名带 requestId 后缀的响应事件。content script 校验响应中的 `requestId`、`success` 和 `payload/error` 后调用 `sendResponse`。设置 5 秒超时；超时是明确失败 `xianyu capture page hook response timeout`，不重试。监听器和定时器在成功、失败和超时路径全部释放。Chrome listener 返回 `true` 保持响应通道。

- [ ] **步骤 3：运行类型检查和构建**

运行：

```bash
cd extension
npm run typecheck
npm run build
```

预期：两条命令退出码 0，`dist/js/xianyuContent.js` 与 `dist/js/xianyuPageHook.js` 存在。

### 任务 6：增加 popup 采样面板和本地导出

**文件：**
- 修改：`extension/popup.html`
- 修改：`extension/src/popup.ts`

- [ ] **步骤 1：增加面板标记**

在阿奇索状态面板后增加：

```html
<section class="panel">
  <strong>闲鱼协议样本采集</strong>
  <div class="warning">敏感数据：样本可能包含聊天、用户、商品、订单及图片 URL，只使用测试账号并在分享前脱敏。</div>
  <label>业务场景
    <select id="captureScenario">
      <option value="TEXT">普通文字</option>
      <option value="IMAGE">图片</option>
      <option value="WAIT_PAYMENT">待付款</option>
      <option value="PAID">已付款</option>
      <option value="OTHER">其他</option>
    </select>
  </label>
  <div class="row">
    <button id="captureStart" type="button">开始采样</button>
    <button id="captureStop" type="button">停止采样</button>
    <button id="captureClear" type="button">清空</button>
    <button id="captureExport" type="button">导出 JSON</button>
  </div>
  <pre id="captureStatus">正在读取...</pre>
</section>
```

给 `select` 沿用 input 边框样式；`.warning` 使用明确的琥珀色背景和深色文字，不新增图片或外部字体。

- [ ] **步骤 2：实现严格的活动标签页请求函数**

在 `popup.ts` 导入共享类型、`decodeCaptureStatus` 和 `decodeCaptureExport`。使用：

```ts
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
```

要求 `tab.id` 是整数，`tab.url` 是以 `https://www.goofish.com/` 开头的字符串，否则显示“请先切换到闲鱼网页标签”。发送：

```ts
chrome.tabs.sendMessage(tab.id, {
  type: "XIANYU_PROTOCOL_CAPTURE",
  requestId: crypto.randomUUID(),
  command
});
```

严格校验 Chrome 响应的 `success`；失败响应必须包含非空 `error`，成功的 STATUS/START/STOP/CLEAR payload 使用 `decodeCaptureStatus`。

- [ ] **步骤 3：绑定按钮和渲染状态**

- popup 初始化时请求 `STATUS`；没有活动闲鱼标签时只在采样面板显示明确提示，不影响现有配置初始化。
- `START` 发送选中的唯一场景。
- `STOP` 发送无场景命令。
- `CLEAR` 先调用 `window.confirm("确定清空当前协议样本？此操作不可恢复。")`，确认后发送命令。
- 根据状态禁用不合法按钮：EMPTY 只启用开始；CAPTURING 只启用停止；STOPPED 只启用导出和清空；EXPORTED/ERROR 只启用清空。
- 状态文本显示状态、场景、条数、字节数和 `lastError`，不得用默认状态替代缺失字段。

- [ ] **步骤 4：实现用户主动 Blob 下载**

`EXPORT` 成功响应必须先完整通过共享 `decodeCaptureExport`，不得只检查根对象。校验成功后执行：

```ts
const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
const url = URL.createObjectURL(blob);
try {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
} finally {
  URL.revokeObjectURL(url);
}
```

不得请求 `downloads` 权限，不得上传后端。

- [ ] **步骤 5：运行扩展验证**

运行：

```bash
cd extension
npm test
npm run typecheck
npm run build
test -f dist/manifest.json
test -f dist/popup.html
test -f dist/js/popup.js
test -f dist/js/xianyuContent.js
test -f dist/js/xianyuPageHook.js
test -f dist/libs/msgpack.min.js
```

预期：所有命令退出码 0。

### 任务 7：文档、范围审计与 Windows 手工验收交接

**文件：**
- 修改：`docs/integration-runbook.md`
- 检查：`extension/manifest.json`

- [ ] **步骤 1：补充 Windows 采样说明**

在 runbook 增加准确路径：

```text
\\wsl.localhost\Ubuntu-22.04\home\hunter\workspace\Movie\extension\dist
```

并记录每个场景的操作顺序：选择场景 → 开始 → 只触发一次目标事件 → 停止 → 导出 → 清空。列出五个期望文件类别：TEXT、IMAGE、WAIT_PAYMENT、PAID、OTHER，并强调测试账号和分享前脱敏。

- [ ] **步骤 2：审计权限和网络边界**

运行：

```bash
git diff -- extension/manifest.json
rg -n "fetch\(|XMLHttpRequest|chrome\.storage|chrome\.downloads" extension/src/protocolCapture.ts
```

预期：manifest 无差异；采样纯模块中不存在网络、存储或下载 API。

- [ ] **步骤 3：执行完成前全量扩展验证**

运行：

```bash
cd extension
npm test
npm run typecheck
npm run build
```

预期：所有测试通过，类型检查和构建均退出码 0。

- [ ] **步骤 4：检查改动范围和敏感信息**

运行：

```bash
git diff --check -- extension/package.json extension/src/protocolCapture.ts extension/test/protocolCapture.test.mjs extension/src/xianyuPageHook.ts extension/src/xianyuContent.ts extension/popup.html extension/src/popup.ts docs/integration-runbook.md
git status --short
```

人工确认没有 Cookie、Token、真实聊天、订单、图片 Base64、导出样本文件或无关生成物被加入源码。

- [ ] **步骤 5：Windows 手工验收交接**

让用户在 Windows Chrome 重新加载上述 UNC 路径，先关闭自动回复，用测试买家发送一条普通文字。验证 popup 重开后状态仍是 CAPTURING，停止后导出 JSON，刷新闲鱼页后状态回到 EMPTY。该步骤需要用户账号流量，因此若尚未执行，交付说明必须明确标记为“等待用户手工验收”，不得宣称已验证真实闲鱼协议。
