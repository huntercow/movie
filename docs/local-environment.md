# 本地运行环境

项目当前按“Linux 开发、Windows 测试”拆成两套本地 profile：

- Linux 开发：`SPRING_PROFILES_ACTIVE=linux-dev`
- Windows 测试：`SPRING_PROFILES_ACTIVE=windows-test`

两套 profile 都默认：

- 监听 `0.0.0.0:8080`，方便 Windows 浏览器访问 WSL/Linux 后端。
- 使用本机 MySQL：`movie_ticket` / `movie_ticket` / `change-me`。
- 使用本机 Redis：`127.0.0.1:6379`。
- `ticket.upstream.mock-enabled=true`，不调用真实上游。
- `ticket.xianyu.auto-fulfillment-enabled=false`，付款事件只进人工处理，不自动出票。
- 管理接口 token：`local-admin-token`，请求头为 `X-Admin-Token`。
- 插件和机器人使用用户控制台创建、管理员设置有效期后的 Token。

## Linux 开发启动

当前 WSL 用户级工具链安装在 `/home/hunter/.local/opt`：

- Temurin JDK 17：`/home/hunter/.local/opt/jdk-17`
- Maven：`/home/hunter/.local/opt/maven`
- Node.js 22：`/home/hunter/.local/opt/node`

`/home/hunter/.local/bin` 中提供稳定命令链接，`JAVA_HOME` 已写入当前用户的 `.profile` 和 `.bashrc`。Windows JDK 的 `java.exe` 不能作为 Linux Maven 的 JDK 使用。

项目的便携 MySQL 与 Redis 绑定在 `127.0.0.1`，不会监听局域网地址。使用以下命令管理：

```bash
cd /home/hunter/workspace/Movie
bash scripts/dev-services-linux.sh start
bash scripts/dev-services-linux.sh status
```

然后使用安全的 `linux-dev` profile 启动后端。该 profile 强制使用 mock 上游并关闭自动履约：

```bash
cd /home/hunter/workspace/Movie
bash scripts/dev-linux.sh
```

停止本地依赖服务：

```bash
bash scripts/dev-services-linux.sh stop
```

## Windows 测试启动

在 PowerShell 里运行：

```powershell
cd D:\workspace\Movie
.\scripts\test-windows.ps1
```

脚本会优先使用：

- JDK：`C:\Users\Admin\.jdks\ms-21.0.10`
- Maven：`E:\tools\apache-maven-3.9.14\bin`

Chrome 插件的后端地址保持：

```text
http://127.0.0.1:8080
```

插件 Token 使用用户控制台创建的值，并同时携带插件生成的 installation ID：

```text
X-Plugin-Token: <用户 Token>
X-Plugin-Installation-Id: <插件 installation ID>
```

直接调用报价、订单或上游接口时增加：

```text
X-Admin-Token: local-admin-token
```

调用 `/api/bot/**` 时增加：

```text
X-Bot-Token: <用户 Token>
X-Bot-Installation-Id: <机器人 installation ID>
```

## 插件构建

Linux 或 Windows 都可以进入 `extension` 构建：

```bash
cd extension
npm install
npm run typecheck
npm run build
```

`node_modules` 里包含 Rollup/esbuild 的平台原生包。Linux 和 Windows 共用同一个项目目录时，如果切换平台后 build 提示缺少 `@rollup/rollup-*` 或 `@esbuild/*`，在当前平台重新执行一次 `npm install`。

Windows Chrome 加载目录：

```text
D:\workspace\Movie\extension\dist
```

## 切换真实联调

真实 OCR、真实报价、真实下单、真实支付前，不要直接改这两个本地 profile。建议继续使用未提交的 `src/main/resources/application.yml` 放真实账号和密钥，并按 `docs/integration-runbook.md` 的步骤逐项打开。
