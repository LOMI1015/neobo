import { styleText } from 'node:util';
import type { RuntimeLogging } from './logging.js';

const startupArt = String.raw`
                    _
  _ __   ___  ___  | |__   ___
 | '_ \ / _ \/ _ \ | '_ \ / _ \
 | | | |  __/ (_) || |_) | (_) |
 |_| |_|\___|\___/ |_.__/ \___/
`;

export function consoleColorsEnabled(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (
    env.NODE_ENV === 'production' ||
    env.TERM === 'dumb' ||
    Object.hasOwn(env, 'NO_COLOR') ||
    Object.hasOwn(env, 'CI') ||
    env.FORCE_COLOR === '0' ||
    env.NEOBO_DEV_COLORS === '0'
  ) {
    return false;
  }

  // 根启动器用管道汇总模块输出，通过内部标记保留终端颜色。
  return isTTY || env.NEOBO_DEV_COLORS === '1';
}

export function reportListening(url: string, bindHost: string, logging: RuntimeLogging): void {
  const address = new URL(url);
  logging.write('info', 'server.listening', {
    host: bindHost,
    port: Number(address.port || (address.protocol === 'https:' ? 443 : 80)),
  });
}

export function reportStartupArt(
  env: NodeJS.ProcessEnv = process.env,
  output: Pick<NodeJS.WriteStream, 'write' | 'isTTY'> = process.stdout,
): void {
  if (env.NODE_ENV === 'production') return;

  // 每行独立上色，避免进程标签的颜色重置影响后续行。
  const art = consoleColorsEnabled(env, output.isTTY === true)
    ? startupArt
        .split('\n')
        .map((line) => styleText(['bold', 'cyan'], line, { validateStream: false }))
        .join('\n')
    : startupArt;
  output.write(`${art}\n`);
}

export function reportStartupFailure(): void {
  // 日志初始化失败时只保留固定标准错误提示，绝不回退输出异常对象。
  process.stderr.write('API 启动失败，请检查环境配置和端口占用。\n');
}
