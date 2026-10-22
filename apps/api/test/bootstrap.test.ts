import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const fastify = { addHook: vi.fn<(name: string, callback: () => Promise<void>) => void>() };
  const app = {
    enableShutdownHooks: vi.fn(),
    listen: vi.fn<() => Promise<void>>(),
    getUrl: vi.fn<() => Promise<string>>(),
    getHttpAdapter: vi.fn(() => ({ getInstance: () => fastify })),
    close: vi.fn<() => Promise<void>>(),
  };
  const logging = { write: vi.fn(), close: vi.fn<() => Promise<void>>() };
  return {
    app,
    fastify,
    logging,
    createRuntimeLogging: vi.fn(() => logging),
    createApplication: vi.fn<() => Promise<typeof app>>(),
    loadConfig: vi.fn(),
    reportListening: vi.fn(),
    reportStartupArt: vi.fn(),
    reportStartupFailure: vi.fn(),
  };
});

vi.mock('../src/application.js', () => ({ createApplication: mocks.createApplication }));
vi.mock('../src/config.js', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('../src/logging.js', () => ({ createRuntimeLogging: mocks.createRuntimeLogging }));
vi.mock('../src/console-display.js', () => ({
  reportListening: mocks.reportListening,
  reportStartupArt: mocks.reportStartupArt,
  reportStartupFailure: mocks.reportStartupFailure,
}));

import { bootstrap } from '../src/main.js';

const config = {
  host: '0.0.0.0',
  port: 3000,
  databaseUrl: 'postgresql://user:synthetic-secret@127.0.0.1:15432/neobo',
  redisUrl: 'redis://:synthetic-secret@127.0.0.1:16379',
  dependencyTimeoutMs: 1000,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createRuntimeLogging.mockReturnValue(mocks.logging);
  mocks.loadConfig.mockReturnValue(config);
  mocks.createApplication.mockResolvedValue(mocks.app);
  mocks.app.getHttpAdapter.mockReturnValue({ getInstance: () => mocks.fastify });
  mocks.app.listen.mockResolvedValue();
  mocks.app.getUrl.mockResolvedValue('http://127.0.0.1:3000');
  mocks.app.close.mockResolvedValue();
  mocks.logging.close.mockResolvedValue();
});

describe('API 启动与关闭边界', () => {
  it('仅在实际监听完成后输出一次艺术字和摘要', async () => {
    let finishListening: (() => void) | undefined;
    mocks.app.listen.mockImplementation(
      () => new Promise<void>((resolve) => (finishListening = resolve)),
    );
    const pending = bootstrap();
    await vi.waitFor(() => expect(mocks.app.listen).toHaveBeenCalledOnce());
    expect(mocks.reportListening).not.toHaveBeenCalled();
    expect(mocks.reportStartupArt).not.toHaveBeenCalled();

    finishListening?.();
    await pending;
    expect(mocks.reportStartupArt).toHaveBeenCalledOnce();
    expect(mocks.createApplication).toHaveBeenCalledWith(config, undefined, {
      logging: mocks.logging,
    });
    expect(mocks.reportListening).toHaveBeenCalledWith(
      'http://127.0.0.1:3000',
      '0.0.0.0',
      mocks.logging,
    );
    expect(mocks.app.close).not.toHaveBeenCalled();
    expect(mocks.logging.close).not.toHaveBeenCalled();
  });

  it('应用正常关闭时完成日志输出', async () => {
    await bootstrap();
    expect(mocks.fastify.addHook).toHaveBeenCalledWith('onClose', expect.any(Function));
    const callback = mocks.fastify.addHook.mock.calls[0]?.[1];
    if (!callback) throw new Error('缺少关闭钩子');
    await callback();
    expect(mocks.logging.write).toHaveBeenCalledWith('info', 'server.stopped');
    expect(mocks.logging.close).toHaveBeenCalledOnce();
  });

  it('监听失败会关闭应用和日志且不暴露原始错误', async () => {
    mocks.app.listen.mockRejectedValue(new Error(config.databaseUrl));
    await expect(bootstrap()).rejects.toThrow('API 启动失败。');
    expect(mocks.app.close).toHaveBeenCalledOnce();
    expect(mocks.logging.write).toHaveBeenCalledWith('fatal', 'server.startup_failed', {
      errorCode: 'STARTUP_FAILED',
    });
    expect(JSON.stringify(mocks.logging.write.mock.calls)).not.toContain('synthetic-secret');
    expect(mocks.logging.close).toHaveBeenCalledOnce();
    expect(mocks.reportListening).not.toHaveBeenCalled();
    expect(mocks.reportStartupArt).not.toHaveBeenCalled();
  });

  it('配置或框架初始化失败仍关闭日志', async () => {
    mocks.loadConfig.mockImplementationOnce(() => {
      throw new Error(config.redisUrl);
    });
    await expect(bootstrap()).rejects.toThrow('API 启动失败。');
    expect(mocks.createApplication).not.toHaveBeenCalled();
    expect(mocks.logging.close).toHaveBeenCalledOnce();

    mocks.loadConfig.mockReturnValue(config);
    mocks.createApplication.mockRejectedValueOnce(new Error(config.databaseUrl));
    await expect(bootstrap()).rejects.toThrow('API 启动失败。');
    expect(mocks.logging.close).toHaveBeenCalledTimes(2);
    expect(mocks.reportStartupArt).not.toHaveBeenCalled();
  });

  it('资源清理失败返回受控提示，仍尝试关闭日志', async () => {
    mocks.app.enableShutdownHooks.mockImplementation(() => {
      throw new Error(config.redisUrl);
    });
    mocks.app.close.mockRejectedValue(new Error(config.databaseUrl));
    await expect(bootstrap()).rejects.toThrow('API 启动失败，资源清理未完成。');
    expect(mocks.app.close).toHaveBeenCalledOnce();
    expect(mocks.logging.close).toHaveBeenCalledOnce();
    expect(mocks.app.listen).not.toHaveBeenCalled();
    expect(mocks.reportListening).not.toHaveBeenCalled();
    expect(mocks.reportStartupArt).not.toHaveBeenCalled();
  });

  it('日志初始化失败只输出固定降级提示', async () => {
    mocks.createRuntimeLogging.mockImplementationOnce(() => {
      throw new Error(config.databaseUrl);
    });
    await expect(bootstrap()).rejects.toThrow('API 启动失败。');
    expect(mocks.reportStartupFailure).toHaveBeenCalledOnce();
    expect(mocks.loadConfig).not.toHaveBeenCalled();
    expect(mocks.createApplication).not.toHaveBeenCalled();
  });
});
