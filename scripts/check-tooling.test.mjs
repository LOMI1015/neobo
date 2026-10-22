import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkMarkdownLinks,
  checkWorkflow,
  checkYaml,
  listRepositoryFiles,
} from './check-repository.mjs';
import {
  inspectWorkspaces,
  pnpmCommand,
  runWorkspaceChecks,
  validatePackageScripts,
  validateWorkspaceConfig,
} from './check-workspaces.mjs';

async function fixture(t, files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neobo-checks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [filename, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await writeFile(path.join(root, filename), content);
  }
  return root;
}

const scripts = { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run', build: 'tsc' };
const sha = 'a'.repeat(40);
const workspaceConfig = 'packages:\n  - apps/*\n  - packages/*\n';

test('repository files include tracked and untracked files but exclude ignored and locally deleted files', async (t) => {
  const root = await fixture(t, {
    'README.md': '# neobo\n',
    'removed.md': '# Removed\n',
    '.gitignore': 'ignored/\n',
    'ignored/example.md': '# Ignored\n',
  });
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  await rm(path.join(root, 'removed.md'));
  await writeFile(path.join(root, 'untracked.md'), '# Untracked\n');
  assert.deepEqual(listRepositoryFiles(root).sort(), ['.gitignore', 'README.md', 'untracked.md']);
});

test('Markdown checks real links, definitions, images, encoded paths and repeated headings', async (t) => {
  const root = await fixture(t, {
    'README.md':
      '[Guide](docs/guide.md#重复标题-1)\n[Reference][guide]\n[guide]: docs/guide.md#重复标题\n![Image](assets/some%20image.svg)\n[Root](/docs/guide.md)\n[External](https://example.com)\n',
    'docs/guide.md': '# 重复标题\n# 重复标题\n',
    'assets/some image.svg': '<svg/>',
  });
  assert.deepEqual(await checkMarkdownLinks(root, ['README.md', 'docs/guide.md']), []);
});

test('Markdown ignores examples in code but rejects missing files and headings', async (t) => {
  const root = await fixture(t, {
    'README.md':
      '`[inline](absent.md)`\n\n```md\n[fenced](absent.md)\n```\n\n[Broken](missing.md)\n[Anchor](guide.md#missing)\n',
    'guide.md': '# Existing\n',
  });
  const errors = await checkMarkdownLinks(root, ['README.md']);
  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /missing\.md/);
  assert.match(errors.join('\n'), /unknown Markdown heading/);
});

test('Markdown rejects local paths outside the repository', async (t) => {
  const root = await fixture(t, {
    'README.md': '[Escape](../outside.md)\n[File](file:///tmp/outside.md)\n',
  });
  const errors = await checkMarkdownLinks(root, ['README.md']);
  assert.equal(errors.length, 2);
});

test('workspaces find nested sources whose package manifest is missing', async (t) => {
  const root = await fixture(t, { 'apps/server/src/nested/main.ts': 'export {};' });
  const result = await inspectWorkspaces(root);
  assert.equal(result.packages.length, 0);
  assert.match(result.errors.join('\n'), /source exists without a package\.json/);
});

test('workspace packages must supply every required script', async (t) => {
  const root = await fixture(t, {
    'packages/core/package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }),
    'pnpm-workspace.yaml': workspaceConfig,
  });
  const result = await inspectWorkspaces(root);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors.join('\n'), /typecheck/);
  assert.match(result.errors.join('\n'), /test/);
  assert.match(result.errors.join('\n'), /build/);
});

test('documentation stage is explicit and sources cannot live outside a package', async (t) => {
  const root = await fixture(t, { 'README.md': '# neobo\n' });
  assert.deepEqual(await inspectWorkspaces(root), { packages: [], errors: [] });
  await mkdir(path.join(root, 'apps'));
  await writeFile(path.join(root, 'apps', 'main.ts'), 'export {};');
  assert.match(
    (await inspectWorkspaces(root)).errors.join('\n'),
    /source must belong to a package/,
  );
});

test('a complete package passes inspection and generated output is ignored', async (t) => {
  const root = await fixture(t, {
    'apps/server/package.json': JSON.stringify({ scripts }),
    'apps/server/src/main.ts': 'export {};',
    'packages/generated/dist/index.js': 'generated();',
    'pnpm-workspace.yaml': workspaceConfig,
  });
  assert.deepEqual(await inspectWorkspaces(root), { packages: ['apps/server'], errors: [] });
});

test('workspace checks reject no-op scripts and hidden failures', () => {
  for (const command of [
    'echo TODO',
    'exit 0',
    'true',
    'vitest --passWithNoTests',
    'eslint . || true',
  ]) {
    assert.match(
      validatePackageScripts({ scripts: { ...scripts, test: command } }, 'package').join('\n'),
      /placeholder|suppresses failures/,
    );
  }
});

test('workspace commands execute sequentially through pnpm without skipping scripts', () => {
  const calls = [];
  runWorkspaceChecks('/repository', '/tools/pnpm.cjs', (executable, args, options) => {
    calls.push({ executable, args, options });
    return { status: 0 };
  });
  assert.deepEqual(
    calls.map((call) => call.args),
    ['build', 'lint', 'typecheck', 'test'].map((script) => [
      '/tools/pnpm.cjs',
      '-r',
      'run',
      script,
    ]),
  );
  assert.ok(
    calls.every(
      (call) => call.executable === process.execPath && call.options.cwd === '/repository',
    ),
  );
  for (const [index, script] of ['build', 'lint', 'typecheck', 'test'].entries()) {
    let attempts = 0;
    assert.throws(
      () =>
        runWorkspaceChecks('/repository', '/tools/pnpm.cjs', () => ({
          status: attempts++ === index ? 7 : 0,
        })),
      (error) => error.message === `Workspace ${script} failed (7).` && error.exitCode === 7,
    );
    assert.equal(attempts, index + 1);
  }
});

test('a clean workspace builds dependency artifacts before its consumers and all checks', async (t) => {
  const producerScripts = Object.fromEntries(
    Object.keys(scripts).map((script) => [script, `node check.mjs ${script}`]),
  );
  const root = await fixture(t, {
    'package.json': JSON.stringify({ name: 'workspace-check-fixture', private: true }),
    'pnpm-workspace.yaml': workspaceConfig,
    'packages/producer/package.json': JSON.stringify({
      name: '@fixture/producer',
      version: '0.0.0',
      type: 'module',
      scripts: producerScripts,
    }),
    'packages/producer/check.mjs': `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
const script = process.argv[2];
if (script === 'build') {
  mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./dist/index.js', import.meta.url), 'export const sceneVersion = 1;');
}
const { sceneVersion } = await import('./dist/index.js');
if (sceneVersion !== 1) throw new Error('Invalid dependency artifact.');
appendFileSync(new URL('../../checks.txt', import.meta.url), 'producer:' + script + '\\n');
`,
    'apps/consumer/package.json': JSON.stringify({
      name: '@fixture/consumer',
      version: '0.0.0',
      type: 'module',
      scripts: producerScripts,
      dependencies: { '@fixture/producer': 'workspace:*' },
    }),
    'apps/consumer/check.mjs': `
import { appendFileSync } from 'node:fs';
import { sceneVersion } from '../../packages/producer/dist/index.js';
if (sceneVersion !== 1) throw new Error('Invalid dependency artifact.');
appendFileSync(new URL('../../checks.txt', import.meta.url), 'consumer:' + process.argv[2] + '\\n');
`,
  });
  runWorkspaceChecks(root, process.env.npm_execpath ?? 'pnpm');
  assert.equal(
    await readFile(path.join(root, 'checks.txt'), 'utf8'),
    ['build', 'lint', 'typecheck', 'test']
      .flatMap((script) => [`producer:${script}`, `consumer:${script}`])
      .join('\n') + '\n',
  );
});

test('native pnpm and Windows executables run directly, while unsafe shell wrappers fail clearly', () => {
  for (const executable of ['/tools/pnpm', 'C:\\tools\\pnpm.exe']) {
    const calls = [];
    runWorkspaceChecks('/repository', executable, (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    });
    assert.deepEqual(calls[0], { command: executable, args: ['-r', 'run', 'build'] });
    assert.equal(calls.length, 4);
  }
  assert.throws(() => pnpmCommand('C:\\tools\\pnpm.cmd'), /native pnpm executable/);
});

test('workspace globs cannot omit or exclude discovered packages', async (t) => {
  assert.deepEqual(validateWorkspaceConfig(workspaceConfig), []);
  for (const config of ['packages: [apps/*]', "packages: [apps/*, packages/*, '!apps/server']"]) {
    assert.match(validateWorkspaceConfig(config).join('\n'), /exactly apps\/\* and packages\/\*/);
  }
  const root = await fixture(t, {
    'apps/server/package.json': JSON.stringify({ scripts }),
    'pnpm-workspace.yaml': 'packages: [packages/*]\n',
  });
  assert.match(
    (await inspectWorkspaces(root)).errors.join('\n'),
    /exactly apps\/\* and packages\/\*/,
  );
});

function workflow() {
  return {
    on: ['pull_request', 'push'],
    permissions: { contents: 'read' },
    jobs: {
      check: {
        'runs-on': 'ubuntu-latest',
        steps: [{ uses: `actions/checkout@${sha}`, with: { 'persist-credentials': false } }],
      },
    },
  };
}

test('CI accepts pinned actions and read-only credentials', () => {
  assert.deepEqual(checkWorkflow(workflow(), '.github/workflows/ci.yml'), []);
});

test('workflow policy rejects mutable actions, privileged triggers, credentials and runners', () => {
  const unsafe = workflow();
  unsafe.on = { pull_request_target: {} };
  unsafe.permissions = 'write-all';
  unsafe.jobs.check['runs-on'] = ['self-hosted', 'linux'];
  unsafe.jobs.check.steps[0] = { uses: 'actions/checkout@v4' };
  const errors = checkWorkflow(unsafe, '.github/workflows/ci.yml');
  for (const message of [
    /pull_request_target/,
    /contents: read/,
    /self-hosted/,
    /40-character/,
    /persist-credentials/,
  ]) {
    assert.ok(
      errors.some((error) => message.test(error)),
      `Missing policy rejection: ${message}`,
    );
  }
});

test('release permissions are allowed without weakening ordinary CI', () => {
  const release = workflow();
  release.on = 'workflow_dispatch';
  release.permissions = { contents: 'write' };
  assert.deepEqual(checkWorkflow(release, '.github/workflows/release.yml'), []);
  assert.ok(checkWorkflow(release, '.github/workflows/ci.yml').length > 0);
});

test('YAML parsing rejects invalid syntax and checks reusable action references', () => {
  assert.ok(checkYaml('key: [unterminated', 'config.yml').length > 0);
  const reusable = workflow();
  reusable.jobs = { check: { uses: 'example/repo/.github/workflows/test.yml@main' } };
  assert.match(checkWorkflow(reusable, '.github/workflows/ci.yml').join('\n'), /40-character/);
});

test('multi-document lockfiles are valid but workflows must remain single-document', () => {
  const source = "lockfileVersion: '12'\n---\nimporters:\n  .: {}\n";
  assert.deepEqual(checkYaml(source, 'pnpm-lock.yaml'), []);
  assert.ok(checkYaml(source, '.github/workflows/ci.yml').length > 0);
});
