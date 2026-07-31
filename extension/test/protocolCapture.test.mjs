import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTURE_SCENARIOS,
  ProtocolCaptureSession,
  decodeCaptureCommand,
  decodeCaptureExport,
  decodeCaptureStatus,
  decodeSocketFrame,
  toCaptureJsonValue
} from "../src/protocolCapture.ts";

test("decodeCaptureCommand accepts only defined actions and scenarios", () => {
  assert.deepEqual(decodeCaptureCommand({ action: "START", scenario: "TEXT" }), {
    action: "START",
    scenario: "TEXT"
  });
  assert.throws(
    () => decodeCaptureCommand({ action: "START", scenario: "UNKNOWN" }),
    /capture command scenario is not defined/
  );
  assert.throws(
    () => decodeCaptureCommand({ action: "RETRY" }),
    /capture command action is not defined/
  );
});

test("decodeCaptureStatus rejects incomplete status objects", () => {
  assert.throws(
    () => decodeCaptureStatus({ state: "EMPTY" }),
    /capture status scenario/
  );
});

test("decodeSocketFrame identifies direct JSON without content guessing", () => {
  const decoded = decodeSocketFrame('{"code":200}', () => assert.fail("msgpack must not run"));
  assert.deepEqual(decoded, { transport: "JSON", payload: { code: 200 } });
});

test("decodeSocketFrame decodes the defined syncPushPackage path", () => {
  const encoded = btoa(String.fromCharCode(1, 2, 3));
  const decoded = decodeSocketFrame(JSON.stringify({
    body: { syncPushPackage: { data: [{ data: encoded }] } }
  }), (bytes) => ({ bytes: [...bytes] }));
  assert.deepEqual(decoded, {
    transport: "SYNC_PUSH_MSGPACK",
    payload: { bytes: [1, 2, 3] }
  });
});

test("decodeSocketFrame rejects malformed defined sync packages", () => {
  assert.throws(
    () => decodeSocketFrame('{"body":{"syncPushPackage":{"data":[]}}}', () => ({})),
    /syncPushPackage data must contain exactly one entry/
  );
});

test("toCaptureJsonValue preserves structure and marks binary values", () => {
  assert.deepEqual(toCaptureJsonValue({ nested: [new Uint8Array([1, 2])] }), {
    nested: [{ $binaryBase64: "AQI=" }]
  });
  assert.throws(() => toCaptureJsonValue({ value: undefined }), /is not JSON-compatible/);
});

test("capture scenarios are the five explicitly defined business labels", () => {
  assert.deepEqual(CAPTURE_SCENARIOS, ["TEXT", "IMAGE", "WAIT_PAYMENT", "PAID", "OTHER"]);
});

test("ProtocolCaptureSession follows the explicit capture lifecycle", () => {
  const session = new ProtocolCaptureSession({ now: () => "2026-07-29T00:00:00.000Z" });
  session.start("TEXT");
  session.append("JSON", { code: 200 });
  session.stop();
  const exported = session.exportDocument();
  assert.equal(exported.document.schemaVersion, 1);
  assert.equal(exported.document.scenario, "TEXT");
  assert.equal(exported.document.records.length, 1);
  assert.match(exported.fileName, /^xianyu-protocol-text-2026-07-29T00-00-00\.000Z\.json$/);
  assert.equal(session.status().state, "EXPORTED");
  assert.deepEqual(decodeCaptureExport(exported), exported);
});

test("ProtocolCaptureSession rejects invalid state operations", () => {
  const session = new ProtocolCaptureSession();
  assert.throws(() => session.stop(), /cannot STOP while state is EMPTY/);
  assert.throws(() => session.exportDocument(), /cannot EXPORT while state is EMPTY/);
});

test("ProtocolCaptureSession enters ERROR without truncating when record limit is exceeded", () => {
  const session = new ProtocolCaptureSession({ maxRecords: 1 });
  session.start("IMAGE");
  session.append("JSON", { first: true });
  session.append("JSON", { second: true });
  assert.equal(session.status().state, "ERROR");
  assert.equal(session.status().recordCount, 1);
  assert.match(session.status().lastError, /record limit 1 exceeded/);
});

test("ProtocolCaptureSession enters ERROR without truncating when byte limit is exceeded", () => {
  const session = new ProtocolCaptureSession({ maxBytes: 1 });
  session.start("TEXT");
  session.append("JSON", { content: "more than one byte" });
  assert.equal(session.status().state, "ERROR");
  assert.equal(session.status().recordCount, 0);
  assert.match(session.status().lastError, /byte limit 1 exceeded/);
});

test("ProtocolCaptureSession enters ERROR when payload is not serializable", () => {
  const session = new ProtocolCaptureSession();
  session.start("OTHER");
  session.append("JSON", { invalid: undefined });
  assert.equal(session.status().state, "ERROR");
  assert.equal(session.status().recordCount, 0);
  assert.match(session.status().lastError, /not JSON-compatible/);
});

test("ProtocolCaptureSession refuses to export an empty stopped session", () => {
  const session = new ProtocolCaptureSession();
  session.start("PAID");
  session.stop();
  assert.throws(() => session.exportDocument(), /cannot EXPORT an empty session/);
});

test("decodeCaptureExport rejects an incomplete export document", () => {
  assert.throws(
    () => decodeCaptureExport({ fileName: "sample.json", document: {}, status: {} }),
    /capture document schemaVersion/
  );
});
