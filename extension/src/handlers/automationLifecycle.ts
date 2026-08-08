/**
 * 自动化生命周期：Token 登录/同步/登出、自动工作总开关、话术配置就绪与安全状态。
 *
 * 本类封装插件与业务后端之间的运行状态机：只有 Token 已登录、当前配置版本已拉取并
 * 校验、自动化开关已由后端确认开启时才允许执行（canExecute）。网络/后端故障立即
 * 本地安全关闭且不自动恢复；写动作在途时开关被关闭只允许状态收尾（SETTLE_ONLY）。
 * 所有公开操作通过 exclusive 串行化，避免并发读写同一份插件状态。
 */
import {
  BackendApiError,
  type AutomationState,
  type BackendApiClient,
  type ReplyConfig,
  type SyncState
} from "./backendApi.ts";
import {
  createInitialPluginState,
  decodeStoredPluginState,
  type QuoteRecovery,
  type StoredPluginState
} from "./pluginState.ts";

/** 触发同步的时机：安装 / 启动 / 定时告警 / 网络恢复 / 手动。 */
export type LifecycleSyncTrigger =
  | "INSTALLED"
  | "STARTUP"
  | "ALARM"
  | "NETWORK_RESTORED"
  | "MANUAL";

/** 生命周期操作错误码：登录未验证 / 未登录 / 配置未就绪 / 远端更新失败。 */
export type LifecycleOperationErrorCode =
  | "LOGIN_NOT_VALIDATED"
  | "NOT_AUTHENTICATED"
  | "CONFIG_NOT_READY"
  | "REMOTE_UPDATE_FAILED";

/** 生命周期操作失败时抛出的错误，携带稳定错误码。 */
export class LifecycleOperationError extends Error {
  readonly code: LifecycleOperationErrorCode;

  constructor(code: LifecycleOperationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LifecycleOperationError";
    this.code = code;
  }
}

/** 插件状态的持久化仓库（chrome.storage.local 实现）。 */
export interface PluginStateRepository {
  load(): Promise<StoredPluginState>;
  save(state: StoredPluginState): Promise<void>;
}

/** 生命周期用到的后端操作子集：同步 / 改自动化开关 / 拉配置。 */
export type LifecycleBackendApi = Pick<
  BackendApiClient,
  "sync" | "updateAutomation" | "getReplyConfig"
>;

/** 自动化执行状态：是否可以执行及当前修订号。 */
export interface AutomationExecutionState {
  canExecute: boolean;
  automationRevision: number;
}

/** 主动 MTop 动作的类别：READ 只读查询，WRITE 会改变闲鱼状态的写操作。 */
export type ActiveActionEffect = "READ" | "WRITE";

/** 发起主动动作前取得的执行许可，记录动作类别与发起时的修订号。 */
export interface ActiveActionPermit {
  effect: ActiveActionEffect;
  automationRevision: number;
}

/**
 * 动作完成时的分类结果：
 * CONTINUE 正常继续（开关仍开且修订号未变）；DISCARD 丢弃只读结果；
 * SETTLE_ONLY 写操作只做状态收尾，不再触发后续动作。
 */
export type ActiveActionCompletion = "CONTINUE" | "DISCARD" | "SETTLE_ONLY";

interface AutomationLifecycleOptions {
  repository: PluginStateRepository;
  apiFactory(token: string): LifecycleBackendApi;
  now(): string;
}

/** 校验登录参数为非空字符串，否则抛 LOGIN_NOT_VALIDATED。 */
function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LifecycleOperationError("LOGIN_NOT_VALIDATED", `${field} must be a non-empty string`);
  }
  return value;
}

/** 判断错误是否为后端 401（Token 无效/过期/禁用）。 */
function isTokenInvalid(error: unknown): boolean {
  return error instanceof BackendApiError && error.kind === "TOKEN_INVALID";
}

/** 归一化诊断类别：网络 / HTTP / 协议，其他一律按协议处理。 */
function diagnosticKind(error: unknown): "NETWORK" | "HTTP" | "PROTOCOL" {
  if (error instanceof BackendApiError) {
    if (error.kind === "NETWORK" || error.kind === "HTTP" || error.kind === "PROTOCOL") {
      return error.kind;
    }
  }
  return "PROTOCOL";
}

/** 构造协议错误（用于后端响应结构不合理等）。 */
function protocol(message: string): BackendApiError {
  return new BackendApiError("PROTOCOL", message);
}

/**
 * 自动化生命周期控制类。全部公开方法互斥执行，内部以串行队列保证
 * 插件状态读取-决策-保存的原子性。
 */
export class AutomationLifecycle {
  private readonly repository: PluginStateRepository;
  private readonly apiFactory: (token: string) => LifecycleBackendApi;
  private readonly now: () => string;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(options: AutomationLifecycleOptions) {
    this.repository = options.repository;
    this.apiFactory = options.apiFactory;
    this.now = options.now;
  }

  /**
   * Token 登录：校验参数、调用后端 sync 验证 Token、拉取并校验最新话术配置。
   * 若远端仍处于开启状态（remoteDisablePending），登录后必须保持本地关闭，
   * 先确认远端关闭，绝不按后端旧开启值自动运行。
   */
  login(tokenValue: string, clientVersionValue: string): Promise<StoredPluginState> {
    return this.exclusive(async () => {
      const token = nonEmptyString(tokenValue, "token");
      const clientVersion = nonEmptyString(clientVersionValue, "clientVersion");
      const previous = await this.load();
      const api = this.apiFactory(token);
      let remote: SyncState;
      try {
        remote = await api.sync(clientVersion);
      } catch (error) {
        if (isTokenInvalid(error)) {
          return this.save(this.invalidTokenState());
        }
        await this.save({
          ...createInitialPluginState(),
          remoteDisablePending: previous.remoteDisablePending,
          diagnostics: {
            lastBackendFailure: {
              kind: diagnosticKind(error),
              occurredAt: this.now()
            }
          }
        });
        throw new LifecycleOperationError(
          "LOGIN_NOT_VALIDATED",
          "Token could not be validated",
          { cause: error }
        );
      }

      let state = await this.save({
        ...createInitialPluginState(),
        token,
        authStatus: "AUTHENTICATED",
        automationEnabled: false,
        automationRevision: remote.automationRevision,
        replyConfigVersion: remote.replyConfigVersion,
        replyConfig: null,
        safetyDisabled: true,
        remoteDisablePending: remote.automationEnabled,
        diagnostics: { lastBackendFailure: null }
      });

      state = await this.fetchConfig(api, state);
      if (state.authStatus !== "AUTHENTICATED") {
        return state;
      }
      if (state.remoteDisablePending) {
        state = await this.confirmRemoteDisabled(api, state);
      } else if (this.hasCurrentConfig(state)) {
        state = await this.save({ ...state, safetyDisabled: false });
      }
      return state;
    });
  }

  /**
   * 状态同步：登录后每分钟/启动/网络恢复时调用。
   * 处理配置版本变化（先本地安全关闭再拉新配置）、远端开关变化、
   * 修订号回退异常，以及安全关闭标记的清除。
   */
  synchronize(
    _trigger: LifecycleSyncTrigger,
    clientVersionValue: string
  ): Promise<StoredPluginState> {
    return this.exclusive(async () => {
      const clientVersion = nonEmptyString(clientVersionValue, "clientVersion");
      let state = await this.load();
      if (state.authStatus !== "AUTHENTICATED" || state.token === null) {
        return state;
      }
      const api = this.apiFactory(state.token);
      let remote: SyncState;
      try {
        remote = await api.sync(clientVersion);
      } catch (error) {
        if (isTokenInvalid(error)) {
          return this.save(this.invalidTokenState());
        }
        // 后端故障只本地暂停,不动远端(与 handleBackendFailure 同策略)。
        return this.save({
          ...state,
          safetyDisabled: true,
          diagnostics: {
            lastBackendFailure: {
              kind: diagnosticKind(error),
              occurredAt: this.now()
            }
          }
        });
      }

      if (remote.automationRevision < state.automationRevision) {
        return this.save(this.safeFailureState(
          state,
          protocol("automationRevision moved backwards"),
          state.automationEnabled || remote.automationEnabled
        ));
      }

      const configChanged =
        state.replyConfig === null ||
        state.replyConfigVersion !== remote.replyConfigVersion ||
        state.replyConfig.version !== remote.replyConfigVersion;

      if (configChanged) {
        state = await this.save({
          ...state,
          automationEnabled: false,
          automationRevision: remote.automationRevision,
          replyConfigVersion: remote.replyConfigVersion,
          safetyDisabled: true,
          remoteDisablePending:
            state.remoteDisablePending || state.automationEnabled || remote.automationEnabled
        });
        state = await this.fetchConfig(api, state);
        if (state.authStatus !== "AUTHENTICATED") {
          return state;
        }
        if (state.remoteDisablePending) {
          state = await this.confirmRemoteDisabled(api, state);
        } else if (this.hasCurrentConfig(state)) {
          state = await this.save({ ...state, safetyDisabled: false });
        }
        return state;
      }

      if (state.remoteDisablePending) {
        return this.confirmRemoteDisabled(api, {
          ...state,
          automationRevision: remote.automationRevision,
          automationEnabled: false,
          safetyDisabled: true
        });
      }

      if (remote.automationRevision > state.automationRevision) {
        return this.save({
          ...state,
          automationEnabled: remote.automationEnabled,
          automationRevision: remote.automationRevision,
          safetyDisabled: false,
          remoteDisablePending: false
        });
      }

      if (!remote.automationEnabled && state.automationEnabled) {
        return this.save({
          ...state,
          automationEnabled: false,
          safetyDisabled: false,
          remoteDisablePending: false
        });
      }

      if (state.safetyDisabled) {
        return this.save({
          ...state,
          safetyDisabled: false,
          diagnostics: { lastBackendFailure: null }
        });
      }

      return state;
    });
  }

  /**
   * 修改自动工作总开关：开启必须后端确认成功且配置已就绪；
   * 关闭先本地停止，再请求后端保存关闭状态。
   */
  setAutomation(enabled: boolean): Promise<StoredPluginState> {
    return this.exclusive(async () => {
      if (typeof enabled !== "boolean") {
        throw new LifecycleOperationError("REMOTE_UPDATE_FAILED", "enabled must be a boolean");
      }
      let state = await this.load();
      if (state.authStatus !== "AUTHENTICATED" || state.token === null) {
        throw new LifecycleOperationError("NOT_AUTHENTICATED", "Token is not authenticated");
      }
      if (enabled && !this.hasCurrentConfig(state)) {
        throw new LifecycleOperationError("CONFIG_NOT_READY", "Current reply config is not ready");
      }

      const api = this.apiFactory(state.token);
      if (!enabled) {
        state = await this.save({
          ...state,
          automationEnabled: false,
          safetyDisabled: true,
          remoteDisablePending: true
        });
      }

      let remote: AutomationState;
      try {
        remote = await api.updateAutomation(enabled);
        this.assertAutomationUpdate(remote, enabled, state.automationRevision);
      } catch (error) {
        if (isTokenInvalid(error)) {
          return this.save(this.invalidTokenState());
        }
        await this.save(this.safeFailureState(state, error, true));
        throw new LifecycleOperationError(
          "REMOTE_UPDATE_FAILED",
          "Automation state was not confirmed by the backend",
          { cause: error }
        );
      }

      return this.save({
        ...state,
        automationEnabled: enabled,
        automationRevision: remote.automationRevision,
        safetyDisabled: false,
        remoteDisablePending: false,
        diagnostics: { lastBackendFailure: null }
      });
    });
  }

  /**
   * 退出登录：本地立即关闭自动化，请求后端保存关闭；
   * 远端关闭未确认时保留 remoteDisablePending，下次登录必须保持关闭。
   */
  logout(): Promise<StoredPluginState> {
    return this.exclusive(async () => {
      let state = await this.load();
      if (state.authStatus !== "AUTHENTICATED" || state.token === null) {
        return this.save({
          ...createInitialPluginState(),
          remoteDisablePending: state.remoteDisablePending
        });
      }

      const api = this.apiFactory(state.token);
      state = await this.save({
        ...state,
        automationEnabled: false,
        safetyDisabled: true,
        remoteDisablePending: true
      });
      let remoteDisablePending = true;
      let lastBackendFailure = state.diagnostics.lastBackendFailure;
      try {
        const remote = await api.updateAutomation(false);
        this.assertAutomationUpdate(remote, false, state.automationRevision);
        remoteDisablePending = false;
        lastBackendFailure = null;
      } catch (error) {
        if (isTokenInvalid(error)) {
          remoteDisablePending = false;
          lastBackendFailure = null;
        } else {
          lastBackendFailure = {
            kind: diagnosticKind(error),
            occurredAt: this.now()
          };
        }
      }

      return this.save({
        ...createInitialPluginState(),
        remoteDisablePending,
        diagnostics: { lastBackendFailure }
      });
    });
  }

  /** 读取当前插件状态。 */
  getState(): Promise<StoredPluginState> {
    return this.exclusive(() => this.load());
  }

  /** 查询当前是否允许执行主动动作及自动化修订号。 */
  getExecutionState(): Promise<AutomationExecutionState> {
    return this.exclusive(async () => {
      const state = await this.load();
      return {
        canExecute: this.canExecute(state),
        automationRevision: state.automationRevision
      };
    });
  }

  /**
   * 发起主动 MTop 动作前调用：可执行时签发带修订号的许可，否则返回 null。
   * 每个动作执行前必须重新获取，禁止复用旧许可。
   */
  authorizeAction(effect: ActiveActionEffect): Promise<ActiveActionPermit | null> {
    return this.exclusive(async () => {
      if (effect !== "READ" && effect !== "WRITE") {
        throw protocol("active action effect must be READ or WRITE");
      }
      const state = await this.load();
      if (!this.canExecute(state)) {
        return null;
      }
      return {
        effect,
        automationRevision: state.automationRevision
      };
    });
  }

  /**
   * 动作响应回来后分类：开关仍开且修订号未变则 CONTINUE；
   * 否则只读动作 DISCARD（丢弃结果），写动作 SETTLE_ONLY（只做状态收尾）。
   */
  classifyActionCompletion(permit: ActiveActionPermit): Promise<ActiveActionCompletion> {
    return this.exclusive(async () => {
      if (
        (permit.effect !== "READ" && permit.effect !== "WRITE") ||
        !Number.isSafeInteger(permit.automationRevision) ||
        permit.automationRevision < 0
      ) {
        throw protocol("active action permit is invalid");
      }
      const state = await this.load();
      if (this.canExecute(state) && state.automationRevision === permit.automationRevision) {
        return "CONTINUE";
      }
      return permit.effect === "WRITE" ? "SETTLE_ONLY" : "DISCARD";
    });
  }

  /**
   * 后端故障处理：401 直接判定 Token 失效；网络/HTTP 故障本地安全关闭；
   * 后端可达时立即尝试把关闭状态保存到远端。
   */
  handleBackendFailure(error: unknown): Promise<StoredPluginState> {
    return this.exclusive(async () => {
      const state = await this.load();
      if (isTokenInvalid(error)) {
        return this.save(this.invalidTokenState());
      }
      if (state.authStatus !== "AUTHENTICATED" || state.token === null) {
        return state;
      }
      // 后端故障只本地暂停(safetyDisabled),不关闭远端 automationEnabled:
      // 后端重启/网络抖动属于运维常态,自动化配置应保留,后端恢复后
      // 下一次同步成功即自动解除暂停,无需人工重开开关。
      return this.save({
        ...state,
        safetyDisabled: true,
        diagnostics: {
          lastBackendFailure: {
            kind: diagnosticKind(error),
            occurredAt: this.now()
          }
        }
      });
    });
  }

  /** 拉取并校验当前版本的话术配置；失败时安全关闭并视可达性同步远端关闭。 */
  private async fetchConfig(
    api: LifecycleBackendApi,
    state: StoredPluginState
  ): Promise<StoredPluginState> {
    try {
      const replyConfig = await api.getReplyConfig();
      if (replyConfig.version !== state.replyConfigVersion) {
        throw protocol("reply config version does not match sync");
      }
      return this.save({
        ...state,
        replyConfig,
        diagnostics: { lastBackendFailure: null }
      });
    } catch (error) {
      if (isTokenInvalid(error)) {
        return this.save(this.invalidTokenState());
      }
      // 配置拉取失败只本地暂停,不动远端(与 handleBackendFailure 同策略)。
      return this.save({
        ...state,
        safetyDisabled: true,
        diagnostics: {
          lastBackendFailure: {
            kind: diagnosticKind(error),
            occurredAt: this.now()
          }
        }
      });
    }
  }

  /** 把本地安全关闭状态确认到远端（updateAutomation(false)），避免后端遗留旧开启值。 */
  private async confirmRemoteDisabled(
    api: LifecycleBackendApi,
    state: StoredPluginState
  ): Promise<StoredPluginState> {
    try {
      const remote = await api.updateAutomation(false);
      this.assertAutomationUpdate(remote, false, state.automationRevision);
      const configReady = this.hasCurrentConfig(state);
      return this.save({
        ...state,
        automationEnabled: false,
        automationRevision: remote.automationRevision,
        safetyDisabled: !configReady,
        remoteDisablePending: false,
        diagnostics: configReady ? { lastBackendFailure: null } : state.diagnostics
      });
    } catch (error) {
      if (isTokenInvalid(error)) {
        return this.save(this.invalidTokenState());
      }
      return this.save(this.safeFailureState(state, error, true));
    }
  }

  /** 构造本地安全关闭状态：停止自动化、置 safetyDisabled，并记录后端故障诊断。 */
  private safeFailureState(
    state: StoredPluginState,
    error: unknown,
    remoteMayBeEnabled: boolean
  ): StoredPluginState {
    return {
      ...state,
      automationEnabled: false,
      safetyDisabled: true,
      remoteDisablePending: state.remoteDisablePending || remoteMayBeEnabled,
      diagnostics: {
        lastBackendFailure: {
          kind: diagnosticKind(error),
          occurredAt: this.now()
        }
      }
    };
  }

  /** 构造 Token 失效状态：清空插件状态并标记 TOKEN_INVALID。 */
  private invalidTokenState(): StoredPluginState {
    return {
      ...createInitialPluginState(),
      authStatus: "TOKEN_INVALID"
    };
  }

  /** 判断后端是否可达：协议错误视为可达；HTTP 4xx 可达，5xx/网络视为不可达。 */
  private backendIsReachable(error: unknown): boolean {
    if (!(error instanceof BackendApiError)) {
      return false;
    }
    if (error.kind === "PROTOCOL") {
      return true;
    }
    return error.kind === "HTTP" && error.status !== undefined && error.status < 500;
  }

  /** 校验自动化开关响应与请求一致，且修订号严格递增，否则抛协议错误。 */
  private assertAutomationUpdate(
    remote: AutomationState,
    expectedEnabled: boolean,
    previousRevision: number
  ): void {
    if (remote.automationEnabled !== expectedEnabled) {
      throw protocol("automation response does not match the requested state");
    }
    if (remote.automationRevision <= previousRevision) {
      throw protocol("automationRevision did not increase");
    }
  }

  /** 当前配置是否就绪：已拉取且版本与 sync 返回的版本一致。 */
  private hasCurrentConfig(state: StoredPluginState): state is StoredPluginState & {
    replyConfig: ReplyConfig;
  } {
    return state.replyConfig !== null && state.replyConfig.version === state.replyConfigVersion;
  }

  /** 是否可以执行主动动作：已登录 + 开关开启 + 无安全关闭/远端关闭待确认 + 配置就绪。 */
  private canExecute(state: StoredPluginState): boolean {
    return (
      state.authStatus === "AUTHENTICATED" &&
      state.token !== null &&
      state.automationEnabled &&
      !state.safetyDisabled &&
      !state.remoteDisablePending &&
      this.hasCurrentConfig(state)
    );
  }

  /** 从仓库读取并解码插件状态。 */
  private async load(): Promise<StoredPluginState> {
    return decodeStoredPluginState(await this.repository.load());
  }

  /** 校验并保存插件状态到仓库，返回解码后的规范化状态。 */
  private async save(state: StoredPluginState): Promise<StoredPluginState> {
    const decoded = decodeStoredPluginState(state);
    await this.repository.save(decoded);
    return decoded;
  }

  /** 把操作排入互斥队列串行执行，防止并发修改插件状态。 */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
