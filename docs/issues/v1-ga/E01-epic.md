---
id: E01
title: "稳定经营账号与执行授权"
status: proposed
milestone: V1-GA
priority: P0
delivery_wave: 0
labels: [epic, p0]
blocked_by: [I002, I003]
github_issue: https://github.com/huntercow/movie/issues/3
---

# E01 稳定经营账号与执行授权

## 目标

以可独立验收的 Issue 交付“稳定经营账号与执行授权”，并在 Epic 关闭前完成跨模块验证。

## 子 Issue

- [I005](./I005-issue.md) — 审计历史账号归属与迁移可行性
- [I006](./I006-issue.md) — 建立稳定闲鱼经营账号模型
- [I007](./I007-issue.md) — 迁移历史订单并建立未归属队列
- [I008](./I008-issue.md) — 实现 Execution Authorization 与 generation fencing
- [I009](./I009-issue.md) — 实现插件显式激活与会话恢复合同
- [I010](./I010-issue.md) — 验证 WebSocket 部署拓扑与消息合同
- [I011](./I011-issue.md) — 实现后端鉴权 WebSocket 与用户实时订阅
- [I012](./I012-issue.md) — 实现扩展实时连接与控制台实时状态

## 阶段验收

- 所有子 Issue 的自动验证和局部验收完成。
- 跨模块能力通过对应 integration 或 E07 GA 验收 Issue。
- 不以静态 UI、模拟状态、兼容猜测或文件存在作为完成证据。

## PRD 追踪

- FR-01, FR-03, FR-04
- [正式 PRD](../../prd/2026-07-30-ticket-automation-platform-v1-prd.md)
