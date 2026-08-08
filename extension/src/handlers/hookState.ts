export interface HookSettings {
  schemaVersion: 1;
  enabled: boolean;
}

export const HOOK_SETTINGS_STORAGE_KEY = "xianyuHookSettingsV1";

const HOOK_SETTINGS_KEYS = ["schemaVersion", "enabled"] as const;

export function createDefaultHookSettings(): HookSettings {
  return {
    schemaVersion: 1,
    enabled: false
  };
}

export function decodeHookSettings(value: unknown): HookSettings {
  const settings = record(value, "hook settings");
  exactKeys(settings, HOOK_SETTINGS_KEYS, "hook settings");
  if (settings.schemaVersion !== 1) {
    throw new Error("hook settings schemaVersion must be 1");
  }
  return {
    schemaVersion: 1,
    enabled: booleanValue(settings.enabled, "hook settings enabled")
  };
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], context: string): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(`${context} has unknown field ${key}`);
    }
  }
  for (const key of keys) {
    if (!(key in value)) {
      throw new Error(`${context} is missing ${key}`);
    }
  }
}

function booleanValue(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${context} must be a boolean`);
  }
  return value;
}
