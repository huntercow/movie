import type { StoredPluginState } from "../handlers/pluginState.ts";

export type PopupBusyAction = "HOOK";

export interface PopupViewState {
  visualState: "standby" | "active";
  stateLabel: string;
  hook: {
    checked: boolean;
    disabled: boolean;
    stateLabel: string;
    description: string;
    cue: string;
  };
  /** 一行说明：运行状态 / 配置未就绪 / 安全暂停等。 */
  workNote: string;
}

interface PopupViewOptions {
  busy?: PopupBusyAction;
  errorMessage?: string;
  hookEnabled?: boolean;
}

/** 自动化可用性阻塞：配置未就绪 / 安全暂停 / 正在安全关闭。 */
function automationBlock(state: StoredPluginState): {
  stateLabel: string;
  cue: string;
} | null {
  if (state.authStatus !== "AUTHENTICATED") {
    return {
      stateLabel: state.authStatus === "TOKEN_INVALID" ? "Token 失效" : "未登录",
      cue: "请打开业务控制台登录后端"
    };
  }
  if (state.remoteDisablePending) {
    return {
      stateLabel: "正在安全关闭",
      cue: "关闭确认后才可重新开启"
    };
  }
  if (state.replyConfig === null || state.replyConfig.version !== state.replyConfigVersion) {
    return {
      stateLabel: "配置未就绪",
      cue: "等待本地话术配置加载"
    };
  }
  if (state.safetyDisabled) {
    return {
      stateLabel: "安全暂停",
      cue: "本地故障安全关闭，可重新开启"
    };
  }
  return null;
}

/**
 * 后端生产模式：先登录后端，页面 hook 开关即自动工作总开关。
 * 工作状态 = 已登录 + hookEnabled 且后台已确认启用自动化且无阻塞。
 */
export function buildPopupViewState(
  state: StoredPluginState,
  options: PopupViewOptions = {}
): PopupViewState {
  const busy = options.busy;
  const hookEnabled = options.hookEnabled === true;
  const hookUpdating = busy === "HOOK";
  const block = automationBlock(state);
  const active = hookEnabled && state.automationEnabled && block === null;

  const hook = {
    checked: hookEnabled,
    disabled: busy !== undefined,
    stateLabel: hookUpdating ? "正在更新…" : hookEnabled ? "已开启" : "已关闭",
    description: hookEnabled
      ? "正在监听闲鱼页面：自动回复、报价、付款校验与发货。"
      : "关闭时不处理闲鱼页面消息，也不发起页面侧动作。",
    cue: hookEnabled
      ? "刷新闲鱼页面可重新捕获已存在连接"
      : "开启后自动开始工作"
  };

  let stateLabel = active ? "运行中" : block === null ? "已暂停" : block.stateLabel;
  if (hookUpdating) {
    stateLabel = "正在更新…";
  }

  let workNote: string;
  if (options.errorMessage !== undefined) {
    workNote = options.errorMessage;
  } else if (active) {
    workNote = "自动回复、报价、付款校验与发货已开启";
  } else if (block !== null) {
    workNote = block.cue;
  } else {
    workNote = "开启页面 Hook 后自动开始工作";
  }

  return {
    visualState: active ? "active" : "standby",
    stateLabel,
    hook,
    workNote
  };
}
