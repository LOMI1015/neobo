# 场景组件注册与绘制

本目录提供现有文字、矩形的 Web 注册入口与只读 `SceneView`。共享数据、校验、命令和历史仍在 `@neobo/scene`；组合是场景结构，由 `SceneView` 处理层级、顺序、可见性和变换，不作为原子组件登记。

## 现有入口

- `component-registry.ts`：`createSceneComponentRegistry` 接收受信任的 TypeScript 声明，按 `type` 与 `componentVersion` 精确解析；当前仅支持 `text`、`rectangle` 的版本 `1`。重复登记、无效默认值和未登记版本明确失败，不回退或静默绘制空白。
- `components.tsx`：`sceneComponents` 保存内置名称、默认尺寸、默认文字及纯绘制回调；`createSceneComponent` 消费默认值，逐维限制在画布内并居中，再通过共享契约校验返回独立节点。它不提交编辑；调用方仍需执行 `node.add` 命令和历史。
- `SceneView.tsx`：默认使用内置注册表，也可传入 `registry`。编辑器添加按钮、图层和属性类型名称已消费同一份内置声明；选择、表单、拖动及历史继续归编辑器管理。

登记时保存冻结的独立元数据快照，后续修改声明对象不会改变已登记内容。绘制回调仍是受信任代码；当前入口不读取 JSON 声明、不下载代码，也不是不可信插件沙箱。

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

## 验证与边界

`component-registry.test.tsx` 验证版本、默认值、独立对象及命令/撤销；`SceneView.test.tsx` 验证注入注册表后的实际绘制、组合顺序与独立组件的资源释放。根 `pnpm check` 覆盖这些测试和构建；渲染变更另在本地运行 `pnpm test:browser`。

新增图表类型前，先明确业务字段，再同步共享契约、严格校验、命令、属性编辑和测试。当前没有图表、数据源、主题加载、动态扩展或独立播放器包；设计边界见 [ADR 0007](../../../../docs/decisions/0007-component-registry.md)。
