# 参与贡献

neobo 已提供本地二维画布、统一场景命令与历史、公共 UI 和编辑菜单，以及 API 日志和自动检查。场景保存、权限、完整播放器与 AI 等仍待实现；启动步骤见 [本地开发](docs/local-development.md)，最新进度见 [路线图](docs/roadmap.md) 和 [迭代记录](docs/iterations/README.md)。

开始前请阅读：

- [AI 与开发入口](AGENTS.md)
- [架构方案](docs/architecture.md)
- [开发规范](docs/development.md)
- [日志与审计设计](docs/logging.md)
- [CI/CD 规则](docs/ci-cd.md)
- [迭代记录与填写规则](docs/iterations/README.md)

## 提交步骤

先复用已有能力和成熟方案；注释简洁说明意图。需求或事实查证后仍不确定时，先向用户或需求提出者确认，再实施依赖该答案的改动，不能凭空补全。

1. 从最新 `main` 创建短期分支。较大的架构或协议调整，先在 Issue 或 PR 中说明设计和兼容策略。
2. 完成范围明确的修改和 review，按风险补充验证。
3. 按仓库固定版本安装工具，执行 `pnpm install --frozen-lockfile --ignore-scripts` 和 `pnpm check`。新增业务包时，把实际检查接入统一入口；检查失败时先修复并复验。
4. 按最终实现和检查结果及时更新相关文档、开发说明及迭代记录，清理失效引用和临时产物，再检查文档格式和链接。每次开发或修改都需在提交 PR 前完成文档同步，详见 [开发规范](docs/development.md#文档同步与提交顺序)。
5. 提交说明使用中文并保留 Conventional Commits 前缀，例如 `feat(scene): 新增场景分组命令` 或 `docs: 说明主题包边界`。
6. 按 [中文 PR 与 AI 提交流程](docs/pull-requests.md) 填写默认模板，标题和正文使用中文，说明问题、变化、验证结果和限制。当前单人维护期，检查通过后由维护者自审并手动合入；有独立协作者后要求至少一位非作者批准。具体设置见 [GitHub 设置](docs/github-setup.md)。

请勿提交访问密钥、生产数据、依赖目录或构建缓存。漏洞报告不要在公开 Issue 中披露利用细节，遵循 [安全政策](SECURITY.md)。

许可证待维护者确定，首次正式发布前补充 `LICENSE`。
