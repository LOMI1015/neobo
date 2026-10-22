import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevelopmentStatus } from './DevelopmentStatus';

function deferredResponse() {
  let resolveResponse: ((response: Response) => void) | undefined;
  const promise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });

  return {
    promise,
    resolve(response: Response) {
      if (!resolveResponse) {
        throw new Error('测试响应尚未初始化。');
      }

      resolveResponse(response);
    },
  };
}

function healthyResponse() {
  return Response.json({ status: 'ok' });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('开发环境 API 连接检查', () => {
  it('请求期间展示等待状态，并禁止重复点击', async () => {
    const response = deferredResponse();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response.promise);
    vi.stubGlobal('fetch', fetchMock);

    render(<DevelopmentStatus />);

    expect(screen.getByRole('status')).toHaveTextContent('正在连接');
    expect(screen.getByRole('button', { name: '检查中…' })).toBeDisabled();
    const firstRequest = fetchMock.mock.calls[0];
    expect(firstRequest?.[0]).toBe('/api/health');
    expect(firstRequest?.[1]?.cache).toBe('no-store');
    expect(firstRequest?.[1]?.signal).toBeInstanceOf(AbortSignal);

    response.resolve(healthyResponse());
    expect(await screen.findByText('服务已连接')).toBeVisible();
  });

  it('有效健康响应显示服务已连接，并明确业务功能尚未实现', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(healthyResponse()));

    render(<DevelopmentStatus />);

    expect(await screen.findByText('服务已连接')).toBeVisible();
    expect(screen.getByRole('button', { name: '重新检查' })).toBeEnabled();
    expect(screen.getByText('二维画布已接入统一命令；以下能力仍在后续计划中。')).toBeVisible();
  });

  it('连接失败后可以重试，重试成功恢复正常状态', async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(healthyResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<DevelopmentStatus />);

    expect(await screen.findByText('连接失败')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '重试连接' }));

    expect(await screen.findByText('服务已连接')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('HTTP 错误不能被当成连接成功', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'ok' }, { status: 503 })),
    );

    render(<DevelopmentStatus />);

    expect(await screen.findByText('连接失败')).toBeVisible();
    expect(screen.getByText('API 服务返回 HTTP 503。')).toBeVisible();
  });

  it('不信任未经过检查的响应内容', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: 'unknown' })),
    );

    render(<DevelopmentStatus />);

    expect(await screen.findByText('连接失败')).toBeVisible();
    expect(screen.getByText('API 服务返回了无法识别的健康状态。')).toBeVisible();
  });

  it('重新挂载副作用时取消请求，旧请求完成后不会覆盖最新连接状态', async () => {
    const oldResponse = deferredResponse();
    const newResponse = deferredResponse();
    const signals: AbortSignal[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce((_input, init) => {
        if (init?.signal) {
          signals.push(init.signal);
        }

        return oldResponse.promise;
      })
      .mockReturnValueOnce(newResponse.promise);
    vi.stubGlobal('fetch', fetchMock);

    render(
      <StrictMode>
        <DevelopmentStatus />
      </StrictMode>,
    );
    expect(signals[0]?.aborted).toBe(true);
    newResponse.resolve(healthyResponse());
    expect(await screen.findByText('服务已连接')).toBeVisible();

    await act(async () => {
      oldResponse.resolve(Response.json({ status: 'error' }));
      await oldResponse.promise;
    });

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('服务已连接'));
  });

  it('连接超时后终止请求并允许重试', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    );

    render(<DevelopmentStatus />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(screen.getByText('连接超时，请确认 API 服务已启动。')).toBeVisible();
    expect(screen.getByRole('button', { name: '重试连接' })).toBeEnabled();
  });
});
