import { createEmptyScene, type SceneDocument, type SceneNode } from '@neobo/scene';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SceneView } from './SceneView';

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

describe('只读二维场景绘制结构', () => {
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

  it('空组合保留透明命中框，空场景不创建伪元素', () => {
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
    expect(container.querySelector('svg')?.children).toHaveLength(0);
  });
});
