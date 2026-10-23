# ADR 0008：静态单系列柱状图

- 状态：已接受（实施与本地验收通过）
- 日期：2026-10-23
- 范围：静态分类/数值契约、属性编辑、ECharts 绘制与资源释放
- 关联：[ADR 0003](0003-scene-contract.md)、[ADR 0007](0007-component-registry.md)

后续位置调整见 [ADR 0009](0009-readonly-player.md)：ECharts 依赖、注册与绘制迁入播放器包，数据契约与编辑语义保持兼容。

## 背景

用户已确认首个图表采用静态单系列柱状图，数据为分类名称和数值，支持添加、属性编辑、删除和撤销，暂不连接数据源。现有 Web 注册入口已由文字、矩形验证，需要通过实际图表接入验证严格数据契约与渲染生命周期。

## 决策

1. 在现有场景文档增加 `type: 'bar-chart'`、`componentVersion: 1` 的原子节点，额外字段仅为 `data: { category: string; value: number }[]`。按数组顺序绘制单系列，不保存任意 ECharts option、函数、HTML formatter 或数据源配置。
2. 空数组合法，新图表默认空数据，不预置业务样例。每图最多 100 条，分类名称 1–100 字符且非纯空白，不隐式 trim 或转换；数值有限、绝对值不超过 `1e12`，允许负值与零。这些是当前解析及绘制保护，不代表性能承诺或业务指标范围。
3. 沿用 `schemaVersion: 1` 并增加独立版本化组件类型；旧文字/矩形/组合文档保持兼容。旧读取器会明确拒绝新类型，不宣称前向兼容或自动迁移。`node.update.changes.data` 全量替换数据，仅允许用于柱状图，仍经统一命令、修订检查和原子历史提交。
4. Web 注册表增加柱状图描述，默认尺寸 480×320，沿用画布内尺寸限制与居中规则。属性区用统一公共控件编辑分类/数值行，草稿与场景隔离，一次应用形成一步历史；增删元素、显隐、组合及撤销复用既有入口。
5. 使用固定版本 ECharts 6.1.0，按需注册 BarChart、GridComponent、SVGRenderer，以有类型的适配器生成静态配置。实际渲染模块通过 React.lazy 在首次绘制图表时加载，轻量命中框和错误边界保留在外层；空画布首屏不加载图表库。HTML 容器嵌入既有 SVG `foreignObject`；显式传逻辑尺寸，外层场景负责屏幕缩放、旋转与命中。关闭动画及图表交互，不与编辑器选择、拖动或右键菜单争抢。
6. 绘制回调返回独立 React 组件。实例创建与组件容器配对，数据使用完整替换更新，尺寸变化调用 resize；等值文档副本及位置/旋转变化不重复更新图表。隐藏、删除、卸载、初始化后配置失败均释放资源；加载完成前卸载不创建实例。模块加载失败显示固定错误，已加载模块的运行异常可在数据或尺寸变化后重新建立；React.lazy 缓存加载 Promise，不提供自动重新下载。单元测试验证生命周期，本地 Chromium 验证实际 SVG 绘制与编辑行为，CI 不增加浏览器步骤。

## 官方依据与兼容性

- ECharts 官方推荐按需入口与 `ComposeOption` 类型，尺寸文档支持显式初始化/resize，并要求容器销毁时 dispose。[按需导入](https://echarts.apache.org/handbook/en/basics/import/)、[尺寸与释放](https://echarts.apache.org/handbook/en/concepts/chart-size/)。
- 6.1.0 为当前官方稳定发布，Apache-2.0；直接依赖 zrender 6.1.0（BSD-3-Clause）、tslib 2.3.0（0BSD）。本次 npm 官方审计接口未返回这三个版本的通告；实际依赖树与 Node/React/Vite 兼容性以锁文件、构建和验收结果为准。[官方发行](https://github.com/apache/echarts/releases/tag/6.1.0)、[包声明](https://registry.npmjs.org/echarts/6.1.0)。
- 复用 Vite 内置许可清单输出到 `dist/licenses.md`，ECharts 官方 NOTICE 通过 `public/echarts-NOTICE` 一起进入产物，不另造许可扫描脚本。[Vite 许可输出](https://vite.dev/config/build-options#build-license)、[官方 NOTICE](https://github.com/apache/echarts/blob/6.1.0/NOTICE)。
- 懒加载、Suspense 和错误边界复用 React，加载 Promise 的缓存语义以官方说明为准；本轮不增加通用加载/重试框架。[React.lazy](https://react.dev/reference/react/lazy)。

## 边界

本轮不增加数据连接器、多系列、其他图表、主题、动画、发布/存储、权限或生产场景路由。分类按普通文本传入，不开放图表脚本或 HTML 模板。安全请求校验继续复用共享契约，测试控制器不进入生产应用。
