<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ImagePlus, RefreshCw, Ticket } from "lucide-vue-next";
import { ElMessage } from "element-plus";
import { api, jsonBody } from "../api";
import { money, statusType } from "../format";
import type { Quote } from "../types";
import { decodeArray, decodeQuote } from "../contracts";

const rows = ref<Quote[]>([]);
const loading = ref(false);
const open = ref(false);
const filename = ref("");
const form = reactive({ imageBase64: "", customerId: "", channel: "GOOFISH" });

async function load() { loading.value = true; try { rows.value = await api("/api/v1/app/quotes", {}, decodeArray(decodeQuote)); } catch (e) { ElMessage.error(e instanceof Error ? e.message : "加载失败"); } finally { loading.value = false; } }
function pick(file: { raw?: File; name: string }) {
  if (!file.raw) return;
  if (file.raw.size > 10 * 1024 * 1024) return void ElMessage.warning("图片不能超过 10MB");
  const reader = new FileReader(); reader.onload = () => { if (typeof reader.result !== "string") throw new Error("图片读取结果不是 data URL"); form.imageBase64 = reader.result; filename.value = file.name; }; reader.onerror = () => ElMessage.error("图片读取失败"); reader.readAsDataURL(file.raw);
}
async function create() { if (!form.imageBase64) return void ElMessage.warning("请选择票面截图"); loading.value = true; try { await api("/api/v1/app/quotes", { method: "POST", ...jsonBody(form) }, decodeQuote); ElMessage.success("报价已生成"); open.value = false; form.imageBase64 = ""; filename.value = ""; await load(); } catch (e) { ElMessage.error(e instanceof Error ? e.message : "报价失败"); } finally { loading.value = false; } }
onMounted(load);
</script>

<template><div class="page-stack"><div class="page-heading"><div><h1>报价</h1><p>上传票面截图，通过当前用户的上游账号生成报价</p></div><div class="heading-actions"><el-button :icon="RefreshCw" circle title="刷新" @click="load" /><el-button type="primary" @click="open=true"><ImagePlus :size="17" />新建报价</el-button></div></div>
  <el-table v-loading="loading" :data="rows" class="desktop-data-table" empty-text="暂无报价"><el-table-column prop="quoteNo" label="报价单号" min-width="190" /><el-table-column label="影片 / 影院" min-width="210"><template #default="{ row }"><div class="cell-stack"><strong>{{ row.ticketInfo?.movieName || '-' }}</strong><small>{{ row.ticketInfo?.cinemaName || '-' }}</small></div></template></el-table-column><el-table-column label="座位" min-width="150"><template #default="{ row }">{{ row.ticketInfo?.seats?.join('、') || `${row.ticketInfo?.seatCount || 0} 张` }}</template></el-table-column><el-table-column label="上游价" width="110"><template #default="{ row }">{{ money(row.upstreamPrice) }}</template></el-table-column><el-table-column label="应收" width="110"><template #default="{ row }"><strong>{{ money(row.totalPrice) }}</strong></template></el-table-column><el-table-column label="利润" width="100"><template #default="{ row }">{{ money(row.profit) }}</template></el-table-column><el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusType(row.status)" effect="plain">{{ row.status }}</el-tag></template></el-table-column></el-table>
  <div v-loading="loading" class="mobile-data-list"><article v-for="row in rows" :key="row.quoteNo" class="mobile-data-card"><div class="mobile-card-head"><div><span class="mobile-card-icon green"><Ticket :size="18" /></span><div><strong>{{ row.ticketInfo?.movieName || '未识别影片' }}</strong><small>{{ row.quoteNo }}</small></div></div><el-tag :type="statusType(row.status)" effect="light">{{ row.status }}</el-tag></div><p class="mobile-card-subtitle">{{ row.ticketInfo?.cinemaName || '-' }} · {{ row.ticketInfo?.hallName || '-' }}</p><dl><div><dt>座位</dt><dd>{{ row.ticketInfo?.seats?.join('、') || `${row.ticketInfo?.seatCount || 0} 张` }}</dd></div><div><dt>上游价</dt><dd>{{ money(row.upstreamPrice) }}</dd></div><div><dt>应收金额</dt><dd class="price-text">{{ money(row.totalPrice) }}</dd></div><div><dt>预计利润</dt><dd>{{ money(row.profit) }}</dd></div></dl></article><div v-if="!rows.length && !loading" class="mobile-empty"><Ticket :size="24" /><span>暂无报价</span></div></div>
  <el-dialog v-model="open" title="新建报价" width="min(520px, 92vw)"><el-form label-position="top"><el-form-item label="票面截图"><el-upload drag :auto-upload="false" :show-file-list="false" accept="image/*" :on-change="pick"><ImagePlus :size="24" /><div>{{ filename || '选择或拖入截图' }}</div></el-upload></el-form-item><el-form-item label="客户标识（可选）"><el-input v-model="form.customerId" placeholder="例如微信 ID 或人工备注" /></el-form-item></el-form><template #footer><el-button @click="open=false">取消</el-button><el-button type="primary" :loading="loading" @click="create">识别并报价</el-button></template></el-dialog>
</div></template>
