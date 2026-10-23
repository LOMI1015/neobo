import type { BarChartNode } from '@neobo/scene/document';
import type { SceneThemeTokens } from '@neobo/theme';
import { Component, lazy, Suspense, useContext } from 'react';
import { sameBarChartData } from './bar-chart-data.js';
import { SceneThemeContext } from './scene-theme.js';

const ChartSurface = lazy(() => import('./BarChartSurface.js'));

interface BarChartProps {
  readonly node: BarChartNode;
}

interface ThemedChartProps extends BarChartProps {
  readonly theme: SceneThemeTokens;
}

class ChartBoundary extends Component<ThemedChartProps, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidUpdate(previous: ThemedChartProps) {
    if (
      this.state.failed &&
      (!sameBarChartData(previous.node.data, this.props.node.data) ||
        previous.node.transform.width !== this.props.node.transform.width ||
        previous.node.transform.height !== this.props.node.transform.height ||
        previous.theme !== this.props.theme)
    ) {
      this.setState({ failed: false });
    }
  }

  override render() {
    return this.state.failed ? (
      <div role="alert" style={{ padding: 12, color: this.props.theme.chartText, fontSize: 14 }}>
        柱状图绘制失败。
      </div>
    ) : (
      <Suspense fallback={null}>
        <ChartSurface node={this.props.node} theme={this.props.theme} />
      </Suspense>
    );
  }
}

export function BarChartView({ node }: BarChartProps) {
  const theme = useContext(SceneThemeContext);
  const { width, height } = node.transform;
  return (
    <>
      {/* 图表内容不接管指针；命中框沿用场景选择、拖动和右键入口。 */}
      <rect data-chart-frame="" width={width} height={height} fill="transparent" />
      <foreignObject width={width} height={height} overflow="hidden" pointerEvents="none">
        <ChartBoundary node={node} theme={theme} />
      </foreignObject>
    </>
  );
}
