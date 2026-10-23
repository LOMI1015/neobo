import type * as PlayerModule from '@neobo/player';
import { createEmptyScene, type BarChartNode, type SceneDocument } from '@neobo/scene';
import * as sceneCore from '@neobo/scene';
import { DEFAULT_SCENE_THEME, resolveSceneTheme } from '@neobo/theme';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { Editor } from './Editor';

// 属性行为只消费公开绘制接口，真实图表配色由播放器和浏览器验收。
vi.mock('@neobo/player', async (importOriginal) => {
  const player = await importOriginal<typeof PlayerModule>();
  const registry = player.createSceneComponentRegistry([
    player.sceneComponents.resolve('text', 1),
    player.sceneComponents.resolve('rectangle', 1),
    { ...player.sceneComponents.resolve('bar-chart', 1), render: () => <g /> },
  ]);
  return {
    ...player,
    SceneView: (props: PlayerModule.SceneViewProps) => (
      <player.SceneView {...props} registry={registry} />
    ),
  };
});

type User = ReturnType<typeof userEvent.setup>;
type MenuSource = 'actions' | 'canvas' | 'layers';

async function openThemes(user: User, source: MenuSource = 'actions') {
  if (source === 'actions') {
    await user.click(screen.getByRole('button', { name: '更多操作' }));
  } else {
    const target =
      source === 'canvas'
        ? screen.getByRole('img', { name: '场景画布' })
        : screen.getByRole('complementary', { name: '图层' });
    fireEvent.contextMenu(target, { clientX: 80, clientY: 100 });
  }
  const trigger = await screen.findByRole('menuitem', { name: '场景主题' });
  trigger.focus();
  await user.keyboard('{ArrowRight}');
  return within(await screen.findByRole('menu', { name: '场景主题' }));
}

async function chooseTheme(user: User, label: string, source: MenuSource = 'actions') {
  const menu = await openThemes(user, source);
  await user.click(menu.getByRole('menuitemradio', { name: label }));
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
}

function background(canvas: HTMLElement) {
  const element = canvas.querySelector('[data-scene-background]');
  if (!element) throw new Error('测试画布背景尚未绘制。');
  return element;
}

afterEach(() => vi.restoreAllMocks());

describe('场景主题菜单与编辑历史', () => {
  it.each(['actions', 'canvas', 'layers'] satisfies readonly MenuSource[])(
    '%s入口可在空场景切换主题，一次撤销重做保持一致',
    async (source) => {
      const user = userEvent.setup();
      render(<Editor />);
      let menu = await openThemes(user, source);
      expect(menu.getByRole('menuitemradio', { name: '中性浅色' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      expect(menu.getByRole('menuitemradio', { name: '深色蓝' })).toHaveAttribute(
        'aria-checked',
        'false',
      );
      await user.click(menu.getByRole('menuitemradio', { name: '深色蓝' }));
      expect(screen.getByText('修订 1')).toBeVisible();
      expect(screen.getByText('还没有元素')).toBeVisible();
      const canvas = screen.getByRole('img', { name: '场景画布' });
      expect(background(canvas)).toHaveAttribute(
        'fill',
        resolveSceneTheme({ id: 'deep-blue', version: 1 }).tokens.canvasBackground,
      );
      menu = await openThemes(user, source);
      expect(menu.getByRole('menuitemradio', { name: '深色蓝' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await user.keyboard('{Escape}{Escape}');
      await user.click(screen.getByRole('button', { name: '撤销' }));
      expect(background(canvas)).toHaveAttribute(
        'fill',
        DEFAULT_SCENE_THEME.tokens.canvasBackground,
      );
      expect(screen.getByText('修订 2')).toBeVisible();
      await user.click(screen.getByRole('button', { name: '重做' }));
      expect(background(canvas)).toHaveAttribute(
        'fill',
        resolveSceneTheme({ id: 'deep-blue', version: 1 }).tokens.canvasBackground,
      );
      expect(screen.getByText('修订 3')).toBeVisible();
    },
  );

  it('点选当前有效主题不提交，旧文档不补主题字段，也不清空重做', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn<(document: SceneDocument) => void>();
    render(<Editor onPreview={onPreview} />);
    await chooseTheme(user, '中性浅色');
    expect(screen.getByText('修订 0')).toBeVisible();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    await chooseTheme(user, '深色蓝');
    await user.click(screen.getByRole('button', { name: '撤销' }));
    await chooseTheme(user, '中性浅色');
    expect(screen.getByText('修订 2')).toBeVisible();
    expect(screen.getByRole('button', { name: '重做' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '预览' }));
    expect(onPreview.mock.calls[0]?.[0]).not.toHaveProperty('theme');
    await user.click(screen.getByRole('button', { name: '重做' }));
    await chooseTheme(user, '深色蓝');
    expect(screen.getByText('修订 3')).toBeVisible();
  });

  it('纯键盘进入主题子菜单并选择，菜单关闭后焦点回到可见入口', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const entry = screen.getByRole('button', { name: '更多操作' });
    entry.focus();
    await user.keyboard('{Enter}');
    const trigger = await screen.findByRole('menuitem', { name: '场景主题' });
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.keyboard('{ArrowRight}');
    const neutral = await screen.findByRole('menuitemradio', { name: '中性浅色' });
    await waitFor(() => expect(neutral).toHaveFocus());
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(entry).toHaveFocus();
    expect(screen.getByText('修订 1')).toBeVisible();
    expect(background(screen.getByRole('img', { name: '场景画布' }))).toHaveAttribute(
      'fill',
      resolveSceneTheme({ id: 'deep-blue', version: 1 }).tokens.canvasBackground,
    );
  });

  it('主题及其撤销重做保留选区和全部属性草稿，真实节点提交和撤销仍刷新', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.click(screen.getByRole('button', { name: '添加文字' }));
    const text = screen.getByRole('textbox', { name: '文字内容' });
    fireEvent.change(text, { target: { value: '未提交文字' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'X 坐标' }), {
      target: { value: '99' },
    });
    await user.click(screen.getByRole('checkbox', { name: '显示元素' }));
    await chooseTheme(user, '深色蓝');
    await user.click(screen.getByRole('button', { name: '撤销' }));
    await user.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getByRole('textbox', { name: '文字内容' })).toBe(text);
    expect(text).toHaveValue('未提交文字');
    expect(screen.getByRole('textbox', { name: 'X 坐标' })).toHaveValue('99');
    expect(screen.getByRole('checkbox', { name: '显示元素' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: '选择文字 text-1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(screen.getByRole('textbox', { name: '文字内容' })).not.toBe(text);
    expect(screen.getByText('修订 5')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('textbox', { name: '文字内容' })).toHaveValue('文字');
    expect(screen.getByRole('checkbox', { name: '显示元素' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'X 坐标' })).toHaveValue('800');
    await user.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getByRole('textbox', { name: '文字内容' })).toHaveValue('未提交文字');
  });

  it('主题更新保留图表增删行和无效数字草稿，重新选择仍重置草稿', async () => {
    const user = userEvent.setup();
    const chart: BarChartNode = {
      id: 'chart',
      type: 'bar-chart',
      componentVersion: 1,
      visible: true,
      transform: { x: 0, y: 0, width: 480, height: 320, rotation: 0 },
      data: [{ category: '已提交', value: 1 }],
    };
    render(
      <Editor
        initialDocument={{
          ...createEmptyScene({ id: 'chart-theme', width: 960, height: 540 }),
          nodes: [chart],
          rootIds: ['chart'],
        }}
      />,
    );
    await user.click(screen.getByRole('button', { name: '选择柱状图 chart' }));
    await user.click(screen.getByRole('button', { name: '删除数据行 1' }));
    await user.click(screen.getByRole('button', { name: '添加数据' }));
    fireEvent.change(screen.getByRole('textbox', { name: '分类 1' }), {
      target: { value: '未提交' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '数值 1' }), { target: { value: 'NaN' } });
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    await chooseTheme(user, '深色蓝');
    await user.click(screen.getByRole('button', { name: '撤销' }));
    await user.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getByRole('textbox', { name: '分类 1' })).toHaveValue('未提交');
    expect(screen.getByRole('textbox', { name: '数值 1' })).toHaveValue('NaN');
    expect(screen.getByRole('alert')).toHaveTextContent('需要填写有限数字');
    fireEvent.click(screen.getByRole('button', { name: '选择柱状图 chart' }), { shiftKey: true });
    await user.click(screen.getByRole('button', { name: '选择柱状图 chart' }));
    expect(screen.getByRole('textbox', { name: '分类 1' })).toHaveValue('已提交');
    expect(screen.getByRole('textbox', { name: '数值 1' })).toHaveValue('1');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('冲突不覆盖外部节点更新，同步后主题操作可以继续', async () => {
    const user = userEvent.setup();
    const initial = createEmptyScene({ id: 'theme-conflict', width: 960, height: 540 });
    const history = sceneCore.createSceneHistory(initial);
    vi.spyOn(sceneCore, 'createSceneHistory').mockReturnValue(history);
    render(<Editor initialDocument={initial} />);
    const menu = await openThemes(user);
    const external = history.execute({
      sceneId: initial.id,
      baseRevision: 0,
      operations: [
        {
          type: 'node.add',
          node: {
            id: 'external',
            type: 'rectangle',
            componentVersion: 1,
            visible: true,
            transform: { x: 25, y: 40, width: 100, height: 80, rotation: 0 },
          },
          parentId: null,
          index: 0,
        },
      ],
    });
    expect(external.success).toBe(true);
    await user.click(menu.getByRole('menuitemradio', { name: '深色蓝' }));
    expect(screen.getByRole('alert')).toHaveTextContent('场景已被更新，本次操作未应用');
    expect(history.current().theme).toBeUndefined();
    expect(history.current().revision).toBe(1);
    await chooseTheme(user, '深色蓝');
    expect(history.current().nodes).toEqual(external.success ? external.document.nodes : []);
    expect(history.current().theme).toEqual({ id: 'deep-blue', version: 1 });
    expect(screen.getByText('修订 2')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('提交态主题在编辑与预览一致，返回仍保留未应用草稿且不改应用全局主题', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '添加文字' }));
    const draft = screen.getByRole('textbox', { name: '文字内容' });
    fireEvent.change(draft, { target: { value: '未应用' } });
    await chooseTheme(user, '深色蓝');
    const tokens = resolveSceneTheme({ id: 'deep-blue', version: 1 }).tokens;
    const editorCanvas = screen.getByRole('img', { name: '场景画布' });
    expect(background(editorCanvas)).toHaveAttribute('fill', tokens.canvasBackground);
    expect(editorCanvas.querySelector('[data-node-id="text-1"] div')).toHaveStyle({
      color: tokens.text,
    });
    await user.click(screen.getByRole('button', { name: '预览' }));
    const previewCanvas = screen.getByRole('img', { name: '场景预览画布' });
    expect(background(previewCanvas)).toHaveAttribute('fill', tokens.canvasBackground);
    expect(previewCanvas.querySelector('[data-node-id="text-1"] div')).toHaveStyle({
      color: tokens.text,
    });
    expect(previewCanvas).toHaveTextContent('文字');
    expect(previewCanvas).not.toHaveTextContent('未应用');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回编辑' }));
    expect(screen.getByRole('textbox', { name: '文字内容' })).toBe(draft);
    expect(draft).toHaveValue('未应用');
    expect(screen.getByText('修订 2')).toBeVisible();
  });
});
