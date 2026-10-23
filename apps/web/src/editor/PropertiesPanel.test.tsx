import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TextNode } from '@neobo/scene';
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
});
