export type UserRole = "ADMIN" | "USER";
export type UserStatus = "ACTIVE" | "SUSPENDED";
export type AgentType = "XIANYU_PLUGIN" | "WECHAT_BOT";

export interface UserView {
  id: number;
  username: string;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  lastLoginAt?: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresAt: string;
  user: UserView;
}

export interface AgentInstance {
  id: number;
  installationId: string;
  instanceName?: string;
  clientVersion?: string;
  status: "ONLINE" | "OFFLINE" | "DISABLED";
  activatedAt: string;
  lastHeartbeatAt?: string;
  currentXianyuAccountId?: string;
  currentXianyuNickname?: string;
  xianyuAccountUpdatedAt?: string;
}

export interface AgentToken {
  id: number;
  agentType: AgentType;
  tokenPrefix: string;
  status: "PENDING" | "UNUSED" | "ACTIVE" | "REVOKED" | "EXPIRED";
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  instance?: AgentInstance;
}

export interface AdminAgent {
  userId: number;
  username: string;
  userStatus?: UserStatus;
  token: AgentToken;
}

export interface Quote {
  quoteNo: string;
  ticketInfo: {
    movieName?: string;
    cinemaName?: string;
    showTime?: string;
    hallName?: string;
    seats?: string[];
    seatCount?: number;
  };
  upstreamPrice: number;
  finalPrice: number;
  totalPrice: number;
  profit: number;
  status: string;
}

export interface Order {
  orderNo: string;
  quoteNo: string;
  customerId: string;
  totalPrice: number;
  upstreamOrderNo?: string;
  ticketCodeInfo?: string;
  status: string;
  statusText: string;
  terminal: boolean;
  shouldPoll: boolean;
  lastSubmitError?: string;
  lastSyncError?: string;
}

export interface UpstreamAccount {
  configured: boolean;
  provider?: string;
  username?: string;
  status?: "CONFIGURED" | "ACTIVE" | "ERROR" | "DISABLED";
  lastLoginAt?: string;
  lastError?: string;
  updatedAt?: string;
  encryptionConfigured: boolean;
}

export interface ReplyConfig {
  configKey: string;
  templates: Record<string, string>;
  keywordRules: unknown[];
  textFallbackEnabled: boolean;
  updatedAt?: string;
}

export interface JobTask {
  id: number;
  userId?: number;
  taskType: string;
  businessKey: string;
  status: string;
  attemptCount: number;
  nextRunAt?: string;
  lockedBy?: string;
  lockedUntil?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: number;
  actorUserId?: number;
  targetUserId?: number;
  action: string;
  resourceType?: string;
  resourceId?: string;
  beforeJson?: string;
  afterJson?: string;
  ipAddress?: string;
  createdAt: string;
}
