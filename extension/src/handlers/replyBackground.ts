import type {
  AiReplyRequest,
  AiReplyResult,
  BackendApiClient,
  ReplyConfig
} from "./backendApi.ts";
import type {
  ActiveActionCompletion,
  ActiveActionPermit,
  AutomationExecutionState
} from "./automationLifecycle.ts";
import type { StoredPluginState } from "./pluginState.ts";

interface ReplyLifecycle {
  getState(): Promise<StoredPluginState>;
  getExecutionState(): Promise<AutomationExecutionState>;
  authorizeAction(effect: "READ"): Promise<ActiveActionPermit | null>;
  classifyActionCompletion(permit: ActiveActionPermit): Promise<ActiveActionCompletion>;
  handleBackendFailure(error: unknown): Promise<StoredPluginState>;
}

interface ReplyBackgroundControllerOptions {
  lifecycle: ReplyLifecycle;
  apiFactory(token: string): Pick<BackendApiClient, "getAiReply" | "getReplyConfig">;
}

export class ReplyBackgroundController {
  private readonly lifecycle: ReplyLifecycle;
  private readonly apiFactory: (
    token: string
  ) => Pick<BackendApiClient, "getAiReply" | "getReplyConfig">;

  constructor(options: ReplyBackgroundControllerOptions) {
    this.lifecycle = options.lifecycle;
    this.apiFactory = options.apiFactory;
  }

  async getReplyConfig(): Promise<ReplyConfig> {
    const state = await this.lifecycle.getState();
    if (
      state.authStatus !== "AUTHENTICATED" ||
      state.replyConfig === null ||
      state.replyConfig.version !== state.replyConfigVersion
    ) {
      // 本地驱动模式：配置来自本地 JSON，不依赖后台同步的缓存状态，
      // 直接从本地加载器拉取（manage 页与页面 hook 随时可用）。
      return this.apiFactory("local").getReplyConfig();
    }
    return state.replyConfig;
  }

  async getAutomationConfig(): Promise<{
    autoReply: boolean;
    xianyuDeliverSendImageEnabled: boolean;
  }> {
    const execution = await this.lifecycle.getExecutionState();
    return {
      autoReply: execution.canExecute,
      xianyuDeliverSendImageEnabled: execution.canExecute
    };
  }

  async getAiReply(request: AiReplyRequest): Promise<AiReplyResult> {
    const permit = await this.lifecycle.authorizeAction("READ");
    if (permit === null) {
      return { reply: null };
    }
    const state = await this.lifecycle.getState();
    if (
      state.authStatus !== "AUTHENTICATED" ||
      state.token === null ||
      state.automationRevision !== permit.automationRevision ||
      !state.automationEnabled ||
      state.safetyDisabled ||
      state.remoteDisablePending ||
      state.replyConfig === null ||
      state.replyConfig.version !== state.replyConfigVersion
    ) {
      return { reply: null };
    }

    let result: AiReplyResult;
    try {
      result = await this.apiFactory(state.token).getAiReply(request);
    } catch (error) {
      await this.lifecycle.handleBackendFailure(error);
      throw error;
    }
    const completion = await this.lifecycle.classifyActionCompletion(permit);
    return completion === "CONTINUE" ? result : { reply: null };
  }
}
