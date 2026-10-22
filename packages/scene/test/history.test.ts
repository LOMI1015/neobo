import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { validateSceneDocument, type SceneDocument } from '../src/document.js';
import {
  createSceneHistory,
  SCENE_HISTORY_LIMITS,
  type SceneHistory,
  type SceneHistoryResult,
} from '../src/history.js';
import unsupportedFixture from './fixtures/scene-v0-unsupported.json' with { type: 'json' };
import fixture from './fixtures/scene-v1.json' with { type: 'json' };

function scene(revision = 0, text = '初始文字') {
  return {
    schemaVersion: 1,
    id: 'scene-1',
    revision,
    canvas: { width: 1920, height: 1080 },
    rootIds: ['text-1'],
    nodes: [
      {
        id: 'text-1',
        type: 'text',
        componentVersion: 1,
        text,
        transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0 },
        visible: true,
      },
    ],
  };
}

function request(history: SceneHistory) {
  const current = history.current();
  return { sceneId: current.id, baseRevision: current.revision };
}

function update(text: string) {
  return { type: 'node.update', nodeId: 'text-1', changes: { text } };
}

function execute(history: SceneHistory, ...operations: unknown[]): SceneHistoryResult {
  return history.execute({ ...request(history), operations });
}

function success(result: SceneHistoryResult): SceneDocument {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('测试操作应成功。');
  expect(validateSceneDocument(result.document).success).toBe(true);
  return result.document;
}

function text(history: SceneHistory): string | undefined {
  const node = history.current().nodes.find((node) => node.id === 'text-1');
  return node?.type === 'text' ? node.text : undefined;
}

function byteBudget(document: { readonly revision: number }): number {
  return Buffer.byteLength(
    JSON.stringify({ ...document, revision: Number.MAX_SAFE_INTEGER }),
    'utf8',
  );
}

describe('可撤销的场景批次', () => {
  it('独立接收第一版样例，拒绝不支持版本及无效初始文档', () => {
    const history = createSceneHistory(fixture);
    expect(history.current()).toEqual(fixture);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    for (const initial of [unsupportedFixture, null, { ...scene(), secret: 'synthetic-secret' }]) {
      expect(() => createSceneHistory(initial)).toThrow('初始场景文档无效。');
    }
  });

  it('整个批次只占一步，撤销和重做恢复内容、节点顺序及树层级', () => {
    const history = createSceneHistory(fixture);
    const added = { ...scene().nodes[0], id: 'text-2' };
    const changed = success(
      execute(
        history,
        update('批次修改'),
        { type: 'node.move', nodeId: 'rectangle-1', parentId: 'group-1', index: 0 },
        { type: 'node.add', node: added, parentId: null, index: 0 },
      ),
    );
    expect(changed.revision).toBe(fixture.revision + 1);
    expect(changed.rootIds).toEqual(['text-2', 'group-1']);
    const group = changed.nodes.find((node) => node.id === 'group-1');
    expect(group?.type === 'group' ? group.children : undefined).toEqual(['rectangle-1', 'text-1']);
    expect(success(history.undo(request(history)))).toEqual({
      ...fixture,
      revision: fixture.revision + 2,
    });
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    expect(success(history.redo(request(history)))).toEqual({
      ...changed,
      revision: fixture.revision + 3,
    });
    expect(history.canRedo()).toBe(false);
  });

  it('删除组合及全部子树后，一步恢复所有内容和原有顺序', () => {
    const history = createSceneHistory(fixture);
    const removed = success(execute(history, { type: 'node.remove', nodeId: 'group-1' }));
    expect(removed.rootIds).toEqual(['rectangle-1']);
    expect(removed.nodes.map((node) => node.id)).toEqual(['rectangle-1']);
    expect(success(history.undo(request(history)))).toEqual({
      ...fixture,
      revision: fixture.revision + 2,
    });
    expect(success(history.redo(request(history)))).toEqual({
      ...removed,
      revision: fixture.revision + 3,
    });
  });

  it('连续撤销和重做只恢复内容，修订号始终递增', () => {
    const history = createSceneHistory(scene());
    expect(success(execute(history, update('第一次'))).revision).toBe(1);
    expect(success(execute(history, update('第二次'))).revision).toBe(2);
    expect(success(history.undo(request(history))).revision).toBe(3);
    expect(text(history)).toBe('第一次');
    expect(success(history.undo(request(history))).revision).toBe(4);
    expect(text(history)).toBe('初始文字');
    expect(success(history.redo(request(history))).revision).toBe(5);
    expect(text(history)).toBe('第一次');
    expect(success(history.redo(request(history))).revision).toBe(6);
    expect(text(history)).toBe('第二次');
  });

  it('成功分叉清除重做，即使提交后的内容与当前相同也保留这次提交', () => {
    const history = createSceneHistory(scene());
    success(execute(history, update('被撤销的修改')));
    success(history.undo(request(history)));
    expect(history.canRedo()).toBe(true);
    const changed = success(execute(history, update('初始文字')));
    expect(changed.revision).toBe(3);
    expect(history.canRedo()).toBe(false);
    expect(history.redo(request(history))).toEqual({ success: false, code: 'HISTORY_EMPTY' });
    expect(success(history.undo(request(history))).revision).toBe(4);
    expect(text(history)).toBe('初始文字');
  });

  it('失败批次不改变文档、修订号、已有撤销和重做分支', () => {
    const history = createSceneHistory(scene());
    success(execute(history, update('第一步')));
    success(execute(history, update('第二步')));
    success(history.undo(request(history)));
    const before = history.current();
    expect(
      execute(history, update('禁止部分提交'), { type: 'node.remove', nodeId: 'missing' }),
    ).toEqual({ success: false, code: 'NODE_NOT_FOUND', operationIndex: 1 });
    expect(history.current()).toEqual(before);
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(true);
    success(history.redo(request(history)));
    expect(text(history)).toBe('第二步');
  });

  it('没有历史时返回固定错误，clear只清历史而不改当前文档', () => {
    const history = createSceneHistory(scene());
    const empty = { success: false, code: 'HISTORY_EMPTY' };
    expect(history.undo(request(history))).toEqual(empty);
    expect(history.redo(request(history))).toEqual(empty);
    success(execute(history, update('第一步')));
    success(execute(history, update('第二步')));
    success(history.undo(request(history)));
    const before = history.current();
    history.clear();
    history.clear();
    expect(history.current()).toEqual(before);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undo(request(history))).toEqual(empty);
    expect(history.redo(request(history))).toEqual(empty);
    expect(success(execute(history, update('清理后提交'))).revision).toBe(before.revision + 1);
  });
});

describe('历史请求的校验、并发和隔离', () => {
  it.each(['undo', 'redo'] as const)('%s拒绝错场景与旧修订号，随后正确请求仍可执行', (method) => {
    const history = createSceneHistory(scene());
    success(execute(history, update('已修改')));
    if (method === 'redo') success(history.undo(request(history)));
    const before = history.current();
    expect(history[method]({ ...request(history), sceneId: 'another-scene' })).toEqual({
      success: false,
      code: 'SCENE_MISMATCH',
    });
    expect(history[method]({ ...request(history), baseRevision: before.revision - 1 })).toEqual({
      success: false,
      code: 'REVISION_CONFLICT',
    });
    expect(history.current()).toEqual(before);
    expect(success(history[method](request(history))).revision).toBe(before.revision + 1);
  });

  it('execute拒绝迟到的并发提交，失败不产生额外历史', () => {
    const history = createSceneHistory(scene());
    const batch = { ...request(history), operations: [update('较早请求')] };
    success(execute(history, update('更新的内容')));
    expect(history.execute(batch)).toEqual({ success: false, code: 'REVISION_CONFLICT' });
    expect(text(history)).toBe('更新的内容');
    success(history.undo(request(history)));
    expect(text(history)).toBe('初始文字');
    expect(history.canUndo()).toBe(false);
  });

  it.each([
    null,
    [],
    {},
    { sceneId: 'scene-1' },
    { sceneId: 'scene-1', baseRevision: '0' },
    { sceneId: 'scene-1', baseRevision: -1 },
    { sceneId: 'scene-1', baseRevision: 0.5 },
    { sceneId: 'scene-1', baseRevision: Infinity },
    { sceneId: 'scene-1', baseRevision: Number.MAX_SAFE_INTEGER + 1 },
    { sceneId: 'scene-1', baseRevision: 0, 'synthetic-secret-key': 'synthetic-secret-value' },
    { sceneId: 'scene-1', baseRevision: 0, operations: [] },
  ])('严格拒绝非法撤销重做请求 %#，不回显输入', (input) => {
    const history = createSceneHistory(scene());
    expect(history.undo(input)).toEqual({ success: false, code: 'INVALID_COMMAND' });
    expect(history.redo(input)).toEqual({ success: false, code: 'INVALID_COMMAND' });
    expect(history.current()).toEqual(scene());
  });

  it('撤销和重做在修订号溢出时失败，不弹出历史或修改内容', () => {
    const undoHistory = createSceneHistory(scene(Number.MAX_SAFE_INTEGER - 1));
    success(execute(undoHistory, update('最后修订')));
    const undoBefore = undoHistory.current();
    expect(undoHistory.undo(request(undoHistory))).toEqual({
      success: false,
      code: 'REVISION_EXHAUSTED',
    });
    expect(undoHistory.current()).toEqual(undoBefore);
    expect(undoHistory.canUndo()).toBe(true);
    expect(undoHistory.canRedo()).toBe(false);

    const redoHistory = createSceneHistory(scene(Number.MAX_SAFE_INTEGER - 2));
    success(execute(redoHistory, update('最后重做内容')));
    success(redoHistory.undo(request(redoHistory)));
    const redoBefore = redoHistory.current();
    expect(redoHistory.redo(request(redoHistory))).toEqual({
      success: false,
      code: 'REVISION_EXHAUSTED',
    });
    expect(redoHistory.current()).toEqual(redoBefore);
    expect(redoHistory.canRedo()).toBe(true);
    expect(redoHistory.canUndo()).toBe(false);
  });

  it('初始化输入、提交输入、current和成功结果均不能篡改内部历史', () => {
    const initial = scene();
    const history = createSceneHistory(initial);
    initial.canvas.width = 1;
    initial.rootIds.length = 0;
    const initialNode = initial.nodes[0];
    if (initialNode) initialNode.text = '外部改写';
    expect(history.current()).toEqual(scene());

    const operation = update('受控提交');
    const submitted = success(execute(history, operation));
    operation.changes.text = '篡改命令';
    Reflect.set(submitted, 'revision', 100);
    Reflect.set(submitted.canvas, 'width', 1);
    Reflect.set(submitted.rootIds, 'length', 0);
    const returnedNode = submitted.nodes[0];
    if (returnedNode) Reflect.set(returnedNode, 'text', '篡改成功结果');
    const exposed = history.current();
    Reflect.set(exposed.nodes, 'length', 0);
    expect(history.current().revision).toBe(1);
    expect(history.current().canvas.width).toBe(1920);
    expect(history.current().rootIds).toEqual(['text-1']);
    expect(text(history)).toBe('受控提交');

    const undone = success(history.undo(request(history)));
    Reflect.set(undone.canvas, 'width', 3);
    const undoneNode = undone.nodes[0];
    if (undoneNode) Reflect.set(undoneNode.transform, 'x', 999);
    expect(history.current()).toEqual({ ...scene(), revision: 2 });
    const redone = success(history.redo(request(history)));
    Reflect.set(redone.nodes, 'length', 0);
    expect(text(history)).toBe('受控提交');
    success(history.undo(request(history)));
    expect(history.current()).toEqual({ ...scene(), revision: 4 });
  });

  it('组合子引用和嵌套变换的返回值不共享内部可变对象', () => {
    const history = createSceneHistory(fixture);
    const exposed = history.current();
    const group = exposed.nodes.find((node) => node.type === 'group');
    if (!group || group.type !== 'group') throw new Error('样例必须包含组合。');
    Reflect.set(group.children, 'length', 0);
    Reflect.set(group.transform, 'rotation', 123);
    expect(history.current()).toEqual(fixture);
  });
});

describe('有界历史容量', () => {
  it('公开默认预算，按条数淘汰最旧历史，仍可反向执行最近一步', () => {
    expect(SCENE_HISTORY_LIMITS).toEqual({ maxEntries: 100, maxBytes: 16 * 1024 * 1024 });
    const history = createSceneHistory(scene(), { maxEntries: 2 });
    for (const value of ['第一步', '第二步', '第三步']) success(execute(history, update(value)));
    success(history.undo(request(history)));
    expect(text(history)).toBe('第二步');
    success(history.undo(request(history)));
    expect(text(history)).toBe('第一步');
    expect(history.canUndo()).toBe(false);
    success(history.redo(request(history)));
    success(history.redo(request(history)));
    expect(text(history)).toBe('第三步');
    expect(history.current().revision).toBe(7);
  });

  it('单条预算在execute、undo和redo之间持续提供最近一步反向执行', () => {
    const history = createSceneHistory(scene(), { maxEntries: 1 });
    success(execute(history, update('第一步')));
    success(execute(history, update('第二步')));
    success(history.undo(request(history)));
    expect(text(history)).toBe('第一步');
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    success(history.redo(request(history)));
    expect(text(history)).toBe('第二步');
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it('UTF-8 JSON预算预留修订号位数，中文、emoji和转义字符可处于精确边界', () => {
    const initial = scene(0, '中文😀\n"\\\ud800');
    const maxBytes = byteBudget(initial);
    expect(maxBytes).toBeGreaterThan(JSON.stringify(initial).length);
    expect(() => createSceneHistory(initial, { maxBytes: maxBytes - 1 })).toThrow(
      '场景历史容量不足。',
    );
    const history = createSceneHistory(initial, { maxBytes });
    success(execute(history, update(initial.nodes[0]?.text ?? '')));
    success(history.undo(request(history)));
    success(history.redo(request(history)));
    expect(text(history)).toBe(initial.nodes[0]?.text);
  });

  it('字节预算约束past和future总和，淘汰旧快照而不逐次扩大历史', () => {
    const initial = scene(0, '初始');
    const bytes = byteBudget(initial);
    const history = createSceneHistory(initial, { maxBytes: bytes * 2 });
    for (const value of ['甲甲', '乙乙', '丙丙']) success(execute(history, update(value)));
    success(history.undo(request(history)));
    expect(text(history)).toBe('乙乙');
    success(history.undo(request(history)));
    expect(text(history)).toBe('甲甲');
    expect(history.canUndo()).toBe(false);
    success(history.redo(request(history)));
    success(history.redo(request(history)));
    expect(text(history)).toBe('丙丙');
  });

  it('新文档超过预算时拒绝整批，保留原文档和已有重做', () => {
    const initial = scene(0, 'a');
    const maxBytes = byteBudget(initial) + 8;
    const history = createSceneHistory(initial, { maxBytes });
    success(execute(history, update('b')));
    success(history.undo(request(history)));
    const before = history.current();
    expect(execute(history, update('😀'.repeat(20)))).toEqual({
      success: false,
      code: 'HISTORY_CAPACITY',
    });
    expect(history.current()).toEqual(before);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    success(history.redo(request(history)));
    expect(text(history)).toBe('b');
  });

  it.each([
    { method: 'undo' as const, revision: 8 },
    { method: 'redo' as const, revision: 7 },
    { method: 'undo' as const, revision: 98 },
    { method: 'redo' as const, revision: 97 },
  ])('$method跨修订号位数边界（初始$revision）仍可立即反向执行', ({ method, revision }) => {
    const initial = scene(revision, 'a');
    const maxBytes = byteBudget(initial);
    const history = createSceneHistory(initial, { maxBytes });
    success(execute(history, update('b')));
    if (method === 'redo') success(history.undo(request(history)));
    const before = history.current();
    expect([9, 99]).toContain(before.revision);
    expect(success(history[method](request(history))).revision).toBe(before.revision + 1);
    expect(text(history)).toBe(method === 'undo' ? 'a' : 'b');
    const reverse = method === 'undo' ? 'redo' : 'undo';
    success(history[reverse](request(history)));
    expect(text(history)).toBe(method === 'undo' ? 'b' : 'a');
  });

  it('past和future均按相同修订号预算计费，反向执行跨位数时不丢快照', () => {
    const initial = scene(5, 'a');
    const bytes = byteBudget(initial);
    const history = createSceneHistory(initial, { maxBytes: bytes * 2 });
    success(execute(history, update('b')));
    success(execute(history, update('c')));
    success(history.undo(request(history)));
    success(history.undo(request(history)));
    success(history.redo(request(history)));
    success(history.redo(request(history)));
    expect(history.current().revision).toBe(11);
    expect(text(history)).toBe('c');
    success(history.undo(request(history)));
    expect(text(history)).toBe('b');
    success(history.undo(request(history)));
    expect(text(history)).toBe('a');
    expect(history.canUndo()).toBe(false);
    success(history.redo(request(history)));
    success(history.redo(request(history)));
    expect(text(history)).toBe('c');
  });

  it.each([
    null,
    [],
    1,
    { maxEntries: 0 },
    { maxEntries: -1 },
    { maxEntries: 1.5 },
    { maxEntries: 101 },
    { maxEntries: '2' },
    { maxEntries: Infinity },
    { maxBytes: 0 },
    { maxBytes: 1.5 },
    { maxBytes: NaN },
    { maxBytes: SCENE_HISTORY_LIMITS.maxBytes + 1 },
    { maxBytes: '1024' },
    { 'synthetic-secret-key': 'synthetic-secret-value' },
  ])('拒绝非法配置 %#，不回显字段和值', (options) => {
    expect(() => createSceneHistory(scene(), options)).toThrow('场景历史配置无效。');
  });

  it('初始文档超预算时立即失败，不能创建不可记录撤销的历史对象', () => {
    expect(() => createSceneHistory(scene(), { maxBytes: 1 })).toThrow('场景历史容量不足。');
  });
});
