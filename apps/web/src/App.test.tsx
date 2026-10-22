import { render, screen } from '@testing-library/react';
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
});
