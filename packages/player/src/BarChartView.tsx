import type { BarChartNode } from '@neobo/scene/document';
import { Component, lazy, Suspense } from 'react';
import { sameBarChartData } from './bar-chart-data.js';

const ChartSurface = lazy(() => import('./BarChartSurface.js'));

interface BarChartProps {
  readonly node: BarChartNode;
}

class ChartBoundary extends Component<BarChartProps, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidUpdate(previous: BarChartProps) {
    if (
      this.state.failed &&
      (!sameBarChartData(previous.node.data, this.props.node.data) ||
        previous.node.transform.width !== this.props.node.transform.width ||
        previous.node.transform.height !== this.props.node.transform.height)
    ) {
      this.setState({ failed: false });
    }
  }

  override render() {
    return this.state.failed ? (
      <div role="alert" style={{ padding: 12, color: '#a54545', fontSize: 14 }}>
        柱状图绘制失败。
      </div>
    ) : (
      <Suspense fallback={null}>
        <ChartSurface node={this.props.node} />
      </Suspense>
    );
  }
}

export function BarChartView({ node }: BarChartProps) {
  const { width, height } = node.transform;
  return (
    <>
      {/* 图表内容不接管指针；命中框沿用场景选择、拖动和右键入口。 */}
      <rect data-chart-frame="" width={width} height={height} fill="transparent" />
      <foreignObject width={width} height={height} overflow="hidden" pointerEvents="none">
        <ChartBoundary node={node} />
      </foreignObject>
    </>
  );
}
