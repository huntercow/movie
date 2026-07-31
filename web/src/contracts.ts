import type {
  AdminAgent,
  AgentInstance,
  AgentToken,
  AuditLog,
  AuthResponse,
  JobTask,
  Order,
  Quote,
  ReplyConfig,
  UpstreamAccount,
  UserView
} from "./types";
import type { Decoder } from "./api";

type JsonObject = Record<string, unknown>;

function object(value: unknown, context: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`协议错误：${context} 必须是对象`);
  }
  return value as JsonObject;
}

function string(value: unknown, context: string): string {
  if (typeof value !== "string") throw new Error(`协议错误：${context} 必须是字符串`);
  return value;
}

function nonEmptyString(value: unknown, context: string): string {
  const result = string(value, context);
  if (!result) throw new Error(`协议错误：${context} 不能为空`);
  return result;
}

function number(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`协议错误：${context} 必须是有限数字`);
  }
  return value;
}

function boolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") throw new Error(`协议错误：${context} 必须是布尔值`);
  return value;
}

function optionalString(value: unknown, context: string): string | undefined {
  return value === null || value === undefined ? undefined : string(value, context);
}

function optionalNumber(value: unknown, context: string): number | undefined {
  return value === null || value === undefined ? undefined : number(value, context);
}

function array<T>(value: unknown, context: string, decoder: Decoder<T>): T[] {
  if (!Array.isArray(value)) throw new Error(`协议错误：${context} 必须是数组`);
  return value.map((item, index) => decoder(item, `${context}[${index}]`));
}

function enumValue<T extends string>(value: unknown, context: string, allowed: readonly T[]): T {
  const result = string(value, context);
  if (!allowed.includes(result as T)) throw new Error(`协议错误：${context} 的值 ${result} 未定义`);
  return result as T;
}

export const decodeUserView: Decoder<UserView> = (value, context) => {
  const data = object(value, context);
  return {
    id: number(data.id, `${context}.id`),
    username: nonEmptyString(data.username, `${context}.username`),
    role: enumValue(data.role, `${context}.role`, ["ADMIN", "USER"]),
    status: enumValue(data.status, `${context}.status`, ["ACTIVE", "SUSPENDED"]),
    mustChangePassword: boolean(data.mustChangePassword, `${context}.mustChangePassword`),
    lastLoginAt: optionalString(data.lastLoginAt, `${context}.lastLoginAt`)
  };
};

export const decodeAuthResponse: Decoder<AuthResponse> = (value, context) => {
  const data = object(value, context);
  return {
    accessToken: nonEmptyString(data.accessToken, `${context}.accessToken`),
    expiresAt: nonEmptyString(data.expiresAt, `${context}.expiresAt`),
    user: decodeUserView(data.user, `${context}.user`)
  };
};

const decodeAgentInstance: Decoder<AgentInstance> = (value, context) => {
  const data = object(value, context);
  return {
    id: number(data.id, `${context}.id`),
    installationId: nonEmptyString(data.installationId, `${context}.installationId`),
    instanceName: optionalString(data.instanceName, `${context}.instanceName`),
    clientVersion: optionalString(data.clientVersion, `${context}.clientVersion`),
    status: enumValue(data.status, `${context}.status`, ["ONLINE", "OFFLINE", "DISABLED"]),
    activatedAt: nonEmptyString(data.activatedAt, `${context}.activatedAt`),
    lastHeartbeatAt: optionalString(data.lastHeartbeatAt, `${context}.lastHeartbeatAt`),
    currentXianyuAccountId: optionalString(data.currentXianyuAccountId, `${context}.currentXianyuAccountId`),
    currentXianyuNickname: optionalString(data.currentXianyuNickname, `${context}.currentXianyuNickname`),
    xianyuAccountUpdatedAt: optionalString(data.xianyuAccountUpdatedAt, `${context}.xianyuAccountUpdatedAt`)
  };
};

export const decodeAgentToken: Decoder<AgentToken> = (value, context) => {
  const data = object(value, context);
  return {
    id: number(data.id, `${context}.id`),
    agentType: enumValue(data.agentType, `${context}.agentType`, ["XIANYU_PLUGIN", "WECHAT_BOT"]),
    tokenPrefix: nonEmptyString(data.tokenPrefix, `${context}.tokenPrefix`),
    status: enumValue(data.status, `${context}.status`, ["PENDING", "UNUSED", "ACTIVE", "REVOKED", "EXPIRED"]),
    expiresAt: optionalString(data.expiresAt, `${context}.expiresAt`),
    lastUsedAt: optionalString(data.lastUsedAt, `${context}.lastUsedAt`),
    createdAt: nonEmptyString(data.createdAt, `${context}.createdAt`),
    instance: data.instance === null || data.instance === undefined
      ? undefined
      : decodeAgentInstance(data.instance, `${context}.instance`)
  };
};

export const decodeAdminAgent: Decoder<AdminAgent> = (value, context) => {
  const data = object(value, context);
  return {
    userId: number(data.userId, `${context}.userId`),
    username: nonEmptyString(data.username, `${context}.username`),
    userStatus: data.userStatus === null || data.userStatus === undefined
      ? undefined
      : enumValue(data.userStatus, `${context}.userStatus`, ["ACTIVE", "SUSPENDED"] as const),
    token: decodeAgentToken(data.token, `${context}.token`)
  };
};

export const decodeQuote: Decoder<Quote> = (value, context) => {
  const data = object(value, context);
  const ticketInfo = object(data.ticketInfo, `${context}.ticketInfo`);
  return {
    quoteNo: nonEmptyString(data.quoteNo, `${context}.quoteNo`),
    ticketInfo: {
      movieName: optionalString(ticketInfo.movieName, `${context}.ticketInfo.movieName`),
      cinemaName: optionalString(ticketInfo.cinemaName, `${context}.ticketInfo.cinemaName`),
      showTime: optionalString(ticketInfo.showTime, `${context}.ticketInfo.showTime`),
      hallName: optionalString(ticketInfo.hallName, `${context}.ticketInfo.hallName`),
      seats: ticketInfo.seats === null || ticketInfo.seats === undefined
        ? undefined
        : array(ticketInfo.seats, `${context}.ticketInfo.seats`, string),
      seatCount: optionalNumber(ticketInfo.seatCount, `${context}.ticketInfo.seatCount`)
    },
    upstreamPrice: number(data.upstreamPrice, `${context}.upstreamPrice`),
    finalPrice: number(data.finalPrice, `${context}.finalPrice`),
    totalPrice: number(data.totalPrice, `${context}.totalPrice`),
    profit: number(data.profit, `${context}.profit`),
    status: enumValue(data.status, `${context}.status`, ["CREATED", "FAILED", "ORDERED"])
  };
};

export const decodeOrder: Decoder<Order> = (value, context) => {
  const data = object(value, context);
  return {
    orderNo: nonEmptyString(data.orderNo, `${context}.orderNo`),
    quoteNo: nonEmptyString(data.quoteNo, `${context}.quoteNo`),
    customerId: nonEmptyString(data.customerId, `${context}.customerId`),
    totalPrice: number(data.totalPrice, `${context}.totalPrice`),
    upstreamOrderNo: optionalString(data.upstreamOrderNo, `${context}.upstreamOrderNo`),
    ticketCodeInfo: optionalString(data.ticketCodeInfo, `${context}.ticketCodeInfo`),
    status: enumValue(data.status, `${context}.status`, [
      "CREATED", "WAIT_SUBMIT", "SUBMITTING", "SUBMITTED", "SUBMIT_FAILED", "WAIT_PAY",
      "PAID", "TICKETING", "ISSUED", "FAILED", "REFUNDED"
    ]),
    statusText: nonEmptyString(data.statusText, `${context}.statusText`),
    terminal: boolean(data.terminal, `${context}.terminal`),
    shouldPoll: boolean(data.shouldPoll, `${context}.shouldPoll`),
    lastSubmitError: optionalString(data.lastSubmitError, `${context}.lastSubmitError`),
    lastSyncError: optionalString(data.lastSyncError, `${context}.lastSyncError`)
  };
};

export const decodeUpstreamAccount: Decoder<UpstreamAccount> = (value, context) => {
  const data = object(value, context);
  return {
    configured: boolean(data.configured, `${context}.configured`),
    provider: optionalString(data.provider, `${context}.provider`),
    username: optionalString(data.username, `${context}.username`),
    status: data.status === null || data.status === undefined
      ? undefined
      : enumValue(data.status, `${context}.status`, ["CONFIGURED", "ACTIVE", "ERROR", "DISABLED"] as const),
    lastLoginAt: optionalString(data.lastLoginAt, `${context}.lastLoginAt`),
    lastError: optionalString(data.lastError, `${context}.lastError`),
    updatedAt: optionalString(data.updatedAt, `${context}.updatedAt`),
    encryptionConfigured: boolean(data.encryptionConfigured, `${context}.encryptionConfigured`)
  };
};

export const decodeReplyConfig: Decoder<ReplyConfig> = (value, context) => {
  const data = object(value, context);
  const templates = object(data.templates, `${context}.templates`);
  Object.entries(templates).forEach(([key, template]) => string(template, `${context}.templates.${key}`));
  return {
    configKey: nonEmptyString(data.configKey, `${context}.configKey`),
    templates: templates as Record<string, string>,
    keywordRules: array(data.keywordRules, `${context}.keywordRules`, (item) => item),
    textFallbackEnabled: boolean(data.textFallbackEnabled, `${context}.textFallbackEnabled`),
    updatedAt: optionalString(data.updatedAt, `${context}.updatedAt`)
  };
};

export const decodeJobTask: Decoder<JobTask> = (value, context) => {
  const data = object(value, context);
  return {
    id: number(data.id, `${context}.id`),
    userId: optionalNumber(data.userId, `${context}.userId`),
    taskType: nonEmptyString(data.taskType, `${context}.taskType`),
    businessKey: nonEmptyString(data.businessKey, `${context}.businessKey`),
    status: enumValue(data.status, `${context}.status`, ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]),
    attemptCount: number(data.attemptCount, `${context}.attemptCount`),
    nextRunAt: optionalString(data.nextRunAt, `${context}.nextRunAt`),
    lockedBy: optionalString(data.lockedBy, `${context}.lockedBy`),
    lockedUntil: optionalString(data.lockedUntil, `${context}.lockedUntil`),
    lastError: optionalString(data.lastError, `${context}.lastError`),
    createdAt: nonEmptyString(data.createdAt, `${context}.createdAt`),
    updatedAt: nonEmptyString(data.updatedAt, `${context}.updatedAt`)
  };
};

export const decodeAuditLog: Decoder<AuditLog> = (value, context) => {
  const data = object(value, context);
  return {
    id: number(data.id, `${context}.id`),
    actorUserId: optionalNumber(data.actorUserId, `${context}.actorUserId`),
    targetUserId: optionalNumber(data.targetUserId, `${context}.targetUserId`),
    action: nonEmptyString(data.action, `${context}.action`),
    resourceType: optionalString(data.resourceType, `${context}.resourceType`),
    resourceId: optionalString(data.resourceId, `${context}.resourceId`),
    beforeJson: optionalString(data.beforeJson, `${context}.beforeJson`),
    afterJson: optionalString(data.afterJson, `${context}.afterJson`),
    ipAddress: optionalString(data.ipAddress, `${context}.ipAddress`),
    createdAt: nonEmptyString(data.createdAt, `${context}.createdAt`)
  };
};

export const decodeBootstrapStatus: Decoder<{ initialized: boolean }> = (value, context) => {
  const data = object(value, context);
  return { initialized: boolean(data.initialized, `${context}.initialized`) };
};

export const decodeCreatedAgentToken: Decoder<{ token: string; details: AgentToken }> = (value, context) => {
  const data = object(value, context);
  return {
    token: nonEmptyString(data.token, `${context}.token`),
    details: decodeAgentToken(data.details, `${context}.details`)
  };
};

export const decodeObject: Decoder<JsonObject> = object;

export const decodeNull: Decoder<void> = (value, context) => {
  if (value !== null) throw new Error(`协议错误：${context} 必须为 null`);
};

export function decodeArray<T>(decoder: Decoder<T>): Decoder<T[]> {
  return (value, context) => array(value, context, decoder);
}
