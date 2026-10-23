import type { SceneDocument, SceneNode } from '@neobo/scene';
import type { ReactNode } from 'react';
import type { SceneComponentRegistry } from './component-registry';
import { renderSceneComponent, sceneComponents } from './components';

function NodeView({
  id,
  nodes,
  registry,
}: {
  readonly id: string;
  readonly nodes: ReadonlyMap<string, SceneNode>;
  readonly registry: SceneComponentRegistry;
}): ReactNode {
  const node = nodes.get(id);
  if (!node?.visible) return null;

  const { x, y, width, height, rotation } = node.transform;
  let content: ReactNode;

  if (node.type === 'group') {
    content = (
      <>
        {/* 框先绘制，保证空组合可命中，同时不遮挡其子元素。 */}
        <rect
          data-group-frame=""
          width={width}
          height={height}
          fill="transparent"
          pointerEvents="all"
          aria-hidden="true"
        />
        {node.children.map((childId) => (
          <NodeView key={childId} id={childId} nodes={nodes} registry={registry} />
        ))}
      </>
    );
  } else {
    content = renderSceneComponent(node, registry);
  }

  return (
    <g
      data-node-id={node.id}
      transform={`translate(${x} ${y}) rotate(${rotation} ${width / 2} ${height / 2})`}
    >
      {content}
    </g>
  );
}

export function SceneView({
  document,
  registry = sceneComponents,
}: {
  readonly document: SceneDocument;
  readonly registry?: SceneComponentRegistry;
}): ReactNode {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));

  return (
    <>
      {document.rootIds.map((id) => (
        <NodeView key={id} id={id} nodes={nodes} registry={registry} />
      ))}
    </>
  );
}
