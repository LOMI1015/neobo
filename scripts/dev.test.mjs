import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';
import concurrently from 'concurrently';
import { canUseColors, runDevelopment } from './dev.mjs';

function captureOutput(isTTY = false) {
  let text = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  output.isTTY = isTTY;
  return { output, read: () => text };
}

test('only enables colors in an interactive terminal without a disabling setting', () => {
  assert.equal(canUseColors({}, { isTTY: true }), true);
  assert.equal(canUseColors({ FORCE_COLOR: '1' }, { isTTY: true }), true);
  for (const env of [{}, { FORCE_COLOR: '1' }, { CI: 'true' }]) {
    assert.equal(canUseColors(env, { isTTY: false }), false);
  }
  for (const env of [
    { CI: 'true' },
    { CI: '' },
    { NO_COLOR: '1' },
    { NO_COLOR: '' },
    { FORCE_COLOR: '0' },
    { TERM: 'dumb' },
    { CI: 'true', FORCE_COLOR: '1' },
    { NO_COLOR: '1', FORCE_COLOR: '1' },
  ]) {
    assert.equal(canUseColors(env, { isTTY: true }), false);
  }
});

test('prints only a startup notice, leaving brand output to the backend', async () => {
  const capture = captureOutput();
  const status = await runDevelopment({
    env: {},
    output: capture.output,
    run: () => ({ result: Promise.resolve([]) }),
  });
  assert.equal(status, 0);
  assert.match(capture.read(), /正在启动 API \/ Web/u);
  assert.match(capture.read(), /Ctrl\+C/u);
  assert.doesNotMatch(capture.read(), /neobo|艺术字|_ __|已就绪|已监听|postgres|redis|\u001b/iu);
});

test('disables both wrapper and child colors while retaining module labels', async () => {
  for (const env of [{}, { CI: 'true', FORCE_COLOR: '3' }, { NO_COLOR: '1' }]) {
    const capture = captureOutput();
    let stage = 0;
    const status = await runDevelopment({
      env,
      output: capture.output,
      run(commands, options) {
        stage += 1;
        const names = commands.map(({ name }) => name);
        assert.deepEqual(
          names,
          [['THEME'], ['SCENE'], ['PLAYER'], ['THEME', 'SCENE', 'PLAYER', 'API', 'WEB']][stage - 1],
        );
        assert.equal(options.prefix, '[{color}{name}{/color}]');
        assert.equal(options.prefixColors, false);
        assert.deepEqual(options.killOthersOn, ['success', 'failure']);
        assert.equal(options.successCondition, 'all');
        for (const command of commands) {
          assert.equal(command.env.NEOBO_DEV_COLORS, '0');
          assert.equal(command.env.FORCE_COLOR, '0');
          assert.equal(command.env.NO_COLOR, '1');
          assert.equal(command.env.NODE_ENV, 'development');
        }
        return { result: Promise.resolve([]) };
      },
    });
    assert.equal(status, 0);
    assert.doesNotMatch(capture.read(), /\u001b/u);
  }
});

test('allows colored child output through pipes when the outer terminal supports colors', async () => {
  const capture = captureOutput(true);
  const status = await runDevelopment({
    env: {},
    output: capture.output,
    run(commands, options) {
      assert.deepEqual(
        options.prefixColors,
        commands.length === 1
          ? [{ THEME: 'yellow', SCENE: 'gray', PLAYER: 'blue' }[commands[0].name]]
          : ['yellow', 'gray', 'blue', 'cyan', 'magenta'],
      );
      for (const command of commands) {
        assert.equal(command.env.NEOBO_DEV_COLORS, '1');
        assert.equal(command.env.FORCE_COLOR, '1');
        assert.equal(command.env.NO_COLOR, undefined);
      }
      return { result: Promise.resolve([]) };
    },
  });
  assert.equal(status, 0);
  assert.doesNotMatch(capture.read(), /\u001b/u);
});

test('waits for theme, scene then player builds before starting development watchers', async () => {
  const capture = captureOutput();
  const calls = [];
  const packages = ['@neobo/theme', '@neobo/scene', '@neobo/player'];
  const builds = packages.map(() => Promise.withResolvers());
  const started = packages.map(() => Promise.withResolvers());
  const development = runDevelopment({
    env: {},
    output: capture.output,
    run(commands, options) {
      const stage = calls.length;
      calls.push({ commands, options });
      started[stage]?.resolve();
      return { result: builds[stage]?.promise ?? Promise.resolve([]) };
    },
  });
  for (const [index, packageName] of packages.entries()) {
    await started[index].promise;
    assert.equal(calls.length, index + 1);
    assert.deepEqual(
      calls[index].commands.map(({ command }) => command),
      [`pnpm --filter ${packageName} build`],
    );
    builds[index].resolve([]);
  }
  assert.equal(await development, 0);
  assert.deepEqual(
    calls[3].commands.map(({ command }) => command),
    [
      'pnpm --filter @neobo/theme dev',
      'pnpm --filter @neobo/scene dev',
      'pnpm --filter @neobo/player dev',
      'pnpm --filter @neobo/api dev',
      'pnpm --filter @neobo/web dev',
    ],
  );
  assert.deepEqual(calls[3].options.killOthersOn, ['success', 'failure']);
  assert.equal(calls[3].options.successCondition, 'all');
});

test('propagates failed commands and runner failures without printing untrusted errors', async () => {
  for (const failedStage of [1, 2, 3, 4]) {
    for (const throws of [false, true]) {
      let calls = 0;
      const capture = captureOutput();
      const status = await runDevelopment({
        env: {},
        output: capture.output,
        run() {
          calls += 1;
          if (calls !== failedStage) return { result: Promise.resolve([]) };
          if (throws) throw new Error('synthetic-sensitive-setting');
          return { result: Promise.reject(new Error('synthetic-sensitive-setting')) };
        },
      });
      assert.equal(status, 1);
      assert.equal(calls, failedStage);
      assert.doesNotMatch(capture.read(), /synthetic-sensitive-setting/u);
    }
  }
});

test('startup cancellation stops later stages even when the runner resolves successfully', async () => {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    for (const stopStage of [1, 2, 3]) {
      const capture = captureOutput();
      const listeners = process.listenerCount(signal);
      let calls = 0;
      const status = await runDevelopment({
        env: {},
        output: capture.output,
        run() {
          calls += 1;
          if (calls === stopStage) process.emit(signal);
          return { result: Promise.resolve([]) };
        },
      });
      assert.equal(status, 0);
      assert.equal(calls, stopStage);
      assert.equal(process.listenerCount(signal), listeners);
      assert.doesNotMatch(capture.read(), /未正常退出/u);
    }
  }
});

test('real concurrently SIGINT cleanup stops startup and releases its process listeners', async () => {
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  for (const stopStage of [1, 2, 3]) {
    const listeners = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) =>
      process.listenerCount(signal),
    );
    const children = [];
    let calls = 0;
    let text = '';
    const output = new Writable({
      write(chunk, _encoding, callback) {
        const message = chunk.toString();
        text += message;
        // 仅在真实子进程已启动后触发信号，覆盖库将 SIGINT 映射为成功的行为。
        if (message.includes('fixture-ready')) process.emit('SIGINT');
        callback();
      },
    });
    const watchdog = setTimeout(() => {
      for (const command of children) {
        if (command.state === 'started') command.kill('SIGKILL');
      }
    }, 5_000);
    watchdog.unref();
    try {
      const status = await runDevelopment({
        env: {},
        output,
        run(commands, options) {
          calls += 1;
          const script =
            calls === stopStage
              ? 'process.stdout.write("fixture-ready\\n"); setInterval(() => {}, 1000);'
              : '';
          const result = concurrently(
            commands.map((command) => ({
              ...command,
              command: `${quote(process.execPath)} --eval ${quote(script)}`,
            })),
            options,
          );
          children.push(...result.commands);
          return result;
        },
      });
      assert.equal(status, 0);
      assert.equal(calls, stopStage);
      assert.match(text, /fixture-ready/u);
      assert.doesNotMatch(text, /未正常退出/u);
      assert.equal(
        children.every((command) => command.state !== 'started'),
        true,
      );
      assert.deepEqual(
        ['SIGINT', 'SIGTERM', 'SIGHUP'].map((signal) => process.listenerCount(signal)),
        listeners,
      );
    } finally {
      clearTimeout(watchdog);
      for (const command of children) {
        if (command.state === 'started') command.kill('SIGKILL');
      }
      output.end();
    }
  }
});
