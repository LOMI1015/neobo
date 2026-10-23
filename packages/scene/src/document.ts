import * as z from 'zod';
import { sceneThemeReferenceSchema } from '@neobo/theme';

export const SCENE_SCHEMA_VERSION = 1;

export const SCENE_LIMITS = Object.freeze({
  maxNodes: 1_000,
  maxDepth: 32,
  maxIdentifierLength: 64,
  maxTextLength: 10_000,
  maxChartDataPoints: 100,
  maxChartCategoryLength: 100,
  maxChartValue: 1e12,
  maxDimension: 16_384,
  maxPosition: 1_000_000,
  maxRotation: 360_000,
  maxIssues: 20,
});

const issueCodes = [
  'UNSUPPORTED_VERSION',
  'INVALID_DOCUMENT',
  'INVALID_VALUE',
  'DUPLICATE_ID',
  'INVALID_REFERENCE',
  'CYCLE',
  'DEPTH_LIMIT',
] as const;

export type SceneValidationCode = (typeof issueCodes)[number];

export interface SceneValidationIssue {
  readonly code: SceneValidationCode;
  readonly path: readonly (string | number)[];
}

export type DeepReadonly<T> = T extends object
  ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T;

export const identifierSchema = z
  .string()
  .max(SCENE_LIMITS.maxIdentifierLength)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const dimensionSchema = z.number().positive().max(SCENE_LIMITS.maxDimension);
export const transformSchema = z.strictObject({
  x: z.number().min(-SCENE_LIMITS.maxPosition).max(SCENE_LIMITS.maxPosition),
  y: z.number().min(-SCENE_LIMITS.maxPosition).max(SCENE_LIMITS.maxPosition),
  width: dimensionSchema,
  height: dimensionSchema,
  rotation: z.number().min(-SCENE_LIMITS.maxRotation).max(SCENE_LIMITS.maxRotation),
});
const commonNodeShape = {
  id: identifierSchema,
  transform: transformSchema,
  visible: z.boolean(),
};
export const barChartDataSchema = z
  .array(
    z.strictObject({
      category: z.string().min(1).max(SCENE_LIMITS.maxChartCategoryLength).regex(/\S/u),
      value: z.number().min(-SCENE_LIMITS.maxChartValue).max(SCENE_LIMITS.maxChartValue),
    }),
  )
  .max(SCENE_LIMITS.maxChartDataPoints);

export const nodeSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...commonNodeShape,
    type: z.literal('bar-chart'),
    componentVersion: z.literal(1),
    data: barChartDataSchema,
  }),
  z.strictObject({
    ...commonNodeShape,
    type: z.literal('text'),
    componentVersion: z.literal(1),
    text: z.string().max(SCENE_LIMITS.maxTextLength),
  }),
  z.strictObject({
    ...commonNodeShape,
    type: z.literal('rectangle'),
    componentVersion: z.literal(1),
  }),
  z.strictObject({
    ...commonNodeShape,
    type: z.literal('group'),
    children: z.array(identifierSchema).max(SCENE_LIMITS.maxNodes),
  }),
]);
const documentShapeSchema = z.strictObject({
  schemaVersion: z.literal(SCENE_SCHEMA_VERSION),
  id: identifierSchema,
  revision: z.int().nonnegative(),
  canvas: z.strictObject({ width: dimensionSchema, height: dimensionSchema }),
  theme: sceneThemeReferenceSchema.optional(),
  rootIds: z.array(identifierSchema).max(SCENE_LIMITS.maxNodes),
  nodes: z.array(nodeSchema).max(SCENE_LIMITS.maxNodes),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addIssue(
  context: z.RefinementCtx,
  code: SceneValidationCode,
  path: (string | number)[],
): void {
  context.addIssue({
    code: 'custom',
    message: 'Invalid scene document',
    path,
    params: { sceneCode: code },
  });
}

function preflight(input: unknown, context: z.RefinementCtx): void {
  if (!isRecord(input)) return;
  if (Object.hasOwn(input, 'schemaVersion') && input.schemaVersion !== SCENE_SCHEMA_VERSION) {
    addIssue(context, 'UNSUPPORTED_VERSION', ['schemaVersion']);
    return;
  }

  const nodes = input.nodes;
  const rootIds = input.rootIds;
  if (Array.isArray(nodes) && nodes.length > SCENE_LIMITS.maxNodes) {
    addIssue(context, 'INVALID_VALUE', ['nodes']);
    return;
  }
  if (Array.isArray(rootIds) && rootIds.length > SCENE_LIMITS.maxNodes) {
    addIssue(context, 'INVALID_VALUE', ['rootIds']);
    return;
  }
  if (!Array.isArray(nodes)) return;

  // 合法树的引用总数等于节点数，先限制总量，避免在结构校验前遍历大量重复引用。
  let references = Array.isArray(rootIds) ? rootIds.length : 0;
  for (const [index, node] of nodes.entries()) {
    if (!isRecord(node)) continue;
    // 数组超限先返回，避免校验器继续逐条解析图表内容。
    if (Array.isArray(node.data) && node.data.length > SCENE_LIMITS.maxChartDataPoints) {
      addIssue(context, 'INVALID_VALUE', ['nodes', index, 'data']);
      return;
    }
    if (!Array.isArray(node.children)) continue;
    references += node.children.length;
    if (references > SCENE_LIMITS.maxNodes) {
      addIssue(context, 'INVALID_VALUE', ['nodes', index, 'children']);
      return;
    }
  }
}

function validateStructure(
  document: z.infer<typeof documentShapeSchema>,
  context: z.RefinementCtx,
): void {
  let issueCount = 0;
  const report = (code: SceneValidationCode, path: (string | number)[]): void => {
    if (issueCount >= SCENE_LIMITS.maxIssues) return;
    issueCount += 1;
    addIssue(context, code, path);
  };
  const indexes = new Map<string, number>();
  for (const [index, node] of document.nodes.entries()) {
    if (indexes.has(node.id)) report('DUPLICATE_ID', ['nodes', index, 'id']);
    else indexes.set(node.id, index);
  }
  if (issueCount > 0) return;

  const referenced = new Set<string>();
  const reference = (id: string, path: (string | number)[]): void => {
    if (!indexes.has(id) || referenced.has(id)) report('INVALID_REFERENCE', path);
    referenced.add(id);
  };
  document.rootIds.forEach((id, index) => reference(id, ['rootIds', index]));
  document.nodes.forEach((node, nodeIndex) => {
    if (node.type !== 'group') return;
    node.children.forEach((id, index) => reference(id, ['nodes', nodeIndex, 'children', index]));
  });

  // 从全部节点检查环，不能只检查根节点可达部分，否则孤立环会被漏掉。
  const state = new Map<string, 'visiting' | 'visited'>();
  for (const node of document.nodes) {
    if (state.has(node.id)) continue;
    const stack = [{ id: node.id, nextChild: 0 }];
    state.set(node.id, 'visiting');
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame) break;
      const nodeIndex = indexes.get(frame.id);
      if (nodeIndex === undefined) {
        stack.pop();
        continue;
      }
      const current = document.nodes[nodeIndex];
      if (!current || current.type !== 'group' || frame.nextChild >= current.children.length) {
        state.set(frame.id, 'visited');
        stack.pop();
        continue;
      }
      const childIndex = frame.nextChild;
      frame.nextChild += 1;
      const child = current.children[childIndex];
      if (child === undefined || !indexes.has(child)) continue;
      if (state.get(child) === 'visiting') {
        report('CYCLE', ['nodes', nodeIndex, 'children', childIndex]);
      } else if (!state.has(child)) {
        state.set(child, 'visiting');
        stack.push({ id: child, nextChild: 0 });
      }
    }
  }

  const reachable = new Set<string>();
  const pending = document.rootIds.map((id) => ({ id, depth: 1 }));
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry || reachable.has(entry.id)) continue;
    reachable.add(entry.id);
    const index = indexes.get(entry.id);
    if (index === undefined) continue;
    const node = document.nodes[index];
    if (!node) continue;
    if (entry.depth > SCENE_LIMITS.maxDepth) report('DEPTH_LIMIT', ['nodes', index]);
    if (node.type === 'group') {
      pending.push(...node.children.map((id) => ({ id, depth: entry.depth + 1 })));
    }
  }
  document.nodes.forEach((node, index) => {
    if (!referenced.has(node.id) || !reachable.has(node.id)) {
      report('INVALID_REFERENCE', ['nodes', index, 'id']);
    }
  });
}

const sceneDocumentSchema = z
  .unknown()
  .superRefine(preflight)
  .pipe(documentShapeSchema)
  .superRefine(validateStructure);

export type SceneDocument = DeepReadonly<z.infer<typeof sceneDocumentSchema>>;
export type SceneNode = SceneDocument['nodes'][number];
export type TextNode = Extract<SceneNode, { type: 'text' }>;
export type RectangleNode = Extract<SceneNode, { type: 'rectangle' }>;
export type BarChartNode = Extract<SceneNode, { type: 'bar-chart' }>;
export type BarChartDatum = BarChartNode['data'][number];
export type GroupNode = Extract<SceneNode, { type: 'group' }>;

export type SceneValidationResult =
  | { readonly success: true; readonly data: SceneDocument }
  | { readonly success: false; readonly issues: readonly SceneValidationIssue[] };

const knownFields = new Set([
  'schemaVersion',
  'id',
  'revision',
  'canvas',
  'theme',
  'version',
  'width',
  'height',
  'rootIds',
  'nodes',
  'transform',
  'x',
  'y',
  'rotation',
  'visible',
  'type',
  'componentVersion',
  'text',
  'data',
  'category',
  'value',
  'children',
]);

function issueCode(issue: z.core.$ZodIssue): SceneValidationCode {
  if (issue.code === 'custom') {
    const candidate: unknown = issue.params?.sceneCode;
    for (const code of issueCodes) {
      if (candidate === code) return code;
    }
  }
  return issue.code === 'invalid_type' || issue.code === 'unrecognized_keys'
    ? 'INVALID_DOCUMENT'
    : 'INVALID_VALUE';
}

export function validateSceneDocument(input: unknown): SceneValidationResult {
  const result = sceneDocumentSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };

  return {
    success: false,
    issues: result.error.issues.slice(0, SCENE_LIMITS.maxIssues).map((issue) => ({
      code: issueCode(issue),
      // 只输出协议字段与有界下标，未知字段名和库错误原文不能进入对外错误。
      path: issue.path.filter(
        (part): part is string | number =>
          (typeof part === 'string' && knownFields.has(part)) ||
          (typeof part === 'number' &&
            Number.isInteger(part) &&
            part >= 0 &&
            part < SCENE_LIMITS.maxNodes),
      ),
    })),
  };
}

export function createEmptyScene(options: {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}): SceneDocument {
  const result = validateSceneDocument({
    schemaVersion: SCENE_SCHEMA_VERSION,
    id: options.id,
    revision: 0,
    canvas: { width: options.width, height: options.height },
    rootIds: [],
    nodes: [],
  });
  if (!result.success) throw new Error('场景标识或画布尺寸无效。');
  return result.data;
}
