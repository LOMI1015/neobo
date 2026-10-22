import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly dependencyTimeoutMs: number;
}

function connectionUrl(
  value: string | undefined,
  name: string,
  protocols: readonly string[],
): string {
  try {
    if (!value) throw new Error();
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol) || !parsed.hostname) throw new Error();
    return value;
  } catch {
    // Configuration errors identify the setting, never its credential-bearing value.
    throw new Error(`Invalid ${name}: provide a valid connection URL`);
  }
}

export function parseConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const host = env.API_HOST ?? '127.0.0.1';
  if (host !== 'localhost' && isIP(host) === 0) {
    throw new Error('Invalid API_HOST: use an IP address or localhost');
  }

  const rawPort = env.API_PORT ?? '3000';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid API_PORT: use an integer between 1 and 65535');
  }

  return Object.freeze({
    host,
    port,
    databaseUrl: connectionUrl(env.DATABASE_URL, 'DATABASE_URL', ['postgres:', 'postgresql:']),
    redisUrl: connectionUrl(env.REDIS_URL, 'REDIS_URL', ['redis:', 'rediss:']),
    dependencyTimeoutMs: 1_000,
  });
}

export function loadConfig(): ApiConfig {
  // Both src/ and the compiled dist/ are three levels below the repository root.
  // Explicit process environment values take precedence over the local .env file.
  loadDotenv({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });
  return parseConfig(process.env);
}
