# 只读播放器与场景绘制

`@neobo/player` 提供可嵌入 React 应用的只读 `ScenePlayer`、低层 `SceneView` 和文字/矩形/静态柱状图注册表。输出独立 ESM JavaScript 与类型声明，React 为 peer，ECharts 为运行依赖；不依赖 Web 应用、编辑命令、历史、几何规划或 shadcn/ui。共享文档与校验来自 `@neobo/scene/document`，不改变场景字段或版本。

## 公开入口

```tsx
import { ScenePlayer } from '@neobo/player';

export function Preview({ document }: { readonly document: unknown }) {
  return <ScenePlayer document={document} label="场景预览画布" />;
}
```

`document` 必填，接受 `unknown`；`registry` 可选，默认 `sceneComponents`；`label` 可选，默认“场景播放器”。播放器每次绘制前运行严格校验并消费独立产物，非法文档或未知版本显示固定错误，卸载上一份场景；绘制异常也显示固定错误，不回显原始输入或异常正文。更新场景时传入新文档，挂载方负责取得已授权的数据。

输出为带可访问名称的 SVG，按父容器宽度和文档画布比例缩放，不带应用 CSS。需要同时适配视口宽高时，由宿主约束容器；Web 预览壳示例见 [App](../../apps/web/src/App.tsx)。播放器不提供编辑事件、快捷键、右键编辑菜单、选择框或属性控件。

`SceneView` 接收已校验的 `SceneDocument` 与可选 `registry`，只返回 SVG 内容，调用方提供外层 SVG/viewBox。编辑器复用该绘制入口，编辑与交互仍归 `apps/web/src/editor`。其 `createSceneComponent` 工厂读取公开注册元数据，逐维限制尺寸并居中，复用共享校验生成独立节点，再走添加命令与历史；工厂不在播放器运行出口中。

## 场景组件注册

`createSceneComponentRegistry` 接收受信任的 TypeScript 声明，按 `type + componentVersion` 精确解析，当前支持 `text`、`rectangle`、`bar-chart` 的版本 `1`。重复登记、无效默认值和未登记版本明确失败。声明包含名称、默认尺寸与纯绘制回调，文字另有 `defaultText`，柱状图另有 `defaultData`；登记时保存独立冻结的元数据及图表数据行。组合由 `SceneView` 处理引用顺序、可见性与变换，不登记为原子组件。

以下示例通过公共入口替换矩形表现，保持文档契约不变：

```tsx
import type { RectangleNode } from '@neobo/scene/document';
import { createSceneComponentRegistry, sceneComponents, ScenePlayer } from '@neobo/player';

function OutlineRectangle({ node }: { readonly node: RectangleNode }) {
  return (
    <rect
      width={node.transform.width}
      height={node.transform.height}
      fill="none"
      stroke="currentColor"
    />
  );
}

const registry = createSceneComponentRegistry([
  sceneComponents.resolve('text', 1),
  sceneComponents.resolve('bar-chart', 1),
  {
    ...sceneComponents.resolve('rectangle', 1),
    render: (node: RectangleNode) => <OutlineRectangle node={node} />,
  },
]);

export function Preview({ document }: { readonly document: unknown }) {
  return <ScenePlayer document={document} registry={registry} />;
}
```

注册表需覆盖待绘制文档中的原子类型，不能增加共享契约不认识的类型或字段。`render` 是纯回调，含 Hook 或资源时返回独立组件，由其 Effect 创建与释放；不能直接调用 Hook 或组件函数。清理需覆盖隐藏、删除、卸载与 StrictMode。[React 组件调用规则](https://react.dev/reference/rules/react-calls-components-and-hooks)、[Effect 生命周期](https://react.dev/reference/react/useEffect)。

注册只接受源码，当前没有 JSON 注册表、远程插件或不可信代码沙箱。后续主题包和自定义类型需先明确版本与业务契约，不能借注册表放宽校验。

## 静态柱状图绘制

内置柱图默认为 480×320、空数据；静态数组范围见 [共享契约](../scene/README.md#静态柱状图契约)。`BarChartView` 保留透明命中框与 `foreignObject`，通过 React.lazy/Suspense 按需加载 `BarChartSurface`；空画布不加载实际图表库。ECharts 6.1.0 只注册 BarChart、GridComponent、SVGRenderer，不加载数据源、HTML formatter、tooltip 或图表事件。

HTML 容器显式使用节点逻辑宽高，场景负责最终屏幕缩放与旋转。图表内容不接管指针，关闭动画和交互。数据以 `notMerge: true` 完整更新，有界数据按值比较，相同数据的文档副本不重复 setOption；只有逻辑尺寸变化才 resize。

隐藏节点/父组合、删除、卸载与运行时异常配对 dispose。已加载模块的初始化/更新/resize 失败可随数据或尺寸变化重建，同值副本不反复重试。React.lazy 缓存加载 Promise，下载拒绝没有自动重试，编辑数据不能重新下载；刷新会丢失当前编辑会话。[官方缓存语义](https://react.dev/reference/react/lazy)。

## 构建与验收

```bash
pnpm --filter @neobo/scene build
pnpm --filter @neobo/player build
pnpm --filter @neobo/player test
```

构建用 TypeScript NodeNext，源码相对导入明确使用 `.js`，输出至 `dist`；公共出口只解析构建产物。开发根入口依次构建 Scene、Player，再监听四个包。只消费本包的宿主还需配置 React 和实际打包工具；本包为私有工作区包，未发布 npm 或独立站点。

测试覆盖注册元数据、绘制树、非法文档、替换与资源释放；图表单元测试隔离 ECharts，实际布局由本地 Chromium 验证。`build-boundary.test.ts` 从独立 fixture 使用公共包出口，先以原生 Node 导入已编译 ESM，再用 Vite 生产构建元数据核对实际模块图及所有静态/动态产物引用，拒绝编辑器、应用 UI、命令/历史和源码别名；首屏静态依赖不包含 ECharts。构建仅在内存中生成，无服务器或临时输出。

根 `pnpm check` 覆盖构建、静态、类型与测试；画面与预览切换需本地 `pnpm test:browser`。Web 仍输出 `licenses.md` 与 `echarts-NOTICE`；独立宿主打包后也需保留所用依赖的许可与 NOTICE，见 [构建说明](../../docs/local-development.md#构建与第三方许可)。

本轮是静态只读嵌入与提交态预览；发布快照、权限、持久化、数据查询、主题、三维与动画尚未实现。决策与证据见 [ADR 0009](../../docs/decisions/0009-readonly-player.md) 和 [迭代记录](../../docs/iterations/README.md)。
