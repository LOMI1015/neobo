# 本地开发

当前提供 React + Vite 前端、NestJS + Fastify 后端，以及 PostgreSQL、Redis 的开发环境。前端是环境检查页；场景编辑、AI、主题和大屏功能尚未实现。

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

打开 <http://127.0.0.1:5173>。开发命令同时启动前后端并监听源码变化，API 初次编译需稍等。按 `Ctrl+C` 停止前后端；数据库和 Redis 继续运行。

## 服务与端口

| 服务       | 本机地址                | 用途                        |
| ---------- | ----------------------- | --------------------------- |
| 前端       | `http://127.0.0.1:5173` | 环境页与后续编辑器          |
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

两个接口分别检查进程和依赖：

```bash
curl --fail http://127.0.0.1:3000/api/health
curl --fail http://127.0.0.1:3000/api/ready
```

`/api/health` 返回成功，只代表 API 进程可响应。`/api/ready` 检查 PostgreSQL 和 Redis，两者可用时返回 HTTP 200，否则返回 503。环境页检查的是前一个接口，不能据此认定数据库已经就绪。

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
