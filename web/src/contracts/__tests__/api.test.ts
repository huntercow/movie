import { afterEach, describe, expect, it, vi } from "vitest";
import { api, decodeApiEnvelope } from "../../api";

describe("ApiResponse contract", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("accepts exactly the defined success envelope", () => {
    expect(decodeApiEnvelope({ success: true, message: "ok", data: { ready: true } })).toEqual({
      success: true,
      message: "ok",
      data: { ready: true }
    });
  });

  it.each([
    ["missing success", { message: "ok", data: null }],
    ["wrong success type", { success: "true", message: "ok", data: null }],
    ["empty message", { success: true, message: "", data: null }],
    ["missing data", { success: true, message: "ok" }],
    ["unknown field", { success: true, message: "ok", data: null, result: null }]
  ])("rejects %s without guessing a fallback shape", (_name, value) => {
    expect(() => decodeApiEnvelope(value)).toThrow(/协议错误/);
  });

  it("clears both session credentials before parsing a malformed 401 response", async () => {
    sessionStorage.setItem("accessToken", "access-token-placeholder");
    sessionStorage.setItem("currentUser", JSON.stringify({ id: 1 }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 401 })));

    await expect(api("/api/v1/app/account/me", {}, (value) => value)).rejects.toThrow(/JSON/);
    expect(sessionStorage.getItem("accessToken")).toBeNull();
    expect(sessionStorage.getItem("currentUser")).toBeNull();
  });

  it("clears credentials and exposes the defined error message for a valid 401 envelope", async () => {
    sessionStorage.setItem("accessToken", "access-token-placeholder");
    sessionStorage.setItem("currentUser", JSON.stringify({ id: 1 }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, message: "登录已失效", data: null }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      }))
    );

    await expect(api("/api/v1/app/account/me", {}, (value) => value)).rejects.toThrow("登录已失效");
    expect(sessionStorage.getItem("accessToken")).toBeNull();
    expect(sessionStorage.getItem("currentUser")).toBeNull();
  });
});
