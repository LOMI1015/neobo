import { Writable } from 'node:stream';
import { Body, Controller, Module, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createEmptyScene, SCENE_LIMITS } from '@neobo/scene';
import type { SceneDocument } from '@neobo/scene';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../src/application.js';
import { parseConfig } from '../src/config.js';
import { createRuntimeLogging } from '../src/logging.js';
import type { RuntimeLogging } from '../src/logging.js';
import { SceneDocumentPipe } from '../src/scene/scene-document.pipe.js';

const config = parseConfig({
  DATABASE_URL: 'postgresql://neobo:scene-database-secret@127.0.0.1:15432/neobo',
  REDIS_URL: 'redis://:scene-redis-secret@127.0.0.1:16379',
});
const route = '/api/test/scene-validation';
const secret = 'synthetic-scene-body-secret';
const secretKey = 'synthetic-scene-field-secret';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const handled = vi.fn((scene: SceneDocument) => ({ id: scene.id, nodeCount: scene.nodes.length }));

@Controller('test/scene-validation')
class SceneValidationController {
  @Post()
  validate(@Body(new SceneDocumentPipe()) scene: SceneDocument) {
    return handled(scene);
  }
}

@Module({ controllers: [SceneValidationController] })
class SceneValidationModule {}

function sceneFixture() {
  const transform = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
  return {
    schemaVersion: 1,
    id: 'scene-1',
    revision: 0,
    canvas: { width: 1920, height: 1080 },
    rootIds: ['group-1'],
    nodes: [
      {
        id: 'group-1',
        type: 'group',
        transform: { ...transform },
        visible: true,
        children: ['text-1', 'rectangle-1'],
      },
      {
        id: 'text-1',
        type: 'text',
        componentVersion: 1,
        transform: { ...transform },
        visible: true,
        text: '场景文字',
      },
      {
        id: 'rectangle-1',
        type: 'rectangle',
        componentVersion: 1,
        transform: { ...transform },
        visible: true,
      },
    ],
  };
}

function chartFixture(data: unknown = [{ category: '分类', value: -12.5 }]) {
  return {
    ...createEmptyScene({ id: 'chart-scene', width: 1920, height: 1080 }),
    rootIds: ['chart-1'],
    nodes: [
      {
        id: 'chart-1',
        type: 'bar-chart',
        componentVersion: 1,
        visible: true,
        transform: { x: 0, y: 0, width: 480, height: 320, rotation: 0 },
        data,
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function captureOutput() {
  let text = '';
  const destination = new Writable({
    write(chunk: unknown, _encoding, callback) {
      if (Buffer.isBuffer(chunk)) text += chunk.toString('utf8');
      else if (typeof chunk === 'string') text += chunk;
      else {
        callback(new Error('日志输出必须是文本。'));
        return;
      }
      callback();
    },
  });
  return {
    destination,
    text: () => text,
    records: () =>
      text
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const record: unknown = JSON.parse(line);
          if (!isRecord(record)) throw new Error('日志必须是 JSON 对象。');
          return record;
        }),
  };
}

const invalidScenes = [
  { name: '未知文档版本', payload: () => ({ ...sceneFixture(), schemaVersion: 2 }) },
  {
    name: '未知场景主题',
    payload: () => ({ ...sceneFixture(), theme: { id: secret, version: 1 } }),
  },
  {
    name: '未知主题版本',
    payload: () => ({ ...sceneFixture(), theme: { id: 'deep-blue', version: 2 } }),
  },
  {
    name: '主题引用拒绝额外配置',
    payload: () => ({
      ...sceneFixture(),
      theme: { id: 'deep-blue', version: 1, [secretKey]: secret },
    }),
  },
  {
    name: '未知组件版本',
    payload: () => {
      const scene = sceneFixture();
      return {
        ...scene,
        nodes: scene.nodes.map((node) =>
          node.type === 'text' ? { ...node, componentVersion: 2 } : node,
        ),
      };
    },
  },
  { name: '负修订号', payload: () => ({ ...sceneFixture(), revision: -1 }) },
  {
    name: '图表数值不能使用字符串',
    payload: () => chartFixture([{ category: secret, value: secret }]),
  },
  {
    name: '图表数据行拒绝任意选项',
    payload: () => chartFixture([{ category: secret, value: 1, [secretKey]: secret }]),
  },
  {
    name: '图表分类不能全为空白',
    payload: () => chartFixture([{ category: '   ', value: 0 }]),
  },
  {
    name: '图表数据条数超限',
    payload: () =>
      chartFixture(
        Array.from({ length: SCENE_LIMITS.maxChartDataPoints + 1 }, () => ({
          category: secret,
          value: 1,
        })),
      ),
  },
  {
    name: '非法画布尺寸',
    payload: () => ({ ...sceneFixture(), canvas: { width: 0, height: 1080 } }),
  },
  { name: '未知根字段', payload: () => ({ ...sceneFixture(), [secretKey]: secret }) },
  {
    name: '未知嵌套字段',
    payload: () => ({
      ...sceneFixture(),
      canvas: { width: 1920, height: 1080, [secretKey]: secret },
    }),
  },
  {
    name: '字段类型错误与场景正文',
    payload: () => ({ ...sceneFixture(), revision: secret }),
  },
  {
    name: '组合循环',
    payload: () => {
      const scene = sceneFixture();
      return {
        ...scene,
        nodes: scene.nodes.map((node) =>
          node.type === 'group' ? { ...node, children: ['group-1'] } : node,
        ),
      };
    },
  },
  {
    name: '引用缺失节点',
    payload: () => ({ ...sceneFixture(), rootIds: ['missing-node'] }),
  },
  {
    name: '重复节点标识',
    payload: () => {
      const scene = sceneFixture();
      return { ...scene, nodes: scene.nodes.map((node) => ({ ...node, id: 'duplicate-node' })) };
    },
  },
  {
    name: '节点数组超限',
    payload: () => ({
      ...sceneFixture(),
      nodes: Array.from({ length: SCENE_LIMITS.maxNodes + 1 }, () => null),
    }),
  },
  {
    name: '保留原型字段',
    payload: () => ({ ...sceneFixture(), prototype: secret }),
  },
];

describe('场景请求校验真实 NestJS + Fastify 链路', () => {
  let app: NestFastifyApplication | undefined;
  let logging: RuntimeLogging | undefined;
  let output: ReturnType<typeof captureOutput> | undefined;

  beforeEach(() => {
    handled.mockClear();
  });

  afterEach(async () => {
    try {
      await app?.close();
    } finally {
      try {
        await logging?.close();
      } finally {
        output?.destination.destroy();
        app = undefined;
        logging = undefined;
        output = undefined;
      }
    }
  });

  async function start() {
    const captured = captureOutput();
    output = captured;
    const runtime = createRuntimeLogging({
      environment: 'test',
      destination: captured.destination,
    });
    logging = runtime;
    const application = await createApplication(config, undefined, {
      logging: runtime,
      rootModule: SceneValidationModule,
    });
    app = application;
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
    return { app: application, logging: runtime, output: captured };
  }

  function assertSafeFailure(
    response: LightMyRequestResponse,
    captured: ReturnType<typeof captureOutput>,
    statusCode = 400,
  ): string {
    const requestId = response.headers['x-request-id'];
    expect(requestId).toEqual(expect.stringMatching(uuidPattern));
    if (typeof requestId !== 'string') throw new Error('响应缺少服务端请求标识。');
    const code = statusCode === 413 ? 'HTTP_PAYLOAD_TOO_LARGE' : 'HTTP_BAD_REQUEST';
    expect(response.statusCode).toBe(statusCode);
    expect(response.json<unknown>()).toEqual({
      statusCode,
      code,
      message: 'Request failed',
      requestId,
    });
    const records = captured.records().filter((record) => record.requestId === requestId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      event: 'http.completed',
      requestId,
      route,
      statusCode,
      errorCode: code,
      outcome: 'failure',
    });
    for (const value of [secret, secretKey, config.databaseUrl, config.redisUrl]) {
      expect(response.body).not.toContain(value);
      expect(captured.text()).not.toContain(value);
    }
    expect(captured.text()).not.toContain('ZodError');
    expect(captured.text()).not.toContain('http.error');
    return requestId;
  }

  it('合法的文字、矩形和组合经过校验后进入控制器', async () => {
    const fixture = await start();
    const scene = sceneFixture();
    const response = await fixture.app.inject({ method: 'POST', url: route, payload: scene });
    expect(response.statusCode).toBe(201);
    expect(response.json<unknown>()).toEqual({ id: scene.id, nodeCount: 3 });
    expect(handled).toHaveBeenCalledExactlyOnceWith(scene);
    const requestId = response.headers['x-request-id'];
    expect(requestId).toEqual(expect.stringMatching(uuidPattern));
    expect(fixture.output.records().filter((record) => record.requestId === requestId)).toEqual([
      expect.objectContaining({
        event: 'http.completed',
        route,
        statusCode: 201,
        outcome: 'success',
      }),
    ]);
    expect(fixture.logging.requestId()).toBeUndefined();
    const missing = await fixture.app.inject({
      method: 'POST',
      url: '/test/scene-validation',
      payload: scene,
    });
    expect(missing.statusCode).toBe(404);
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it.each(invalidScenes)('$name：返回脱敏400且不执行控制器', async ({ payload }) => {
    const fixture = await start();
    const response = await fixture.app.inject({
      method: 'POST',
      url: route,
      payload: payload(),
      headers: { 'x-request-id': secret },
    });
    assertSafeFailure(response, fixture.output);
    expect(handled).not.toHaveBeenCalled();
  });

  it('柱状图的静态数据经过共享校验后进入控制器，不记录分类正文', async () => {
    const fixture = await start();
    const scene = chartFixture([{ category: secret, value: -12.5 }]);
    const response = await fixture.app.inject({ method: 'POST', url: route, payload: scene });
    expect(response.statusCode).toBe(201);
    expect(handled).toHaveBeenCalledExactlyOnceWith(scene);
    expect(fixture.output.text()).not.toContain(secret);
  });

  it('场景主题引用经过真实请求校验，正文不进入日志', async () => {
    const fixture = await start();
    const scene = { ...chartFixture(), theme: { id: 'deep-blue', version: 1 } };
    const response = await fixture.app.inject({ method: 'POST', url: route, payload: scene });
    expect(response.statusCode).toBe(201);
    expect(handled).toHaveBeenCalledExactlyOnceWith(scene);
    const parsed = handled.mock.calls[0]?.[0];
    expect(parsed?.theme).toEqual(scene.theme);
    expect(parsed?.theme).not.toBe(scene.theme);
    expect(fixture.output.text()).not.toContain('deep-blue');
  });

  it.each([
    {
      name: '无效JSON',
      request: { payload: `{"text":"${secret}",` },
      statusCode: 400,
    },
    {
      name: '超大JSON',
      request: { payload: JSON.stringify({ text: secret, value: 'x'.repeat(1_048_576) }) },
      statusCode: 413,
    },
    {
      name: 'JSON原型污染字段',
      request: { payload: `{"__proto__":{"text":"${secret}"}}` },
      statusCode: 400,
    },
  ] satisfies { name: string; request: InjectOptions; statusCode: number }[])(
    '$name：在控制器前拒绝且保留受控错误响应',
    async ({ request, statusCode }) => {
      const fixture = await start();
      const validation = vi.spyOn(SceneDocumentPipe.prototype, 'transform');
      try {
        const response = await fixture.app.inject({
          method: 'POST',
          url: route,
          headers: { 'content-type': 'application/json' },
          ...request,
        });
        assertSafeFailure(response, fixture.output, statusCode);
        expect(validation).not.toHaveBeenCalled();
        expect(handled).not.toHaveBeenCalled();
      } finally {
        validation.mockRestore();
      }
    },
  );

  it('并发成功和失败请求使用不同服务端标识且上下文释放', async () => {
    const fixture = await start();
    const [accepted, rejected] = await Promise.all([
      fixture.app.inject({ method: 'POST', url: route, payload: sceneFixture() }),
      fixture.app.inject({
        method: 'POST',
        url: route,
        payload: { ...sceneFixture(), [secretKey]: secret },
      }),
    ]);
    expect(accepted.statusCode).toBe(201);
    const rejectedId = assertSafeFailure(rejected, fixture.output);
    expect(accepted.headers['x-request-id']).toEqual(expect.stringMatching(uuidPattern));
    expect(accepted.headers['x-request-id']).not.toBe(rejectedId);
    expect(handled).toHaveBeenCalledTimes(1);
    expect(fixture.logging.requestId()).toBeUndefined();
  });
});

describe('场景Pipe保持共享契约边界', () => {
  it('接受冻结输入并返回独立的校验副本', () => {
    const scene = createEmptyScene({ id: 'empty-scene', width: 1920, height: 1080 });
    Object.freeze(scene.canvas);
    Object.freeze(scene.rootIds);
    Object.freeze(scene.nodes);
    Object.freeze(scene);
    const parsed = new SceneDocumentPipe().transform(scene);
    expect(parsed).toEqual(scene);
    expect(parsed).not.toBe(scene);
    expect(parsed.canvas).not.toBe(scene.canvas);
    expect(parsed.nodes).not.toBe(scene.nodes);
  });

  it('拒绝保留字段时不修改被冻结的原输入', () => {
    const input = Object.freeze({
      ...createEmptyScene({ id: 'frozen-scene', width: 1920, height: 1080 }),
      constructor: secret,
      prototype: secret,
    });
    const before = structuredClone(input);
    expect(() => new SceneDocumentPipe().transform(input)).toThrow('Bad Request');
    expect(input).toEqual(before);
    expect(input.constructor).toBe(secret);
    expect(input.prototype).toBe(secret);
  });
});
