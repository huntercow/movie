---
id: I033
title: "实现管理员审批与用户治理工作台"
status: proposed
epic: E05
milestone: V1-GA
priority: P1
delivery_wave: 3
effort: L
parallelizable: true
blocked_by: [I002, I004, I025, I047]
labels: [feature, p1, data-isolation, manual-acceptance]
github_issue: https://github.com/huntercow/movie/issues/67
---

# I033 实现管理员审批与用户治理工作台

## 业务价值

交付“实现管理员审批与用户治理工作台”能力，使业务用户或治理角色获得可验证结果，而不是仅完成技术资源修改。

## 范围

- 待审批/用户授权/治理审计
- 批准期限/拒绝/续期/吊销
- 无业务字段

## 不包含

- 不扩展到未被本 Issue 的 PRD 引用覆盖的产品能力。
- 不引入旧/新双执行合同、协议 fallback、模拟成功或真实生产外部动作。

## 现状基线

- 开始实施时使用 `rg` 审计相关 Controller、Service、Repository、DTO、测试、Web 页面和扩展入口。
- 将现有未提交实现分类为复用、修正、补齐或替换；文件存在不代表能力完成。

## 领域与实现约束

- 遵循 [正式 PRD](../../prd/2026-07-30-ticket-automation-platform-v1-prd.md)、[`CONTEXT.md`](../../../CONTEXT.md) 与相关 ADR。
- 严格 Fail Fast；未知状态、字段缺失或结构错误必须失败，禁止猜测或 fallback。
- 所有业务数据绑定当前 `userId`；Token、凭据、Cookie、完整票码和敏感响应不得记录。
- 外部动作只使用 mock 验证；数据库变化只新增连续 Flyway 迁移。

## 验收标准

- Given 前置合同和依赖满足，When 待审批/用户授权/治理审计，Then 行为、持久状态与审计证据符合 PRD，错误路径明确失败。
- Given 前置合同和依赖满足，When 批准期限/拒绝/续期/吊销，Then 行为、持久状态与审计证据符合 PRD，错误路径明确失败。
- Given 前置合同和依赖满足，When 无业务字段，Then 行为、持久状态与审计证据符合 PRD，错误路径明确失败。
- Given 非法权限、状态或数据结构，When 请求该能力，Then 在副作用发生前明确失败且不伪造正常结果。

## 验证命令

```bash
cd web && npm run build
git diff --check
```

## 依赖关系

- Blocked by: I002, I004, I025, I047
- Blocks: I040
- 可并行：是

## 交付证据

- 附测试、构建和协议/迁移检查结果；未运行项说明原因。
- 合同变化同步所有调用方和文档。
- 必须附局部手工验收或演练记录。

## PRD 追踪

- 功能/章节：FR-16
- 端到端场景：1, 2, 19
- 安全护栏：管理员读取业务数据
