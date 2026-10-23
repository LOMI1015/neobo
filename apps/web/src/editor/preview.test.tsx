import type * as PlayerModule from '@neobo/player';
import { createEmptyScene, type SceneDocument } from '@neobo/scene';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { Editor } from './Editor';

const resources = vi.hoisted(() => ({ active: 0, maximum: 0, disposed: 0 }));

// 仅替换公开注册表的图表绘制，生命周期仍由 Editor / ScenePlayer 挂载边界驱动。
vi.mock('@neobo/player', async (importOriginal) => {
  const player = await importOriginal<typeof PlayerModule>();
  const { useEffect } = await import('react');
  function ChartProbe() {
    useEffect(() => {
      resources.active += 1;
      resources.maximum = Math.max(resources.maximum, resources.active);
      return () => {
        resources.active -= 1;
        resources.disposed += 1;
      };
    }, []);
    return <g data-testid="chart-resource" />;
  }
  const registry = player.createSceneComponentRegistry([
    player.sceneComponents.resolve('text', 1),
    player.sceneComponents.resolve('rectangle', 1),
    { ...player.sceneComponents.resolve('bar-chart', 1), render: () => <ChartProbe /> },
  ]);
  return {
    ...player,
    SceneView: (props: PlayerModule.SceneViewProps) => (
      <player.SceneView {...props} registry={registry} />
    ),
    ScenePlayer: (props: PlayerModule.ScenePlayerProps) => (
      <player.ScenePlayer {...props} registry={registry} />
    ),
  };
});

beforeEach(() => {
  resources.active = 0;
  resources.maximum = 0;
  resources.disposed = 0;
});

describe('提交态预览与绘制资源', () => {
  it('独立编辑器不提供未接入的预览入口', () => {
    render(<Editor />);
    expect(screen.queryByRole('button', { name: '预览' })).not.toBeInTheDocument();
  });

  it('回调取得独立的提交态副本，不能改写文档或新增历史', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn<(document: SceneDocument) => void>();
    render(<Editor onPreview={onPreview} />);
    await user.click(screen.getByRole('button', { name: '添加文字' }));
    await user.clear(screen.getByRole('textbox', { name: '文字内容' }));
    await user.type(screen.getByRole('textbox', { name: '文字内容' }), '草稿');
    await user.click(screen.getByRole('button', { name: '预览' }));
    const first = onPreview.mock.calls[0]?.[0];
    const firstNode = first?.nodes[0];
    if (!first || firstNode?.type !== 'text') throw new Error('测试预览节点缺失。');
    expect(first.revision).toBe(1);
    expect(firstNode.text).toBe('文字');
    Reflect.set(firstNode, 'text', '回调侧修改');
    Reflect.set(firstNode.transform, 'x', 0);
    await user.click(screen.getByRole('button', { name: '预览' }));
    const second = onPreview.mock.calls[1]?.[0];
    expect(second).not.toBe(first);
    expect(second?.nodes[0]).toMatchObject({ text: '文字', transform: { x: 800 } });
    expect(screen.getByRole('textbox', { name: '文字内容' })).toHaveValue('草稿');
    expect(screen.getByText('修订 1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.queryByRole('button', { name: '选择文字 text-1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });

  it('隐藏编辑器卸载图表绘制，重新显示仍保留属性草稿和选区', async () => {
    const user = userEvent.setup();
    const initialDocument: SceneDocument = {
      ...createEmptyScene({ id: 'preview-test', width: 960, height: 540 }),
      rootIds: ['chart'],
      nodes: [
        {
          id: 'chart',
          type: 'bar-chart',
          componentVersion: 1,
          visible: true,
          transform: { x: 0, y: 0, width: 480, height: 320, rotation: 0 },
          data: [{ category: '甲', value: 1 }],
        },
      ],
    };
    const { rerender, unmount } = render(<Editor initialDocument={initialDocument} />);
    await user.click(screen.getByRole('button', { name: '选择柱状图 chart' }));
    fireEvent.change(screen.getByRole('textbox', { name: '分类 1' }), {
      target: { value: '未提交分类' },
    });
    expect(resources.active).toBe(1);
    rerender(<Editor initialDocument={initialDocument} active={false} />);
    expect(screen.queryByTestId('chart-resource')).not.toBeInTheDocument();
    expect(resources.active).toBe(0);
    expect(resources.disposed).toBe(1);
    rerender(<Editor initialDocument={initialDocument} active />);
    expect(resources.active).toBe(1);
    expect(screen.getByRole('textbox', { name: '分类 1' })).toHaveValue('未提交分类');
    expect(screen.getByRole('button', { name: '选择柱状图 chart' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('修订 0')).toBeVisible();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    unmount();
    expect(resources.active).toBe(0);
    expect(resources.disposed).toBe(2);
  });

  it('预览与编辑切换只保留当前可见图表实例，退出后释放', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: '添加柱状图' }));
    expect(resources.active).toBe(1);
    await user.click(screen.getByRole('button', { name: '预览' }));
    expect(resources.active).toBe(1);
    expect(resources.disposed).toBe(1);
    expect(screen.getAllByTestId('chart-resource')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '返回编辑' }));
    expect(resources.active).toBe(1);
    expect(resources.disposed).toBe(2);
    expect(resources.maximum).toBe(1);
    expect(screen.getByText('修订 1')).toBeVisible();
    unmount();
    expect(resources.active).toBe(0);
    expect(resources.disposed).toBe(3);
  });
});
