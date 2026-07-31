export interface ApiEnvelope {
  success: boolean;
  message: string;
  data: unknown;
}

const API_ROOT = import.meta.env.VITE_API_ROOT || "";

export type Decoder<T> = (value: unknown, context: string) => T;

export async function api<T>(path: string, options: RequestInit, decoder: Decoder<T>): Promise<T> {
  const token = sessionStorage.getItem("accessToken");
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error("无法连接后端服务，请确认后端已启动并检查接口地址", { cause: error });
  }

  if (response.status === 401) {
    sessionStorage.removeItem("accessToken");
    sessionStorage.removeItem("currentUser");
  }

  const responseText = await response.text();
  if (!responseText) {
    throw new Error(`后端返回了空响应 (${response.status})`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`后端响应不是有效 JSON (${response.status})`, { cause: error });
  }
  const envelope = decodeApiEnvelope(payload);
  if (!response.ok) {
    if (envelope.success) {
      throw new Error(`协议错误：HTTP ${response.status} 响应不能标记为成功`);
    }
    throw new Error(envelope.message);
  }
  if (!envelope.success) {
    throw new Error(envelope.message);
  }
  return decoder(envelope.data, `${path} response data`);
}

export function decodeApiEnvelope(value: unknown): ApiEnvelope {
  if (!isRecord(value)) {
    throw new Error("协议错误：响应必须是 JSON 对象");
  }
  if (typeof value.success !== "boolean") {
    throw new Error("协议错误：响应 success 必须是布尔值");
  }
  if (typeof value.message !== "string" || value.message.length === 0) {
    throw new Error("协议错误：响应 message 必须是非空字符串");
  }
  if (!Object.prototype.hasOwnProperty.call(value, "data")) {
    throw new Error("协议错误：响应缺少 data 字段");
  }
  const unknownKeys = Object.keys(value).filter((key) => !["success", "message", "data"].includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`协议错误：响应包含未定义字段 ${unknownKeys.join(", ")}`);
  }
  return { success: value.success, message: value.message, data: value.data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonBody(value: unknown): Pick<RequestInit, "body"> {
  return { body: JSON.stringify(value) };
}
