---
id: I046
title: "建立后端 TDD 测试分层与 MySQL 集成门禁"
status: verification
epic: E00
milestone: V1-GA
priority: P0
delivery_wave: 0
effort: L
parallelizable: true
blocked_by: []
labels: [feature, p0, backend, database]
github_issue: https://github.com/huntercow/movie/issues/89
---

# I046 建立后端 TDD 测试分层与 MySQL 集成门禁

## 业务价值

让高风险安全、持久化和并发规则在真实 MySQL/Flyway 环境中可重复验证，避免 Mockito 绿色掩盖数据库合同错误。

## 范围

- 建立快速单元/合同测试与 MySQL 集成测试分层。
- 引入 JaCoCo、Testcontainers MySQL 和 `integration` Maven Profile。
- 加入最小 MockMvc 安全合同、Flyway、Repository 和事务示例。
- Docker 不可用或 JDBC 地址不属于 Testcontainers 时明确失败。
- 记录现有 122 个后端测试基线和新增测试结果。

## 不包含

- 不实现 Token、闲鱼账号、generation 或订单产品功能。
- 不使用 H2 代表 MySQL。
- 不一次性移动或改写全部存量测试。

## 现状基线

- `mvn test` 当前 122 个测试通过，0 失败，0 跳过。
- 当前无 Testcontainers、JaCoCo、Maven 集成 Profile 和测试资源配置。
- 当前机器无 Docker/Podman；本机无法通过集成门禁不等于允许跳过。

## 领域与实现约束

- 遵循 [TDD 策略](../../testing/tdd-strategy.md)和[启动计划](../../superpowers/plans/2026-07-30-tdd-foundation-implementation.md)。
- 测试数据库只运行合成数据和完整 Flyway；禁止连接开发、共享测试或生产数据库。
- 集成 Profile 无可用容器运行时时必须失败，不能静默 skip。
- Action 或依赖版本不得顺带升级无关生产依赖。

## 验收标准

- Given 默认开发循环，When 执行 `mvn test`，Then 快速测试通过且不启动 MySQL 容器。
- Given 可用 Docker，When 执行 `mvn verify -Pintegration`，Then 真实 MySQL 执行完整 Flyway 和示例持久化/安全合同测试。
- Given Docker 不可用，When 执行集成 Profile，Then 命令明确失败且不报告集成测试通过。
- Given 非 Testcontainers JDBC 地址，When 启动集成测试，Then 在 schema 或业务数据写入前拒绝。
- Given JaCoCo 报告，Then 能提供行/分支覆盖数据而不为存量仓库伪造全局达标。

## 验证命令

```bash
mvn test
mvn verify -Pintegration
git diff --check
```

## 依赖关系

- Blocked by: 无
- Blocks: I003, I005, I006, I008, I048
- 可并行：是，可与 I047 并行

## 交付证据

- 记录首个有效 Red、同一测试 Green 和 Refactor 后复跑。
- 附 122 个存量测试不退化、新增测试、JaCoCo 和 MySQL/Flyway 结果。
- 本机无 Docker 时附明确失败结果；Issue 在 CI 集成门禁通过前不得关闭。

## 本次 TDD 执行记录（2026-07-31）

- **Red**：`SecurityContractTest` 首次运行先暴露测试切片缺少 `RestClient.Builder` 和正向 upstream timeout；补齐测试专用配置后，继续暴露 mock `DatabaseSessionAuthenticationFilter` 截断 FilterChain 的测试替身问题。
- **Green / Refactor**：使用真实 `DatabaseSessionAuthenticationFilter`，仅 mock `SessionAuthenticationService`，并保留最小测试 Bean 与 timeout 属性；`mvn -Dtest=SecurityContractTest test` 为 2/2 通过。
- **快速回归**：`mvn test` 和 `mvn verify` 均通过，后端总计 124/124；相对 122 个基线新增 2 个安全合同测试。JaCoCo 全局行覆盖约 49%、分支覆盖约 42%。
- **集成门禁**：`mvn verify -Pintegration` 未跳过测试，124 个快速测试通过后，`DatabaseMigrationIT` 因本机不存在 Docker/Podman（`/var/run/docker.sock` 不存在）明确失败；结果为 1 error / 0 skipped。
- **CI 首次集成结果**：GitHub Actions 的 MySQL 8.0.36 容器实际启动成功，但干净库在 V6 暴露出原业务表未被任何迁移创建的依赖缺口。未修改 V1–V8；新增 `V5.1` 幂等业务表基线并将迁移合同提升为 9 个版本，同时补充订单、报价和发货记录表存在性断言。
- **状态**：保持 `verification`，待 Docker 可用的 CI 环境完成 MySQL 8.0.36 与完整 Flyway 门禁后再关闭。

## PRD 追踪

- 功能/章节：工程门禁，支撑 FR-01–FR-18
- 端到端场景：1–20 的后端与持久化基础
- 安全护栏：支撑全部六项
