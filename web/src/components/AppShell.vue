<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Activity, ChevronDown, ChevronLeft, ClipboardList, Home, KeyRound,
  LogOut, Menu, MessageSquareText, MonitorSmartphone, Settings,
  ShieldCheck, Ticket, UserCog, Users
} from "lucide-vue-next";
import { auth } from "../auth";

const route = useRoute();
const router = useRouter();
const collapsed = ref(false);
const mobileOpen = ref(false);
const isAdmin = computed(() => auth.state.user?.role === "ADMIN");

const userItems = [
  { path: "/app/dashboard", label: "工作台", icon: Activity },
  { path: "/app/agents", label: "客户端与 Token", icon: MonitorSmartphone },
  { path: "/app/upstream", label: "良票账号", icon: KeyRound },
  { path: "/app/quotes", label: "报价", icon: Ticket },
  { path: "/app/orders", label: "订单", icon: ClipboardList },
  { path: "/app/reply-config", label: "话术配置", icon: MessageSquareText },
  { path: "/app/account", label: "账号安全", icon: Settings }
];

const adminItems = [
  { path: "/admin/users", label: "用户与授权", icon: Users },
  { path: "/admin/tokens", label: "Token 有效期", icon: MonitorSmartphone },
  { path: "/admin/audit", label: "操作审计", icon: ShieldCheck },
  { path: "/admin/account", label: "账号安全", icon: Settings }
];

const allItems = computed(() => isAdmin.value ? adminItems : userItems);
const currentItem = computed(() => allItems.value.find((item) => item.path === route.path) || allItems.value[0]);
const currentSection = computed(() => route.path.startsWith("/admin/") ? "平台管理" : "用户工作区");
const today = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date());

async function logout() {
  await auth.logout();
  await router.replace("/login");
}


async function handleUserCommand(command: string) {
  if (command === "account") await router.push(isAdmin.value ? "/admin/account" : "/app/account");
  if (command === "logout") await logout();
}
</script>

<template>
  <div class="app-shell">
    <div v-if="mobileOpen" class="mobile-scrim" @click="mobileOpen = false" />
    <aside :class="['sidebar', { collapsed, 'mobile-open': mobileOpen }]">
      <div class="brand-row">
        <div class="brand-mark"><Ticket :size="19" /></div>
        <div v-if="!collapsed" class="brand-copy"><strong>闲鱼影票助手</strong><span>自动报价与履约</span></div>
      </div>
      <nav class="nav-list">
        <span v-if="!collapsed" class="nav-caption">{{ isAdmin ? '平台管理' : '用户工作区' }}</span>
        <router-link v-for="item in allItems" :key="item.path" :to="item.path" :class="['nav-item', { active: route.path === item.path }]" @click="mobileOpen = false">
          <component :is="item.icon" :size="18" /><span v-if="!collapsed">{{ item.label }}</span>
        </router-link>
      </nav>
      <button class="collapse-button" type="button" title="收起导航" @click="collapsed = !collapsed"><ChevronLeft :size="18" :class="{ rotated: collapsed }" /></button>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <button class="mobile-menu" type="button" title="打开导航" @click="mobileOpen = true"><Menu :size="20" /></button>
        <div class="page-context"><strong>{{ currentItem.label }}</strong><span>{{ currentSection }} / {{ today }}</span></div>
        <div class="topbar-spacer" />
        <el-dropdown trigger="click" @command="handleUserCommand">
          <button class="user-trigger" type="button">
            <span class="avatar">{{ auth.state.user?.username?.slice(0, 1).toUpperCase() }}</span>
            <span class="user-copy"><strong>{{ auth.state.user?.username }}</strong><small>{{ isAdmin ? "平台管理员" : "业务用户" }}</small></span>
            <ChevronDown :size="15" />
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="account"><UserCog :size="16" />账号安全</el-dropdown-item>
              <el-dropdown-item command="logout" divided><LogOut :size="16" />退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>
      <div class="tabs-bar"><div class="page-tab active"><Home v-if="route.path.endsWith('/dashboard')" :size="14" /><component v-else :is="currentItem.icon" :size="14" /><span>{{ currentItem.label }}</span></div></div>
      <main class="page-area"><router-view v-slot="{ Component }"><transition name="page-fade" mode="out-in"><component :is="Component" :key="route.path" /></transition></router-view></main>
    </div>
  </div>
</template>
