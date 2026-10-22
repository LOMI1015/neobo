import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const ignoredDirectories = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
  '.next',
  '.output',
  '.pnpm',
]);
const sourcePattern =
  /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html|css|scss|sass|less|glsl|wgsl|sql|py|go|rs)$/i;
export const requiredScripts = ['lint', 'typecheck', 'test', 'build'];

async function entries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function findSource(directory) {
  for (const entry of await entries(directory)) {
    if (entry.isFile() && sourcePattern.test(entry.name)) return path.join(directory, entry.name);
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      const source = await findSource(path.join(directory, entry.name));
      if (source) return source;
    }
  }
  return undefined;
}

export function validatePackageScripts(manifest, location) {
  const errors = [];
  for (const name of requiredScripts) {
    const command = manifest.scripts?.[name];
    if (typeof command !== 'string' || !command.trim()) {
      errors.push(`${location}: missing non-empty ${name} script`);
    } else if (
      /^(?:echo|printf|true|exit\s+0|:)\s*(?:$|\s)/i.test(command.trim()) ||
      /\|\|\s*(?:true\b|exit\s+0\b|:(?:\s|$))/i.test(command) ||
      /passWithNoTests/i.test(command)
    ) {
      errors.push(`${location}: ${name} uses a placeholder or suppresses failures`);
    }
  }
  return errors;
}

export function validateWorkspaceConfig(source) {
  const document = parseDocument(source, { prettyErrors: false });
  if (document.errors.length)
    return document.errors.map((error) => `pnpm-workspace.yaml: ${error.message}`);
  const configured = document.toJS({ maxAliasCount: 100 })?.packages;
  if (
    !Array.isArray(configured) ||
    configured.length !== 2 ||
    !['apps/*', 'packages/*'].every((glob) => configured.includes(glob))
  ) {
    return [
      'pnpm-workspace.yaml: packages must contain exactly apps/* and packages/*, without exclusions',
    ];
  }
  return [];
}

export async function inspectWorkspaces(root) {
  const errors = [];
  const packages = [];
  for (const collection of ['apps', 'packages']) {
    const collectionPath = path.join(root, collection);
    for (const entry of await entries(collectionPath)) {
      if (entry.isFile() && sourcePattern.test(entry.name)) {
        errors.push(
          `${collection}/${entry.name}: source must belong to a package at ${collection}/*`,
        );
      }
      if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) continue;
      const directory = path.join(collectionPath, entry.name);
      const location = `${collection}/${entry.name}`;
      const source = await findSource(directory);
      let manifest;
      try {
        manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') errors.push(`${location}/package.json: ${error.message}`);
        else if (source)
          errors.push(
            `${location}: source exists without a package.json (${path.relative(root, source)})`,
          );
        continue;
      }
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        errors.push(`${location}/package.json: package manifest must be an object`);
        continue;
      }
      errors.push(...validatePackageScripts(manifest, location));
      packages.push(location);
    }
  }
  if (packages.length) {
    try {
      errors.push(
        ...validateWorkspaceConfig(await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')),
      );
    } catch (error) {
      errors.push(`pnpm-workspace.yaml: ${error.message}`);
    }
  }
  return { packages, errors };
}

export function pnpmCommand(pnpmPath) {
  const basename = pnpmPath?.split(/[\\/]/).at(-1);
  if (!basename || !/^pnpm(?:\.[cm]?js|\.exe|\.cmd|\.bat)?$/i.test(basename)) {
    throw new Error(
      'Run workspace checks through pnpm so npm_execpath identifies pnpm (for example: pnpm check).',
    );
  }
  if (/\.(?:cmd|bat)$/i.test(basename)) {
    throw new Error(
      'pnpm .cmd/.bat wrappers are unsupported; use the native pnpm executable or a pnpm JavaScript entrypoint.',
    );
  }
  return /\.[cm]?js$/i.test(basename)
    ? { executable: process.execPath, args: [pnpmPath] }
    : { executable: pnpmPath, args: [] };
}

export function runWorkspaceChecks(root, pnpmPath = process.env.npm_execpath, run = spawnSync) {
  const command = pnpmCommand(pnpmPath);
  for (const script of requiredScripts) {
    const result = run(command.executable, [...command.args, '-r', 'run', script], {
      cwd: root,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const error = new Error(`Workspace ${script} failed (${result.signal ?? result.status}).`);
      error.exitCode = result.status ?? 1;
      throw error;
    }
  }
}

async function main() {
  const root = process.cwd();
  const { packages, errors } = await inspectWorkspaces(root);
  if (errors.length) throw new Error(errors.join('\n'));
  if (!packages.length) {
    console.log(
      'Documentation stage: no application/library packages yet; business build and tests have not run.',
    );
    return;
  }
  console.log(`Checking ${packages.length} workspace package(s).`);
  runWorkspaceChecks(root);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
  });
}
