import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENE_THEME,
  SCENE_THEMES,
  resolveSceneTheme,
  sceneThemeReferenceSchema,
} from '../src/index.js';

describe('固定场景主题', () => {
  it('提供两套完整预设，默认保留既有中性颜色', () => {
    expect(SCENE_THEMES).toEqual([
      {
        id: 'neutral-light',
        version: 1,
        label: '中性浅色',
        tokens: {
          canvasBackground: '#ffffff',
          text: '#202c3b',
          rectangleFill: '#e4e8ef',
          rectangleStroke: '#7c8797',
          chartBar: '#5278ba',
          chartText: '#202c3b',
          chartAxis: '#6e7079',
          chartGrid: '#e0e6f1',
        },
      },
      {
        id: 'deep-blue',
        version: 1,
        label: '深色蓝',
        tokens: {
          canvasBackground: '#0f172a',
          text: '#e2e8f0',
          rectangleFill: '#1e3a5f',
          rectangleStroke: '#60a5fa',
          chartBar: '#60a5fa',
          chartText: '#cbd5e1',
          chartAxis: '#94a3b8',
          chartGrid: '#334155',
        },
      },
    ]);
    expect(resolveSceneTheme()).toBe(DEFAULT_SCENE_THEME);
    expect(resolveSceneTheme(undefined)).toBe(DEFAULT_SCENE_THEME);
    expect(resolveSceneTheme({ id: 'neutral-light', version: 1 })).toBe(DEFAULT_SCENE_THEME);
  });

  it('公开定义与token为独立冻结数据，不能污染其他消费方', () => {
    expect(Object.isFrozen(SCENE_THEMES)).toBe(true);
    for (const theme of SCENE_THEMES) {
      expect(Object.isFrozen(theme)).toBe(true);
      expect(Object.isFrozen(theme.tokens)).toBe(true);
      expect(Reflect.set(theme, 'label', '修改')).toBe(false);
      expect(Reflect.set(theme.tokens, 'text', '#000000')).toBe(false);
      expect(resolveSceneTheme({ id: theme.id, version: theme.version })).toBe(theme);
    }
    expect(Reflect.set(SCENE_THEMES, '0', undefined)).toBe(false);
    expect(SCENE_THEMES[0]?.tokens).not.toBe(SCENE_THEMES[1]?.tokens);
    expect(resolveSceneTheme().tokens.text).toBe('#202c3b');
  });

  it('引用解析生成独立对象，调用方后续改动不改变主题定义', () => {
    const reference = { id: 'deep-blue', version: 1 };
    const parsed = sceneThemeReferenceSchema.parse(reference);
    reference.id = 'neutral-light';
    reference.version = 2;
    expect(parsed).toEqual({ id: 'deep-blue', version: 1 });
    expect(parsed).not.toBe(reference);
    expect(resolveSceneTheme(parsed).label).toBe('深色蓝');
  });

  it.each([
    null,
    {},
    [],
    'deep-blue',
    { id: 'synthetic-theme-secret', version: 1 },
    { id: 'deep-blue', version: 0 },
    { id: 'deep-blue', version: 2 },
    { id: 'deep-blue', version: '1' },
    { id: 'deep-blue', version: NaN },
    { id: 'deep-blue', version: Infinity },
    { id: 'deep-blue' },
    { id: 'deep-blue', version: 1, tokens: {} },
  ])('非法引用不回退默认、不转换值且抛出固定错误：%j', (input) => {
    expect(sceneThemeReferenceSchema.safeParse(input).success).toBe(false);
    expect(() => {
      Reflect.apply(resolveSceneTheme, undefined, [input]);
    }).toThrowError(/^场景主题引用无效。$/);
  });

  it('访问引用时抛出的异常也转换为固定错误', () => {
    const reference = {
      get id() {
        throw new Error('synthetic-getter-secret');
      },
      version: 1,
    };
    expect(() => {
      Reflect.apply(resolveSceneTheme, undefined, [reference]);
    }).toThrowError(/^场景主题引用无效。$/);
  });
});
