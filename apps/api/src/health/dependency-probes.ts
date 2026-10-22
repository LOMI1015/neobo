import { Client } from 'pg';
import { createClient } from 'redis';
import type { ApiConfig } from '../config.js';

export interface DependencyProbes {
  postgres: () => Promise<boolean>;
  redis: () => Promise<boolean>;
}

export async function probePostgres(config: ApiConfig): Promise<boolean> {
  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.dependencyTimeoutMs,
    query_timeout: config.dependencyTimeoutMs,
    statement_timeout: config.dependencyTimeoutMs,
    application_name: 'neobo-readiness',
  });
  let failed = false;
  client.on('error', () => {
    failed = true;
  });

  try {
    await client.connect();
    await client.query('SELECT 1');
    return !failed;
  } catch {
    // Readiness reports only availability; driver errors can contain credentials.
    return false;
  } finally {
    await client.end();
  }
}

export async function probeRedis(config: ApiConfig): Promise<boolean> {
  const client = createClient({
    url: config.redisUrl,
    socket: {
      connectTimeout: config.dependencyTimeoutMs,
      reconnectStrategy: false,
    },
    disableOfflineQueue: true,
    commandsQueueMaxLength: 8,
  });
  let failed = false;
  client.on('error', () => {
    failed = true;
  });
  let timer: NodeJS.Timeout | undefined;

  try {
    const operation = (async () => {
      await client.connect();
      return (await client.ping()) === 'PONG' && !failed;
    })();
    // The socket timeout alone does not bound a connected server's handshake/PING.
    return await Promise.race([
      operation,
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(false), config.dependencyTimeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    if (client.isOpen) client.destroy();
  }
}

export function createDependencyProbes(config: ApiConfig): DependencyProbes {
  return {
    postgres: () => probePostgres(config),
    redis: () => probeRedis(config),
  };
}
