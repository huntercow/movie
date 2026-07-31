# TDD 基础设施启动计划

**目标：** 在不夹带业务功能的前提下，为票务自动经营平台建立后端、Web、扩展和 CI 的可审计 TDD 门禁。

**策略基线：** `docs/testing/tdd-strategy.md`

**产品基线：** `docs/prd/2026-07-30-ticket-automation-platform-v1-prd.md`

## Phase A：I046 后端测试分层

1. 先为 Maven 测试分层写构建合同测试或最小失败验证，证明当前没有 `integration` Profile 和 JaCoCo 报告。
2. 引入 JaCoCo、Testcontainers MySQL 和 Maven Profile；默认 `mvn test` 保持快速。
3. 建立 `unit`、`contract`、`integration`、`support` 目录约定，不批量移动存量测试。
4. 加入最小 MockMvc 安全合同示例和真实 MySQL/Flyway/Repository 示例。
5. 增加 Testcontainers JDBC 地址保护；Docker 不可用时集成命令明确失败。
6. 记录 Red/Green、122 个测试基线、新增测试数量和两条命令耗时。

验收命令：

```bash
mvn test
mvn verify -Pintegration
git diff --check
```

## Phase B：I047 Web 测试基础

1. 先写严格 `ApiResponse` decoder 的失败测试，证明当前缺少测试命令和 decoder 门禁。
2. 引入 Vitest、Vue Test Utils、jsdom、Testing Library Vue、user-event 和 coverage。
3. 建立合同、路由、组件和 Fixture 目录。
4. 加入严格 decoder、401 清理、角色路由隔离和管理员无业务入口的最小测试。
5. 保持 `/console/` 构建基路径和现有构建产物同步规则。
6. 记录首次 Web 测试数量，作为后续不可退化基线。

验收命令：

```bash
cd web
npm test
npm run test:coverage
npm run build
git diff --check
```

## Phase C：I048 CI 与主干保护

1. 创建 PR 模板，要求 Issue 和 Red/Green/Refactor 证据。
2. 创建五个固定名称的 CI Job，并固定 Action 完整 commit SHA。
3. CI 运行后端快速测试、MySQL 集成、Web 测试构建、扩展测试构建、文档/差异/secrets 检查。
4. 先在 PR 上运行全部 Job，修复工作流问题，不允许用 skip 或 fallback 变绿。
5. 五个 Job 至少成功一次后，启用 `main` 分支保护；管理员不能绕过。
6. 记录 Required Checks 和保护配置作为交付证据。

验收命令：

```bash
gh run list --repo huntercow/movie
gh api repos/huntercow/movie/branches/main/protection
git diff --check
```

## Phase D：Wave 0 接入

1. `I001`、`I002` 复核已有 Red/Green 证据并通过新 CI。
2. `I003`、`I005`、`I006`、`I008` 使用真实合同/数据库门禁。
3. Web 业务 Issue 使用 I047 Fixture 和路由/组件测试基础。
4. 任何强制门禁未运行时，Issue 保持 `verification`。

## 非目标

- 不在基础设施 Issue 中实现 Token、账号、订单、WebSocket 或 UI 产品能力。
- 不使用 H2 代替 MySQL。
- 不一次性重排全部存量测试。
- 不在基础设施阶段引入全量 Playwright、PIT 或全仓覆盖率硬阈值。
- 不安装 Docker 作为本计划文档阶段的隐式系统修改。
