# 本地开发

当前提供 React + Vite 二维画布、独立只读播放器、组件注册、两套固定场景主题与提交态预览、统一的 shadcn/ui 公共控件与设计变量、NestJS + Fastify 后端，以及 PostgreSQL、Redis 开发环境。画布支持文字/矩形/静态单系列柱状图、选择拖动、属性编辑、组合/拆组及撤销/重做；内容仅在当前会话，刷新后不保存。动态数据源、场景存储、AI、动态主题加载、发布快照和动画仍未实现。

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

打开 <http://127.0.0.1:5173>。开发命令依次构建主题、场景和播放器包，再共同监听这三个包、前端和后端；API 初次编译需稍等。按 `Ctrl+C` 停止共享包监听及前后端；数据库和 Redis 继续运行。

默认进入空白画布；顶部“服务检查”保留原来的 API 状态检查，切换回来保留当前编辑。画布本身不等待 API 连接。添加元素后可直接拖动，按 Shift 多选或从图层选择子元素；属性修改点击“应用属性”后作为一步历史提交。删除组合包括全部后代；拆组保持画面位置，隐藏组合拆开后其直接子元素仍隐藏。

工具栏“预览”读取当前已提交场景，未应用的属性草稿不会进入画面；拖动时禁用预览。返回编辑保留原选区、历史与属性草稿，不增加修订；切换视图卸载隐藏场景的绘制，避免图表实例重复驻留。播放器仅只读消费当前会话，没有保存或发布。

在画布/图层右键菜单或“更多操作 → 场景主题”选择“中性浅色”或“深色蓝”，空画布也可切换。切换作为一步命令，可撤销/重做，保留布局、数据、选区与未应用属性草稿；当前有效主题不增加历史。主题只影响场景颜色，应用控件继续使用原有统一样式。旧文档缺省使用中性浅色，未知主题或版本拒绝；没有自选色、逐元素固定覆盖、字体或动态主题加载。

点击“添加柱状图”创建 480×320 的空图表，小画布逐维限制尺寸。属性区用“添加数据”增加分类/数值行，行末按钮删除该行；草稿不会立即写入场景，点击“应用属性”后与坐标、尺寸、可见性修改合为一步历史。可清空全部行，支持负数和零；最多 100 行，类别长度 1–100 且不能全为空白，数值须有限且绝对值不超过 `1e12`。非法输入显示错误并保留原场景。图表使用手填静态数据，不连接 API、数据库或自动刷新。

画布和图层支持右键菜单，聚焦画布后可用 Shift+F10 打开菜单，工具栏“更多操作”提供同等入口。右键未选对象切换目标，命中已选对象或被选中祖先覆盖的后代时保留选区；空白处保留选区，菜单显示当前数量。打开或取消菜单不记历史，菜单操作与工具栏复用同一命令；切换视图时关闭菜单并取消拖动。

只运行前端时，依次执行 `pnpm --filter @neobo/theme build`、`pnpm --filter @neobo/scene build` 和 `pnpm --filter @neobo/player build`，再运行 `pnpm --filter @neobo/web dev`；根 `pnpm dev` 仍统一管理前后端，任一服务启动失败时会停止关联开发进程。

同级非连续元素允许组合，新组放在最上方选中元素所在层；组内保持原顺序，这可能改变与未选图层的遮挡关系。组合宽高定义边界与旋转中心，不缩放子元素；组合/拆组每次最多 49 个直接目标，超过范围会拒绝，不拆成多个历史步骤。

## 终端输出

`pnpm dev` 以黄色 `[THEME]`、灰色 `[SCENE]`、蓝色 `[PLAYER]`、青色 `[API]`、紫色 `[WEB]` 区分共享包与服务，根启动器只显示通用启动提示，品牌艺术字由后端输出。只保留一层模块标签；API 使用 `pino-pretty` 显示 UTC 时间、级别和受控事件字段，编译错误照常输出，代码重启保留已有记录。

启动提示表示“正在启动”，不代表端口或数据库已就绪。API 真正监听成功后输出青色 neobo 艺术字及实际绑定地址、端口，健康检查路径为 `/api/health`；Vite 显示自身实际启动结果。艺术字表示 API 已监听，PostgreSQL / Redis 状态仍以 `/api/ready` 为准。禁色时艺术字保留为纯文本，生产不输出艺术字。

主题包、共享场景包、播放器包按依赖顺序首次强制构建，再进入同一 TypeScript build 模式监听，产物与增量状态分别位于各包 `dist`；初次监听无需再次写入产物。共享包重建后，使用它的开发工具或服务读取最新产物；默认应用当前尚未挂载场景业务路由。

API 首次使用 TypeScript build 模式强制编译，再进入同一构建模式的监听，避免监听启动时重复写入产物而触发第二次启动。每次后端启动成功只打印一次艺术字，修改后端代码导致的正常重启仍会打印。调整开发脚本或启动配置后，停止旧的 `pnpm dev` 再重新运行。首次构建期间按 Ctrl+C 也会停止启动，不继续进入下一包或启动服务。

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

## 前端公共组件

Web 已配置 Tailwind CSS 4.3.3、shadcn/ui 的 Radix + Nova 源码及 Vite/TypeScript/Vitest 一致的 `@/*` 别名；正常开发仍使用冻结安装和 `pnpm dev`。设计变量在 `apps/web/src/styles.css`，公共组件在 `apps/web/src/components/ui`，不逐页建立另一套控件样式。

添加确有需要的组件时，先预览再执行，例如：

```bash
pnpm --filter @neobo/web ui:add button --dry-run
pnpm --filter @neobo/web ui:add <组件名>
```

`ui:add` 固定调用 shadcn 4.22.1，需网络，仅用于手动生成组件。CLI 的间接依赖存在未修复高危通告，因此不作为项目常驻依赖或在 CI 运行；仅对已核对的官方组件使用，不接收上传文件或不可信注册表。当前所需的 CSS 状态变体已按官方 eject 方式保留在 `apps/web/src/shadcn.css`，来源许可位于公共组件目录。新增组件后核对变体、许可、依赖精确版本及锁文件，不直接覆盖本地改动或重新加入 CLI 常驻依赖。[官方 CLI 说明](https://ui.shadcn.com/docs/cli#eject)、[接入决定](decisions/0006-editor-ui.md)。

修改公共组件或样式后运行 `pnpm check`；菜单、拖动或布局变化再在本地运行下方浏览器验证。jsdom 不提供布局观察，测试仅补齐 ResizeObserver 接口；实际尺寸、定位和焦点由真实 Chromium 验收。

每次开发修改完成检查后，及时同步对应文档、使用说明和迭代证据，再提交 PR；流程见 [开发规范](development.md) 和 [PR 提交流程](pull-requests.md)。删除或替换功能时一并清理失效说明、命令、选择器和引用，不删除历史迭代或 ADR 的原始依据。

## 场景组件注册

场景原子组件的注册接口位于 `packages/player/src/component-registry.ts`，内置声明位于同目录 `components.tsx`；它与前述应用 UI 控件职责不同。当前注册 `text`、`rectangle`、`bar-chart` 的 `componentVersion: 1`，统一管理 `label`、`defaultSize`、`render`，文字另有 `defaultText`，柱状图另有独立冻结的 `defaultData`。Web 编辑器通过 `editor/create-scene-component.ts` 生成节点，再走原有命令提交；图层与属性标签、`SceneView` 绘制也读取这些声明。

只读 `ScenePlayer` / `SceneView` 及编辑器创建工厂可接收显式注册表，替换已有类型的默认值或表现。组合仍由场景树处理；注册表不会自行增加共享契约的合法类型，也不加载动态插件。React 与 ECharts 绘制位于 `@neobo/player`，使用 `@neobo/scene/document` 的文档与校验、`@neobo/theme` 的固定定义；通过公共包出口消费，不导入私有实现。开发示例与限制见 [播放器说明](../packages/player/README.md)、[ADR 0009](decisions/0009-readonly-player.md) 和 [柱状图决定](decisions/0008-static-bar-chart.md)。

ECharts 6.1.0 的实际绘制代码仅在柱状图出现时懒加载，使用按需 SVG 渲染、显式逻辑尺寸和对称销毁，不为每次拖动或窗口变化新增图表实例。模块加载或图表运行失败时显示固定错误并保留节点编辑入口；已加载模块的运行时失败可在数据、尺寸或有效主题改变后重建。模块下载失败没有自动重试，编辑数据不能重新下载；刷新会清空当前会话。修改默认值、标签或绘制后按既有检查流程验收，涉及实际画面时执行下方浏览器回归。

## 构建与第三方许可

在根目录运行 `pnpm -r build` 按依赖顺序构建，或先构建 Theme、Scene、Player 再运行 Web build。运行 `pnpm --filter @neobo/web build` 后，Web 产物位于 `apps/web/dist`。Vite 的 `build.license` 生成 `dist/licenses.md`，收录 ECharts、zrender、tslib 等依赖的许可文本；`apps/web/public/echarts-NOTICE` 保留 ECharts 上游 NOTICE 原文，构建时复制为 `dist/echarts-NOTICE`。

播放器包输出未打包的 ESM 与声明，ECharts 由宿主打包；独立宿主也需保留依赖许可与 ECharts 官方 NOTICE。

分发 Web 构建目录时一并保留上述文件。更新图表依赖时核对上游许可和 NOTICE，重新构建并检查产物；第三方许可不代表本仓库整体许可证已确定，也不代表已完成发布或部署。

## 浏览器验证

`pnpm check` 包含 jsdom 组件/交互测试。画布交互或渲染变更时，提交前在本地运行以下真实 Chromium 回归，并在 PR 中记录结果；CI 不安装或运行浏览器：

```bash
pnpm --filter @neobo/theme build
pnpm --filter @neobo/scene build
pnpm --filter @neobo/player build
pnpm exec playwright install --with-deps --only-shell chromium
pnpm test:browser
```

Playwright 版本固定为 1.64.1，仅为开发依赖。浏览器安装步骤可能需要系统包权限；已具备运行库时可只执行 `pnpm exec playwright install --only-shell chromium`。具体系统支持以 [官方浏览器安装说明](https://playwright.dev/docs/browsers) 为准。

测试自行启动 `127.0.0.1:4174` 的 Vite 服务，不复用已有进程，不需要数据库或真实 API。端口被占用时明确失败，结束后释放自己的服务与浏览器。失败 trace 和截图位于被忽略的 `apps/web/test-results/`；查阅后删除该目录即可，不提交临时报告。当前覆盖 Chromium 桌面、低高度横屏和窄屏布局，以及两套主题切换、真实配色、只读预览与返回时的历史、草稿和资源释放，未声称其他浏览器、真机触控或性能验收。

## 日常命令

| 命令              | 作用                                                    |
| ----------------- | ------------------------------------------------------- |
| `pnpm dev:setup`  | 安全创建本地 `.env`，保留已有文件                       |
| `pnpm dev:doctor` | 检查开发前置条件，按实际输出修复后再启动                |
| `pnpm infra:up`   | 启动开发数据库、Redis，并等待容器健康                   |
| `pnpm infra:logs` | 查看开发基础服务日志                                    |
| `pnpm infra:down` | 停止并移除开发容器，保留数据卷                          |
| `pnpm dev`        | 构建并监听主题、场景、播放器包，同时启动前后端开发进程  |
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
