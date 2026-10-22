import {
  applySceneCommandBatch,
  SCENE_COMMAND_LIMITS,
  type SceneCommandBatch,
  type SceneOperation,
} from './commands.js';
import {
  SCENE_LIMITS,
  validateSceneDocument,
  type SceneDocument,
  type SceneNode,
} from './document.js';

export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

export type SceneGeometryErrorCode =
  | 'INVALID_DOCUMENT'
  | 'INVALID_SELECTION'
  | 'INVALID_GEOMETRY'
  | 'COMMAND_LIMIT'
  | 'REVISION_EXHAUSTED';

export type SceneCommandPlanResult =
  | { readonly success: true; readonly batch: SceneCommandBatch }
  | { readonly success: false; readonly code: SceneGeometryErrorCode };

interface GeometryContext {
  readonly document: SceneDocument;
  readonly nodes: ReadonlyMap<string, SceneNode>;
  readonly parents: ReadonlyMap<string, string | null>;
}

interface RigidTransform {
  readonly cosine: number;
  readonly sine: number;
  readonly x: number;
  readonly y: number;
}

const identity: RigidTransform = { cosine: 1, sine: 0, x: 0, y: 0 };

function geometryContext(document: SceneDocument): GeometryContext | undefined {
  const result = validateSceneDocument(document);
  if (!result.success) return undefined;
  const parents = new Map<string, string | null>(result.data.rootIds.map((id) => [id, null]));
  for (const node of result.data.nodes) {
    if (node.type === 'group') {
      for (const child of node.children) parents.set(child, node.id);
    }
  }
  return {
    document: result.data,
    nodes: new Map(result.data.nodes.map((node) => [node.id, node])),
    parents,
  };
}

function rotation(angle: number): Pick<RigidTransform, 'cosine' | 'sine'> {
  const degrees = angle % 360;
  // 直角使用精确系数，避免边界坐标因 cos(90°) 的浮点尾数越界。
  if (degrees === 0) return { cosine: 1, sine: 0 };
  if (degrees === 90 || degrees === -270) return { cosine: 0, sine: 1 };
  if (degrees === 180 || degrees === -180) return { cosine: -1, sine: 0 };
  if (degrees === 270 || degrees === -90) return { cosine: 0, sine: -1 };
  const radians = (degrees * Math.PI) / 180;
  return { cosine: Math.cos(radians), sine: Math.sin(radians) };
}

function localTransform(node: SceneNode): RigidTransform {
  const { x, y, width, height } = node.transform;
  const { cosine, sine } = rotation(node.transform.rotation);
  const centerX = width / 2;
  const centerY = height / 2;
  return {
    cosine,
    sine,
    x: x + centerX - cosine * centerX + sine * centerY,
    y: y + centerY - sine * centerX - cosine * centerY,
  };
}

function transformPoint(transform: RigidTransform, point: ScenePoint): ScenePoint {
  return {
    x: transform.cosine * point.x - transform.sine * point.y + transform.x,
    y: transform.sine * point.x + transform.cosine * point.y + transform.y,
  };
}

function concatenate(parent: RigidTransform, child: RigidTransform): RigidTransform {
  const origin = transformPoint(parent, child);
  return {
    cosine: parent.cosine * child.cosine - parent.sine * child.sine,
    sine: parent.sine * child.cosine + parent.cosine * child.sine,
    ...origin,
  };
}

function worldTransform(context: GeometryContext, nodeId: string): RigidTransform | undefined {
  const chain: SceneNode[] = [];
  let current = context.nodes.get(nodeId);
  while (current) {
    chain.push(current);
    const parentId = context.parents.get(current.id);
    current = parentId === undefined || parentId === null ? undefined : context.nodes.get(parentId);
  }
  if (chain.length === 0) return undefined;
  let transform = identity;
  for (const node of chain.reverse()) transform = concatenate(transform, localTransform(node));
  return transform;
}

function corners(
  node: SceneNode,
  transform: RigidTransform,
): readonly [ScenePoint, ScenePoint, ScenePoint, ScenePoint] {
  const { width, height } = node.transform;
  return [
    transformPoint(transform, { x: 0, y: 0 }),
    transformPoint(transform, { x: width, y: 0 }),
    transformPoint(transform, { x: width, y: height }),
    transformPoint(transform, { x: 0, y: height }),
  ];
}

export function getNodeWorldCorners(
  document: SceneDocument,
  nodeId: string,
): readonly [ScenePoint, ScenePoint, ScenePoint, ScenePoint] | undefined {
  const context = geometryContext(document);
  if (!context) return undefined;
  const node = context.nodes.get(nodeId);
  const transform = worldTransform(context, nodeId);
  return node && transform ? corners(node, transform) : undefined;
}

function selectedNodes(
  context: GeometryContext,
  nodeIds: readonly string[],
): readonly SceneNode[] | undefined {
  if (nodeIds.length === 0 || nodeIds.length > SCENE_LIMITS.maxNodes) return undefined;
  const selected = [...new Set(nodeIds)].map((id) => context.nodes.get(id));
  if (selected.some((node) => node === undefined)) return undefined;
  return selected.filter((node): node is SceneNode => node !== undefined);
}

function commandPlan(
  context: GeometryContext,
  operations: readonly SceneOperation[],
): SceneCommandPlanResult {
  if (operations.length > SCENE_COMMAND_LIMITS.maxOperations) {
    return { success: false, code: 'COMMAND_LIMIT' };
  }
  const batch: SceneCommandBatch = {
    sceneId: context.document.id,
    baseRevision: context.document.revision,
    operations,
  };
  // 规划只做几何换算；数值、树结构和修订限制始终交给统一命令内核。
  const result = applySceneCommandBatch(context.document, batch);
  if (result.success) return { success: true, batch };
  return {
    success: false,
    code: result.code === 'REVISION_EXHAUSTED' ? result.code : 'INVALID_GEOMETRY',
  };
}

export function createTranslateCommandBatch(
  document: SceneDocument,
  nodeIds: readonly string[],
  delta: ScenePoint,
): SceneCommandPlanResult {
  const context = geometryContext(document);
  if (!context) return { success: false, code: 'INVALID_DOCUMENT' };
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) {
    return { success: false, code: 'INVALID_GEOMETRY' };
  }
  const nodes = selectedNodes(context, nodeIds);
  if (!nodes) return { success: false, code: 'INVALID_SELECTION' };
  const selected = new Set(nodes.map((node) => node.id));
  const targets = nodes.filter((node) => {
    let parentId = context.parents.get(node.id);
    while (parentId !== undefined && parentId !== null) {
      if (selected.has(parentId)) return false;
      parentId = context.parents.get(parentId);
    }
    return true;
  });
  if (targets.length > SCENE_COMMAND_LIMITS.maxOperations) {
    return { success: false, code: 'COMMAND_LIMIT' };
  }
  const operations: SceneOperation[] = targets.map((node) => {
    const parentId = context.parents.get(node.id);
    const parent =
      parentId === undefined || parentId === null ? identity : worldTransform(context, parentId);
    const transform = parent ?? identity;
    return {
      type: 'node.update',
      nodeId: node.id,
      changes: {
        transform: {
          x: node.transform.x + transform.cosine * delta.x + transform.sine * delta.y,
          y: node.transform.y - transform.sine * delta.x + transform.cosine * delta.y,
        },
      },
    };
  });
  return commandPlan(context, operations);
}

export function createGroupCommandBatch(
  document: SceneDocument,
  nodeIds: readonly string[],
  groupId: string,
): SceneCommandPlanResult {
  const context = geometryContext(document);
  if (!context) return { success: false, code: 'INVALID_DOCUMENT' };
  const nodes = selectedNodes(context, nodeIds);
  if (!nodes || nodes.length < 2 || context.nodes.has(groupId)) {
    return { success: false, code: 'INVALID_SELECTION' };
  }
  const first = nodes[0];
  if (!first) return { success: false, code: 'INVALID_SELECTION' };
  const parentId = context.parents.get(first.id) ?? null;
  if (nodes.some((node) => context.parents.get(node.id) !== parentId)) {
    return { success: false, code: 'INVALID_SELECTION' };
  }
  if (1 + nodes.length * 2 > SCENE_COMMAND_LIMITS.maxOperations) {
    return { success: false, code: 'COMMAND_LIMIT' };
  }
  const parent = parentId === null ? undefined : context.nodes.get(parentId);
  const siblings = parent?.type === 'group' ? parent.children : context.document.rootIds;
  const selected = new Set(nodes.map((node) => node.id));
  const ordered = siblings.filter((id) => selected.has(id));
  const points = nodes.flatMap((node) => corners(node, localTransform(node)));
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  const groupTransform = {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y,
    rotation: 0,
  };
  const highestId = ordered.at(-1);
  if (highestId === undefined) return { success: false, code: 'INVALID_SELECTION' };
  const operations: SceneOperation[] = [
    {
      type: 'node.add',
      parentId,
      // 先占原最高选中层；依序移走选中节点后，未选中节点的相对顺序保持。
      index: siblings.indexOf(highestId),
      node: { id: groupId, type: 'group', visible: true, transform: groupTransform, children: [] },
    },
  ];
  for (const [index, id] of ordered.entries()) {
    const node = context.nodes.get(id);
    if (!node) return { success: false, code: 'INVALID_SELECTION' };
    operations.push(
      { type: 'node.move', nodeId: id, parentId: groupId, index },
      {
        type: 'node.update',
        nodeId: id,
        changes: { transform: { x: node.transform.x - x, y: node.transform.y - y } },
      },
    );
  }
  return commandPlan(context, operations);
}

function normalizedRotation(angle: number): number {
  const result = angle % 360;
  return result > 180 ? result - 360 : result <= -180 ? result + 360 : result;
}

export function createUngroupCommandBatch(
  document: SceneDocument,
  groupId: string,
): SceneCommandPlanResult {
  const context = geometryContext(document);
  if (!context) return { success: false, code: 'INVALID_DOCUMENT' };
  const group = context.nodes.get(groupId);
  if (group?.type !== 'group') return { success: false, code: 'INVALID_SELECTION' };
  if (1 + group.children.length * 2 > SCENE_COMMAND_LIMITS.maxOperations) {
    return { success: false, code: 'COMMAND_LIMIT' };
  }
  const parentId = context.parents.get(group.id) ?? null;
  const parent = parentId === null ? undefined : context.nodes.get(parentId);
  const siblings = parent?.type === 'group' ? parent.children : context.document.rootIds;
  const index = siblings.indexOf(group.id);
  const transform = localTransform(group);
  const operations: SceneOperation[] = [];
  for (const [offset, id] of group.children.entries()) {
    const child = context.nodes.get(id);
    if (!child) return { success: false, code: 'INVALID_SELECTION' };
    const { width, height } = child.transform;
    const center = transformPoint(transform, {
      x: child.transform.x + width / 2,
      y: child.transform.y + height / 2,
    });
    operations.push(
      { type: 'node.move', nodeId: id, parentId, index: index + offset },
      {
        type: 'node.update',
        nodeId: id,
        changes: {
          visible: group.visible && child.visible,
          transform: {
            x: center.x - width / 2,
            y: center.y - height / 2,
            rotation: normalizedRotation(group.transform.rotation + child.transform.rotation),
          },
        },
      },
    );
  }
  operations.push({ type: 'node.remove', nodeId: group.id });
  return commandPlan(context, operations);
}
