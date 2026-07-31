---
id: I047
title: "建立 Web 严格合同与组件测试基础"
status: verification
epic: E00
milestone: V1-GA
priority: P0
delivery_wave: 0
effort: L
parallelizable: true
blocked_by: []
labels: [feature, p0, web]
github_issue: https://github.com/huntercow/movie/issues/90
---

# I047 建立 Web 严格合同与组件测试基础

## 业务价值

让控制台只接受后端明确合同，并持续证明角色隔离、登录失效和敏感字段边界不会因 UI 重构退化。

## 范围

- 引入 Vitest、Vue Test Utils、jsdom、Testing Library Vue、user-event 和 coverage。
- 建立合同、路由、组件与脱敏 Fixture 测试结构。
- 加入 `ApiResponse` 严格解码、401 清理和角色路由隔离的最小测试。
- 验证管理员导航、搜索和通知基础不出现业务入口。
- 定义 `npm test`、`npm run test:watch` 和 `npm run test:coverage`。

## 不包含

- 不实现新工作台、订单中心或 Token 产品 UI。
- 不引入 Wave 0 全量 Playwright 浏览器矩阵。
- 不使用大规模 snapshot 或 Element Plus 内部 DOM 选择器。

## 现状基线

- Web 当前只有 `npm run build`，没有自动测试命令和测试依赖。
- 当前类型检查和构建通过；存在约 1.1 MB JavaScript chunk 历史警告。
- API 入口集中在 `web/src/api.ts`，角色路由位于 `web/src/router.ts`。

## 领域与实现约束

- 遵循 [TDD 策略](../../testing/tdd-strategy.md)和[启动计划](../../superpowers/plans/2026-07-30-tdd-foundation-implementation.md)。
- 后端合同是权威；Fixture 必须版本化、最小化、脱敏和严格解码。
- Web 测试不替代后端权限测试；未知状态、缺字段和错类型必须失败。
- 不允许通过 `any`、多字段 fallback 或静默 catch 让测试通过。

## 验收标准

- Given 成功与已定义错误 Fixture，When 解码 `ApiResponse`，Then 只进入协议规定分支。
- Given 缺字段、错类型、未知状态或额外敏感合同，When 解码，Then 明确失败。
- Given 401，When API 请求结束，Then 清理会话并进入明确登录流程。
- Given 业务用户或管理员，When 导航或直接访问角色外路由，Then UI 与路由均拒绝越界。
- Given Web 测试命令，Then 一次、watch、coverage 和构建职责清晰且首次测试数量被记录。

## 验证命令

```bash
cd web
npm test
npm run test:coverage
npm run build
git diff --check
```

## 依赖关系

- Blocked by: 无
- Blocks: I025, I026, I027, I028, I029, I030, I031, I033, I048
- 可并行：是，可与 I046 并行

## 交付证据

- 记录严格 decoder 首个有效 Red 和 Green。
- 附首次 Web 测试数量、coverage、构建和已知警告结果。
- Fixture 通过敏感数据检查；不得上传真实业务响应。

## 本次 TDD 执行记录（2026-07-31）

- 严格 `ApiEnvelope` decoder 覆盖成功、缺字段、错类型、未知字段和 401 清理；路由合同覆盖未登录、业务用户与管理员的角色越界。
- **Green**：`npm test` 为 11/11 通过；`npm run test:coverage` 为 35.29% statements、34.21% branches、37.16% lines；`npm run build`（含 `vue-tsc --noEmit`）通过。
- 保留已知非阻断警告：VueUse PURE annotation 和约 1.1 MB JS chunk；npm audit 报告 9 个 high severity 项，未执行破坏性 `npm audit fix --force`。
- `git diff --check` 通过，Fixture 未包含真实业务响应、Token、Cookie 或其他敏感数据。
- **状态**：保持 `verification`，待 I048 CI 门禁和人工验收联动后再关闭。

## PRD 追踪

- 功能/章节：工程门禁，支撑 FR-02、FR-08–FR-18
- 端到端场景：1–2、9–10、13–16、19
- 安全护栏：管理员读取业务数据事件
