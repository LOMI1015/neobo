import { describe, expect, it } from 'vitest';
import {
  applySceneCommandBatch,
  createEmptyScene,
  createGroupCommandBatch,
  createSceneHistory,
  createTranslateCommandBatch,
  createUngroupCommandBatch,
  getNodeWorldCorners,
  SCENE_LIMITS,
  SCENE_SCHEMA_VERSION,
  validateSceneCommandBatch,
  validateSceneDocument,
  type BarChartDatum,
  type BarChartNode,
  type GroupNode,
  type SceneCommandResult,
  type SceneDocument,
  type SceneHistory,
  type SceneHistoryResult,
  type SceneNode,
} from '../src/index.js';
import fixture from './fixtures/scene-v1-bar-chart.json' with { type: 'json' };
import originalFixture from './fixtures/scene-v1.json' with { type: 'json' };

function chart(id = 'chart-1', data: readonly BarChartDatum[] = []): BarChartNode {
  return {
    id,
    type: 'bar-chart',
    componentVersion: 1,
    data,
    visible: true,
    transform: { x: 100, y: 80, width: 600, height: 360, rotation: 0 },
  };
}

function scene(
  nodes: readonly SceneNode[] = [chart()],
  rootIds = nodes.map((node) => node.id),
): SceneDocument {
  return { ...createEmptyScene({ id: 'chart-scene', width: 1920, height: 1080 }), nodes, rootIds };
}

function group(id: string, children: readonly string[]): GroupNode {
  return {
    id,
    type: 'group',
    visible: true,
    children,
    transform: { x: 50, y: 30, width: 800, height: 600, rotation: 90 },
  };
}

function batch(operations: readonly unknown[], baseRevision = 0) {
  return { sceneId: 'chart-scene', baseRevision, operations };
}

function update(data: unknown) {
  return { type: 'node.update', nodeId: 'chart-1', changes: { data } };
}

function success(result: SceneCommandResult | SceneHistoryResult): SceneDocument {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('测试命令应成功。');
  expect(validateSceneDocument(result.document).success).toBe(true);
  return result.document;
}

function chartIn(document: SceneDocument, id = 'chart-1'): BarChartNode {
  const node = document.nodes.find((node) => node.id === id);
  if (node?.type !== 'bar-chart') throw new Error('测试场景应包含柱状图。');
  return node;
}

function request(history: SceneHistory) {
  const current = history.current();
  return { sceneId: current.id, baseRevision: current.revision };
}

function rejectData(data: unknown): void {
  const document = { ...scene(), nodes: [{ ...chart(), data }] };
  expect(validateSceneDocument(document).success).toBe(false);
  expect(validateSceneCommandBatch(batch([update(data)]))).toEqual({
    success: false,
    code: 'INVALID_COMMAND',
  });
  expect(
    validateSceneCommandBatch(
      batch([{ type: 'node.add', node: document.nodes[0], parentId: null, index: 0 }]),
    ),
  ).toEqual({ success: false, code: 'INVALID_COMMAND' });
}

function oversizedData(): unknown[] {
  const data = Array.from({ length: SCENE_LIMITS.maxChartDataPoints + 1 }, () => ({}));
  Object.defineProperty(data, 0, {
    get() {
      throw new Error('超限数组不应读取条目。');
    },
  });
  return data;
}

describe('第一版静态单系列柱状图契约', () => {
  it('空数据合法，保留schemaVersion1及旧样例，新样例序列化后可恢复', () => {
    expect(validateSceneDocument(scene())).toEqual({ success: true, data: scene() });
    expect(SCENE_SCHEMA_VERSION).toBe(1);
    expect(validateSceneDocument(originalFixture)).toEqual({
      success: true,
      data: originalFixture,
    });
    expect(validateSceneDocument(fixture)).toEqual({ success: true, data: fixture });
    const restored: unknown = JSON.parse(JSON.stringify(fixture));
    expect(validateSceneDocument(restored)).toEqual({ success: true, data: fixture });
  });

  it('接受零、负数、数值上界及分类字符上界，保留顺序与原始字符串', () => {
    const data: BarChartDatum[] = [
      { category: '  分类甲  ', value: -SCENE_LIMITS.maxChartValue },
      { category: '分类甲', value: 0 },
      {
        category: '😀'.repeat(SCENE_LIMITS.maxChartCategoryLength),
        value: SCENE_LIMITS.maxChartValue,
      },
      { category: '小数', value: -0.25 },
    ];
    const parsed = validateSceneDocument(scene([chart('chart-1', data)]));
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('上界场景应合法。');
    expect(chartIn(parsed.data).data).toEqual(data);
    expect(chartIn(parsed.data).data).not.toBe(data);
    expect(chartIn(parsed.data).data[0]).not.toBe(data[0]);
    expect(validateSceneCommandBatch(batch([update(data)])).success).toBe(true);
  });

  it('恰好100条数据合法，不按分类名去重或重排', () => {
    const data = Array.from({ length: SCENE_LIMITS.maxChartDataPoints }, (_, value) => ({
      category: '相同分类',
      value,
    }));
    const parsed = validateSceneDocument(scene([chart('chart-1', data)]));
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('100条数据应合法。');
    expect(chartIn(parsed.data).data).toEqual(data);
  });

  it.each(['', ' \n\t', '\u00a0\u3000', '字'.repeat(101), '😀'.repeat(101), null, undefined, 1])(
    '文档、新增和更新均拒绝非法分类 %#',
    (category) => rejectData([{ category, value: 1 }]),
  );

  it.each([NaN, Infinity, -Infinity, 1e12 + 1, -1e12 - 1, '1', null, undefined])(
    '文档、新增和更新均拒绝非法数值 %#',
    (value) => rejectData([{ category: '分类', value }]),
  );

  it.each(
    [
      undefined,
      null,
      {},
      '[]',
      [null],
      [{ category: '缺少数值' }],
      [{ value: 1 }],
      [{ category: '分类', value: 1, option: 'synthetic-secret' }],
    ].map((data) => ({ data })),
  )('严格拒绝缺失或非数组数据、非法条目与未知字段 %#', ({ data }) => rejectData(data));

  it('节点严格拒绝未知字段、未知版本与字符串版本', () => {
    for (const invalid of [
      { ...chart(), componentVersion: 2 },
      { ...chart(), componentVersion: '1' },
      { ...chart(), option: { color: 'synthetic-secret' } },
      { ...chart(), children: [] },
    ]) {
      expect(validateSceneDocument({ ...scene(), nodes: [invalid] }).success).toBe(false);
      expect(
        validateSceneCommandBatch(
          batch([{ type: 'node.add', parentId: null, index: 0, node: invalid }]),
        ).success,
      ).toBe(false);
    }
  });

  it('文档预检先拒绝超长数组，错误只有固定问题码与已知字段路径', () => {
    const result = validateSceneDocument({
      ...scene(),
      nodes: [{ ...chart(), data: oversizedData() }],
    });
    expect(result).toEqual({
      success: false,
      issues: [{ code: 'INVALID_VALUE', path: ['nodes', 0, 'data'] }],
    });
    const secret = 'synthetic-chart-secret';
    const invalid = validateSceneDocument({
      ...scene(),
      nodes: [{ ...chart(), data: [{ category: secret, value: secret, [secret]: secret }] }],
    });
    expect(invalid.success).toBe(false);
    expect(JSON.stringify(invalid)).not.toContain(secret);
    if (invalid.success) throw new Error('非法数值应拒绝。');
    expect(invalid.issues.some((issue) => issue.path.join('.') === 'nodes.0.data.0.value')).toBe(
      true,
    );
  });

  it('新增和更新的命令预检先拒绝超长数组，不读取任何数据条目', () => {
    const data = oversizedData();
    expect(
      validateSceneCommandBatch(
        batch([{ type: 'node.add', parentId: null, index: 0, node: { ...chart(), data } }]),
      ),
    ).toEqual({ success: false, code: 'INVALID_COMMAND' });
    expect(validateSceneCommandBatch(batch([update(data)]))).toEqual({
      success: false,
      code: 'INVALID_COMMAND',
    });
  });
});

describe('柱状图统一命令、历史及树几何', () => {
  it('新增空图表和替换数据沿用同一命令批次，多个属性只推进一次修订', () => {
    const history = createSceneHistory(scene([]));
    success(
      history.execute(batch([{ type: 'node.add', parentId: null, index: 0, node: chart() }])),
    );
    const before = history.current();
    expect(chartIn(before).data).toEqual([]);
    const result = success(
      history.execute({
        ...request(history),
        operations: [
          {
            type: 'node.update',
            nodeId: 'chart-1',
            changes: {
              data: [{ category: '分类', value: -3 }],
              visible: false,
              transform: { x: 125, rotation: 35 },
            },
          },
        ],
      }),
    );
    expect(result.revision).toBe(2);
    expect(chartIn(result)).toMatchObject({
      data: [{ category: '分类', value: -3 }],
      visible: false,
      transform: { x: 125, rotation: 35 },
    });
    expect(success(history.undo(request(history)))).toEqual({ ...before, revision: 3 });
    expect(success(history.redo(request(history)))).toEqual({ ...result, revision: 4 });
  });

  it('data更新全量替换，空数组可清空数据，几何或可见性修改不删除数据', () => {
    const original = scene([
      chart('chart-1', [
        { category: '原分类', value: 1 },
        { category: '移除分类', value: 2 },
      ]),
    ]);
    const replaced = success(
      applySceneCommandBatch(original, batch([update([{ category: '新分类', value: 0 }])])),
    );
    expect(chartIn(replaced).data).toEqual([{ category: '新分类', value: 0 }]);
    const moved = success(
      applySceneCommandBatch(
        replaced,
        batch(
          [
            {
              type: 'node.update',
              nodeId: 'chart-1',
              changes: { transform: { x: -50 }, visible: false },
            },
          ],
          1,
        ),
      ),
    );
    expect(chartIn(moved).data).toEqual(chartIn(replaced).data);
    expect(chartIn(success(applySceneCommandBatch(moved, batch([update([])], 2)))).data).toEqual(
      [],
    );
    expect(chartIn(original).data).toHaveLength(2);
  });

  it.each(['text', 'rectangle', 'group'])(
    '不能给%s写图表数据，复合及多操作失败都不改变原文档',
    (type) => {
      const transform = chart().transform;
      const target: unknown =
        type === 'group'
          ? { id: 'target', type, visible: true, transform, children: [] }
          : {
              id: 'target',
              type,
              visible: true,
              transform,
              componentVersion: 1,
              ...(type === 'text' ? { text: '原文字' } : {}),
            };
      const input = {
        ...scene(),
        rootIds: ['chart-1', 'target'],
        nodes: [chart('chart-1', [{ category: '原分类', value: 1 }]), target],
      };
      const before = structuredClone(input);
      const failed = applySceneCommandBatch(
        input,
        batch([
          update([{ category: '不能提交', value: 2 }]),
          {
            type: 'node.update',
            nodeId: 'target',
            changes: {
              visible: false,
              transform: { x: 300 },
              ...(type === 'text' ? { text: '不能提交' } : {}),
              data: [],
            },
          },
        ]),
      );
      expect(failed).toEqual({ success: false, code: 'INVALID_OPERATION', operationIndex: 1 });
      expect(input).toEqual(before);
    },
  );

  it('图表不接受文字变更，数据合法也不能提交混合的非法操作', () => {
    const input = scene([chart('chart-1', [{ category: '原分类', value: 1 }])]);
    const before = structuredClone(input);
    expect(
      applySceneCommandBatch(
        input,
        batch([
          {
            type: 'node.update',
            nodeId: 'chart-1',
            changes: { data: [], text: '禁止混用', transform: { x: 0 } },
          },
        ]),
      ),
    ).toEqual({ success: false, code: 'INVALID_OPERATION', operationIndex: 0 });
    expect(input).toEqual(before);
  });

  it('失败保留历史和重做分支，旧修订数据不能覆盖当前文档', () => {
    const history = createSceneHistory(scene());
    success(history.execute(batch([update([{ category: '第一步', value: 1 }])])));
    success(history.undo(request(history)));
    const before = history.current();
    expect(history.execute(batch([update([{ category: '过期', value: 3 }])]))).toEqual({
      success: false,
      code: 'REVISION_CONFLICT',
    });
    expect(
      history.execute({
        ...request(history),
        operations: [update([{ category: '非法', value: Infinity }])],
      }),
    ).toEqual({ success: false, code: 'INVALID_COMMAND' });
    expect(history.current()).toEqual(before);
    expect(history.canRedo()).toBe(true);
    expect(chartIn(success(history.redo(request(history)))).data).toEqual([
      { category: '第一步', value: 1 },
    ]);
  });

  it('初始输入、添加/更新命令与current/execute/undo/redo返回值均深度隔离', () => {
    const initialData = [{ category: '初始', value: 1 }];
    const initial = scene([chart('chart-1', initialData)]);
    const history = createSceneHistory(initial);
    for (const datum of initialData) {
      datum.category = '外部改初始';
      datum.value = 99;
    }
    initialData.push({ category: '外部追加', value: 99 });
    const first = history.current();
    expect(chartIn(first).data).toEqual([{ category: '初始', value: 1 }]);
    Reflect.set(chartIn(first).data[0] ?? {}, 'value', 99);
    const addedData = [{ category: '新增', value: 2 }];
    const added = chart('chart-2', addedData);
    const result = success(
      history.execute(batch([{ type: 'node.add', node: added, parentId: null, index: 1 }])),
    );
    for (const datum of addedData) {
      datum.category = '外部改新增';
      datum.value = 99;
    }
    addedData.push({ category: '外部追加', value: 99 });
    Reflect.set(chartIn(result, 'chart-2').data[0] ?? {}, 'value', 99);
    const replacement = [{ category: '替换', value: -3 }];
    const updated = success(history.execute(batch([update(replacement)], 1)));
    for (const datum of replacement) {
      datum.category = '外部改替换';
      datum.value = 99;
    }
    replacement.push({ category: '外部追加', value: 99 });
    Reflect.set(chartIn(updated).data[0] ?? {}, 'value', 99);
    expect(chartIn(history.current()).data).toEqual([{ category: '替换', value: -3 }]);
    expect(chartIn(history.current(), 'chart-2').data).toEqual([{ category: '新增', value: 2 }]);
    const undone = success(history.undo(request(history)));
    expect(chartIn(undone).data).toEqual([{ category: '初始', value: 1 }]);
    Reflect.set(chartIn(undone).data[0] ?? {}, 'category', '外部改撤销');
    const redone = success(history.redo(request(history)));
    expect(chartIn(redone).data).toEqual([{ category: '替换', value: -3 }]);
    Reflect.set(chartIn(redone).data[0] ?? {}, 'category', '外部改重做');
    expect(chartIn(history.current()).data).toEqual([{ category: '替换', value: -3 }]);
  });

  it('冻结数据条目和数组可执行新增与更新，不会写回输入对象', () => {
    const data = Object.freeze([Object.freeze({ category: '冻结', value: -1 })]);
    const node = Object.freeze({
      ...chart('chart-1', data),
      transform: Object.freeze(chart().transform),
    });
    const history = createSceneHistory(scene([]));
    success(history.execute(batch([{ type: 'node.add', node, parentId: null, index: 0 }])));
    const replacement = Object.freeze([Object.freeze({ category: '冻结替换', value: 0 })]);
    success(history.execute(batch([update(replacement)], 1)));
    expect(data).toEqual([{ category: '冻结', value: -1 }]);
    expect(replacement).toEqual([{ category: '冻结替换', value: 0 }]);
    expect(chartIn(history.current()).data).toEqual(replacement);
  });

  it('图表快照超出历史字节预算时原子拒绝，不消耗修订号或创建不可撤销修改', () => {
    const input = scene();
    const history = createSceneHistory(input, { maxBytes: 1_000 });
    const data = Array.from({ length: SCENE_LIMITS.maxChartDataPoints }, () => ({
      category: '类'.repeat(SCENE_LIMITS.maxChartCategoryLength),
      value: 1,
    }));
    expect(history.execute(batch([update(data)]))).toEqual({
      success: false,
      code: 'HISTORY_CAPACITY',
    });
    expect(history.current()).toEqual(input);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it('删除包含图表的组合可整体恢复子树、数据和顺序', () => {
    const input = scene(
      [
        group('g', ['chart-1']),
        chart('chart-1', [{ category: '恢复', value: -5 }]),
        chart('outside'),
      ],
      ['g', 'outside'],
    );
    const history = createSceneHistory(input);
    const removed = success(history.execute(batch([{ type: 'node.remove', nodeId: 'g' }])));
    expect(removed.nodes.map((node) => node.id)).toEqual(['outside']);
    expect(success(history.undo(request(history)))).toEqual({ ...input, revision: 2 });
    expect(success(history.redo(request(history)))).toEqual({ ...removed, revision: 3 });
  });

  it('图表作为原子元素参与移动、组合和拆组，保留数据及世界几何', () => {
    const input = scene([
      chart('chart-1', [{ category: '分类', value: 0 }]),
      { ...chart('chart-2'), transform: { ...chart().transform, x: 900, rotation: 25 } },
    ]);
    const before = getNodeWorldCorners(input, 'chart-1');
    const groupedPlan = createGroupCommandBatch(input, ['chart-1', 'chart-2'], 'g');
    if (!groupedPlan.success) throw new Error('图表组合规划应成功。');
    const grouped = success(applySceneCommandBatch(input, groupedPlan.batch));
    expect(getNodeWorldCorners(grouped, 'chart-1')).toEqual(before);
    expect(chartIn(grouped).data).toEqual(chartIn(input).data);
    const rotated = success(
      applySceneCommandBatch(
        grouped,
        batch(
          [{ type: 'node.update', nodeId: 'g', changes: { transform: { rotation: 90 } } }],
          grouped.revision,
        ),
      ),
    );
    const movedPlan = createTranslateCommandBatch(rotated, ['chart-1'], { x: 20, y: -10 });
    if (!movedPlan.success) throw new Error('图表平移规划应成功。');
    const moved = success(applySceneCommandBatch(rotated, movedPlan.batch));
    const rotatedPoints = getNodeWorldCorners(rotated, 'chart-1');
    const movedPoints = getNodeWorldCorners(moved, 'chart-1');
    expect(
      movedPoints?.map((point, index) => ({
        x: point.x - (rotatedPoints?.[index]?.x ?? NaN),
        y: point.y - (rotatedPoints?.[index]?.y ?? NaN),
      })),
    ).toEqual(Array.from({ length: 4 }, () => ({ x: 20, y: -10 })));
    const ungroupedPlan = createUngroupCommandBatch(moved, 'g');
    if (!ungroupedPlan.success) throw new Error('图表拆组规划应成功。');
    const ungrouped = success(applySceneCommandBatch(moved, ungroupedPlan.batch));
    expect(getNodeWorldCorners(ungrouped, 'chart-1')).toEqual(movedPoints);
    expect(chartIn(ungrouped).data).toEqual(chartIn(input).data);
  });
});
