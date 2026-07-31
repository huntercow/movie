import { createRouter, createWebHashHistory } from "vue-router";
import { auth } from "./auth";
import LoginPage from "./pages/LoginPage.vue";
import SetupPage from "./pages/SetupPage.vue";
import AppShell from "./components/AppShell.vue";
import DashboardPage from "./pages/DashboardPage.vue";
import AgentsPage from "./pages/AgentsPage.vue";
import UpstreamPage from "./pages/UpstreamPage.vue";
import QuotesPage from "./pages/QuotesPage.vue";
import OrdersPage from "./pages/OrdersPage.vue";
import ReplyConfigPage from "./pages/ReplyConfigPage.vue";
import AccountPage from "./pages/AccountPage.vue";
import AdminUsersPage from "./pages/AdminUsersPage.vue";
import AdminAuditPage from "./pages/AdminAuditPage.vue";
import AdminAgentsPage from "./pages/AdminAgentsPage.vue";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/login", component: LoginPage, meta: { public: true } },
    { path: "/setup", component: SetupPage, meta: { public: true } },
    {
      path: "/",
      component: AppShell,
      children: [
        { path: "", redirect: () => auth.state.user?.role === "ADMIN" ? "/admin/users" : "/app/dashboard" },
        { path: "app/dashboard", component: DashboardPage, meta: { workspace: "user" } },
        { path: "app/agents", component: AgentsPage, meta: { workspace: "user" } },
        { path: "app/upstream", component: UpstreamPage, meta: { workspace: "user" } },
        { path: "app/quotes", component: QuotesPage, meta: { workspace: "user" } },
        { path: "app/orders", component: OrdersPage, meta: { workspace: "user" } },
        { path: "app/reply-config", component: ReplyConfigPage, meta: { workspace: "user" } },
        { path: "app/account", component: AccountPage, meta: { workspace: "user" } },
        { path: "admin/users", component: AdminUsersPage, meta: { workspace: "admin" } },
        { path: "admin/tokens", component: AdminAgentsPage, meta: { workspace: "admin" } },
        { path: "admin/audit", component: AdminAuditPage, meta: { workspace: "admin" } },
        { path: "admin/account", component: AccountPage, meta: { workspace: "admin" } }
      ]
    },
    { path: "/:pathMatch(.*)*", redirect: "/" }
  ]
});

router.beforeEach((to) => {
  if (to.meta.public) return true;
  if (!auth.authenticated.value) return "/login";
  const admin = auth.state.user?.role === "ADMIN";
  if (to.meta.workspace === "admin" && !admin) return "/app/dashboard";
  if (to.meta.workspace === "user" && admin) return "/admin/users";
  return true;
});

export default router;
