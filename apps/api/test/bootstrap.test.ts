import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const app = {
    enableShutdownHooks: vi.fn(),
    listen: vi.fn<() => Promise<void>>(),
    getUrl: vi.fn<() => Promise<string>>(),
    useLogger: vi.fn(),
    close: vi.fn<() => Promise<void>>(),
  };
  return {
    app,
    createApplication: vi.fn<() => Promise<typeof app>>(),
    loadConfig: vi.fn(),
    reportListening: vi.fn(),
    reportStartupArt: vi.fn(),
    reportStartupFailure: vi.fn(),
    createConsoleLogger: vi.fn(),
  };
});

vi.mock('../src/application.js', () => ({ createApplication: mocks.createApplication }));
vi.mock('../src/config.js', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('../src/console-display.js', () => ({
  reportListening: mocks.reportListening,
  reportStartupArt: mocks.reportStartupArt,
  reportStartupFailure: mocks.reportStartupFailure,
  createConsoleLogger: mocks.createConsoleLogger,
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
  mocks.loadConfig.mockReturnValue(config);
  mocks.createApplication.mockResolvedValue(mocks.app);
  mocks.app.listen.mockResolvedValue();
  mocks.app.getUrl.mockResolvedValue('http://127.0.0.1:3000');
  mocks.app.close.mockResolvedValue();
});

describe('API 启动输出边界', () => {
  it('仅在实际监听完成后输出运行时地址', async () => {
    let finishListening: (() => void) | undefined;
    mocks.app.listen.mockImplementation(
      () => new Promise<void>((resolve) => (finishListening = resolve)),
    );
    const pending = bootstrap();
    await vi.waitFor(() => expect(mocks.app.listen).toHaveBeenCalledOnce());
    expect(mocks.reportListening).not.toHaveBeenCalled();
    expect(mocks.reportStartupArt).not.toHaveBeenCalled();
    expect(mocks.app.useLogger).not.toHaveBeenCalled();

    finishListening?.();
    await pending;
    expect(mocks.reportStartupArt).toHaveBeenCalledOnce();
    expect(mocks.createApplication).toHaveBeenCalledWith(config, undefined, {
      logger: false,
    });
    expect(mocks.reportListening).toHaveBeenCalledWith(
      'http://127.0.0.1:3000',
      '0.0.0.0',
      undefined,
    );
    expect(mocks.app.close).not.toHaveBeenCalled();
  });

  it('启动失败会关闭应用且不暴露原始错误或成功摘要', async () => {
    mocks.app.listen.mockRejectedValue(new Error(config.databaseUrl));
    await expect(bootstrap()).rejects.toThrow('API 启动失败。');
    expect(mocks.app.close).toHaveBeenCalledOnce();
    expect(mocks.reportListening).not.toHaveBeenCalled();
    expect(mocks.reportStartupArt).not.toHaveBeenCalled();
    expect(mocks.app.useLogger).not.toHaveBeenCalled();
  });

  it('初始化失败也会关闭应用，关闭错误仍转换为受控提示', async () => {
    mocks.app.enableShutdownHooks.mockImplementation(() => {
      throw new Error(config.redisUrl);
    });
    mocks.app.close.mockRejectedValue(new Error(config.databaseUrl));

    await expect(bootstrap()).rejects.toThrow('API 启动失败，资源清理未完成。');
    expect(mocks.app.close).toHaveBeenCalledOnce();
    expect(mocks.app.listen).not.toHaveBeenCalled();
    expect(mocks.reportListening).not.toHaveBeenCalled();
    expect(mocks.reportStartupArt).not.toHaveBeenCalled();
  });
});
