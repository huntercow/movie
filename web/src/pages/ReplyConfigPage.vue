<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { RefreshCw, Save } from "lucide-vue-next";
import { ElMessage } from "element-plus";
import { api, jsonBody } from "../api";
import { formatDateTime } from "../format";
import type { ReplyConfig } from "../types";
import { decodeReplyConfig } from "../contracts";

const loading = ref(false);
const updatedAt = ref("");
const form = reactive({ templates: "{}", keywordRules: "[]", textFallbackEnabled: false });
async function load() { loading.value = true; try { const data = await api<ReplyConfig>("/api/v1/app/reply-config", {}, decodeReplyConfig); form.templates = JSON.stringify(data.templates, null, 2); form.keywordRules = JSON.stringify(data.keywordRules, null, 2); form.textFallbackEnabled = data.textFallbackEnabled; updatedAt.value = data.updatedAt ?? ""; } catch (e) { ElMessage.error(e instanceof Error ? e.message : "加载失败"); } finally { loading.value = false; } }
async function save() { try { const payload = { templates: JSON.parse(form.templates), keywordRules: JSON.parse(form.keywordRules), textFallbackEnabled: form.textFallbackEnabled }; const data = await api<ReplyConfig>("/api/v1/app/reply-config", { method: "PUT", ...jsonBody(payload) }, decodeReplyConfig); updatedAt.value = data.updatedAt ?? ""; ElMessage.success("话术配置已保存"); } catch (e) { ElMessage.error(e instanceof SyntaxError ? "JSON 格式不正确" : e instanceof Error ? e.message : "保存失败"); } }
onMounted(load);
</script>

<template><div class="page-stack"><div class="page-heading"><div><h1>话术配置</h1><p>当前用户的闲鱼自动回复模板和关键词规则</p></div><div class="heading-actions"><span class="muted">更新于 {{ formatDateTime(updatedAt) }}</span><el-button :icon="RefreshCw" circle title="重新加载" @click="load" /><el-button type="primary" @click="save"><Save :size="17" />保存</el-button></div></div>
  <div class="editor-grid"><section><div class="section-title"><div><h2>业务话术</h2><p>JSON 对象，键为话术名称</p></div></div><el-input v-model="form.templates" type="textarea" :rows="20" class="code-editor" /></section><section><div class="section-title"><div><h2>关键词规则</h2><p>JSON 数组，按优先级匹配</p></div></div><el-input v-model="form.keywordRules" type="textarea" :rows="20" class="code-editor" /></section></div>
  <el-checkbox v-model="form.textFallbackEnabled">未命中关键词时发送默认流程话术</el-checkbox>
</div></template>
