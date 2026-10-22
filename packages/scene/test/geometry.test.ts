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
  validateSceneDocument,
} from '../src/index.js';
import type {
  GroupNode,
  RectangleNode,
  SceneCommandPlanResult,
  SceneDocument,
  SceneNode,
  ScenePoint,
  TextNode,
} from '../src/index.js';
import fixture from './fixtures/scene-v1.json' with { type: 'json' };

type Transform = SceneNode['transform'];

function transform(changes: Partial<Transform> = {}): Transform {
  return { x: 0, y: 0, width: 100, height: 60, rotation: 0, ...changes };
}

function rectangle(id: string, changes: Partial<Transform> = {}, visible = true): RectangleNode {
  return { id, type: 'rectangle', componentVersion: 1, transform: transform(changes), visible };
}

function text(id: string, changes: Partial<Transform> = {}): TextNode {
  return {
    id,
    type: 'text',
    componentVersion: 1,
    transform: transform(changes),
    visible: true,
    text: '<文字>',
  };
}

function group(
  id: string,
  children: readonly string[] = [],
  changes: Partial<Transform> = {},
  visible = true,
): GroupNode {
  return { id, type: 'group', children, transform: transform(changes), visible };
}

function scene(nodes: readonly SceneNode[], rootIds = nodes.map((node) => node.id)): SceneDocument {
  return {
    ...createEmptyScene({ id: 'scene-geometry', width: 1920, height: 1080 }),
    nodes,
    rootIds,
  };
}

function apply(document: SceneDocument, plan: SceneCommandPlanResult): SceneDocument {
  expect(plan.success).toBe(true);
  if (!plan.success) throw new Error('操作应规划成功。');
  expect(plan.batch.sceneId).toBe(document.id);
  expect(plan.batch.baseRevision).toBe(document.revision);
  const result = applySceneCommandBatch(document, plan.batch);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('规划应通过统一命令内核。');
  return result.document;
}

function points(document: SceneDocument, id: string): readonly ScenePoint[] {
  const result = getNodeWorldCorners(document, id);
  expect(result).toHaveLength(4);
  if (!result) throw new Error('节点应具有世界四角。');
  return result;
}

function expectPoints(actual: readonly ScenePoint[], expected: readonly ScenePoint[]) {
  expect(actual).toHaveLength(expected.length);
  for (const [index, point] of actual.entries()) {
    expect(point.x).toBeCloseTo(expected[index]?.x ?? NaN, 7);
    expect(point.y).toBeCloseTo(expected[index]?.y ?? NaN, 7);
  }
}

function expectPreserved(before: SceneDocument, after: SceneDocument, ids: readonly string[]) {
  for (const id of ids) expectPoints(points(after, id), points(before, id));
}

function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((child: unknown) => freeze(child));
    Object.freeze(value);
  }
  return value;
}

describe('二维父局部坐标与世界四角', () => {
  it('无旋转时宽高及负坐标保持逻辑像素含义', () => {
    const input = scene([rectangle('a', { x: -25, y: 17, width: 80, height: 30 })]);
    expect(points(input, 'a')).toEqual([
      { x: -25, y: 17 },
      { x: 55, y: 17 },
      { x: 55, y: 47 },
      { x: -25, y: 47 },
    ]);
  });

  it('正角度绕自身中心顺时针旋转，不把位置当旋转中心', () => {
    const input = scene([rectangle('a', { x: 10, y: 20, rotation: 90 })]);
    expect(points(input, 'a')).toEqual([
      { x: 90, y: 0 },
      { x: 90, y: 100 },
      { x: 30, y: 100 },
      { x: 30, y: 0 },
    ]);
  });

  it('父子旋转累积，组合宽高不缩放子元素', () => {
    const input = scene(
      [
        group('g', ['a'], { x: 100, y: 50, width: 200, height: 100, rotation: 90 }),
        rectangle('a', { x: 10, y: 20, width: 20, height: 10, rotation: -90 }),
      ],
      ['g'],
    );
    expect(points(input, 'a')).toEqual([
      { x: 215, y: 15 },
      { x: 235, y: 15 },
      { x: 235, y: 25 },
      { x: 215, y: 25 },
    ]);
    const noRotation = scene(
      [group('g', ['a'], { x: 100, y: 50, width: 1000, height: 1000 }), rectangle('a')],
      ['g'],
    );
    expect(points(noRotation, 'a')[2]).toEqual({ x: 200, y: 110 });
  });

  it('隐藏节点仍提供可供图层选择使用的几何，返回四角相互独立', () => {
    const input = scene([rectangle('a', {}, false)]);
    const first = points(input, 'a');
    const second = points(input, 'a');
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);
    expect(first[0]).not.toBe(input.nodes[0]?.transform);
  });

  it('未知节点和非法文档返回 undefined，不尝试修复输入', () => {
    const input = scene([rectangle('a')]);
    expect(getNodeWorldCorners(input, 'missing')).toBeUndefined();
    expect(getNodeWorldCorners({ ...input, revision: NaN }, 'a')).toBeUndefined();
  });

  it('第一版固定样例可直接计算全部节点几何', () => {
    const parsed = validateSceneDocument(fixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('第一版样例应有效。');
    for (const node of parsed.data.nodes) {
      expect(
        points(parsed.data, node.id).every(
          (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
        ),
      ).toBe(true);
    }
  });
});

describe('世界位移转换与选择保护', () => {
  it('根节点接受世界位移，文字、尺寸、旋转和顺序不变', () => {
    const input = scene([text('a', { x: -20, y: 30, rotation: 27 }), rectangle('b')]);
    const result = apply(input, createTranslateCommandBatch(input, ['a'], { x: 45, y: -70 }));
    expect(result.nodes[0]).toEqual({
      ...input.nodes[0],
      transform: { ...input.nodes[0]?.transform, x: 25, y: -40 },
    });
    expect(result.nodes[1]).toEqual(input.nodes[1]);
    expect(result.rootIds).toEqual(input.rootIds);
    expectPoints(
      points(result, 'a'),
      points(input, 'a').map((point) => ({ x: point.x + 45, y: point.y - 70 })),
    );
  });

  it('旋转父节点内的拖动使用逆父世界旋转，场景水平拖动仍保持水平', () => {
    const input = scene(
      [
        group('outer', ['inner'], { x: -20, y: 80, rotation: 30 }),
        group('inner', ['a'], { x: 17, y: -20, rotation: 60 }),
        text('a', { x: -10, y: 50, rotation: -17 }),
      ],
      ['outer'],
    );
    const result = apply(input, createTranslateCommandBatch(input, ['a'], { x: 20, y: 0 }));
    expect(result.nodes[2]?.transform.x).toBeCloseTo(-10);
    expect(result.nodes[2]?.transform.y).toBeCloseTo(30);
    expectPoints(
      points(result, 'a'),
      points(input, 'a').map((point) => ({ x: point.x + 20, y: point.y })),
    );
    expectPreserved(input, result, ['outer', 'inner']);
  });

  it('去除重复 ID 和被选祖先覆盖的后代，整个子树只平移一次', () => {
    const input = scene(
      [
        group('g', ['inner'], { x: 20, rotation: 33 }),
        group('inner', ['a'], { y: -40 }),
        text('a'),
      ],
      ['g'],
    );
    const plan = createTranslateCommandBatch(input, ['a', 'g', 'inner', 'g'], { x: -10, y: 30 });
    const result = apply(input, plan);
    if (!plan.success) throw new Error('规划应有效。');
    expect(plan.batch.operations).toHaveLength(1);
    expect(plan.batch.operations[0]).toHaveProperty('nodeId', 'g');
    expect(result.nodes.slice(1)).toEqual(input.nodes.slice(1));
    for (const node of input.nodes) {
      expectPoints(
        points(result, node.id),
        points(input, node.id).map((point) => ({ x: point.x - 10, y: point.y + 30 })),
      );
    }
  });

  it('不同父节点的多个目标按相同世界位移一起移动', () => {
    const input = scene(
      [group('g', ['a'], { rotation: -90 }), text('a'), rectangle('b', { x: 300 })],
      ['g', 'b'],
    );
    const result = apply(input, createTranslateCommandBatch(input, ['a', 'b'], { x: 40, y: -50 }));
    for (const id of ['a', 'b']) {
      expectPoints(
        points(result, id),
        points(input, id).map((point) => ({ x: point.x + 40, y: point.y - 50 })),
      );
    }
    expect(result.nodes[0]).toEqual(input.nodes[0]);
  });

  it.each([{ selection: [] }, { selection: ['missing'] }, { selection: ['a', 'missing'] }])(
    '拒绝空选择或混入未知节点 $selection',
    ({ selection }) => {
      expect(
        createTranslateCommandBatch(scene([rectangle('a')]), selection, { x: 1, y: 1 }),
      ).toEqual({ success: false, code: 'INVALID_SELECTION' });
    },
  );

  it.each([NaN, Infinity, -Infinity])('拒绝非有限位移 %s', (value) => {
    const input = scene([rectangle('a')]);
    for (const delta of [
      { x: value, y: 0 },
      { x: 0, y: value },
    ]) {
      expect(createTranslateCommandBatch(input, ['a'], delta)).toEqual({
        success: false,
        code: 'INVALID_GEOMETRY',
      });
    }
  });

  it('100 个有效目标在一批中规划，超量拒绝；祖先去重先于操作数量检查', () => {
    const nodes = Array.from({ length: 101 }, (_, index) => rectangle(`r-${index}`));
    const input = scene(nodes);
    expect(
      apply(
        input,
        createTranslateCommandBatch(
          input,
          nodes.slice(0, 100).map((node) => node.id),
          { x: 1, y: 0 },
        ),
      ).revision,
    ).toBe(1);
    expect(
      createTranslateCommandBatch(
        input,
        nodes.map((node) => node.id),
        { x: 1, y: 0 },
      ),
    ).toEqual({ success: false, code: 'COMMAND_LIMIT' });
    const nested = scene(
      [
        group(
          'g',
          nodes.map((node) => node.id),
        ),
        ...nodes,
      ],
      ['g'],
    );
    const plan = createTranslateCommandBatch(nested, ['g', ...nodes.map((node) => node.id)], {
      x: 1,
      y: 0,
    });
    apply(nested, plan);
    if (!plan.success) throw new Error('规划应有效。');
    expect(plan.batch.operations).toHaveLength(1);
  });

  it('超出位置上限原子拒绝，不裁剪位移也不污染输入', () => {
    const input = freeze(scene([rectangle('a'), rectangle('b', { x: SCENE_LIMITS.maxPosition })]));
    const before = JSON.stringify(input);
    expect(createTranslateCommandBatch(input, ['a', 'b'], { x: 1, y: 0 })).toEqual({
      success: false,
      code: 'INVALID_GEOMETRY',
    });
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('组合规划与最高选中层', () => {
  it.each([
    { selection: ['a', 'c'], expected: ['b', 'g', 'd'] },
    { selection: ['d', 'b'], expected: ['a', 'c', 'g'] },
    { selection: ['b', 'a'], expected: ['g', 'c', 'd'] },
    { selection: ['c', 'b'], expected: ['a', 'g', 'd'] },
    { selection: ['d', 'b', 'a', 'c'], expected: ['g'] },
  ])('组合 $selection 后保留未选节点顺序并占最高选中层', ({ selection, expected }) => {
    const input = scene(
      ['a', 'b', 'c', 'd'].map((id, index) =>
        rectangle(id, { x: index * 70, rotation: index * 11 }),
      ),
    );
    const result = apply(input, createGroupCommandBatch(input, selection, 'g'));
    expect(result.rootIds).toEqual(expected);
    expect(result.nodes.find((node) => node.id === 'g')).toHaveProperty(
      'children',
      input.rootIds.filter((id) => selection.includes(id)),
    );
    expectPreserved(input, result, input.rootIds);
  });

  it('嵌套旋转父级内组合文字和带旋转子树，保持所有后代的世界四角', () => {
    const input = scene(
      [
        group('outer', ['a', 'unselected', 'inner'], { x: -120, y: 45, rotation: 37 }),
        text('a', { x: -30, y: -40, rotation: -23 }),
        rectangle('unselected', { x: 200, y: 10 }),
        group('inner', ['leaf'], { x: 90, y: -55, width: 150, height: 80, rotation: 19 }),
        rectangle('leaf', { x: -25, y: 200, width: 40, height: 25, rotation: -111 }),
      ],
      ['outer'],
    );
    const result = apply(input, createGroupCommandBatch(input, ['inner', 'a', 'a'], 'new-group'));
    expect(result.nodes[0]).toHaveProperty('children', ['unselected', 'new-group']);
    expect(result.nodes.find((node) => node.id === 'new-group')).toMatchObject({
      children: ['a', 'inner'],
      transform: { rotation: 0 },
    });
    expectPreserved(
      input,
      result,
      input.nodes.map((node) => node.id),
    );
    expect(result.nodes.find((node) => node.id === 'leaf')).toEqual(
      input.nodes.find((node) => node.id === 'leaf'),
    );
  });

  it('组合保留各节点自身隐藏标记，新组合不强制显示原先隐藏元素', () => {
    const input = scene([rectangle('a', {}, false), rectangle('b', { x: 100 })]);
    const result = apply(input, createGroupCommandBatch(input, ['a', 'b'], 'g'));
    expect(result.nodes.find((node) => node.id === 'a')).toHaveProperty('visible', false);
    expect(result.nodes.find((node) => node.id === 'b')).toHaveProperty('visible', true);
    expect(result.nodes.find((node) => node.id === 'g')).toHaveProperty('visible', true);
  });

  it('拒绝单个唯一节点、不同父节点、祖孙选择和已存在组合 ID', () => {
    const input = scene([group('g', ['a']), rectangle('a'), rectangle('b')], ['g', 'b']);
    for (const selection of [[], ['b'], ['b', 'b'], ['a', 'b'], ['g', 'a'], ['a', 'missing']]) {
      expect(createGroupCommandBatch(input, selection, 'new')).toEqual({
        success: false,
        code: 'INVALID_SELECTION',
      });
    }
    expect(
      createGroupCommandBatch(scene([rectangle('a'), rectangle('b')]), ['a', 'b'], 'a'),
    ).toEqual({ success: false, code: 'INVALID_SELECTION' });
  });

  it('单批支持 49 个节点，50 个节点明确拒绝且不分批', () => {
    const nodes = Array.from({ length: 50 }, (_, index) => rectangle(`r-${index}`));
    const input = scene(nodes);
    const plan = createGroupCommandBatch(
      input,
      nodes.slice(0, 49).map((node) => node.id),
      'g',
    );
    apply(input, plan);
    if (!plan.success) throw new Error('规划应有效。');
    expect(plan.batch.operations).toHaveLength(99);
    expect(
      createGroupCommandBatch(
        input,
        nodes.map((node) => node.id),
        'g',
      ),
    ).toEqual({ success: false, code: 'COMMAND_LIMIT' });
  });

  it('新组合不满足尺寸、位置、ID 或节点容量约束时复用内核拒绝', () => {
    const input = scene([rectangle('a'), rectangle('b', { x: SCENE_LIMITS.maxDimension + 1 })]);
    expect(createGroupCommandBatch(input, ['a', 'b'], 'g')).toEqual({
      success: false,
      code: 'INVALID_GEOMETRY',
    });
    expect(
      createGroupCommandBatch(scene([rectangle('a'), rectangle('b')]), ['a', 'b'], ''),
    ).toEqual({ success: false, code: 'INVALID_GEOMETRY' });
    const edge = scene([
      rectangle('a', { x: -SCENE_LIMITS.maxPosition, rotation: 45 }),
      rectangle('b', { x: -SCENE_LIMITS.maxPosition }),
    ]);
    expect(createGroupCommandBatch(edge, ['a', 'b'], 'g')).toEqual({
      success: false,
      code: 'INVALID_GEOMETRY',
    });
    const full = scene(
      Array.from({ length: SCENE_LIMITS.maxNodes }, (_, index) => rectangle(`r-${index}`)),
    );
    expect(createGroupCommandBatch(full, ['r-0', 'r-1'], 'g')).toEqual({
      success: false,
      code: 'INVALID_GEOMETRY',
    });
  });

  it('新增层级超过上限时规划失败，原有文档仍合法', () => {
    const parents = Array.from({ length: SCENE_LIMITS.maxDepth - 1 }, (_, index) =>
      group(`g-${index}`, index + 1 < SCENE_LIMITS.maxDepth - 1 ? [`g-${index + 1}`] : ['a', 'b']),
    );
    const input = scene([...parents, rectangle('a'), rectangle('b')], ['g-0']);
    expect(validateSceneDocument(input).success).toBe(true);
    expect(createGroupCommandBatch(input, ['a', 'b'], 'new')).toEqual({
      success: false,
      code: 'INVALID_GEOMETRY',
    });
    expect(validateSceneDocument(input).success).toBe(true);
  });
});

describe('拆组规划与画面保持', () => {
  it('旋转组内的旋转文字和嵌套组合拆出后保持四角与绘制顺序', () => {
    const input = scene(
      [
        group('outer', ['before', 'g', 'after'], { x: -70, y: 55, rotation: 28 }),
        rectangle('before'),
        group('g', ['a', 'inner'], { x: 40, y: -30, width: 200, height: 90, rotation: 73 }),
        text('a', { x: -50, y: 19, width: 140, height: 35, rotation: -21 }),
        group('inner', ['leaf'], { x: 80, y: -40, rotation: -35 }),
        rectangle('leaf', { x: 400, y: -100, rotation: 57 }),
        rectangle('after', { x: 180 }),
      ],
      ['outer'],
    );
    const result = apply(input, createUngroupCommandBatch(input, 'g'));
    expect(result.nodes[0]).toHaveProperty('children', ['before', 'a', 'inner', 'after']);
    expect(result.nodes.some((node) => node.id === 'g')).toBe(false);
    expectPreserved(input, result, ['outer', 'before', 'a', 'inner', 'leaf', 'after']);
    expect(result.nodes.find((node) => node.id === 'a')).toMatchObject({
      text: '<文字>',
      transform: { width: 140, height: 35, rotation: 52 },
    });
    expect(result.nodes.find((node) => node.id === 'leaf')).toEqual(
      input.nodes.find((node) => node.id === 'leaf'),
    );
  });

  it('隐藏组合拆开后直接子节点保持隐藏，后代自身配置不受修改', () => {
    const input = scene(
      [
        group('g', ['a', 'inner', 'hidden'], { rotation: 45 }, false),
        text('a'),
        group('inner', ['leaf']),
        rectangle('leaf'),
        rectangle('hidden', {}, false),
      ],
      ['g'],
    );
    const result = apply(input, createUngroupCommandBatch(input, 'g'));
    expect(result.rootIds).toEqual(['a', 'inner', 'hidden']);
    for (const id of result.rootIds)
      expect(result.nodes.find((node) => node.id === id)).toHaveProperty('visible', false);
    expect(result.nodes.find((node) => node.id === 'leaf')).toHaveProperty('visible', true);
    expectPreserved(input, result, ['a', 'inner', 'leaf', 'hidden']);
  });

  it('空组合直接移除，单元素组合也可拆开并保留相邻层级', () => {
    const empty = scene([rectangle('before'), group('g'), rectangle('after')]);
    const removed = apply(empty, createUngroupCommandBatch(empty, 'g'));
    expect(removed.rootIds).toEqual(['before', 'after']);
    expect(removed.nodes).toEqual([rectangle('before'), rectangle('after')]);
    const single = scene(
      [rectangle('before'), group('g', ['a'], { x: 20 }), text('a'), rectangle('after')],
      ['before', 'g', 'after'],
    );
    const result = apply(single, createUngroupCommandBatch(single, 'g'));
    expect(result.rootIds).toEqual(['before', 'a', 'after']);
    expectPreserved(single, result, ['before', 'a', 'after']);
  });

  it('超大累计角度规范化为等价旋转，不因加法超过契约上限失败', () => {
    const input = scene(
      [group('g', ['a'], { rotation: 360_000 }), rectangle('a', { rotation: 360_000 })],
      ['g'],
    );
    const result = apply(input, createUngroupCommandBatch(input, 'g'));
    expect(result.nodes[0]?.transform.rotation).toBe(0);
    expectPreserved(input, result, ['a']);
  });

  it('先移父再更新可拆出靠近原局部边界的节点，不依赖无效中间数值', () => {
    const input = scene(
      [
        group('g', ['a'], { x: -SCENE_LIMITS.maxPosition }),
        rectangle('a', { x: SCENE_LIMITS.maxPosition }),
      ],
      ['g'],
    );
    const result = apply(input, createUngroupCommandBatch(input, 'g'));
    expect(result.nodes[0]?.transform.x).toBe(0);
    expectPreserved(input, result, ['a']);
  });

  it('拆出后最终位置超限则整批拒绝，原组合和子树完整保留', () => {
    const input = freeze(
      scene(
        [
          group('g', ['a', 'b'], { x: SCENE_LIMITS.maxPosition }),
          rectangle('a', { x: -100 }),
          rectangle('b', { x: 100 }),
        ],
        ['g'],
      ),
    );
    const before = JSON.stringify(input);
    expect(createUngroupCommandBatch(input, 'g')).toEqual({
      success: false,
      code: 'INVALID_GEOMETRY',
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('49 子节点可整批拆组，50 子节点明确拒绝', () => {
    const children = Array.from({ length: 50 }, (_, index) => rectangle(`r-${index}`));
    const input = scene(
      [
        group(
          'g',
          children.slice(0, 49).map((node) => node.id),
        ),
        ...children.slice(0, 49),
      ],
      ['g'],
    );
    expect(apply(input, createUngroupCommandBatch(input, 'g')).rootIds).toEqual(
      children.slice(0, 49).map((node) => node.id),
    );
    const oversized = scene(
      [
        group(
          'g',
          children.map((node) => node.id),
        ),
        ...children,
      ],
      ['g'],
    );
    expect(createUngroupCommandBatch(oversized, 'g')).toEqual({
      success: false,
      code: 'COMMAND_LIMIT',
    });
  });

  it('只能拆组合，不将原子元素删除伪装为拆组', () => {
    const input = scene([rectangle('a')]);
    for (const id of ['a', 'missing'])
      expect(createUngroupCommandBatch(input, id)).toEqual({
        success: false,
        code: 'INVALID_SELECTION',
      });
  });
});

describe('操作规划、修订与历史边界', () => {
  it('规划不提交、可接受冻结输入，结果不持有输入节点的可变引用', () => {
    const input = freeze(scene([text('a', { x: -30 }), rectangle('b', { x: 80 })]));
    const before = JSON.stringify(input);
    const plan = createGroupCommandBatch(input, ['a', 'b'], 'g');
    const result = apply(input, plan);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.revision).toBe(1);
    expect(input.revision).toBe(0);
    if (!plan.success) throw new Error('规划应有效。');
    for (const operation of plan.batch.operations) {
      if (operation.type === 'node.add') {
        expect(input.nodes.every((node) => node.transform !== operation.node.transform)).toBe(true);
      }
    }
  });

  it('组合、拖动和拆组各是一步撤销，撤销恢复内容、隐藏和精确层级顺序', () => {
    const input = scene([
      text('a', { x: -40 }),
      rectangle('b', { x: 100 }, false),
      rectangle('c', { x: 200 }),
    ]);
    const history = createSceneHistory(input);
    const execute = (plan: SceneCommandPlanResult) => {
      expect(plan.success).toBe(true);
      if (!plan.success) throw new Error('规划应有效。');
      const result = history.execute(plan.batch);
      expect(result.success).toBe(true);
    };
    execute(createGroupCommandBatch(history.current(), ['c', 'a'], 'g'));
    expect(history.current().revision).toBe(1);
    execute(createTranslateCommandBatch(history.current(), ['g'], { x: 10, y: -20 }));
    const grouped = history.current();
    execute(createUngroupCommandBatch(grouped, 'g'));
    expect(history.current().revision).toBe(3);
    expect(history.undo({ sceneId: input.id, baseRevision: 3 }).success).toBe(true);
    expect(history.current()).toEqual({ ...grouped, revision: 4 });
    expect(history.undo({ sceneId: input.id, baseRevision: 4 }).success).toBe(true);
    expect(history.undo({ sceneId: input.id, baseRevision: 5 }).success).toBe(true);
    expect(history.current()).toEqual({ ...input, revision: 6 });
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  it('开始时修订写进批次，后来场景变化会拒绝陈旧拖动', () => {
    const input = scene([rectangle('a')]);
    const plan = createTranslateCommandBatch(input, ['a'], { x: 30, y: 40 });
    if (!plan.success) throw new Error('规划应有效。');
    const history = createSceneHistory(input);
    expect(
      history.execute({
        sceneId: input.id,
        baseRevision: 0,
        operations: [{ type: 'node.update', nodeId: 'a', changes: { visible: false } }],
      }).success,
    ).toBe(true);
    expect(history.execute(plan.batch)).toEqual({ success: false, code: 'REVISION_CONFLICT' });
    expect(history.current().nodes[0]?.transform).toEqual(input.nodes[0]?.transform);
  });

  it('所有规划入口拒绝非法原文档', () => {
    const input = scene([rectangle('a'), rectangle('b'), group('g')]);
    const invalid = { ...input, revision: NaN };
    expect(createTranslateCommandBatch(invalid, ['a'], { x: 1, y: 0 })).toEqual({
      success: false,
      code: 'INVALID_DOCUMENT',
    });
    expect(createGroupCommandBatch(invalid, ['a', 'b'], 'new')).toEqual({
      success: false,
      code: 'INVALID_DOCUMENT',
    });
    expect(createUngroupCommandBatch(invalid, 'g')).toEqual({
      success: false,
      code: 'INVALID_DOCUMENT',
    });
  });

  it('修订号耗尽时保留内核明确错误码，不泄漏文档或节点正文', () => {
    const input = scene([text('synthetic-secret-text'), rectangle('b'), group('g')]);
    const exhausted = { ...input, revision: Number.MAX_SAFE_INTEGER };
    const results = [
      createTranslateCommandBatch(exhausted, ['synthetic-secret-text'], { x: 1, y: 0 }),
      createGroupCommandBatch(exhausted, ['synthetic-secret-text', 'b'], 'new'),
      createUngroupCommandBatch(exhausted, 'g'),
    ];
    for (const result of results) {
      expect(result).toEqual({ success: false, code: 'REVISION_EXHAUSTED' });
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(JSON.stringify(result)).not.toContain('<文字>');
    }
  });
});
