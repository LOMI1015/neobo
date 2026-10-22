import type { SceneDocument, SceneNode } from '@neobo/scene';
import type { CSSProperties, ReactNode } from 'react';

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

function NodeView({
  id,
  nodes,
}: {
  readonly id: string;
  readonly nodes: ReadonlyMap<string, SceneNode>;
}): ReactNode {
  const node = nodes.get(id);
  if (!node?.visible) return null;

  const { x, y, width, height, rotation } = node.transform;
  let content: ReactNode;

  switch (node.type) {
    case 'rectangle':
      content = (
        <rect width={width} height={height} fill="#e4e8ef" stroke="#7c8797" strokeWidth={1} />
      );
      break;
    case 'text':
      content = (
        <foreignObject width={width} height={height} overflow="hidden">
          {/* HTML 布局保留换行并自动折行；用户文字始终作为 React 文本节点。 */}
          <div style={textStyle}>{node.text}</div>
        </foreignObject>
      );
      break;
    case 'group':
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
            <NodeView key={childId} id={childId} nodes={nodes} />
          ))}
        </>
      );
      break;
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

export function SceneView({ document }: { readonly document: SceneDocument }): ReactNode {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));

  return (
    <>
      {document.rootIds.map((id) => (
        <NodeView key={id} id={id} nodes={nodes} />
      ))}
    </>
  );
}
