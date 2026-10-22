import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';

const validEnv = {
  DATABASE_URL: 'postgresql://neobo:test-only-secret@127.0.0.1:15432/neobo',
  REDIS_URL: 'redis://:test-only-secret@127.0.0.1:16379',
};

describe('API environment configuration', () => {
  it('defaults to a loopback listener and accepts explicit local settings', () => {
    expect(parseConfig(validEnv)).toMatchObject({ host: '127.0.0.1', port: 3000 });
    expect(parseConfig({ ...validEnv, API_HOST: '0.0.0.0', API_PORT: '3100' })).toMatchObject({
      host: '0.0.0.0',
      port: 3100,
    });
  });

  it.each(['0', '65536', '3000.5', '3e3', '', 'invalid'])(
    'rejects invalid port %s before the server starts',
    (port) => {
      expect(() => parseConfig({ ...validEnv, API_PORT: port })).toThrow('Invalid API_PORT');
    },
  );

  it('rejects unsupported connection protocols without disclosing credentials', () => {
    expect(() =>
      parseConfig({ ...validEnv, DATABASE_URL: 'https://user:test-only-secret@example.com' }),
    ).toThrow('Invalid DATABASE_URL: provide a valid connection URL');
    expect(() =>
      parseConfig({ ...validEnv, REDIS_URL: 'http://:test-only-secret@localhost' }),
    ).toThrow('Invalid REDIS_URL: provide a valid connection URL');
    expect(() => parseConfig({ REDIS_URL: validEnv.REDIS_URL })).toThrow('Invalid DATABASE_URL');
    expect(() => parseConfig({ ...validEnv, API_HOST: 'http://localhost' })).toThrow(
      'Invalid API_HOST',
    );
  });
});
