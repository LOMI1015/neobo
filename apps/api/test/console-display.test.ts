import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consoleColorsEnabled,
  reportListening,
  reportStartupArt,
  reportStartupFailure,
} from '../src/console-display.js';
import { createRuntimeLogging } from '../src/logging.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('开发终端显示', () => {
  it('仅为终端或根启动器确认的开发终端启用颜色', () => {
    expect(consoleColorsEnabled({}, true)).toBe(true);
    expect(consoleColorsEnabled({}, false)).toBe(false);
    expect(consoleColorsEnabled({ FORCE_COLOR: '1' }, false)).toBe(false);
    expect(consoleColorsEnabled({ NEOBO_DEV_COLORS: '1' }, false)).toBe(true);
  });

  it.each([
    { NO_COLOR: '' },
    { CI: 'true' },
    { FORCE_COLOR: '0' },
    { NEOBO_DEV_COLORS: '0' },
    { NODE_ENV: 'production' },
    { TERM: 'dumb' },
  ])('明确禁色设置优先于终端和内部标记：%j', (env) => {
    expect(consoleColorsEnabled({ NEOBO_DEV_COLORS: '1', ...env }, true)).toBe(false);
  });

  it('生产不输出艺术字，日志不可用时仅输出固定提示', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    reportStartupArt({ NODE_ENV: 'production' });
    reportStartupFailure();
    expect(stderr).toHaveBeenCalledWith('API 启动失败，请检查环境配置和端口占用。\n');
    expect(stdout).not.toHaveBeenCalled();
  });

  it('禁色艺术字保留纯文本，启用颜色不改变图案', () => {
    const plain = { write: vi.fn<(chunk: string) => boolean>(() => true), isTTY: true };
    const colored = { write: vi.fn<(chunk: string) => boolean>(() => true), isTTY: true };
    reportStartupArt({ NO_COLOR: '' }, plain);
    reportStartupArt({}, colored);
    expect(plain.write).toHaveBeenCalledOnce();
    expect(plain.write.mock.calls[0]?.[0]).not.toContain('\u001b[');
    expect(colored.write).toHaveBeenCalledOnce();
    expect(colored.write.mock.calls[0]?.[0]).toContain('\u001b[');
  });

  it('监听摘要使用实际端口和绑定地址，不把运行时URL当任意日志正文', async () => {
    const records: string[] = [];
    const logging = createRuntimeLogging({
      environment: 'production',
      destination: { write: (record) => records.push(record) },
    });
    try {
      reportListening('http://[::1]:43210', '::', logging);
      expect(records).toHaveLength(1);
      expect(JSON.parse(records[0] ?? '')).toMatchObject({
        event: 'server.listening',
        host: '::',
        port: 43210,
      });
      expect(records.join('')).not.toContain('\u001b[');
      expect(records.join('')).not.toContain('已就绪');
    } finally {
      await logging.close();
    }
  });
});
