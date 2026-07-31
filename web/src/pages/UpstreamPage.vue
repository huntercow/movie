<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { LogIn, Save } from "lucide-vue-next";
import { ElMessage } from "element-plus";
import { api, jsonBody } from "../api";
import { formatDateTime, statusType } from "../format";
import type { UpstreamAccount } from "../types";
import { decodeObject, decodeUpstreamAccount } from "../contracts";

const account = ref<UpstreamAccount | null>(null);
const loading = ref(false);
const form = reactive({ provider: "liangpiao-h5", username: "", password: "" });
async function load() { try { account.value = await api("/api/v1/app/upstream-account", {}, decodeUpstreamAccount); if (account.value.username) form.username = account.value.username; } catch (e) { ElMessage.error(e instanceof Error ? e.message : "加载失败"); } }
async function save() { loading.value = true; try { account.value = await api("/api/v1/app/upstream-account", { method: "PUT", ...jsonBody(form) }, decodeUpstreamAccount); form.password = ""; ElMessage.success("账号已加密保存"); } catch (e) { ElMessage.error(e instanceof Error ? e.message : "保存失败"); } finally { loading.value = false; } }
async function login() { loading.value = true; try { await api("/api/v1/app/upstream-account/login", { method: "POST" }, decodeObject); ElMessage.success("上游登录成功"); await load(); } catch (e) { ElMessage.error(e instanceof Error ? e.message : "登录失败"); } finally { loading.value = false; } }
onMounted(load);
</script>

<template><div class="page-stack"><div class="page-heading"><div><h1>良票上游账号</h1><p>当前用户独享的上游登录凭据和会话</p></div><el-tag :type="statusType(account?.status)" effect="plain">{{ account?.status || 'NOT_CONFIGURED' }}</el-tag></div>
  <el-alert v-if="account && !account.encryptionConfigured" title="服务端尚未配置凭据加密密钥，无法保存账号。" type="error" show-icon :closable="false" />
  <section class="form-section"><el-form label-position="top" class="narrow-form"><el-form-item label="上游类型"><el-input v-model="form.provider" disabled /></el-form-item><el-form-item label="登录账号"><el-input v-model="form.username" autocomplete="off" /></el-form-item><el-form-item label="登录密码"><el-input v-model="form.password" type="password" show-password autocomplete="new-password" placeholder="保存时必须重新填写" /></el-form-item><div class="form-actions"><el-button type="primary" :loading="loading" @click="save"><Save :size="17" />加密保存</el-button><el-button :disabled="!account?.configured" :loading="loading" @click="login"><LogIn :size="17" />登录上游</el-button></div></el-form>
    <dl class="detail-list"><div><dt>已保存账号</dt><dd>{{ account?.username || '-' }}</dd></div><div><dt>最近登录</dt><dd>{{ formatDateTime(account?.lastLoginAt) }}</dd></div><div><dt>最近更新</dt><dd>{{ formatDateTime(account?.updatedAt) }}</dd></div><div v-if="account?.lastError"><dt>最近错误</dt><dd class="danger-text">{{ account.lastError }}</dd></div></dl>
  </section>
</div></template>
