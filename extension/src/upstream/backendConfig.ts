/**
 * 后端地址配置:插件连接 FastAPI 后端的 baseUrl,存 chrome.storage.local。
 * 剥离良票后,插件不再直连良票;所有上游操作与报表上报经此后端。
 */

/** chrome.storage.local 的最小读写面(测试可注入假 storage)。 */
export interface KeyValueStorage {
  get(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export const BACKEND_CONFIG_STORAGE_KEY = "backendConfigV1";

/** 后端连接配置:baseUrl 如 http://127.0.0.1:8000(不含尾斜杠)。 */
export interface BackendConfig {
  baseUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 解码存储的配置;结构不合法返回默认(空地址)。 */
export function decodeBackendConfig(value: unknown): BackendConfig {
  if (!isRecord(value)) {
    return { baseUrl: "" };
  }
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";
  return { baseUrl };
}

export async function readBackendConfig(
  storage: KeyValueStorage
): Promise<BackendConfig> {
  const stored = await storage.get(BACKEND_CONFIG_STORAGE_KEY);
  return decodeBackendConfig(stored[BACKEND_CONFIG_STORAGE_KEY]);
}

export async function saveBackendConfig(
  storage: KeyValueStorage,
  config: BackendConfig
): Promise<void> {
  await storage.set({ [BACKEND_CONFIG_STORAGE_KEY]: config });
}

