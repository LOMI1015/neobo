import {
  createEmptyScene,
  createSceneHistory,
  SCENE_LIMITS,
  type RectangleNode,
  type TextNode,
} from '@neobo/scene';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createSceneComponentRegistry, type SceneComponentType } from './component-registry';
import { createSceneComponent, renderSceneComponent, sceneComponents } from './components';

describe('闭合原子组件注册入口', () => {
  it('按类型和组件版本解析现有描述，也接受联合类型调用', () => {
    const label = (type: SceneComponentType) => sceneComponents.resolve(type, 1).label;

    expect(label('text')).toBe('文字');
    expect(label('rectangle')).toBe('矩形');
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

describe('组件创建与绘制消费登记描述', () => {
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

  it.each(['text', 'rectangle'] satisfies readonly SceneComponentType[])(
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

  it('绘制调用传入的登记函数，未登记类型不会静默绘制空白', () => {
    const registry = createSceneComponentRegistry([
      {
        ...sceneComponents.resolve('rectangle', 1),
        render: (node: RectangleNode) => <circle r={node.transform.width / 2} fill="#123456" />,
      },
    ]);
    const node = createSceneComponent('rectangle', {
      id: 'draw',
      canvas: { width: 100, height: 60 },
    });
    const { container } = render(<svg>{renderSceneComponent(node, registry)}</svg>);

    expect(container.querySelector('circle')).toHaveAttribute('r', '50');
    expect(container.querySelector('rect')).toBeNull();
    expect(() =>
      createSceneComponent('text', { id: 'missing', canvas: { width: 100, height: 60 } }, registry),
    ).toThrowError(/^场景组件未注册。$/);
    const text = createSceneComponent('text', {
      id: 'missing',
      canvas: { width: 100, height: 60 },
    });
    expect(() => renderSceneComponent(text, registry)).toThrowError(/^场景组件未注册。$/);
  });
});
