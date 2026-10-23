import { SCENE_LIMITS, validateSceneCommandBatch, type BarChartDatum } from '@neobo/scene';

export interface ChartDataDraftRow {
  readonly key: number;
  readonly category: string;
  readonly value: string;
}

export function createChartDataDraft(data: readonly BarChartDatum[]): ChartDataDraftRow[] {
  return data.map((point, key) => ({ key, category: point.category, value: String(point.value) }));
}

export function parseChartDataDraft(
  rows: readonly ChartDataDraftRow[],
  nodeId: string,
):
  | { readonly success: true; readonly data: readonly BarChartDatum[] }
  | { readonly success: false; readonly message: string } {
  if (rows.length > SCENE_LIMITS.maxChartDataPoints) {
    return { success: false, message: `最多 ${SCENE_LIMITS.maxChartDataPoints} 项数据。` };
  }
  const data: BarChartDatum[] = [];
  for (const [index, row] of rows.entries()) {
    if (row.category.trim() === '') {
      return { success: false, message: `第 ${index + 1} 项分类不能为空。` };
    }
    if ([...row.category].length > SCENE_LIMITS.maxChartCategoryLength) {
      return { success: false, message: `第 ${index + 1} 项分类过长。` };
    }
    if (row.value.trim() === '' || !Number.isFinite(Number(row.value))) {
      return { success: false, message: `第 ${index + 1} 项数值需要填写有限数字。` };
    }
    const value = Number(row.value);
    if (Math.abs(value) > SCENE_LIMITS.maxChartValue) {
      return { success: false, message: `第 ${index + 1} 项数值超出范围。` };
    }
    data.push({ category: row.category, value });
  }
  // UI 只解析输入字符串；最终数据规则仍由共享命令契约确认。
  const validation = validateSceneCommandBatch({
    sceneId: 'chart-data-validation',
    baseRevision: 0,
    operations: [{ type: 'node.update', nodeId, changes: { data } }],
  });
  return validation.success
    ? { success: true, data }
    : { success: false, message: '图表数据未通过校验。' };
}

export function chartDataEqual(
  left: readonly BarChartDatum[],
  right: readonly BarChartDatum[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (point, index) =>
        point.category === right[index]?.category && point.value === right[index]?.value,
    )
  );
}
