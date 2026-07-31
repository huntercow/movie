# 票务自动经营平台 TDD 策略

## 1. 目的与适用范围

本策略适用于后端、Web 控制台、Chrome 扩展、数据库迁移和跨模块合同。它定义 V1 实施期间可审计的测试驱动开发门禁，但不替代 PRD、领域词汇、ADR 或具体 Issue 的验收标准。

TDD 的目标不是制造覆盖率数字，而是在副作用发生前证明业务规则、安全边界和协议合同。代码存在、构建成功或补写测试都不能替代 Red -> Green -> Refactor。

## 2. 已确认基线

2026-07-30 在当前工作区执行：

| 模块 | 命令 | 结果 | 已知缺口 |
| --- | --- | --- | --- |
| 后端 | `mvn test` | 122 个测试通过，0 失败，0 跳过 | 无真实 MySQL、Flyway、Repository 并发和完整安全链集成测试 |
| 扩展 | `npm test` | 139 个测试通过，0 失败，0 跳过 | 无真实 MV3 休眠/恢复和后端 WebSocket 集成环境 |
| 扩展 | `npm run typecheck && npm run build` | 通过 | 不证明浏览器运行时生命周期 |
| Web | `npm run build` | 类型检查和构建通过 | 尚无组件、合同或端到端自动化测试 |

已知非阻塞警告：Maven classpath 的 Commons Logging 提示，以及 Web 约 1.1 MB JavaScript chunk 警告。二者属于 Engineering Backlog；新增警告不得无追踪地进入基线。

当前机器没有 Docker/Podman，仓库当前没有 CI。真实 MySQL 集成门禁建立后，本机未运行该门禁时，受影响 Issue 最多进入 `verification`，不得进入 `done`。

## 3. 核心循环

### 3.1 新行为

1. 先写因目标行为缺失而失败的测试。
2. 确认失败来自业务行为缺失，而非编译错误、环境错误或无关旧测试。
3. 写最小实现使同一测试通过。
4. 在测试保持绿色时重构。
5. 运行 Issue 定向测试；达到模块或 Epic 边界时运行完整套件。

### 3.2 存量行为

- 先写 Characterization Test 固定当前可观察行为，再开始修改。
- 当前行为违反 PRD 时，特征测试只作为迁移证据，不永久保护错误行为。
- 若未提交实现已经满足目标，不制造虚假 Red；记录 `existing implementation verified`，再寻找尚未覆盖的规则。
- 删除危险能力时先写负向失败测试，例如管理员无法访问业务订单，再删除入口。

### 3.3 Discovery

Discovery Issue 使用 `Hypothesis -> Failing Contract Fixture -> Confirmed Contract`。产物是脱敏样本、可执行断言、冻结合同或明确阻塞，不夹带业务实现，也不能以“继续研究”结束。

## 4. 测试金字塔

### 4.1 领域单元测试

- 使用 JUnit 5 和 Mockito。
- 覆盖状态机、动作白名单、期限、Fail Fast 和失败前无副作用。
- 优先断言业务结果和状态；`verify` 仅证明必要外部调用发生或未发生。

### 4.2 持久化集成测试

- 使用 Testcontainers MySQL，不使用 H2 代表 MySQL。
- 执行完整 Flyway，不使用 `ddl-auto` 代替 schema。
- 覆盖用户范围查询、唯一约束、事务、锁、幂等键、generation fencing 和迁移。
- `mvn verify -Pintegration` 在 Docker 不可用时必须失败，禁止静默跳过。

### 4.3 API 安全合同测试

- 使用 Spring Boot Test + MockMvc，并经过真实 Security Filter/Interceptor。
- 覆盖公开、业务用户、管理员、插件和机器人边界。
- 严格断言状态码、响应结构和敏感字段不存在。

### 4.4 消费者和跨模块测试

- 后端 DTO、OpenAPI 和 WebSocket schema 是协议权威来源。
- Web 与扩展使用经评审的版本化 Fixture 验证严格解码。
- 成功、已定义错误、缺字段、错类型、未知状态和未知消息都必须测试。
- Playwright 延后到纵向闭环与 GA；Wave 0 使用 Vitest 和扩展 Node 测试。

## 5. 后端与数据库规则

### 5.1 测试结构

```text
src/test/java/com/movie/ticket/
├── unit/
├── contract/
├── integration/
└── support/
```

新增测试按业务能力命名，例如 `TokenApprovalLifecycleTest`。方法使用 `should...when...`。存量测试只在相关 Issue 修改时渐进迁移，不进行一次性目录重排。

### 5.2 数据库隔离

- 每个集成测试任务使用独立 MySQL 容器，禁止连接开发库、共享测试库或生产库。
- 测试配置必须拒绝非 Testcontainers JDBC 地址。
- 普通 Repository 测试可事务回滚。
- 并发接管、唯一约束、幂等、异步、锁、迁移和审计测试必须显式提交并从新事务读取。
- 并发测试使用独立连接和同步屏障，禁止 `Thread.sleep()` 猜顺序。
- 迁移测试从明确旧版本 schema/Fixture 开始，不只验证空库启动。

### 5.3 时间、标识和异步

- 业务时间注入 `java.time.Clock`；生产使用 UTC，持久化使用 `Instant`。
- 营业时间显式携带账号时区，不使用服务器默认时区。
- Token、attempt 和幂等标识通过窄生成器注入确定性测试序列。
- 单元测试不使用真实睡眠；使用可控时钟、同步执行器或显式事件推进。
- 异步测试验证 `UserScopeContext` 保存、恢复和异常路径清理。

## 6. Mock 与可测试性边界

允许 Mock 外部网络客户端、通知出口和不属于当前目标的昂贵边界。禁止 Mock 被测领域对象、DTO、值对象、协议 decoder，以及本测试需要证明的 Repository、Flyway、事务、锁和安全链。

允许为确定性引入 `Clock`、标识生成器、外部端口、事件发布端口和可替换执行器。禁止生产测试后门、万能 Token、跳过鉴权、测试删除 API，以及为直接测试而公开私有方法。只为外部边界或真实替换需求引入接口，不把所有类接口化。

## 7. 决策表与边界测试

以下领域必须先写决策表，再用参数化测试覆盖全部组合：

- Token 生命周期；
- Execution Authorization 与 generation；
- Order Task 类型、状态、动作、SLA 和暂缓；
- 付款、金额、上游结果和 Delivery Attempt；
- 五类调用方与 API 分类权限。

决策表明确允许路径、禁止路径、错误语义、状态变化、外部副作用和审计要求。新增状态或动作必须迫使开发者更新矩阵，未知枚举不能进入默认业务分支。

金额、时间区间、generation 和协议解码使用参数化边界测试。属性测试和 Mutation Testing 仅在高风险纯规则定向试点，不作为 Wave 0 全仓门禁，也不替代决策表。

## 8. Web 与扩展

### 8.1 Web

引入 Vitest、Vue Test Utils、jsdom、Testing Library Vue 和 user-event。Wave 0 优先覆盖：

- `ApiResponse` 严格解码；
- 401 清理登录态；
- 业务用户与管理员路由隔离；
- 管理员导航、搜索、通知和 schema 不包含业务数据；
- Token 明文仅创建响应显示一次；
- 错误可理解且不泄漏敏感响应。

组件按可访问角色、文本和用户操作查询，不依赖 Element Plus 内部 DOM；不使用大规模 snapshot。Web 测试不能替代后端权限测试。

### 8.2 扩展

沿用 `node --test`，按协议、会话、消息来源和生命周期拆分。重点验证来源、schema、重连、generation 和 MV3 恢复。测试替身不得比真实协议宽松，消息错误不得阻断宿主页面。

## 9. 覆盖率和测试可信度

- 后端使用 JaCoCo；首期不设置存量仓库虚假全局阈值。
- 修改代码目标为差异行覆盖率至少 85%、分支覆盖率至少 80%。
- 隔离、Token、generation、金额、幂等、Reconciliation 和敏感数据必须按规则矩阵完整覆盖，不能用百分比替代。
- Web 首期要求关键 decoder、路由和角色可见性完整覆盖，不设置全局阈值。
- 禁止无追踪的 `@Disabled`、`@Ignore`、`test.skip` 或注释断言。
- 禁止自动重试掩盖 flaky 测试。关键安全测试永不隔离。
- 任何未运行的强制门禁都阻止 Issue 进入 `done`。

## 10. 测试数据与制品安全

- 默认使用合成、无效占位数据；不得复制生产记录。
- 协议 Fixture 必须最小化、脱敏并记录合同版本。
- Fixture、日志、截图和 trace 禁止包含可用 Token、Cookie、密码、密钥、完整票码、真实买家信息、完整 Base64 或原始上游响应。
- 增加 secrets 扫描门禁；疑似秘密直接失败，不自动脱敏后继续。
- 普通 PR 不获得业务 secret；MySQL 容器仅保存合成数据且不上传 dump。
- 手工验收只保存脱敏截图和结论。

## 11. Red/Green 证据

每个 Issue 在开发前记录 Test Plan。关键循环至少记录：

```text
Test Plan: 首个失败测试与规则矩阵
Red: 测试名、命令、预期原因、实际失败摘要
Green: 同一测试通过的命令和结果
Refactor: 重构内容与重跑结果
Validation: 定向、模块和集成命令
Manual Acceptance: 需要时附脱敏证据
```

不强制每个微循环提交。CI 证明最终 Green，Issue/PR 记录过程证据。Green 不得通过删除断言、放宽类型、跳过或 fallback 达成。

## 12. CI 与分支保护

固定必需 Job：

- `backend-unit-contract`
- `backend-mysql-integration`
- `web-test-build`
- `extension-test-build`
- `docs-and-diff-check`

工作流使用最小权限、固定 Action commit SHA，并按 PR 取消旧运行。路径过滤不能导致 Required Check 消失。五个 Job 首次稳定通过后才启用 `main` 保护：要求分支最新、禁止 force push/删除，管理员也不能绕过。单人仓库首期不强制审批人数。

## 13. Issue 与 PR 交付

- 默认一个实施 Issue 对应一个主 PR，标题使用 `[Ixxx]`。
- PR 包含 Issue、Test Plan、Red、Green、Refactor、Validation、Manual Acceptance 和 Risks/Rollback。
- 跨模块按后端合同、消费者实现、集成验收拆分。
- Discovery PR 只提交样本、审计脚本、结论或合同。
- Epic 由所有子 Issue 和阶段验收完成后手动关闭。
- `I046`、`I047`、`I048` 完成前，受其门禁影响的业务 Issue 最多进入 `verification`。

## 14. 启动顺序

1. `I046` 与 `I047` 并行建立后端和 Web 测试基础。
2. `I048` 建立 CI、PR 模板、扫描与分支保护。
3. `I001`、`I002` 可提前进行 Red/Green，但必须通过新门禁后才可 `done`。
4. 数据库与合同 Issue 在对应基础设施完成后进入正式验证。
5. Wave 0 之后继续沿用同一门禁，不为发布日期降低安全要求。
