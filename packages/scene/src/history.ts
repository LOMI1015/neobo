import * as z from 'zod';
import {
  applySceneCommandBatch,
  validateSceneRevisionRequest,
  type SceneCommandErrorCode,
  type SceneCommandResult,
} from './commands.js';
import { validateSceneDocument, type SceneDocument } from './document.js';

export const SCENE_HISTORY_LIMITS = Object.freeze({
  maxEntries: 100,
  maxBytes: 16 * 1024 * 1024,
});

export interface SceneHistoryOptions {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

export type SceneHistoryErrorCode = SceneCommandErrorCode | 'HISTORY_EMPTY' | 'HISTORY_CAPACITY';

export type SceneHistoryResult =
  | SceneCommandResult
  | { readonly success: false; readonly code: 'HISTORY_EMPTY' | 'HISTORY_CAPACITY' };

export interface SceneHistory {
  current(): SceneDocument;
  execute(batch: unknown): SceneHistoryResult;
  undo(request: unknown): SceneHistoryResult;
  redo(request: unknown): SceneHistoryResult;
  canUndo(): boolean;
  canRedo(): boolean;
  clear(): void;
}

const optionsSchema = z.strictObject({
  maxEntries: z
    .int()
    .min(1)
    .max(SCENE_HISTORY_LIMITS.maxEntries)
    .default(SCENE_HISTORY_LIMITS.maxEntries),
  maxBytes: z
    .int()
    .min(1)
    .max(SCENE_HISTORY_LIMITS.maxBytes)
    .default(SCENE_HISTORY_LIMITS.maxBytes),
});

interface Snapshot {
  readonly document: SceneDocument;
  readonly bytes: number;
}

function snapshot(document: SceneDocument): Snapshot {
  let bytes = 0;
  // 统一预留最大修订号位数，避免撤销时 revision 进位使已接受的快照超预算。
  // 只计可序列化文档的 UTF-8 字节；不引入浏览器或 Node 专有编码依赖。
  for (const character of JSON.stringify({ ...document, revision: Number.MAX_SAFE_INTEGER })) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return { document, bytes };
}

function copyDocument(document: SceneDocument): SceneDocument {
  const result = validateSceneDocument(document);
  if (!result.success) throw new Error('场景历史内部状态无效。');
  return result.data;
}

function fitHistory(
  past: Snapshot[],
  future: Snapshot[],
  protectedSnapshot: Snapshot,
  maxEntries: number,
  maxBytes: number,
): boolean {
  let bytes = [...past, ...future].reduce((total, entry) => total + entry.bytes, 0);
  while (past.length + future.length > maxEntries || bytes > maxBytes) {
    const canDropPast = past.length > 0 && past[0] !== protectedSnapshot;
    const canDropFuture = future.length > 0 && future[0] !== protectedSnapshot;
    if (!canDropPast && !canDropFuture) return false;
    // 栈尾离当前最近；优先删除较长栈的栈头，等距时先删 past。
    // 本次保存的当前快照必须保留，保证刚执行的操作仍可立即反向执行。
    const entries = canDropPast && (!canDropFuture || past.length >= future.length) ? past : future;
    const removed = entries.shift();
    if (removed) bytes -= removed.bytes;
  }
  return true;
}

export function createSceneHistory(initial: unknown, options: unknown = {}): SceneHistory {
  const configuration = optionsSchema.safeParse(options);
  if (!configuration.success) throw new Error('场景历史配置无效。');
  const validation = validateSceneDocument(initial);
  if (!validation.success) throw new Error('初始场景文档无效。');

  const { maxEntries, maxBytes } = configuration.data;
  let current = snapshot(validation.data);
  if (current.bytes > maxBytes) throw new Error('场景历史容量不足。');
  let past: Snapshot[] = [];
  let future: Snapshot[] = [];

  const commit = (
    document: SceneDocument,
    nextPast: Snapshot[],
    nextFuture: Snapshot[],
  ): SceneHistoryResult => {
    const next = snapshot(document);
    if (next.bytes > maxBytes || !fitHistory(nextPast, nextFuture, current, maxEntries, maxBytes)) {
      return { success: false, code: 'HISTORY_CAPACITY' };
    }
    // 所有检查通过后一次性替换；失败不丢历史，也不消耗修订号。
    current = next;
    past = nextPast;
    future = nextFuture;
    return { success: true, document: copyDocument(current.document) };
  };

  const restore = (request: unknown, direction: 'undo' | 'redo'): SceneHistoryResult => {
    const parsed = validateSceneRevisionRequest(request);
    if (!parsed.success) return parsed;
    if (parsed.data.sceneId !== current.document.id)
      return { success: false, code: 'SCENE_MISMATCH' };
    if (parsed.data.baseRevision !== current.document.revision) {
      return { success: false, code: 'REVISION_CONFLICT' };
    }
    const target = (direction === 'undo' ? past : future).at(-1);
    if (!target) return { success: false, code: 'HISTORY_EMPTY' };
    if (current.document.revision === Number.MAX_SAFE_INTEGER) {
      return { success: false, code: 'REVISION_EXHAUSTED' };
    }
    const nextPast = [...past];
    const nextFuture = [...future];
    if (direction === 'undo') {
      nextPast.pop();
      nextFuture.push(current);
    } else {
      nextFuture.pop();
      nextPast.push(current);
    }
    return commit(
      { ...target.document, revision: current.document.revision + 1 },
      nextPast,
      nextFuture,
    );
  };

  return {
    current: () => copyDocument(current.document),
    execute(batch) {
      const result = applySceneCommandBatch(current.document, batch);
      if (!result.success) return result;
      return commit(result.document, [...past, current], []);
    },
    undo: (request) => restore(request, 'undo'),
    redo: (request) => restore(request, 'redo'),
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past = [];
      future = [];
    },
  };
}
