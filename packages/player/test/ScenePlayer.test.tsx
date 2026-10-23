import {
  createEmptyScene,
  type RectangleNode,
  type SceneDocument,
  type SceneNode,
} from '@neobo/scene/document';
import { DEFAULT_SCENE_THEME, resolveSceneTheme } from '@neobo/theme';
import { fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  createSceneComponentRegistry,
  ScenePlayer,
  sceneComponents,
  type SceneComponentRegistry,
} from '../src/index.js';

function rectangle(id = 'rectangle'): RectangleNode {
  return {
    id,
    type: 'rectangle',
    componentVersion: 1,
    visible: true,
    transform: { x: 10, y: 20, width: 100, height: 60, rotation: 0 },
  };
}

function scene(nodes: readonly SceneNode[] = [rectangle()]): SceneDocument {
  return {
    ...createEmptyScene({ id: 'player', width: 800, height: 600 }),
    nodes,
    rootIds: nodes.map((node) => node.id),
  };
}

describe('公开只读播放器', () => {
  it('公开入口按画布比例响应父容器，支持默认和自定义可访问名称', () => {
    const { rerender } = render(<ScenePlayer document={scene()} />);
    const svg = screen.getByRole('img', { name: '场景播放器' });
    expect(svg).toHaveAttribute('viewBox', '0 0 800 600');
    expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
    expect(svg).toHaveStyle({ display: 'block', width: '100%', height: 'auto' });
    expect(svg).not.toHaveAttribute('tabindex');
    rerender(<ScenePlayer document={scene()} label="场景预览画布" />);
    expect(screen.getByRole('img', { name: '场景预览画布' })).toBeInTheDocument();
  });

  it.each([null, undefined, {}, { ...scene(), schemaVersion: 2 }])(
    '非法或不支持的文档显示固定错误且不绘制SVG',
    (document) => {
      const { container } = render(<ScenePlayer document={document} />);
      expect(screen.getByRole('alert')).toHaveTextContent(/^场景文档无效或版本不受支持。$/);
      expect(container.querySelector('svg')).toBeNull();
    },
  );

  it('未知组件版本与访问输入异常不会泄露业务文字或原始异常', () => {
    const invalid = {
      ...scene(),
      nodes: [{ ...rectangle(), componentVersion: 2, text: 'synthetic-input-secret' }],
    };
    const { container, rerender } = render(<ScenePlayer document={invalid} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/^场景文档无效或版本不受支持。$/);
    expect(container).not.toHaveTextContent('synthetic-input-secret');
    rerender(
      <ScenePlayer
        document={{
          get schemaVersion() {
            throw new Error('synthetic-getter-secret');
          },
        }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/^场景文档无效或版本不受支持。$/);
    expect(container).not.toHaveTextContent('synthetic-getter-secret');
  });

  it('非法替换卸载原画面，再换为合法文档后仅绘制新文档', () => {
    const { container, rerender } = render(<ScenePlayer document={scene([rectangle('old')])} />);
    expect(container.querySelector('[data-node-id="old"]')).toBeInTheDocument();
    rerender(<ScenePlayer document={{ ...scene(), nodes: [] }} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.querySelector('svg, [data-node-id]')).toBeNull();
    rerender(<ScenePlayer document={scene([rectangle('new')])} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(container.querySelector('[data-node-id="old"]')).toBeNull();
    expect(container.querySelector('[data-node-id="new"]')).toBeInTheDocument();
  });

  it.each([
    { id: 'synthetic-theme-secret', version: 1 },
    { id: 'deep-blue', version: 2 },
  ])('非法主题替换立即卸载旧主题画面，合法替换后按新主题恢复', (theme) => {
    const dark = { id: 'deep-blue', version: 1 } as const;
    const document = { ...scene(), theme: dark };
    const { container, rerender } = render(<ScenePlayer document={document} />);
    expect(container.querySelector('[data-scene-background]')).toHaveAttribute(
      'fill',
      resolveSceneTheme(dark).tokens.canvasBackground,
    );
    rerender(<ScenePlayer document={{ ...document, theme }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/^场景文档无效或版本不受支持。$/);
    expect(container.querySelector('svg, [data-node-id], [data-scene-background]')).toBeNull();
    expect(container).not.toHaveTextContent('synthetic-theme-secret');
    rerender(<ScenePlayer document={scene([rectangle('recovered')])} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(container.querySelector('[data-scene-background]')).toHaveAttribute(
      'fill',
      DEFAULT_SCENE_THEME.tokens.canvasBackground,
    );
    expect(container.querySelector('[data-node-id="recovered"]')).toBeInTheDocument();
  });

  it('绘制消费运行时校验产生的独立节点和变换，不持有输入引用', () => {
    const input = scene();
    const draw = vi.fn((node: RectangleNode) => <circle r={node.transform.width / 2} />);
    const registry = createSceneComponentRegistry([
      { ...sceneComponents.resolve('rectangle', 1), render: draw },
    ]);
    const { container } = render(<ScenePlayer document={input} registry={registry} />);
    const rendered = draw.mock.calls[0]?.[0];
    expect(rendered).toEqual(input.nodes[0]);
    expect(rendered).not.toBe(input.nodes[0]);
    expect(rendered?.transform).not.toBe(input.nodes[0]?.transform);
    expect(container.querySelector('circle')).toHaveAttribute('r', '50');
  });

  it('注册绘制失败与未登记类型显示安全错误，合法替换可恢复', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = createSceneComponentRegistry([
      {
        ...sceneComponents.resolve('rectangle', 1),
        render: () => {
          throw new Error('synthetic-render-secret');
        },
      },
    ]);
    const { container, rerender } = render(<ScenePlayer document={scene()} registry={failed} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/^场景绘制失败。$/);
    expect(container.querySelector('svg')).toBeNull();
    expect(container).not.toHaveTextContent('synthetic-render-secret');
    rerender(<ScenePlayer document={scene()} registry={createSceneComponentRegistry([])} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/^场景绘制失败。$/);
    rerender(<ScenePlayer document={scene()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(container.querySelector('[data-node-id="rectangle"]')).toBeInTheDocument();
  });

  it('点击、右键和编辑快捷键不会修改文档或产生编辑界面', () => {
    const document = scene();
    const original = structuredClone(document);
    const { container } = render(<ScenePlayer document={document} />);
    const svg = screen.getByRole('img', { name: '场景播放器' });
    fireEvent.pointerDown(svg, { button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(svg, { clientX: 80, clientY: 90 });
    fireEvent.pointerUp(svg, { button: 0 });
    fireEvent.contextMenu(svg);
    fireEvent.keyDown(svg, { key: 'Delete' });
    fireEvent.keyDown(svg, { key: 'z', ctrlKey: true });
    expect(document).toEqual(original);
    expect(
      container.querySelector('button, input, textarea, [role="menu"], [data-selection]'),
    ).toBeNull();
  });

  it('StrictMode下资源配对释放，父组合隐藏、非法替换与卸载均清理子绘制', () => {
    const acquired = new Set<symbol>();
    const acquire = vi.fn((resource: symbol) => acquired.add(resource));
    const release = vi.fn((resource: symbol) => acquired.delete(resource));
    function ResourceRectangle({ node }: { readonly node: RectangleNode }) {
      useEffect(() => {
        const resource = Symbol('player-resource');
        acquire(resource);
        return () => {
          release(resource);
        };
      }, []);
      return <ellipse rx={node.transform.width / 2} />;
    }
    const registry: SceneComponentRegistry = createSceneComponentRegistry([
      {
        ...sceneComponents.resolve('rectangle', 1),
        render: (node: RectangleNode) => <ResourceRectangle node={node} />,
      },
    ]);
    const group = {
      id: 'group',
      type: 'group',
      visible: true,
      transform: rectangle().transform,
      children: ['rectangle'],
    } satisfies SceneNode;
    const document = { ...scene([group, rectangle()]), rootIds: ['group'] };
    const view = (input: unknown) => (
      <StrictMode>
        <ScenePlayer document={input} registry={registry} />
      </StrictMode>
    );
    const { rerender, unmount } = render(view(document));
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
    expect(acquired.size).toBe(1);
    rerender(view({ ...document, nodes: [{ ...group, visible: false }, rectangle()] }));
    expect(acquired.size).toBe(0);
    rerender(view(document));
    expect(acquired.size).toBe(1);
    rerender(view({ ...document, theme: { id: 'deep-blue', version: 2 } }));
    expect(acquired.size).toBe(0);
    rerender(view(document));
    expect(acquired.size).toBe(1);
    unmount();
    expect(acquired.size).toBe(0);
    expect(release).toHaveBeenCalledTimes(acquire.mock.calls.length);
  });
});
