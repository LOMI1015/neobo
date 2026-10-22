import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as sceneCore from '@neobo/scene';
import type { GroupNode, RectangleNode, SceneDocument, TextNode } from '@neobo/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './Editor';

function rectangle(id: string, x = 20): RectangleNode {
  return {
    id,
    type: 'rectangle',
    componentVersion: 1,
    visible: true,
    transform: { x, y: 30, width: 120, height: 80, rotation: 0 },
  };
}

function text(id: string): TextNode {
  return { ...rectangle(id), type: 'text', text: '初始文字' };
}

function document(
  nodes: SceneDocument['nodes'],
  rootIds = nodes.map((node) => node.id),
): SceneDocument {
  return {
    schemaVersion: 1,
    id: 'test-scene',
    revision: 0,
    canvas: { width: 960, height: 540 },
    nodes,
    rootIds,
  };
}

function group(id: string, children: string[]): GroupNode {
  return { id, type: 'group', visible: true, transform: rectangle(id).transform, children };
}

afterEach(() => vi.restoreAllMocks());

describe('二维编辑器命令交互', () => {
  it('初始为空白画布，明确当前会话不会保存且历史为空', () => {
    render(<Editor />);
    expect(screen.getByRole('img', { name: '场景画布' })).toHaveAttribute(
      'viewBox',
      '0 0 1920 1080',
    );
    expect(screen.getByText('仅当前会话，刷新后不会保存')).toBeVisible();
    expect(screen.getByText('还没有元素')).toBeVisible();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重做' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled();
  });

  it('添加文字和矩形经命令生成图层，一次添加是一步可重做历史', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.click(screen.getByRole('button', { name: '添加文字' }));
    expect(screen.getByLabelText('文字内容')).toHaveValue('文字');
    expect(screen.getByRole('button', { name: '选择文字 text-1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: '添加矩形' }));
    expect(screen.getByText('修订 2')).toBeVisible();
    expect(screen.getByRole('button', { name: '选择矩形 rectangle-1' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.queryByRole('button', { name: '选择矩形 rectangle-1' })).not.toBeInTheDocument();
    expect(screen.getByText('修订 3')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getByRole('button', { name: '选择矩形 rectangle-1' })).toBeVisible();
    expect(screen.getByText('修订 4')).toBeVisible();
  });

  it('属性草稿不会直接修改场景，应用文字和多个变换可整体撤销', async () => {
    const user = userEvent.setup();
    const { container } = render(<Editor initialDocument={document([text('t')])} />);
    await user.click(screen.getByRole('button', { name: '选择文字 t' }));
    await user.clear(screen.getByLabelText('X 坐标'));
    await user.type(screen.getByLabelText('X 坐标'), '64');
    await user.clear(screen.getByLabelText('文字内容'));
    await user.type(screen.getByLabelText('文字内容'), '更新文字');
    expect(container.querySelector('[data-node-id="t"]')).toHaveAttribute(
      'transform',
      'translate(20 30) rotate(0 60 40)',
    );
    expect(screen.getByText('修订 0')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(container.querySelector('[data-node-id="t"]')).toHaveAttribute(
      'transform',
      'translate(64 30) rotate(0 60 40)',
    );
    expect(screen.getByText('修订 1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByLabelText('X 坐标')).toHaveValue('20');
    expect(screen.getByLabelText('文字内容')).toHaveValue('初始文字');
  });

  it.each(['', 'Infinity', 'NaN'])('拒绝无效数字“%s”，不新增历史', async (value) => {
    const user = userEvent.setup();
    render(<Editor initialDocument={document([rectangle('r')])} />);
    await user.click(screen.getByRole('button', { name: '选择矩形 r' }));
    fireEvent.change(screen.getByLabelText('X 坐标'), { target: { value } });
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(screen.getByRole('alert')).toHaveTextContent('X 坐标需要填写有限数字');
    expect(screen.getByText('修订 0')).toBeVisible();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });

  it('拒绝零尺寸以及共享校验拒绝的越界数值，保留原场景', async () => {
    const user = userEvent.setup();
    const { container } = render(<Editor initialDocument={document([rectangle('r')])} />);
    await user.click(screen.getByRole('button', { name: '选择矩形 r' }));
    fireEvent.change(screen.getByLabelText('宽度'), { target: { value: '0' } });
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(screen.getByRole('alert')).toHaveTextContent('宽度和高度必须大于 0');
    fireEvent.change(screen.getByLabelText('宽度'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('X 坐标'), { target: { value: '1000001' } });
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(screen.getByRole('alert')).toHaveTextContent('操作未通过场景校验');
    expect(container.querySelector('[data-node-id="r"]')).toHaveAttribute(
      'transform',
      'translate(20 30) rotate(0 60 40)',
    );
    expect(screen.getByText('修订 0')).toBeVisible();
  });

  it('未修改属性时应用不消耗修订号', async () => {
    const user = userEvent.setup();
    render(<Editor initialDocument={document([rectangle('r')])} />);
    await user.click(screen.getByRole('button', { name: '选择矩形 r' }));
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(screen.getByText('修订 0')).toBeVisible();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });

  it('图层支持Shift多选和取消，非连续选择可组合到最上选中层并可整体撤销', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Editor
        initialDocument={document([rectangle('a'), rectangle('b', 200), rectangle('c', 400)])}
      />,
    );
    await user.click(screen.getByRole('button', { name: '选择矩形 a' }));
    fireEvent.click(screen.getByRole('button', { name: '选择矩形 c' }), { shiftKey: true });
    expect(screen.getByText('已选 2 项')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '组合' }));
    const canvas = screen.getByRole('img', { name: '场景画布' });
    expect(
      [...canvas.children]
        .filter((element) => element.hasAttribute('data-node-id'))
        .map((element) => element.getAttribute('data-node-id')),
    ).toEqual(['b', 'group-1']);
    expect(
      container.querySelector('[data-node-id="group-1"] [data-node-id="a"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-node-id="group-1"] [data-node-id="c"]'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择组合 group-1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.queryByRole('button', { name: '选择组合 group-1' })).not.toBeInTheDocument();
    expect(
      [...canvas.children]
        .filter((element) => element.hasAttribute('data-node-id'))
        .map((element) => element.getAttribute('data-node-id')),
    ).toEqual(['a', 'b', 'c']);
  });

  it('拆组是一步命令，保留子节点并可重新恢复整个组合', async () => {
    const user = userEvent.setup();
    const initial = document([group('g', ['a', 'b']), rectangle('a'), rectangle('b', 200)], ['g']);
    const { container } = render(<Editor initialDocument={initial} />);
    const before = sceneCore.getNodeWorldCorners(initial, 'a');
    await user.click(screen.getByRole('button', { name: '选择组合 g' }));
    await user.click(screen.getByRole('button', { name: '拆组' }));
    expect(container.querySelector('[data-node-id="g"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-node-id="a"]')).toHaveAttribute(
      'transform',
      `translate(${before?.[0].x} ${before?.[0].y}) rotate(0 60 40)`,
    );
    expect(screen.getByText('已选 2 项')).toBeVisible();
    expect(screen.getByText('修订 1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(container.querySelector('[data-node-id="g"] [data-node-id="a"]')).toBeInTheDocument();
  });

  it('隐藏组合的子节点仍可从图层选择、修改并撤销，隐藏父级仍不绘制', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Editor
        initialDocument={document(
          [{ ...group('g', ['a']), visible: false }, rectangle('a')],
          ['g'],
        )}
      />,
    );
    await user.click(screen.getByRole('button', { name: '选择矩形 a' }));
    expect(screen.getByLabelText('X 坐标')).toHaveValue('20');
    expect(container.querySelector('[data-node-id="a"]')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('X 坐标'), { target: { value: '77' } });
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(screen.getByLabelText('X 坐标')).toHaveValue('77');
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByLabelText('X 坐标')).toHaveValue('20');
    await user.click(screen.getByRole('button', { name: '显示 g' }));
    expect(container.querySelector('[data-node-id="a"]')).toBeInTheDocument();
  });

  it('删除组合和所选后代只提交一次，撤销整体恢复子树', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Editor initialDocument={document([group('g', ['a']), rectangle('a')], ['g'])} />,
    );
    await user.click(screen.getByRole('button', { name: '选择组合 g' }));
    fireEvent.click(screen.getByRole('button', { name: '选择矩形 a' }), { shiftKey: true });
    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.getByText('还没有元素')).toBeVisible();
    expect(screen.getByText('修订 1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(container.querySelector('[data-node-id="g"] [data-node-id="a"]')).toBeInTheDocument();
  });

  it('非法跨层级组合明确失败，原图层、修订和历史不变', async () => {
    const user = userEvent.setup();
    render(
      <Editor
        initialDocument={document([group('g', ['a']), rectangle('a'), rectangle('b')], ['g', 'b'])}
      />,
    );
    await user.click(screen.getByRole('button', { name: '选择矩形 a' }));
    fireEvent.click(screen.getByRole('button', { name: '选择矩形 b' }), { shiftKey: true });
    await user.click(screen.getByRole('button', { name: '组合' }));
    expect(screen.getByRole('alert')).toHaveTextContent('组合需要至少两个同级元素');
    expect(screen.getByText('修订 0')).toBeVisible();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });

  it('统一历史入口的修订冲突显示失败且不伪造成功图层', async () => {
    const user = userEvent.setup();
    const initial = sceneCore.createEmptyScene({ id: 'conflict', width: 960, height: 540 });
    const history = sceneCore.createSceneHistory(initial);
    vi.spyOn(sceneCore, 'createSceneHistory').mockReturnValue(history);
    render(<Editor initialDocument={initial} />);
    history.execute({
      sceneId: initial.id,
      baseRevision: 0,
      operations: [{ type: 'node.add', node: rectangle('external'), parentId: null, index: 0 }],
    });
    await user.click(screen.getByRole('button', { name: '添加矩形' }));
    expect(screen.getByRole('alert')).toHaveTextContent('场景已被更新，本次操作未应用');
    expect(screen.queryByRole('button', { name: '选择矩形 rectangle-1' })).not.toBeInTheDocument();
    expect(history.current().nodes.map((node) => node.id)).toEqual(['external']);
    expect(history.current().revision).toBe(1);
    expect(screen.getByText('修订 1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '添加矩形' }));
    expect(screen.getByRole('button', { name: '选择矩形 rectangle-1' })).toBeVisible();
    expect(history.current().revision).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('撤销遇到修订冲突同步最新状态，重试后可以继续撤销', async () => {
    const user = userEvent.setup();
    const initial = document([rectangle('r')]);
    const history = sceneCore.createSceneHistory(initial);
    vi.spyOn(sceneCore, 'createSceneHistory').mockReturnValue(history);
    render(<Editor initialDocument={initial} />);
    await user.click(screen.getByRole('button', { name: '添加矩形' }));
    history.execute({
      sceneId: initial.id,
      baseRevision: 1,
      operations: [{ type: 'node.update', nodeId: 'r', changes: { transform: { x: 200 } } }],
    });
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('alert')).toHaveTextContent('场景已被更新，本次操作未应用');
    expect(screen.getByText('修订 2')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByText('修订 3')).toBeVisible();
    expect(history.current().nodes.find((node) => node.id === 'r')?.transform.x).toBe(20);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('图层按钮可用键盘选择，输入文字不会被编辑器快捷键删除', async () => {
    const user = userEvent.setup();
    render(<Editor initialDocument={document([text('t')])} />);
    screen.getByRole('button', { name: '选择文字 t' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('文字内容')).toHaveValue('初始文字');
    await user.click(screen.getByLabelText('文字内容'));
    await user.keyboard('{Control>}a{/Control}{Backspace}');
    expect(screen.getByRole('button', { name: '选择文字 t' })).toBeInTheDocument();
    expect(screen.getByText('修订 0')).toBeVisible();
  });
});
