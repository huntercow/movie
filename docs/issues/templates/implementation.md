---
id: I000
title: "Issue 标题"
status: proposed
epic: E00
milestone: V1-GA
priority: P1
delivery_wave: 0
effort: M
parallelizable: false
blocked_by: []
labels: [feature, p1, backend]
github_issue: null
---

# I000 Issue 标题

## 业务价值

说明用户问题与结果。

## 范围

- 明确包含项。

## 不包含

- 明确排除项。

## 现状基线

- 列出候选入口，不预判完成度。

## 领域与实现约束

- 引用 PRD、CONTEXT.md 和 ADR；遵循 Fail Fast、隔离、幂等和敏感信息规则。

## 验收标准

- Given / When / Then 可观察行为。

## 验证命令

```bash
git diff --check
```

## 依赖关系

- Blocked by: 无
- Blocks: 无

## 交付证据

- 附测试、构建和局部手工验收记录。

## PRD 追踪

- 功能/章节：FR-XX
- 端到端场景：—
- 安全护栏：—
