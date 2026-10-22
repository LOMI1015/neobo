# 本地开发

当前提供 React + Vite 二维画布、NestJS + Fastify 后端，以及 PostgreSQL、Redis 开发环境。画布支持文字/矩形、选择拖动、属性编辑、组合/拆组及撤销/重做；内容仅在当前会话，刷新后不保存。场景存储、AI、主题和完整大屏仍未实现。

## 首次启动

需要 Git、[nvm](https://github.com/nvm-sh/nvm)、Docker Engine 或 Docker Desktop，以及 Docker Compose v2.20 以上。Linux 和 WSL 中均需保证当前终端可以访问 Docker daemon；Docker Desktop 用户应开启对应 WSL 发行版的集成，见 [官方 WSL 配置](https://docs.docker.com/desktop/features/wsl/)。

在仓库根目录执行：

```bash
nvm install
nvm use
npm install --global pnpm@12.15.0
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev:setup
pnpm dev:doctor
pnpm infra:up
pnpm dev
```

`.nvmrc` 和 `.node-version` 固定 Node.js 24.22.1，`package.json` 固定 pnpm 12.15.0。若已使用相同版本，可跳过安装；无需全局安装 Nest CLI。`dev:setup` 从 `.env.example` 创建 `.env`，已有文件会保留，不覆盖个人配置。

打开 <http://127.0.0.1:5173>。开发命令先构建共享场景包，再共同监听场景包、前端和后端；API 初次编译需稍等。按 `Ctrl+C` 停止前后端；数据库和 Redis 继续运行。

默认进入空白画布；顶部“服务检查”保留原来的 API 状态检查，切换回来保留当前编辑。画布本身不等待 API 连接。添加元素后可直接拖动，按 Shift 多选或从图层选择子元素；属性修改点击“应用属性”后作为一步历史提交。删除组合包括全部后代；拆组保持画面位置，隐藏组合拆开后其直接子元素仍隐藏。

只运行前端时，先执行 `pnpm --filter @neobo/scene build`，再运行 `pnpm --filter @neobo/web dev`；根 `pnpm dev` 仍统一管理前后端，任一服务启动失败时会停止关联开发进程。

同级非连续元素允许组合，新组放在最上方选中元素所在层；组内保持原顺序，这可能改变与未选图层的遮挡关系。组合宽高定义边界与旋转中心，不缩放子元素；组合/拆组每次最多 49 个直接目标，超过范围会拒绝，不拆成多个历史步骤。

## 终端输出

`pnpm dev` 以灰色 `[SCENE]`、青色 `[API]`、紫色 `[WEB]` 区分共享包与服务，根启动器只显示通用启动提示，品牌艺术字由后端输出。只保留一层模块标签；API 使用 `pino-pretty` 显示 UTC 时间、级别和受控事件字段，编译错误照常输出，代码重启保留已有记录。

启动提示表示“正在启动”，不代表端口或数据库已就绪。API 真正监听成功后输出青色 neobo 艺术字及实际绑定地址、端口，健康检查路径为 `/api/health`；Vite 显示自身实际启动结果。艺术字表示 API 已监听，PostgreSQL / Redis 状态仍以 `/api/ready` 为准。禁色时艺术字保留为纯文本，生产不输出艺术字。

共享场景包首次强制构建，再进入同一 TypeScript build 模式监听，产物与增量状态都位于该包 `dist`；初次监听无需再次写入产物。共享包重建后，使用它的开发工具或服务读取最新产物；默认应用当前尚未挂载场景业务路由。

API 首次使用 TypeScript build 模式强制编译，再进入同一构建模式的监听，避免监听启动时重复写入产物而触发第二次启动。每次后端启动成功只打印一次艺术字，修改后端代码导致的正常重启仍会打印。开发命令更新后，需要停止旧的 `pnpm dev` 再重新运行。

交互终端自动启用颜色，重定向到文件、CI 或显式禁色时使用纯文本。需要主动关闭颜色可执行：

```bash
NO_COLOR=1 pnpm dev
```

根开发入口通过现有 concurrently 管理进程、固定 `NODE_ENV=development` 并传递颜色策略；内部标志无需手动配置。生产使用构建后的 API `start` 入口并设置 `NODE_ENV=production`，NestJS 和 Fastify 使用同一个 Pino 实例，生产输出逐行无色 JSON，不加载开发格式化器或输出艺术字。请求摘要与错误详情只允许固定事件和受控字段；框架原始消息、异常正文、堆栈不直接输出。请求日志基础已落地，持久审计等后续能力按 [日志设计](logging.md) 实施。

默认日志阈值为 `info`，常规 NestJS 初始化、路由注册及 Fastify 监听内部事件归入 `debug`，不会重复打印“框架运行事件”。排查初始化时在启动命令前显式传入进程环境变量：

```bash
LOG_LEVEL=debug pnpm dev
```

调试日志用固定 `frameworkSource` 区分已知框架来源，仍不输出原始消息、凭据或异常堆栈；警告和错误保持原级别。`LOG_LEVEL` 允许 `trace`、`debug`、`info`、`warn`、`error`、`fatal`，不从根 `.env` 读取，修改后需重新启动。配置无效时启动失败，不回显原值；完整规则见 [日志设计](logging.md#开发终端显示)。

## 服务与端口

| 服务       | 本机地址                | 用途                        |
| ---------- | ----------------------- | --------------------------- |
| 前端       | `http://127.0.0.1:5173` | 二维画布与服务检查          |
| API        | `http://127.0.0.1:3000` | NestJS + Fastify            |
| PostgreSQL | `127.0.0.1:15432`       | 开发数据库；容器内仍为 5432 |
| Redis      | `127.0.0.1:16379`       | 开发缓存；容器内仍为 6379   |

使用独立 Compose 项目 `neobo-dev` 和独立命名卷，避免复用其他项目的数据。PostgreSQL、Redis 端口映射，以及前后端监听地址，默认只开放给本机。

PostgreSQL 18 的数据卷挂载到 `/var/lib/postgresql`，不要照搬旧版本的目录配置。开发容器配置见 [compose.dev.yml](../compose.dev.yml)，目录变化见 [官方镜像说明](https://hub.docker.com/_/postgres)。

## 配置与健康检查

配置入口为根目录 [.env.example](../.env.example)，个人配置写入被 Git 忽略的 `.env`。更新示例文件后，已有 `.env` 不会自动补齐；按需对照增加新配置。

- `DATABASE_URL`、`REDIS_URL` 只供后端使用，不向浏览器传递凭据。
- `API_PORT` 控制 API 端口；Vite 默认据此代理 `/api`。如需单独指定代理，使用 `SERVER_API_PROXY_TARGET`。
- 前端请求相对路径 `/api`，经开发服务器代理给后端。不要把数据库地址、密钥或其他私密配置放进 `VITE_*` 变量。
- 更改端口或启动配置后，重启相关进程；数据库、Redis 的宿主机端口映射与 `.env` 连接地址必须一致。

每个进入 Fastify 请求链路的请求都由服务端生成 UUID，通过响应头 `X-Request-Id` 返回；客户端传入的同名头不会被采用。统一异常响应包含 `statusCode`、稳定 `code`、安全 `message` 和 `requestId`。健康与就绪接口的现有响应体保持不变。

两个接口分别检查进程和依赖：

```bash
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/ready
```

`/api/health` 返回成功，只代表 API 进程可响应。`/api/ready` 检查 PostgreSQL 和 Redis，两者可用时返回 HTTP 200，否则返回 503。服务检查视图使用前一个接口，不能据此认定数据库已经就绪。

## 浏览器验证

`pnpm check` 包含 jsdom 组件/交互测试；真实 Chromium 回归另由以下命令运行，CI 也执行同一入口：

```bash
pnpm --filter @neobo/scene build
pnpm exec playwright install --with-deps --only-shell chromium
pnpm test:browser
```

Playwright 版本固定为 1.64.1，仅为开发依赖。浏览器安装步骤可能需要系统包权限；已具备运行库时可只执行 `pnpm exec playwright install --only-shell chromium`。具体系统支持以 [官方浏览器安装说明](https://playwright.dev/docs/browsers) 为准。

测试自行启动 `127.0.0.1:4174` 的 Vite 服务，不复用已有进程，不需要数据库或真实 API。端口被占用时明确失败，结束后释放自己的服务与浏览器。失败 trace 和截图位于被忽略的 `apps/web/test-results/`；查阅后删除该目录即可，不提交临时报告。当前覆盖 Chromium 桌面和窄屏布局，未声称其他浏览器、真机触控或性能验收。

## 日常命令

| 命令              | 作用                                                    |
| ----------------- | ------------------------------------------------------- |
| `pnpm dev:setup`  | 安全创建本地 `.env`，保留已有文件                       |
| `pnpm dev:doctor` | 检查开发前置条件，按实际输出修复后再启动                |
| `pnpm infra:up`   | 启动开发数据库、Redis，并等待容器健康                   |
| `pnpm infra:logs` | 查看开发基础服务日志                                    |
| `pnpm infra:down` | 停止并移除开发容器，保留数据卷                          |
| `pnpm dev`        | 同时启动前后端开发进程                                  |
| `pnpm check`      | 格式、文档、仓库规则，以及业务包 lint、类型、测试和构建 |
| `pnpm audit:deps` | 联网检查依赖通告，高危及以上失败                        |

基础服务的实际入口是 `docker compose -f compose.dev.yml`；`infra:up` 使用 `up -d --wait`，等待含义见 [Compose 官方说明](https://docs.docker.com/reference/cli/docker/compose/up/)。日常停止无需删除卷，仓库不提供默认清空数据的快捷命令。

## 常见问题

**端口被占用。** 不要直接停止不属于 neobo 的服务。先查看占用，再调整本项目配置；默认数据库使用 15432，就是为了与常用的 5432 分开。Vite 固定使用 5173，冲突时会报错，不会悄悄切换端口。

**版本不匹配。** 新终端先运行 `nvm use`，再检查 `node --version` 和 `pnpm --version`。使用仓库固定版本，避免绕过工具链检查或重建锁文件来解决环境问题。

**Docker 无法连接。** 先确认 Docker 服务已启动、当前用户可访问，以及 WSL 集成已开启。`docker compose version` 应显示支持要求的 v2 版本；使用 `docker compose`，不要替换成旧版独立的 `docker-compose`。

**修改了数据库口令，但连接失败。** PostgreSQL 初始化参数只在空数据目录首次启动时生效，修改 `.env` 不会更新已有数据卷中的账户口令，见 [官方镜像说明](https://hub.docker.com/_/postgres)。保留数据时应显式修改数据库账户并同步连接配置；重新初始化需先确认备份和数据删除范围，再人工操作。

**需要远程访问开发页。** 默认仅本机可访问。跨设备使用前有意识地配置监听地址、网络访问和代理，优先通过 SSH 转发访问；不要为了方便把所有服务改成对外开放。Vite 开发服务器用于开发，正式部署另行设计。

本文描述启动流程，不代表已完成远端部署或所有环境验证。每次迭代的实际验证证据见 [迭代记录](iterations/README.md)。
