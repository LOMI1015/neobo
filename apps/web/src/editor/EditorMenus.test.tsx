import { createEmptyScene, type SceneDocument, type SceneNode } from '@neobo/scene';
import * as sceneCore from '@neobo/scene';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './Editor';

function rectangle(id: string): SceneNode {
  return {
    id,
    type: 'rectangle',
    componentVersion: 1,
    visible: true,
    transform: { x: 20, y: 30, width: 120, height: 80, rotation: 0 },
  };
}

function scene(nodes: readonly SceneNode[], rootIds = nodes.map((node) => node.id)): SceneDocument {
  return { ...createEmptyScene({ id: 'menu-test', width: 960, height: 540 }), nodes, rootIds };
}

function nodeElement(id: string): Element {
  const element = document.querySelector(`svg.editor-canvas g[data-node-id="${id}"]`);
  if (!element) throw new Error('测试节点尚未绘制。');
  return element;
}

async function openContext(target: Element) {
  fireEvent.contextMenu(target, { clientX: 120, clientY: 140 });
  return within(await screen.findByRole('menu'));
}

function layer(id: string) {
  return screen.getByRole('button', { name: `选择矩形 ${id}`, hidden: true });
}

function installPointerFixture() {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId = 1;
    readonly isPrimary = true;
  }
  class TestPoint {
    constructor(
      readonly x: number,
      readonly y: number,
    ) {}
    matrixTransform() {
      return { x: this.x, y: this.y };
    }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('DOMPoint', TestPoint);
  const captured = new Set<number>();
  const canvas = screen.getByRole('img', { name: '场景画布' });
  const capture = vi.fn((id: number) => captured.add(id));
  Object.defineProperties(canvas, {
    getScreenCTM: { value: () => ({ inverse: () => ({}) }) },
    setPointerCapture: { value: capture },
    hasPointerCapture: { value: (id: number) => captured.has(id) },
    releasePointerCapture: { value: (id: number) => captured.delete(id) },
  });
  return { canvas, capture, captured };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('编辑器上下文菜单与可见操作入口', () => {
  it('右键未选节点切换到该对象，删除只作用于新选区且一次撤销恢复', async () => {
    const user = userEvent.setup();
    render(<Editor initialDocument={scene([rectangle('a'), rectangle('b')])} />);
    await user.click(layer('a'));
    const menu = await openContext(nodeElement('b'));
    expect(layer('a')).toHaveAttribute('aria-pressed', 'false');
    expect(layer('b')).toHaveAttribute('aria-pressed', 'true');
    expect(menu.getByText('当前已选 1 项')).toBeVisible();
    expect(screen.getByText('修订 0')).toBeVisible();

    await user.click(menu.getByRole('menuitem', { name: '删除' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(layer('a')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '选择矩形 b' })).not.toBeInTheDocument();
    expect(screen.getByText('修订 1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(layer('b')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });

  it('命中已选节点保留非连续多选，菜单组合和拆组沿用一步历史', async () => {
    const user = userEvent.setup();
    render(<Editor initialDocument={scene([rectangle('a'), rectangle('b'), rectangle('c')])} />);
    await user.click(layer('a'));
    fireEvent.click(layer('c'), { shiftKey: true });
    let menu = await openContext(nodeElement('a'));
    expect(menu.getByText('当前已选 2 项')).toBeVisible();
    await user.click(menu.getByRole('menuitem', { name: '组合' }));
    expect(nodeElement('group-1').querySelectorAll(':scope > g')).toHaveLength(2);
    expect(screen.getByText('修订 1')).toBeVisible();

    menu = await openContext(nodeElement('a'));
    expect(screen.getByRole('button', { name: '选择组合 group-1', hidden: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(layer('a')).toHaveAttribute('aria-pressed', 'false');
    await user.click(menu.getByRole('menuitem', { name: '拆组' }));
    expect(screen.queryByRole('button', { name: '选择组合 group-1' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(nodeElement('group-1').querySelectorAll(':scope > g')).toHaveLength(2);
  });

  it('右键所选组合的后代保留组合和其他选择，删除一次恢复整棵树', async () => {
    const user = userEvent.setup();
    render(
      <Editor
        initialDocument={scene(
          [
            {
              id: 'g',
              type: 'group',
              visible: true,
              transform: rectangle('g').transform,
              children: ['child'],
            },
            rectangle('child'),
            rectangle('b'),
          ],
          ['g', 'b'],
        )}
      />,
    );
    await user.click(screen.getByRole('button', { name: '选择组合 g' }));
    fireEvent.click(layer('b'), { shiftKey: true });
    const menu = await openContext(nodeElement('child'));
    expect(menu.getByText('当前已选 2 项')).toBeVisible();
    expect(layer('child')).toHaveAttribute('aria-pressed', 'false');
    await user.click(menu.getByRole('menuitem', { name: '删除' }));
    expect(screen.getByText('还没有元素')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(nodeElement('g').querySelector('[data-node-id="child"]')).toBeInTheDocument();
    expect(layer('b')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });

  it('空白右键保留选区并明确数量，Escape取消不推进修订或历史', async () => {
    const user = userEvent.setup();
    render(<Editor initialDocument={scene([rectangle('a'), rectangle('b')])} />);
    await user.click(layer('a'));
    fireEvent.click(layer('b'), { shiftKey: true });
    const menu = await openContext(screen.getByRole('img', { name: '场景画布' }));
    expect(menu.getByText('当前已选 2 项')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(layer('a')).toHaveAttribute('aria-pressed', 'true');
    expect(layer('b')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('修订 0')).toBeVisible();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });

  it('空选区禁用元素动作和空历史，菜单仍可关闭', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const menu = await openContext(screen.getByRole('img', { name: '场景画布' }));
    expect(menu.getByText('当前已选 0 项')).toBeVisible();
    for (const item of menu.getAllByRole('menuitem'))
      expect(item).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('隐藏后从图层右键显示，显隐和撤销重做使用同一历史入口', async () => {
    const user = userEvent.setup();
    render(<Editor initialDocument={scene([rectangle('a')])} />);
    let menu = await openContext(nodeElement('a'));
    await user.click(menu.getByRole('menuitem', { name: '隐藏' }));
    expect(
      screen.getByRole('img', { name: '场景画布' }).querySelector('[data-node-id="a"]'),
    ).toBeNull();
    menu = await openContext(layer('a'));
    await user.click(menu.getByRole('menuitem', { name: '显示' }));
    expect(nodeElement('a')).toBeInTheDocument();
    menu = await openContext(nodeElement('a'));
    await user.click(menu.getByRole('menuitem', { name: '撤销' }));
    expect(
      screen.getByRole('img', { name: '场景画布' }).querySelector('[data-node-id="a"]'),
    ).toBeNull();
    menu = await openContext(layer('a'));
    await user.click(menu.getByRole('menuitem', { name: '重做' }));
    expect(nodeElement('a')).toBeInTheDocument();
  });

  it('更多操作支持键盘进入与Escape返回焦点，和右键使用相同动作', async () => {
    const user = userEvent.setup();
    render(<Editor initialDocument={scene([rectangle('a')])} />);
    await user.click(layer('a'));
    const trigger = screen.getByRole('button', { name: '更多操作' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = within(await screen.findByRole('menu', { name: '更多操作' }));
    await waitFor(() => expect(menu.getByRole('menuitem', { name: '隐藏' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByText('修订 0')).toBeVisible();
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: '删除' }));
    expect(screen.getByText('还没有元素')).toBeVisible();
  });

  it('视图隐藏关闭Portal与焦点锁，重新显示不恢复旧菜单', async () => {
    const { rerender } = render(<Editor initialDocument={scene([rectangle('a')])} />);
    await openContext(nodeElement('a'));
    rerender(<Editor initialDocument={scene([rectangle('a')])} active={false} />);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(document.body.style.pointerEvents).not.toBe('none');
    rerender(<Editor initialDocument={scene([rectangle('a')])} active />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByText('修订 0')).toBeVisible();
  });

  it('拖动期间拒绝右键菜单，打开菜单期间不启动新的捕获', async () => {
    const user = userEvent.setup();
    render(<Editor initialDocument={scene([rectangle('a')])} />);
    const fixture = installPointerFixture();
    fireEvent.pointerDown(nodeElement('a'), { button: 0, clientX: 20, clientY: 30 });
    fireEvent.contextMenu(nodeElement('a'), { clientX: 100, clientY: 100 });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(fixture.captured.size).toBe(1);
    fireEvent.pointerCancel(fixture.canvas);
    await openContext(nodeElement('a'));
    fireEvent.pointerDown(nodeElement('a'), { button: 0, clientX: 20, clientY: 30 });
    expect(fixture.capture).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(screen.getByText('修订 0')).toBeVisible();
    expect(fixture.captured.size).toBe(0);
  });

  it('菜单动作遇到修订冲突不覆盖更新，同步后关闭过时菜单并可继续操作', async () => {
    const user = userEvent.setup();
    const initial = scene([rectangle('a')]);
    const history = sceneCore.createSceneHistory(initial);
    vi.spyOn(sceneCore, 'createSceneHistory').mockReturnValue(history);
    render(<Editor initialDocument={initial} />);
    const menu = await openContext(nodeElement('a'));
    history.execute({
      sceneId: initial.id,
      baseRevision: 0,
      operations: [{ type: 'node.update', nodeId: 'a', changes: { transform: { x: 200 } } }],
    });
    await user.click(menu.getByRole('menuitem', { name: '删除' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('场景已被更新，本次操作未应用');
    expect(history.current().nodes[0]?.transform.x).toBe(200);
    expect(screen.getByText('修订 1')).toBeVisible();
    expect(document.body.style.pointerEvents).not.toBe('none');
    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.getByText('还没有元素')).toBeVisible();
    expect(screen.getByText('修订 2')).toBeVisible();
  });

  it('卸载打开菜单的编辑器时移除Portal并释放页面交互锁', async () => {
    const { unmount } = render(<Editor initialDocument={scene([rectangle('a')])} />);
    await openContext(nodeElement('a'));
    expect(document.body.style.pointerEvents).toBe('none');
    unmount();
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
