import { styleText } from 'node:util';
import { ConsoleLogger } from '@nestjs/common';

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

export function createConsoleLogger(
  env: NodeJS.ProcessEnv = process.env,
  isTTY = process.stdout.isTTY === true,
): ConsoleLogger {
  return new ConsoleLogger('API', {
    prefix: 'neobo',
    timestamp: true,
    colors: consoleColorsEnabled(env, isTTY),
    json: env.NODE_ENV === 'production',
    logLevels: ['log', 'warn', 'error'],
  });
}

export function reportListening(
  url: string,
  bindHost: string,
  logger = createConsoleLogger(),
): void {
  const healthUrl = new URL('/api/health', url).href;
  logger.log(`API 已监听 ${url} · 健康检查 ${healthUrl} · 绑定地址 ${bindHost}`);
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

export function reportStartupFailure(logger = createConsoleLogger()): void {
  logger.error('API 启动失败，请检查环境配置和端口占用。');
}
