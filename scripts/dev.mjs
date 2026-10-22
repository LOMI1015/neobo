import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import concurrently from 'concurrently';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));

export function canUseColors(env, output) {
  return (
    output.isTTY === true &&
    env.CI === undefined &&
    env.NO_COLOR === undefined &&
    env.TERM !== 'dumb' &&
    env.FORCE_COLOR !== '0'
  );
}

export async function runDevelopment({
  env = process.env,
  output = process.stdout,
  run = concurrently,
} = {}) {
  const colors = canUseColors(env, output);
  output.write('正在启动 API / Web 开发服务\n按 Ctrl+C 停止开发服务\n\n');

  // 子进程通过管道输出，颜色策略由最外层终端统一决定。
  const childEnvironment = {
    ...env,
    NODE_ENV: 'development',
    NEOBO_DEV_COLORS: colors ? '1' : '0',
    FORCE_COLOR: colors ? '1' : '0',
    ...(!colors && { NO_COLOR: '1' }),
  };

  try {
    // 与共享包监听使用同一增量构建模式，避免监听首启重复写入产物而重启 API。
    await run(
      [{ command: 'pnpm --filter @neobo/scene build', name: 'SCENE', env: childEnvironment }],
      {
        cwd: workspaceRoot,
        outputStream: output,
        prefix: '[{color}{name}{/color}]',
        prefixColors: colors ? ['gray'] : false,
        killOthersOn: ['success', 'failure'],
        successCondition: 'all',
      },
    ).result;
    const { result } = run(
      [
        { command: 'pnpm --filter @neobo/scene dev', name: 'SCENE', env: childEnvironment },
        { command: 'pnpm --filter @neobo/api dev', name: 'API', env: childEnvironment },
        { command: 'pnpm --filter @neobo/web dev', name: 'WEB', env: childEnvironment },
      ],
      {
        cwd: workspaceRoot,
        outputStream: output,
        prefix: '[{color}{name}{/color}]',
        prefixColors: colors ? ['gray', 'cyan', 'magenta'] : false,
        killOthersOn: ['success', 'failure'],
        successCondition: 'all',
      },
    );
    await result;
    return 0;
  } catch {
    output.write('开发服务未正常退出，请检查上方错误输出和本地配置。\n');
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runDevelopment();
  } catch {
    console.error('neobo 开发环境启动失败，请检查项目文件与启动命令。');
    process.exitCode = 1;
  }
}
