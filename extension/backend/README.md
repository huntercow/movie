# 业务后端(FastAPI)

插件(中间人)的业务后端:订单状态机(20→25→30→50/90/450)、良票对接
(OCR/双通道报价/下单/支付/出票)、后端报价策略、话术配置下发。

## 启动

```bash
# 1. 依赖(首次)
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt

# 2. 配置环境变量(见下)

# 3. 启动
backend/.venv/Scripts/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `APP_ADMIN_USERNAME` / `APP_ADMIN_PASSWORD` | 是 | 插件 manage 页登录账号(首版单账号) |
| `APP_AUTH_JWT_SECRET` | 是 | JWT 签名密钥(生产必须改) |
| `APP_DB_PATH` | 否 | SQLite 路径,默认 `backend/data/app.db` |
| `LIANGPIAO_USER_NAME` / `LIANGPIAO_PASSWORD` | 是 | 良票账号(后端自动登录/401 自动重登) |
| `LIANGPIAO_BASE_URL` / `LIANGPIAO_ORIGIN` | 否 | 良票 API/H5 地址(有默认) |
| `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_BUCKET` / `OSS_REGION` / `OSS_UPLOAD_DIR` | 是 | 阿里云 OSS(报价截图上传,良票 OCR 需要公网 URL) |
| `QUOTE_FLOAT_CENTS` | 否 | 固定加价(分),默认 500 |
| `QUOTE_DIFF_THRESHOLD_CENTS` | 否 | 差价阈值(分),默认 0 |
| `QUOTE_DIFF_MARKUP_PERCENT` | 否 | 加价系数(%),默认 0 |

## 接口(与插件 springBackendApi.ts 契约一一对应)

统一信封 `{code, message, data, requestId}`,code===0 且 2xx 为成功;
HTTP 401 → 插件判 TOKEN_INVALID。

- `POST /api/v1/auth/login` — 登录换 JWT
- `POST /api/v1/plugin/sync` — 设备注册 + 状态同步
- `PUT /api/v1/plugin/automation` — 自动化开关(修订号递增)
- `GET /api/v1/plugin/reply-config` — 话术模板 + 关键词规则(10 模板,来自根目录 JSON)
- `POST /api/v1/plugin/ai-reply` — 恒返回 `{reply: null}`(AI 已排除,关键词未命中静默)
- `POST /api/v1/plugin/quote-image` — 报价(下载→OSS→OCR→双通道→后端定价→订单 20)
- `POST /api/v1/plugin/orders/waiting-payment` — 查 status 20
- `POST /api/v1/plugin/orders/price-adjusted` — 回写 25(闲鱼改价后)
- `POST /api/v1/plugin/orders/buyer-paid` — 回写 30 并触发良票下单+支付
- `POST /api/v1/plugin/orders/platform-cancel-result` — 回写 90
- `POST /api/v1/plugin/orders/by-status` — 查 status 25
- `POST /api/v1/plugin/orders/ticket-results` — 推进 30→50/450,返回待交付
- `POST /api/v1/plugin/orders/delivery-result` — 交付结算(成功/失败转 45/已处理)

## 报价策略(后端定价)

```
基础报价 = max(限价, 一口价) + 固定加价
若 基础报价 - 成本 > 差价阈值:报价 += (基础报价 - 成本) × 加价系数%
```

## 测试

```bash
backend/.venv/Scripts/python -m unittest backend.test_backend -v
```
