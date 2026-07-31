<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { KeyRound } from "lucide-vue-next";
import { ElMessage } from "element-plus";
import { api, jsonBody } from "../api";
import { auth } from "../auth";
import { statusType } from "../format";
import type { UserView } from "../types";
import { decodeUserView } from "../contracts";

const loading = ref(false);
const form = reactive({ currentPassword: "", newPassword: "", confirm: "" });
const user = computed(() => auth.state.user);
async function changePassword() { if (form.newPassword !== form.confirm) return void ElMessage.warning("两次新密码不一致"); if (form.newPassword.length < 10) return void ElMessage.warning("新密码至少 10 位"); loading.value = true; try { const result = await api<UserView>("/api/v1/app/account/change-password", { method: "POST", ...jsonBody({ currentPassword: form.currentPassword, newPassword: form.newPassword }) }, decodeUserView); sessionStorage.setItem("currentUser", JSON.stringify(result)); await auth.refresh(); Object.assign(form, { currentPassword: "", newPassword: "", confirm: "" }); ElMessage.success("密码已修改"); } catch (e) { ElMessage.error(e instanceof Error ? e.message : "修改失败"); } finally { loading.value = false; } }
</script>

<template><div class="page-stack"><div class="page-heading"><div><h1>账号安全</h1><p>登录身份与密码</p></div></div>
  <section class="profile-band"><div><span class="profile-label">用户名</span><strong>{{ user?.username }}</strong></div><div><span class="profile-label">角色</span><strong>{{ user?.role === 'ADMIN' ? '平台管理员' : '普通用户' }}</strong></div><div><span class="profile-label">账号状态</span><el-tag :type="statusType(user?.status)" effect="plain">{{ user?.status }}</el-tag></div></section>
  <section class="plain-section"><div class="section-title"><div><h2>修改密码</h2><p v-if="user?.mustChangePassword" class="danger-text">首次登录必须完成此操作</p><p v-else>建议定期更新登录密码</p></div><KeyRound :size="20" /></div><el-form label-position="top" class="narrow-form"><el-form-item label="当前密码"><el-input v-model="form.currentPassword" type="password" show-password /></el-form-item><el-form-item label="新密码"><el-input v-model="form.newPassword" type="password" show-password /></el-form-item><el-form-item label="确认新密码"><el-input v-model="form.confirm" type="password" show-password @keyup.enter="changePassword" /></el-form-item><el-button type="primary" :loading="loading" @click="changePassword">更新密码</el-button></el-form></section>
</div></template>
