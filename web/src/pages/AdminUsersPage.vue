<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { KeyRound, Plus, RefreshCw, UserRound, UserX } from "lucide-vue-next";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, jsonBody } from "../api";
import { formatDateTime, statusType } from "../format";
import type { UserView } from "../types";
import { decodeArray, decodeUserView } from "../contracts";

const rows = ref<UserView[]>([]);
const loading = ref(false);
const createOpen = ref(false);
const createForm = reactive({ username: "", initialPassword: "" });

async function load() {
  loading.value = true;
  try { rows.value = await api<UserView[]>("/api/v1/admin/users", {}, decodeArray(decodeUserView)); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "加载失败"); }
  finally { loading.value = false; }
}

async function createUser() {
  try {
    await api("/api/v1/admin/users", { method: "POST", ...jsonBody(createForm) }, decodeUserView);
    ElMessage.success("用户已创建");
    createOpen.value = false;
    Object.assign(createForm, { username: "", initialPassword: "" });
    await load();
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : "创建失败"); }
}

async function toggleStatus(row: UserView) {
  const status = row.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  await ElMessageBox.confirm(`确认将用户 ${row.username} 设置为 ${status}？`, "账号状态");
  await api(`/api/v1/admin/users/${row.id}/status`, { method: "PUT", ...jsonBody({ status }) }, decodeUserView);
  ElMessage.success("账号状态已更新");
  await load();
}

async function resetPassword(row: UserView) {
  const { value } = await ElMessageBox.prompt(`为 ${row.username} 设置新的初始密码。`, "重置密码", {
    inputType: "password",
    inputPattern: /^.{10,100}$/,
    inputErrorMessage: "密码长度必须为 10 至 100 位"
  });
  await api(`/api/v1/admin/users/${row.id}/reset-password`, { method: "POST", ...jsonBody({ initialPassword: value }) }, decodeUserView);
  ElMessage.success("密码已重置，用户下次登录后必须修改");
  await load();
}

onMounted(load);
</script>

<template>
  <div class="page-stack">
    <div class="page-heading"><div><h1>用户管理</h1><p>创建、停用用户以及重置登录密码</p></div><div class="heading-actions"><el-button :icon="RefreshCw" circle title="刷新" @click="load" /><el-button type="primary" @click="createOpen=true"><Plus :size="17" />创建用户</el-button></div></div>
    <el-table v-loading="loading" :data="rows" class="desktop-data-table" empty-text="暂无用户">
      <el-table-column label="用户" min-width="180"><template #default="{ row }"><div class="cell-stack"><strong>{{ row.username }}</strong><small>ID {{ row.id }} · {{ row.role === 'ADMIN' ? '管理员' : '普通用户' }}</small></div></template></el-table-column>
      <el-table-column label="账号状态" width="120"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag></template></el-table-column>
      <el-table-column label="密码状态" min-width="150"><template #default="{ row }">{{ row.mustChangePassword ? '等待用户修改初始密码' : '正常' }}</template></el-table-column>
      <el-table-column label="最近登录" min-width="180"><template #default="{ row }">{{ formatDateTime(row.lastLoginAt) }}</template></el-table-column>
      <el-table-column label="操作" width="110" fixed="right"><template #default="{ row }"><el-button link :icon="KeyRound" title="重置密码" :disabled="row.role === 'ADMIN'" @click="resetPassword(row)" /><el-button link :type="row.status === 'ACTIVE' ? 'danger' : 'success'" :icon="UserX" :title="row.status === 'ACTIVE' ? '停用账号' : '恢复账号'" :disabled="row.role === 'ADMIN'" @click="toggleStatus(row)" /></template></el-table-column>
    </el-table>
    <div v-loading="loading" class="mobile-data-list">
      <article v-for="row in rows" :key="row.id" class="mobile-data-card">
        <div class="mobile-card-head"><div><span class="mobile-card-icon blue"><UserRound :size="18" /></span><div><strong>{{ row.username }}</strong><small>ID {{ row.id }} · {{ row.role === 'ADMIN' ? '管理员' : '普通用户' }}</small></div></div><el-tag :type="statusType(row.status)" effect="light">{{ row.status }}</el-tag></div>
        <dl><div><dt>密码状态</dt><dd>{{ row.mustChangePassword ? '等待首次修改' : '正常' }}</dd></div><div><dt>最近登录</dt><dd>{{ formatDateTime(row.lastLoginAt) }}</dd></div></dl>
        <div v-if="row.role !== 'ADMIN'" class="mobile-card-actions"><el-button plain :icon="KeyRound" @click="resetPassword(row)">重置密码</el-button><el-button plain :type="row.status === 'ACTIVE' ? 'danger' : 'success'" :icon="UserX" @click="toggleStatus(row)">{{ row.status === 'ACTIVE' ? '停用' : '恢复' }}</el-button></div>
      </article>
      <div v-if="!rows.length && !loading" class="mobile-empty"><UserRound :size="24" /><span>暂无用户</span></div>
    </div>

    <el-dialog v-model="createOpen" title="创建用户" width="min(480px, 92vw)">
      <el-form label-position="top"><el-form-item label="用户名"><el-input v-model="createForm.username" /></el-form-item><el-form-item label="初始密码"><el-input v-model="createForm.initialPassword" type="password" show-password /></el-form-item></el-form>
      <el-alert title="用户首次登录后必须修改初始密码。" type="info" show-icon :closable="false" />
      <template #footer><el-button @click="createOpen=false">取消</el-button><el-button type="primary" @click="createUser">创建用户</el-button></template>
    </el-dialog>
  </div>
</template>
