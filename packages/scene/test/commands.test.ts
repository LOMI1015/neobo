import { describe, expect, it } from 'vitest';
import {
  applySceneCommandBatch,
  createEmptyScene,
  SCENE_COMMAND_LIMITS,
  SCENE_LIMITS,
  validateSceneCommandBatch,
  validateSceneDocument,
} from '../src/index.js';
import type { SceneCommandResult, SceneDocument, SceneNode, SceneOperation } from '../src/index.js';
import fixture from './fixtures/scene-v1.json' with { type: 'json' };

function transform() {
  return { x: 10, y: 20, width: 200, height: 100, rotation: 15 };
}

function textNode(id = 'text-1') {
  return {
    id,
    type: 'text' as const,
    componentVersion: 1 as const,
    text: '原始文字',
    transform: transform(),
    visible: true,
  };
}

function rectangleNode(id = 'rectangle-1') {
  return {
    id,
    type: 'rectangle' as const,
    componentVersion: 1 as const,
    transform: transform(),
    visible: true,
  };
}

function groupNode(id = 'group-1', children: string[] = []) {
  return { id, type: 'group' as const, children, transform: transform(), visible: true };
}

function scene(nodes: readonly SceneNode[] = [textNode()], rootIds = nodes.map((node) => node.id)) {
  return { ...createEmptyScene({ id: 'scene-1', width: 1920, height: 1080 }), nodes, rootIds };
}

function batch<Operations extends readonly unknown[]>(
  operations: Operations,
  sceneId = 'scene-1',
  baseRevision = 0,
) {
  return { sceneId, baseRevision, operations };
}

function add(node = textNode('text-2'), parentId: string | null = null, index = 1) {
  return { type: 'node.add', node, parentId, index };
}

function update(nodeId = 'text-1', changes: unknown = { text: '更新文字' }) {
  return { type: 'node.update', nodeId, changes };
}

function move(nodeId: string, parentId: string | null, index: number) {
  return { type: 'node.move', nodeId, parentId, index };
}

function resultDocument(result: SceneCommandResult): SceneDocument {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('命令应成功执行。');
  expect(validateSceneDocument(result.document).success).toBe(true);
  return result.document;
}

function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((child: unknown) => freeze(child));
    Object.freeze(value);
  }
  return value;
}

function chain(length: number) {
  return scene(
    Array.from({ length }, (_, index) =>
      groupNode(`g-${index}`, index + 1 < length ? [`g-${index + 1}`] : []),
    ),
    ['g-0'],
  );
}

describe('统一场景原子命令', () => {
  it('同一批顺序执行添加、属性修改、移父和删除，仅增加一次修订号', () => {
    const input = scene();
    const operations: SceneOperation[] = [
      { type: 'node.add', node: groupNode(), parentId: null, index: 0 },
      { type: 'node.add', node: rectangleNode(), parentId: 'group-1', index: 0 },
      {
        type: 'node.update',
        nodeId: 'text-1',
        changes: { text: '新文字', visible: false, transform: { x: -25, rotation: 90 } },
      },
      { type: 'node.move', nodeId: 'text-1', parentId: 'group-1', index: 1 },
      { type: 'node.remove', nodeId: 'rectangle-1' },
    ];
    const result = resultDocument(applySceneCommandBatch(input, batch(operations)));
    expect(result.revision).toBe(1);
    expect(result.rootIds).toEqual(['group-1']);
    expect(result.nodes).toEqual([
      {
        ...textNode(),
        text: '新文字',
        visible: false,
        transform: { ...transform(), x: -25, rotation: 90 },
      },
      groupNode('group-1', ['text-1']),
    ]);
    expect(input).toEqual(scene());
  });

  it('新节点可在同批中作为后续父节点和更新目标', () => {
    const result = resultDocument(
      applySceneCommandBatch(
        scene([]),
        batch([
          { type: 'node.add', node: groupNode(), parentId: null, index: 0 },
          add(textNode(), 'group-1', 0),
          update('text-1', { text: '', transform: { width: 0.5, height: 0.25 } }),
        ]),
      ),
    );
    expect(result.nodes[1]).toMatchObject({
      text: '',
      transform: { width: 0.5, height: 0.25, x: 10, y: 20, rotation: 15 },
    });
  });

  it('接受已保存第一版样例，更新后保持未编辑的层级、画布和节点顺序', () => {
    const input = structuredClone(fixture);
    const result = resultDocument(
      applySceneCommandBatch(input, batch([update()], fixture.id, fixture.revision)),
    );
    expect(result).toEqual({
      ...fixture,
      revision: fixture.revision + 1,
      nodes: fixture.nodes.map((node) =>
        node.type === 'text' ? { ...node, text: '更新文字' } : node,
      ),
    });
    expect(input).toEqual(fixture);
  });

  it('冻结文档及命令可执行，返回值不与任一输入共享可变对象', () => {
    const input = freeze(scene());
    const command = freeze(batch([add()]));
    const before = JSON.stringify({ input, command });
    const result = resultDocument(applySceneCommandBatch(input, command));
    expect(JSON.stringify({ input, command })).toBe(before);
    expect(result).not.toBe(input);
    expect(result.canvas).not.toBe(input.canvas);
    expect(result.rootIds).not.toBe(input.rootIds);
    expect(result.nodes[0]).not.toBe(input.nodes[0]);
    expect(result.nodes[0]?.transform).not.toBe(input.nodes[0]?.transform);
    expect(result.nodes[1]).not.toBe(command.operations[0]?.node);
    expect(result.nodes[1]?.transform).not.toBe(command.operations[0]?.node.transform);
  });

  it('后续修改文档和命令输入不会改变已提交文档', () => {
    const inputNode = textNode();
    const input = scene([inputNode]);
    const added = textNode('text-2');
    const operation = add(added);
    const command = batch([operation]);
    const result = resultDocument(applySceneCommandBatch(input, command));
    inputNode.transform.x = 999;
    inputNode.text = '输入已变更';
    input.rootIds.length = 0;
    added.transform.y = 888;
    added.text = '命令已变更';
    command.operations.length = 0;
    expect(result.nodes).toEqual([textNode(), textNode('text-2')]);
    expect(result.rootIds).toEqual(['text-1', 'text-2']);
  });

  it('批次后半失败时不提交前半修改，返回固定错误与实际操作索引', () => {
    const input = freeze(scene());
    const command = freeze(batch([update(), add(), move('text-1', 'missing', 0)]));
    const before = JSON.stringify({ input, command });
    expect(applySceneCommandBatch(input, command)).toEqual({
      success: false,
      code: 'INVALID_PARENT',
      operationIndex: 2,
    });
    expect(JSON.stringify({ input, command })).toBe(before);
  });

  it('旧修订和其他场景的结果均拒绝覆盖，修订号耗尽时不执行操作', () => {
    const command = batch([update()]);
    expect(applySceneCommandBatch({ ...scene(), revision: 1 }, command)).toEqual({
      success: false,
      code: 'REVISION_CONFLICT',
    });
    expect(applySceneCommandBatch(scene(), { ...command, sceneId: 'other' })).toEqual({
      success: false,
      code: 'SCENE_MISMATCH',
    });
    expect(
      applySceneCommandBatch(
        { ...scene(), revision: Number.MAX_SAFE_INTEGER },
        { ...command, baseRevision: Number.MAX_SAFE_INTEGER },
      ),
    ).toEqual({ success: false, code: 'REVISION_EXHAUSTED' });
    expect(
      resultDocument(
        applySceneCommandBatch(
          { ...scene(), revision: Number.MAX_SAFE_INTEGER - 1 },
          { ...command, baseRevision: Number.MAX_SAFE_INTEGER - 1 },
        ),
      ).revision,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('相同批次重放时因基础修订号过期而失败', () => {
    const command = batch([add()]);
    const first = resultDocument(applySceneCommandBatch(scene(), command));
    expect(applySceneCommandBatch(first, command)).toEqual({
      success: false,
      code: 'REVISION_CONFLICT',
    });
  });

  it('非法原文档直接失败，不把第三方错误、原字段或正文放入返回值', () => {
    expect(
      applySceneCommandBatch({ ...scene(), privateSecret: 'synthetic-secret' }, batch([update()])),
    ).toEqual({ success: false, code: 'INVALID_DOCUMENT' });
    expect(applySceneCommandBatch(null, batch([update()]))).toEqual({
      success: false,
      code: 'INVALID_DOCUMENT',
    });
    const result = applySceneCommandBatch(
      scene(),
      batch([update('secret-node', { text: 'synthetic-secret' })]),
    );
    expect(result).toEqual({ success: false, code: 'NODE_NOT_FOUND', operationIndex: 0 });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

describe('命令结构与资源边界', () => {
  it('校验入口返回独立命令副本并保留指定的操作顺序', () => {
    const input = batch([add(), update('text-2')]);
    const result = validateSceneCommandBatch(input);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('命令应通过校验。');
    expect(result.data).toEqual(input);
    expect(result.data).not.toBe(input);
    expect(result.data.operations).not.toBe(input.operations);
    expect(result.data.operations[0]).not.toBe(input.operations[0]);
  });

  it.each([
    { name: '空值', input: null },
    { name: '数组', input: [] },
    { name: '缺少场景', input: { baseRevision: 0, operations: [update()] } },
    { name: '空批次', input: batch([]) },
    { name: '未知批次字段', input: { ...batch([update()]), secret: 'synthetic-secret' } },
    { name: '空场景标识', input: batch([update()], '') },
    { name: '字符串修订号', input: { ...batch([update()]), baseRevision: '0' } },
    { name: '负修订号', input: batch([update()], 'scene-1', -1) },
    { name: '非安全修订号', input: batch([update()], 'scene-1', Number.MAX_SAFE_INTEGER + 1) },
    { name: '未知操作', input: batch([{ type: 'scene.replace', document: scene() }]) },
    { name: '缺少操作判别字段', input: batch([{ nodeId: 'text-1', changes: { text: '新文字' } }]) },
    { name: '未知操作字段', input: batch([{ ...update(), token: 'synthetic-secret' }]) },
    {
      name: '缺少明确目标父节点',
      input: batch([{ type: 'node.move', nodeId: 'text-1', index: 0 }]),
    },
    { name: '空修改', input: batch([update('text-1', {})]) },
    { name: '空变换', input: batch([update('text-1', { transform: {} })]) },
    { name: 'undefined 修改字段', input: batch([update('text-1', { text: undefined })]) },
    { name: '混入 undefined', input: batch([update('text-1', { text: '', visible: undefined })]) },
    {
      name: 'undefined 变换字段',
      input: batch([update('text-1', { transform: { x: undefined } })]),
    },
    { name: '替换 ID', input: batch([update('text-1', { id: 'other' })]) },
    { name: '替换节点类型', input: batch([update('text-1', { type: 'rectangle' })]) },
    { name: '替换组件版本', input: batch([update('text-1', { componentVersion: 2 })]) },
    { name: '直接覆盖层级', input: batch([update('text-1', { children: [] })]) },
    { name: '字符串可见性', input: batch([update('text-1', { visible: 'true' })]) },
    { name: '未知变换字段', input: batch([update('text-1', { transform: { opacity: 1 } })]) },
    {
      name: '无效新增节点',
      input: batch([add({ ...textNode('text-2'), text: 'x'.repeat(10_001) })]),
    },
  ])('严格拒绝 $name，错误不含字段值', ({ input }) => {
    expect(validateSceneCommandBatch(input)).toEqual({ success: false, code: 'INVALID_COMMAND' });
    expect(applySceneCommandBatch(scene(), input)).toEqual({
      success: false,
      code: 'INVALID_COMMAND',
    });
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('拒绝非法目标索引 %s', (index) => {
    expect(validateSceneCommandBatch(batch([add(textNode('text-2'), null, index)]))).toEqual({
      success: false,
      code: 'INVALID_COMMAND',
    });
    expect(validateSceneCommandBatch(batch([move('text-1', null, index)]))).toEqual({
      success: false,
      code: 'INVALID_COMMAND',
    });
  });

  it('复用文档变换数值上限，拒绝转换、非有限数和尺寸越界', () => {
    for (const field of ['x', 'y', 'width', 'height', 'rotation']) {
      for (const value of [NaN, Infinity, -Infinity, '1']) {
        expect(
          validateSceneCommandBatch(batch([update('text-1', { transform: { [field]: value } })])),
        ).toEqual({ success: false, code: 'INVALID_COMMAND' });
      }
    }
    for (const changes of [
      { transform: { x: SCENE_LIMITS.maxPosition + 1 } },
      { transform: { y: -SCENE_LIMITS.maxPosition - 1 } },
      { transform: { width: 0 } },
      { transform: { height: SCENE_LIMITS.maxDimension + 1 } },
      { transform: { rotation: SCENE_LIMITS.maxRotation + 1 } },
      { text: '😀'.repeat(SCENE_LIMITS.maxTextLength + 1) },
    ]) {
      expect(validateSceneCommandBatch(batch([update('text-1', changes)]))).toEqual({
        success: false,
        code: 'INVALID_COMMAND',
      });
    }
    expect(
      resultDocument(
        applySceneCommandBatch(
          scene(),
          batch([update('text-1', { text: '😀'.repeat(SCENE_LIMITS.maxTextLength) })]),
        ),
      ).nodes[0],
    ).toHaveProperty('text', '😀'.repeat(SCENE_LIMITS.maxTextLength));
  });

  it('100 个有效操作作为一批提交，超过上限明确拒绝', () => {
    const operations = Array.from({ length: SCENE_COMMAND_LIMITS.maxOperations }, (_, index) =>
      update('text-1', { text: String(index) }),
    );
    const result = resultDocument(applySceneCommandBatch(scene(), batch(operations)));
    expect(result.revision).toBe(1);
    expect(result.nodes[0]).toHaveProperty('text', '99');
    expect(validateSceneCommandBatch(batch([...operations, update()]))).toEqual({
      success: false,
      code: 'INVALID_COMMAND',
    });
  });

  it('在遍历操作或新增节点的超量数组之前拒绝输入', () => {
    for (const length of [SCENE_COMMAND_LIMITS.maxOperations + 1, SCENE_LIMITS.maxNodes + 1]) {
      const oversized: unknown[] = Array.from({ length }, () => null);
      Object.defineProperty(oversized, 0, {
        get: () => {
          throw new Error('不能读取超量数组中的元素。');
        },
      });
      const input =
        length === SCENE_COMMAND_LIMITS.maxOperations + 1
          ? batch(oversized)
          : batch([
              {
                type: 'node.add',
                node: { ...groupNode(), children: oversized },
                parentId: null,
                index: 0,
              },
            ]);
      expect(validateSceneCommandBatch(input)).toEqual({ success: false, code: 'INVALID_COMMAND' });
    }
  });

  it('节点达到上限后拒绝新增，即使同批后续操作计划删除', () => {
    const input = scene(
      Array.from({ length: SCENE_LIMITS.maxNodes }, (_, index) => rectangleNode(`r-${index}`)),
    );
    const before = JSON.stringify(input);
    expect(
      applySceneCommandBatch(input, batch([add(), { type: 'node.remove', nodeId: 'r-0' }])),
    ).toEqual({ success: false, code: 'INVALID_RESULT', operationIndex: 0 });
    expect(JSON.stringify(input)).toBe(before);
  });

  it('允许最后一层的新增，拒绝创建超过深度边界的子节点', () => {
    expect(
      resultDocument(
        applySceneCommandBatch(
          chain(SCENE_LIMITS.maxDepth - 1),
          batch([add(textNode(), `g-${SCENE_LIMITS.maxDepth - 2}`, 0)]),
        ),
      ).nodes,
    ).toHaveLength(SCENE_LIMITS.maxDepth);
    expect(
      applySceneCommandBatch(
        chain(SCENE_LIMITS.maxDepth),
        batch([add(textNode(), `g-${SCENE_LIMITS.maxDepth - 1}`, 0)]),
      ),
    ).toEqual({ success: false, code: 'INVALID_RESULT', operationIndex: 0 });
  });
});

describe('节点添加、层级移动和子树删除', () => {
  it('根节点和组合子节点均按指定索引插入，节点存储顺序保持独立', () => {
    const input = scene([textNode(), groupNode()], ['group-1', 'text-1']);
    const result = resultDocument(
      applySceneCommandBatch(
        input,
        batch([
          add(textNode('new-root'), null, 1),
          { type: 'node.add', node: rectangleNode(), parentId: 'group-1', index: 0 },
        ]),
      ),
    );
    expect(result.rootIds).toEqual(['group-1', 'new-root', 'text-1']);
    expect(result.nodes.map((node) => node.id)).toEqual([
      'text-1',
      'group-1',
      'new-root',
      'rectangle-1',
    ]);
    expect(result.nodes[1]).toHaveProperty('children', ['rectangle-1']);
  });

  it('拒绝重复 ID、非空新增组合、无效父节点和越界插入', () => {
    const cases = [
      { operation: add(textNode()), code: 'NODE_EXISTS' },
      {
        operation: { type: 'node.add', node: groupNode('g', ['text-1']), parentId: null, index: 0 },
        code: 'INVALID_OPERATION',
      },
      { operation: add(textNode('text-2'), 'missing', 0), code: 'INVALID_PARENT' },
      { operation: add(textNode('text-2'), 'text-1', 0), code: 'INVALID_PARENT' },
      { operation: add(textNode('text-2'), null, 2), code: 'INVALID_INDEX' },
    ];
    for (const { operation, code } of cases) {
      expect(applySceneCommandBatch(scene(), batch([operation]))).toEqual({
        success: false,
        code,
        operationIndex: 0,
      });
    }
  });

  it('同父排序使用移除后的索引，首尾移动可往返', () => {
    const input = scene([textNode('a'), textNode('b'), textNode('c')]);
    const end = resultDocument(applySceneCommandBatch(input, batch([move('a', null, 2)])));
    expect(end.rootIds).toEqual(['b', 'c', 'a']);
    expect(end.nodes).toEqual(input.nodes);
    const start = resultDocument(
      applySceneCommandBatch(end, batch([move('a', null, 0)], 'scene-1', 1)),
    );
    expect(start.rootIds).toEqual(input.rootIds);
    expect(applySceneCommandBatch(input, batch([move('a', null, 3)]))).toEqual({
      success: false,
      code: 'INVALID_INDEX',
      operationIndex: 0,
    });
  });

  it('显式移父保持局部变换，可同批更新指定的新变换，再移回根列表', () => {
    const input = scene([groupNode('g', ['a', 'b']), textNode('a'), textNode('b')], ['g']);
    const result = resultDocument(
      applySceneCommandBatch(
        input,
        batch([
          move('b', 'g', 0),
          move('a', null, 0),
          update('a', { transform: { x: 300, y: 400 } }),
          move('a', 'g', 1),
        ]),
      ),
    );
    expect(result.rootIds).toEqual(['g']);
    expect(result.nodes[0]).toHaveProperty('children', ['b', 'a']);
    expect(result.nodes[1]?.transform).toEqual({ ...transform(), x: 300, y: 400 });
    expect(result.nodes[2]?.transform).toEqual(transform());
  });

  it('拒绝节点自移父、父移入后代、非组合目标和不存在的源', () => {
    const input = scene(
      [groupNode('g', ['child']), groupNode('child'), textNode()],
      ['g', 'text-1'],
    );
    for (const operation of [move('g', 'g', 0), move('g', 'child', 0), move('g', 'text-1', 0)]) {
      expect(applySceneCommandBatch(input, batch([operation]))).toEqual({
        success: false,
        code: 'INVALID_PARENT',
        operationIndex: 0,
      });
    }
    expect(applySceneCommandBatch(input, batch([move('missing', null, 0)]))).toEqual({
      success: false,
      code: 'NODE_NOT_FOUND',
      operationIndex: 0,
    });
  });

  it('移动已有子树同样检查整棵树的深度边界', () => {
    const input = chain(SCENE_LIMITS.maxDepth);
    const withNode = { ...input, nodes: [...input.nodes, textNode()], rootIds: ['g-0', 'text-1'] };
    expect(
      applySceneCommandBatch(
        withNode,
        batch([move('text-1', `g-${SCENE_LIMITS.maxDepth - 1}`, 0)]),
      ),
    ).toEqual({ success: false, code: 'INVALID_RESULT', operationIndex: 0 });
    expect(withNode.rootIds).toEqual(['g-0', 'text-1']);
  });

  it('删除组合会删除所有后代，保留兄弟、节点顺序及剩余引用', () => {
    const input = scene(
      [
        groupNode('outer', ['before', 'inner', 'after']),
        textNode('before'),
        groupNode('inner', ['nested']),
        groupNode('nested', ['leaf']),
        rectangleNode('leaf'),
        textNode('after'),
      ],
      ['outer'],
    );
    const result = resultDocument(
      applySceneCommandBatch(input, batch([{ type: 'node.remove', nodeId: 'inner' }])),
    );
    expect(result.nodes).toEqual([
      groupNode('outer', ['before', 'after']),
      textNode('before'),
      textNode('after'),
    ]);
    const empty = resultDocument(
      applySceneCommandBatch(
        result,
        batch([{ type: 'node.remove', nodeId: 'outer' }], 'scene-1', 1),
      ),
    );
    expect(empty.nodes).toEqual([]);
    expect(empty.rootIds).toEqual([]);
    expect(input.nodes).toHaveLength(6);
  });

  it('删除原子节点清理所属列表，删除后再操作其后代会整批失败', () => {
    const input = scene([groupNode('g', ['child']), textNode('child')], ['g']);
    const removed = resultDocument(
      applySceneCommandBatch(input, batch([{ type: 'node.remove', nodeId: 'child' }])),
    );
    expect(removed.nodes).toEqual([groupNode('g')]);
    expect(
      applySceneCommandBatch(input, batch([{ type: 'node.remove', nodeId: 'g' }, update('child')])),
    ).toEqual({ success: false, code: 'NODE_NOT_FOUND', operationIndex: 1 });
    expect(input.nodes).toEqual([groupNode('g', ['child']), textNode('child')]);
    expect(
      applySceneCommandBatch(input, batch([{ type: 'node.remove', nodeId: 'missing' }])),
    ).toEqual({ success: false, code: 'NODE_NOT_FOUND', operationIndex: 0 });
  });

  it('文字专属字段不能写到矩形或组合，合法公共字段更新保留类型', () => {
    const input = scene([rectangleNode(), groupNode()]);
    for (const id of ['rectangle-1', 'group-1']) {
      expect(applySceneCommandBatch(input, batch([update(id)]))).toEqual({
        success: false,
        code: 'INVALID_OPERATION',
        operationIndex: 0,
      });
    }
    const result = resultDocument(
      applySceneCommandBatch(
        input,
        batch([
          update('rectangle-1', { visible: false }),
          update('group-1', { transform: { width: 300 } }),
        ]),
      ),
    );
    expect(result.nodes[0]).toEqual({ ...rectangleNode(), visible: false });
    expect(result.nodes[1]).toEqual({
      ...groupNode(),
      transform: { ...transform(), width: 300 },
    });
  });
});
