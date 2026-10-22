import { describe, expect, it } from 'vitest';
import {
  createEmptyScene,
  SCENE_LIMITS,
  SCENE_SCHEMA_VERSION,
  validateSceneDocument,
} from '../src/index.js';
import type { SceneDocument, SceneValidationCode } from '../src/index.js';
import unsupportedFixture from './fixtures/scene-v0-unsupported.json' with { type: 'json' };
import fixture from './fixtures/scene-v1.json' with { type: 'json' };

function textNode(id = 'text-1') {
  return {
    id,
    type: 'text' as const,
    componentVersion: 1 as const,
    text: '场景文字',
    transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0 },
    visible: true,
  };
}

function groupNode(id: string, children: string[]) {
  return {
    id,
    type: 'group' as const,
    children,
    transform: { x: 0, y: 0, width: 200, height: 100, rotation: 0 },
    visible: true,
  };
}

function scene() {
  return {
    schemaVersion: 1,
    id: 'scene-1',
    revision: 0,
    canvas: { width: 1920, height: 1080 },
    rootIds: ['text-1'],
    nodes: [textNode()],
  };
}

function chain(length: number) {
  const nodes = Array.from({ length }, (_, index) =>
    groupNode(`group-${index}`, index + 1 < length ? [`group-${index + 1}`] : []),
  );
  return { ...scene(), rootIds: ['group-0'], nodes };
}

function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach((child: unknown) => freeze(child));
    Object.freeze(value);
  }
  return value;
}

function expectIssue(input: unknown, code?: SceneValidationCode): void {
  const result = validateSceneDocument(input);
  expect(result.success).toBe(false);
  if (result.success) throw new Error('测试输入应被拒绝。');
  expect(result.issues.length).toBeGreaterThan(0);
  expect(result.issues.length).toBeLessThanOrEqual(SCENE_LIMITS.maxIssues);
  if (code) expect(result.issues.some((issue) => issue.code === code)).toBe(true);
}

describe('版本化场景契约', () => {
  it('保留已知版本样例及根、子节点顺序，序列化后仍可校验', () => {
    const first = validateSceneDocument(fixture);
    expect(first.success).toBe(true);
    if (!first.success) throw new Error('当前版本样例应合法。');
    expect(first.data).toEqual(fixture);
    const restored: unknown = JSON.parse(JSON.stringify(first.data));
    expect(validateSceneDocument(restored)).toEqual(first);
  });

  it('明确拒绝旧版及未知版本，不伪装成自动迁移', () => {
    expectIssue(unsupportedFixture, 'UNSUPPORTED_VERSION');
    expectIssue({ ...scene(), schemaVersion: 2 }, 'UNSUPPORTED_VERSION');
    expectIssue({ ...scene(), schemaVersion: '1' }, 'UNSUPPORTED_VERSION');
    expect(SCENE_SCHEMA_VERSION).toBe(1);
  });

  it('由显式参数构造修订号为零的空场景，返回类型可只读访问', () => {
    const empty: SceneDocument = createEmptyScene({ id: 'empty-1', width: 1920, height: 1080 });
    expect(empty).toEqual({ ...scene(), id: 'empty-1', rootIds: [], nodes: [] });
    expect(validateSceneDocument(empty).success).toBe(true);
    expect(createEmptyScene({ id: 'tiny', width: 0.5, height: 0.25 }).canvas.width).toBe(0.5);
    expect(() => createEmptyScene({ id: 'invalid secret!', width: 0, height: 1080 })).toThrow(
      '场景标识或画布尺寸无效。',
    );
  });

  it('合法与非法冻结输入均保持原样，输出与原输入不共享可变对象', () => {
    const input = freeze(scene());
    const before = JSON.stringify(input);
    const result = validateSceneDocument(input);
    expect(result.success).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
    if (!result.success) throw new Error('冻结场景应可校验。');
    expect(result.data).not.toBe(input);
    expect(result.data.nodes).not.toBe(input.nodes);
    expect(result.data.canvas).not.toBe(input.canvas);
    const invalid = freeze({ ...scene(), extraSecret: 'synthetic-secret' });
    expectIssue(invalid);
    expect(invalid).toHaveProperty('extraSecret', 'synthetic-secret');
  });

  it.each([
    { name: 'null', input: null },
    { name: '数组根对象', input: [] },
    { name: '缺少字段', input: { schemaVersion: 1 } },
    { name: '未知节点类型', input: { ...scene(), nodes: [{ ...textNode(), type: 'image' }] } },
    {
      name: '未知组件版本',
      input: { ...scene(), nodes: [{ ...textNode(), componentVersion: 2 }] },
    },
    { name: '字符串数值', input: { ...scene(), revision: '0' } },
    { name: '字符串可见性', input: { ...scene(), nodes: [{ ...textNode(), visible: 'true' }] } },
    { name: '原子节点含子节点', input: { ...scene(), nodes: [{ ...textNode(), children: [] }] } },
    {
      name: '组合含组件版本',
      input: {
        ...scene(),
        rootIds: ['g'],
        nodes: [{ ...groupNode('g', []), componentVersion: 1 }],
      },
    },
    {
      name: '缺少文本',
      input: {
        ...scene(),
        nodes: [
          {
            id: 'text-1',
            type: 'text',
            componentVersion: 1,
            transform: textNode().transform,
            visible: true,
          },
        ],
      },
    },
  ])('拒绝 $name', ({ input }) => expectIssue(input));

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])(
    '拒绝非法修订号 %s',
    (revision) => {
      expectIssue({ ...scene(), revision });
    },
  );

  it('接受最大的安全整数修订号与合法标识边界', () => {
    expect(
      validateSceneDocument({
        ...scene(),
        revision: Number.MAX_SAFE_INTEGER,
        id: `a${'_'.repeat(63)}`,
      }).success,
    ).toBe(true);
    for (const id of ['', 'a'.repeat(65), '_leading', 'has space', '中文', 'a/b']) {
      expectIssue({ ...scene(), id });
    }
  });

  it.each([0, -1, SCENE_LIMITS.maxDimension + 1, NaN, Infinity, -Infinity])(
    '拒绝非法画布和节点尺寸 %s',
    (dimension) => {
      expectIssue({ ...scene(), canvas: { width: dimension, height: 1080 } });
      expectIssue({ ...scene(), canvas: { width: 1920, height: dimension } });
      for (const field of ['width', 'height']) {
        expectIssue({
          ...scene(),
          nodes: [{ ...textNode(), transform: { ...textNode().transform, [field]: dimension } }],
        });
      }
    },
  );

  it('接受尺寸及位置旋转边界，拒绝超界和非有限数值', () => {
    const transform = {
      x: -SCENE_LIMITS.maxPosition,
      y: SCENE_LIMITS.maxPosition,
      width: SCENE_LIMITS.maxDimension,
      height: 0.5,
      rotation: -SCENE_LIMITS.maxRotation,
    };
    expect(
      validateSceneDocument({
        ...scene(),
        canvas: { width: SCENE_LIMITS.maxDimension, height: 0.5 },
        nodes: [{ ...textNode(), transform }],
      }).success,
    ).toBe(true);
    for (const field of ['x', 'y', 'rotation']) {
      const max = field === 'rotation' ? SCENE_LIMITS.maxRotation : SCENE_LIMITS.maxPosition;
      for (const value of [-max - 1, max + 1, NaN, Infinity, -Infinity]) {
        expectIssue({
          ...scene(),
          nodes: [{ ...textNode(), transform: { ...transform, [field]: value } }],
        });
      }
    }
  });

  it('按 Unicode 码点限制文本，允许空文本', () => {
    for (const text of ['', '😀'.repeat(SCENE_LIMITS.maxTextLength)]) {
      expect(validateSceneDocument({ ...scene(), nodes: [{ ...textNode(), text }] }).success).toBe(
        true,
      );
    }
    expectIssue({
      ...scene(),
      nodes: [{ ...textNode(), text: '😀'.repeat(SCENE_LIMITS.maxTextLength + 1) }],
    });
    expectIssue({
      ...scene(),
      nodes: [{ ...textNode(), text: 'e\u0301'.repeat(SCENE_LIMITS.maxTextLength / 2) + 'e' }],
    });
  });

  it.each(['synthetic-secret-key', 'constructor', 'prototype', '__proto__'])(
    '拒绝未知字段 %s，问题中不包含字段名与值',
    (key) => {
      const secret = 'synthetic-sensitive-value';
      for (const input of [
        { ...scene(), [key]: secret },
        { ...scene(), canvas: { ...scene().canvas, [key]: secret } },
        { ...scene(), nodes: [{ ...textNode(), [key]: secret }] },
        {
          ...scene(),
          nodes: [{ ...textNode(), transform: { ...textNode().transform, [key]: secret } }],
        },
      ]) {
        const frozen = freeze(input);
        const before = JSON.stringify(frozen);
        const result = validateSceneDocument(frozen);
        expect(result.success).toBe(false);
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(key);
        expect(serialized).not.toContain(secret);
        expect(serialized).not.toContain('message');
        expect(JSON.stringify(frozen)).toBe(before);
      }
    },
  );
});

describe('场景结构与资源边界', () => {
  it('允许空组合，并以根与children数组保存层级顺序', () => {
    const input = { ...scene(), rootIds: ['g'], nodes: [groupNode('g', [])] };
    expect(validateSceneDocument(input).success).toBe(true);
    const reordered = { ...fixture, nodes: [...fixture.nodes].reverse() };
    expect(validateSceneDocument(reordered).success).toBe(true);
  });

  it('拒绝重复节点标识', () => {
    expectIssue({ ...scene(), nodes: [textNode(), textNode()] }, 'DUPLICATE_ID');
  });

  it.each([
    { name: '根重复引用', input: { ...scene(), rootIds: ['text-1', 'text-1'] } },
    { name: '根引用缺失', input: { ...scene(), rootIds: ['missing'] } },
    {
      name: '子节点缺失',
      input: { ...scene(), rootIds: ['g'], nodes: [groupNode('g', ['missing'])] },
    },
    {
      name: '子节点重复',
      input: {
        ...scene(),
        rootIds: ['g'],
        nodes: [groupNode('g', ['text-1', 'text-1']), textNode()],
      },
    },
    {
      name: '根与组合同时引用',
      input: {
        ...scene(),
        rootIds: ['g', 'text-1'],
        nodes: [groupNode('g', ['text-1']), textNode()],
      },
    },
    {
      name: '多个父组合',
      input: {
        ...scene(),
        rootIds: ['a', 'b'],
        nodes: [groupNode('a', ['text-1']), groupNode('b', ['text-1']), textNode()],
      },
    },
    { name: '无父且不可达节点', input: { ...scene(), rootIds: [] } },
  ])('拒绝 $name', ({ input }) => expectIssue(input, 'INVALID_REFERENCE'));

  it('检查根节点之外的孤立环及自引用', () => {
    expectIssue({ ...scene(), rootIds: [], nodes: [groupNode('a', ['a'])] }, 'CYCLE');
    expectIssue(
      { ...scene(), nodes: [textNode(), groupNode('a', ['b']), groupNode('b', ['a'])] },
      'CYCLE',
    );
    expectIssue(
      { ...scene(), rootIds: ['a'], nodes: [groupNode('a', ['b']), groupNode('b', ['a'])] },
      'CYCLE',
    );
  });

  it('根层级为1，接受深度边界，拒绝超深和恶意长链而不栈溢出', () => {
    expect(validateSceneDocument(chain(SCENE_LIMITS.maxDepth)).success).toBe(true);
    expectIssue(chain(SCENE_LIMITS.maxDepth + 1), 'DEPTH_LIMIT');
    expectIssue(chain(SCENE_LIMITS.maxNodes), 'DEPTH_LIMIT');
  });

  it('接受节点数量边界，并在解析超量数组元素前拒绝', () => {
    const nodes = Array.from({ length: SCENE_LIMITS.maxNodes }, (_, index) =>
      textNode(`text-${index}`),
    );
    expect(
      validateSceneDocument({ ...scene(), nodes, rootIds: nodes.map((node) => node.id) }).success,
    ).toBe(true);
    const oversized: unknown[] = Array.from({ length: SCENE_LIMITS.maxNodes + 1 }, () => null);
    Object.defineProperty(oversized, 0, {
      get: () => {
        throw new Error('不能遍历超量数组。');
      },
    });
    expectIssue({ ...scene(), nodes: oversized }, 'INVALID_VALUE');
    expectIssue({ ...scene(), rootIds: oversized }, 'INVALID_VALUE');
    expectIssue(
      {
        ...scene(),
        rootIds: ['g'],
        nodes: [groupNode('g', []), { ...groupNode('other', []), children: oversized }],
      },
      'INVALID_VALUE',
    );
  });

  it('在逐项校验前限制子引用总数，错误只保留固定结构与20项', () => {
    const children = Array.from({ length: SCENE_LIMITS.maxNodes }, () => 'missing');
    expectIssue({ ...scene(), rootIds: ['a'], nodes: [groupNode('a', children)] }, 'INVALID_VALUE');
    const nodes = Array.from({ length: 100 }, (_, index) => textNode(`text-${index}`));
    const result = validateSceneDocument({ ...scene(), nodes, rootIds: [] });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('孤立节点应被拒绝。');
    expect(result.issues).toHaveLength(SCENE_LIMITS.maxIssues);
    expect(
      result.issues.every((issue) => Object.keys(issue).sort().join(',') === 'code,path'),
    ).toBe(true);
  });
});
