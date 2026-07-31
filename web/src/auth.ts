import { computed, reactive } from "vue";
import type { AuthResponse, UserView } from "./types";
import { api, jsonBody } from "./api";
import { decodeAuthResponse, decodeNull, decodeUserView } from "./contracts";

const saved = sessionStorage.getItem("currentUser");
const state = reactive<{ user: UserView | null }>({
  user: saved ? decodeUserView(JSON.parse(saved), "session currentUser") : null
});

function remember(response: AuthResponse): void {
  sessionStorage.setItem("accessToken", response.accessToken);
  sessionStorage.setItem("currentUser", JSON.stringify(response.user));
  state.user = response.user;
}

export const auth = {
  state,
  authenticated: computed(() => Boolean(state.user && sessionStorage.getItem("accessToken"))),
  async login(username: string, password: string) {
    const response = await api<AuthResponse>("/api/v1/auth/login", {
      method: "POST",
      ...jsonBody({ username, password })
    }, decodeAuthResponse);
    remember(response);
    return response.user;
  },
  async bootstrap(username: string, password: string) {
    const response = await api<AuthResponse>("/api/v1/auth/bootstrap", {
      method: "POST",
      ...jsonBody({ username, password })
    }, decodeAuthResponse);
    remember(response);
    return response.user;
  },
  async refresh() {
    const user = await api<UserView>("/api/v1/app/account/me", {}, decodeUserView);
    sessionStorage.setItem("currentUser", JSON.stringify(user));
    state.user = user;
    return user;
  },
  async logout() {
    try {
      await api<void>("/api/v1/app/account/logout", { method: "POST" }, decodeNull);
    } finally {
      sessionStorage.clear();
      state.user = null;
    }
  }
};
