@echo off
rem 闲鱼电影票业务后端启动脚本(Windows)
rem 首次使用:把下面的密码/JWT 密钥改成你自己的;配好良票/OSS 变量即可全链路
cd /d %~dp0..

set APP_ADMIN_USERNAME=admin
set APP_ADMIN_PASSWORD=admin123
set APP_AUTH_JWT_SECRET=dev-secret-change-me-please-32-bytes-min

rem ---- 良票与 OSS(报价/下单/出票需要,关键词回复不需要) ----
rem set LIANGPIAO_USER_NAME=你的良票账号
rem set LIANGPIAO_PASSWORD=你的良票密码
rem set OSS_ACCESS_KEY_ID=xxx
rem set OSS_ACCESS_KEY_SECRET=xxx
rem set OSS_BUCKET=xxx
rem set OSS_REGION=oss-cn-beijing
rem set OSS_UPLOAD_DIR=ticket-img

rem ---- 报价策略(可选,默认 加价5元 / 差价阈值0 / 系数0%) ----
rem set QUOTE_FLOAT_CENTS=500
rem set QUOTE_DIFF_THRESHOLD_CENTS=0
rem set QUOTE_DIFF_MARKUP_PERCENT=0

echo 启动后端 http://127.0.0.1:8000 ...
backend\.venv\Scripts\python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
