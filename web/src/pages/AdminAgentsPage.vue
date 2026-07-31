<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { CalendarClock, Clock3, RefreshCw, ShieldX } from "lucide-vue-next";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, jsonBody } from "../api";
import { formatDateTime, statusType } from "../format";
import type { AdminAgent } from "../types";
import { decodeAdminAgent, decodeAgentToken, decodeArray } from "../contracts";

const rows = ref<AdminAgent[]>([]);
const loading = ref(false);
const expiryOpen = ref(false);
const selected = ref<AdminAgent | null>(null);
const expiresAt = ref("");
const pendingCount = computed(() => rows.value.filter((row) => row.token.status === "PENDING").length);

async function load() {
  loading.value = true;
  try { rows.value = await api<AdminAgent[]>("/api/v1/admin/agent-tokens", {}, decodeArray(decodeAdminAgent)); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "加载失败"); }
  finally { loading.value = false; }
}

function editExpiry(row: AdminAgent) {
  selected.value = row;
  expiresAt.value = row.token.expiresAt || "";
  expiryOpen.value = true;
}

async function saveExpiry() {
  if (!selected.value || !expiresAt.value) return void ElMessage.warning("请选择 Token 到期时间");
  try {
    await api(`/api/v1/admin/agent-tokens/${selected.value.token.id}/expiry`, {
      method: "PUT",
      ...jsonBody({ expiresAt: expiresAt.value })
    }, decodeAgentToken);
    ElMessage.success(selected.value.token.status === "PENDING" ? "Token 已审批生效" : "Token 有效期已更新");
    expiryOpen.value = false;
    await load();
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "更新失败"); }
}

async function revoke(row: AdminAgent) {
  await ElMessageBox.confirm(`确认吊销 ${row.username} 的这个 Token？吊销后不可恢复。`, "吊销 Token", { type: "error" });
  await api(`/api/v1/admin/agent-tokens/${row.token.id}/revoke`, { method: "POST" }, decodeAgentToken);
  ElMessage.success("Token 已吊销");
  await load();
}

onMounted(load);
</script>

<template>
  <div class="page-stack">
    <div class="page-heading"><div><h1>Token 有效期</h1><p>用户自行创建 Token，管理员负责审批、续期和吊销</p></div><div class="heading-actions"><el-tag v-if="pendingCount" type="warning" effect="light">{{ pendingCount }} 个待审批</el-tag><el-button :icon="RefreshCw" circle title="刷新" @click="load" /></div></div>
    <el-table v-loading="loading" :data="rows" class="desktop-data-table" empty-text="暂无 Token">
      <el-table-column label="用户" min-width="145"><template #default="{ row }"><div class="cell-stack"><strong>{{ row.username }}</strong><small>ID {{ row.userId }} · {{ row.userStatus || '-' }}</small></div></template></el-table-column>
      <el-table-column label="Token" min-width="170"><template #default="{ row }"><div class="cell-stack"><strong>{{ row.token.agentType === 'XIANYU_PLUGIN' ? '浏览器插件' : '微信机器人' }}</strong><small><code>{{ row.token.tokenPrefix }}...</code></small></div></template></el-table-column>
      <el-table-column label="状态" width="115"><template #default="{ row }"><el-tag :type="statusType(row.token.status)" effect="plain">{{ row.token.status }}</el-tag></template></el-table-column>
      <el-table-column label="到期时间" min-width="175"><template #default="{ row }"><span :class="{ 'danger-text': row.token.status === 'EXPIRED' }">{{ row.token.expiresAt ? formatDateTime(row.token.expiresAt) : '等待管理员设置' }}</span></template></el-table-column>
      <el-table-column label="绑定状态" min-width="180"><template #default="{ row }"><div v-if="row.token.instance" class="cell-stack"><strong>{{ row.token.instance.instanceName || '已绑定客户端' }}</strong><small>{{ row.token.instance.clientVersion || '未知版本' }} · {{ row.token.instance.status }}</small></div><span v-else class="muted">尚未绑定</span></template></el-table-column>
      <el-table-column label="创建时间" min-width="170"><template #default="{ row }">{{ formatDateTime(row.token.createdAt) }}</template></el-table-column>
      <el-table-column label="操作" width="112" fixed="right"><template #default="{ row }"><el-button link :icon="CalendarClock" title="设置有效期" :disabled="row.token.status === 'REVOKED'" @click="editExpiry(row)" /><el-button link type="danger" :icon="ShieldX" title="吊销 Token" :disabled="row.token.status === 'REVOKED'" @click="revoke(row)" /></template></el-table-column>
    </el-table>
    <div v-loading="loading" class="mobile-data-list">
      <article v-for="row in rows" :key="row.token.id" class="mobile-data-card">
        <div class="mobile-card-head"><div><span class="mobile-card-icon amber"><Clock3 :size="18" /></span><div><strong>{{ row.username }}</strong><small>{{ row.token.agentType === 'XIANYU_PLUGIN' ? '浏览器插件' : '微信机器人' }} · {{ row.token.tokenPrefix }}...</small></div></div><el-tag :type="statusType(row.token.status)" effect="light">{{ row.token.status }}</el-tag></div>
        <dl><div><dt>到期时间</dt><dd>{{ row.token.expiresAt ? formatDateTime(row.token.expiresAt) : '等待设置' }}</dd></div><div><dt>绑定状态</dt><dd>{{ row.token.instance?.instanceName || '尚未绑定' }}</dd></div><div><dt>客户端版本</dt><dd>{{ row.token.instance?.clientVersion || '-' }}</dd></div><div><dt>创建时间</dt><dd>{{ formatDateTime(row.token.createdAt) }}</dd></div></dl>
        <div class="mobile-card-actions"><el-button plain :icon="CalendarClock" :disabled="row.token.status === 'REVOKED'" @click="editExpiry(row)">有效期</el-button><el-button plain type="danger" :icon="ShieldX" :disabled="row.token.status === 'REVOKED'" @click="revoke(row)">吊销</el-button></div>
      </article>
      <div v-if="!rows.length && !loading" class="mobile-empty"><Clock3 :size="24" /><span>暂无 Token</span></div>
    </div>

    <el-dialog v-model="expiryOpen" :title="`${selected?.token.status === 'PENDING' ? '审批' : '更新'} Token 有效期`" width="min(480px, 92vw)">
      <el-form label-position="top"><el-form-item label="所属用户"><el-input :model-value="selected?.username" disabled /></el-form-item><el-form-item label="到期时间"><el-date-picker v-model="expiresAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" placeholder="必须晚于当前时间" style="width:100%" /></el-form-item></el-form>
      <el-alert title="到期后插件或机器人携带此 Token 的请求会被后端拒绝。" type="info" show-icon :closable="false" />
      <template #footer><el-button @click="expiryOpen=false">取消</el-button><el-button type="primary" @click="saveExpiry">确认设置</el-button></template>
    </el-dialog>
  </div>
</template>
