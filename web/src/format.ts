export function formatDateTime(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`无效的日期时间：${value}`);
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function money(value?: number): string {
  if (value === undefined) return "-";
  if (!Number.isFinite(value)) throw new Error(`无效金额：${value}`);
  return `¥${value.toFixed(2)}`;
}

export function statusType(status?: string): "success" | "warning" | "danger" | "info" | "primary" {
  if (status === undefined) return "info";
  if (["ACTIVE", "ONLINE", "ISSUED", "SUCCEEDED"].includes(status)) return "success";
  if (["ERROR", "FAILED", "REVOKED", "SUSPENDED", "EXPIRED", "SUBMIT_FAILED"].includes(status)) return "danger";
  if ([
    "PENDING", "UNUSED", "OFFLINE", "RUNNING", "TICKETING", "WAIT_SUBMIT", "SUBMITTING",
    "SUBMITTED", "WAIT_PAY", "PAID"
  ].includes(status)) return "warning";
  if (["CREATED", "ORDERED", "CONFIGURED", "DISABLED"].includes(status)) return "info";
  throw new Error(`未知状态：${status}`);
}
