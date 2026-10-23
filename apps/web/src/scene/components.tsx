import { SCENE_SCHEMA_VERSION, validateSceneDocument, type SceneDocument } from '@neobo/scene';
import type { CSSProperties, ReactNode } from 'react';
import {
  createSceneComponentRegistry,
  type SceneAtomicNode,
  type SceneComponentRegistry,
  type SceneComponentType,
} from './component-registry';

const textStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  margin: 0,
  overflow: 'hidden',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  color: '#202c3b',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 32,
  fontWeight: 400,
  lineHeight: 1.5,
};

export const sceneComponents = createSceneComponentRegistry([
  {
    type: 'text',
    componentVersion: 1,
    label: '文字',
    defaultSize: { width: 320, height: 72 },
    defaultText: '文字',
    render: (node) => (
      <foreignObject width={node.transform.width} height={node.transform.height} overflow="hidden">
        {/* HTML 布局保留换行并自动折行；用户文字始终作为 React 文本节点。 */}
        <div style={textStyle}>{node.text}</div>
      </foreignObject>
    ),
  },
  {
    type: 'rectangle',
    componentVersion: 1,
    label: '矩形',
    defaultSize: { width: 320, height: 180 },
    render: (node) => (
      <rect
        width={node.transform.width}
        height={node.transform.height}
        fill="#e4e8ef"
        stroke="#7c8797"
        strokeWidth={1}
      />
    ),
  },
]);

export function createSceneComponent(
  type: SceneComponentType,
  { id, canvas }: { readonly id: string; readonly canvas: SceneDocument['canvas'] },
  registry: SceneComponentRegistry = sceneComponents,
): SceneAtomicNode {
  const description = registry.resolve(type, 1);
  const width = Math.min(description.defaultSize.width, canvas.width);
  const height = Math.min(description.defaultSize.height, canvas.height);
  const common = {
    id,
    componentVersion: description.componentVersion,
    visible: true,
    transform: {
      x: (canvas.width - width) / 2,
      y: (canvas.height - height) / 2,
      width,
      height,
      rotation: 0,
    },
  };
  const result = validateSceneDocument({
    schemaVersion: SCENE_SCHEMA_VERSION,
    id: 'component-creation',
    revision: 0,
    canvas,
    rootIds: [id],
    nodes: [
      description.type === 'text'
        ? { ...common, type: description.type, text: description.defaultText }
        : { ...common, type: description.type },
    ],
  });
  if (!result.success) throw new Error('场景组件初始数据无效。');
  const node = result.data.nodes[0];
  if (!node || node.type === 'group') throw new Error('场景组件初始数据无效。');
  return node;
}

export function renderSceneComponent(
  node: SceneAtomicNode,
  registry: SceneComponentRegistry = sceneComponents,
): ReactNode {
  // 分支保留描述与节点的类型关联，不用断言调用注册的绘制函数。
  return node.type === 'text'
    ? registry.resolve(node.type, node.componentVersion).render(node)
    : registry.resolve(node.type, node.componentVersion).render(node);
}
