import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('画布工作区入口', () => {
  it('默认进入画布，编辑无需发起 API 请求', () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(screen.getByRole('button', { name: '画布编辑' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '添加文字' })).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('切换服务检查后返回，保留尚未保存的编辑内容', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'ok' })),
    );
    render(<App />);
    await user.click(screen.getByRole('button', { name: '添加文字' }));
    await user.click(screen.getByRole('button', { name: '服务检查' }));
    expect(await screen.findByText('服务已连接')).toBeVisible();
    expect(screen.getByRole('heading', { name: '服务检查' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '画布编辑' }));
    expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '添加文字' })).toBeVisible();
  });

  it('预览只读取提交态，返回后保留选择、属性草稿和可撤销历史', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '添加文字' }));
    const text = screen.getByRole('textbox', { name: '文字内容' });
    await user.clear(text);
    await user.type(text, '已提交');
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    const draft = screen.getByRole('textbox', { name: '文字内容' });
    await user.clear(draft);
    await user.type(draft, '尚未应用');
    await user.click(screen.getByRole('button', { name: '预览' }));

    const preview = screen.getByRole('main', { name: '场景预览' });
    const canvas = within(preview).getByRole('img', { name: '场景预览画布' });
    expect(canvas).toHaveTextContent('已提交');
    expect(canvas).not.toHaveTextContent('尚未应用');
    expect(canvas.querySelector('.editor-selection')).toBeNull();
    expect(within(preview).queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加文字' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回编辑' })).toHaveFocus();
    fireEvent.contextMenu(canvas, { clientX: 100, clientY: 100 });
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '返回编辑' }));
    expect(screen.queryByRole('main', { name: '场景预览' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '画布编辑' })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: '文字内容' })).toBe(draft);
    expect(draft).toHaveValue('尚未应用');
    expect(screen.getByRole('button', { name: '选择文字 text-1' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('修订 2')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByRole('textbox', { name: '文字内容' })).toHaveValue('文字');
    await user.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getByRole('textbox', { name: '文字内容' })).toHaveValue('已提交');
  });

  it('离开预览卸载播放器，再次预览使用最新提交态', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '添加文字' }));
    await user.click(screen.getByRole('button', { name: '预览' }));
    const firstCanvas = screen.getByRole('img', { name: '场景预览画布' });
    await user.click(screen.getByRole('button', { name: '画布编辑' }));
    expect(firstCanvas).not.toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: '文字内容' }));
    await user.type(screen.getByRole('textbox', { name: '文字内容' }), '更新后');
    await user.click(screen.getByRole('button', { name: '应用属性' }));
    await user.click(screen.getByRole('button', { name: '预览' }));
    expect(screen.getByRole('img', { name: '场景预览画布' })).toHaveTextContent('更新后');
  });
});
