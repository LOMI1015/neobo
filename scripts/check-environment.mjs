import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const expectedNode = (await readFile(new URL('../.node-version', import.meta.url), 'utf8')).trim();
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const expectedPnpm = manifest.packageManager.replace('pnpm@', '');
const actualPnpm = process.env.npm_config_user_agent?.match(/\bpnpm\/(\S+)/)?.[1];
let failures = 0;

function report(ok, message) {
  console.log(`${ok ? 'OK' : 'FAIL'} ${message}`);
  if (!ok) failures += 1;
}

report(
  process.versions.node === expectedNode,
  `Node.js ${expectedNode} required; current ${process.versions.node}. Use nvm use.`,
);
report(
  actualPnpm === expectedPnpm,
  `pnpm ${expectedPnpm} required; current ${actualPnpm ?? 'unknown'}.`,
);

try {
  const local = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'));
  const env = { ...local, ...process.env };
  const required = ['DATABASE_URL', 'REDIS_URL', 'API_HOST', 'API_PORT'];
  const missing = required.filter((name) => !env[name]);
  report(
    missing.length === 0,
    missing.length
      ? `Missing configuration keys: ${missing.join(', ')}.`
      : 'Local environment configuration is present.',
  );
} catch (error) {
  report(
    false,
    error.code === 'ENOENT' ? 'Missing .env. Run pnpm dev:setup.' : 'Unable to read local .env.',
  );
}

for (const [label, args] of [
  ['Docker Compose', ['compose', 'version', '--short']],
  ['Docker daemon', ['info', '--format', '{{.ServerVersion}}']],
  ['Development Compose configuration', ['compose', '-f', 'compose.dev.yml', 'config', '--quiet']],
]) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 10_000 });
  report(
    result.status === 0,
    `${label}${result.status === 0 ? ' is available.' : ' failed; check Docker installation, daemon, and local configuration.'}`,
  );
}

if (failures) process.exitCode = 1;
else
  console.log(
    'Development prerequisites are ready. Start dependencies with pnpm infra:up, then pnpm dev.',
  );
