import type { BarChartNode } from '@neobo/scene/document';
import { act, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BarChartView } from '../src/BarChartView.js';

const loading = vi.hoisted(() => {
  let release = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release, mounted: vi.fn() };
});

vi.mock('../src/BarChartSurface.js', async () => {
  await loading.ready;
  return {
    default: () => {
      loading.mounted();
      return null;
    },
  };
});

it('模块加载完成前卸载不建立图表，加载占位不加入功能说明文字', async () => {
  const node: BarChartNode = {
    id: 'loading',
    type: 'bar-chart',
    componentVersion: 1,
    visible: true,
    transform: { x: 0, y: 0, width: 480, height: 320, rotation: 0 },
    data: [],
  };
  const { container, unmount } = render(
    <svg>
      <BarChartView node={node} />
    </svg>,
  );
  expect(container.querySelector('[data-chart-frame]')).toBeInTheDocument();
  expect(container.textContent).toBe('');
  unmount();
  await act(async () => {
    loading.release();
    await vi.dynamicImportSettled();
  });
  expect(loading.mounted).not.toHaveBeenCalled();
});
