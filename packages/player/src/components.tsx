import type { RectangleNode, TextNode } from '@neobo/scene/document';
import { useContext, type CSSProperties, type ReactNode } from 'react';
import { BarChartView } from './BarChartView.js';
import {
  createSceneComponentRegistry,
  type SceneAtomicNode,
  type SceneComponentRegistry,
} from './component-registry.js';
import { SceneThemeContext } from './scene-theme.js';

const textStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  margin: 0,
  overflow: 'hidden',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 32,
  fontWeight: 400,
  lineHeight: 1.5,
};

function TextView({ node }: { readonly node: TextNode }) {
  const theme = useContext(SceneThemeContext);
  return (
    <foreignObject width={node.transform.width} height={node.transform.height} overflow="hidden">
      {/* HTML 布局保留换行并自动折行；用户文字始终作为 React 文本节点。 */}
      <div style={{ ...textStyle, color: theme.text }}>{node.text}</div>
    </foreignObject>
  );
}

function RectangleView({ node }: { readonly node: RectangleNode }) {
  const theme = useContext(SceneThemeContext);
  return (
    <rect
      width={node.transform.width}
      height={node.transform.height}
      fill={theme.rectangleFill}
      stroke={theme.rectangleStroke}
      strokeWidth={1}
    />
  );
}

export const sceneComponents = createSceneComponentRegistry([
  {
    type: 'text',
    componentVersion: 1,
    label: '文字',
    defaultSize: { width: 320, height: 72 },
    defaultText: '文字',
    render: (node) => <TextView node={node} />,
  },
  {
    type: 'rectangle',
    componentVersion: 1,
    label: '矩形',
    defaultSize: { width: 320, height: 180 },
    render: (node) => <RectangleView node={node} />,
  },
  {
    type: 'bar-chart',
    componentVersion: 1,
    label: '柱状图',
    defaultSize: { width: 480, height: 320 },
    defaultData: [],
    render: (node) => <BarChartView node={node} />,
  },
]);

export function renderSceneComponent(
  node: SceneAtomicNode,
  registry: SceneComponentRegistry = sceneComponents,
): ReactNode {
  // 分支保留描述与节点的类型关联，不用断言调用注册的绘制函数。
  switch (node.type) {
    case 'text':
      return registry.resolve(node.type, node.componentVersion).render(node);
    case 'rectangle':
      return registry.resolve(node.type, node.componentVersion).render(node);
    case 'bar-chart':
      return registry.resolve(node.type, node.componentVersion).render(node);
  }
}
