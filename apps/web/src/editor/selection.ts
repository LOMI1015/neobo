import type { SceneDocument, SceneNode } from '@neobo/scene';
import { sceneComponents } from '../scene/components';

export function nodeTitle(node: SceneNode): string {
  return node.type === 'group'
    ? '组合'
    : sceneComponents.resolve(node.type, node.componentVersion).label;
}

export function toggleSelection(current: readonly string[], nodeId: string): string[] {
  return current.includes(nodeId) ? current.filter((id) => id !== nodeId) : [...current, nodeId];
}

export function selectionRoots(document: SceneDocument, selection: readonly string[]): string[] {
  const parents = new Map<string, string>();
  for (const node of document.nodes) {
    if (node.type === 'group') {
      for (const child of node.children) parents.set(child, node.id);
    }
  }
  const selected = new Set(selection);
  return [...selected].filter((nodeId) => {
    let parent = parents.get(nodeId);
    while (parent !== undefined) {
      if (selected.has(parent)) return false;
      parent = parents.get(parent);
    }
    return true;
  });
}

export function nextNodeId(document: SceneDocument, prefix: string): string {
  const existing = new Set(document.nodes.map((node) => node.id));
  let index = 1;
  while (existing.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

export function commandErrorMessage(code: string): string {
  switch (code) {
    case 'REVISION_CONFLICT':
      return '场景已被更新，本次操作未应用，请重新操作。';
    case 'HISTORY_CAPACITY':
      return '撤销历史容量不足，本次操作未应用。';
    case 'HISTORY_EMPTY':
      return '当前没有可恢复的历史。';
    case 'REVISION_EXHAUSTED':
      return '场景修订号已达到上限，无法继续编辑。';
    case 'COMMAND_LIMIT':
      return '本次操作超过命令数量上限，请减少选择的元素。组合或拆组最多支持 49 项。';
    case 'INVALID_SELECTION':
      return '请选择有效元素；组合需要至少两个同级元素，拆组需要选中一个组合。';
    case 'INVALID_GEOMETRY':
      return '操作后的坐标或尺寸超出允许范围，本次操作未应用。';
    default:
      return '操作未通过场景校验，本次操作未应用。请检查元素属性与数量。';
  }
}
