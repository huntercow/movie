# 多用户平台部署与迁移

## 配置边界

- `application.yml` 中现有 OSS 配置仍是平台统一配置，不迁移到用户表。
- 每个用户的良票账号通过控制台保存，用户名和密码使用 AES-GCM 加密后入库。
- 在不修改实际 `application.yml` 的情况下，生产环境直接通过 Spring 属性环境变量提供一个 32 字节密钥的 Base64：`TICKET_SECURITY_CREDENTIAL_ENCRYPTION_KEY`。
- `application.example.yml` 中使用了 `${CREDENTIAL_ENCRYPTION_KEY:}` 占位符；只有把这一段合并进实际配置后，短变量名 `CREDENTIAL_ENCRYPTION_KEY` 才会生效。
- 密钥丢失后无法解密已保存的良票账号。轮换密钥前必须先实现重加密流程。
- 旧 `X-Plugin-Token`、`X-Bot-Token` 和 `X-Admin-Token` 配置暂时兼容，完成客户端迁移后再移除。

## 数据库迁移

启动时 Flyway 自动依次执行 `V1`、`V2`、`V3`：

- `V1` 创建用户、授权、会话、Agent Token/安装、闲鱼账号、用户上游账号和审计表。
- `V2` 为原业务表补充 `user_id`。
- `V3` 创建持久任务队列 `job_task`。

首次管理员初始化会把无归属的旧数据分配给该管理员。正式执行前必须备份数据库，并先在数据库副本验证迁移。

## 上线顺序

1. 备份 MySQL，并确认应用账号具有建表、索引和修改表权限。
2. 设置 `TICKET_SECURITY_CREDENTIAL_ENCRYPTION_KEY`，保持原 OSS 配置不变。
3. 启动应用并检查全部 Flyway 迁移成功。
4. 访问 `/console/#/setup` 初始化唯一管理员。
5. 创建普通用户。
6. 用户首次登录修改密码，保存自己的良票账号并登录上游。
7. 用户分别为每个插件或机器人安装创建一个 Token，管理员设置 Token 有效期。
8. 客户端生成持久 installation ID，完成激活；之后每次业务请求都携带 Token 和 installation ID。

## 回滚原则

Flyway 迁移不会删除旧业务列或旧配置。应用回滚前保留数据库备份；不要手工删除新表或 `user_id`，否则已归属数据与新客户端 Token 会丢失。平台控制台构建产物位于 `src/main/resources/static/console`，入口为 `/console/`。

## 已知的订单状态机风险

`job_task` 已保证创建订单后任务不会因进程重启而直接丢失，并通过业务键避免重复入队。当前上游提交、支付和查单仍在持有订单数据库事务/行锁时执行。上游超时会拉长事务，占用连接并延迟同订单的其他处理。上线初期应限制 Worker 并发并监控连接池；后续需要把状态机拆成“短事务认领 -> 事务外远程调用 -> 短事务保存检查点”，同时为上游提交引入可核对的幂等业务号后再切换。
