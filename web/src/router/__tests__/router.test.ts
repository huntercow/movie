import { afterEach, describe, expect, it } from "vitest";
import { auth } from "../../auth";
import router from "../../router";

const user = {
  id: 7,
  username: "business-user",
  role: "USER" as const,
  status: "ACTIVE" as const,
  mustChangePassword: false,
  lastLoginAt: undefined
};

const admin = { ...user, id: 8, username: "admin", role: "ADMIN" as const };

describe("workspace route isolation", () => {
  afterEach(async () => {
    sessionStorage.clear();
    auth.state.user = null;
    await router.push("/login");
  });

  it("redirects unauthenticated direct access to login", async () => {
    auth.state.user = null;
    await router.push("/admin/users");

    expect(router.currentRoute.value.path).toBe("/login");
  });

  it("keeps a business user out of admin routes", async () => {
    sessionStorage.setItem("accessToken", "session-token-placeholder");
    auth.state.user = user;
    await router.push("/admin/users");

    expect(router.currentRoute.value.path).toBe("/app/dashboard");
  });

  it("keeps an administrator out of business routes", async () => {
    sessionStorage.setItem("accessToken", "session-token-placeholder");
    auth.state.user = admin;
    await router.push("/app/orders");

    expect(router.currentRoute.value.path).toBe("/admin/users");
  });
});
