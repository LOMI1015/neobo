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

  let stopping = false;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const onStop = () => {
    stopping = true;
  };
  for (const signal of signals) process.on(signal, onStop);

  try {
    // 按依赖顺序首次构建，再使用同一增量模式监听，避免首启重复写入。
    for (const [packageName, name, color] of [
      ['@neobo/scene', 'SCENE', 'gray'],
      ['@neobo/player', 'PLAYER', 'blue'],
    ]) {
      await run([{ command: `pnpm --filter ${packageName} build`, name, env: childEnvironment }], {
        cwd: workspaceRoot,
        outputStream: output,
        prefix: '[{color}{name}{/color}]',
        prefixColors: colors ? [color] : false,
        killOthersOn: ['success', 'failure'],
        successCondition: 'all',
      }).result;
      // concurrently 会把 Ctrl+C 收尾视为成功；仍须阻止进入下一启动阶段。
      if (stopping) return 0;
    }
    const { result } = run(
      [
        { command: 'pnpm --filter @neobo/scene dev', name: 'SCENE', env: childEnvironment },
        { command: 'pnpm --filter @neobo/player dev', name: 'PLAYER', env: childEnvironment },
        { command: 'pnpm --filter @neobo/api dev', name: 'API', env: childEnvironment },
        { command: 'pnpm --filter @neobo/web dev', name: 'WEB', env: childEnvironment },
      ],
      {
        cwd: workspaceRoot,
        outputStream: output,
        prefix: '[{color}{name}{/color}]',
        prefixColors: colors ? ['gray', 'blue', 'cyan', 'magenta'] : false,
        killOthersOn: ['success', 'failure'],
        successCondition: 'all',
      },
    );
    await result;
    return 0;
  } catch {
    if (stopping) return 0;
    output.write('开发服务未正常退出，请检查上方错误输出和本地配置。\n');
    return 1;
  } finally {
    for (const signal of signals) process.off(signal, onStop);
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
