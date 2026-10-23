import type { BarChartNode } from '@neobo/scene';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BarChartView } from './BarChartView';

vi.mock('./BarChartSurface', () => {
  throw new Error('synthetic-module-secret');
});

it('懒加载模块失败保留命中框并显示固定反馈，不回显原始异常', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const node: BarChartNode = {
    id: 'failed',
    type: 'bar-chart',
    componentVersion: 1,
    visible: true,
    transform: { x: 0, y: 0, width: 480, height: 320, rotation: 0 },
    data: [],
  };
  const { container } = render(
    <svg>
      <BarChartView node={node} />
    </svg>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(/^柱状图绘制失败。$/);
  expect(container.querySelector('[data-chart-frame]')).toBeInTheDocument();
  expect(container).not.toHaveTextContent('synthetic-module-secret');
});
