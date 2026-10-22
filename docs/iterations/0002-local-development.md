# 0002：搭建本地开发环境

- 日期：2026-10-22（Asia/Shanghai）
- 状态：已完成（本地环境已运行；GitHub 远端规则待配置）。
- 用户确认：当前单人维护，PR 和必需检查保留，批准人数为 0。

## 目标

提供能够实际启动、检查和继续开发的前后端骨架，隔离本地 PostgreSQL / Redis，同时给出可执行的 GitHub 分支保护操作步骤。

## 实际变化

- `apps/web`：React + Vite 环境页，检查 API、失败重试、超时与取消；不是看板业务页面。
- `apps/api`：NestJS + Fastify 原生 ESM，进程存活与依赖就绪检查、配置校验和错误脱敏。
- 固定 TypeScript 6、ESLint 10、Vitest 5 及兼容工具；前后端各自接入四类检查。
- 本地 `.env` 安全初始化、版本/工具自检、一条命令启动前后端。
- 独立 `neobo-dev` Compose 项目、固定镜像 digest、回环端口和持久卷，保留本机既有数据库。
- 新增 GitHub 设置及本地开发指南，同步单人 0 审批规则。远端设置尚未代为启用。

## 验证

环境：Node.js 24.22.1、pnpm 12.15.0、Docker Engine 29.9.1、Docker Compose 5.6.0，Linux / WSL。

| 检查                                                   | 实际结果                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                           | 通过：16 份 Markdown / 链接 / 配置、17 个工具回归测试、API 12 项及 Web 7 项测试，两个包的 lint、类型检查和构建全部执行成功 |
| 干净目录安装与构建                                     | 通过：复制有效源码，不含 node_modules、dist、.env；冻结锁文件安装、两个包的类型检查和构建成功，锁文件保持不变              |
| `pnpm dev:setup` 连续执行                              | 首次创建本地配置，再次执行文件摘要不变，已有配置保留                                                                       |
| `pnpm dev:doctor`                                      | 固定版本、本地配置、Docker / Compose 和 Compose 配置检查通过                                                               |
| `docker compose -f compose.dev.yml up --detach --wait` | 两个独立开发容器健康；本机原有 5432 PostgreSQL 仍运行                                                                      |
| API 与 Vite 代理联调                                   | 3000 / 5173 两个入口的 health 与 ready 均为 200，PostgreSQL 与 Redis 均为 up                                               |
| 依赖故障与恢复                                         | 停止本项目 Redis 后 ready 返回 503、health 保持 200；恢复 Redis 后 ready 回到 200                                          |
| actionlint 与 Compose 配置                             | 通过；CI 新增开发 Compose 配置检查                                                                                         |
| `pnpm audit:deps`                                      | 达到高危阻断标准；0 高危、0 严重，1 条既有低危开发依赖通告，见 0001                                                        |
| GitHub 规则                                            | 仅文档与本地配置已更新；远端尚未启用，不属于本地验证证据                                                                   |

本次确认 TypeScript 6 与 typescript-eslint 的支持范围兼容；NestJS 12 为原生 ESM，API 使用 NodeNext 和显式 `.js` 导入。开发数据库和 Redis 仅绑定回环地址，分别使用 15432 / 16379；前后端同样默认仅本机访问。

## 遗留问题

- 看板、主题、三维和 Agent 业务按路线图继续实现。
- GitHub `quality` 的首次远端运行和保护规则需上传后配置。
- CD 与许可证尚待后续版本落实。

## 下一步

从可版本化场景契约与统一操作开始，验证二维、三维、主题切换和撤销链路。
