import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../src/config.js';
import { probePostgres, probeRedis } from '../src/health/dependency-probes.js';

describe('readiness connection deadlines', () => {
  it('times out silent local peers and closes every probe socket', async () => {
    const sockets = new Set<Socket>();
    let connectionCount = 0;
    const server = createServer((socket) => {
      connectionCount += 1;
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => socket.destroy());
      socket.resume();
    });
    await new Promise<void>((resolveListening, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolveListening());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a local TCP listener');
    const config = {
      ...parseConfig({
        DATABASE_URL: `postgresql://neobo:test-only-secret@127.0.0.1:${address.port}/neobo`,
        REDIS_URL: `redis://:test-only-secret@127.0.0.1:${address.port}`,
      }),
      dependencyTimeoutMs: 100,
    };

    try {
      expect(await Promise.all([probePostgres(config), probeRedis(config)])).toEqual([
        false,
        false,
      ]);
      await vi.waitFor(() => expect(sockets.size).toBe(0), { timeout: 1_000 });
      expect(connectionCount).toBe(2);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClosed, reject) => {
        server.close((error) => (error ? reject(error) : resolveClosed()));
      });
    }
  });
});
