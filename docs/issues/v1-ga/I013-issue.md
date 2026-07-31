---
id: I013
title: "建立 Order Intake 状态与停止原因"
status: proposed
epic: E02
milestone: V1-GA
priority: P1
delivery_wave: 1
effort: L
parallelizable: false
blocked_by: [I006, I011]
labels: [feature, p1, backend]
github_issue: https://github.com/huntercow/movie/issues/27
---

# I013 建立 Order Intake 状态与停止原因

## 业务价值

交付“建立 Order Intake 状态与停止原因”能力，使业务用户或治理角色获得可验证结果，而不是仅完成技术资源修改。

## 范围

- 账号范围状态和原因优先级
- 全部/单账号停止
- 恢复前完整就绪检查和确认

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

- Given 前置合同和依赖满足，When 账号范围状态和原因优先级，Then 行为、持久状态与审计证据符合 PRD，错误路径明确失败。
- Given 前置合同和依赖满足，When 全部/单账号停止，Then 行为、持久状态与审计证据符合 PRD，错误路径明确失败。
- Given 前置合同和依赖满足，When 恢复前完整就绪检查和确认，Then 行为、持久状态与审计证据符合 PRD，错误路径明确失败。
- Given 非法权限、状态或数据结构，When 请求该能力，Then 在副作用发生前明确失败且不伪造正常结果。

## 验证命令

```bash
mvn test
git diff --check
```

## 依赖关系

- Blocked by: I006, I011
- Blocks: I014, I015, I016, I029
- 可并行：否

## 交付证据

- 附测试、构建和协议/迁移检查结果；未运行项说明原因。
- 合同变化同步所有调用方和文档。
- 若实现产生可见交互或运行状态，附相应局部验收记录。

## PRD 追踪

- 功能/章节：FR-06
- 端到端场景：5–8
- 安全护栏：—
