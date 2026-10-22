# 参与贡献

neobo 已建立开发骨架、规范和自动检查，正在逐步实现大屏功能。启动步骤见 [本地开发](docs/local-development.md)，当前骨架不代表已完成看板业务。

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
2. 完成范围明确的修改，按风险补充验证，并同步相关文档和迭代记录。
3. 按仓库固定版本安装工具，执行 `pnpm install --frozen-lockfile` 和 `pnpm check`。新增业务包时，把实际检查接入统一入口。
4. 提交说明使用中文并保留 Conventional Commits 前缀，例如 `feat(scene): 新增场景分组命令` 或 `docs: 说明主题包边界`。
5. 按 [中文 PR 与 AI 提交流程](docs/pull-requests.md) 填写默认模板，标题和正文使用中文，说明问题、变化、验证结果和限制。当前单人维护期，检查通过后由维护者自审并手动合入；有独立协作者后要求至少一位非作者批准。具体设置见 [GitHub 设置](docs/github-setup.md)。

请勿提交访问密钥、生产数据、依赖目录或构建缓存。漏洞报告不要在公开 Issue 中披露利用细节，遵循 [安全政策](SECURITY.md)。

许可证待维护者确定，首次正式发布前补充 `LICENSE`。
