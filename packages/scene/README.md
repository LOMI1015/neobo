# 场景契约

`@neobo/scene` 提供第一版二维场景文档、严格运行时校验、统一原子命令和单人撤销/重做内核，支持文字、矩形和组合。渲染、存储、权限和主题加载由后续模块负责。

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

坐标、层级、字段与解析上限以 [ADR 0003](../../docs/decisions/0003-scene-contract.md) 为准；[第一版样例](test/fixtures/scene-v1.json) 保留兼容验证。导出的只读类型约束调用方式，不代表运行时对象已冻结，也不替代运行时校验或权限检查。

## 命令与历史

编辑器和 AI 使用相同的 `SceneCommandBatch`，显式指定 `sceneId`、`baseRevision` 和 `operations`。`validateSceneCommandBatch(unknown)` 只校验参数；`applySceneCommandBatch(document, batch)` 还检查当前场景、修订号与每步结构，返回独立新文档或固定错误码，失败不改原输入。

```ts
import { createEmptyScene, createSceneHistory } from '@neobo/scene';

const history = createSceneHistory(createEmptyScene({ id: 'example', width: 1920, height: 1080 }));
const result = history.execute({
  sceneId: 'example',
  baseRevision: 0,
  operations: [
    {
      type: 'node.add',
      parentId: null,
      index: 0,
      node: {
        id: 'title',
        type: 'text',
        componentVersion: 1,
        transform: { x: 100, y: 100, width: 400, height: 80, rotation: 0 },
        visible: true,
        text: '场景标题',
      },
    },
  ],
});
if (result.success) {
  history.undo({ sceneId: 'example', baseRevision: result.document.revision });
  // 内容恢复为空场景，修订号为 2；重做需要传入当前修订号。
  history.redo({ sceneId: 'example', baseRevision: history.current().revision });
}
```

公开操作为添加、更新、删除和移动节点，具体参数见 [ADR 0004](../../docs/decisions/0004-scene-commands.md)。添加的组合必须为空；通过后续 `node.move` 组织树结构。删除组合会删除全部后代，撤销整体恢复。移动索引相对于移除原节点后的目标列表；修改父节点后保留变换的父局部数值，不自动保持画面位置，视觉分组/拆组仍待画布交互实现。

每批 1–100 项操作，全部成功只递增一次修订号并形成一步历史；任何一步非法则整体失败。不允许通过无效中间结构绕过节点、深度或引用约束。成功的同值操作仍递增修订号；空批次拒绝。撤销和重做也检查场景与当前修订，并继续递增修订号；达到最大安全整数后拒绝修改。

`createSceneHistory` 封装当前文档及两侧历史，`current()`、`execute()`、`undo()`、`redo()` 的文档结果均为独立副本。失败保留重做栈，成功的新编辑清空重做；`canUndo()` / `canRedo()` 查询可用历史，`clear()` 释放两侧历史且保留当前文档与修订号。

可通过 `maxEntries`、`maxBytes` 调低历史容量，默认和最大保护值分别为 100 条、16 MiB。过去和未来的保留快照合计遵守预算，当前文档单独也不得超过字节预算；计量使用文档 UTF-8 JSON 字节，统一为修订号预留 16 位空间，避免位数增长造成撤销容量不足，不代表堆内存。超出预算时优先淘汰距离当前更远的旧历史，并保留刚保存的快照以支持立即反向操作；单个结果无法容纳时明确拒绝，不消耗修订号。初始化文档或配置非法时抛出固定安全错误，执行阶段容量不足返回 `HISTORY_CAPACITY`。

当前内核同步管理单个内存会话，不提供跨进程并发、持久化、授权或外部副作用。后续服务端用例仍需在授权后原子比较并写入修订号，不能直接把通过参数校验的请求保存到数据库。

## 可视操作规划

`getNodeWorldCorners(document, nodeId)` 返回嵌套平移/中心旋转后的四角。`createTranslateCommandBatch(document, nodeIds, delta)` 接收场景逻辑像素位移，逆父世界旋转并去除被选祖先覆盖的后代；`createGroupCommandBatch(document, nodeIds, groupId)` 和 `createUngroupCommandBatch(document, groupId)` 规划保持画面几何的组合/拆组。

规划输入是已有合法文档；成功返回包含当前场景标识与基础修订的 `batch`，只经原命令预验，不直接提交。调用方仍需交给历史执行。失败返回固定码，不暴露节点内容；修订号耗尽沿用 `REVISION_EXHAUSTED`。

组合至少两个同级节点，允许非连续选择，新组占最高选中层；组内按原图层顺序排列，未选节点彼此顺序保持。组合/拆组最多 49 个直接目标；超出命令、节点、深度或数值限制时整批拒绝。拆组恢复位置/旋转及同级顺序，隐藏组合的直接子元素保持隐藏。边界和浏览器渲染含义见 [ADR 0005](../../docs/decisions/0005-canvas-editor.md)。

## 开发与检查

包从 `dist` 导出 ESM 和声明，使用 `workspace:*` 依赖。根 `pnpm check` 先按依赖顺序构建，再运行所有包的 lint、typecheck、test；根 `pnpm dev` 先构建本包，再共同监听本包和应用。单独使用本包前先运行：

```bash
pnpm --filter @neobo/scene build
```

本包的 `lint`、`typecheck`、`test`、`build` 均执行真实检查；`dev` 使用同一 TypeScript build 模式监听源码变化。
