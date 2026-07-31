<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowRight, Bot, Clock3, KeyRound, MessageSquareText, MonitorSmartphone, ShoppingBag, Ticket } from "lucide-vue-next";
import { api } from "../api";
import { decodeAgentToken, decodeArray, decodeUpstreamAccount } from "../contracts";
import { auth } from "../auth";
import type { AgentToken, UpstreamAccount } from "../types";

const router = useRouter();
const agents = ref<AgentToken[]>([]);
const upstream = ref<UpstreamAccount | null>(null);
const onlineAgents = computed(() => agents.value.filter((item) => item.instance?.status === "ONLINE").length);
const pendingTokens = computed(() => agents.value.filter((item) => item.status === "PENDING").length);
const currentXianyuAccounts = computed(() => new Set(agents.value
  .filter((item) => item.agentType === "XIANYU_PLUGIN" && item.instance?.currentXianyuAccountId)
  .map((item) => item.instance!.currentXianyuAccountId)).size);
const quickActions = [
  { label: "创建客户端 Token", description: "创建插件或机器人凭证", path: "/app/agents", icon: MonitorSmartphone, tone: "blue" },
  { label: "查看当前闲鱼账号", description: "由插件自动检测登录账号", path: "/app/agents", icon: ShoppingBag, tone: "amber" },
  { label: "发起人工报价", description: "上传票面截图进行询价", path: "/app/quotes", icon: Ticket, tone: "green" },
  { label: "维护回复话术", description: "编辑关键词和业务模板", path: "/app/reply-config", icon: MessageSquareText, tone: "violet" }
];

onMounted(async () => {
  await auth.refresh();
  const values = await Promise.allSettled([
    api<AgentToken[]>("/api/v1/app/agents", {}, decodeArray(decodeAgentToken)),
    api<UpstreamAccount>("/api/v1/app/upstream-account", {}, decodeUpstreamAccount)
  ]);
  if (values[0].status === "fulfilled") agents.value = values[0].value;
  if (values[1].status === "fulfilled") upstream.value = values[1].value;
});
</script>

<template>
  <div class="page-stack">
    <div class="page-heading"><div><h1>工作台</h1><p>客户端、闲鱼登录和上游连接状态</p></div><el-button plain @click="router.push('/app/account')">账号详情<ArrowRight :size="16" /></el-button></div>
    <el-alert v-if="auth.state.user?.mustChangePassword" title="首次登录必须修改初始密码，之后才能执行业务操作。" type="warning" show-icon :closable="false"><template #default><el-button link type="warning" @click="router.push('/app/account')">去修改</el-button></template></el-alert>
    <div class="metric-grid">
      <div class="metric"><span class="metric-icon blue"><Bot :size="22" /></span><div><span>在线客户端</span><strong>{{ onlineAgents }}</strong><small>共 {{ agents.length }} 个 Token</small></div></div>
      <div class="metric"><span class="metric-icon amber"><Clock3 :size="22" /></span><div><span>待设置有效期</span><strong>{{ pendingTokens }}</strong><small>由管理员处理</small></div></div>
      <div class="metric"><span class="metric-icon green"><ShoppingBag :size="22" /></span><div><span>当前闲鱼账号</span><strong>{{ currentXianyuAccounts }}</strong><small>由插件自动检测</small></div></div>
      <div class="metric"><span class="metric-icon violet"><KeyRound :size="22" /></span><div><span>良票上游</span><strong class="metric-text">{{ upstream?.configured ? '已配置' : '未配置' }}</strong><small>{{ upstream?.status || '等待绑定' }}</small></div></div>
    </div>
    <div class="dashboard-grid">
      <section class="vben-card">
        <div class="card-header"><div><h2>Token 状态</h2><p>客户端凭证及有效状态</p></div><el-button link type="primary" @click="router.push('/app/agents')">查看全部<ArrowRight :size="14" /></el-button></div>
        <div class="token-summary"><div><span>浏览器插件</span><strong>{{ agents.filter(a => a.agentType === 'XIANYU_PLUGIN').length }}</strong></div><div><span>微信机器人</span><strong>{{ agents.filter(a => a.agentType === 'WECHAT_BOT').length }}</strong></div><div><span>待审批</span><strong>{{ pendingTokens }}</strong></div><div><span>已过期</span><strong>{{ agents.filter(a => a.status === 'EXPIRED').length }}</strong></div></div>
      </section>
      <section class="vben-card">
        <div class="card-header"><div><h2>快捷操作</h2><p>常用配置和业务入口</p></div></div>
        <div class="quick-list"><button v-for="item in quickActions" :key="item.label" type="button" @click="router.push(item.path)"><span :class="['quick-icon', item.tone]"><component :is="item.icon" :size="19" /></span><span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span><ArrowRight :size="16" /></button></div>
      </section>
    </div>
    <div class="dashboard-grid dashboard-lower">
      <section class="vben-card">
        <div class="card-header"><div><h2>接入状态</h2><p>关键业务连接</p></div></div>
        <div class="connection-list">
          <div><span class="connection-icon blue"><MonitorSmartphone :size="18" /></span><span><strong>客户端接入</strong><small>{{ onlineAgents }} 个在线安装</small></span><el-tag :type="onlineAgents ? 'success' : 'info'" effect="light">{{ onlineAgents ? '运行中' : '待接入' }}</el-tag></div>
          <div><span class="connection-icon green"><KeyRound :size="18" /></span><span><strong>良票上游</strong><small>{{ upstream?.username || '尚未保存账号' }}</small></span><el-tag :type="upstream?.status === 'ACTIVE' ? 'success' : 'warning'" effect="light">{{ upstream?.status || '未配置' }}</el-tag></div>
          <div><span class="connection-icon amber"><ShoppingBag :size="18" /></span><span><strong>闲鱼当前登录</strong><small>{{ currentXianyuAccounts }} 个账号已检测</small></span><el-tag :type="currentXianyuAccounts ? 'success' : 'info'" effect="light">{{ currentXianyuAccounts ? '已检测' : '等待插件上报' }}</el-tag></div>
        </div>
      </section>
      <section class="vben-card">
        <div class="card-header"><div><h2>最近客户端</h2><p>Token 激活与安装状态</p></div></div>
        <div class="recent-agent-list">
          <div v-for="agent in agents.slice(0, 4)" :key="agent.id"><span :class="['agent-state-dot', { online: agent.instance?.status === 'ONLINE' }]" /><span><strong>{{ agent.instance?.instanceName || (agent.agentType === 'XIANYU_PLUGIN' ? '未激活插件' : '未激活机器人') }}</strong><small>{{ agent.tokenPrefix }}... · {{ agent.instance?.currentXianyuNickname || agent.instance?.currentXianyuAccountId || '等待激活' }}</small></span><b>{{ agent.instance?.status || agent.status }}</b></div>
          <div v-if="!agents.length" class="resource-empty"><MonitorSmartphone :size="20" /><span>尚未创建客户端 Token</span></div>
        </div>
      </section>
    </div>
  </div>
</template>
