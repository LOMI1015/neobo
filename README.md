# neobo

通过 AI 对话与自由画布，搭建包含丰富动效和三维场景的数据大屏。

neobo 面向开源、自托管：以原子元素自由组合，功能底座与可独立导入的主题包分离，支持数据库、接口及多种大模型。

> 当前已提供二维画布（文字、矩形、组合及撤销/重做）、本地数据库环境和 API 请求日志基础。编辑内容仅在当前会话中，保存、主题和 AI 看板功能尚未实现。

## 设计方向

- **自由创作**：元素、组合、场景；AI 和鼠标共用可撤销的编辑操作。
- **主题独立**：底座保持简洁，样式、素材和动效通过主题包扩展。
- **二维与三维**：图表、three.js 场景、跟随标签和动画协同编辑。
- **数据与权限**：服务器统一查询、配置刷新，执行行级和字段级过滤。
- **模型可选**：通过适配层连接不同供应商及本地模型服务。

## 技术方向

TypeScript；React + Vite；shadcn/ui + Tailwind CSS；ECharts + three.js；**NestJS + Fastify**；PostgreSQL；Redis + BullMQ。

## 本地开发

安装 [.node-version](.node-version) 指定的 Node.js、[package.json](package.json) 固定的 pnpm，以及 Docker Compose，然后执行：

```bash
nvm use
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev:setup
pnpm infra:up
pnpm dev
```

打开 <http://127.0.0.1:5173> 进入画布，可切换到服务检查；画布编辑不依赖 API 连接。后端位于 `127.0.0.1:3000`，开发数据库和 Redis 使用 `15432`、`16379` 端口。完整步骤与故障处理见 [本地开发指南](docs/local-development.md)。

开发终端以 `[API]` / `[WEB]` 彩色标签区分服务；`NO_COLOR=1 pnpm dev` 可关闭颜色，非交互输出自动使用纯文本。

应用控件与样式使用统一的 shadcn/ui 公共组件和设计变量，图层及画布提供右键菜单；组件添加与维护见 [前端公共组件](docs/local-development.md#前端公共组件)。

执行 `pnpm check` 检查格式、文档、工作流规则，先按依赖顺序构建，再执行所有业务包的 `lint`、`typecheck`、`test`；缺少检查时 CI 失败。

画布交互或渲染变更时，在本地执行 `pnpm test:browser` 运行真实 Chromium 回归；首次安装及系统依赖见 [本地开发指南](docs/local-development.md#浏览器验证)。浏览器安装和回归由本地验收，CI 保留构建、类型、静态检查和单元/集成测试等基础门禁。

## 文档

| 入口                                  | 内容                               |
| ------------------------------------- | ---------------------------------- |
| [AGENTS.md](AGENTS.md)                | AI 开发阅读顺序与执行约束          |
| [架构方案](docs/architecture.md)      | 产品边界、模块、主题、数据与 AI    |
| [开发规范](docs/development.md)       | 代码边界、测试、评审和变更规则     |
| [日志与审计](docs/logging.md)         | 请求追踪、脱敏、操作审计与保存策略 |
| [CI/CD 规则](docs/ci-cd.md)           | 自动检查、GitHub 设置、发布与回滚  |
| [GitHub 设置](docs/github-setup.md)   | 分支保护、单人审批与后续多人协作   |
| [中文 PR 流程](docs/pull-requests.md) | 合并请求模板与 AI 自动提交约定     |
| [本地开发](docs/local-development.md) | 安装、启动、端口与常见故障         |
| [路线图](docs/roadmap.md)             | 分阶段目标和验收条件               |
| [迭代记录](docs/iterations/README.md) | 已完成工作、证据与后续任务         |
| [参与贡献](CONTRIBUTING.md)           | 提交方式与协作流程                 |

许可证待维护者确定，首次正式发布前补充 `LICENSE`。
