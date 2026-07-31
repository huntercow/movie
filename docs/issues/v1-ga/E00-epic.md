---
id: E00
title: "合同与安全边界"
status: proposed
milestone: V1-GA
priority: P0
delivery_wave: 0
labels: [epic, p0]
blocked_by: []
github_issue: https://github.com/huntercow/movie/issues/2
---

# E00 合同与安全边界

## 目标

以可独立验收的 Issue 交付“合同与安全边界”，并在 Epic 关闭前完成跨模块验证。

## 子 Issue

- [I001](./I001-issue.md) — 封闭管理员业务数据访问
- [I002](./I002-issue.md) — 实现 Token 显式审批生命周期
- [I003](./I003-issue.md) — 建立用户范围 App API 与严格合同
- [I004](./I004-issue.md) — 固化治理审计与安全合同回归门禁
- [I046](./I046-issue.md) — 建立后端 TDD 测试分层与 MySQL 集成门禁
- [I047](./I047-issue.md) — 建立 Web 严格合同与组件测试基础
- [I048](./I048-issue.md) — 建立 CI、TDD 证据模板与主干保护

## 阶段验收

- 所有子 Issue 的自动验证和局部验收完成。
- 跨模块能力通过对应 integration 或 E07 GA 验收 Issue。
- 不以静态 UI、模拟状态、兼容猜测或文件存在作为完成证据。
- I046–I048 完成并启用主干必需检查后，业务子 Issue 才能进入 `done`。

## PRD 追踪

- FR-02, FR-16, FR-18
- [正式 PRD](../../prd/2026-07-30-ticket-automation-platform-v1-prd.md)
