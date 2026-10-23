# 场景组件注册与绘制

本目录提供文字、矩形、静态单系列柱状图的 Web 注册入口与只读 `SceneView`。共享数据、校验、命令和历史仍在 `@neobo/scene`；React 与 ECharts 实现留在 Web。组合是场景结构，由 `SceneView` 处理层级、顺序、可见性和变换，不作为原子组件登记。

## 现有入口

- `component-registry.ts`：`createSceneComponentRegistry` 接收受信任的 TypeScript 声明，按 `type` 与 `componentVersion` 精确解析；当前支持 `text`、`rectangle`、`bar-chart` 的版本 `1`。重复登记、无效默认值和未登记版本明确失败，不回退或静默绘制空白。
- `components.tsx`：`sceneComponents` 保存内置名称、默认尺寸、默认文字/图表数据及纯绘制回调；`createSceneComponent` 消费默认值，逐维限制在画布内并居中，再通过共享契约校验返回独立节点。柱状图默认为 480×320、`defaultData: []`；登记的数据数组和每行均为独立冻结快照，每次创建产生独立节点与数据行。工厂不提交编辑；调用方仍需执行 `node.add` 命令和历史。
- `SceneView.tsx`：默认使用内置注册表，也可传入 `registry`。编辑器添加按钮、图层和属性类型名称已消费同一份内置声明；选择、表单、拖动及历史继续归编辑器管理。

登记时保存冻结的独立元数据快照，后续修改声明对象不会改变已登记内容。绘制回调仍是受信任代码，注册声明来自应用源码；图表懒加载只导入同一构建中的固定模块，当前没有 JSON 注册表、远程插件发现或不可信代码沙箱。

## 替代现有类型的绘制

以下示例放在本目录时使用相对导入。注册表需包含待绘制文档中的全部原子类型；替代绘制继续消费相同的版本化节点字段，不能借此添加共享契约不认识的字段或组件类型。

```tsx
import type { RectangleNode, SceneDocument } from '@neobo/scene';
import { createSceneComponentRegistry } from './component-registry';
import { sceneComponents } from './components';
import { SceneView } from './SceneView';

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
    render: (node) => <OutlineRectangle node={node} />,
  },
]);

export function Preview({ document }: { readonly document: SceneDocument }) {
  return (
    <svg viewBox={`0 0 ${document.canvas.width} ${document.canvas.height}`}>
      <SceneView document={document} registry={registry} />
    </svg>
  );
}
```

`render` 是普通纯回调，不能直接调用 Hook，也不能直接调用 React 组件函数。需要状态、副作用或资源的绘制器应像示例一样返回独立组件，在组件内部使用 Hook；其 Effect 负责创建与释放资源，覆盖依赖变化、隐藏、删除和卸载，且能承受 StrictMode 的额外建立/清理周期。[React 组件调用规则](https://react.dev/reference/rules/react-calls-components-and-hooks)、[Hook 规则](https://react.dev/reference/rules/rules-of-hooks)、[Effect 生命周期](https://react.dev/reference/react/useEffect)。

## 静态柱状图绘制

`bar-chart` 登记回调返回独立的 `BarChartView`。外层保留透明命中框及 `foreignObject`，由 React `lazy`/`Suspense` 按需加载 `BarChartSurface`；空白画布不预先引入 ECharts 的实际绘制模块。模块中只注册 ECharts 6.1.0 的 `BarChart`、`GridComponent` 与 `SVGRenderer`，通过 `ComposeOption` 生成单系列选项，不引入 tooltip、HTML formatter、数据源或图表事件。

HTML 容器显式使用节点逻辑宽高，外层场景的 viewBox、坐标和组合旋转负责最终屏幕变换。图表内容不接管指针，选择、拖动与右键继续命中场景框；图表动画和交互关闭，不新增窗口监听或尺寸观察器。实例按容器生命周期初始化，数据变化用 `notMerge: true` 全量更新，只有逻辑宽高变化才 resize；有界数据按值比较，拖动预览或历史复制不会重复 setOption。

运行时失败销毁实例，隐藏节点/父组合、删除与卸载也配对 dispose，支持 StrictMode 的额外建立/清理周期。加载失败或运行时异常显示固定的“柱状图绘制失败。”并保留命中框，不回显原始错误；已加载模块的初始化/更新/resize 失败后，数据或尺寸改变可重建，同值的文档复制不会反复重试。React `lazy` 缓存加载 Promise，模块下载拒绝后没有自动重试，编辑数据也不会重新下载；刷新会清空当前会话。[官方缓存语义](https://react.dev/reference/react/lazy)。

场景只保存经过共享校验的静态分类/数值数组，空数据合法；行数、类别和数值范围见 [共享契约](../../../../packages/scene/README.md#静态柱状图契约)。属性区增删行仅改草稿，“应用属性”提交完整数据及其他变更为一步历史。Web 构建生成 `dist/licenses.md` 并复制 `public/echarts-NOTICE`，分发时保留这些第三方许可文件；维护步骤见 [构建说明](../../../../docs/local-development.md#构建与第三方许可)。

## 验证与边界

`component-registry.test.tsx` 验证版本、默认值、独立对象及命令/撤销；`SceneView.test.tsx` 验证注入注册表后的实际绘制、组合顺序与独立组件的资源释放。`BarChartView` 相关单元测试 mock ECharts 边界，验证更新、清空数据、失败、懒加载与销毁；jsdom 不用于证明文字测量或实际图表布局。根 `pnpm check` 覆盖这些测试和构建；本地 `pnpm test:browser` 验证真实 SVG 柱图、数据缩减、编辑撤销、组合旋转和窄屏布局。

新增图表类型前，先明确业务字段，再同步共享契约、严格校验、命令、属性编辑和测试。当前仅提供手填静态单系列柱状图，没有动态数据源、场景主题加载、动态扩展或独立播放器包；设计边界见 [ADR 0007](../../../../docs/decisions/0007-component-registry.md) 与 [ADR 0008](../../../../docs/decisions/0008-static-bar-chart.md)。
