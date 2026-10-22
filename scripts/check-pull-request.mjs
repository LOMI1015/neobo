import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromMarkdown } from 'mdast-util-from-markdown';

const titlePattern =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-zA-Z0-9._/-]+\))?!?: (?<description>[^\r\n\u2028\u2029]+)$/u;
const hanPattern = /\p{Script=Han}/u;
const ignoredNodes = new Set([
  'heading',
  'html',
  'code',
  'inlineCode',
  'definition',
  'image',
  'imageReference',
]);

function isChecklistItem(node) {
  const firstChild = node.children?.[0];
  const firstText = firstChild?.children?.[0];
  return (
    node.type === 'listItem' &&
    firstChild?.type === 'paragraph' &&
    firstText?.type === 'text' &&
    /^\[[ xX]\](?:\s|$)/u.test(firstText.value)
  );
}

export function extractBodyText(body) {
  const parts = [];
  function visit(node) {
    if (ignoredNodes.has(node.type) || isChecklistItem(node)) return;
    if (node.type === 'text') {
      // 网址及其路径不算中文正文说明。
      parts.push(node.value.replace(/(?:https?:\/\/|mailto:|www\.)[^\s<>]+/giu, ' '));
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }
  visit(fromMarkdown(body));
  return parts.join(' ').trim();
}

export function validatePullRequest(pullRequest) {
  if (!pullRequest || typeof pullRequest !== 'object' || Array.isArray(pullRequest)) {
    return ['事件中缺少有效的 pull_request 对象。'];
  }

  const errors = [];
  const { title, body } = pullRequest;
  const match = typeof title === 'string' ? titlePattern.exec(title) : null;
  if (!match || match.groups.description !== match.groups.description.trim()) {
    errors.push('PR 标题须为单行 Conventional Commits 格式，例如：feat(scene): 新增场景分组。');
  } else if (!hanPattern.test(match.groups.description)) {
    errors.push('PR 标题的描述须包含中文，类型、范围及技术名称可以使用英文。');
  }

  if (typeof body !== 'string' || !body.trim()) {
    errors.push('PR 正文不能为空，请使用中文说明实际变化和验证结果。');
  } else if (!hanPattern.test(extractBodyText(body))) {
    errors.push('PR 正文须包含实际中文说明；标题、注释、代码、网址和勾选清单不计入。');
  }
  return errors;
}

async function main() {
  const eventPath = process.argv[2] || process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error('缺少事件文件，请设置 GITHUB_EVENT_PATH 或传入本地事件 JSON 文件路径。');
    process.exitCode = 1;
    return;
  }

  let source;
  try {
    source = await readFile(eventPath, 'utf8');
  } catch {
    console.error('无法读取 PR 事件文件，请确认文件存在且可读取。');
    process.exitCode = 1;
    return;
  }

  let event;
  try {
    event = JSON.parse(source);
  } catch {
    console.error('PR 事件文件不是有效的 JSON。');
    process.exitCode = 1;
    return;
  }

  const errors = validatePullRequest(event?.pull_request);
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log('PR 中文标题与正文检查通过。');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
