import {
  SCENE_LIMITS,
  createEmptyScene,
  type BarChartNode,
  type SceneDocument,
} from '@neobo/scene';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Editor } from './Editor';
import { PropertiesPanel } from './PropertiesPanel';

// 编辑器只验证命令与草稿；实际 ECharts 尺寸和绘制由浏览器验收。
vi.mock('../scene/BarChartView', () => ({
  BarChartView: ({ node }: { readonly node: BarChartNode }) => (
    <g data-testid="bar-chart-render" data-chart-data={JSON.stringify(node.data)} />
  ),
}));

function chart(data: BarChartNode['data'] = []): BarChartNode {
  return {
    id: 'chart',
    type: 'bar-chart',
    componentVersion: 1,
    visible: true,
    transform: { x: 20, y: 30, width: 480, height: 320, rotation: 0 },
    data,
  };
}

function scene(data: BarChartNode['data'] = []): SceneDocument {
  return {
    ...createEmptyScene({ id: 'chart-editor', width: 960, height: 540 }),
    rootIds: ['chart'],
    nodes: [chart(data)],
  };
}

async function setRow(index: number, category: string, value: string) {
  const user = userEvent.setup();
  await user.clear(screen.getByRole('textbox', { name: `分类 ${index}` }));
  if (category) await user.type(screen.getByRole('textbox', { name: `分类 ${index}` }), category);
  await user.clear(screen.getByRole('textbox', { name: `数值 ${index}` }));
  if (value) await user.type(screen.getByRole('textbox', { name: `数值 ${index}` }), value);
}

describe('柱状图编辑命令', () => {
  it('创建空白柱状图，不预置业务数据，并从注册入口取得默认尺寸与名称', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.click(screen.getByRole('button', { name: '添加柱状图' }));
    expect(screen.getByRole('button', { name: '选择柱状图 bar-chart-1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('textbox', { name: '宽度' })).toHaveValue('480');
    expect(screen.getByRole('textbox', { name: '高度' })).toHaveValue('320');
    expect(screen.getByText('暂无数据')).toBeVisible();
    expect(screen.getByTestId('bar-chart-render')).toHaveAttribute('data-chart-data', '[]');
    expect(screen.getByText('修订 1')).toBeVisible();
  });

  it('分类/数值草稿不污染画布；一次应用全部数据并可一次撤销重做', async () => {
    const user = userEvent.setup();
    render(<Editor initialDocument={scene()} />);
    await user.click(screen.getByRole('button', { name: '选择柱状图 chart' }));
    await user.click(screen.getByRole('button', { name: '添加数据' }));
    expect(screen.getByRole('textbox', { name: '分类 1' })).toHaveFocus();
    await setRow(1, ' 甲 ', '-5');
    await user.click(screen.getByRole('button', { name: '添加数据' }));
    await setRow(2, '乙', '0');
    expect(screen.getByTestId('bar-chart-render')).toHaveAttribute('data-chart-data', '[]');
    expect(screen.getByText('修订 0')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(screen.getByTestId('bar-chart-render')).toHaveAttribute(
      'data-chart-data',
      JSON.stringify([
        { category: ' 甲 ', value: -5 },
        { category: '乙', value: 0 },
      ]),
    );
    expect(screen.getByText('修订 1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByText('暂无数据')).toBeVisible();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getByRole('textbox', { name: '分类 1' })).toHaveValue(' 甲 ');
    expect(screen.getByRole('textbox', { name: '数值 1' })).toHaveValue('-5');
    expect(screen.getByText('修订 3')).toBeVisible();
  });

  it.each([
    [' ', '1', '分类不能为空'],
    ['甲', '', '需要填写有限数字'],
    ['甲', 'Infinity', '需要填写有限数字'],
    ['甲', 'NaN', '需要填写有限数字'],
    ['甲', '1000000000001', '数值超出范围'],
    ['甲'.repeat(101), '1', '分类过长'],
  ])('拒绝无效数据分类“%s”数值“%s”，不消耗修订号', async (category, value, error) => {
    const user = userEvent.setup();
    render(<Editor initialDocument={scene()} />);
    await user.click(screen.getByRole('button', { name: '选择柱状图 chart' }));
    await user.click(screen.getByRole('button', { name: '添加数据' }));
    fireEvent.change(screen.getByRole('textbox', { name: '分类 1' }), {
      target: { value: category },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '数值 1' }), { target: { value } });
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(screen.getByRole('alert')).toHaveTextContent(error);
    expect(screen.getByTestId('bar-chart-render')).toHaveAttribute('data-chart-data', '[]');
    expect(screen.getByText('修订 0')).toBeVisible();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });

  it('同值数字不新增历史，删除中间行不使其他受控输入错位并保持焦点', async () => {
    const user = userEvent.setup();
    const initial = [
      { category: '甲', value: 1 },
      { category: '乙', value: 2 },
      { category: '丙', value: 3 },
    ];
    render(<Editor initialDocument={scene(initial)} />);
    await user.click(screen.getByRole('button', { name: '选择柱状图 chart' }));
    fireEvent.change(screen.getByRole('textbox', { name: '数值 1' }), { target: { value: '1.0' } });
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(screen.getByText('修订 0')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '删除数据行 2' }));
    expect(screen.getByRole('textbox', { name: '分类 2' })).toHaveValue('丙');
    expect(screen.getByRole('textbox', { name: '数值 2' })).toHaveValue('3');
    expect(screen.getByRole('textbox', { name: '分类 2' })).toHaveFocus();
    expect(screen.getByTestId('bar-chart-render')).toHaveAttribute(
      'data-chart-data',
      JSON.stringify(initial),
    );
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(screen.getByTestId('bar-chart-render')).toHaveAttribute(
      'data-chart-data',
      JSON.stringify([initial[0], initial[2]]),
    );
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('textbox', { name: '分类 2' })).toHaveValue('乙');
  });

  it('可删除全部数据并整体撤销，最后一行删除后聚焦添加按钮', async () => {
    const user = userEvent.setup();
    render(<Editor initialDocument={scene([{ category: '甲', value: 1 }])} />);
    await user.click(screen.getByRole('button', { name: '选择柱状图 chart' }));
    await user.click(screen.getByRole('button', { name: '删除数据行 1' }));
    expect(screen.getByRole('button', { name: '添加数据' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(screen.getByTestId('bar-chart-render')).toHaveAttribute('data-chart-data', '[]');
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('textbox', { name: '分类 1' })).toHaveValue('甲');
  });

  it('数据数量达到上限不能再添加，禁用属性时不能编辑数据', () => {
    const data = Array.from({ length: SCENE_LIMITS.maxChartDataPoints }, (_, index) => ({
      category: `分类${index}`,
      value: index,
    }));
    const { rerender } = render(
      <PropertiesPanel node={chart(data)} disabled={false} onApply={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: '添加数据' })).toBeDisabled();
    rerender(<PropertiesPanel node={chart(data)} disabled onApply={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '分类 1' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '数值 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除数据行 1' })).toBeDisabled();
  });

  it('菜单删除图表可一步恢复数据，显隐和组合仍使用统一历史', async () => {
    const user = userEvent.setup();
    const initial = [{ category: '甲', value: -8 }];
    render(<Editor initialDocument={scene(initial)} />);
    const layer = screen.getByRole('button', { name: '选择柱状图 chart' });
    await user.click(layer);
    fireEvent.contextMenu(layer, { clientX: 100, clientY: 100 });
    const menu = within(await screen.findByRole('menu'));
    await user.click(menu.getByRole('menuitem', { name: '删除' }));
    expect(screen.queryByTestId('bar-chart-render')).not.toBeInTheDocument();
    expect(screen.getByText('修订 1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByTestId('bar-chart-render')).toHaveAttribute(
      'data-chart-data',
      JSON.stringify(initial),
    );
    await user.click(screen.getByRole('button', { name: '选择柱状图 chart' }));
    await user.click(screen.getByRole('button', { name: '隐藏 chart' }));
    expect(screen.queryByTestId('bar-chart-render')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    await user.click(screen.getByRole('button', { name: '添加矩形' }));
    fireEvent.click(screen.getByRole('button', { name: '选择柱状图 chart' }), { shiftKey: true });
    await user.click(screen.getByRole('button', { name: '组合' }));
    expect(screen.getByRole('button', { name: '选择组合 group-1' })).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart-render')).toHaveAttribute(
      'data-chart-data',
      JSON.stringify(initial),
    );
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('button', { name: '选择柱状图 chart' })).toBeInTheDocument();
  });
});
