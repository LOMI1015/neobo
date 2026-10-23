# 固定场景主题

`@neobo/theme` 提供框架无关的主题引用、严格校验和两套固定定义，供场景文档、播放器与编辑器共同消费。仅依赖现有 Zod，不依赖 React、ECharts、NestJS 或数据库；不加载远程包、不执行主题代码。

## 公开入口

- `SceneThemeReference`：`{ id: 'neutral-light' | 'deep-blue'; version: 1 }`。
- `sceneThemeReferenceSchema`：严格校验外部引用，拒绝未知标识、版本、字段及隐式转换。
- `SceneThemeDefinition`：主题引用、`label` 与 `tokens`；`SceneThemeTokens` 包含下表八个实色字段。
- `SCENE_THEMES`：两套定义的只读冻结数组，定义与 token 也冻结。
- `DEFAULT_SCENE_THEME`：中性浅色定义。
- `resolveSceneTheme(reference?)`：缺省返回中性浅色；合法引用返回对应稳定定义，非法引用抛固定错误，不回退或回显输入。

| token              | 作用               |
| ------------------ | ------------------ |
| `canvasBackground` | 场景画布背景       |
| `text`             | 文字元素           |
| `rectangleFill`    | 矩形填充           |
| `rectangleStroke`  | 矩形描边           |
| `chartBar`         | 柱图柱子           |
| `chartText`        | 图表文字和坐标标签 |
| `chartAxis`        | 坐标轴及刻度线     |
| `chartGrid`        | 图表网格线         |

定义加载时按严格结构校验，颜色仅接受六位十六进制实色；公开结果为独立冻结数据。当前两套预设为“中性浅色”和“深色蓝”，没有任意 CSS、ECharts option 或函数入口。

```ts
import { resolveSceneTheme, sceneThemeReferenceSchema } from '@neobo/theme';

const result = sceneThemeReferenceSchema.safeParse({ id: 'deep-blue', version: 1 });
if (result.success) {
  const theme = resolveSceneTheme(result.data);
  // 宿主消费经过校验的只读定义，不修改主题数据。
  void theme.tokens.canvasBackground;
}
```

## 场景与绘制边界

场景仅保存可选主题引用，缺省旧文档按中性浅色绘制，解析不注入字段。切换走 `scene.theme.set`、修订和统一历史，见 [场景包](../scene/README.md)；主题不改变布局、层级、数据、字号或节点组件版本。

[播放器](../player/README.md) 统一绘制背景并把稳定 token 传给内置组件。编辑器从同一数组生成自定义菜单选项，应用 UI 的颜色、字体、间距及控件状态仍使用 Web 自有设计变量。主题切换不等于应用界面的深色模式。

新增或修改预设时同步引用校验、固定版本及严格数据测试，并验证旧文档、切换撤销、图表可读性和编辑/播放一致。当前仅验证固定整场景预设，逐元素固定覆盖、自选色、字体、素材、动画、远程主题包与发布快照仍未实现；兼容边界见 [ADR 0010](../../docs/decisions/0010-scene-themes.md)。

## 开发与验证

```bash
pnpm --filter @neobo/theme build
pnpm --filter @neobo/theme test
```

根 `pnpm check` 覆盖本包构建、静态、类型与行为测试；根开发入口先构建 Theme→Scene→Player，再监听五个业务包。产物为 `dist` 下的 ESM 与声明，相对导入沿用 NodeNext 规则；公开入口只消费构建产物。当前为私有工作区包，未发布 npm。
