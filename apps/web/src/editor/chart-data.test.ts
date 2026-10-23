import { SCENE_LIMITS } from '@neobo/scene';
import { describe, expect, it } from 'vitest';
import { chartDataEqual, createChartDataDraft, parseChartDataDraft } from './chart-data';

function row(category = '分类', value = '1') {
  return { key: 0, category, value };
}

describe('图表数据草稿边界', () => {
  it('空数据合法，负数和零保留，分类不自动裁剪', () => {
    expect(parseChartDataDraft([], 'chart')).toEqual({ success: true, data: [] });
    expect(
      parseChartDataDraft([row(' 原始分类 ', '-3.5'), { ...row('零', '0'), key: 1 }], 'chart'),
    ).toEqual({
      success: true,
      data: [
        { category: ' 原始分类 ', value: -3.5 },
        { category: '零', value: 0 },
      ],
    });
  });

  it.each(['', ' ', 'NaN', 'Infinity', '-Infinity'])('拒绝无效数值“%s”，不把空串当零', (value) => {
    expect(parseChartDataDraft([row('分类', value)], 'chart')).toEqual({
      success: false,
      message: '第 1 项数值需要填写有限数字。',
    });
  });

  it.each(['', ' \n\t'])('拒绝空分类“%s”', (category) => {
    expect(parseChartDataDraft([row(category)], 'chart')).toEqual({
      success: false,
      message: '第 1 项分类不能为空。',
    });
  });

  it('分类以共享契约的Unicode字符上限校验，超长值明确失败', () => {
    expect(
      parseChartDataDraft([row('😀'.repeat(SCENE_LIMITS.maxChartCategoryLength))], 'chart').success,
    ).toBe(true);
    expect(
      parseChartDataDraft([row('😀'.repeat(SCENE_LIMITS.maxChartCategoryLength + 1))], 'chart'),
    ).toEqual({ success: false, message: '第 1 项分类过长。' });
  });

  it('接受数值边界，拒绝正负越界', () => {
    for (const value of [-SCENE_LIMITS.maxChartValue, SCENE_LIMITS.maxChartValue]) {
      expect(parseChartDataDraft([row('分类', String(value))], 'chart').success).toBe(true);
    }
    for (const value of [-SCENE_LIMITS.maxChartValue - 1, SCENE_LIMITS.maxChartValue + 1]) {
      expect(parseChartDataDraft([row('分类', String(value))], 'chart')).toEqual({
        success: false,
        message: '第 1 项数值超出范围。',
      });
    }
  });

  it('拒绝超量数据，并以共享命令校验拒绝非法目标ID', () => {
    const rows = Array.from({ length: SCENE_LIMITS.maxChartDataPoints + 1 }, (_, key) => ({
      ...row(),
      key,
    }));
    expect(parseChartDataDraft(rows, 'chart')).toEqual({
      success: false,
      message: '最多 100 项数据。',
    });
    expect(parseChartDataDraft([row()], '不合法节点')).toEqual({
      success: false,
      message: '图表数据未通过校验。',
    });
  });

  it('草稿独立于文档，数据比较保留内容与顺序语义', () => {
    const data = [
      { category: '甲', value: 1 },
      { category: '乙', value: -2 },
    ];
    const draft = createChartDataDraft(data);
    expect(draft).toEqual([
      { key: 0, category: '甲', value: '1' },
      { key: 1, category: '乙', value: '-2' },
    ]);
    draft.splice(0, 1);
    expect(data).toHaveLength(2);
    expect(chartDataEqual(data, [...data])).toBe(true);
    expect(chartDataEqual(data, [...data].reverse())).toBe(false);
    expect(chartDataEqual(data, [])).toBe(false);
  });
});
