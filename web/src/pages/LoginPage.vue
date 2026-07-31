<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { Bot, CheckCircle2, LogIn, ShieldCheck, Ticket, UserRound } from "lucide-vue-next";
import { ElMessage } from "element-plus";
import { api } from "../api";
import { decodeBootstrapStatus } from "../contracts";
import { auth } from "../auth";

const router = useRouter();
const loading = ref(false);
const form = reactive({ username: "", password: "" });

onMounted(async () => {
  if (auth.authenticated.value) {
    await router.replace(auth.state.user?.role === "ADMIN" ? "/admin/users" : "/app/dashboard");
    return;
  }
  try {
    const status = await api<{ initialized: boolean }>("/api/v1/auth/bootstrap-status", {}, decodeBootstrapStatus);
    if (!status.initialized) await router.replace("/setup");
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "初始化状态检查失败");
  }
});

async function submit() {
  if (!form.username || !form.password) return;
  loading.value = true;
  try {
    const user = await auth.login(form.username, form.password);
    const accountPath = user.role === "ADMIN" ? "/admin/account" : "/app/account";
    const dashboardPath = user.role === "ADMIN" ? "/admin/users" : "/app/dashboard";
    await router.replace(user.mustChangePassword ? accountPath : dashboardPath);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "登录失败");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <section class="auth-showcase">
      <div class="showcase-brand"><span class="showcase-logo"><Ticket :size="25" /></span><strong>闲鱼影票助手</strong></div>
      <div class="showcase-copy"><span class="showcase-kicker">XIANYU TICKET AUTOMATION</span><h1>让报价、出票和发货<br />在一个工作台完成</h1><p>面向多闲鱼账号的电影票自动履约系统。</p></div>
      <div class="showcase-features"><span><CheckCircle2 :size="17" />独立账号与数据隔离</span><span><Bot :size="17" />插件与机器人统一管理</span><span><ShieldCheck :size="17" />安装绑定与授权控制</span></div>
      <small>Movie Ticket Operations Console</small>
    </section>
    <section class="auth-form-side">
      <div class="mobile-auth-brand"><span class="brand-mark"><Ticket :size="20" /></span><strong>闲鱼影票助手</strong></div>
      <div class="auth-panel">
        <div class="auth-heading"><span class="auth-heading-icon"><UserRound :size="20" /></span><div><h2>欢迎回来</h2><p>请输入账号信息进入工作台</p></div></div>
        <el-form label-position="top" @submit.prevent="submit">
          <el-form-item label="用户名"><el-input v-model="form.username" size="large" placeholder="请输入用户名" autocomplete="username" /></el-form-item>
          <el-form-item label="密码"><el-input v-model="form.password" size="large" placeholder="请输入密码" type="password" show-password autocomplete="current-password" @keyup.enter="submit" /></el-form-item>
          <el-button class="full-button auth-submit" size="large" type="primary" :loading="loading" @click="submit"><LogIn :size="17" />登录</el-button>
        </el-form>
        <div class="auth-footnote"><ShieldCheck :size="14" />会话凭据仅保存在当前浏览器窗口</div>
      </div>
    </section>
  </div>
</template>
