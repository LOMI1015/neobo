# 场景契约

`@neobo/scene` 提供第一版二维场景文档的类型与严格运行时校验，支持文字、矩形和组合的数据结构。它不负责渲染、命令、撤销、存储、权限或主题加载。

```ts
import { createEmptyScene, validateSceneDocument } from '@neobo/scene';
import type { SceneDocument } from '@neobo/scene';

const empty: SceneDocument = createEmptyScene({
  id: 'scene-example',
  width: 1920,
  height: 1080,
});
const result = validateSceneDocument(empty);
if (result.success) {
  const document: SceneDocument = result.data;
  // 使用经校验的文档，不直接使用外部输入。
  void document;
}
```

输入使用 `unknown`，成功返回独立校验产物；失败仅返回固定问题码和安全字段路径，不返回原始输入或库错误。所有字段都需显式提供，未知字段和未知版本会拒绝，不能通过删除字段或隐式类型转换让输入变成成功。

坐标、层级、字段与解析上限以 [ADR 0003](../../docs/decisions/0003-scene-contract.md) 为准；[第一版样例](test/fixtures/scene-v1.json) 保留兼容验证。导出的只读类型约束调用方式，不代表运行时对象已冻结，也不替代后续统一命令和权限校验。

## 开发与检查

包从 `dist` 导出 ESM 和声明，使用 `workspace:*` 依赖。根 `pnpm check` 先按依赖顺序构建，再运行所有包的 lint、typecheck、test；根 `pnpm dev` 先构建本包，再共同监听本包和应用。单独使用本包前先运行：

```bash
pnpm --filter @neobo/scene build
```

本包的 `lint`、`typecheck`、`test`、`build` 均执行真实检查；`dev` 使用同一 TypeScript build 模式监听源码变化。
