import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BarChartNode, GroupNode, TextNode } from '@neobo/scene';
import { describe, expect, it, vi } from 'vitest';
import { PropertiesPanel } from './PropertiesPanel';

const textNode: TextNode = {
  id: 'text-1',
  type: 'text',
  componentVersion: 1,
  visible: true,
  text: '文字',
  transform: { x: 10, y: 20, width: 320, height: 72, rotation: 0 },
};

describe('公共属性控件', () => {
  it('可访问复选框只修改草稿，应用时提交布尔可见性', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<PropertiesPanel node={textNode} disabled={false} onApply={onApply} />);

    const checkbox = screen.getByRole('checkbox', { name: '显示元素' });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ visible: false });
  });

  it('键盘可以切换复选框；表单禁用时不能编辑或提交', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const { rerender } = render(
      <PropertiesPanel node={textNode} disabled={false} onApply={onApply} />,
    );

    const checkbox = screen.getByRole('checkbox', { name: '显示元素' });
    checkbox.focus();
    await user.keyboard(' ');
    expect(checkbox).not.toBeChecked();
    rerender(<PropertiesPanel node={textNode} disabled onApply={onApply} />);
    expect(checkbox).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'X 坐标' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '文字内容' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '应用属性' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('公共输入框保留非法数字错误反馈，不输出用途说明', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(<PropertiesPanel node={textNode} disabled={false} onApply={onApply} />);

    await user.clear(screen.getByRole('textbox', { name: 'X 坐标' }));
    await user.type(screen.getByRole('textbox', { name: 'X 坐标' }), 'Infinity');
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    expect(screen.getByRole('alert')).toHaveTextContent('X 坐标需要填写有限数字');
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText(/坐标相对于父级/)).not.toBeInTheDocument();
    expect(screen.queryByText(/一次提交可整体撤销/)).not.toBeInTheDocument();
  });

  it('等值提交节点的独立副本保留数字、文字、可见性草稿与校验错误', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PropertiesPanel node={textNode} disabled={false} onApply={vi.fn()} />,
    );
    const text = screen.getByRole('textbox', { name: '文字内容' });
    fireEvent.change(text, { target: { value: '未提交文字' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'X 坐标' }), {
      target: { value: 'Infinity' },
    });
    await user.click(screen.getByRole('checkbox', { name: '显示元素' }));
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    rerender(
      <PropertiesPanel node={structuredClone(textNode)} disabled={false} onApply={vi.fn()} />,
    );
    expect(screen.getByRole('textbox', { name: '文字内容' })).toBe(text);
    expect(text).toHaveValue('未提交文字');
    expect(screen.getByRole('textbox', { name: 'X 坐标' })).toHaveValue('Infinity');
    expect(screen.getByRole('checkbox', { name: '显示元素' })).not.toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent('X 坐标需要填写有限数字');
  });

  it('已提交节点值变化整体刷新草稿，并清除旧校验错误', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PropertiesPanel node={textNode} disabled={false} onApply={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: '文字内容' }), {
      target: { value: '应被替换的草稿' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'X 坐标' }), {
      target: { value: 'Infinity' },
    });
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    rerender(
      <PropertiesPanel
        node={{
          ...textNode,
          visible: false,
          text: '已提交修改',
          transform: { ...textNode.transform, x: 80 },
        }}
        disabled={false}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: '文字内容' })).toHaveValue('已提交修改');
    expect(screen.getByRole('textbox', { name: 'X 坐标' })).toHaveValue('80');
    expect(screen.getByRole('checkbox', { name: '显示元素' })).not.toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('图表等值数据副本保留行草稿，已提交数据改变时整体刷新', () => {
    const node: BarChartNode = {
      id: 'chart',
      type: 'bar-chart',
      componentVersion: 1,
      visible: true,
      transform: textNode.transform,
      data: [{ category: '原类别', value: 1 }],
    };
    const { rerender } = render(<PropertiesPanel node={node} disabled={false} onApply={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: '分类 1' }), {
      target: { value: '未提交类别' },
    });
    rerender(<PropertiesPanel node={structuredClone(node)} disabled={false} onApply={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: '分类 1' })).toHaveValue('未提交类别');
    rerender(
      <PropertiesPanel
        node={{ ...node, data: [{ category: '新类别', value: -5 }] }}
        disabled={false}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: '分类 1' })).toHaveValue('新类别');
    expect(screen.getByRole('textbox', { name: '数值 1' })).toHaveValue('-5');
  });

  it('组合孩子顺序变化刷新其草稿，等值孩子数组副本不刷新', () => {
    const node: GroupNode = {
      id: 'group',
      type: 'group',
      visible: true,
      transform: textNode.transform,
      children: ['a', 'b'],
    };
    const { rerender } = render(<PropertiesPanel node={node} disabled={false} onApply={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'X 坐标' }), {
      target: { value: '99' },
    });
    rerender(<PropertiesPanel node={structuredClone(node)} disabled={false} onApply={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'X 坐标' })).toHaveValue('99');
    rerender(
      <PropertiesPanel
        node={{ ...node, children: ['b', 'a'] }}
        disabled={false}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'X 坐标' })).toHaveValue('10');
  });
});
