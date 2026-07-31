---
id: E03
title: "订单旅程、任务与人工决策"
status: proposed
milestone: V1-GA
priority: P0
delivery_wave: 1
labels: [epic, p0]
blocked_by: [I003, I006, I015]
github_issue: https://github.com/huntercow/movie/issues/5
---

# E03 订单旅程、任务与人工决策

## 目标

以可独立验收的 Issue 交付“订单旅程、任务与人工决策”，并在 Epic 关闭前完成跨模块验证。

## 子 Issue

- [I018](./I018-issue.md) — 确认未知外部结果的对账证据
- [I019](./I019-issue.md) — 建立订单旅程读模型与账号范围查询
- [I020](./I020-issue.md) — 固化 Accepted Order 续跑与金额验证门禁
- [I021](./I021-issue.md) — 建立任务、SLA 与通知领域模型
- [I022](./I022-issue.md) — 实现任务特定人工决策与 Reconciliation
- [I023](./I023-issue.md) — 建立经营统计投影与口径测试
- [I024](./I024-issue.md) — 实现票码敏感查看与一次性发货授权

## 阶段验收

- 所有子 Issue 的自动验证和局部验收完成。
- 跨模块能力通过对应 integration 或 E07 GA 验收 Issue。
- 不以静态 UI、模拟状态、兼容猜测或文件存在作为完成证据。

## PRD 追踪

- FR-08–FR-12, FR-18
- [正式 PRD](../../prd/2026-07-30-ticket-automation-platform-v1-prd.md)
