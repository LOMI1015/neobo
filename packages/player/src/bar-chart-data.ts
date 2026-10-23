import type { BarChartNode } from '@neobo/scene/document';

export function sameBarChartData(
  previous: BarChartNode['data'],
  next: BarChartNode['data'],
): boolean {
  return (
    previous === next ||
    (previous.length === next.length &&
      previous.every(
        (row, index) => row.category === next[index]?.category && row.value === next[index]?.value,
      ))
  );
}
