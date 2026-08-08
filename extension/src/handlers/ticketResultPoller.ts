/**
 * 出票结果轮询器。
 *
 * 自动工作开启且闲鱼 IM WebSocket 为 OPEN 时，每 10 秒轮询一次待处理的
 * 出票结果（后端只返回未处理的 status 50/450 订单）。连接未就绪时暂停轮询，
 * 连接恢复（socketOpened）后立即补一次；已取得结果并开始交付后才断线
 * 由交付流程按实际阶段回写失败。
 */
import type { TicketResult } from "./backendApi.ts";

/** 定时器抽象（测试可注入假时钟）。 */
export interface TicketResultPollerClock {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(handle: unknown): void;
}

/** 轮询器依赖的外部端口：开关检查、WebSocket 状态、拉取与处理结果。 */
export interface TicketResultPollerPort {
  canExecute(): Promise<boolean>;
  isSocketOpen(): boolean;
  getTicketResults(): Promise<TicketResult[]>;
  handleTicketResult(result: TicketResult): Promise<void>;
  reportError(error: unknown): void;
}

/** 轮询器对外接口：启动 / 停止 / 连接恢复时立即轮询 / 手动轮询一次。 */
export interface TicketResultPoller {
  start(): Promise<void>;
  stop(): void;
  socketOpened(): Promise<void>;
  pollNow(): Promise<void>;
}

/** 默认轮询间隔：10 秒。 */
const DEFAULT_POLL_INTERVAL_MS = 10_000;

/** 创建出票结果轮询器；polling 标志防止上一轮未完成时重入。 */
export function createTicketResultPoller(options: {
  port: TicketResultPollerPort;
  clock: TicketResultPollerClock;
  intervalMs?: number;
}): TicketResultPoller {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let started = false;
  let polling = false;
  let intervalHandle: unknown;

  async function pollNow(): Promise<void> {
    if (!started || polling || !options.port.isSocketOpen()) {
      return;
    }
    polling = true;
    try {
      if (!await options.port.canExecute() || !options.port.isSocketOpen()) {
        return;
      }
      const results = await options.port.getTicketResults();
      if (!started || !options.port.isSocketOpen()) {
        return;
      }
      for (const result of results) {
        if (!started || !await options.port.canExecute()) {
          return;
        }
        await options.port.handleTicketResult(result);
      }
    } catch (error) {
      options.port.reportError(error);
    } finally {
      polling = false;
    }
  }

  return {
    async start() {
      if (started) {
        return;
      }
      started = true;
      intervalHandle = options.clock.setInterval(() => {
        void pollNow();
      }, intervalMs);
      await pollNow();
    },
    stop() {
      if (!started) {
        return;
      }
      started = false;
      options.clock.clearInterval(intervalHandle);
    },
    async socketOpened() {
      await pollNow();
    },
    pollNow
  };
}
