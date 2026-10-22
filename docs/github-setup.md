# GitHub 仓库设置

核对日期：2026-10-22。本文是维护者操作指南，**尚未替远端仓库启用任何设置**。CI/CD 的完整约束见 [CI/CD 规则](ci-cd.md)。

## 1. 先让 CI 成功运行一次

1. 将仓库首次上传到 GitHub，默认分支使用 `main`；先确认没有上传 `.env`、凭据或本地数据。
2. 在仓库的 **Actions → CI** 查看首次 `main` 推送，确认任务 **`quality`** 成功。检查配置见 [ci.yml](../.github/workflows/ci.yml)。
3. 再配置下文规则。若找不到 `quality`，先修复或重新触发 CI；不要填工作流名 `CI` 代替任务名。

GitHub 要求可选的必需检查在该仓库最近七天内成功运行过。PR 合并时检查必须对应最新提交，旧提交的绿灯不算。[官方说明](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)

## 2. 只使用 squash 合并

进入 **Settings → General → Pull Requests**：

- 开启 squash 合并，默认提交信息选择使用 PR 标题。
- 关闭 merge commit 和 rebase 两种合并方式。
- 可开启合并后自动删除分支。

日常从 `main` 创建 `feat/*`、`fix/*` 等短期分支，通过 PR 合入；PR 标题和正文使用中文，标题保留 Conventional Commits 前缀，例如 `feat(scene): 新增场景分组命令`，详见 [模板与提交流程](pull-requests.md)。这是 neobo 的协作约定；GitHub 合并方式的设置见 [官方说明](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests)。

## 3. 创建 main 的 Ruleset

Ruleset 是服务器执行的保护规则，推荐新仓库使用它。以管理员身份打开 **Settings → Rules → Rulesets → New ruleset → New branch ruleset**，填写：

| 项目     | neobo 的设置                                                    |
| -------- | --------------------------------------------------------------- |
| 名称     | `main-protection`                                               |
| 执行状态 | `Active`，保存后实际执行                                        |
| 目标分支 | 按名称添加 `main`                                               |
| 绕过名单 | 留空，日常维护者和自动化均不绕过                                |
| 删除     | 限制删除                                                        |
| 强制推送 | 阻止强制推送                                                    |
| 合并入口 | 必须通过 PR                                                     |
| 评审对话 | 合并前必须全部解决                                              |
| 必需检查 | 添加 `quality`，确认已加入清单；可选择来源时使用 GitHub Actions |
| 主线同步 | 必须更新到最新主线后才能合并                                    |

PR 子选项中的批准人数按下一节设置。不要启用“限制更新”：它会将正常更新也限制给可绕过规则的角色。点击创建后，重新打开规则核对目标分支和执行状态。[创建步骤](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository)、[各项规则含义](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

### 单人开发和多人评审

**当前已确定采用单人维护，批准人数设为 `0`。** PR、`quality`、更新主线和解决对话仍然必需，维护者检查变更及验证结果后手动合并。这是单人开发期的明确规则；不要设置“必须一人批准”后再靠管理员绕过日常合并。

有第二位具备写入权限、可以独立评审的协作者后，将批准人数改为 `1`，开启“新代码提交后撤销旧批准”。评审者在 PR 的 **Files changed → Review changes → Approve → Submit review** 提交批准，之后的代码修改需要重新评审。

原因是 GitHub 不允许作者批准自己的 PR，AI 阅读或评论也不能替代非作者审批。新代码撤销旧批准的实际行为见 [官方评审说明](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)。

### 只能使用传统分支保护时

进入 **Settings → Branches → Add classic branch protection rule**，分支填写 `main`。要求 PR、`quality`、最新主线和解决对话；批准人数按上文设置。关闭允许强推和删除，开启禁止绕过规则。无需叠加一套内容相同的 Ruleset。[传统规则操作步骤](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)

### 仓库可见性和套餐

公开仓库在 GitHub Free 可用 Rulesets 和传统分支保护。私有仓库通常需要个人 Pro、组织 Team 或 Enterprise 等相应套餐。本文不假定仓库已经公开；若当前套餐不支持，应先确认可见性或套餐，人工约定不能当作已生效的服务器保护。[Rulesets 可用范围](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)、[分支保护可用范围](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## 4. 用一个 PR 验收

建立短期分支，修改一处文档并提交 PR：

1. 标题符合约定，等待 `quality` 完成，确认 PR 合并框列出这项必需检查。
2. 核对规则是 Active、目标为 `main`、绕过名单为空；协作期同时确认需要另一人批准。
3. 只在最新检查通过、对话解决、所需批准齐全时 squash 合并。

保留这次 PR 和 Actions 记录作为远端验证证据。配置文件存在、本地检查通过，都不代表这些 GitHub 设置已经生效。

## 5. 发布审批等 CD 落地时配置

目前没有发布或部署工作流，可以先不创建 `release`、`production` 环境。环境只有名称并不能形成审批保护；CD 接入前须完成下列设置并验证等待审批的行为：

1. **Settings → Environments → New environment**，分别创建所需环境。
2. 添加真实的审批人，开启防止自我审批，关闭管理员绕过。
3. 限制部署来源：`release` 仅允许 `main`；`production` 按最终工作流只允许实际使用的分支或标签。若使用 `v*` 标签，工作流还需核对它指向受保护 `main` 上已验证的提交。
4. 工作流任务引用对应环境，通过审核后才访问该环境的 secrets 和执行发布或部署。

防止自我审批意味着发起工作流的人不能批准自己的运行，需要另一位真实审批人。只有一人时暂缓依赖双人审批的 CD，不能把未保护环境写成已有审批。GitHub Free、Pro、Team 的必需环境审核者仅适用于公开仓库；私有环境可用性与审核者可用性也不同，实施时核对账户套餐。[环境创建、来源限制与审批的官方说明](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
