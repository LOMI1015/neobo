import { Writable } from 'node:stream';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  Module,
  Post,
} from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createEmptyScene, createSceneHistory } from '@neobo/scene';
import type { SceneCommandBatch, SceneHistory, SceneHistoryResult } from '@neobo/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../src/application.js';
import { parseConfig } from '../src/config.js';
import { createRuntimeLogging } from '../src/logging.js';
import type { RuntimeLogging } from '../src/logging.js';
import { SceneCommandBatchPipe } from '../src/scene/scene-command-batch.pipe.js';

const sessionToken = Symbol('test-scene-session');
const sceneId = 'scene-commands-test';
const route = '/api/test/scene-commands';
const secret = 'synthetic-command-body-secret';
const config = parseConfig({
  DATABASE_URL: 'postgresql://neobo:synthetic-password@127.0.0.1:15432/neobo',
  REDIS_URL: 'redis://:synthetic-redis-password@127.0.0.1:16379',
});

function accepted(result: SceneHistoryResult) {
  if (result.success) return result.document;
  if (result.code === 'REVISION_CONFLICT') throw new ConflictException();
  throw new BadRequestException();
}

// 只在测试模块接入内存会话，生产入口仍等待身份、授权和持久化用例。
@Controller('test/scene-commands')
class TestSceneCommandsController {
  constructor(@Inject(sessionToken) private readonly history: SceneHistory) {}

  @Post()
  execute(@Body(new SceneCommandBatchPipe()) batch: SceneCommandBatch) {
    return accepted(this.history.execute(batch));
  }

  @Post('undo')
  undo(@Body() request: unknown) {
    return accepted(this.history.undo(request));
  }

  @Post('redo')
  redo(@Body() request: unknown) {
    return accepted(this.history.redo(request));
  }
}

@Module({})
class TestSceneCommandsModule {}

function batch(baseRevision = 0) {
  return {
    sceneId,
    baseRevision,
    operations: [
      {
        type: 'node.add',
        parentId: null,
        index: 0,
        node: {
          id: 'text-1',
          type: 'text',
          componentVersion: 1,
          transform: { x: 0, y: 0, width: 100, height: 50, rotation: 0 },
          visible: true,
          text: secret,
        },
      },
      { type: 'node.update', nodeId: 'text-1', changes: { transform: { x: 42 } } },
    ],
  };
}

describe('场景命令经过真实 NestJS 与 Fastify 请求边界', () => {
  let app: NestFastifyApplication | undefined;
  let logging: RuntimeLogging | undefined;
  let destination: Writable | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await app?.close();
    } finally {
      await logging?.close();
      destination?.destroy();
      app = undefined;
      logging = undefined;
      destination = undefined;
    }
  });

  async function start(useTestModule = true) {
    let output = '';
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output += chunk.toString('utf8');
        callback();
      },
    });
    destination = sink;
    const runtime = createRuntimeLogging({ environment: 'test', destination: sink });
    logging = runtime;
    const history = createSceneHistory(
      createEmptyScene({ id: sceneId, width: 1920, height: 1080 }),
    );
    const application = await createApplication(config, undefined, {
      logging: runtime,
      ...(useTestModule && {
        rootModule: {
          module: TestSceneCommandsModule,
          controllers: [TestSceneCommandsController],
          providers: [{ provide: sessionToken, useValue: history }],
        },
      }),
    });
    app = application;
    await application.init();
    await application.getHttpAdapter().getInstance().ready();
    return { app: application, history, output: () => output };
  }

  it('默认应用不暴露测试用的编辑、撤销和重做路由', async () => {
    const fixture = await start(false);
    for (const url of [route, `${route}/undo`, `${route}/redo`]) {
      const response = await fixture.app.inject({ method: 'POST', url, payload: batch() });
      expect(response.statusCode).toBe(404);
    }
    expect(fixture.output()).not.toContain(secret);
  });

  it('一批编辑只递增一次修订，HTTP 撤销与重做恢复完整内容', async () => {
    const fixture = await start();
    const initial = fixture.history.current();
    const edited = await fixture.app.inject({ method: 'POST', url: route, payload: batch() });
    expect(edited.statusCode).toBe(201);
    expect(fixture.history.current()).toMatchObject({
      revision: 1,
      rootIds: ['text-1'],
      nodes: [{ id: 'text-1', text: secret, transform: { x: 42 } }],
    });
    const afterEdit = fixture.history.current();
    const undone = await fixture.app.inject({
      method: 'POST',
      url: `${route}/undo`,
      payload: { sceneId, baseRevision: 1 },
    });
    expect(undone.statusCode).toBe(201);
    expect(fixture.history.current()).toEqual({ ...initial, revision: 2 });
    const redone = await fixture.app.inject({
      method: 'POST',
      url: `${route}/redo`,
      payload: { sceneId, baseRevision: 2 },
    });
    expect(redone.statusCode).toBe(201);
    expect(fixture.history.current()).toEqual({ ...afterEdit, revision: 3 });
    expect(fixture.output()).not.toContain(secret);
  });

  it('同一基础修订的并发请求只接受一次，另一请求返回安全 409', async () => {
    const fixture = await start();
    const replies = await Promise.all([
      fixture.app.inject({ method: 'POST', url: route, payload: batch() }),
      fixture.app.inject({ method: 'POST', url: route, payload: batch() }),
    ]);
    expect(replies.map((reply) => reply.statusCode).sort()).toEqual([201, 409]);
    const rejected = replies.find((reply) => reply.statusCode === 409);
    if (!rejected) throw new Error('缺少预期的修订冲突响应。');
    expect(rejected.json<unknown>()).toEqual({
      statusCode: 409,
      code: 'HTTP_CONFLICT',
      message: 'Request failed',
      requestId: rejected.headers['x-request-id'],
    });
    expect(replies[0]?.headers['x-request-id']).not.toBe(replies[1]?.headers['x-request-id']);
    expect(fixture.history.current().revision).toBe(1);
    expect(fixture.output()).not.toContain(secret);
  });

  it('主题切换经过HTTP命令和历史，非法引用不进入执行器，后续失败原子回滚', async () => {
    const fixture = await start();
    await fixture.app.inject({ method: 'POST', url: route, payload: batch() });
    const original = fixture.history.current();
    const switchTheme = {
      sceneId,
      baseRevision: 1,
      operations: [{ type: 'scene.theme.set', theme: { id: 'deep-blue', version: 1 } }],
    };
    const changed = await fixture.app.inject({ method: 'POST', url: route, payload: switchTheme });
    expect(changed.statusCode).toBe(201);
    expect(fixture.history.current()).toEqual({
      ...original,
      revision: 2,
      theme: { id: 'deep-blue', version: 1 },
    });
    const undo = await fixture.app.inject({
      method: 'POST',
      url: `${route}/undo`,
      payload: { sceneId, baseRevision: 2 },
    });
    expect(undo.statusCode).toBe(201);
    expect(fixture.history.current()).toEqual({ ...original, revision: 3 });
    const redo = await fixture.app.inject({
      method: 'POST',
      url: `${route}/redo`,
      payload: { sceneId, baseRevision: 3 },
    });
    expect(redo.statusCode).toBe(201);
    expect(fixture.history.current().theme).toEqual({ id: 'deep-blue', version: 1 });
    const before = fixture.history.current();
    const execute = vi.spyOn(fixture.history, 'execute');
    const invalid = await fixture.app.inject({
      method: 'POST',
      url: route,
      payload: {
        ...switchTheme,
        baseRevision: 4,
        operations: [{ type: 'scene.theme.set', theme: { id: secret, version: 1 } }],
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    const failed = await fixture.app.inject({
      method: 'POST',
      url: route,
      payload: {
        ...switchTheme,
        baseRevision: 4,
        operations: [
          { type: 'scene.theme.set', theme: { id: 'neutral-light', version: 1 } },
          { type: 'node.remove', nodeId: 'missing' },
        ],
      },
    });
    expect(failed.statusCode).toBe(400);
    expect(fixture.history.current()).toEqual(before);
    expect(invalid.body).not.toContain(secret);
    expect(fixture.output()).not.toContain(secret);
    expect(fixture.output()).not.toContain('deep-blue');
  });

  it('柱状图添加、数据替换与删除复用HTTP命令和撤销，非法数据不进入执行器', async () => {
    const fixture = await start();
    const node = {
      id: 'chart-1',
      type: 'bar-chart',
      componentVersion: 1,
      visible: true,
      transform: { x: 0, y: 0, width: 480, height: 320, rotation: 0 },
      data: [{ category: secret, value: 12 }],
    };
    const added = await fixture.app.inject({
      method: 'POST',
      url: route,
      payload: {
        sceneId,
        baseRevision: 0,
        operations: [{ type: 'node.add', node, parentId: null, index: 0 }],
      },
    });
    expect(added.statusCode).toBe(201);
    const changedData = [{ category: secret, value: -7.5 }];
    const updated = await fixture.app.inject({
      method: 'POST',
      url: route,
      payload: {
        sceneId,
        baseRevision: 1,
        operations: [{ type: 'node.update', nodeId: node.id, changes: { data: changedData } }],
      },
    });
    expect(updated.statusCode).toBe(201);
    expect(fixture.history.current().nodes[0]).toMatchObject({ data: changedData });
    const undone = await fixture.app.inject({
      method: 'POST',
      url: `${route}/undo`,
      payload: { sceneId, baseRevision: 2 },
    });
    expect(undone.statusCode).toBe(201);
    expect(fixture.history.current().nodes[0]).toEqual(node);
    const redone = await fixture.app.inject({
      method: 'POST',
      url: `${route}/redo`,
      payload: { sceneId, baseRevision: 3 },
    });
    expect(redone.statusCode).toBe(201);
    expect(fixture.history.current().nodes[0]).toMatchObject({ data: changedData });

    const before = fixture.history.current();
    const execute = vi.spyOn(fixture.history, 'execute');
    const rejected = await fixture.app.inject({
      method: 'POST',
      url: route,
      payload: {
        sceneId,
        baseRevision: 4,
        operations: [
          {
            type: 'node.update',
            nodeId: node.id,
            changes: { data: [{ category: secret, value: secret }] },
          },
        ],
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    expect(fixture.history.current()).toEqual(before);
    expect(rejected.body).not.toContain(secret);
    const removed = await fixture.app.inject({
      method: 'POST',
      url: route,
      payload: {
        sceneId,
        baseRevision: 4,
        operations: [{ type: 'node.remove', nodeId: node.id }],
      },
    });
    expect(removed.statusCode).toBe(201);
    expect(fixture.history.current().nodes).toEqual([]);
    const restored = await fixture.app.inject({
      method: 'POST',
      url: `${route}/undo`,
      payload: { sceneId, baseRevision: 5 },
    });
    expect(restored.statusCode).toBe(201);
    expect(fixture.history.current().nodes[0]).toMatchObject({ data: changedData });
    expect(fixture.output()).not.toContain(secret);
  });

  it('批次后半失败保持原场景和历史不变，响应与日志不泄漏正文', async () => {
    const fixture = await start();
    const initial = fixture.history.current();
    const response = await fixture.app.inject({
      method: 'POST',
      url: route,
      payload: {
        ...batch(),
        operations: [...batch().operations, { type: 'node.remove', nodeId: 'missing-node' }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<unknown>()).toMatchObject({ code: 'HTTP_BAD_REQUEST' });
    expect(fixture.history.current()).toEqual(initial);
    expect(fixture.history.canUndo()).toBe(false);
    expect(response.body).not.toContain(secret);
    expect(fixture.output()).not.toContain(secret);
  });

  it.each([
    { name: '未知字段', value: { ...batch(), [secret]: secret } },
    { name: '字符串修订号', value: { ...batch(), baseRevision: '0' } },
    { name: '空操作列表', value: { ...batch(), operations: [] } },
    {
      name: '任意结构替换',
      value: { ...batch(), operations: [{ type: 'replace', document: secret }] },
    },
  ])('$name 在控制器执行前返回脱敏 400', async ({ value }) => {
    const fixture = await start();
    const execute = vi.spyOn(fixture.history, 'execute');
    const response = await fixture.app.inject({ method: 'POST', url: route, payload: value });
    expect(response.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
    expect(response.body).not.toContain(secret);
    expect(fixture.output()).not.toContain(secret);
  });

  it('错场景请求以及旧修订撤销不能改写当前会话', async () => {
    const fixture = await start();
    const wrongScene = await fixture.app.inject({
      method: 'POST',
      url: route,
      payload: { ...batch(), sceneId: 'other-scene' },
    });
    expect(wrongScene.statusCode).toBe(400);
    await fixture.app.inject({ method: 'POST', url: route, payload: batch() });
    const before = fixture.history.current();
    const oldUndo = await fixture.app.inject({
      method: 'POST',
      url: `${route}/undo`,
      payload: { sceneId, baseRevision: 0 },
    });
    expect(oldUndo.statusCode).toBe(409);
    expect(fixture.history.current()).toEqual(before);
    expect(fixture.history.canUndo()).toBe(true);
  });
});

describe('命令 Pipe 复用严格契约', () => {
  it('返回独立副本并拒绝未知字段，不改写原始输入', () => {
    const input = batch();
    const before = structuredClone(input);
    const parsed = new SceneCommandBatchPipe().transform(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.operations).not.toBe(input.operations);
    expect(input).toEqual(before);
    expect(() => new SceneCommandBatchPipe().transform({ ...input, prototype: secret })).toThrow(
      BadRequestException,
    );
  });
});
