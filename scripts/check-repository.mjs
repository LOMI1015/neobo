import { execFileSync } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import GithubSlugger from 'github-slugger';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { parseAllDocuments, parseDocument } from 'yaml';

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function headingText(node) {
  if (node.type === 'html') return '';
  if (node.type === 'image') return node.alt ?? '';
  return node.value ?? (node.children ?? []).map(headingText).join('');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function listRepositoryFiles(root) {
  const options = {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  };
  const deleted = new Set(
    execFileSync('git', ['ls-files', '--deleted', '-z'], options).split('\0'),
  );
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    options,
  )
    .split('\0')
    .filter((filename) => filename && !deleted.has(filename));
}

export async function checkMarkdownLinks(root, files) {
  const errors = [];
  const canonicalRoot = await realpath(root);
  const parsed = new Map();
  async function document(filename) {
    if (!parsed.has(filename)) {
      const tree = fromMarkdown(await readFile(filename, 'utf8'));
      const slugger = new GithubSlugger();
      const anchors = new Set();
      walk(tree, (node) => {
        if (node.type === 'heading') anchors.add(slugger.slug(headingText(node)));
      });
      parsed.set(filename, { tree, anchors });
    }
    return parsed.get(filename);
  }

  for (const filename of files) {
    const absolute = path.resolve(root, filename);
    if (!isInside(canonicalRoot, await realpath(absolute))) {
      errors.push(`${filename}: Markdown file escapes the repository through a symlink`);
      continue;
    }
    const { tree } = await document(absolute);
    const links = [];
    walk(tree, (node) => {
      if (['link', 'image', 'definition'].includes(node.type)) links.push(node);
    });
    for (const node of links) {
      const location = `${filename}:${node.position?.start.line ?? 1}`;
      const url = node.url;
      // External destinations are intentionally not fetched by repository CI.
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) {
        if (/^file:/i.test(url)) errors.push(`${location}: file: links are not portable: ${url}`);
        continue;
      }
      try {
        const hash = url.indexOf('#');
        const beforeHash = hash < 0 ? url : url.slice(0, hash);
        const targetPath = decodeURIComponent(beforeHash.split('?')[0]);
        const fragment = hash < 0 ? '' : decodeURIComponent(url.slice(hash + 1));
        const target = targetPath
          ? targetPath.startsWith('/')
            ? path.resolve(root, `.${targetPath}`)
            : path.resolve(path.dirname(absolute), targetPath)
          : absolute;
        if (!isInside(root, target) || !isInside(canonicalRoot, await realpath(target))) {
          errors.push(`${location}: local link escapes the repository: ${url}`);
          continue;
        }
        const targetStat = await stat(target);
        if (fragment && targetStat.isFile() && /\.md$/i.test(target)) {
          const { anchors } = await document(target);
          if (!anchors.has(fragment)) errors.push(`${location}: unknown Markdown heading: ${url}`);
        }
      } catch (error) {
        errors.push(`${location}: invalid local link ${url}: ${error.code ?? error.message}`);
      }
    }
  }
  return errors;
}

function containsSelfHosted(value, seen = new Set()) {
  if (typeof value === 'string') return /self-hosted/i.test(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((item) => containsSelfHosted(item, seen));
}

function checkUses(uses, location, errors) {
  if (typeof uses !== 'string') {
    errors.push(`${location}: uses must be a static action reference`);
  } else if (uses.startsWith('./')) {
    return;
  } else if (uses.startsWith('docker://')) {
    if (!/@sha256:[a-f\d]{64}$/i.test(uses))
      errors.push(`${location}: Docker actions must pin an image digest`);
  } else if (!/^[^@\s]+@[a-f\d]{40}$/i.test(uses)) {
    errors.push(`${location}: remote actions must pin a full 40-character commit SHA`);
  }
}

function isReadOnlyContents(permissions) {
  return (
    permissions &&
    typeof permissions === 'object' &&
    !Array.isArray(permissions) &&
    permissions.contents === 'read' &&
    Object.keys(permissions).length === 1
  );
}

export function checkWorkflow(workflow, filename) {
  const errors = [];
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return [`${filename}: workflow must be a YAML object`];
  }
  const triggers =
    typeof workflow.on === 'string'
      ? [workflow.on]
      : Array.isArray(workflow.on)
        ? workflow.on
        : Object.keys(workflow.on ?? {});
  if (triggers.includes('pull_request_target'))
    errors.push(`${filename}: pull_request_target is forbidden`);
  const isCi = /^ci\.ya?ml$/i.test(path.basename(filename));
  if (isCi && !isReadOnlyContents(workflow.permissions)) {
    errors.push(`${filename}: CI must declare only permissions: contents: read`);
  }
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    const location = `${filename}: jobs.${jobName}`;
    if (containsSelfHosted(job['runs-on']))
      errors.push(`${location}: self-hosted runners are forbidden`);
    if (isCi && job.permissions !== undefined && !isReadOnlyContents(job.permissions)) {
      errors.push(`${location}: CI jobs may only request contents: read`);
    }
    if (job.uses !== undefined) checkUses(job.uses, location, errors);
    for (const [index, step] of (job.steps ?? []).entries()) {
      if (step.uses === undefined) continue;
      const stepLocation = `${location}.steps[${index}]`;
      checkUses(step.uses, stepLocation, errors);
      if (/^actions\/checkout@/i.test(step.uses) && step.with?.['persist-credentials'] !== false) {
        errors.push(`${stepLocation}: checkout must set persist-credentials: false`);
      }
    }
  }
  return errors;
}

export function checkYaml(source, filename) {
  const isWorkflow = /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(filename);
  const documents = isWorkflow
    ? [parseDocument(source, { prettyErrors: false })]
    : parseAllDocuments(source, { prettyErrors: false });
  const errors = documents.flatMap((document) =>
    document.errors.map((error) => `${filename}: ${error.message}`),
  );
  if (errors.length || !isWorkflow) return errors;
  try {
    return checkWorkflow(documents[0].toJS({ maxAliasCount: 100 }), filename);
  } catch (error) {
    return [`${filename}: ${error.message}`];
  }
}

export async function checkRepository(root) {
  const files = listRepositoryFiles(root);
  const markdownFiles = files.filter((file) => /\.md$/i.test(file));
  const errors = await checkMarkdownLinks(root, markdownFiles);
  for (const filename of files.filter((file) => /\.ya?ml$/i.test(file))) {
    errors.push(...checkYaml(await readFile(path.resolve(root, filename), 'utf8'), filename));
  }
  return { errors, markdownCount: markdownFiles.length };
}

async function main() {
  const { errors, markdownCount } = await checkRepository(process.cwd());
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    `Repository links, YAML, and workflow policies passed (${markdownCount} Markdown files).`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
