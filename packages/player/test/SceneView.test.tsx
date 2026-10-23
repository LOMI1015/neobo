import {
  createEmptyScene,
  type RectangleNode,
  type SceneDocument,
  type SceneNode,
} from '@neobo/scene/document';
import { DEFAULT_SCENE_THEME, resolveSceneTheme, SCENE_THEMES } from '@neobo/theme';
import { render } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createSceneComponentRegistry } from '../src/component-registry.js';
import { sceneComponents } from '../src/components.js';
import { SceneView } from '../src/SceneView.js';

const transform = { x: 10, y: 20, width: 120, height: 60, rotation: 0 };

function rectangle(id: string): SceneNode {
  return { id, type: 'rectangle', componentVersion: 1, visible: true, transform };
}

function scene(nodes: readonly SceneNode[], rootIds = nodes.map((node) => node.id)): SceneDocument {
  return { ...createEmptyScene({ id: 'test', width: 800, height: 600 }), nodes, rootIds };
}

function renderScene(document: SceneDocument) {
  return render(
    <svg>
      <SceneView document={document} />
    </svg>,
  );
}

function ResourceRectangle({
  node,
  acquire,
  release,
}: {
  readonly node: RectangleNode;
  readonly acquire: (resource: symbol) => void;
  readonly release: (resource: symbol) => void;
}) {
  useEffect(() => {
    const resource = Symbol('registered-view');
    acquire(resource);
    return () => release(resource);
  }, [acquire, release]);

  return <ellipse rx={node.transform.width / 2} ry={node.transform.height / 2} />;
}

describe('只读二维场景绘制结构', () => {
  it.each(SCENE_THEMES)('$label统一绘制背景、文字和矩形，保留输入文档与层级', (theme) => {
    const document: SceneDocument = {
      ...scene([
        rectangle('rectangle'),
        {
          id: 'text',
          type: 'text',
          componentVersion: 1,
          visible: true,
          transform,
          text: '主题文字',
        },
      ]),
      theme: { id: theme.id, version: theme.version },
    };
    const original = structuredClone(document);
    const { container } = renderScene(document);
    const background = container.querySelector('svg')?.firstElementChild;
    expect(background).toHaveAttribute('data-scene-background');
    expect(background).toHaveAttribute('fill', theme.tokens.canvasBackground);
    expect(background).toHaveAttribute('width', '800');
    expect(background).toHaveAttribute('height', '600');
    expect(background).toHaveAttribute('pointer-events', 'none');
    expect(background).toHaveAttribute('aria-hidden', 'true');
    expect(background).not.toHaveAttribute('data-node-id');
    expect(container.querySelector('[data-node-id="rectangle"] > rect')).toHaveAttribute(
      'fill',
      theme.tokens.rectangleFill,
    );
    expect(container.querySelector('[data-node-id="rectangle"] > rect')).toHaveAttribute(
      'stroke',
      theme.tokens.rectangleStroke,
    );
    expect(container.querySelector('[data-node-id="text"] foreignObject > div')).toHaveStyle({
      color: theme.tokens.text,
    });
    expect(document).toEqual(original);
  });

  it('旧文档缺省主题仍用中性浅色，切换主题不重新挂载节点或改动布局', () => {
    const document = scene([rectangle('rectangle')]);
    const { container, rerender } = renderScene(document);
    const node = container.querySelector('[data-node-id="rectangle"]');
    const shape = node?.firstElementChild;
    expect(container.querySelector('[data-scene-background]')).toHaveAttribute(
      'fill',
      DEFAULT_SCENE_THEME.tokens.canvasBackground,
    );
    rerender(
      <svg>
        <SceneView document={{ ...document, theme: { id: 'deep-blue', version: 1 } }} />
      </svg>,
    );
    expect(container.querySelector('[data-node-id="rectangle"]')).toBe(node);
    expect(node?.firstElementChild).toBe(shape);
    expect(shape).toHaveAttribute(
      'fill',
      resolveSceneTheme({ id: 'deep-blue', version: 1 }).tokens.rectangleFill,
    );
    expect(node).toHaveAttribute('transform', 'translate(10 20) rotate(0 60 30)');
    expect(document).not.toHaveProperty('theme');
  });

  it('按根引用顺序绘制，与节点存储顺序无关', () => {
    const { container } = renderScene(
      scene([rectangle('front'), rectangle('back')], ['back', 'front']),
    );

    expect(
      Array.from(container.querySelectorAll('svg > g'), (element) =>
        element.getAttribute('data-node-id'),
      ),
    ).toEqual(['back', 'front']);
  });

  it('按组合子引用顺序绘制，透明框位于子元素之前', () => {
    const { container } = renderScene(
      scene(
        [
          rectangle('front'),
          rectangle('back'),
          { id: 'group', type: 'group', visible: true, transform, children: ['back', 'front'] },
        ],
        ['group'],
      ),
    );
    const group = container.querySelector('[data-node-id="group"]');

    expect(group?.firstElementChild).toHaveAttribute('data-group-frame');
    expect(
      Array.from(group?.querySelectorAll(':scope > g') ?? [], (element) =>
        element.getAttribute('data-node-id'),
      ),
    ).toEqual(['back', 'front']);
  });

  it('嵌套旋转绕各自中心，不以组合框尺寸缩放或裁剪子元素', () => {
    const { container } = renderScene(
      scene(
        [
          {
            ...rectangle('outside'),
            transform: { x: 500, y: -100, width: 240, height: 120, rotation: -45 },
          },
          {
            id: 'inner',
            type: 'group',
            visible: true,
            transform: { x: 30, y: 40, width: 20, height: 10, rotation: 90 },
            children: ['outside'],
          },
          {
            id: 'outer',
            type: 'group',
            visible: true,
            transform: { ...transform, rotation: 30 },
            children: ['inner'],
          },
        ],
        ['outer'],
      ),
    );

    expect(container.querySelector('[data-node-id="outer"]')).toHaveAttribute(
      'transform',
      'translate(10 20) rotate(30 60 30)',
    );
    expect(
      container.querySelector('[data-node-id="outer"] > [data-node-id="inner"]'),
    ).toHaveAttribute('transform', 'translate(30 40) rotate(90 10 5)');
    expect(
      container.querySelector('[data-node-id="inner"] > [data-node-id="outside"]'),
    ).toHaveAttribute('transform', 'translate(500 -100) rotate(-45 120 60)');
    expect(container.querySelector('clipPath, [clip-path], svg svg')).toBeNull();
    expect(container.innerHTML).not.toContain('scale(');
  });

  it('隐藏父组合时不创建整棵子树，子元素 visible=true 也无法覆盖', () => {
    const { container } = renderScene(
      scene(
        [
          rectangle('child'),
          { id: 'hidden', type: 'group', visible: false, transform, children: ['child'] },
          rectangle('shown'),
        ],
        ['hidden', 'shown'],
      ),
    );

    expect(container.querySelector('[data-node-id="hidden"]')).toBeNull();
    expect(container.querySelector('[data-node-id="child"]')).toBeNull();
    expect(container.querySelector('[data-node-id="shown"]')).toBeInTheDocument();
  });

  it('隐藏原子元素也不参与绘制', () => {
    const { container } = renderScene(scene([{ ...rectangle('hidden'), visible: false }]));

    expect(container.querySelector('[data-node-id]')).toBeNull();
  });

  it('中文、emoji、换行和标签片段仅作为文字，不生成可执行标签', () => {
    const text = '中文 👩🏽‍💻\n<img src="x" onerror="alert(1)"> & <script>坏脚本</script>';
    const { container } = renderScene(
      scene([{ id: 'text', type: 'text', componentVersion: 1, visible: true, transform, text }]),
    );
    const content = container.querySelector('foreignObject > div');

    expect(content?.textContent).toBe(text);
    expect(content?.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(container.querySelector('img, script')).toBeNull();
    expect(content).toHaveStyle({ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
  });

  it('文字使用自身尺寸作为布局和裁剪框，保留完整长文本交给浏览器折行', () => {
    const text = '长文字without-spaces🙂'.repeat(200);
    const document = scene([
      { id: 'long', type: 'text', componentVersion: 1, visible: true, transform, text },
    ]);
    const original = structuredClone(document);
    const { container } = renderScene(document);
    const frame = container.querySelector('foreignObject');

    expect(frame).toHaveAttribute('width', '120');
    expect(frame).toHaveAttribute('height', '60');
    expect(frame).toHaveAttribute('overflow', 'hidden');
    expect(frame?.textContent).toBe(text);
    expect(frame?.firstElementChild).toHaveStyle({
      width: '100%',
      height: '100%',
      overflow: 'hidden',
    });
    expect(document).toEqual(original);
  });

  it('空组合保留透明命中框，空场景只绘制背景而不创建伪节点', () => {
    const { container, rerender } = renderScene(
      scene([{ id: 'empty', type: 'group', visible: true, transform, children: [] }]),
    );
    const frame = container.querySelector('[data-node-id="empty"] > rect');

    expect(frame).toHaveAttribute('fill', 'transparent');
    expect(frame).toHaveAttribute('pointer-events', 'all');
    expect(frame).toHaveAttribute('width', '120');
    expect(frame).toHaveAttribute('height', '60');

    rerender(
      <svg>
        <SceneView document={scene([])} />
      </svg>,
    );
    expect(container.querySelector('svg')?.children).toHaveLength(1);
    expect(container.querySelector('svg')?.firstElementChild).toHaveAttribute(
      'data-scene-background',
    );
    expect(container.querySelector('[data-node-id]')).toBeNull();
  });

  it('公开注册表替代实际矩形绘制，嵌套顺序、旋转与隐藏语义仍由场景掌管', () => {
    const registry = createSceneComponentRegistry([
      {
        ...sceneComponents.resolve('rectangle', 1),
        render: (node: RectangleNode) => (
          <circle data-registered-node={node.id} r={node.transform.width / 2} />
        ),
      },
    ]);
    const document = scene(
      [
        rectangle('front'),
        rectangle('back'),
        { ...rectangle('hidden'), visible: false },
        {
          id: 'group',
          type: 'group',
          visible: true,
          transform: { ...transform, rotation: 90 },
          children: ['back', 'hidden', 'front'],
        },
      ],
      ['group'],
    );
    const { container } = render(
      <svg>
        <SceneView document={document} registry={registry} />
      </svg>,
    );

    expect(
      Array.from(container.querySelectorAll('circle'), (element) =>
        element.getAttribute('data-registered-node'),
      ),
    ).toEqual(['back', 'front']);
    expect(container.querySelector('[data-node-id="group"]')).toHaveAttribute(
      'transform',
      'translate(10 20) rotate(90 60 30)',
    );
    expect(container.querySelector('[data-node-id="back"]')).toHaveAttribute(
      'transform',
      'translate(10 20) rotate(0 60 30)',
    );
    expect(container.querySelectorAll('rect:not([data-scene-background])')).toHaveLength(1);
    expect(container.querySelector('rect:not([data-scene-background])')).toHaveAttribute(
      'data-group-frame',
    );
    expect(container.querySelector('[data-node-id="hidden"]')).toBeNull();
    expect(container.querySelector('clipPath, [clip-path], svg svg')).toBeNull();
  });

  it('自定义注册回调可以组合内置绘制，仍处于当前场景主题上下文内', () => {
    const registry = createSceneComponentRegistry([
      {
        ...sceneComponents.resolve('rectangle', 1),
        render: (node: RectangleNode) => (
          <g>{sceneComponents.resolve('rectangle', 1).render(node)}</g>
        ),
      },
    ]);
    const document: SceneDocument = {
      ...scene([rectangle('custom')]),
      theme: { id: 'deep-blue', version: 1 },
    };
    const { container } = render(
      <svg>
        <SceneView document={document} registry={registry} />
      </svg>,
    );
    const theme = resolveSceneTheme({ id: 'deep-blue', version: 1 });
    expect(container.querySelector('[data-node-id="custom"] rect')).toHaveAttribute(
      'fill',
      theme.tokens.rectangleFill,
    );
  });

  it('登记绘制返回独立有生命周期的组件，隐藏、卸载与StrictMode对称释放资源', () => {
    const resources = new Set<symbol>();
    const acquire = vi.fn((resource: symbol) => {
      resources.add(resource);
    });
    const release = vi.fn((resource: symbol) => {
      resources.delete(resource);
    });
    const registry = createSceneComponentRegistry([
      {
        ...sceneComponents.resolve('rectangle', 1),
        render: (node: RectangleNode) => (
          <ResourceRectangle node={node} acquire={acquire} release={release} />
        ),
      },
    ]);
    const document = scene(
      [
        { id: 'group', type: 'group', visible: true, transform, children: ['child'] },
        rectangle('child'),
      ],
      ['group'],
    );
    const view = (current: SceneDocument) => (
      <StrictMode>
        <svg>
          <SceneView document={current} registry={registry} />
        </svg>
      </StrictMode>
    );
    const { container, rerender, unmount } = render(view(document));

    expect(container.querySelector('ellipse')).toBeInTheDocument();
    expect(resources.size).toBe(1);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(1);
    rerender(
      view({
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === 'group' ? { ...node, visible: false } : node,
        ),
      }),
    );
    expect(container.querySelector('ellipse')).toBeNull();
    expect(resources.size).toBe(0);
    expect(release).toHaveBeenCalledTimes(acquire.mock.calls.length);
    rerender(view(document));
    expect(resources.size).toBe(1);
    unmount();
    expect(resources.size).toBe(0);
    expect(release).toHaveBeenCalledTimes(acquire.mock.calls.length);
  });
});
