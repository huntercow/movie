# 票务自动经营平台 V1 Issue Backlog

本目录把[正式 PRD](../prd/2026-07-30-ticket-automation-platform-v1-prd.md)转换为可审查、可独立验收并可发布到 GitHub 的 Issue。当前文件是需求基线，不表示现有未提交代码已经完成相应能力。

## 1. 规模与退出状态

- 9 个 Epic：E00–E07 属于 V1-GA，E08 属于 V1-Post-GA。
- 48 个子 Issue：I001–I043 与 I046–I048 为 V1 GA；I044–I045 为 Post-GA。
- 初始状态统一为 proposed；必须经过现状审计后才能转换状态。
- 工作量：S 约 1 天、M 约 2 天、L 约 3 天；超过 L 必须继续拆分。
- GitHub Issue 已发布到 `huntercow/movie`；每个条目的 front matter 保存远端 URL。
- TDD 工程合同见 [`docs/testing/tdd-strategy.md`](../testing/tdd-strategy.md)。

## 2. Milestone 与标签

| 类别 | 值 | 用途 |
| --- | --- | --- |
| Milestone | V1-GA | 实施、迁移、集成、灰度与 GA 必需项 |
| Milestone | V1-Post-GA | 不阻塞 V1 发布的增强项 |
| 优先级 | P0 / P1 / P2 | 安全硬门禁 / 核心或 GA / 非阻塞增强 |
| 类型 | epic, feature, security, migration, discovery, integration, acceptance, release | 交付类型 |
| 模块 | backend, web, extension, database, docs | 主要模块 |
| 风险 | data-isolation, external-action, breaking-contract, manual-acceptance | 发布时按正文补充 |

Phase 不使用状态标签。执行状态由 GitHub Project 或 front matter 的 status 表达。

## 3. Epic 索引

| Epic | Milestone | Wave | 子 Issue |
| --- | --- | ---: | ---: |
| [E00 合同与安全边界](v1-ga/E00-epic.md) | V1-GA | 0 | 7 |
| [E01 稳定经营账号与执行授权](v1-ga/E01-epic.md) | V1-GA | 0–1 | 8 |
| [E02 接单状态与自动化就绪](v1-ga/E02-epic.md) | V1-GA | 1–2 | 5 |
| [E03 订单旅程、任务与人工决策](v1-ga/E03-epic.md) | V1-GA | 1–2 | 7 |
| [E04 业务用户核心 Web 工作台](v1-ga/E04-epic.md) | V1-GA | 1–2 | 5 |
| [E05 经营设置与管理员治理](v1-ga/E05-epic.md) | V1-GA | 1–3 | 4 |
| [E06 浏览器扩展与集成收尾](v1-ga/E06-epic.md) | V1-GA | 1–3 | 4 |
| [E07 V1 GA 验收、灰度发布与回退](v1-ga/E07-epic.md) | V1-GA | 4 | 6 |
| [E08 Post-GA 后续增强](post-ga/E08-epic.md) | V1-Post-GA | 5 | 2 |

## 4. 推荐交付 Wave

```text
Wave 0 TDD、安全与合同: I046–I048, I001–I006, I008, I010
Wave 1 单用户单账号闭环: I009, I011–I013, I015–I022, I024–I028, I032, I034
Wave 2 多账号与完整配置: I014, I023, I029–I031
Wave 3 治理、扩展与迁移: I007, I033, I035–I038
Wave 4 集成、容量、灰度与 GA: I039–I043
Wave 5 Post-GA: I044–I045
```

Wave 表示产品增量，blocked_by 表示硬依赖。合同冻结后模块可并行，但不得提前实现尚未确定的业务语义。

## 5. 关键路径

```text
I046 + I047 → I048 → 全部 V1-GA Issue 的 done 门禁
I046 → I003, I005, I006, I008
I047 → I025–I031, I033
I001 → I003 → I005 → I006 → I008 → I010 → I011
                                         ├→ I013 → I015 → I021
                                         └→ I012
I019 → I020 → I022 → I039
I032 ─────────────→ I015
I015 + I021 + I023 + I025 → I027
I019 + I022 + I024 + I025 → I028
I028 + I035 + I036 → I037 → I038
I017 + I026 + I028 + I033 + I035 + I039 → I040
I038 + I040 + I041 → I042 → I043
```

Discovery 门禁为 I005、I010、I018、I034。它们必须以证据、冻结合同或明确阻塞结束，不能以“继续研究”结束。
TDD 基础设施按 I046 与 I047 并行、I048 收口的顺序实施；I001、I002 可提前开发，但新门禁完成前最多进入 `verification`。

## 6. FR 覆盖矩阵

| PRD | 主实现 Issue | 集成/GA 验证 |
| --- | --- | --- |
| FR-01 闲鱼经营账号 | I005–I007, I019 | I038, I040 |
| FR-02 Token 生命周期 | I002, I004 | I026, I033, I040 |
| FR-03 执行授权与会话 | I008, I009 | I012, I029, I035, I039–I040 |
| FR-04 实时连接 | I010–I012, I034 | I041 |
| FR-05 Automation Readiness | I015 | I017, I026–I027, I029, I035, I040 |
| FR-06 接单状态与营业时间 | I013–I014 | I017, I029, I040 |
| FR-07 停止时段回复 | I016 | I017, I030, I040 |
| FR-08 今日运营收件箱 | I021, I023, I027 | I040 |
| FR-09 订单中心 | I019, I028 | I040–I041 |
| FR-10 订单详情 | I019, I022, I028 | I037, I040 |
| FR-11 任务与通知 | I021, I036 | I027, I040 |
| FR-12 人工决策 | I018, I020, I022 | I028, I037, I039–I040 |
| FR-13 话术配置 | I030 | I040 |
| FR-14 定价配置 | I031 | I040 |
| FR-15 良票账号与绑定 | I032 | I015, I040 |
| FR-16 管理员治理 | I001–I004, I033 | I039–I040 |
| FR-17 扩展 Popup | I009, I034–I036 | I037, I040 |
| FR-18 敏感数据 | I001, I004, I024 | I039–I040 |

覆盖率：18/18 = 100%。

## 7. 端到端场景覆盖

| 场景 | 主要 Issue |
| ---: | --- |
| 1–2 Token 创建、审批与拒绝 | I002, I026, I033, I040 |
| 3 接管与旧 generation 拒绝 | I008–I012, I029, I035, I039–I040 |
| 4–5 Readiness Stop 与恢复 | I015, I017, I027, I029, I035, I040 |
| 6 营业时间跨夜和优先级 | I013–I014, I017, I040 |
| 7 停止时段一次回复 | I016–I017, I030, I040 |
| 8 Accepted Order 安全续跑 | I017, I020, I040 |
| 9 正常订单完整旅程 | I019–I023, I028, I031, I040 |
| 10 金额不一致 | I020, I022, I028, I039–I040 |
| 11–12 提交/发货结果未知 | I018, I022, I024, I028, I039–I040 |
| 13–14 通知、任务与暂缓 | I021, I027, I036, I040 |
| 15 票码脱敏与审计 | I001, I024, I028, I039–I040 |
| 16–17 配置版本与上游改绑 | I023, I030–I032, I040 |
| 18 历史归属隔离 | I005–I007, I019, I023, I038 |
| 19 管理员无业务数据 | I001, I003–I004, I025, I033, I039–I040 |
| 20 容量和性能 | I010–I012, I019, I021, I023, I034, I041 |

覆盖率：20/20 = 100%。

## 8. 零容忍安全护栏

| 目标为 0 的事件 | 主验证 Issue |
| --- | --- |
| 重复上游订单 | I018, I022, I039 |
| 重复发货外部动作 | I018, I022, I024, I039 |
| 管理员读取业务数据 | I001, I004, I024, I033, I039 |
| 未经金额验证进入履约 | I017, I020, I039 |
| 结果未知后的自动重试 | I018, I022, I039 |
| 旧 execution generation 成功请求 | I008–I012, I034–I035, I039 |

I039 必须逐项输出独立、可审计结果；任何一项失败都阻塞 I040–I043。

## 9. 状态与完成定义

- proposed：已进入 Backlog，尚未完成现状审计。
- ready：合同清晰且硬依赖已满足。
- in-progress：存在明确实施工作。
- verification：实现完成，等待自动或局部手工验收。
- done：验收、测试、文档和交付证据全部满足。
- blocked：有明确协议、产品决策或硬依赖阻塞。
- superseded：被其他 Issue 替代，并保留追踪关系。

实施 Issue 的局部验收完成即可关闭；整套产品发布由 I040–I043 决定。代码合并、文件存在、模拟 UI 或静态状态都不等于完成。
所有 V1-GA Issue 还必须遵循 [TDD 策略](../testing/tdd-strategy.md)；I046–I048 未完成或强制门禁未运行时不得进入 `done`。

## 10. GitHub 发布流程

1. 审查本地标题、范围、依赖和验收标准。
2. 创建 V1-GA 与 V1-Post-GA Milestone 以及本页标签。
3. 先发布 Epic，再按编号发布子 Issue，将 blocked_by 转为远端链接或 Project 依赖。
4. 发布后回填每个文件的 github_issue，保留本地稳定编号。
5. 使用 [Epic 模板](templates/epic.md) 和 [实施模板](templates/implementation.md) 创建后续条目。
6. GitHub Project 管理执行状态；本地文件只同步需求、边界、依赖和验收合同变化。

安装并认证 gh 后可执行：

```bash
gh issue create \
  --repo huntercow/movie \
  --title "[I001] 封闭管理员业务数据访问" \
  --body-file docs/issues/v1-ga/I001-issue.md \
  --milestone "V1-GA" \
  --label "security,p0,backend,data-isolation"
```

发布前不得把工作区中现有未提交实现直接标记为完成；每个 Issue 必须先执行正文中的现状审计。
