<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ClipboardList, Plus, RefreshCw } from "lucide-vue-next";
import { ElMessage, ElMessageBox } from "element-plus";
import { api, jsonBody } from "../api";
import { money, statusType } from "../format";
import type { Order } from "../types";
import { decodeArray, decodeOrder } from "../contracts";

const rows = ref<Order[]>([]);
const loading = ref(false);
const open = ref(false);
const form = reactive({ quoteNo: "", customerId: "", paymentNo: "" });
async function load() { loading.value = true; try { rows.value = await api("/api/v1/app/orders", {}, decodeArray(decodeOrder)); } catch (e) { ElMessage.error(e instanceof Error ? e.message : "加载失败"); } finally { loading.value = false; } }
async function create() {
  if (!form.quoteNo) return void ElMessage.warning("请输入报价单号");
  await ElMessageBox.confirm("该操作会创建真实订单并进入上游提交队列。请确认报价、客户和收款信息均正确。", "确认创建真实订单", { confirmButtonText: "确认创建", type: "warning" });
  loading.value = true;
  try { await api("/api/v1/app/orders", { method: "POST", ...jsonBody({ ...form, confirmed: true }) }, decodeOrder); ElMessage.success("订单已创建并进入任务队列"); open.value = false; Object.assign(form, { quoteNo: "", customerId: "", paymentNo: "" }); await load(); } catch (e) { ElMessage.error(e instanceof Error ? e.message : "创建失败"); } finally { loading.value = false; }
}
onMounted(load);
</script>

<template><div class="page-stack"><div class="page-heading"><div><h1>订单</h1><p>查看当前用户订单和上游履约状态</p></div><div class="heading-actions"><el-button :icon="RefreshCw" circle title="刷新" @click="load" /><el-button type="danger" plain @click="open=true"><Plus :size="17" />人工创建真实订单</el-button></div></div>
  <el-table v-loading="loading" :data="rows" class="desktop-data-table" empty-text="暂无订单"><el-table-column label="订单" min-width="210"><template #default="{ row }"><div class="cell-stack"><strong>{{ row.orderNo }}</strong><small>报价 {{ row.quoteNo }}</small></div></template></el-table-column><el-table-column prop="customerId" label="客户" min-width="140" /><el-table-column label="金额" width="110"><template #default="{ row }">{{ money(row.totalPrice) }}</template></el-table-column><el-table-column label="上游单号" min-width="170"><template #default="{ row }">{{ row.upstreamOrderNo || '-' }}</template></el-table-column><el-table-column label="状态" min-width="155"><template #default="{ row }"><div class="cell-stack"><el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag><small>{{ row.statusText }}</small></div></template></el-table-column><el-table-column label="异常" min-width="220"><template #default="{ row }"><span class="danger-text">{{ row.lastSubmitError || row.lastSyncError || '-' }}</span></template></el-table-column></el-table>
  <div v-loading="loading" class="mobile-data-list"><article v-for="row in rows" :key="row.orderNo" class="mobile-data-card"><div class="mobile-card-head"><div><span class="mobile-card-icon blue"><ClipboardList :size="18" /></span><div><strong>{{ row.orderNo }}</strong><small>报价 {{ row.quoteNo }}</small></div></div><el-tag :type="statusType(row.status)" effect="light">{{ row.status }}</el-tag></div><dl><div><dt>客户</dt><dd>{{ row.customerId }}</dd></div><div><dt>订单金额</dt><dd class="price-text">{{ money(row.totalPrice) }}</dd></div><div><dt>上游单号</dt><dd>{{ row.upstreamOrderNo || '-' }}</dd></div><div><dt>状态说明</dt><dd>{{ row.statusText }}</dd></div></dl><el-alert v-if="row.lastSubmitError || row.lastSyncError" :title="row.lastSubmitError || row.lastSyncError" type="error" :closable="false" /></article><div v-if="!rows.length && !loading" class="mobile-empty"><ClipboardList :size="24" /><span>暂无订单</span></div></div>
  <el-dialog v-model="open" title="人工创建真实订单" width="min(520px, 92vw)"><el-alert title="此入口不是模拟操作，确认后订单将进入上游提交队列。" type="error" show-icon :closable="false" /><el-form label-position="top" class="dialog-form"><el-form-item label="报价单号"><el-input v-model="form.quoteNo" /></el-form-item><el-form-item label="客户标识（可选）"><el-input v-model="form.customerId" /></el-form-item><el-form-item label="收款单号（可选）"><el-input v-model="form.paymentNo" /></el-form-item></el-form><template #footer><el-button @click="open=false">取消</el-button><el-button type="danger" :loading="loading" @click="create">创建真实订单</el-button></template></el-dialog>
</div></template>
