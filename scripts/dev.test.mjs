import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';
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
    const status = await runDevelopment({
      env,
      output: capture.output,
      run(commands, options) {
        assert.deepEqual(
          commands.map(({ name }) => name),
          ['API', 'WEB'],
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
      assert.deepEqual(options.prefixColors, ['cyan', 'magenta']);
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

test('propagates failed commands and runner failures without printing untrusted errors', async () => {
  for (const run of [
    () => ({ result: Promise.reject(new Error('synthetic-sensitive-setting')) }),
    () => {
      throw new Error('synthetic-sensitive-setting');
    },
  ]) {
    const capture = captureOutput();
    assert.equal(await runDevelopment({ env: {}, output: capture.output, run }), 1);
    assert.doesNotMatch(capture.read(), /synthetic-sensitive-setting/u);
  }
});
