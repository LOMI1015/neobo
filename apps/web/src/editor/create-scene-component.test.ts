import { createEmptyScene, createSceneHistory } from '@neobo/scene';
import {
  createSceneComponentRegistry,
  sceneComponents,
  type SceneComponentType,
} from '@neobo/player';
import { describe, expect, it } from 'vitest';
import { createSceneComponent } from './create-scene-component';

describe('编辑器原子组件创建', () => {
  it('内置组件保留现有添加尺寸、居中、可见性、旋转和默认文字', () => {
    const options = { id: 'new-text', canvas: { width: 1920, height: 1080 } };

    expect(createSceneComponent('text', options)).toEqual({
      id: 'new-text',
      type: 'text',
      componentVersion: 1,
      visible: true,
      transform: { x: 800, y: 504, width: 320, height: 72, rotation: 0 },
      text: '文字',
    });
    expect(createSceneComponent('rectangle', { ...options, id: 'new-rectangle' })).toEqual({
      id: 'new-rectangle',
      type: 'rectangle',
      componentVersion: 1,
      visible: true,
      transform: { x: 800, y: 450, width: 320, height: 180, rotation: 0 },
    });
  });

  it.each(['text', 'rectangle', 'bar-chart'] satisfies readonly SceneComponentType[])(
    '小画布中的 %s 保留逐维裁减尺寸和居中行为',
    (type) => {
      const node = createSceneComponent(type, { id: 'small', canvas: { width: 100, height: 30 } });

      expect(node.transform).toEqual({ x: 0, y: 0, width: 100, height: 30, rotation: 0 });
    },
  );

  it('实际使用传入注册表的默认值，创建结果可直接走共享添加命令与历史', () => {
    const registry = createSceneComponentRegistry([
      {
        ...sceneComponents.resolve('text', 1),
        label: '登记标签',
        defaultSize: { width: 80, height: 40 },
        defaultText: '登记文字',
      },
    ]);
    const canvas = { width: 200, height: 100 };
    const node = createSceneComponent('text', { id: 'registered', canvas }, registry);
    const history = createSceneHistory(createEmptyScene({ id: 'scene', ...canvas }));
    const result = history.execute({
      sceneId: 'scene',
      baseRevision: 0,
      operations: [{ type: 'node.add', parentId: null, index: 0, node }],
    });

    expect(node).toMatchObject({
      text: '登记文字',
      transform: { x: 60, y: 30, width: 80, height: 40 },
    });
    expect(result.success).toBe(true);
    expect(history.current().nodes).toEqual([node]);
    expect(history.undo({ sceneId: 'scene', baseRevision: 1 }).success).toBe(true);
    expect(history.current().nodes).toEqual([]);
  });

  it('每次创建返回独立节点和变换，也不保留调用方画布对象', () => {
    const options = { id: 'independent', canvas: { width: 1920, height: 1080 } };
    const first = createSceneComponent('rectangle', options);
    const second = createSceneComponent('rectangle', options);
    options.canvas.width = 100;
    Reflect.set(first.transform, 'x', 0);

    expect(first).not.toBe(second);
    expect(first.transform).not.toBe(second.transform);
    expect(second.transform).toEqual({ x: 800, y: 450, width: 320, height: 180, rotation: 0 });
  });

  it('柱状图创建保留空数据和默认尺寸，非空默认行在多次创建间独立', () => {
    expect(
      createSceneComponent('bar-chart', { id: 'empty', canvas: { width: 1920, height: 1080 } }),
    ).toMatchObject({
      type: 'bar-chart',
      data: [],
      transform: { x: 720, y: 380, width: 480, height: 320 },
    });
    const registry = createSceneComponentRegistry([
      { ...sceneComponents.resolve('bar-chart', 1), defaultData: [{ category: '类别', value: 0 }] },
    ]);
    const options = { id: 'independent', canvas: { width: 1920, height: 1080 } };
    const first = createSceneComponent('bar-chart', options, registry);
    const second = createSceneComponent('bar-chart', options, registry);
    if (first.type !== 'bar-chart' || second.type !== 'bar-chart')
      throw new Error('柱状图创建类型错误。');
    expect(first.data).not.toBe(second.data);
    expect(first.data[0]).not.toBe(second.data[0]);
    const row = first.data[0];
    if (!row) throw new Error('测试默认行缺失。');
    Reflect.set(row, 'value', 20);
    expect(second.data).toEqual([{ category: '类别', value: 0 }]);
    expect(registry.resolve('bar-chart', 1).defaultData).toEqual([{ category: '类别', value: 0 }]);
  });

  it('无效标识或画布不能通过工厂生成合法节点，失败不回显输入', () => {
    expect(() =>
      createSceneComponent('text', { id: '', canvas: { width: 100, height: 100 } }),
    ).toThrowError(/^场景组件初始数据无效。$/);
    expect(() =>
      createSceneComponent('rectangle', {
        id: 'synthetic-input-secret',
        canvas: { width: Infinity, height: 100 },
      }),
    ).toThrowError(/^场景组件初始数据无效。$/);
  });

  it('未登记类型明确失败，不回退到内置注册表', () => {
    const registry = createSceneComponentRegistry([sceneComponents.resolve('rectangle', 1)]);

    expect(() =>
      createSceneComponent('text', { id: 'missing', canvas: { width: 100, height: 60 } }, registry),
    ).toThrowError(/^场景组件未注册。$/);
  });
});
