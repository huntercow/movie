import { decodeReplyConfig, validateTemplatePlaceholders, type ReplyConfig, type ReplyTemplateKey } from "../handlers/backendApi.ts";
import {
  BACKEND_CONFIG_STORAGE_KEY,
  decodeBackendConfig
} from "../upstream/backendConfig.ts";
import {
  buildErrorViewState,
  buildManageViewState,
  buildUnauthenticatedViewState,
  testKeyword
} from "./manageViewModel.ts";
import type {
  ManageViewState,
  RuleEntry,
  TemplateEntry
} from "./manageViewModel.ts";

/**
 * 话术与关键字管理页入口（独立 tab，由 popup 打开）。
 *
 * 话术数据源：插件实际执行的配置 —— 从后台 PLUGIN_GET_STATE 读取已同步的
 * replyConfig（与自动回复运行时一致），编辑后经 UPDATE_REPLY_CONFIG 写回
 * 后端，保存成功即同步生效。
 * 上游配置：良票账号/OSS 凭证/加价经 background 读写 chrome.storage.local，
 * 保存时由 background 立即登录验证。
 */

const statusBadge = requireElement<HTMLElement>("statusBadge");
const statusLabel = requireElement<HTMLElement>("statusLabel");
const refreshButton = requireElement<HTMLButtonElement>("refreshButton");
const notice = requireElement<HTMLElement>("notice");
const testerBlock = requireElement<HTMLElement>("testerBlock");
const testerInput = requireElement<HTMLInputElement>("testerInput");
const testerResult = requireElement<HTMLElement>("testerResult");
const templateBlock = requireElement<HTMLElement>("templateBlock");
const templateCount = requireElement<HTMLElement>("templateCount");
const templateList = requireElement<HTMLElement>("templateList");
const ruleBlock = requireElement<HTMLElement>("ruleBlock");
const ruleList = requireElement<HTMLElement>("ruleList");
const backendForm = requireElement<HTMLFormElement>("backendForm");
const backendUrl = requireElement<HTMLInputElement>("backendUrl");
const backendStatus = requireElement<HTMLElement>("backendStatus");
const saveBackendButton = requireElement<HTMLButtonElement>("saveBackendButton");
const loginForm = requireElement<HTMLFormElement>("loginForm");
const backendUsername = requireElement<HTMLInputElement>("backendUsername");
const backendPassword = requireElement<HTMLInputElement>("backendPassword");
const loginButton = requireElement<HTMLButtonElement>("loginButton");
const logoutButton = requireElement<HTMLButtonElement>("logoutButton");
const reportLink = requireElement<HTMLAnchorElement>("reportLink");
const connectionSummary = requireElement<HTMLElement>("connectionSummary");
const connectionSummaryMeta = requireElement<HTMLElement>("connectionSummaryMeta");
const configVersionSummary = requireElement<HTMLElement>("configVersionSummary");
const templateSummary = requireElement<HTMLElement>("templateSummary");
const ruleSummary = requireElement<HTMLElement>("ruleSummary");
const ruleSummaryMeta = requireElement<HTMLElement>("ruleSummaryMeta");
const saveTemplatesButton = requireElement<HTMLButtonElement>("saveTemplatesButton");
const saveRulesButton = requireElement<HTMLButtonElement>("saveRulesButton");

let view: ManageViewState = buildErrorViewState();
/** 可编辑草稿：加载时克隆后端配置，编辑保存前不回写。 */
let draft: ReplyConfig | null = null;

function cloneConfig(config: ReplyConfig): ReplyConfig {
  return {
    version: config.version,
    templates: { ...config.templates },
    keywordRules: config.keywordRules.map((rule) => ({ ...rule, keywords: [...rule.keywords] }))
  };
}

/** 保存草稿到后端：PUT 后后台立即 sync，成功即生效。 */
async function saveDraft(): Promise<void> {
  if (draft === null) {
    return;
  }
  // 本地预校验：非法占位符直接提示，避免后端接受但插件协议拒绝。
  for (const key of Object.keys(draft.templates) as ReplyTemplateKey[]) {
    try {
      validateTemplatePlaceholders(key, draft.templates[key]);
    } catch (error) {
      notice.hidden = false;
      notice.dataset.kind = "error";
      notice.textContent =
        `模板「${key}」保存失败：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
  }
  saveTemplatesButton.disabled = true;
  saveRulesButton.disabled = true;
  saveTemplatesButton.textContent = "保存中…";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "UPDATE_REPLY_CONFIG",
      data: {
        templates: draft.templates,
        keywordRules: draft.keywordRules
      }
    }) as { success?: boolean; error?: string; version?: number } | undefined;
    if (typeof response === "object" && response !== null && response.success === false) {
      throw new Error(response.error ?? "保存失败");
    }
    notice.hidden = false;
    notice.dataset.kind = "ok";
    notice.textContent = "已保存，配置已同步生效。";
    await load();
  } catch (error) {
    notice.hidden = false;
    notice.dataset.kind = "error";
    notice.textContent =
      `保存失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    saveTemplatesButton.disabled = false;
    saveRulesButton.disabled = false;
    saveTemplatesButton.textContent = "保存到后端";
    saveRulesButton.textContent = "保存生效";
  }
}

refreshButton.addEventListener("click", () => {
  void load();
});

saveTemplatesButton.addEventListener("click", () => {
  void saveDraft();
});

saveRulesButton.addEventListener("click", () => {
  void saveDraft();
});

testerInput.addEventListener("input", () => {
  renderTester(testerInput.value);
});

backendForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveBackendConfig();
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void loginToBackend();
});

loginButton.addEventListener("click", () => {
  void loginToBackend();
});

logoutButton.addEventListener("click", () => {
  void logoutFromBackend();
});

// 侧边导航：切换工作区区块（显隐由导航唯一控制）。
document.querySelectorAll<HTMLButtonElement>(".nav-item[data-target]").forEach((button) => {
  button.addEventListener("click", () => {
    showSection(button.dataset.target!);
  });
});

// 初始只显示概览（其余区块由导航显隐，避免页面加载时多区块并存）。
showSection("overviewSection");

void load();
void loadBackendUrl().then(() => loadBackendStatus());

// 后端登录/同步后插件状态变化 → 自动刷新连接展示。
chrome.storage.onChanged.addListener(() => {
  void loadBackendStatus();
});

function showSection(id: string): void {
  document.querySelectorAll<HTMLElement>(".workspace-section").forEach((section) => {
    section.hidden = section.id !== id;
  });
  document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.target === id);
  });
}

/** 概览指标：本地配置（版本/模板/规则数）。 */
function updateOverview(): void {
  configVersionSummary.textContent = view.status === "READY" && view.version !== null
    ? `v${view.version}`
    : "--";
  templateSummary.textContent = String(view.templates.length);
  const enabledRules = view.rules.filter((rule) => rule.enabled).length;
  ruleSummary.textContent = String(view.rules.length);
  ruleSummaryMeta.textContent =
    view.status === "READY" ? `${enabledRules} 条启用` : "等待配置加载";
}

/** 读取已保存的 后端地址（manage 页可编辑、展示用）。 */
async function loadBackendUrl(): Promise<void> {
  const stored = await chrome.storage.local.get(BACKEND_CONFIG_STORAGE_KEY);
  const config = decodeBackendConfig(stored[BACKEND_CONFIG_STORAGE_KEY]);
  backendUrl.value = config.baseUrl;
  reportLink.href = config.baseUrl.length > 0
    ? `${config.baseUrl.replace(/\/+$/, "")}/swagger-ui.html`
    : "#";
  reportLink.classList.toggle("is-disabled", config.baseUrl.length === 0);
}

/** 读取插件登录态并刷新 后端连接展示。 */
async function loadBackendStatus(): Promise<void> {
  try {
    const state = await chrome.runtime.sendMessage({ type: "PLUGIN_GET_STATE" }) as {
      authStatus: string;
      automationEnabled: boolean;
      replyConfigVersion: number;
      replyConfig: unknown;
    };
    const configured = backendUrl.value.trim().length > 0;
    const authenticated = state.authStatus === "AUTHENTICATED";
    const configReady =
      authenticated &&
      state.replyConfig !== null &&
      typeof state.replyConfig === "object" &&
      (state.replyConfig as { version?: number }).version === state.replyConfigVersion;
    loginButton.disabled = authenticated;
    logoutButton.disabled = !authenticated;
    backendUsername.disabled = authenticated;
    backendPassword.disabled = authenticated;
    backendStatus.textContent = !configured
      ? "未配置后端地址"
      : authenticated
        ? configReady
          ? state.automationEnabled
            ? "已登录，自动化运行中"
            : "已登录，自动化开关未开（popup 打开）"
          : "已登录，配置同步中…"
        : state.authStatus === "TOKEN_INVALID"
          ? "Token 已失效，请重新登录"
          : "未登录";
    backendStatus.dataset.kind = authenticated ? "ok" : "error";
    connectionSummary.textContent = !configured
      ? "未配置"
      : authenticated
        ? configReady
          ? (state.automationEnabled ? "自动化运行中" : "自动化未开")
          : "同步中…"
        : state.authStatus === "TOKEN_INVALID"
          ? "Token 失效"
          : "未登录";
    connectionSummaryMeta.textContent = configured
      ? backendUrl.value
      : "未配置后端地址";
  } catch {
    backendStatus.textContent = "状态读取失败";
    backendStatus.dataset.kind = "error";
  }
}

/** 保存后端地址（manage 页）；地址变更后需重新登录良票。 */
async function saveBackendConfig(): Promise<void> {
  saveBackendButton.disabled = true;
  saveBackendButton.textContent = "保存中…";
  try {
    const baseUrl = backendUrl.value.trim().replace(/\/+$/, "");
    await chrome.runtime.sendMessage({
      type: "SAVE_BACKEND_CONFIG",
      data: { config: { baseUrl } }
    });
    backendStatus.textContent = "已保存";
    backendStatus.dataset.kind = "ok";
    await loadBackendUrl();
    await loadBackendStatus();
  } catch (error) {
    backendStatus.textContent =
      `保存失败：${error instanceof Error ? error.message : String(error)}`;
    backendStatus.dataset.kind = "error";
  } finally {
    saveBackendButton.disabled = false;
    saveBackendButton.textContent = "保存地址";
  }
}

/** 用系统账号登录 后端：后台换取 JWT 并完成 sync + 话术配置校验。 */
async function loginToBackend(): Promise<void> {
  loginButton.disabled = true;
  loginButton.textContent = "登录中…";
  try {
    await chrome.runtime.sendMessage({
      type: "BACKEND_LOGIN",
      data: {
        username: backendUsername.value.trim(),
        password: backendPassword.value
      }
    });
    backendPassword.value = "";
    backendStatus.textContent = "登录成功，配置已就绪";
    backendStatus.dataset.kind = "ok";
  } catch (error) {
    backendStatus.textContent =
      `登录失败：${error instanceof Error ? error.message : String(error)}`;
    backendStatus.dataset.kind = "error";
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "登录";
    await loadBackendStatus();
  }
}

/** 退出登录：后台先本地停止自动化并请求后端保存关闭状态。 */
async function logoutFromBackend(): Promise<void> {
  logoutButton.disabled = true;
  try {
    await chrome.runtime.sendMessage({ type: "PLUGIN_LOGOUT" });
    backendStatus.textContent = "已退出登录";
    backendStatus.dataset.kind = "ok";
  } catch (error) {
    backendStatus.textContent =
      `退出失败：${error instanceof Error ? error.message : String(error)}`;
    backendStatus.dataset.kind = "error";
  } finally {
    logoutButton.disabled = false;
    await loadBackendStatus();
  }
}

async function load(): Promise<void> {
  setLoading(true);
  try {
    // 实时驱动：读插件已同步的话术配置（与自动回复运行时一致）。
    const state = await chrome.runtime.sendMessage({ type: "PLUGIN_GET_STATE" }) as {
      authStatus: string;
      replyConfig: unknown;
    };
    if (state.authStatus !== "AUTHENTICATED") {
      view = buildUnauthenticatedViewState();
      render();
      setLoading(false);
      return;
    }
    const config = decodeReplyConfig(state.replyConfig);
    view = buildManageViewState(config);
    draft = cloneConfig(config);
    render();
    setLoading(false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 配置解析失败（如模板缺失/占位符不合法）一律按错误展示。
    view = buildErrorViewState();
    render();
    setLoading(false);
    notice.hidden = false;
    notice.dataset.kind = "error";
    notice.textContent = `加载失败：${message}`;
  }
}

function setLoading(loading: boolean): void {
  refreshButton.disabled = loading;
  refreshButton.textContent = loading ? "读取中…" : "刷新";
}

function render(): void {
  statusBadge.dataset.status = view.status;
  statusLabel.textContent = statusLabelFor(view.status);
  notice.hidden = true;
  updateOverview();

  // 区块显隐由侧边导航控制（showSection），此处只负责内容填充。
  if (view.status !== "READY") {
    testerResult.textContent = "";
    templateList.innerHTML = "";
    ruleList.innerHTML = "";
    return;
  }

  renderTemplates();
  renderRules();
  renderTester(testerInput.value);
}

function renderTemplates(): void {
  templateCount.textContent = `${view.templates.length} 个模板`;
  templateList.replaceChildren(...view.templates.map(templateCard));
}

function templateCard(template: TemplateEntry): HTMLElement {
  const details = document.createElement("details");
  details.className = "template";

  const summary = document.createElement("summary");
  const key = document.createElement("span");
  key.className = "template-key";
  key.textContent = template.key;
  const preview = document.createElement("span");
  preview.className = "template-preview";
  preview.textContent = template.preview;
  const toggle = document.createElement("span");
  toggle.className = "template-toggle";
  toggle.textContent = "展开";
  summary.append(key, preview, toggle);

  const body = document.createElement("div");
  body.className = "template-body";
  const textarea = document.createElement("textarea");
  textarea.className = "template-editor";
  textarea.rows = 4;
  textarea.value = draft?.templates[template.key] ?? template.text;
  textarea.addEventListener("input", () => {
    if (draft !== null) {
      draft.templates[template.key] = textarea.value;
    }
  });
  body.append(textarea);
  if (template.placeholders.length > 0) {
    const placeholderLabel = document.createElement("p");
    placeholderLabel.className = "template-placeholders";
    placeholderLabel.append("占位符：");
    for (const placeholder of template.placeholders) {
      const code = document.createElement("code");
      code.textContent = placeholder;
      placeholderLabel.append(code);
    }
    body.append(placeholderLabel);
  }

  details.addEventListener("toggle", () => {
    toggle.textContent = details.open ? "收起" : "展开";
  });

  details.append(summary, body);
  return details;
}

function renderRules(): void {
  ruleList.replaceChildren(...view.rules.map(ruleRow));
}

function ruleRow(rule: RuleEntry): HTMLElement {
  const row = document.createElement("tr");

  const priority = document.createElement("td");
  priority.className = "rule-priority";
  priority.textContent = String(rule.priority);

  const keywords = document.createElement("td");
  keywords.className = "rule-keywords";
  for (const keyword of rule.keywords) {
    const code = document.createElement("code");
    code.textContent = keyword;
    keywords.append(code);
  }

  const reply = document.createElement("td");
  reply.className = "rule-reply";
  reply.textContent = rule.reply;

  const state = document.createElement("td");
  const stateSpan = document.createElement("span");
  stateSpan.className = "rule-state";
  stateSpan.dataset.enabled = String(rule.enabled);
  stateSpan.textContent = rule.enabled ? "启用" : "停用";
  state.append(stateSpan);

  const actions = document.createElement("td");
  actions.className = "rule-actions";
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "mini-btn";
  toggleButton.textContent = rule.enabled ? "停用" : "启用";
  toggleButton.addEventListener("click", () => {
    if (draft !== null) {
      const draftRule = draft.keywordRules.find((item) => item.id === rule.id);
      if (draftRule !== undefined) {
        draftRule.enabled = !draftRule.enabled;
        renderRules();
      }
    }
  });
  actions.append(toggleButton);

  row.append(priority, keywords, reply, state, actions);
  return row;
}

function renderTester(text: string): void {
  if (view.status !== "READY" || text.trim().length === 0) {
    testerResult.textContent = "输入文字后显示匹配结果";
    testerResult.dataset.matched = "false";
    return;
  }
  const result = testKeyword(text, view.rules);
  if (!result.matched) {
    testerResult.textContent = `未命中任何关键字规则，将调用 AI 客服回复。`;
    testerResult.dataset.matched = "false";
    return;
  }
  testerResult.textContent =
    `命中规则「${result.ruleId}」（优先级 ${result.priority}）→ ${result.reply}`;
  testerResult.dataset.matched = "true";
}

function statusLabelFor(status: ManageViewState["status"]): string {
  switch (status) {
    case "LOADING":
      return "正在读取…";
    case "UNAUTHENTICATED":
      return "未连接工作台";
    case "READY":
      return `配置 v${view.version} 已加载`;
    case "ERROR":
      return "加载失败";
  }
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`missing manage element: ${id}`);
  }
  return element as T;
}
