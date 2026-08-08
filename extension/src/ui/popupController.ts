import {
  createInitialPluginState,
  decodeStoredPluginState,
  type StoredPluginState
} from "../handlers/pluginState.ts";
import {
  createDefaultHookSettings,
  decodeHookSettings
} from "../handlers/hookState.ts";
import {
  buildPopupViewState,
  type PopupBusyAction,
  type PopupViewState
} from "./popupViewModel.ts";

export interface PopupRuntime {
  request(message: unknown): Promise<unknown>;
}

export interface PopupView {
  render(state: PopupViewState): void;
}

interface PopupControllerOptions {
  runtime: PopupRuntime;
  view: PopupView;
  openIm(): Promise<void>;
}

/**
 * 本地驱动模式的弹窗控制器：无登录/登出/Token，
 * 只管理页面 Hook 开关、自动工作开关与闲鱼 IM 入口。
 */
export class PopupController {
  private readonly runtime: PopupRuntime;
  private readonly view: PopupView;
  private readonly openIm: () => Promise<void>;
  private state: StoredPluginState | null = null;
  private hookEnabled = false;
  private busy: PopupBusyAction | undefined;

  constructor(options: PopupControllerOptions) {
    this.runtime = options.runtime;
    this.view = options.view;
    this.openIm = options.openIm;
  }

  async initialize(): Promise<void> {
    try {
      this.state = decodeStoredPluginState(await this.runtime.request({
        type: "PLUGIN_GET_STATE"
      }));
      this.hookEnabled = decodeHookSettings(await this.runtime.request({
        type: "GET_HOOK_SETTINGS"
      })).enabled;
      this.render();
    } catch {
      this.state = createInitialPluginState();
      this.hookEnabled = createDefaultHookSettings().enabled;
      this.render({ errorMessage: "无法读取插件状态，请重新打开弹窗。" });
    }
  }

  async toggleHook(): Promise<void> {
    if (this.busy !== undefined || this.state === null) {
      return;
    }
    const enabled = !this.hookEnabled;
    // 乐观更新：请求进行中 UI 立即反映目标状态，失败再回滚。
    this.hookEnabled = enabled;
    this.busy = "HOOK";
    this.render();
    try {
      this.hookEnabled = decodeHookSettings(await this.runtime.request({
        type: "SET_HOOK_ENABLED",
        data: { enabled }
      })).enabled;
      this.busy = undefined;
      this.render();
    } catch {
      this.hookEnabled = !enabled;
      this.busy = undefined;
      await this.refreshHookAfterFailure("Hook 开关未更新，请重新打开弹窗确认。");
    }
  }

  async openXianyuIm(): Promise<void> {
    try {
      await this.openIm();
    } catch {
      this.render({ errorMessage: "无法打开闲鱼 IM，请手动访问闲鱼消息页面。" });
    }
  }

  /** 重新拉取状态并渲染（popup 在 storage 变化时调用，配置就绪后自动刷新）。 */
  async refresh(): Promise<void> {
    if (this.busy !== undefined) {
      return;
    }
    try {
      this.state = decodeStoredPluginState(await this.runtime.request({ type: "PLUGIN_GET_STATE" }));
      this.hookEnabled = decodeHookSettings(await this.runtime.request({ type: "GET_HOOK_SETTINGS" })).enabled;
      this.render();
    } catch {
      // 保持上次已解码的状态。
    }
  }

  private async refreshAfterFailure(message: string): Promise<void> {
    try {
      this.state = decodeStoredPluginState(await this.runtime.request({ type: "PLUGIN_GET_STATE" }));
    } catch {
      // Keep the last strictly decoded state when the service worker itself is unavailable.
    }
    this.render({ errorMessage: message });
  }

  private async refreshHookAfterFailure(message: string): Promise<void> {
    try {
      this.hookEnabled = decodeHookSettings(await this.runtime.request({ type: "GET_HOOK_SETTINGS" })).enabled;
    } catch {
      // Keep the last decoded hook state if local storage is unavailable.
    }
    this.render({ errorMessage: message });
  }

  private render(options: { errorMessage?: string } = {}): void {
    if (this.state === null) {
      return;
    }
    this.view.render(buildPopupViewState(this.state, {
      busy: this.busy,
      hookEnabled: this.hookEnabled,
      ...options
    }));
  }
}
