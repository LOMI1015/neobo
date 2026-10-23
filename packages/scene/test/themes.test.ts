import { describe, expect, it } from 'vitest';
import {
  applySceneCommandBatch,
  createEmptyScene,
  createGroupCommandBatch,
  createSceneHistory,
  getNodeWorldCorners,
  SCENE_SCHEMA_VERSION,
  validateSceneCommandBatch,
  validateSceneDocument,
  type SceneCommandResult,
  type SceneDocument,
  type SceneHistoryResult,
} from '../src/index.js';
import fixture from './fixtures/scene-v1.json' with { type: 'json' };
import chartFixture from './fixtures/scene-v1-bar-chart.json' with { type: 'json' };

const light = { id: 'neutral-light', version: 1 } as const;
const dark = { id: 'deep-blue', version: 1 } as const;

function scene(): SceneDocument {
  return {
    ...createEmptyScene({ id: 'themes', width: 1920, height: 1080 }),
    rootIds: ['a', 'b'],
    nodes: ['a', 'b'].map((id, index) => ({
      id,
      type: 'rectangle',
      componentVersion: 1,
      visible: true,
      transform: { x: 100 + index * 200, y: 80, width: 120, height: 80, rotation: 30 },
    })),
  };
}

function batch(operations: readonly unknown[], baseRevision = 0) {
  return { sceneId: 'themes', baseRevision, operations };
}

function switchTheme(theme: unknown = dark) {
  return { type: 'scene.theme.set', theme };
}

function success(result: SceneCommandResult | SceneHistoryResult): SceneDocument {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('测试主题命令应成功。');
  expect(validateSceneDocument(result.document).success).toBe(true);
  return result.document;
}

describe('可选场景主题契约', () => {
  it('旧文档及空场景仍为v1，解析不注入默认主题', () => {
    for (const input of [fixture, chartFixture, scene()]) {
      const result = validateSceneDocument(input);
      expect(result).toEqual({ success: true, data: input });
      if (!result.success) throw new Error('旧文档应保持兼容。');
      expect(Object.hasOwn(result.data, 'theme')).toBe(false);
    }
    expect(SCENE_SCHEMA_VERSION).toBe(1);
  });

  it.each([light, dark])('显式主题保留引用与版本，JSON往返不改变数据：%j', (theme) => {
    const input = { ...chartFixture, theme };
    const result = validateSceneDocument(input);
    expect(result).toEqual({ success: true, data: input });
    const restored: unknown = JSON.parse(JSON.stringify(input));
    expect(validateSceneDocument(restored)).toEqual(result);
    if (!result.success) throw new Error('内置主题应合法。');
    expect(result.data.theme).not.toBe(theme);
  });

  it.each([
    null,
    {},
    'deep-blue',
    { id: 'synthetic-theme-secret', version: 1 },
    { id: 'deep-blue', version: 0 },
    { id: 'deep-blue', version: 2 },
    { id: 'deep-blue', version: '1' },
    { id: 'deep-blue' },
    { id: 'deep-blue', version: 1, 'synthetic-field-secret': '#ffffff' },
    { id: 'deep-blue', version: 1, tokens: { text: '#ffffff' } },
  ])('文档与命令拒绝非法主题并保持错误脱敏：%j', (theme) => {
    const result = validateSceneDocument({ ...scene(), theme });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('synthetic-');
    expect(validateSceneCommandBatch(batch([switchTheme(theme)]))).toEqual({
      success: false,
      code: 'INVALID_COMMAND',
    });
  });

  it('新增操作严格拒绝未知字段与缺少主题，不允许通过node.update写场景主题', () => {
    for (const operation of [
      { ...switchTheme(), extra: true },
      { type: 'scene.theme.set' },
      { type: 'node.update', nodeId: 'a', changes: { theme: dark } },
    ]) {
      expect(validateSceneCommandBatch(batch([operation]))).toEqual({
        success: false,
        code: 'INVALID_COMMAND',
      });
    }
  });
});

describe('场景主题命令与统一历史', () => {
  it('主题切换只递增一次修订，节点、树、布局与画布保持原值', () => {
    const input = scene();
    const before = structuredClone(input);
    const result = success(applySceneCommandBatch(input, batch([switchTheme()])));
    expect(result).toEqual({ ...before, theme: dark, revision: 1 });
    expect(input).toEqual(before);
    expect(getNodeWorldCorners(result, 'a')).toEqual(getNodeWorldCorners(before, 'a'));
  });

  it('主题和节点操作同批提交为一步，组合规划保留主题与画面几何', () => {
    const history = createSceneHistory(scene());
    const first = success(
      history.execute(
        batch([switchTheme(), { type: 'node.update', nodeId: 'a', changes: { visible: false } }]),
      ),
    );
    expect(first.revision).toBe(1);
    expect(first.theme).toEqual(dark);
    expect(first.nodes[0]?.visible).toBe(false);
    const group = createGroupCommandBatch(first, ['a', 'b'], 'group');
    expect(group.success).toBe(true);
    if (!group.success) throw new Error('主题场景应能组合。');
    const grouped = success(history.execute(group.batch));
    expect(grouped.theme).toEqual(dark);
    const groupedCorners = getNodeWorldCorners(grouped, 'a');
    const initialCorners = getNodeWorldCorners(first, 'a');
    if (!groupedCorners || !initialCorners) throw new Error('测试节点应有画面坐标。');
    for (const [index, point] of groupedCorners.entries()) {
      const initialPoint = initialCorners[index];
      if (!initialPoint) throw new Error('测试节点应保留四角。');
      expect(point.x).toBeCloseTo(initialPoint.x, 8);
      expect(point.y).toBeCloseTo(initialPoint.y, 8);
    }
    const ungrouped = success(history.undo({ sceneId: 'themes', baseRevision: 2 }));
    expect(ungrouped).toEqual({ ...first, revision: 3 });
    const original = success(history.undo({ sceneId: 'themes', baseRevision: 3 }));
    expect(original).toEqual({ ...scene(), revision: 4 });
    expect(Object.hasOwn(original, 'theme')).toBe(false);
  });

  it('同值命令仍遵守内核修订语义；调用方负责跳过无变化动作', () => {
    const input = { ...scene(), theme: dark };
    const result = success(applySceneCommandBatch(input, batch([switchTheme()])));
    expect(result).toEqual({ ...input, revision: 1 });
  });

  it('修订冲突、场景不匹配和修订耗尽都拒绝主题修改', () => {
    expect(applySceneCommandBatch(scene(), batch([switchTheme()], 1))).toEqual({
      success: false,
      code: 'REVISION_CONFLICT',
    });
    expect(
      applySceneCommandBatch(scene(), { ...batch([switchTheme()]), sceneId: 'other' }),
    ).toEqual({ success: false, code: 'SCENE_MISMATCH' });
    expect(
      applySceneCommandBatch(
        { ...scene(), revision: Number.MAX_SAFE_INTEGER },
        batch([switchTheme()], Number.MAX_SAFE_INTEGER),
      ),
    ).toEqual({ success: false, code: 'REVISION_EXHAUSTED' });
  });

  it('混合批次中后续失败不泄露前面的主题和节点修改，保留可重做历史', () => {
    const history = createSceneHistory(scene());
    success(history.execute(batch([switchTheme()])));
    success(history.undo({ sceneId: 'themes', baseRevision: 1 }));
    const before = history.current();
    const result = history.execute(
      batch(
        [
          switchTheme(light),
          { type: 'node.update', nodeId: 'a', changes: { transform: { x: 999 } } },
          { type: 'node.remove', nodeId: 'missing' },
        ],
        2,
      ),
    );
    expect(result).toEqual({ success: false, code: 'NODE_NOT_FOUND', operationIndex: 2 });
    expect(history.current()).toEqual(before);
    expect(history.canRedo()).toBe(true);
    const redone = success(history.redo({ sceneId: 'themes', baseRevision: 2 }));
    expect(redone).toEqual({ ...scene(), theme: dark, revision: 3 });
  });

  it('未知主题使整个批次预检失败，合法的前序操作也不能进入历史', () => {
    const history = createSceneHistory(scene());
    expect(
      history.execute(
        batch([
          { type: 'node.update', nodeId: 'a', changes: { visible: false } },
          switchTheme({ id: 'unknown', version: 1 }),
        ]),
      ),
    ).toEqual({ success: false, code: 'INVALID_COMMAND' });
    expect(history.current()).toEqual(scene());
    expect(history.canUndo()).toBe(false);
  });

  it('组合批次后续失败时，不保留主题、空组合或已移动的子节点', () => {
    const input = scene();
    const plan = createGroupCommandBatch(input, ['a', 'b'], 'group');
    if (!plan.success) throw new Error('测试组合规划应合法。');
    const history = createSceneHistory(input);
    const result = history.execute(
      batch([switchTheme(), ...plan.batch.operations, { type: 'node.remove', nodeId: 'missing' }]),
    );
    expect(result).toEqual({
      success: false,
      code: 'NODE_NOT_FOUND',
      operationIndex: plan.batch.operations.length + 1,
    });
    expect(history.current()).toEqual(input);
    expect(history.canUndo()).toBe(false);
  });

  it('新增主题超出历史字节容量时拒绝提交，不消耗修订号', () => {
    const input = scene();
    const maxBytes = JSON.stringify({ ...input, revision: Number.MAX_SAFE_INTEGER }).length;
    const history = createSceneHistory(input, { maxBytes });
    expect(history.execute(batch([switchTheme()]))).toEqual({
      success: false,
      code: 'HISTORY_CAPACITY',
    });
    expect(history.current()).toEqual(input);
    expect(history.canUndo()).toBe(false);
  });

  it('输入引用、命令、返回文档与历史快照相互隔离，撤销重做恢复完整主题', () => {
    const initialTheme = { ...light };
    const initial = { ...scene(), theme: initialTheme };
    const nextTheme = { ...dark };
    const operation = switchTheme(nextTheme);
    const history = createSceneHistory(initial);
    Reflect.set(initialTheme, 'id', 'deep-blue');
    expect(history.current().theme).toEqual(light);
    const applied = success(history.execute(batch([operation])));
    Reflect.set(nextTheme, 'id', 'neutral-light');
    Reflect.set(nextTheme, 'version', 2);
    expect(applied.theme).toEqual(dark);
    expect(applied.theme).not.toBe(nextTheme);
    expect(applied.theme).not.toBe(history.current().theme);
    if (!applied.theme) throw new Error('切换结果应包含主题。');
    Reflect.set(applied.theme, 'id', 'neutral-light');
    expect(history.current().theme).toEqual(dark);
    const undone = success(history.undo({ sceneId: 'themes', baseRevision: 1 }));
    expect(undone.theme).toEqual(light);
    const redone = success(history.redo({ sceneId: 'themes', baseRevision: 2 }));
    expect(redone.theme).toEqual(dark);
    const clone = history.current();
    if (!clone.theme) throw new Error('当前场景应包含主题。');
    Reflect.set(clone.theme, 'version', 2);
    expect(history.current().theme).toEqual(dark);
  });
});
