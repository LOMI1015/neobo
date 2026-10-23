import * as z from 'zod';
import { sceneThemeReferenceSchema } from '@neobo/theme';
import {
  barChartDataSchema,
  identifierSchema,
  nodeSchema,
  SCENE_LIMITS,
  transformSchema,
  validateSceneDocument,
} from './document.js';
import type { DeepReadonly, SceneDocument, SceneNode } from './document.js';

export const SCENE_COMMAND_LIMITS = Object.freeze({ maxOperations: 100 });

function hasDefinedChanges(value: Record<string, unknown>): boolean {
  const values = Object.values(value);
  return values.length > 0 && values.every((entry) => entry !== undefined);
}

const transformChangesSchema = transformSchema.partial().refine(hasDefinedChanges);
const changesSchema = z
  .strictObject({
    transform: transformChangesSchema.optional(),
    visible: z.boolean().optional(),
    text: z.string().max(SCENE_LIMITS.maxTextLength).optional(),
    data: barChartDataSchema.optional(),
  })
  .refine(hasDefinedChanges);
const destinationShape = {
  parentId: identifierSchema.nullable(),
  index: z.int().nonnegative(),
};
const operationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('scene.theme.set'), theme: sceneThemeReferenceSchema }),
  z.strictObject({ type: z.literal('node.add'), node: nodeSchema, ...destinationShape }),
  z.strictObject({
    type: z.literal('node.update'),
    nodeId: identifierSchema,
    changes: changesSchema,
  }),
  z.strictObject({ type: z.literal('node.remove'), nodeId: identifierSchema }),
  z.strictObject({ type: z.literal('node.move'), nodeId: identifierSchema, ...destinationShape }),
]);
const revisionRequestShape = {
  sceneId: identifierSchema,
  baseRevision: z.int().nonnegative(),
};
const revisionRequestSchema = z.strictObject(revisionRequestShape);

function withinChartDataLimit(value: unknown): boolean {
  return (
    typeof value !== 'object' ||
    value === null ||
    !('data' in value) ||
    !Array.isArray(value.data) ||
    value.data.length <= SCENE_LIMITS.maxChartDataPoints
  );
}

function withinInputLimits(input: unknown): boolean {
  if (typeof input !== 'object' || input === null || !('operations' in input)) return true;
  if (!Array.isArray(input.operations)) return true;
  if (input.operations.length > SCENE_COMMAND_LIMITS.maxOperations) return false;
  // 数组尺寸校验仍会解析元素，先挡住过大的节点引用与图表数据。
  return input.operations.every((operation: unknown) => {
    if (typeof operation !== 'object' || operation === null) return true;
    if ('node' in operation) {
      const node: unknown = operation.node;
      if (!withinChartDataLimit(node)) return false;
      if (
        typeof node === 'object' &&
        node !== null &&
        'children' in node &&
        Array.isArray(node.children) &&
        node.children.length > SCENE_LIMITS.maxNodes
      ) {
        return false;
      }
    }
    return !('changes' in operation) || withinChartDataLimit(operation.changes);
  });
}

const batchSchema = z
  .unknown()
  .refine(withinInputLimits)
  .pipe(
    z.strictObject({
      ...revisionRequestShape,
      operations: z.array(operationSchema).min(1).max(SCENE_COMMAND_LIMITS.maxOperations),
    }),
  );

export type SceneOperation = DeepReadonly<z.infer<typeof operationSchema>>;
export type SceneCommandBatch = DeepReadonly<z.infer<typeof batchSchema>>;
export type SceneCommandErrorCode =
  | 'INVALID_DOCUMENT'
  | 'INVALID_COMMAND'
  | 'SCENE_MISMATCH'
  | 'REVISION_CONFLICT'
  | 'REVISION_EXHAUSTED'
  | 'NODE_NOT_FOUND'
  | 'NODE_EXISTS'
  | 'INVALID_PARENT'
  | 'INVALID_INDEX'
  | 'INVALID_OPERATION'
  | 'INVALID_RESULT';
export type SceneCommandValidationResult =
  | { readonly success: true; readonly data: SceneCommandBatch }
  | { readonly success: false; readonly code: 'INVALID_COMMAND' };
export type SceneCommandResult =
  | { readonly success: true; readonly document: SceneDocument }
  | {
      readonly success: false;
      readonly code: SceneCommandErrorCode;
      readonly operationIndex?: number;
    };

export function validateSceneCommandBatch(input: unknown): SceneCommandValidationResult {
  const result = batchSchema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, code: 'INVALID_COMMAND' };
}

export function validateSceneRevisionRequest(
  input: unknown,
):
  | { readonly success: true; readonly data: DeepReadonly<z.infer<typeof revisionRequestSchema>> }
  | { readonly success: false; readonly code: 'INVALID_COMMAND' } {
  const result = revisionRequestSchema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, code: 'INVALID_COMMAND' };
}

type MutableNode = z.infer<typeof nodeSchema>;
type WorkingDocument = Omit<SceneDocument, 'rootIds' | 'nodes' | 'theme'> & {
  theme?: SceneDocument['theme'];
  rootIds: string[];
  nodes: MutableNode[];
};

function copyNode(node: SceneNode): MutableNode {
  if (node.type === 'group') {
    return { ...node, transform: { ...node.transform }, children: [...node.children] };
  }
  if (node.type === 'bar-chart') {
    return {
      ...node,
      transform: { ...node.transform },
      data: node.data.map((datum) => ({ ...datum })),
    };
  }
  return { ...node, transform: { ...node.transform } };
}

function targetChildren(document: WorkingDocument, parentId: string | null): string[] | undefined {
  if (parentId === null) return document.rootIds;
  const parent = document.nodes.find((node) => node.id === parentId);
  return parent?.type === 'group' ? parent.children : undefined;
}

function currentSiblings(document: WorkingDocument, nodeId: string): string[] | undefined {
  if (document.rootIds.includes(nodeId)) return document.rootIds;
  for (const node of document.nodes) {
    if (node.type === 'group' && node.children.includes(nodeId)) return node.children;
  }
  return undefined;
}

function subtreeIds(document: WorkingDocument, nodeId: string): Set<string> {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const pending = [nodeId];
  const ids = new Set<string>();
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || ids.has(id)) continue;
    ids.add(id);
    const node = nodes.get(id);
    if (node?.type === 'group') pending.push(...node.children);
  }
  return ids;
}

function addNode(
  document: WorkingDocument,
  operation: Extract<SceneOperation, { type: 'node.add' }>,
): SceneCommandErrorCode | undefined {
  if (document.nodes.some((node) => node.id === operation.node.id)) return 'NODE_EXISTS';
  if (operation.node.type === 'group' && operation.node.children.length > 0) {
    return 'INVALID_OPERATION';
  }
  const siblings = targetChildren(document, operation.parentId);
  if (!siblings) return 'INVALID_PARENT';
  if (operation.index > siblings.length) return 'INVALID_INDEX';
  if (document.nodes.length >= SCENE_LIMITS.maxNodes) return 'INVALID_RESULT';
  document.nodes.push(copyNode(operation.node));
  siblings.splice(operation.index, 0, operation.node.id);
  return undefined;
}

function updateNode(
  document: WorkingDocument,
  operation: Extract<SceneOperation, { type: 'node.update' }>,
): SceneCommandErrorCode | undefined {
  const node = document.nodes.find((entry) => entry.id === operation.nodeId);
  if (!node) return 'NODE_NOT_FOUND';
  const { changes } = operation;
  if (changes.text !== undefined && node.type !== 'text') return 'INVALID_OPERATION';
  if (changes.data !== undefined && node.type !== 'bar-chart') return 'INVALID_OPERATION';
  if (changes.text !== undefined && node.type === 'text') {
    node.text = changes.text;
  }
  if (changes.data !== undefined && node.type === 'bar-chart') {
    node.data = changes.data.map((datum) => ({ ...datum }));
  }
  if (changes.visible !== undefined) node.visible = changes.visible;
  if (changes.transform) {
    // 只覆盖显式字段，保持未指定的父局部变换，不隐式执行坐标转换。
    for (const field of ['x', 'y', 'width', 'height', 'rotation'] as const) {
      const value = changes.transform[field];
      if (value !== undefined) node.transform[field] = value;
    }
  }
  return undefined;
}

function removeNode(document: WorkingDocument, nodeId: string): SceneCommandErrorCode | undefined {
  if (!document.nodes.some((node) => node.id === nodeId)) return 'NODE_NOT_FOUND';
  const siblings = currentSiblings(document, nodeId);
  if (!siblings) return 'INVALID_RESULT';
  const removed = subtreeIds(document, nodeId);
  siblings.splice(siblings.indexOf(nodeId), 1);
  document.nodes = document.nodes.filter((node) => !removed.has(node.id));
  return undefined;
}

function moveNode(
  document: WorkingDocument,
  operation: Extract<SceneOperation, { type: 'node.move' }>,
): SceneCommandErrorCode | undefined {
  if (!document.nodes.some((node) => node.id === operation.nodeId)) return 'NODE_NOT_FOUND';
  const target = targetChildren(document, operation.parentId);
  if (!target) return 'INVALID_PARENT';
  if (
    operation.parentId !== null &&
    subtreeIds(document, operation.nodeId).has(operation.parentId)
  ) {
    return 'INVALID_PARENT';
  }
  const source = currentSiblings(document, operation.nodeId);
  if (!source) return 'INVALID_RESULT';
  const targetLength = target.length - (target === source ? 1 : 0);
  if (operation.index > targetLength) return 'INVALID_INDEX';
  source.splice(source.indexOf(operation.nodeId), 1);
  target.splice(operation.index, 0, operation.nodeId);
  return undefined;
}

function applyOperation(
  document: WorkingDocument,
  operation: SceneOperation,
): SceneCommandErrorCode | undefined {
  switch (operation.type) {
    case 'scene.theme.set':
      document.theme = { ...operation.theme };
      return undefined;
    case 'node.add':
      return addNode(document, operation);
    case 'node.update':
      return updateNode(document, operation);
    case 'node.move':
      return moveNode(document, operation);
    case 'node.remove':
      return removeNode(document, operation.nodeId);
  }
}

export function applySceneCommandBatch(document: unknown, input: unknown): SceneCommandResult {
  const parsedDocument = validateSceneDocument(document);
  if (!parsedDocument.success) return { success: false, code: 'INVALID_DOCUMENT' };
  const parsedBatch = validateSceneCommandBatch(input);
  if (!parsedBatch.success) return parsedBatch;
  const current = parsedDocument.data;
  const batch = parsedBatch.data;
  if (batch.sceneId !== current.id) return { success: false, code: 'SCENE_MISMATCH' };
  if (batch.baseRevision !== current.revision) return { success: false, code: 'REVISION_CONFLICT' };
  if (current.revision === Number.MAX_SAFE_INTEGER) {
    return { success: false, code: 'REVISION_EXHAUSTED' };
  }
  const working: WorkingDocument = {
    ...current,
    rootIds: [...current.rootIds],
    nodes: current.nodes.map(copyNode),
  };
  for (const [operationIndex, operation] of batch.operations.entries()) {
    const code = applyOperation(working, operation);
    if (code) return { success: false, code, operationIndex };
    // 每步都复用完整文档约束，不能依赖后续操作修复临时无效的场景。
    if (!validateSceneDocument(working).success) {
      return { success: false, code: 'INVALID_RESULT', operationIndex };
    }
  }
  const result = validateSceneDocument({ ...working, revision: current.revision + 1 });
  return result.success
    ? { success: true, document: result.data }
    : { success: false, code: 'INVALID_RESULT' };
}
