export const CAPTURE_SCENARIOS = ["TEXT", "IMAGE", "WAIT_PAYMENT", "PAID", "OTHER"] as const;
export const CAPTURE_ACTIONS = ["START", "STOP", "CLEAR", "STATUS", "EXPORT"] as const;
export const CAPTURE_STATES = ["EMPTY", "CAPTURING", "STOPPED", "EXPORTED", "ERROR"] as const;
export const CAPTURE_TRANSPORTS = ["JSON", "SYNC_PUSH_MSGPACK"] as const;

export type CaptureScenario = typeof CAPTURE_SCENARIOS[number];
export type CaptureAction = typeof CAPTURE_ACTIONS[number];
export type CaptureState = typeof CAPTURE_STATES[number];
export type CaptureTransport = typeof CAPTURE_TRANSPORTS[number];

export type CaptureCommand =
  | { action: "START"; scenario: CaptureScenario }
  | { action: Exclude<CaptureAction, "START">; scenario?: never };

export interface CaptureStatus {
  state: CaptureState;
  scenario: CaptureScenario | null;
  recordCount: number;
  byteCount: number;
  startedAt: string | null;
  stoppedAt: string | null;
  lastError: string | null;
}

export type CaptureJsonValue =
  | null
  | boolean
  | number
  | string
  | CaptureJsonValue[]
  | { [key: string]: CaptureJsonValue };

export interface DecodedSocketFrame {
  transport: CaptureTransport;
  payload: unknown;
}

export interface CaptureRecord {
  sequence: number;
  receivedAt: string;
  transport: CaptureTransport;
  payload: CaptureJsonValue;
}

export interface CaptureDocument {
  schemaVersion: 1;
  scenario: CaptureScenario;
  startedAt: string;
  stoppedAt: string;
  exportedAt: string;
  records: CaptureRecord[];
}

export interface CaptureExport {
  fileName: string;
  document: CaptureDocument;
  status: CaptureStatus;
}

interface CaptureSessionOptions {
  now?: () => string;
  maxRecords?: number;
  maxBytes?: number;
}

const DEFAULT_MAX_RECORDS = 50;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export function decodeCaptureCommand(value: unknown): CaptureCommand {
  const record = requireRecord(value, "capture command");
  const action = requireEnum(record.action, CAPTURE_ACTIONS, "capture command action");
  if (action === "START") {
    return {
      action,
      scenario: requireEnum(record.scenario, CAPTURE_SCENARIOS, "capture command scenario")
    };
  }
  if (record.scenario !== undefined) {
    throw new Error(`capture command ${action} must not include scenario`);
  }
  return { action };
}

export function decodeCaptureStatus(value: unknown): CaptureStatus {
  const record = requireRecord(value, "capture status");
  return {
    state: requireEnum(record.state, CAPTURE_STATES, "capture status state"),
    scenario: record.scenario === null
      ? null
      : requireEnum(record.scenario, CAPTURE_SCENARIOS, "capture status scenario"),
    recordCount: requireNonNegativeInteger(record.recordCount, "capture status recordCount"),
    byteCount: requireNonNegativeInteger(record.byteCount, "capture status byteCount"),
    startedAt: requireNullableString(record.startedAt, "capture status startedAt"),
    stoppedAt: requireNullableString(record.stoppedAt, "capture status stoppedAt"),
    lastError: requireNullableString(record.lastError, "capture status lastError")
  };
}

export function decodeSocketFrame(
  data: unknown,
  decodeMessagePack: (bytes: Uint8Array) => unknown
): DecodedSocketFrame[] {
  if (typeof data !== "string") {
    throw new Error("xianyu websocket message must be a string");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    throw new Error("xianyu websocket message is not valid JSON", { cause: error });
  }
  const root = requireRecord(parsed, "xianyu websocket JSON root");
  if (!Object.prototype.hasOwnProperty.call(root, "body")) {
    return [{ transport: "JSON", payload: root }];
  }
  if (Array.isArray(root.body)) {
    // 响应帧 body 偶发为数组（如单会话列表）；非业务推送，交由上层
    // decodeXianyuPayload 识别为 IGNORED_RESPONSE 忽略，不再抛错。
    return [{ transport: "JSON", payload: root }];
  }
  const body = requireRecord(root.body, "xianyu websocket body");
  if (!Object.prototype.hasOwnProperty.call(body, "syncPushPackage")) {
    return [{ transport: "JSON", payload: root }];
  }
  const sync = requireRecord(body.syncPushPackage, "xianyu syncPushPackage");
  if (!Array.isArray(sync.data) || sync.data.length === 0) {
    throw new Error("xianyu syncPushPackage data must contain at least one entry");
  }
  return (sync.data as unknown[]).map((entryValue, index) => {
    const entry = requireRecord(entryValue, `xianyu syncPushPackage data[${index}]`);
    if (typeof entry.data !== "string" || !entry.data) {
      throw new Error("xianyu sync package data must be Base64 text");
    }
    let binary: string;
    try {
      binary = atob(entry.data);
    } catch (error) {
      throw new Error("xianyu sync package data is not valid Base64", { cause: error });
    }
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return {
      transport: "SYNC_PUSH_MSGPACK",
      payload: decodeMessagePack(bytes)
    };
  });
}

export function toCaptureJsonValue(
  value: unknown,
  path = "payload",
  seen = new WeakSet<object>()
): CaptureJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} is not JSON-compatible`);
    }
    return value;
  }
  if (value instanceof Uint8Array) {
    let binary = "";
    for (const byte of value) {
      binary += String.fromCharCode(byte);
    }
    return { $binaryBase64: btoa(binary) };
  }
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path} is not JSON-compatible`);
  }
  if (seen.has(value)) {
    throw new Error(`${path} contains a cycle`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => toCaptureJsonValue(item, `${path}[${index}]`, seen));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path} has unsupported object type`);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      toCaptureJsonValue(item, `${path}.${key}`, seen)
    ]));
  } finally {
    seen.delete(value);
  }
}

export class ProtocolCaptureSession {
  private captureState: CaptureState = "EMPTY";
  private scenario: CaptureScenario | null = null;
  private records: CaptureRecord[] = [];
  private byteCount = 0;
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private lastError: string | null = null;
  private readonly now: () => string;
  private readonly maxRecords: number;
  private readonly maxBytes: number;

  constructor(options: CaptureSessionOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    requirePositiveInteger(this.maxRecords, "capture maxRecords");
    requirePositiveInteger(this.maxBytes, "capture maxBytes");
  }

  start(scenario: CaptureScenario): CaptureStatus {
    this.requireState("START", "EMPTY");
    this.captureState = "CAPTURING";
    this.scenario = requireEnum(scenario, CAPTURE_SCENARIOS, "capture scenario");
    this.records = [];
    this.byteCount = 0;
    this.startedAt = this.readNow();
    this.stoppedAt = null;
    this.lastError = null;
    return this.status();
  }

  stop(): CaptureStatus {
    this.requireState("STOP", "CAPTURING");
    this.captureState = "STOPPED";
    this.stoppedAt = this.readNow();
    return this.status();
  }

  clear(): CaptureStatus {
    if (this.captureState === "EMPTY") {
      throw new Error("cannot CLEAR while state is EMPTY");
    }
    this.captureState = "EMPTY";
    this.scenario = null;
    this.records = [];
    this.byteCount = 0;
    this.startedAt = null;
    this.stoppedAt = null;
    this.lastError = null;
    return this.status();
  }

  append(transport: CaptureTransport, payload: unknown): CaptureStatus {
    this.requireState("APPEND", "CAPTURING");
    try {
      const record: CaptureRecord = {
        sequence: this.records.length + 1,
        receivedAt: this.readNow(),
        transport: requireEnum(transport, CAPTURE_TRANSPORTS, "capture transport"),
        payload: toCaptureJsonValue(payload)
      };
      const candidateBytes = utf8JsonSize(record);
      if (this.records.length + 1 > this.maxRecords) {
        return this.fail(`capture record limit ${this.maxRecords} exceeded`);
      }
      if (this.byteCount + candidateBytes > this.maxBytes) {
        return this.fail(`capture byte limit ${this.maxBytes} exceeded`);
      }
      this.records.push(record);
      this.byteCount += candidateBytes;
      return this.status();
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  status(): CaptureStatus {
    return {
      state: this.captureState,
      scenario: this.scenario,
      recordCount: this.records.length,
      byteCount: this.byteCount,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      lastError: this.lastError
    };
  }

  exportDocument(): CaptureExport {
    this.requireState("EXPORT", "STOPPED");
    if (this.records.length === 0) {
      throw new Error("cannot EXPORT an empty session");
    }
    if (this.scenario === null || this.startedAt === null || this.stoppedAt === null) {
      throw new Error("capture session is internally inconsistent");
    }
    const exportedAt = this.readNow();
    const document: CaptureDocument = {
      schemaVersion: 1,
      scenario: this.scenario,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      exportedAt,
      records: this.records.map((record) => ({ ...record }))
    };
    this.captureState = "EXPORTED";
    const fileScenario = this.scenario.toLowerCase().replaceAll("_", "-");
    const fileTimestamp = exportedAt.replaceAll(":", "-");
    return {
      fileName: `xianyu-protocol-${fileScenario}-${fileTimestamp}.json`,
      document,
      status: this.status()
    };
  }

  private requireState(action: string, expected: CaptureState): void {
    if (this.captureState !== expected) {
      throw new Error(`cannot ${action} while state is ${this.captureState}`);
    }
  }

  private fail(message: string): CaptureStatus {
    this.captureState = "ERROR";
    this.lastError = message;
    return this.status();
  }

  private readNow(): string {
    const value = this.now();
    if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) {
      throw new Error("capture clock must return an ISO timestamp");
    }
    return value;
  }
}

export function decodeCaptureExport(value: unknown): CaptureExport {
  const root = requireRecord(value, "capture export");
  const fileName = requireNonEmptyString(root.fileName, "capture export fileName");
  const document = decodeCaptureDocument(root.document);
  const status = decodeCaptureStatus(root.status);
  if (status.state !== "EXPORTED") {
    throw new Error(`capture export status state must be EXPORTED: ${status.state}`);
  }
  if (status.scenario !== document.scenario) {
    throw new Error("capture export scenario does not match status");
  }
  if (status.recordCount !== document.records.length) {
    throw new Error("capture export recordCount does not match records");
  }
  const expectedBytes = document.records.reduce((total, record) => total + utf8JsonSize(record), 0);
  if (status.byteCount !== expectedBytes) {
    throw new Error("capture export byteCount does not match records");
  }
  if (status.startedAt !== document.startedAt || status.stoppedAt !== document.stoppedAt) {
    throw new Error("capture export timestamps do not match status");
  }
  if (status.lastError !== null) {
    throw new Error("capture export EXPORTED status must not contain lastError");
  }
  return { fileName, document, status };
}

function decodeCaptureDocument(value: unknown): CaptureDocument {
  const record = requireRecord(value, "capture document");
  if (record.schemaVersion !== 1) {
    throw new Error(`capture document schemaVersion must be 1: ${String(record.schemaVersion)}`);
  }
  const records = requireArray(record.records, "capture document records").map((item, index) => {
    const entry = requireRecord(item, `capture document records[${index}]`);
    const sequence = requirePositiveInteger(entry.sequence, `capture document records[${index}].sequence`);
    if (sequence !== index + 1) {
      throw new Error(`capture document records[${index}].sequence must be ${index + 1}`);
    }
    return {
      sequence,
      receivedAt: requireTimestamp(entry.receivedAt, `capture document records[${index}].receivedAt`),
      transport: requireEnum(entry.transport, CAPTURE_TRANSPORTS, `capture document records[${index}].transport`),
      payload: toCaptureJsonValue(entry.payload, `capture document records[${index}].payload`)
    };
  });
  return {
    schemaVersion: 1,
    scenario: requireEnum(record.scenario, CAPTURE_SCENARIOS, "capture document scenario"),
    startedAt: requireTimestamp(record.startedAt, "capture document startedAt"),
    stoppedAt: requireTimestamp(record.stoppedAt, "capture document stoppedAt"),
    exportedAt: requireTimestamp(record.exportedAt, "capture document exportedAt"),
    records
  };
}

function utf8JsonSize(value: CaptureJsonValue | CaptureRecord): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("capture value is not JSON-compatible");
  }
  return new TextEncoder().encode(serialized).byteLength;
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${context} must be an array`);
  }
  return value;
}

function requireEnum<T extends string>(value: unknown, values: readonly T[], context: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new Error(`${context} is not defined: ${String(value)}`);
  }
  return value as T;
}

function requireNonNegativeInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${context} must be a non-negative integer`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${context} must be a positive integer`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function requireTimestamp(value: unknown, context: string): string {
  const timestamp = requireNonEmptyString(value, context);
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${context} must be an ISO timestamp`);
  }
  return timestamp;
}

function requireNullableString(value: unknown, context: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value) {
    throw new Error(`${context} must be null or a non-empty string`);
  }
  return value;
}
