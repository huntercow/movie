import type {
  AgentRuntimeStatus,
  AgisoStatus,
  AutomationConfig,
  ExtensionConfig,
  KeywordReplyRule,
  ReplyConfig,
  ReplyTemplateMap,
  StoredAgisoFallbackRecord
} from "./types";
import type {
  CaptureCommand,
  CaptureDocument,
  CaptureExport,
  CaptureJsonValue,
  CaptureScenario,
  CaptureStatus,
  CaptureTransport
} from "./protocolCapture";

const CAPTURE_MESSAGE_TYPE = "XIANYU_PROTOCOL_CAPTURE";
const CAPTURE_SCENARIOS = ["TEXT", "IMAGE", "WAIT_PAYMENT", "PAID", "OTHER"] as const;
const CAPTURE_STATES = ["EMPTY", "CAPTURING", "STOPPED", "EXPORTED", "ERROR"] as const;
const CAPTURE_TRANSPORTS = ["JSON", "SYNC_PUSH_MSGPACK"] as const;

const backendBaseUrl = requireElement<HTMLInputElement>("backendBaseUrl");
const pluginApiToken = requireElement<HTMLInputElement>("pluginApiToken");
const autoReply = requireElement<HTMLInputElement>("autoReply");
const sendTicketImage = requireElement<HTMLInputElement>("sendTicketImage");
const textFallback = requireElement<HTMLInputElement>("textFallback");
const replyTemplates = requireElement<HTMLTextAreaElement>("replyTemplates");
const keywordRules = requireElement<HTMLTextAreaElement>("keywordRules");
const templatesImport = requireElement<HTMLInputElement>("templatesImport");
const rulesImport = requireElement<HTMLInputElement>("rulesImport");
const statusEl = requireElement<HTMLDivElement>("status");
const agisoStatus = requireElement<HTMLDivElement>("agisoStatus");
const agisoFallbacks = requireElement<HTMLPreElement>("agisoFallbacks");
const agentStatus = requireElement<HTMLDivElement>("agentStatus");
const captureScenario = requireElement<HTMLSelectElement>("captureScenario");
const captureStart = requireElement<HTMLButtonElement>("captureStart");
const captureStop = requireElement<HTMLButtonElement>("captureStop");
const captureClear = requireElement<HTMLButtonElement>("captureClear");
const captureExport = requireElement<HTMLButtonElement>("captureExport");
const captureStatusEl = requireElement<HTMLPreElement>("captureStatus");
let installationId = "";

void initialize().catch(showError);

async function initialize(): Promise<void> {
  const config = await runtimeRequest({ type: "GET_CONFIG" }, decodeExtensionConfig);
  backendBaseUrl.value = config.backendBaseUrl;
  pluginApiToken.value = config.pluginApiToken;
  installationId = requireNonEmptyString(config.installationId, "extension config installationId");

  const automation = await runtimeRequest({ type: "GET_AUTOMATION_CONFIG" }, decodeAutomationConfig);
  autoReply.checked = automation.autoReply;
  sendTicketImage.checked = automation.xianyuDeliverSendImageEnabled;

  const replies = await runtimeRequest({ type: "GET_REPLY_CONFIG" }, decodeReplyConfig);
  textFallback.checked = replies.xianyuAutoReplyTextFallback;
  replyTemplates.value = JSON.stringify(replies.xianyuReplyMessageTemplates, null, 2);
  keywordRules.value = JSON.stringify(replies.xianyuKeywordReplyRules, null, 2);

  await Promise.all([loadAgisoStatus(), loadAgentStatus()]);
  await loadCaptureStatus().catch(showCaptureError);
}

requireElement<HTMLButtonElement>("save").addEventListener("click", () => {
  void saveAll().catch(showError);
});

async function saveAll(): Promise<void> {
  const templates = decodeTemplateMap(parseJson(replyTemplates.value, "业务话术"), "业务话术");
  const rules = decodeKeywordRules(parseJson(keywordRules.value, "关键词规则"), "关键词规则");
  const state = await runtimeRequest({
    type: "SAVE_CONFIG",
    data: {
      backendBaseUrl: requireNonEmptyString(backendBaseUrl.value, "后端地址"),
      pluginApiToken: requireNonEmptyString(pluginApiToken.value, "插件 Token")
    }
  }, decodeAgentRuntimeStatus);
  renderAgentStatus(state);
  await runtimeRequest({
    type: "SAVE_AUTOMATION_CONFIG",
    data: {
      autoReply: autoReply.checked,
      xianyuDeliverSendImageEnabled: sendTicketImage.checked
    }
  }, decodeAck);
  await runtimeRequest({
    type: "SAVE_REPLY_CONFIG",
    data: {
      xianyuReplyMessageTemplates: templates,
      xianyuKeywordReplyRules: rules,
      xianyuAutoReplyTextFallback: textFallback.checked
    }
  }, decodeAck);
  statusEl.textContent = "已保存，刷新闲鱼 IM 后生效";
}

requireElement<HTMLButtonElement>("loadBuiltinTemplates").addEventListener("click", () => {
  void loadBuiltinJson("config/xianyu-reply-templates.json", (value) => {
    const root = requireRecord(value, "内置话术文件");
    replyTemplates.value = JSON.stringify(decodeTemplateMap(root.templates, "内置话术文件 templates"), null, 2);
  }).catch(showError);
});

requireElement<HTMLButtonElement>("loadBuiltinRules").addEventListener("click", () => {
  void loadBuiltinJson("config/xianyu-keyword-rules.json", (value) => {
    keywordRules.value = JSON.stringify(decodeKeywordRules(value, "内置关键词文件"), null, 2);
  }).catch(showError);
});

requireElement<HTMLButtonElement>("loadBackendReplyConfig").addEventListener("click", () => {
  void loadBackendReplyConfig().catch(showError);
});

async function loadBackendReplyConfig(): Promise<void> {
  const config = await backendRequest("/api/xianyu/reply-config", "GET", undefined, decodeBackendReplyConfig);
  replyTemplates.value = JSON.stringify(config.templates, null, 2);
  keywordRules.value = JSON.stringify(config.keywordRules, null, 2);
  textFallback.checked = config.textFallbackEnabled;
  statusEl.textContent = "已从后端加载话术配置";
}

requireElement<HTMLButtonElement>("saveBackendReplyConfig").addEventListener("click", () => {
  void saveBackendReplyConfig().catch(showError);
});

async function saveBackendReplyConfig(): Promise<void> {
  const templates = decodeTemplateMap(parseJson(replyTemplates.value, "业务话术"), "业务话术");
  const rules = decodeKeywordRules(parseJson(keywordRules.value, "关键词规则"), "关键词规则");
  await backendRequest("/api/xianyu/reply-config", "PUT", {
    templates,
    keywordRules: rules,
    textFallbackEnabled: textFallback.checked
  }, decodeBackendReplyConfig);
  statusEl.textContent = "已保存话术配置到后端";
}

templatesImport.addEventListener("change", () => {
  void importJsonFile(templatesImport, (value) => {
    const root = requireRecord(value, "导入话术文件");
    replyTemplates.value = JSON.stringify(decodeTemplateMap(root.templates, "导入话术文件 templates"), null, 2);
  }).catch(showError);
});

rulesImport.addEventListener("change", () => {
  void importJsonFile(rulesImport, (value) => {
    keywordRules.value = JSON.stringify(decodeKeywordRules(value, "导入关键词文件"), null, 2);
  }).catch(showError);
});

requireElement<HTMLButtonElement>("openXianyu").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.goofish.com/im" });
});

requireElement<HTMLButtonElement>("openAgiso").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://aldsidle.agiso.com" });
});

requireElement<HTMLButtonElement>("refreshAgiso").addEventListener("click", () => {
  void loadAgisoStatus().catch(showError);
});

requireElement<HTMLButtonElement>("activateAgent").addEventListener("click", () => {
  agentStatus.textContent = "正在激活...";
  void activateAgent().catch(showError);
});

captureStart.addEventListener("click", () => {
  const scenario = requireEnum(captureScenario.value, CAPTURE_SCENARIOS, "采样场景");
  void executeCaptureAction({ action: "START", scenario }).catch(showCaptureError);
});

captureStop.addEventListener("click", () => {
  void executeCaptureAction({ action: "STOP" }).catch(showCaptureError);
});

captureClear.addEventListener("click", () => {
  if (!window.confirm("确定清空当前协议样本？此操作不可恢复。")) return;
  void executeCaptureAction({ action: "CLEAR" }).catch(showCaptureError);
});

captureExport.addEventListener("click", () => {
  void exportCaptureDocument().catch(showCaptureError);
});

async function loadCaptureStatus(): Promise<void> {
  const captureStatus = decodeCaptureStatus(await sendCaptureCommand({ action: "STATUS" }));
  renderCaptureStatus(captureStatus);
}

async function executeCaptureAction(command: CaptureCommand): Promise<void> {
  const captureStatus = decodeCaptureStatus(await sendCaptureCommand(command));
  renderCaptureStatus(captureStatus);
}

async function exportCaptureDocument(): Promise<void> {
  const result = decodeCaptureExport(await sendCaptureCommand({ action: "EXPORT" }));
  const blob = new Blob([JSON.stringify(result.document, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.fileName;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  renderCaptureStatus(result.status);
}

async function sendCaptureCommand(command: CaptureCommand): Promise<unknown> {
  const tabs = requireArray(
    await chrome.tabs.query({ active: true, currentWindow: true }),
    "活动标签页查询结果"
  );
  if (tabs.length !== 1) {
    throw new Error(`活动标签页数量必须为 1，实际为 ${tabs.length}`);
  }
  const tab = requireRecord(tabs[0], "活动标签页");
  const tabId = requirePositiveInteger(tab.id, "活动标签页 ID");
  const tabUrl = requireNonEmptyString(tab.url, "活动标签页 URL");
  if (!tabUrl.startsWith("https://www.goofish.com/")) {
    throw new Error("请先切换到闲鱼网页标签");
  }
  const response = requireRecord(await chrome.tabs.sendMessage(tabId, {
    type: CAPTURE_MESSAGE_TYPE,
    requestId: crypto.randomUUID(),
    command
  }), "采样 content script 响应");
  const success = requireBoolean(response.success, "采样 content script 响应 success");
  if (!success) {
    throw new Error(requireNonEmptyString(response.error, "采样 content script 响应 error"));
  }
  if (!Object.prototype.hasOwnProperty.call(response, "payload")) {
    throw new Error("采样 content script 响应缺少 payload");
  }
  return response.payload;
}

function renderCaptureStatus(captureStatus: CaptureStatus): void {
  const scenarioLabels: Record<CaptureScenario, string> = {
    TEXT: "普通文字",
    IMAGE: "图片",
    WAIT_PAYMENT: "待付款",
    PAID: "已付款",
    OTHER: "其他"
  };
  captureStatusEl.textContent = [
    `状态：${captureStatus.state}`,
    `场景：${captureStatus.scenario === null ? "未选择" : scenarioLabels[captureStatus.scenario]}`,
    `样本：${captureStatus.recordCount} 条`,
    `大小：${captureStatus.byteCount} 字节`,
    captureStatus.lastError === null ? "" : `错误：${captureStatus.lastError}`
  ].filter((line) => line.length > 0).join("\n");
  captureScenario.disabled = captureStatus.state !== "EMPTY";
  captureStart.disabled = captureStatus.state !== "EMPTY";
  captureStop.disabled = captureStatus.state !== "CAPTURING";
  captureClear.disabled = captureStatus.state === "EMPTY";
  captureExport.disabled = captureStatus.state !== "STOPPED" || captureStatus.recordCount === 0;
}

function showCaptureError(error: unknown): void {
  captureStatusEl.textContent = error instanceof Error ? error.message : String(error);
  captureScenario.disabled = true;
  captureStart.disabled = true;
  captureStop.disabled = true;
  captureClear.disabled = true;
  captureExport.disabled = true;
}

async function activateAgent(): Promise<void> {
  const state = await runtimeRequest({
    type: "SAVE_CONFIG",
    data: {
      backendBaseUrl: requireNonEmptyString(backendBaseUrl.value, "后端地址"),
      pluginApiToken: requireNonEmptyString(pluginApiToken.value, "插件 Token")
    }
  }, decodeAgentRuntimeStatus);
  renderAgentStatus(state);
}

async function loadAgentStatus(): Promise<void> {
  renderAgentStatus(await runtimeRequest({ type: "GET_AGENT_STATUS" }, decodeAgentRuntimeStatus));
}

function renderAgentStatus(result: AgentRuntimeStatus): void {
  installationId = result.installationId;
  const labels: Record<AgentRuntimeStatus["state"], string> = {
    ACTIVE: "已激活",
    UNCONFIGURED: "未激活",
    ERROR: "激活失败"
  };
  agentStatus.textContent = `${labels[result.state]}\n安装 ID：${installationId}\n${result.message}`;
}

async function loadAgisoStatus(): Promise<void> {
  const status = await runtimeRequest({ type: "GET_AGISO_STATUS" }, decodeAgisoStatus);
  agisoStatus.textContent = [
    `Token：${status.hasToken ? "已获取" : "未获取"}`,
    status.tokenPreview ? `预览：${status.tokenPreview}` : "",
    status.tokenUpdatedAt ? `更新时间：${formatTime(status.tokenUpdatedAt)}` : "",
    status.lastRequestAction
      ? `最近请求：${status.lastRequestAction} / ${status.lastRequestOk ? "成功" : "失败"} / ${status.lastRequestStatus}`
      : "",
    status.lastRequestSummary ? `摘要：${status.lastRequestSummary}` : ""
  ].filter((line) => line.length > 0).join("\n");
  agisoFallbacks.textContent = status.fallbackRecords.length > 0
    ? status.fallbackRecords.slice(0, 5).map(renderAgisoRecord).join("\n\n")
    : "暂无历史降级记录";
}

function renderAgisoRecord(record: StoredAgisoFallbackRecord): string {
  const orderReference = record.orderId ?? record.tradeNo;
  return [
    `${formatTime(record.at)} ${record.action} ${record.ok === true ? "成功" : "失败"}`,
    `原因：${record.reason}`,
    `订单：${orderReference ?? "未记录"}`,
    `响应：${record.response === undefined ? "未记录" : String(record.response)}`
  ].join("\n");
}

async function importJsonFile(input: HTMLInputElement, apply: (value: unknown) => void): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  apply(parseJson(text, `导入文件 ${file.name}`));
  statusEl.textContent = "已导入，点保存后生效";
}

async function loadBuiltinJson(path: string, apply: (value: unknown) => void): Promise<void> {
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) throw new Error(`加载内置配置失败：HTTP ${response.status}`);
  const text = await response.text();
  if (!text) throw new Error("内置配置文件为空");
  apply(parseJson(text, `内置配置 ${path}`));
  statusEl.textContent = "已加载内置配置，点保存后生效";
}

async function backendRequest<T>(
  path: string,
  method: "GET" | "PUT",
  body: unknown,
  decoder: (value: unknown, context: string) => T
): Promise<T> {
  const baseUrl = requireNonEmptyString(backendBaseUrl.value, "后端地址");
  const token = requireNonEmptyString(pluginApiToken.value, "插件 Token");
  const currentInstallationId = requireNonEmptyString(installationId, "安装 ID");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Plugin-Token": token,
      "X-Plugin-Installation-Id": currentInstallationId
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!text) throw new Error(`后端返回空响应：HTTP ${response.status}`);
  const envelope = decodeEnvelope(parseJson(text, `${path} 后端响应`), `${path} 后端响应`);
  if (response.ok !== envelope.success) {
    throw new Error(`${path} 协议状态不一致：HTTP ${response.status} / success=${envelope.success}`);
  }
  if (!envelope.success) throw new Error(envelope.message);
  return decoder(envelope.data, `${path} response data`);
}

function runtimeRequest<T>(message: unknown, decoder: (value: unknown, context: string) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (value: unknown) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      try {
        const record = requireRecord(value, "runtime response");
        if (record.success === false) {
          throw new Error(requireNonEmptyString(record.error, "runtime response error"));
        }
        resolve(decoder(value, "runtime response"));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function decodeExtensionConfig(value: unknown, context: string): ExtensionConfig {
  const config = requireRecord(value, context);
  return {
    backendBaseUrl: requireNonEmptyString(config.backendBaseUrl, `${context}.backendBaseUrl`),
    pluginApiToken: requireString(config.pluginApiToken, `${context}.pluginApiToken`),
    installationId: requireNonEmptyString(config.installationId, `${context}.installationId`)
  };
}

function decodeAutomationConfig(value: unknown, context: string): AutomationConfig {
  const config = requireRecord(value, context);
  return {
    autoReply: requireBoolean(config.autoReply, `${context}.autoReply`),
    xianyuDeliverSendImageEnabled: requireBoolean(
      config.xianyuDeliverSendImageEnabled,
      `${context}.xianyuDeliverSendImageEnabled`
    )
  };
}

function decodeReplyConfig(value: unknown, context: string): ReplyConfig {
  const config = requireRecord(value, context);
  return {
    xianyuReplyMessageTemplates: decodeTemplateMap(config.xianyuReplyMessageTemplates, `${context}.templates`),
    xianyuKeywordReplyRules: decodeKeywordRules(config.xianyuKeywordReplyRules, `${context}.keywordRules`),
    xianyuAutoReplyTextFallback: requireBoolean(
      config.xianyuAutoReplyTextFallback,
      `${context}.textFallbackEnabled`
    )
  };
}

function decodeBackendReplyConfig(value: unknown, context: string): BackendReplyConfig {
  const config = requireRecord(value, context);
  return {
    templates: decodeTemplateMap(config.templates, `${context}.templates`),
    keywordRules: decodeKeywordRules(config.keywordRules, `${context}.keywordRules`),
    textFallbackEnabled: requireBoolean(config.textFallbackEnabled, `${context}.textFallbackEnabled`)
  };
}

function decodeTemplateMap(value: unknown, context: string): ReplyTemplateMap {
  const templates = requireRecord(value, context);
  return Object.fromEntries(Object.entries(templates).map(([key, template]) => [
    key,
    requireNonEmptyString(template, `${context}.${key}`)
  ]));
}

function decodeKeywordRules(value: unknown, context: string): KeywordReplyRule[] {
  return requireArray(value, context).map((item, index) => {
    const rule = requireRecord(item, `${context}[${index}]`);
    const keywords = requireArray(rule.keywords, `${context}[${index}].keywords`)
      .map((keyword, keywordIndex) => requireNonEmptyString(keyword, `${context}[${index}].keywords[${keywordIndex}]`));
    if (keywords.length === 0) throw new Error(`${context}[${index}].keywords 不能为空`);
    return {
      id: optionalString(rule.id, `${context}[${index}].id`),
      enabled: requireBoolean(rule.enabled, `${context}[${index}].enabled`),
      keywords,
      priority: requireFiniteNumber(rule.priority, `${context}[${index}].priority`),
      reply: requireNonEmptyString(rule.reply, `${context}[${index}].reply`)
    };
  });
}

function decodeAgentRuntimeStatus(value: unknown, context: string): AgentRuntimeStatus {
  const status = requireRecord(value, context);
  const state = requireNonEmptyString(status.state, `${context}.state`);
  if (state !== "UNCONFIGURED" && state !== "ACTIVE" && state !== "ERROR") {
    throw new Error(`${context}.state 未定义：${state}`);
  }
  return {
    installationId: requireNonEmptyString(status.installationId, `${context}.installationId`),
    state,
    message: requireNonEmptyString(status.message, `${context}.message`),
    checkedAt: requireString(status.checkedAt, `${context}.checkedAt`)
  };
}

function decodeAgisoStatus(value: unknown, context: string): AgisoStatus {
  const status = requireRecord(value, context);
  const lastRequestOk = optionalBoolean(status.lastRequestOk, `${context}.lastRequestOk`) ?? null;
  const lastRequestStatus = optionalNumber(status.lastRequestStatus, `${context}.lastRequestStatus`) ?? null;
  return {
    hasToken: requireBoolean(status.hasToken, `${context}.hasToken`),
    tokenPreview: requireString(status.tokenPreview, `${context}.tokenPreview`),
    tokenUpdatedAt: requireString(status.tokenUpdatedAt, `${context}.tokenUpdatedAt`),
    lastRequestAt: requireString(status.lastRequestAt, `${context}.lastRequestAt`),
    lastRequestAction: requireString(status.lastRequestAction, `${context}.lastRequestAction`),
    lastRequestOk,
    lastRequestStatus,
    lastRequestSummary: requireString(status.lastRequestSummary, `${context}.lastRequestSummary`),
    fallbackRecords: requireArray(status.fallbackRecords, `${context}.fallbackRecords`)
      .map((record, index) => decodeAgisoRecord(record, `${context}.fallbackRecords[${index}]`))
  };
}

function decodeAgisoRecord(value: unknown, context: string): StoredAgisoFallbackRecord {
  const record = requireRecord(value, context);
  return {
    action: requireNonEmptyString(record.action, `${context}.action`),
    reason: requireNonEmptyString(record.reason, `${context}.reason`),
    orderId: optionalString(record.orderId, `${context}.orderId`),
    tradeNo: optionalString(record.tradeNo, `${context}.tradeNo`),
    ok: optionalBoolean(record.ok, `${context}.ok`),
    request: record.request,
    response: record.response,
    at: requireNonEmptyString(record.at, `${context}.at`)
  };
}

function decodeAck(value: unknown, context: string): void {
  const ack = requireRecord(value, context);
  if (ack.success !== true) throw new Error(`${context}.success 必须为 true`);
}

function decodeCaptureStatus(value: unknown): CaptureStatus {
  const status = requireRecord(value, "采样状态");
  const decoded: CaptureStatus = {
    state: requireEnum(status.state, CAPTURE_STATES, "采样状态 state"),
    scenario: status.scenario === null
      ? null
      : requireEnum(status.scenario, CAPTURE_SCENARIOS, "采样状态 scenario"),
    recordCount: requireNonNegativeInteger(status.recordCount, "采样状态 recordCount"),
    byteCount: requireNonNegativeInteger(status.byteCount, "采样状态 byteCount"),
    startedAt: requireNullableTimestamp(status.startedAt, "采样状态 startedAt"),
    stoppedAt: requireNullableTimestamp(status.stoppedAt, "采样状态 stoppedAt"),
    lastError: requireNullableNonEmptyString(status.lastError, "采样状态 lastError")
  };
  validateCaptureStatusState(decoded);
  return decoded;
}

function validateCaptureStatusState(status: CaptureStatus): void {
  if (status.state === "EMPTY") {
    if (status.scenario !== null || status.recordCount !== 0 || status.byteCount !== 0
      || status.startedAt !== null || status.stoppedAt !== null || status.lastError !== null) {
      throw new Error("EMPTY 采样状态字段不一致");
    }
    return;
  }
  if (status.scenario === null || status.startedAt === null) {
    throw new Error(`${status.state} 采样状态缺少场景或开始时间`);
  }
  if (status.state === "CAPTURING") {
    if (status.stoppedAt !== null || status.lastError !== null) {
      throw new Error("CAPTURING 采样状态字段不一致");
    }
    return;
  }
  if (status.state === "ERROR") {
    if (status.stoppedAt !== null || status.lastError === null) {
      throw new Error("ERROR 采样状态字段不一致");
    }
    return;
  }
  if (status.stoppedAt === null || status.lastError !== null) {
    throw new Error(`${status.state} 采样状态字段不一致`);
  }
}

function decodeCaptureExport(value: unknown): CaptureExport {
  const root = requireRecord(value, "采样导出");
  const fileName = requireNonEmptyString(root.fileName, "采样导出 fileName");
  if (!/^xianyu-protocol-(?:text|image|wait-payment|paid|other)-.+\.json$/.test(fileName)) {
    throw new Error(`采样导出 fileName 不符合协议：${fileName}`);
  }
  const rawDocument = requireRecord(root.document, "采样导出 document");
  if (rawDocument.schemaVersion !== 1) {
    throw new Error(`采样导出 schemaVersion 必须为 1：${String(rawDocument.schemaVersion)}`);
  }
  const records = requireArray(rawDocument.records, "采样导出 records").map((value, index) => {
    const record = requireRecord(value, `采样导出 records[${index}]`);
    const sequence = requirePositiveInteger(record.sequence, `采样导出 records[${index}].sequence`);
    if (sequence !== index + 1) {
      throw new Error(`采样导出 records[${index}].sequence 必须为 ${index + 1}`);
    }
    return {
      sequence,
      receivedAt: requireTimestamp(record.receivedAt, `采样导出 records[${index}].receivedAt`),
      transport: requireEnum(
        record.transport,
        CAPTURE_TRANSPORTS,
        `采样导出 records[${index}].transport`
      ) as CaptureTransport,
      payload: decodeCaptureJsonValue(record.payload, `采样导出 records[${index}].payload`)
    };
  });
  if (records.length === 0) {
    throw new Error("采样导出 records 不能为空");
  }
  const captureDocument: CaptureDocument = {
    schemaVersion: 1,
    scenario: requireEnum(rawDocument.scenario, CAPTURE_SCENARIOS, "采样导出 scenario"),
    startedAt: requireTimestamp(rawDocument.startedAt, "采样导出 startedAt"),
    stoppedAt: requireTimestamp(rawDocument.stoppedAt, "采样导出 stoppedAt"),
    exportedAt: requireTimestamp(rawDocument.exportedAt, "采样导出 exportedAt"),
    records
  };
  const captureStatus = decodeCaptureStatus(root.status);
  if (captureStatus.state !== "EXPORTED") {
    throw new Error(`采样导出状态必须为 EXPORTED：${captureStatus.state}`);
  }
  if (captureStatus.scenario !== captureDocument.scenario) {
    throw new Error("采样导出场景与状态不一致");
  }
  if (captureStatus.recordCount !== captureDocument.records.length) {
    throw new Error("采样导出 recordCount 与 records 不一致");
  }
  const byteCount = captureDocument.records.reduce((total, record) => total + utf8JsonSize(record), 0);
  if (captureStatus.byteCount !== byteCount) {
    throw new Error("采样导出 byteCount 与 records 不一致");
  }
  if (captureStatus.startedAt !== captureDocument.startedAt
    || captureStatus.stoppedAt !== captureDocument.stoppedAt) {
    throw new Error("采样导出时间与状态不一致");
  }
  return { fileName, document: captureDocument, status: captureStatus };
}

function decodeCaptureJsonValue(
  value: unknown,
  context: string,
  seen = new WeakSet<object>()
): CaptureJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${context} 必须是有限数字`);
    return value;
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`${context} 不是 JSON 值`);
  }
  if (seen.has(value)) throw new Error(`${context} 包含循环引用`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => decodeCaptureJsonValue(item, `${context}[${index}]`, seen));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${context} 包含不支持的对象类型`);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      decodeCaptureJsonValue(item, `${context}.${key}`, seen)
    ]));
  } finally {
    seen.delete(value);
  }
}

function utf8JsonSize(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("采样记录无法序列化为 JSON");
  return new TextEncoder().encode(serialized).byteLength;
}

function decodeEnvelope(value: unknown, context: string): ApiEnvelope {
  const envelope = requireRecord(value, context);
  if (!Object.prototype.hasOwnProperty.call(envelope, "data")) {
    throw new Error(`${context} 缺少 data 字段`);
  }
  return {
    success: requireBoolean(envelope.success, `${context}.success`),
    message: requireNonEmptyString(envelope.message, `${context}.message`),
    data: envelope.data
  };
}

function parseJson(text: string, context: string): unknown {
  if (!text) throw new Error(`${context} 不能为空`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${context} 不是有效 JSON`, { cause: error });
  }
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`popup 缺少元素 #${id}`);
  return element as T;
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${context} 必须是数组`);
  return value;
}

function requireString(value: unknown, context: string): string {
  if (typeof value !== "string") throw new Error(`${context} 必须是字符串`);
  return value;
}

function requireNonEmptyString(value: unknown, context: string): string {
  const result = requireString(value, context);
  if (!result) throw new Error(`${context} 不能为空`);
  return result;
}

function optionalString(value: unknown, context: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requireString(value, context);
}

function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${context} 必须是布尔值`);
  return value;
}

function optionalBoolean(value: unknown, context: string): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  return requireBoolean(value, context);
}

function requireFiniteNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${context} 必须是有限数字`);
  return value;
}

function optionalNumber(value: unknown, context: string): number | undefined {
  if (value === null || value === undefined) return undefined;
  return requireFiniteNumber(value, context);
}

function requireNonNegativeInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${context} 必须是非负整数`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${context} 必须是正整数`);
  }
  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], context: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${context} 未定义：${String(value)}`);
  }
  return value as T;
}

function requireTimestamp(value: unknown, context: string): string {
  const timestamp = requireNonEmptyString(value, context);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${context} 必须是有效时间`);
  }
  return timestamp;
}

function requireNullableTimestamp(value: unknown, context: string): string | null {
  if (value === null) return null;
  return requireTimestamp(value, context);
}

function requireNullableNonEmptyString(value: unknown, context: string): string | null {
  if (value === null) return null;
  return requireNonEmptyString(value, context);
}

function formatTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`时间格式不符合协议：${value}`);
  return new Date(timestamp).toLocaleString();
}

function showError(error: unknown): void {
  statusEl.textContent = error instanceof Error ? error.message : String(error);
}

interface ApiEnvelope {
  success: boolean;
  message: string;
  data: unknown;
}

interface BackendReplyConfig {
  templates: ReplyTemplateMap;
  keywordRules: KeywordReplyRule[];
  textFallbackEnabled: boolean;
}
