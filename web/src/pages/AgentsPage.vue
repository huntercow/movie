<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Copy, Link2Off, MonitorSmartphone, Plus, RefreshCw, ShieldX } from "lucide-vue-next";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, jsonBody } from "../api";
import { formatDateTime, statusType } from "../format";
import type { AgentToken, AgentType } from "../types";
import { decodeAgentToken, decodeArray, decodeCreatedAgentToken } from "../contracts";

const loading = ref(false);
const rows = ref<AgentToken[]>([]);
const createOpen = ref(false);
const createdToken = ref("");
const createdOpen = ref(false);
const agentType = ref<AgentType>("XIANYU_PLUGIN");

async function load() {
  loading.value = true;
  try { rows.value = await api<AgentToken[]>("/api/v1/app/agents", {}, decodeArray(decodeAgentToken)); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "加载失败"); }
  finally { loading.value = false; }
}

async function createToken() {
  try {
    const result = await api<{ token: string; details: AgentToken }>("/api/v1/app/agents/tokens", { method: "POST", ...jsonBody({ agentType: agentType.value }) }, decodeCreatedAgentToken);
    createdToken.value = result.token;
    createOpen.value = false;
    createdOpen.value = true;
    await load();
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "创建失败"); }
}

async function unbind(row: AgentToken) {
  await ElMessageBox.confirm("解绑后，当前安装将立即失去访问权限，Token 可以在另一安装重新激活。", "确认解绑", { type: "warning" });
  await api(`/api/v1/app/agents/tokens/${row.id}/unbind`, { method: "POST" }, decodeAgentToken);
  ElMessage.success("已解绑"); await load();
}

async function revoke(row: AgentToken) {
  await ElMessageBox.confirm("吊销后此 Token 永久不可再使用。", "确认吊销", { type: "error" });
  await api(`/api/v1/app/agents/tokens/${row.id}/revoke`, { method: "POST" }, decodeAgentToken);
  ElMessage.success("已吊销"); await load();
}

async function copyToken() {
  await navigator.clipboard.writeText(createdToken.value);
  ElMessage.success("Token 已复制");
}

onMounted(load);
</script>

<template>
  <div class="page-stack">
    <div class="page-heading"><div><h1>客户端与 Token</h1><p>自行创建 Token，管理员设置有效期后才能激活</p></div><div class="heading-actions"><el-button :icon="RefreshCw" circle title="刷新" @click="load" /><el-button type="primary" @click="createOpen = true"><Plus :size="17" />创建 Token</el-button></div></div>
    <el-table v-loading="loading" :data="rows" class="desktop-data-table" empty-text="尚未创建 Token">
      <el-table-column label="类型" min-width="125"><template #default="{ row }">{{ row.agentType === 'XIANYU_PLUGIN' ? '闲鱼插件' : '微信机器人' }}</template></el-table-column>
      <el-table-column label="Token" min-width="130"><template #default="{ row }"><code>{{ row.tokenPrefix }}...</code></template></el-table-column>
      <el-table-column label="状态" width="105"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag></template></el-table-column>
      <el-table-column label="绑定安装" min-width="210"><template #default="{ row }"><div v-if="row.instance" class="cell-stack"><strong>{{ row.instance.instanceName || row.instance.installationId }}</strong><small>{{ row.instance.clientVersion || '未知版本' }} · {{ row.instance.status }}</small></div><span v-else class="muted">未激活</span></template></el-table-column>
      <el-table-column label="当前闲鱼账号" min-width="190"><template #default="{ row }"><div v-if="row.agentType === 'XIANYU_PLUGIN' && row.instance?.currentXianyuAccountId" class="cell-stack"><strong>{{ row.instance.currentXianyuNickname || row.instance.currentXianyuAccountId }}</strong><small v-if="row.instance.currentXianyuNickname">{{ row.instance.currentXianyuAccountId }}</small></div><span v-else class="muted">{{ row.agentType === 'XIANYU_PLUGIN' ? '等待插件检测' : '-' }}</span></template></el-table-column>
      <el-table-column label="最近使用" min-width="165"><template #default="{ row }">{{ formatDateTime(row.lastUsedAt) }}</template></el-table-column>
      <el-table-column label="到期时间" min-width="165"><template #default="{ row }">{{ formatDateTime(row.expiresAt) }}</template></el-table-column>
      <el-table-column label="操作" width="112" fixed="right"><template #default="{ row }"><el-button link :icon="Link2Off" title="解绑安装" :disabled="!row.instance || row.status === 'REVOKED'" @click="unbind(row)" /><el-button link type="danger" :icon="ShieldX" title="吊销 Token" :disabled="row.status === 'REVOKED'" @click="revoke(row)" /></template></el-table-column>
    </el-table>
    <div v-loading="loading" class="mobile-data-list">
      <article v-for="row in rows" :key="row.id" class="mobile-data-card">
        <div class="mobile-card-head"><div><span class="mobile-card-icon blue"><MonitorSmartphone :size="18" /></span><div><strong>{{ row.agentType === 'XIANYU_PLUGIN' ? '闲鱼插件' : '微信机器人' }}</strong><small><code>{{ row.tokenPrefix }}...</code></small></div></div><el-tag :type="statusType(row.status)" effect="light">{{ row.status }}</el-tag></div>
        <dl><div><dt>绑定安装</dt><dd>{{ row.instance?.instanceName || '未激活' }}</dd></div><div><dt>客户端版本</dt><dd>{{ row.instance?.clientVersion || '-' }}</dd></div><div v-if="row.agentType === 'XIANYU_PLUGIN'"><dt>当前闲鱼账号</dt><dd>{{ row.instance?.currentXianyuNickname || row.instance?.currentXianyuAccountId || '等待检测' }}</dd></div><div><dt>最近使用</dt><dd>{{ formatDateTime(row.lastUsedAt) }}</dd></div><div><dt>到期时间</dt><dd>{{ formatDateTime(row.expiresAt) }}</dd></div></dl>
        <div class="mobile-card-actions"><el-button plain :icon="Link2Off" :disabled="!row.instance || row.status === 'REVOKED'" @click="unbind(row)">解绑</el-button><el-button plain type="danger" :icon="ShieldX" :disabled="row.status === 'REVOKED'" @click="revoke(row)">吊销</el-button></div>
      </article>
      <div v-if="!rows.length && !loading" class="mobile-empty"><MonitorSmartphone :size="24" /><span>尚未创建 Token</span></div>
    </div>

    <el-dialog v-model="createOpen" title="创建客户端 Token" width="min(480px, 92vw)">
      <el-form label-position="top"><el-form-item label="客户端类型"><el-segmented v-model="agentType" :options="[{ label: '闲鱼插件', value: 'XIANYU_PLUGIN' }, { label: '微信机器人', value: 'WECHAT_BOT' }]" /></el-form-item></el-form>
      <template #footer><el-button @click="createOpen = false">取消</el-button><el-button type="primary" @click="createToken">创建</el-button></template>
    </el-dialog>
    <el-dialog v-model="createdOpen" title="Token 已创建" width="min(560px, 92vw)" :close-on-click-modal="false">
      <el-alert title="这是 Token 唯一一次完整展示。请妥善保存，并等待管理员设置有效期后再激活客户端。" type="warning" show-icon :closable="false" />
      <div class="secret-value"><code>{{ createdToken }}</code><el-button :icon="Copy" circle title="复制 Token" @click="copyToken" /></div>
      <template #footer><el-button type="primary" @click="createdOpen = false; createdToken = ''">我已保存</el-button></template>
    </el-dialog>
  </div>
</template>
