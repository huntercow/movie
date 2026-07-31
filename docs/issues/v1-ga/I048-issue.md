---
id: I048
title: "建立 CI、TDD 证据模板与主干保护"
status: verification
epic: E00
milestone: V1-GA
priority: P0
delivery_wave: 0
effort: L
parallelizable: false
blocked_by: [I046, I047]
labels: [feature, p0, docs, security, breaking-contract, manual-acceptance]
github_issue: https://github.com/huntercow/movie/issues/91
---

# I048 建立 CI、TDD 证据模板与主干保护

## 业务价值

让所有 V1 改动必须经过同一组自动门禁，并阻止管理员或直接 push 绕过安全、数据库、Web 和扩展测试。

## 范围

- 创建固定名称的五个 GitHub Actions Job。
- 创建 PR 模板，要求 Issue 和 Red/Green/Refactor 证据。
- 增加源码、Fixture、文档和测试制品 secrets 扫描。
- 固定第三方 Action 到完整 commit SHA，并使用最小 Token 权限。
- 五个 Job 成功运行后启用 `main` 分支保护，管理员同样不能绕过。

## 不包含

- 不实现产品业务功能。
- 不在 CI 中使用生产或业务沙箱 secret。
- 不在检查尚未成功运行前提前配置会锁死仓库的 Required Checks。

## 现状基线

- GitHub Actions 已启用，但仓库当前没有工作流。
- `main` 当前没有分支保护。
- 当前第三方 Action 未要求 SHA 固定。
- 当前为单人仓库，首期不强制审批人数。

## 领域与实现约束

- 遵循 [TDD 策略](../../testing/tdd-strategy.md)和[启动计划](../../superpowers/plans/2026-07-30-tdd-foundation-implementation.md)。
- 必需 Job 名固定为 `backend-unit-contract`、`backend-mysql-integration`、`web-test-build`、`extension-test-build`、`docs-and-diff-check`。
- 路径过滤不得让 Required Check 消失；无需执行时也应明确成功。
- 安全护栏测试不能隔离、跳过或转为非阻塞。

## 验收标准

- Given PR，When CI 运行，Then 五个固定 Job 都产生明确结果。
- Given MySQL 集成 Job，Then 使用 GitHub Runner Docker 和 Testcontainers 合成数据。
- Given PR 描述，Then 模板要求 Issue、Test Plan、Red、Green、Refactor、Validation、Manual Acceptance 和 Risks/Rollback。
- Given 五个 Job 至少成功一次，When启用保护，Then `main` 要求分支最新、禁止 force push/删除且管理员不能绕过。
- Given疑似秘密进入源码或 Fixture，When CI 扫描，Then 检查失败且不打印秘密原文。

## 验证命令

```bash
gh run list --repo huntercow/movie
gh api repos/huntercow/movie/branches/main/protection
git diff --check
```

## 依赖关系

- Blocked by: I046, I047
- Blocks: 全部 V1-GA Issue 的 `done` 状态
- 可并行：否，必须在 I046 与 I047 合同稳定后实施

## 交付证据

- 附五个 CI Job 的首次成功运行链接。
- 附 secrets 扫描、报告上传和 Action SHA 审计结果。
- 附 `main` 分支保护 API 输出；保护未启用前 Issue 不得关闭。

## 本次实施记录（2026-07-31）

- 已创建固定名称的五个 Job：`backend-unit-contract`、`backend-mysql-integration`、`web-test-build`、`extension-test-build`、`docs-and-diff-check`；工作流不使用路径过滤，避免 Required Check 消失。
- 已创建 PR 模板，要求 Issue、Test Plan、Red、Green、Refactor、Validation、Manual Acceptance、Risks/Rollback 和安全数据检查。
- 已创建不输出敏感原文的 secrets 扫描与文档/diff 检查脚本；源码、Fixture、文档及构建后检查均复用该扫描器。测试报告和构建产物仅在扫描成功时上传。
- 已锁定 `checkout`、`setup-java`、`setup-node` 和 `upload-artifact` 的完整 commit SHA；本地 YAML 合同校验通过，扩展 139/139 测试、类型检查和构建通过。
- **状态**：`verification`。本地无法模拟 GitHub Runner 的 Docker/Actions 环境；需先让五个 Job 在 CI 成功运行，再根据结果配置 `main` 分支保护。当前未启用保护，也未关闭 Issue。

## PRD 追踪

- 功能/章节：工程发布门禁，支撑 FR-01–FR-18
- 端到端场景：1–20 的持续验证基础
- 安全护栏：支撑全部六项
