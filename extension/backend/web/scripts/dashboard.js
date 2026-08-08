// 影票智营 Pro 管理控制台 —— 真实后端版（原型视觉）
// 数据源:FastAPI /api/v1/admin/*(Bearer token,登录后存 localStorage)。
// 视觉还原 React 原型:登录页/深色侧栏/概览/报价策略/订单卡片/资金/设置。

const TOKEN_KEY = "mpq-admin-token";
const API_BASE = ""; // 同源(页面由后端 /admin 挂载)

let token = localStorage.getItem(TOKEN_KEY) || "";
let active = location.hash.replace("#", "") || "overview";

const app = document.querySelector("#app");

// —— API 层 ——

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (response.status === 401) {
    token = "";
    localStorage.removeItem(TOKEN_KEY);
    throw new Error("登录已失效，请重新登录");
  }
  const body = await response.json().catch(() => ({ code: -1, message: `HTTP ${response.status}` }));
  if (!response.ok) {
    throw new Error(body.message || body.detail || `HTTP ${response.status}`);
  }
  if (body.code !== 0) {
    throw new Error(body.message || "接口返回错误");
  }
  return body.data;
}

async function login(username, password) {
  const data = await apiFetch("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  token = data.accessToken;
  localStorage.setItem(TOKEN_KEY, token);
  await loadAll();
}

function logout() {
  token = "";
  localStorage.removeItem(TOKEN_KEY);
  render();
}

let overview = null;
let orders = null;
let quoteStrategy = null;

async function loadAll() {
  const [ov, ors, qs] = await Promise.all([
    apiFetch("/api/v1/admin/overview"),
    apiFetch("/api/v1/admin/orders?limit=300"),
    apiFetch("/api/v1/admin/quote-strategy")
  ]);
  overview = ov;
  orders = ors;
  quoteStrategy = qs;
}

// —— 事件 ——

window.addEventListener("hashchange", () => {
  active = location.hash.replace("#", "") || "overview";
  render();
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;

  if (action === "nav") {
    location.hash = button.dataset.target;
    // 移动端选择后收起抽屉
    const sidebar = document.getElementById("app-sidebar");
    const overlay = document.getElementById("drawer-overlay");
    if (sidebar && window.innerWidth < 768) sidebar.classList.add("-translate-x-full");
    if (overlay) overlay.classList.add("hidden");
    return;
  }
  if (action === "logout") {
    logout();
    return;
  }
  if (action === "refresh") {
    button.disabled = true;
    try {
      await loadAll();
      toast("数据已刷新");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      render();
    }
    return;
  }
  if (action === "toggle-order") {
    const el = document.getElementById(`order-detail-${id}`);
    if (el) {
      el.classList.toggle("hidden");
      const chevron = el.previousElementSibling?.querySelector(".fa-chevron-down");
      if (chevron) chevron.style.transform = el.classList.contains("hidden") ? "rotate(0deg)" : "rotate(180deg)";
    }
    return;
  }
  if (action === "order-filter-toggle") {
    const menu = button.parentElement?.querySelector("[data-order-filter-menu]");
    if (menu) menu.classList.toggle("hidden");
    return;
  }
  if (action === "order-filter") {
    orderFilter = button.dataset.value || "all";
    const menu = button.closest("[data-order-filter-menu]");
    if (menu) menu.classList.add("hidden");
    render();
    return;
  }
  if (action === "export-orders") {
    exportOrdersCsv();
    return;
  }
  if (action === "open-drawer") {
    const sidebar = document.getElementById("app-sidebar");
    const overlay = document.getElementById("drawer-overlay");
    if (sidebar) sidebar.classList.remove("-translate-x-full");
    if (overlay) overlay.classList.remove("hidden");
    return;
  }
  if (action === "close-drawer") {
    const sidebar = document.getElementById("app-sidebar");
    const overlay = document.getElementById("drawer-overlay");
    if (sidebar) sidebar.classList.add("-translate-x-full");
    if (overlay) overlay.classList.add("hidden");
    return;
  }
  if (action === "view-image") {
    event.preventDefault();
    event.stopPropagation();
    showImageLightbox(button.dataset.url || "");
    return;
  }
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target && target.id === "order-search-input") {
    orderSearch = target.value;
    render();
    requestAnimationFrame(() => {
      const input = document.getElementById("order-search-input");
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  }
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const formName = form.dataset.form;
  const data = Object.fromEntries(new FormData(form));

  if (formName === "login") {
    try {
      await login(String(data.username || "").trim(), String(data.password || ""));
      toast("登录成功");
      render();
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  if (formName === "quote") {
    const payload = {
      floatCents: Math.round(Number(data.floatCents || 0) * 100),
      diffThresholdCents: Math.round(Number(data.diffThresholdCents || 0) * 100),
      diffMarkupPercent: Math.round(Number(data.diffMarkupPercent || 0))
    };
    try {
      quoteStrategy = await apiFetch("/api/v1/admin/quote-strategy", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      toast("报价策略已保存");
      render();
    } catch (error) {
      toast(error.message);
    }
  }
});

// —— 渲染 ——

const NAV_ITEMS = [
  ["overview", "概览总览"],
  ["pricing", "报价策略"],
  ["orders", "订单列表"],
  ["finance", "资金统计"],
  ["settings", "系统设置"]
];

const TITLES = {
  overview: { title: "经营总览", sub: "欢迎回来，查看今日实时营业数据。" },
  pricing: { title: "报价策略配置", sub: "调整全局加价规则与自动接单逻辑。" },
  orders: { title: "全量订单管理", sub: "查看及处理所有渠道的电影票订单。" },
  finance: { title: "资金与结算", sub: "平台流水统计与异常账目核对。" },
  settings: { title: "系统设置", sub: "引擎状态与账号管理。" }
};

function render() {
  if (!token) {
    renderLogin();
    return;
  }
  if (overview === null || orders === null || quoteStrategy === null) {
    app.innerHTML = `<div class="min-h-screen bg-[#EEF3FF] flex items-center justify-center text-gray-400 text-sm">加载中…</div>`;
    loadAll().then(render).catch((error) => {
      token = "";
      localStorage.removeItem(TOKEN_KEY);
      toast(error.message);
      render();
    });
    return;
  }
  const page = TITLES[active] ? active : "overview";
  renderLayout(page);
}

function renderLogin() {
  app.innerHTML = `
    <div class="min-h-screen bg-[#EEF3FF] flex items-center justify-center relative overflow-hidden px-4">
      <div class="absolute inset-0 z-0 pointer-events-none">
        <div class="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-brand-blue/20 rounded-full blur-[120px]"></div>
        <div class="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-brand-green/20 rounded-full blur-[100px]"></div>
      </div>
      <div class="relative z-10 w-full max-w-md">
        <div class="glass-card rounded-[28px] p-8 md:p-10 shadow-2xl shadow-brand-blue/10 login-card">
          <div class="text-center mb-8">
            <div class="w-16 h-16 mx-auto bg-gradient-to-br from-brand-dark to-brand-blue rounded-2xl flex items-center justify-center shadow-lg shadow-brand-blue/30 mb-5">
              <i class="fa-solid fa-ticket-alt"></i>
            </div>
            <h1 class="text-2xl font-bold text-gray-900">影票智营 <span class="text-brand-blue">Pro</span></h1>
            <p class="text-sm text-gray-500 mt-2 font-medium">老板专属经营管理中心</p>
          </div>
          <form data-form="login" class="space-y-5">
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <i class="fa-solid fa-user"></i>
              </div>
              <input name="username" type="text" required placeholder="管理账号" class="pl-11 block w-full rounded-xl border-gray-200 bg-white/60 border py-3.5 px-4 text-sm font-medium focus:border-brand-blue focus:bg-white focus:ring-4 focus:ring-brand-blue/10 transition outline-none" />
            </div>
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <i class="fa-solid fa-lock"></i>
              </div>
              <input name="password" type="password" required placeholder="登录密码" class="pl-11 block w-full rounded-xl border-gray-200 bg-white/60 border py-3.5 px-4 text-sm font-medium focus:border-brand-blue focus:bg-white focus:ring-4 focus:ring-brand-blue/10 transition outline-none" />
            </div>
            <button type="submit" class="w-full flex justify-center py-3.5 px-4 mt-2 border border-transparent rounded-xl shadow-md text-sm font-bold text-white bg-brand-blue hover:bg-blue-700 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-brand-blue/30 transition-all active:scale-[0.98]">
              安全登录
            </button>
          </form>
        </div>
      </div>
    </div>
  `;
}

function renderLayout(page) {
  app.innerHTML = `
    <div class="flex h-screen overflow-hidden bg-[#EEF3FF]">
      <!-- 移动端遮罩 -->
      <div id="drawer-overlay" class="fixed inset-0 bg-brand-dark/40 z-30 md:hidden hidden drawer-overlay" data-action="close-drawer"></div>

      <aside id="app-sidebar" class="fixed md:static inset-y-0 left-0 w-64 bg-brand-dark flex flex-col shadow-2xl z-40 flex-shrink-0 -translate-x-full md:translate-x-0 transition-transform duration-300 drawer-content">
        <div class="p-6 flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-green to-brand-blue flex items-center justify-center text-white font-bold shadow-lg shadow-brand-blue/30">M</div>
          <span class="text-white font-bold text-lg tracking-wide">影票智营 <span class="text-brand-green">Pro</span></span>
          <button type="button" class="ml-auto md:hidden text-white/50 hover:text-white p-1" data-action="close-drawer" aria-label="关闭菜单">
            <i class="fa-solid fa-times text-xl"></i>
          </button>
        </div>
        <nav class="flex-1 px-4 py-2 space-y-1.5 overflow-y-auto">
          ${NAV_ITEMS.map(([key, label]) => `
            <button type="button" data-action="nav" data-target="${key}" class="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 outline-none ${
              page === key ? "bg-brand-blue text-white shadow-lg shadow-brand-blue/20 font-bold" : "text-gray-400 hover:bg-white/5 hover:text-white font-medium"
            }">
              <span class="w-5 text-center text-[15px]">${navIcon(key)}</span>
              <span class="text-sm">${label}</span>
            </button>
          `).join("")}
        </nav>
        <div class="p-4 border-t border-white/10 mt-auto">
          <div class="bg-white/5 rounded-2xl p-4 flex items-center gap-3 backdrop-blur-sm border border-white/5">
            <div class="w-10 h-10 rounded-full bg-brand-blue/20 flex items-center justify-center text-brand-blue border border-brand-blue/30 shrink-0">
              <i class="fa-solid fa-user"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-white text-sm font-bold truncate">管理员</div>
              <div class="flex items-center gap-1.5 mt-0.5">
                <div class="w-1.5 h-1.5 rounded-full bg-brand-green shadow-[0_0_8px_rgba(8,199,182,0.8)]"></div>
                <span class="text-[10px] text-brand-green uppercase tracking-wider font-bold">Online</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main class="flex-1 flex flex-col overflow-hidden relative w-full">
        <div class="absolute top-0 right-0 w-[800px] h-[500px] bg-brand-blue/5 rounded-full blur-[100px] -z-10 translate-x-1/3 -translate-y-1/3 pointer-events-none"></div>
        <div class="absolute bottom-0 left-0 w-[600px] h-[400px] bg-brand-green/5 rounded-full blur-[80px] -z-10 -translate-x-1/3 translate-y-1/3 pointer-events-none"></div>

        <header class="h-16 md:h-24 px-4 md:px-10 flex items-center justify-between z-10 shrink-0 border-b border-gray-200/50 md:border-none bg-white/50 md:bg-transparent backdrop-blur-md md:backdrop-blur-none">
          <div class="flex items-center gap-3 md:gap-0">
            <button type="button" class="md:hidden w-9 h-9 flex items-center justify-center rounded-xl bg-white shadow-sm border border-gray-100 text-gray-600 hover:text-brand-blue transition active:scale-95" data-action="open-drawer" aria-label="打开菜单">
              <i class="fa-solid fa-bars"></i>
            </button>
            <div>
              <h1 class="text-lg md:text-2xl font-bold text-gray-900 leading-tight">${TITLES[page].title}</h1>
              <p class="text-xs md:text-sm text-gray-500 hidden md:block mt-0.5">${TITLES[page].sub}</p>
            </div>
          </div>
          <div class="flex items-center gap-2 md:gap-4">
            <button type="button" data-action="refresh" class="w-9 h-9 md:w-10 md:h-10 rounded-full bg-white shadow-sm border border-gray-100 flex items-center justify-center text-gray-500 hover:text-brand-blue hover:shadow-md transition active:scale-95">
              <i class="fa-solid fa-sync-alt"></i>
            </button>
            <span class="hidden sm:flex bg-white px-3 py-1.5 md:px-4 md:py-2 rounded-full shadow-sm border border-gray-100 items-center gap-2">
              <span class="px-2 py-0.5 rounded-full text-xs font-medium border bg-green-100 text-green-700 border-green-200">Sys OK</span>
            </span>
          </div>
        </header>

        <div class="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-10 pb-10 pt-4 md:pt-0 z-10 w-full relative">
          <div class="max-w-7xl mx-auto">
            ${renderPage(page)}
          </div>
        </div>
      </main>
    </div>
  `;
}

function navIcon(key) {
  const icons = {
    overview: '<i class="fa-solid fa-chart-pie"></i>',
    pricing: '<i class="fa-solid fa-tags"></i>',
    orders: '<i class="fa-solid fa-list-alt"></i>',
    finance: '<i class="fa-solid fa-yen-sign"></i>',
    settings: '<i class="fa-solid fa-cog"></i>'
  };
  return icons[key] || "";
}

function renderPage(page) {
  switch (page) {
    case "overview": return renderOverview();
    case "pricing": return renderPricing();
    case "orders": return renderOrders();
    case "finance": return renderFinance();
    case "settings": return renderSettings();
    default: return renderOverview();
  }
}

// —— 概览总览 ——

function renderOverview() {
  const o = overview;
  const daily = o.daily || [];
  const totalOrders = o.today.totalOrders;
  const totalRevenue = o.today.totalRevenue;
  const successRate = o.today.quoteSuccessRate;
  const pending = o.today.pending;
  return `
    <div class="space-y-4 md:space-y-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <div class="rounded-saas p-4 md:p-6 hero-gradient text-white shadow-lg">
          <div class="text-white/80 text-sm mb-2 flex items-center gap-2">
            <i class="fa-solid fa-robot"></i>
            自动化状态
          </div>
          <div class="text-2xl md:text-3xl font-bold mb-2">${o.automationEnabled ? "运行中" : "已暂停"}</div>
          <div class="text-white/70 text-xs">插件弹窗开关控制</div>
        </div>
        <div class="rounded-saas p-4 md:p-6 bg-gradient-to-br from-[#E6F9F8] to-white border-l-4 border-[#08C7B6] shadow-sm">
          <div class="text-gray-500 text-sm mb-2 flex items-center gap-2">
            <i class="fa-solid fa-wallet"></i>
            累计成交额
          </div>
          <div class="text-2xl md:text-3xl font-bold text-gray-800 mb-2 truncate">¥ ${money(totalRevenue)}</div>
          <div class="text-[#08C7B6] text-xs font-medium">近 7 日 ${totalOrders} 单</div>
        </div>
        <div class="rounded-saas p-4 md:p-6 bg-gradient-to-br from-[#FFF8E6] to-white border-l-4 border-amber-400 shadow-sm">
          <div class="text-gray-500 text-sm mb-2 flex items-center gap-2">
            <i class="fa-solid fa-bullseye"></i>
            报价成功率
          </div>
          <div class="text-2xl md:text-3xl font-bold text-gray-800 mb-2">${successRate}%</div>
          <div class="text-gray-500 text-xs">近 7 日样本</div>
        </div>
        <div class="rounded-saas p-4 md:p-6 bg-gradient-to-br from-[#F3E6FF] to-white border-l-4 border-purple-500 shadow-sm">
          <div class="text-gray-500 text-sm mb-2 flex items-center gap-2">
            <i class="fa-solid fa-clock"></i>
            待处理订单
          </div>
          <div class="text-2xl md:text-3xl font-bold text-gray-800 mb-2">${pending}</div>
          <a href="#orders" class="text-purple-500 text-xs font-medium cursor-pointer hover:underline">立即前往处理 &rarr;</a>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div class="glass-card rounded-saas p-4 md:p-6 lg:col-span-2 overflow-hidden">
          <h3 class="text-base md:text-lg font-bold text-gray-800 mb-4">近 7 日订单与成交额</h3>
          ${dailyTrendChart(daily)}
        </div>
        <div class="glass-card rounded-saas p-4 md:p-6 overflow-hidden">
          <h3 class="text-base md:text-lg font-bold text-gray-800 mb-4">付款率趋势</h3>
          ${lineChart(daily.map((item) => ({ label: item.date, value: item.count ? Math.round((item.paidCount / item.count) * 100) : 0 })), "%")}
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        <div class="glass-card rounded-saas p-4 md:p-6">
          <h3 class="text-base font-bold text-gray-800 mb-4">订单状态分布</h3>
          ${statusBars(o.statusDistribution)}
        </div>
        <div class="glass-card rounded-saas p-4 md:p-6">
          <h3 class="text-base font-bold text-gray-800 mb-4">城市排行</h3>
          ${cityRankBars(o.cityRank)}
        </div>
        <div class="glass-card rounded-saas p-4 md:p-6 flex flex-col justify-center">
          <h3 class="text-base font-bold text-gray-800 mb-2">平台资金概况</h3>
          <div class="flex justify-between items-end mb-4">
            <div>
              <div class="text-sm text-gray-500 mb-1">近 7 日成交额</div>
              <div class="text-2xl md:text-3xl font-bold text-brand-blue truncate">¥ ${money(totalRevenue)}</div>
            </div>
            <span class="text-xs text-gray-400">异常 ${o.today.failed} 单</span>
          </div>
          <div class="text-xs text-gray-400 border-t pt-3 mt-auto">${o.today.cancelled} 单已取消</div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div class="glass-card rounded-saas p-4 md:p-6 lg:col-span-2 overflow-hidden">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-base md:text-lg font-bold text-gray-800">最近订单</h3>
            <a href="#orders" class="text-sm text-brand-blue hover:underline font-medium">查看全部</a>
          </div>
          ${ordersTable(o.recentOrders || [])}
        </div>
        <div class="rounded-saas p-4 md:p-6 bg-brand-dark text-white border-none shadow-lg">
          <h3 class="text-base md:text-lg font-bold text-white mb-6 flex items-center gap-2">
            <i class="fa-solid fa-server"></i>
            运营概况
          </h3>
          <div class="space-y-6">
            <div>
              <div class="text-white/60 text-sm mb-1">当前固定加价</div>
              <div class="text-2xl font-bold text-brand-green">+ ¥${money(quoteStrategy.floatCents / 100)} <span class="text-sm font-normal">/ 张</span></div>
            </div>
            <div class="h-px bg-white/10 w-full"></div>
            <div>
              <div class="text-white/60 text-sm mb-1">累计订单</div>
              <div class="text-2xl font-bold">${totalOrders} <span class="text-sm text-white/50 font-normal">单</span></div>
            </div>
            <div class="h-px bg-white/10 w-full"></div>
            <div class="flex items-center justify-between">
              <div class="text-white/60 text-sm">主引擎接单</div>
              <div class="flex items-center gap-2">
                <div class="relative flex h-3 w-3">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-green opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-3 w-3 bg-brand-green"></span>
                </div>
                <span class="text-sm font-medium text-brand-green">${o.automationEnabled ? "运行中" : "离线"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// —— 报价策略 ——

function renderPricing() {
  const floatYuan = money(quoteStrategy.floatCents / 100);
  const thresholdYuan = money(quoteStrategy.diffThresholdCents / 100);
  const markup = quoteStrategy.diffMarkupPercent;
  return `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
      <div class="glass-card rounded-saas p-4 md:p-6">
        <h2 class="text-lg md:text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
          <i class="fa-solid fa-sliders-h"></i>
          核心报价策略
        </h2>
        <form data-form="quote" class="space-y-6">
          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">固定加价 (元/张)</label>
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><span class="text-gray-500 sm:text-sm font-bold">¥</span></div>
              <input name="floatCents" type="number" value="${floatYuan}" step="0.1" class="pl-8 block w-full rounded-xl border-gray-200 bg-gray-50/50 border py-3 px-4 text-sm focus:border-brand-blue focus:bg-white focus:ring-4 focus:ring-brand-blue/10 transition outline-none" />
            </div>
            <p class="mt-1.5 text-xs text-gray-500">每张票在底价基础上的硬性加收金额。</p>
          </div>
          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">最大差价阈值 (元)</label>
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><span class="text-gray-500 sm:text-sm font-bold">¥</span></div>
              <input name="diffThresholdCents" type="number" value="${thresholdYuan}" step="0.1" class="pl-8 block w-full rounded-xl border-gray-200 bg-gray-50/50 border py-3 px-4 text-sm focus:border-brand-blue focus:bg-white focus:ring-4 focus:ring-brand-blue/10 transition outline-none" />
            </div>
            <p class="mt-1.5 text-xs text-gray-500">当平台售价与渠道底价差额大于此值时，启用特殊加价系数。</p>
          </div>
          <div>
            <label class="block text-sm font-bold text-gray-700 mb-2">浮动加价系数 (%)</label>
            <div class="relative">
              <input name="diffMarkupPercent" type="number" value="${markup}" class="block w-full rounded-xl border-gray-200 bg-gray-50/50 border py-3 px-4 text-sm focus:border-brand-blue focus:bg-white focus:ring-4 focus:ring-brand-blue/10 transition outline-none" />
              <div class="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none"><span class="text-gray-500 sm:text-sm font-bold">%</span></div>
            </div>
            <p class="mt-1.5 text-xs text-gray-500">触发阈值后，提取差价的百分比作为额外利润。</p>
          </div>
          <div class="pt-6 border-t border-gray-100 flex justify-end gap-3">
            <button type="button" class="bg-gray-100 text-gray-700 px-6 py-3 rounded-xl text-sm font-bold hover:bg-gray-200 transition" data-action="refresh">重置</button>
            <button type="submit" class="bg-brand-blue text-white px-8 py-3 rounded-xl text-sm font-bold shadow-md hover:bg-blue-700 transition">保存策略</button>
          </div>
        </form>
      </div>

      <div class="space-y-4 md:space-y-6">
        <div class="rounded-saas p-4 md:p-6 hero-gradient text-white shadow-lg">
          <h3 class="text-base md:text-lg font-bold mb-4 text-white flex items-center gap-2">
            <i class="fa-solid fa-lightbulb"></i>
            当前策略示例解析
          </h3>
          <div class="bg-white/10 rounded-2xl p-4 md:p-5 backdrop-blur-sm border border-white/10">
            <div class="grid grid-cols-3 gap-2 md:gap-4 text-center">
              <div>
                <div class="text-white/60 text-xs mb-1">渠道底价</div>
                <div class="font-bold text-base md:text-lg">¥ 30.00</div>
              </div>
              <div class="relative">
                <div class="absolute top-1/2 -left-2 w-px h-8 bg-white/20 -translate-y-1/2 hidden md:block"></div>
                <div class="text-white/60 text-xs mb-1">平台售价</div>
                <div class="font-bold text-base md:text-lg">¥ 50.00</div>
              </div>
              <div class="relative">
                <div class="absolute top-1/2 -left-2 w-px h-8 bg-white/20 -translate-y-1/2 hidden md:block"></div>
                <div class="text-white/60 text-xs mb-1">最终报价</div>
                <div class="font-bold text-base md:text-lg text-brand-green">¥ ${money(30 + Number(floatYuan) + 20 * markup / 100)}</div>
              </div>
            </div>
            <div class="mt-5 pt-4 border-t border-white/10 text-xs md:text-sm text-white/80 leading-relaxed space-y-2">
              <p class="text-white font-bold">计算过程:</p>
              <p class="flex justify-between"><span>1. 计算差价: 50 - 30</span> <span class="font-mono bg-white/10 px-2 py-0.5 rounded">20元</span></p>
              <p class="flex justify-between"><span>2. 浮动利润: 20 * ${markup}%</span> <span class="font-mono bg-white/10 px-2 py-0.5 rounded">${money(20 * markup / 100)}元</span></p>
              <p class="flex justify-between"><span>3. 基础加价: 设定值</span> <span class="font-mono bg-white/10 px-2 py-0.5 rounded">${floatYuan}元</span></p>
              <p class="mt-2 text-white/60 text-xs pt-2 border-t border-white/5">最终加价取最高策略或叠加（当前演示叠加固定与按比例部分）。</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// —— 订单列表 ——

let orderFilter = "all";
let orderSearch = "";

function renderOrders() {
  const list = (orders || []).filter((order) => {
    if (orderFilter !== "all" && !orderMatchesFilter(order, orderFilter)) return false;
    if (orderSearch) {
      const haystack = `${order.id} ${order.filmName} ${order.cinemaName}`.toLowerCase();
      if (!haystack.includes(orderSearch.toLowerCase())) return false;
    }
    return true;
  });
  const statusOptions = [
    { label: "全部状态", value: "all" },
    { label: "已报价", value: "20" },
    { label: "已改价", value: "25" },
    { label: "出票中", value: "30" },
    { label: "已出票", value: "50" },
    { label: "已取消", value: "90" },
    { label: "出票失败", value: "450" },
    { label: "报价失败", value: "QUOTE_FAILED" }
  ];
  return `
    <div class="bg-white rounded-saas p-4 md:p-6 shadow-saas min-h-[500px]">
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div class="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <div class="relative inline-block text-left w-full md:w-40">
            <button type="button" data-action="order-filter-toggle" class="bg-white border text-sm rounded-xl flex items-center justify-between p-2.5 w-full outline-none transition-all shadow-sm border-gray-200 text-gray-700 hover:border-gray-300">
              <span class="truncate font-medium">${statusOptions.find((o) => o.value === orderFilter)?.label || "全部状态"}</span>
              <i class="fa-solid fa-chevron-down text-[10px] text-gray-400"></i>
            </button>
            <div data-order-filter-menu class="hidden origin-top-left absolute left-0 mt-2 w-full min-w-[140px] rounded-xl shadow-glass bg-white/90 backdrop-blur-md border border-white z-50 overflow-hidden">
              ${statusOptions.map((option) => `
                <button type="button" data-action="order-filter" data-value="${option.value}" class="w-full text-left flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${orderFilter === option.value ? "bg-brand-light/80 text-brand-blue font-bold" : "text-gray-700 hover:bg-gray-50"}">
                  <span class="w-1.5 h-1.5 rounded-full ${orderFilter === option.value ? "bg-brand-blue" : "bg-transparent"}"></span>
                  ${option.label}
                </button>`).join("")}
            </div>
          </div>
          <div class="relative w-full md:w-64">
            <i class="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
            <input type="text" id="order-search-input" placeholder="搜索订单号/影片..." value="${esc(orderSearch)}" class="w-full bg-white border border-gray-200 text-gray-700 text-sm rounded-xl focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue block pl-9 pr-3 py-2.5 outline-none transition-all shadow-sm" />
          </div>
        </div>
        <div class="flex items-center gap-3 w-full md:w-auto">
          <span class="text-sm text-gray-500">共 ${list.length} 条</span>
          <button type="button" data-action="export-orders" class="w-full md:w-auto bg-brand-blue text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-md hover:bg-blue-700 hover:shadow-lg transition flex items-center justify-center gap-2">
            <i class="fa-solid fa-download"></i>导出数据
          </button>
        </div>
      </div>
      <div class="space-y-3">
        ${list.length === 0 ? '<div class="text-center text-gray-400 py-10 text-sm">暂无订单记录</div>' : list.map(orderCard).join("")}
      </div>
    </div>
  `;
}

function orderCard(order) {
  const seats = (order.seatRowsCols || []).map((seat) => {
    if (typeof seat === "string") return seat;
    return `${seat.row ?? ""}排${seat.col ?? ""}座`;
  });
  const statusInfo = orderStatusInfo(order.status);
  const initial = (order.filmName || "影").slice(0, 1);
  const codes = order.ticketCodes || [];
  const images = order.ticketImages || [];
  // 卡片海报优先用选座截图(报价时的座位图),其次出票后的票图,最后渐变占位。
  // 闲鱼 alicdn 图有防盗链,统一走后端代理(/admin/proxy-image)避免 CORS 失败。
  const poster = order.seatsImage
    || images.find((url) => typeof url === "string" && url.length > 0)
    || "";
  const proxyPoster = poster ? `/admin/proxy-image?url=${encodeURIComponent(poster)}` : "";
  const posterHtml = poster
    ? `<img src="${esc(proxyPoster)}" alt="${esc(order.filmName)}" data-action="view-image" data-url="${esc(proxyPoster)}" class="w-24 h-32 md:w-20 md:h-28 object-contain rounded-xl shadow-sm bg-gray-50 border border-gray-100 hover:opacity-85 cursor-zoom-in transition-opacity" onerror="this.outerHTML='<div class=&quot;w-24 h-32 md:w-20 md:h-28 rounded-xl shadow-sm bg-gradient-to-br from-brand-blue to-brand-green flex items-center justify-center text-white font-bold text-2xl&quot;>${esc(initial)}</div>'">`
    : `<div class="w-24 h-32 md:w-20 md:h-28 rounded-xl shadow-sm bg-gradient-to-br from-brand-blue to-brand-green flex items-center justify-center text-white font-bold text-2xl">${esc(initial)}</div>`;
  return `
    <div class="bg-white rounded-2xl border transition-all duration-300 overflow-hidden border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200">
      <div class="p-4 flex flex-col md:flex-row gap-4 md:gap-6 items-start md:items-center cursor-pointer relative" data-action="toggle-order" data-id="${esc(order.id)}">
        <div class="flex gap-4 flex-1 w-full min-w-0" style="min-width:0;">
          <div class="relative shrink-0">
            ${posterHtml}
            <div class="absolute -top-2 -right-2 md:hidden">
              <span class="px-3 py-1 rounded-full text-xs font-medium border ${statusInfo.cls}">${statusInfo.label}</span>
            </div>
          </div>
          <div class="flex flex-col justify-center flex-1 py-1" style="min-width:0;">
            <h4 class="font-bold text-gray-900 text-lg md:text-base truncate mb-1">${esc(order.filmName)}</h4>
            <div class="text-sm text-gray-500 mb-2 truncate"><i class="fa-solid fa-map-marker-alt mr-1 text-gray-400"></i>${esc(order.cityName)} · ${esc(order.cinemaName)}</div>
            <div class="flex flex-wrap gap-1.5">
              ${seats.length > 0 ? seats.slice(0, 4).map((seat) => `
                <span class="text-xs px-2 py-0.5 bg-gray-50 rounded-md text-gray-600 border border-gray-200 shadow-sm whitespace-nowrap">
                  <i class="fa-solid fa-couch text-[10px] text-gray-400 mr-1"></i>${esc(seat)}
                </span>`).join("") : `<span class="text-xs px-2 py-0.5 bg-gray-50 rounded-md text-gray-600 border border-gray-200">${order.ticketNum} 张</span>`}
              ${seats.length > 4 ? `<span class="text-xs px-2 py-0.5 bg-gray-50 rounded-md text-gray-400 border border-gray-200">+${seats.length - 4}</span>` : ""}
            </div>
          </div>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 w-full md:w-auto gap-4 md:gap-6 items-center border-t md:border-t-0 pt-3 md:pt-0 border-gray-100">
          <div class="col-span-2 md:col-span-1">
            <div class="font-mono text-sm font-medium text-gray-700">${esc(order.id.slice(0, 12))}</div>
            <div class="text-xs text-gray-400 mt-1">${fmtTime(order.createdAt)}</div>
          </div>
          <div class="text-left md:text-right">
            <div class="font-bold text-brand-blue text-base">¥ ${money(order.amount)}</div>
            <div class="text-xs text-gray-500 font-medium mt-1">${order.ticketNum} 张</div>
          </div>
          <div class="hidden md:flex justify-center">
            <span class="px-3 py-1 rounded-full text-xs font-medium border ${statusInfo.cls}">${statusInfo.label}</span>
          </div>
          <div class="hidden md:flex justify-end text-gray-300">
            <div class="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-gray-100 text-gray-400">
              <i class="fa-solid fa-chevron-down transition-transform"></i>
            </div>
          </div>
        </div>
        <div class="md:hidden absolute bottom-4 right-4 text-brand-blue text-xs font-bold bg-brand-light px-2 py-1 rounded-md">
          展开详情 <i class="fa-solid fa-chevron-down ml-1"></i>
        </div>
      </div>
      <div id="order-detail-${esc(order.id)}" class="hidden bg-gray-50/80 border-t border-gray-100 p-4 md:p-6 table-row-enter">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 class="text-gray-500 mb-3 text-xs uppercase tracking-wider font-bold"><i class="fa-solid fa-ticket-alt mr-1"></i> 出票结果</h4>
            ${order.status === "50" && codes.length > 0 ? `
              <div class="bg-white p-4 rounded-xl border border-green-100 shadow-sm">
                <div class="text-gray-400 text-xs mb-1 font-medium">取票码 / 验证码</div>
                <div class="font-mono font-bold text-xl text-gray-800 tracking-widest">${codes.map((code) => esc(code)).join("  ")}</div>
                <div class="text-xs text-gray-400 mt-2">座位：${seats.join("、") || `${order.ticketNum} 张`}</div>
              </div>` : order.status === "90" ? `
              <div class="bg-gray-50 p-4 rounded-xl border border-gray-100 text-gray-600 shadow-sm flex items-start gap-3">
                <div class="bg-gray-200 w-8 h-8 rounded-full flex items-center justify-center shrink-0"><i class="fa-solid fa-ban text-gray-500"></i></div>
                <div>
                  <div class="font-bold text-sm mb-1">订单已取消</div>
                  <div class="text-xs opacity-80">${esc(order.failureReason || "已取消并退款")}</div>
                </div>
              </div>` : order.status === "450" || order.status === "QUOTE_FAILED" ? `
              <div class="bg-red-50 p-4 rounded-xl border border-red-100 text-red-600 shadow-sm flex items-start gap-3">
                <div class="bg-red-100 w-8 h-8 rounded-full flex items-center justify-center shrink-0"><i class="fa-solid fa-times text-red-500"></i></div>
                <div>
                  <div class="font-bold text-sm mb-1">自动出票失败</div>
                  <div class="text-xs opacity-80">${esc(order.failureReason || "系统已取消该底单并标记异常")}</div>
                </div>
              </div>` : `
              <div class="bg-amber-50 p-4 rounded-xl border border-amber-100 text-amber-700 shadow-sm flex items-center gap-3">
                <div class="bg-amber-100 w-8 h-8 rounded-full flex items-center justify-center shrink-0"><i class="fa-solid fa-spinner fa-spin text-amber-600"></i></div>
                <div>
                  <div class="font-bold text-sm mb-1">正在处理中</div>
                  <div class="text-xs opacity-80">${statusInfo.label}，等待渠道确认</div>
                </div>
              </div>`}
          </div>
          <div>
            <h4 class="text-gray-500 mb-3 text-xs uppercase tracking-wider font-bold"><i class="fa-solid fa-history mr-1"></i> 执行时间线</h4>
            <div class="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
              <div class="relative">
                <div class="absolute left-[11px] top-6 bottom-2 w-0.5 bg-gray-100"></div>
                <div class="flex items-start gap-3 relative pb-4 pl-10">
                  <div class="absolute left-0 top-0 w-6 h-6 rounded-full bg-brand-light border-2 border-white flex items-center justify-center shrink-0 z-10">
                    <div class="w-2 h-2 rounded-full bg-brand-blue"></div>
                  </div>
                  <div>
                    <div class="font-bold text-gray-800 text-sm">平台下单，收到支付凭证</div>
                    <div class="text-gray-400 text-xs mt-0.5">${fmtTime(order.createdAt)}</div>
                  </div>
                </div>
                <div class="flex items-start gap-3 relative pl-10">
                  <div class="absolute left-0 top-0 w-6 h-6 rounded-full ${order.status === "50" ? "bg-green-50" : order.status === "90" || order.status === "450" ? "bg-red-50" : "bg-amber-50"} border-2 border-white flex items-center justify-center shrink-0 z-10">
                    <div class="w-2 h-2 rounded-full ${order.status === "50" ? "bg-green-500" : order.status === "90" || order.status === "450" ? "bg-red-500" : "bg-amber-400 animate-pulse"}"></div>
                  </div>
                  <div>
                    <div class="font-bold text-gray-800 text-sm">
                      ${order.status === "50" ? "渠道出票完成，回传验证码" : order.status === "90" ? "订单已取消，退款完成" : order.status === "450" ? "尝试出票，渠道返回异常" : "引擎锁定座位，等待渠道确认"}
                    </div>
                    <div class="text-gray-400 text-xs mt-0.5">${order.status === "50" || order.status === "90" ? "已完成" : "正在执行..."}</div>
                  </div>
                </div>
              </div>
              <div class="mt-4 pt-3 border-t border-gray-100 space-y-1.5 text-xs">
                <p class="flex justify-between"><span class="text-gray-500">上游单号</span><span class="font-mono">${esc(order.upstreamOrderNumber || "-")}</span></p>
                <p class="flex justify-between"><span class="text-gray-500">成本 / 售价</span><span>¥${money(order.netPrice)} / ¥${money(order.amount)}</span></p>
                <p class="flex justify-between"><span class="text-gray-500">场次</span><span>${esc(order.hallName || "-")}</span></p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function orderStatusInfo(status) {
  switch (status) {
    case "50": return { label: "已出票", cls: "bg-green-100 text-green-700 border-green-200" };
    case "30": return { label: "出票中", cls: "bg-amber-100 text-amber-700 border-amber-200" };
    case "25": return { label: "已改价", cls: "bg-blue-100 text-blue-700 border-blue-200" };
    case "20": return { label: "已报价", cls: "bg-purple-100 text-purple-700 border-purple-200" };
    case "90": return { label: "已取消", cls: "bg-gray-100 text-gray-600 border-gray-200" };
    case "450": return { label: "出票失败", cls: "bg-red-100 text-red-700 border-red-200" };
    case "QUOTE_FAILED": return { label: "报价失败", cls: "bg-red-100 text-red-700 border-red-200" };
    default: return { label: status, cls: "bg-gray-100 text-gray-600 border-gray-200" };
  }
}

/** 订单状态筛选匹配(按订单 status 值精确匹配)。 */
function orderMatchesFilter(order, filterValue) {
  return order.status === filterValue;
}

/** 页面内图片放大预览(lightbox):点击遮罩或图片关闭,不新开页面。 */
function showImageLightbox(url) {
  if (!url) return;
  // 复用已存在的浮层(避免重复叠加)
  let box = document.getElementById("image-lightbox");
  if (box) box.remove();
  box = document.createElement("div");
  box.id = "image-lightbox";
  box.style.cssText = [
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;",
    "background:rgba(16,21,37,0.72);backdrop-filter:blur(6px);",
    "padding:24px;cursor:zoom-out;"
  ].join("");
  const img = document.createElement("img");
  img.src = url;
  img.alt = "选座截图";
  img.style.cssText = "max-width:100%;max-height:92vh;object-fit:contain;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,0.5);background:#fff;";
  const close = () => box.remove();
  box.addEventListener("click", close);
  box.appendChild(img);
  document.body.appendChild(box);
  // Esc 关闭
  const onKey = (event) => {
    if (event.key === "Escape") {
      close();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);
}

function exportOrdersCsv() {
  const list = orders || [];
  const rows = [
    ["订单号", "影片", "城市", "影院", "影厅", "张数", "座位", "金额(元)", "成本(元)", "状态", "失败原因", "闲鱼订单", "上游单号", "创建时间"]
  ];
  for (const order of list) {
    const seats = (order.seatRowsCols || []).map((seat) => typeof seat === "string" ? seat : `${seat.row ?? ""}排${seat.col ?? ""}座`).join("|");
    rows.push([
      order.id,
      order.filmName,
      order.cityName,
      order.cinemaName,
      order.hallName || "",
      String(order.ticketNum),
      seats,
      String(order.amount),
      String(order.netPrice),
      orderStatusInfo(order.status).label,
      order.failureReason || "",
      order.xianyuOrderId || "",
      order.upstreamOrderNumber || "",
      fmtTime(order.createdAt)
    ]);
  }
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `订单导出_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("订单已导出");
}

// —— 资金统计 ——

function renderFinance() {
  const o = overview;
  return `
    <div class="space-y-4 md:space-y-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
        <div class="rounded-saas p-4 md:p-6 bg-gradient-to-r from-blue-50 to-white border border-blue-100 shadow-sm">
          <div class="text-gray-500 text-sm mb-1 font-medium">累计成交额</div>
          <div class="text-2xl md:text-3xl font-bold text-gray-800 truncate">¥ ${money(o.today.totalRevenue)}</div>
          <div class="text-xs text-gray-400 mt-1">近 7 日</div>
        </div>
        <div class="rounded-saas p-4 md:p-6 bg-gradient-to-r from-purple-50 to-white border border-purple-100 shadow-sm">
          <div class="text-gray-500 text-sm mb-1 font-medium">订单总数</div>
          <div class="text-2xl md:text-3xl font-bold text-gray-800">${o.today.totalOrders} <span class="text-sm font-normal text-gray-500">笔</span></div>
          <div class="text-xs text-gray-400 mt-1">待处理 ${o.today.pending}</div>
        </div>
        <div class="rounded-saas p-4 md:p-6 bg-gradient-to-r from-red-50 to-white border border-red-100 shadow-sm">
          <div class="text-gray-500 text-sm mb-1 font-medium">异常订单</div>
          <div class="text-2xl md:text-3xl font-bold text-gray-800">${o.today.failed} <span class="text-sm font-normal text-gray-500">笔需核对</span></div>
          <div class="text-xs text-gray-400 mt-1">已取消 ${o.today.cancelled}</div>
        </div>
      </div>
      <div class="glass-card rounded-saas p-4 md:p-6">
        <h3 class="text-lg font-bold text-gray-800 mb-4">近 7 日成交走势</h3>
        ${dailyRevenueChart(o.daily || [])}
      </div>
    </div>
  `;
}

// —— 系统设置 ——

function renderSettings() {
  const o = overview;
  return `
    <div class="max-w-2xl space-y-4 md:space-y-6">
      <div class="glass-card rounded-saas p-4 md:p-6">
        <h3 class="text-base md:text-lg font-bold text-gray-800 mb-4 md:mb-6 border-b pb-4">系统状态</h3>
        <div class="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 gap-4">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl bg-brand-light text-brand-blue flex items-center justify-center text-xl shadow-sm shrink-0">
              <i class="fa-solid fa-robot"></i>
            </div>
            <div>
              <div class="font-bold text-gray-800">自动化引擎</div>
              <div class="text-xs md:text-sm text-gray-500">负责监控价格与自动出票</div>
            </div>
          </div>
          <div class="bg-white px-3 py-1.5 rounded-lg border border-gray-100 shadow-sm self-start sm:self-auto flex items-center gap-2">
            <div class="relative flex h-3 w-3">
              ${o.automationEnabled ? `<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-green opacity-75"></span>
              <span class="relative inline-flex rounded-full h-3 w-3 bg-brand-green"></span>` : `<span class="relative inline-flex rounded-full h-3 w-3 bg-gray-400"></span>`}
            </div>
            <span class="text-sm font-medium ${o.automationEnabled ? "text-brand-green" : "text-gray-500"}">${o.automationEnabled ? "运行中" : "离线"}</span>
          </div>
        </div>
      </div>
      <div class="glass-card rounded-saas p-4 md:p-6">
        <h3 class="text-base md:text-lg font-bold text-gray-800 mb-4 md:mb-6 border-b pb-4">账号设置</h3>
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div class="font-bold text-gray-800">当前登录账号</div>
            <div class="text-sm text-gray-500 mt-0.5">admin</div>
          </div>
          <span class="self-start sm:self-auto px-3 py-1 rounded-full text-xs font-medium border bg-green-100 text-green-700 border-green-200">已登录</span>
        </div>
        <div class="mt-6 pt-6 border-t flex justify-end">
          <button type="button" data-action="logout" class="w-full sm:w-auto text-red-500 hover:text-white bg-red-50 hover:bg-red-500 px-6 py-2.5 rounded-xl transition-all font-bold shadow-sm">
            退出登录
          </button>
        </div>
      </div>
    </div>
  `;
}

// —— 图表（SVG 版，覆盖原型 Chart.js 视觉） ——

function dailyTrendChart(daily) {
  if (!daily || daily.length === 0) return '<div class="text-gray-400 text-sm py-8 text-center">暂无数据</div>';
  const width = 620, height = 250;
  const padding = { top: 18, right: 20, bottom: 34, left: 42 };
  const maxRevenue = Math.max(...daily.map((item) => item.revenue), 1);
  const maxOrders = Math.max(...daily.map((item) => item.count), 1);
  const step = (width - padding.left - padding.right) / Math.max(daily.length - 1, 1);
  const barWidth = Math.min(34, step * 0.42);
  const points = daily.map((item, index) => {
    const x = padding.left + index * step;
    const y = scaleY(item.count, maxOrders, height, padding);
    return `${x},${y}`;
  }).join(" ");
  return `
    <div class="chart-legend"><span><i class="legend-bar"></i>订单量</span><span><i class="legend-line"></i>成交额</span></div>
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="近 7 日订单与成交额趋势图">
      ${gridLines(width, height, padding)}
      ${daily.map((item, index) => {
        const x = padding.left + index * step - barWidth / 2;
        const barHeight = ((height - padding.top - padding.bottom) * item.revenue) / maxRevenue;
        const y = height - padding.bottom - barHeight;
        return `<rect class="chart-bar" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4"><title>${item.date} 成交额 ￥${money(item.revenue)}</title></rect>`;
      }).join("")}
      <polyline class="chart-line success" points="${points}" fill="none"></polyline>
      ${daily.map((item, index) => {
        const x = padding.left + index * step;
        const y = scaleY(item.count, maxOrders, height, padding);
        return `<circle class="chart-dot success" cx="${x}" cy="${y}" r="4"><title>${item.date} ${item.count} 单</title></circle>`;
      }).join("")}
      ${axisLabels(daily.map((item) => item.date), width, height, padding)}
    </svg>
  `;
}

function lineChart(points, unit = "") {
  if (!points || points.length === 0) return '<div class="text-gray-400 text-sm py-8 text-center">暂无数据</div>';
  const width = 620, height = 250;
  const padding = { top: 18, right: 20, bottom: 34, left: 42 };
  const maxValue = Math.max(...points.map((item) => item.value), 1);
  const minValue = Math.min(...points.map((item) => item.value), 0);
  const range = Math.max(maxValue - minValue, 1);
  const step = (width - padding.left - padding.right) / Math.max(points.length - 1, 1);
  const coords = points.map((item, index) => {
    const x = padding.left + index * step;
    const y = padding.top + ((maxValue - item.value) / range) * (height - padding.top - padding.bottom);
    return { ...item, x, y };
  });
  const line = coords.map((item) => `${item.x},${item.y}`).join(" ");
  const area = `${padding.left},${height - padding.bottom} ${line} ${padding.left + (points.length - 1) * step},${height - padding.bottom}`;
  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="趋势曲线图">
      ${gridLines(width, height, padding)}
      <polygon class="chart-area" points="${area}"></polygon>
      <polyline class="chart-line primary" points="${line}" fill="none"></polyline>
      ${coords.map((item) => `<circle class="chart-dot" cx="${item.x}" cy="${item.y}" r="4"><title>${item.label} ${item.value}${unit}</title></circle>`).join("")}
      ${axisLabels(points.map((item) => item.label), width, height, padding)}
    </svg>
  `;
}

function dailyRevenueChart(daily) {
  if (!daily || daily.length === 0) return '<div class="text-gray-400 text-sm py-8 text-center">暂无数据</div>';
  const width = 620, height = 250;
  const padding = { top: 18, right: 20, bottom: 34, left: 42 };
  const maxValue = Math.max(...daily.map((item) => item.revenue), 1);
  const step = (width - padding.left - padding.right) / Math.max(daily.length - 1, 1);
  const points = daily.map((item, index) => {
    const x = padding.left + index * step;
    const y = scaleY(item.revenue, maxValue, height, padding);
    return `${x},${y}`;
  }).join(" ");
  return `
    <div class="chart-legend"><span><i class="legend-line"></i>成交额</span></div>
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="近 7 日成交额走势">
      ${gridLines(width, height, padding)}
      <polyline class="chart-line primary" points="${points}" fill="none"></polyline>
      ${daily.map((item, index) => {
        const x = padding.left + index * step;
        const y = scaleY(item.revenue, maxValue, height, padding);
        return `<circle class="chart-dot" cx="${x}" cy="${y}" r="4"><title>${item.date} ￥${money(item.revenue)}</title></circle>`;
      }).join("")}
      ${axisLabels(daily.map((item) => item.date), width, height, padding)}
    </svg>
  `;
}

function statusBars(items) {
  const total = items.reduce((sum, item) => sum + item.count, 0) || 1;
  return `<div class="space-y-4">${items.map((item) => {
    const percent = Math.round((item.count / total) * 100);
    const cls = item.status === "50" ? "bg-green-500" : item.status === "90" ? "bg-gray-400" : item.status === "QUOTE_FAILED" || item.status === "450" ? "bg-red-500" : "bg-amber-400";
    return `
      <div>
        <div class="flex justify-between text-sm mb-1">
          <span class="text-gray-600">${esc(item.label)}</span>
          <span class="font-bold ${item.status === "50" ? "text-green-600" : item.status === "90" ? "text-gray-500" : item.status === "QUOTE_FAILED" || item.status === "450" ? "text-red-500" : "text-amber-500"}">${item.count}</span>
        </div>
        <div class="w-full bg-gray-100 rounded-full h-2">
          <div class="${cls} h-2 rounded-full" style="width:${percent}%"></div>
        </div>
      </div>
    `;
  }).join("")}</div>`;
}

function cityRankBars(items) {
  if (!items || items.length === 0) return '<div class="text-gray-400 text-sm py-6 text-center">暂无数据</div>';
  const maxValue = Math.max(...items.map((item) => item.count), 1);
  return `<div class="space-y-4">${items.map((item, index) => `
    <div class="flex items-center justify-between p-2 hover:bg-white/50 rounded-lg transition">
      <div class="flex items-center gap-3">
        <div class="w-7 h-7 rounded-lg bg-brand-light text-brand-blue flex items-center justify-center text-xs font-bold shadow-sm">${index + 1}</div>
        <span class="text-sm font-medium">${esc(item.city)}</span>
      </div>
      <span class="text-sm font-bold text-gray-700">${item.count} 单 · ¥${money(item.revenue)}</span>
    </div>
  `).join("")}</div>`;
}

function ordersTable(list) {
  if (!list || list.length === 0) return '<div class="text-gray-400 text-sm py-6 text-center">暂无订单</div>';
  return `
    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse min-w-[500px]">
        <thead>
          <tr class="border-b border-gray-100 text-sm text-gray-500">
            <th class="pb-3 font-medium px-2">订单号</th>
            <th class="pb-3 font-medium px-2">影片 / 影院</th>
            <th class="pb-3 font-medium px-2 text-right">金额</th>
            <th class="pb-3 font-medium px-2 text-center">状态</th>
          </tr>
        </thead>
        <tbody class="text-sm">
          ${list.map((order) => {
            const info = orderStatusInfo(order.status);
            return `
              <tr class="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition cursor-pointer">
                <td class="py-3 px-2 font-mono text-gray-600">${esc(order.id.slice(0, 12))}</td>
                <td class="py-3 px-2">
                  <div class="font-bold text-gray-800">${esc(order.filmName)}</div>
                  <div class="text-xs text-gray-500 mt-0.5">${esc(order.cinemaName)}</div>
                </td>
                <td class="py-3 px-2 font-bold text-brand-blue text-right">¥${money(order.amount)}</td>
                <td class="py-3 px-2 text-center">
                  <span class="px-3 py-1 rounded-full text-xs font-medium border ${info.cls}">${info.label}</span>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// —— 工具 ——

function gridLines(width, height, padding) {
  const usable = height - padding.top - padding.bottom;
  return [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = padding.top + usable * ratio;
    return `<line class="chart-grid-line" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"></line>`;
  }).join("");
}

function axisLabels(labels, width, height, padding) {
  const step = (width - padding.left - padding.right) / Math.max(labels.length - 1, 1);
  return labels.map((label, index) => {
    const x = padding.left + index * step;
    return `<text class="chart-axis-label" x="${x}" y="${height - 10}" text-anchor="middle">${esc(label)}</text>`;
  }).join("");
}

function scaleY(value, maxValue, height, padding) {
  return height - padding.bottom - ((height - padding.top - padding.bottom) * value) / Math.max(maxValue, 1);
}

function fmtTime(unixSeconds) {
  if (!unixSeconds) return "-";
  const d = new Date(unixSeconds * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// —— 启动 ——

(async function boot() {
  if (token) {
    try {
      await loadAll();
    } catch (error) {
      token = "";
      localStorage.removeItem(TOKEN_KEY);
    }
  }
  render();
})();
