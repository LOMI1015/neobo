import type { BarChartNode } from '@neobo/scene/document';
import { BarChart, type BarSeriesOption } from 'echarts/charts';
import { GridComponent, type GridComponentOption } from 'echarts/components';
import { init, use as registerECharts, type ComposeOption, type EChartsType } from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { sameBarChartData } from './bar-chart-data.js';

registerECharts([BarChart, GridComponent, SVGRenderer]);

type BarOption = ComposeOption<BarSeriesOption | GridComponentOption>;

export default function BarChartSurface({ node }: { readonly node: BarChartNode }) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<EChartsType | null>(null);
  const { width, height } = node.transform;
  const initialSize = useRef({ width, height });
  const renderedData = useRef<BarChartNode['data'] | null>(null);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let chart: EChartsType;
    try {
      chart = init(host, null, { renderer: 'svg', ...initialSize.current });
      instance.current = chart;
    } catch (cause) {
      throw new Error('柱状图初始化失败。', { cause });
    }
    return () => {
      if (instance.current === chart) {
        instance.current = null;
        renderedData.current = null;
        chart.dispose();
      }
    };
  }, []);

  useEffect(() => {
    const chart = instance.current;
    if (!chart) return;
    try {
      // 使用节点逻辑尺寸，外层 SVG 的缩放和旋转不参与图表布局。
      if (initialSize.current.width !== width || initialSize.current.height !== height) {
        chart.resize({ width, height, silent: true });
        initialSize.current = { width, height };
      }
      // 历史和拖动预览会复制文档；相同的有界数据无需重新布局图表。
      if (renderedData.current && sameBarChartData(renderedData.current, node.data)) return;
      const option: BarOption = {
        animation: false,
        textStyle: { color: '#202c3b', fontFamily: 'system-ui, sans-serif', fontSize: 12 },
        grid: {
          left: 32,
          right: 16,
          top: 16,
          bottom: 32,
          outerBoundsMode: 'same',
          outerBoundsContain: 'all',
        },
        xAxis: { type: 'category', data: node.data.map(({ category }) => category) },
        yAxis: { type: 'value' },
        series: [
          {
            type: 'bar',
            data: node.data.map(({ value }) => value),
            silent: true,
            emphasis: { disabled: true },
            itemStyle: { color: '#5278ba' },
          },
        ],
      };
      chart.setOption(option, { notMerge: true, silent: true });
      renderedData.current = node.data;
    } catch (cause) {
      instance.current = null;
      chart.dispose();
      throw new Error('柱状图绘制失败。', { cause });
    }
  }, [node.data, width, height]);

  return (
    <div
      ref={container}
      data-chart-host=""
      role="img"
      aria-label="柱状图"
      style={{ width, height, overflow: 'hidden' }}
    />
  );
}
