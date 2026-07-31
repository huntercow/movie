<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { CheckCircle2, Settings2, ShieldCheck, Ticket, Users } from "lucide-vue-next";
import { ElMessage } from "element-plus";
import { api } from "../api";
import { decodeBootstrapStatus } from "../contracts";
import { auth } from "../auth";

const router = useRouter();
const loading = ref(false);
const form = reactive({ username: "admin", password: "", confirm: "" });

onMounted(async () => {
  try {
    const status = await api<{ initialized: boolean }>("/api/v1/auth/bootstrap-status", {}, decodeBootstrapStatus);
    if (status.initialized) await router.replace("/login");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "初始化状态检查失败");
  }
});

async function submit() {
  if (form.password !== form.confirm) return void ElMessage.warning("两次密码不一致");
  if (form.password.length < 10) return void ElMessage.warning("密码至少 10 位");
  loading.value = true;
  try {
    await auth.bootstrap(form.username, form.password);
    await router.replace("/admin/users");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "初始化失败");
  } finally { loading.value = false; }
}
</script>

<template>
  <div class="auth-page">
    <section class="auth-showcase">
      <div class="showcase-brand"><span class="showcase-logo"><Ticket :size="25" /></span><strong>闲鱼影票助手</strong></div>
      <div class="showcase-copy"><span class="showcase-kicker">FIRST TIME SETUP</span><h1>只需一步<br />建立平台管理入口</h1><p>管理员负责创建用户、配置授权和管理客户端额度。</p></div>
      <div class="showcase-features"><span><CheckCircle2 :size="17" />唯一管理员初始化</span><span><Users :size="17" />手工创建与授权用户</span><span><Settings2 :size="17" />统一管理业务能力</span></div>
      <small>Movie Ticket Operations Console</small>
    </section>
    <section class="auth-form-side">
      <div class="mobile-auth-brand"><span class="brand-mark"><Ticket :size="20" /></span><strong>闲鱼影票助手</strong></div>
      <div class="auth-panel">
        <div class="auth-heading"><span class="auth-heading-icon"><ShieldCheck :size="20" /></span><div><h2>初始化管理员</h2><p>此入口仅在系统首次启动时可用</p></div></div>
        <el-form label-position="top">
          <el-form-item label="管理员用户名"><el-input v-model="form.username" size="large" placeholder="至少 3 位" /></el-form-item>
          <el-form-item label="密码"><el-input v-model="form.password" size="large" placeholder="至少 10 位" type="password" show-password /></el-form-item>
          <el-form-item label="确认密码"><el-input v-model="form.confirm" size="large" placeholder="再次输入密码" type="password" show-password @keyup.enter="submit" /></el-form-item>
          <el-button class="full-button auth-submit" size="large" type="primary" :loading="loading" @click="submit">创建管理员</el-button>
        </el-form>
      </div>
    </section>
  </div>
</template>
