import { SCENE_LIMITS, type TextNode } from '@neobo/scene/document';
import { describe, expect, it } from 'vitest';
import {
  createSceneComponentRegistry,
  type SceneComponentType,
} from '../src/component-registry.js';
import { sceneComponents } from '../src/components.js';

describe('闭合原子组件注册入口', () => {
  it('按类型和组件版本解析现有描述，也接受联合类型调用', () => {
    const label = (type: SceneComponentType) => sceneComponents.resolve(type, 1).label;

    expect(label('text')).toBe('文字');
    expect(label('rectangle')).toBe('矩形');
    expect(label('bar-chart')).toBe('柱状图');
    expect(sceneComponents.resolve('bar-chart', 1).defaultSize).toEqual({
      width: 480,
      height: 320,
    });
    expect(sceneComponents.resolve('bar-chart', 1).defaultData).toEqual([]);
    expect(sceneComponents.resolve('text', 1).defaultText).toBe('文字');
    expect(sceneComponents.resolve('text', 1).defaultSize).toEqual({ width: 320, height: 72 });
    expect(sceneComponents.resolve('rectangle', 1).defaultSize).toEqual({
      width: 320,
      height: 180,
    });
  });

  it('登记元数据是只读独立快照，不受调用方修改或移除声明影响', () => {
    const size = { width: 80, height: 40 };
    const draw = (node: TextNode) => <text>{node.text}</text>;
    const description = {
      ...sceneComponents.resolve('text', 1),
      label: '登记标签',
      defaultSize: size,
      defaultText: '登记文字',
      render: draw,
    };
    const descriptions = [description];
    const registry = createSceneComponentRegistry(descriptions);
    description.label = '修改后的标签';
    description.defaultText = '修改后的文字';
    description.render = () => <text>替换后的绘制</text>;
    size.width = 1;
    descriptions.pop();

    const registered = registry.resolve('text', 1);
    expect(registered.label).toBe('登记标签');
    expect(registered.defaultText).toBe('登记文字');
    expect(registered.defaultSize).toEqual({ width: 80, height: 40 });
    expect(registered.render).toBe(draw);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered.defaultSize)).toBe(true);
    expect(Reflect.set(registered, 'label', '不能覆盖')).toBe(false);
    expect(Reflect.set(registered.defaultSize, 'width', 2)).toBe(false);
  });

  it('重复注册固定失败，不回显调用方标签', () => {
    const description = { ...sceneComponents.resolve('text', 1), label: 'synthetic-label-secret' };

    expect(() => createSceneComponentRegistry([description, description])).toThrowError(
      /^场景组件重复注册。$/,
    );
  });

  it('柱状图默认数据保留独立冻结的数组与行快照', () => {
    const data = [{ category: '原类别', value: -1 }];
    const registry = createSceneComponentRegistry([
      { ...sceneComponents.resolve('bar-chart', 1), defaultData: data },
    ]);
    const registered = registry.resolve('bar-chart', 1);
    const row = data[0];
    if (!row) throw new Error('测试默认数据缺失。');
    row.category = '修改';
    row.value = 100;
    data.pop();
    expect(registered.defaultData).toEqual([{ category: '原类别', value: -1 }]);
    expect(Object.isFrozen(registered.defaultData)).toBe(true);
    expect(Object.isFrozen(registered.defaultData[0])).toBe(true);
  });

  it.each(
    [
      [{ category: ' ', value: 1 }],
      [{ category: '类别', value: Infinity }],
      [{ category: '类别', value: SCENE_LIMITS.maxChartValue + 1 }],
      Array.from({ length: SCENE_LIMITS.maxChartDataPoints + 1 }, () => ({
        category: '类别',
        value: 1,
      })),
    ].map((defaultData) => ({ defaultData })),
  )('柱状图无效默认数据不能绕过共享校验', ({ defaultData }) => {
    expect(() =>
      createSceneComponentRegistry([{ ...sceneComponents.resolve('bar-chart', 1), defaultData }]),
    ).toThrowError(/^场景组件声明无效。$/);
  });

  it.each([0, 2, NaN, Infinity])('未知版本 %s 固定失败，不回退到已登记版本', (version) => {
    expect(() => sceneComponents.resolve('text', version)).toThrowError(/^场景组件未注册。$/);
  });

  it('未知类型和未登记类型固定失败，不继承其他注册表内容', () => {
    const registry = createSceneComponentRegistry([sceneComponents.resolve('rectangle', 1)]);

    expect(() => registry.resolve('text', 1)).toThrowError(/^场景组件未注册。$/);
    expect(() => registry.resolve('synthetic-component-secret', 1)).toThrowError(
      /^场景组件未注册。$/,
    );
    expect(() => registry.resolve('group', 1)).toThrowError(/^场景组件未注册。$/);
  });

  it('登记默认值受共享场景契约约束，不能注册不支持的组件版本', () => {
    const description = { ...sceneComponents.resolve('text', 1) };
    Reflect.set(description, 'componentVersion', 2);

    expect(() => createSceneComponentRegistry([description])).toThrowError(/^场景组件声明无效。$/);
    expect(() =>
      createSceneComponentRegistry([
        {
          ...sceneComponents.resolve('text', 1),
          defaultText: '字'.repeat(SCENE_LIMITS.maxTextLength + 1),
        },
      ]),
    ).toThrowError(/^场景组件声明无效。$/);
    expect(() =>
      createSceneComponentRegistry([
        { ...sceneComponents.resolve('rectangle', 1), defaultSize: { width: 0, height: 40 } },
      ]),
    ).toThrowError(/^场景组件声明无效。$/);
  });
});
