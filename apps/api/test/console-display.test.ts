import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consoleColorsEnabled,
  createConsoleLogger,
  reportListening,
  reportStartupArt,
  reportStartupFailure,
} from '../src/console-display.js';

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

  it('生产启动失败输出安全的单行 JSON', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    reportStartupArt({ NODE_ENV: 'production' });
    reportStartupFailure(createConsoleLogger({ NODE_ENV: 'production' }, true));

    const output = write.mock.calls.map(([value]) => String(value)).join('');
    expect(output.trim().split('\n')).toHaveLength(1);
    const parsed: unknown = JSON.parse(output);
    expect(parsed).toMatchObject({
      level: 'error',
      context: 'API',
    });
    expect(parsed).toHaveProperty('message', expect.stringContaining('API 启动失败'));
    expect(output).not.toContain('\u001b[');
    expect(output).not.toContain('stack');
    expect(stdout).not.toHaveBeenCalled();
  });

  it('监听摘要使用运行时地址，区分访问 URL 与通配绑定地址', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    reportListening(
      'http://[::1]:43210',
      '::',
      createConsoleLogger({ NODE_ENV: 'production' }, true),
    );

    const output = write.mock.calls.map(([value]) => String(value)).join('');
    const parsed: unknown = JSON.parse(output);
    expect(parsed).toHaveProperty(
      'message',
      expect.stringContaining('http://[::1]:43210/api/health'),
    );
    expect(output).toContain('绑定地址 ::');
    expect(output).not.toContain('已就绪');
  });
});
