# 影票智营 Pro — 电影票自动报价发货系统

闲鱼电影票自动报价、改价、出票、发货的一体化解决方案：浏览器插件 + FastAPI 业务后端 + Web 管理页。

买家在闲鱼发选座截图 → 自动识别影片场次 → 双通道官方报价 → 定价话术 → 买家付款 → 自动下单出票 → 取票码交付，全程自动化。

## 截图

| | |
|---|---|
| **Web 管理页 · 经营总览** | **Web 管理页 · 订单列表** |
| ![概览](extension/docs/screenshots/shot_overview.png) | ![订单](extension/docs/screenshots/shot_orders.png) |
| **报价策略** | **资金统计** |
| ![报价](extension/docs/screenshots/shot_quote.png) | ![资金](extension/docs/screenshots/shot_finance.png) |
| **插件弹窗** | **闲鱼页面悬浮挂件** |
| ![弹窗](extension/docs/screenshots/shot_popup.png) | ![挂件](extension/docs/screenshots/shot_widget.png) |

> 更多界面：插件控制台（话术模板/关键词规则/规则测试）、Web 管理页系统设置等，见 `extension/` 目录源码。

## 架构

```
闲鱼 IM 页面 ──► 浏览器插件(extension/src) ──► FastAPI 后端(extension/backend) ──► 上游票务服务
                      │                              │
                      └── 页面侧动作(改价/取消/发消息)  └── OSS 上传 / OCR / 报价 / 下单 / 出票
```

- **插件**（`extension/`，TypeScript + Vite）：拦截闲鱼 WebSocket 消息、识别事件、编排业务链路、悬浮挂件、页面侧 MTop 动作
- **后端**（`extension/backend/`，Python FastAPI）：订单状态机、上游对接（OCR / 双通道报价 / 下单 / 支付 / 出票）、报价策略、话术配置下发
- **Web 管理页**（`extension/backend/web/`）：经营总览、订单列表、报价策略、资金统计、系统设置，支持移动端

## 功能

- **自动报价**：选座截图 → OCR 识别 → 限价/一口价双通道 → 取较高正价 + 加价策略 → 话术报价
- **改价催付**：买家拍下后金额不一致自动改价并催付
- **付款校验**：校验实际付款金额，一致则上游下单支付，不一致自动取消退款
- **自动出票**：轮询出票状态 → 取票码/票图交付 → 失败自动通知退款
- **话术管理**：插件控制台编辑话术模板与关键词回复，写回后端即时生效
- **悬浮挂件**：闲鱼页面右下角胶囊，开关/状态/最近事件一目了然
- **运营看板**：订单趋势、报价成功率、状态分布、城市排行、资金走势

## 快速开始

### 1. 启动后端

```bash
cd extension
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt

# Windows 直接运行(含全部环境变量示例)
backend/run.bat

# 或手动设置环境变量后启动
export APP_AUTH_JWT_SECRET=your-jwt-secret
export LIANGPIAO_USER_NAME=your-account
export LIANGPIAO_PASSWORD=your-password
export OSS_ACCESS_KEY_ID=xxx
export OSS_ACCESS_KEY_SECRET=xxx
export OSS_BUCKET=your-bucket
export OSS_REGION=oss-cn-beijing
backend/.venv/Scripts/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

必需环境变量：

| 变量 | 说明 |
|---|---|
| `APP_AUTH_JWT_SECRET` | JWT 签名密钥（生产必须改） |
| `LIANGPIAO_USER_NAME` / `LIANGPIAO_PASSWORD` | 上游票务账号（报价/出票需要） |
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` | 阿里云 OSS 凭证（图片上传需要） |
| `OSS_BUCKET` / `OSS_REGION` | OSS 桶与区域 |

可选：`APP_ADMIN_USERNAME/PASSWORD`（默认 admin/admin123）、`QUOTE_FLOAT_CENTS` 等报价策略、`APP_DB_PATH`。

### 2. 安装插件

1. 构建：`cd extension && npm install && npm run build`
2. Chrome 打开 `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择 `extension/dist`
3. 打开闲鱼 IM 页面，右下角出现悬浮挂件

### 3. 登录与配置

1. 浏览器打开 `http://127.0.0.1:8000/admin/` 登录（admin/admin123）
2. 插件弹窗 → 打开业务控制台 → 上游接入：填后端地址 `http://127.0.0.1:8000` + 登录
3. 控制台「话术模板」「关键词规则」按需调整，保存即生效
4. 弹窗开启「自动工作」

## 订单状态机

```
报价(20) → 已改价(25) → 出票中(30) → 已出票(50)
              │              │
              └─ 取消(90)     └─ 出票失败(450)
```

## 项目结构

```
extension/
├── src/                 插件源码(TypeScript)
│   ├── webhook/         页面 hook / 消息识别 / 悬浮挂件 / 发消息
│   ├── handlers/        业务控制器 / 自动化 / 后端客户端
│   ├── ui/              popup 与控制台
│   └── upstream/        后端地址配置
├── backend/             FastAPI 后端
│   ├── main.py          全部 API 路由
│   ├── quote.py         报价链路
│   ├── orders.py        订单状态机
│   ├── liangpiao_client.py  上游客户端
│   ├── web/             Web 管理页
│   └── data/            SQLite(运行时生成,不入库)
├── test/                插件测试
├── docs/screenshots/    界面截图
└── manifest.json        Chrome 扩展清单
```

## 安全说明

- **凭证全部走环境变量**，代码不内置任何真实账号/密钥
- 生产部署请修改 `APP_ADMIN_PASSWORD` 与 `APP_AUTH_JWT_SECRET`
- 阿里云 OSS AccessKey 建议使用最小权限子账号

## 遗留说明

仓库根目录保留旧版 Java/Spring Boot 后端（`pom.xml`、`src/`、`web/`）与旧版插件（`extension/` 已被本次重构替换）。当前维护以 `extension/` 为准，旧 Spring 后端仅作历史参考。

## 开发

- 插件测试：`cd extension && npm test`（244 用例）
- 后端测试：`cd extension && backend/.venv/Scripts/python -m unittest backend.test_backend`
- 业务开发地图：`extension/docs/业务开发地图.md`（消息链路与常见改动点）
