import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractBodyText, validatePullRequest } from './check-pull-request.mjs';

const validPullRequest = {
  title: 'feat(scene): 新增场景分组与撤销',
  body: '新增分组命令，沿用 React 编辑状态。\n\n验证：`pnpm check` 通过。',
};
const scriptPath = fileURLToPath(new URL('./check-pull-request.mjs', import.meta.url));

async function fixture(t, source) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'neobo-pr-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'event.json');
  await writeFile(eventPath, source);
  return { root, eventPath };
}

function runCli(args = [], environment = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_PATH: '', ...environment },
  });
}

test('accepts Chinese titles and explanations containing English technical names', () => {
  assert.deepEqual(validatePullRequest(validPullRequest), []);
  assert.deepEqual(
    validatePullRequest({
      title: 'fix(api): 修复 NestJS 查询缓存',
      body: '- Redis 缓存按权限隔离。\n- Fastify 请求验证通过。',
    }),
    [],
  );
});

test('accepts standard types, optional scope and breaking change markers', () => {
  for (const type of [
    'feat',
    'fix',
    'docs',
    'style',
    'refactor',
    'perf',
    'test',
    'build',
    'ci',
    'chore',
    'revert',
  ]) {
    for (const suffix of ['', '(api)', '!', '(packages/scene-core.v2)!']) {
      assert.deepEqual(
        validatePullRequest({ ...validPullRequest, title: `${type}${suffix}: 完善功能` }),
        [],
      );
    }
  }
});

test('rejects English descriptions even when the body is Chinese', () => {
  const errors = validatePullRequest({ ...validPullRequest, title: 'feat(scene): add groups' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /标题的描述须包含中文/u);
});

test('rejects malformed titles, whitespace and every kind of line break', () => {
  for (const title of [
    '新增场景分组',
    'feature(scene): 新增分组',
    'feat(场景): 新增分组',
    'feat:新增分组',
    'feat:  新增分组',
    ' feat: 新增分组',
    'feat: 新增分组 ',
    'feat: ',
    'feat:',
    'feat: 新增分组\n',
    'feat: 新增分组\n另一行',
    'feat: 新增分组\r另一行',
    'feat: 新增分组\u2028另一行',
    'feat: 新增分组\u2029另一行',
    undefined,
    null,
    123,
  ]) {
    const errors = validatePullRequest({ ...validPullRequest, title });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /单行 Conventional Commits/u);
  }
});

test('rejects English prose despite Chinese headings, comments and checklist text', () => {
  const body = `## 问题与结果
<!-- 请用中文填写 -->
Added grouping commands.

## 验证
- [x] 已运行检查
- [ ] 已记录影响
`;
  const errors = validatePullRequest({ ...validPullRequest, body });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /正文须包含实际中文说明/u);
});

test('rejects empty, missing, non-string or template-only bodies', () => {
  for (const body of [
    undefined,
    null,
    123,
    '',
    ' \n\t',
    '# 问题与结果\n\n## 验证',
    '<!-- 请填写实际变化与验证 -->',
    '- [x] 已完成检查\n- [ ] 已补充记录',
    '1. [X] 已更新文档',
    '- [ ] **已更新文档**',
  ]) {
    assert.ok(validatePullRequest({ ...validPullRequest, body }).length > 0);
  }
});

test('does not count Chinese that only appears in code, images, URLs or definitions', () => {
  for (const body of [
    'Changed `中文代码`.\n\n```text\n中文示例\n```',
    '    中文缩进代码\n',
    'See https://example.com/中文路径',
    'See <https://example.com/中文路径>',
    'See [https://example.com/中文路径](https://example.com/中文路径)',
    'See www.example.com/中文路径',
    'See [details](https://example.com/中文路径)',
    '![中文截图](https://example.com/image.png)',
    '[reference]: https://example.com/中文路径',
  ]) {
    assert.ok(validatePullRequest({ ...validPullRequest, body }).length > 0);
  }
});

test('keeps actual Chinese paragraphs, bullet lists and descriptive link labels', () => {
  for (const body of [
    '支持选中元素后创建分组。',
    '- 新增分组命令。\n- 保留元素顺序。',
    '## 变化\n\n修复撤销后丢失选中状态。\n\n- [x] 已运行检查',
    '详情见[分组说明](https://example.com/groups)。',
  ]) {
    assert.deepEqual(validatePullRequest({ ...validPullRequest, body }), []);
  }
  assert.equal(extractBodyText('## 中文标题\n\n实际说明 `代码`。'), '实际说明  。');
});

test('missing or invalid pull request objects fail explicitly', () => {
  for (const pullRequest of [undefined, null, [], 'invalid']) {
    assert.deepEqual(validatePullRequest(pullRequest), ['事件中缺少有效的 pull_request 对象。']);
  }
});

test('CLI reads the GitHub event environment variable and a local argument', async (t) => {
  const { eventPath } = await fixture(t, JSON.stringify({ pull_request: validPullRequest }));
  const fromEnvironment = runCli([], { GITHUB_EVENT_PATH: eventPath });
  assert.equal(fromEnvironment.status, 0, fromEnvironment.stderr);
  assert.match(fromEnvironment.stdout, /检查通过/u);

  const fromArgument = runCli([eventPath], { GITHUB_EVENT_PATH: '/missing-event.json' });
  assert.equal(fromArgument.status, 0, fromArgument.stderr);
});

test('CLI rejects unavailable paths, invalid JSON and non-PR events without leaking input', async (t) => {
  const invalidSource = 'sensitive-invalid-event-content';
  const { eventPath } = await fixture(t, invalidSource);
  const invalid = runCli([eventPath]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /不是有效的 JSON/u);
  assert.ok(!invalid.stderr.includes(invalidSource));

  const noPath = runCli();
  assert.equal(noPath.status, 1);
  assert.match(noPath.stderr, /缺少事件文件/u);

  const unavailable = runCli(['/missing-event.json']);
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.stderr, /无法读取/u);

  await writeFile(eventPath, JSON.stringify({ action: 'push' }));
  const nonPr = runCli([eventPath]);
  assert.equal(nonPr.status, 1);
  assert.match(nonPr.stderr, /缺少有效的 pull_request/u);

  await writeFile(eventPath, JSON.stringify({ pull_request: { title: validPullRequest.title } }));
  const missingBody = runCli([eventPath]);
  assert.equal(missingBody.status, 1);
  assert.match(missingBody.stderr, /正文不能为空/u);
});

test('CLI treats untrusted titles and bodies as data and never prints them', async (t) => {
  const { root, eventPath } = await fixture(t, '{}');
  const marker = path.join(root, 'must-not-exist');
  const payload = `$(touch '${marker}')`;
  await writeFile(
    eventPath,
    JSON.stringify({
      pull_request: {
        title: `feat: ${payload}`,
        body: `<!-- 中文注释 -->\n${payload}`,
      },
    }),
  );
  const result = runCli([eventPath]);
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes(payload));
  assert.ok(!result.stderr.includes(payload));
  await assert.rejects(access(marker), { code: 'ENOENT' });
});
