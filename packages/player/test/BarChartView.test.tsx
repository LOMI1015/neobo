import { createEmptyScene, type BarChartNode, type SceneDocument } from '@neobo/scene/document';
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BarChartView } from '../src/BarChartView.js';
import { SceneView } from '../src/SceneView.js';

const charts = vi.hoisted(() => {
  const create = () => ({
    setOption: vi.fn<(option: unknown, options: unknown) => void>(),
    resize: vi.fn<(size: unknown) => void>(),
    dispose: vi.fn<() => void>(),
  });
  const instances: ReturnType<typeof create>[] = [];
  return {
    create,
    instances,
    init: vi.fn<
      (host: HTMLElement, theme: unknown, options: unknown) => ReturnType<typeof create>
    >(),
    use: vi.fn<(modules: unknown[]) => void>(),
  };
});

vi.mock('echarts/core', () => ({ init: charts.init, use: charts.use }));
vi.mock('echarts/charts', () => ({ BarChart: 'bar-module' }));
vi.mock('echarts/components', () => ({ GridComponent: 'grid-module' }));
vi.mock('echarts/renderers', () => ({ SVGRenderer: 'svg-module' }));

const initial: BarChartNode = {
  id: 'bar-chart-1',
  type: 'bar-chart',
  componentVersion: 1,
  visible: true,
  transform: { x: 20, y: 30, width: 480, height: 320, rotation: 0 },
  data: [
    { category: '正数', value: 12 },
    { category: '负数', value: -4 },
    { category: '零', value: 0 },
  ],
};

function view(node: BarChartNode) {
  return (
    <svg>
      <BarChartView node={node} />
    </svg>
  );
}

function latestChart() {
  const chart = charts.instances.at(-1);
  if (!chart) throw new Error('图表测试实例未建立。');
  return chart;
}

beforeEach(() => {
  charts.instances.length = 0;
  charts.init.mockReset().mockImplementation(() => {
    const chart = charts.create();
    charts.instances.push(chart);
    return chart;
  });
});

describe('柱状图绘制适配与资源生命周期', () => {
  it('只注册柱图、直角坐标与SVG；使用HTML容器及节点逻辑尺寸', async () => {
    vi.resetModules();
    await import('../src/BarChartSurface.js');
    expect(charts.use).toHaveBeenCalledExactlyOnceWith(['bar-module', 'grid-module', 'svg-module']);
    const { container } = render(view(initial));
    const host = await screen.findByRole('img', { name: '柱状图' });
    expect(host.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(charts.init).toHaveBeenCalledExactlyOnceWith(host, null, {
      renderer: 'svg',
      width: 480,
      height: 320,
    });
    expect(host).toHaveStyle({ width: '480px', height: '320px' });
    expect(container.querySelector('foreignObject')).toHaveAttribute('pointer-events', 'none');
    expect(container.querySelector('[data-chart-frame]')).toHaveAttribute('fill', 'transparent');
  });

  it('负数和零按原始顺序进入单系列，不引入HTML格式化器、tooltip或动画', async () => {
    const original = structuredClone(initial);
    render(view(initial));
    await screen.findByRole('img', { name: '柱状图' });
    const chart = latestChart();
    const option = chart.setOption.mock.calls[0]?.[0];
    expect(option).toMatchObject({
      animation: false,
      xAxis: { type: 'category', data: ['正数', '负数', '零'] },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: [12, -4, 0], silent: true, emphasis: { disabled: true } }],
    });
    expect(option).not.toHaveProperty('tooltip');
    expect(option).not.toHaveProperty('toolbox');
    expect(chart.setOption.mock.calls[0]?.[1]).toEqual({ notMerge: true, silent: true });
    expect(initial).toEqual(original);
  });

  it('数据修改复用实例并全量替换，清空后不留下旧类目或数值', async () => {
    const { rerender } = render(view(initial));
    await screen.findByRole('img', { name: '柱状图' });
    const chart = latestChart();
    rerender(view({ ...initial, data: [{ category: '更新', value: -10 }] }));
    expect(charts.init).toHaveBeenCalledTimes(1);
    expect(chart.setOption).toHaveBeenLastCalledWith(
      expect.objectContaining({
        xAxis: { type: 'category', data: ['更新'] },
        series: [expect.objectContaining({ type: 'bar', data: [-10] })],
      }),
      { notMerge: true, silent: true },
    );
    rerender(view({ ...initial, data: [] }));
    expect(chart.setOption).toHaveBeenLastCalledWith(
      expect.objectContaining({
        xAxis: { type: 'category', data: [] },
        series: [expect.objectContaining({ data: [] })],
      }),
      { notMerge: true, silent: true },
    );
    expect(chart.resize).not.toHaveBeenCalled();
    expect(chart.dispose).not.toHaveBeenCalled();
  });

  it('克隆文档及只改变位置、旋转时不重复更新图表；宽高变化只resize', async () => {
    const { rerender } = render(view(initial));
    await screen.findByRole('img', { name: '柱状图' });
    const chart = latestChart();
    const copy = structuredClone(initial);
    rerender(view({ ...copy, transform: { ...copy.transform, x: 300, rotation: 90 } }));
    expect(chart.setOption).toHaveBeenCalledTimes(1);
    expect(chart.resize).not.toHaveBeenCalled();
    rerender(view({ ...copy, transform: { ...copy.transform, width: 600, height: 400 } }));
    expect(chart.resize).toHaveBeenCalledExactlyOnceWith({ width: 600, height: 400, silent: true });
    expect(chart.setOption).toHaveBeenCalledTimes(1);
    expect(charts.init).toHaveBeenCalledTimes(1);
  });

  it('相同长度中的类别或数值改变均会更新，输入标记仍是普通类别字符串', async () => {
    const { rerender, container } = render(view(initial));
    await screen.findByRole('img', { name: '柱状图' });
    const chart = latestChart();
    const data = initial.data.map((row, index) =>
      index === 0 ? { ...row, category: '<img src=x onerror=alert(1)>' } : row,
    );
    rerender(view({ ...initial, data }));
    expect(chart.setOption).toHaveBeenCalledTimes(2);
    rerender(view({ ...initial, data: data.map((row) => ({ ...row, value: row.value + 1 })) }));
    expect(chart.setOption).toHaveBeenCalledTimes(3);
    expect(container.querySelector('img, script')).toBeNull();
  });

  it('StrictMode额外建立清理周期以及最终卸载均配对销毁实例', async () => {
    const { unmount } = render(<StrictMode>{view(initial)}</StrictMode>);
    await screen.findByRole('img', { name: '柱状图' });
    expect(charts.instances).toHaveLength(2);
    expect(charts.instances[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(charts.instances[1]?.dispose).not.toHaveBeenCalled();
    unmount();
    for (const chart of charts.instances) expect(chart.dispose).toHaveBeenCalledTimes(1);
  });

  it('父组合隐藏或节点删除销毁图表，重新显示创建独立实例', async () => {
    const document: SceneDocument = {
      ...createEmptyScene({ id: 'chart', width: 960, height: 540 }),
      rootIds: ['group'],
      nodes: [
        {
          id: 'group',
          type: 'group',
          visible: true,
          transform: initial.transform,
          children: [initial.id],
        },
        initial,
      ],
    };
    const tree = (current: SceneDocument) => (
      <svg>
        <SceneView document={current} />
      </svg>
    );
    const { rerender } = render(tree(document));
    await screen.findByRole('img', { name: '柱状图' });
    const first = latestChart();
    rerender(
      tree({
        ...document,
        nodes: document.nodes.map((node) =>
          node.type === 'group' ? { ...node, visible: false } : node,
        ),
      }),
    );
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('img', { name: '柱状图' })).not.toBeInTheDocument();
    rerender(tree(document));
    const second = latestChart();
    expect(second).not.toBe(first);
    rerender(tree(createEmptyScene({ id: 'chart', width: 960, height: 540 })));
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  it('初始化失败提供固定错误，后续合法修改可重新建立图表', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    charts.init.mockImplementationOnce(() => {
      throw new Error('synthetic-secret');
    });
    const { rerender } = render(view(initial));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^柱状图绘制失败。$/);
    expect(screen.queryByText('synthetic-secret')).not.toBeInTheDocument();
    rerender(view(structuredClone(initial)));
    expect(charts.init).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(/^柱状图绘制失败。$/);
    rerender(view({ ...initial, data: [] }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: '柱状图' })).toBeInTheDocument();
    expect(charts.instances).toHaveLength(1);
  });

  it.each(['setOption', 'resize'] as const)(
    '%s失败释放实例且不重复销毁，后续修改可恢复',
    async (method) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { rerender, unmount } = render(view(initial));
      await screen.findByRole('img', { name: '柱状图' });
      const failed = latestChart();
      failed[method].mockImplementationOnce(() => {
        throw new Error('synthetic-secret');
      });
      const next = { ...initial, data: [], transform: { ...initial.transform, width: 640 } };
      rerender(view(next));
      expect(failed.dispose).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('alert')).toHaveTextContent(/^柱状图绘制失败。$/);
      rerender(view({ ...next, transform: { ...next.transform, width: 700 } }));
      const recovered = latestChart();
      expect(recovered).not.toBe(failed);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      unmount();
      expect(failed.dispose).toHaveBeenCalledTimes(1);
      expect(recovered.dispose).toHaveBeenCalledTimes(1);
    },
  );
});
