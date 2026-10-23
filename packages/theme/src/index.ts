import * as z from 'zod';

export const sceneThemeReferenceSchema = z.strictObject({
  id: z.enum(['neutral-light', 'deep-blue']),
  version: z.literal(1),
});

export type SceneThemeReference = Readonly<z.infer<typeof sceneThemeReferenceSchema>>;

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const tokensSchema = z.strictObject({
  canvasBackground: colorSchema,
  text: colorSchema,
  rectangleFill: colorSchema,
  rectangleStroke: colorSchema,
  chartBar: colorSchema,
  chartText: colorSchema,
  chartAxis: colorSchema,
  chartGrid: colorSchema,
});

export type SceneThemeTokens = Readonly<z.infer<typeof tokensSchema>>;

export interface SceneThemeDefinition extends SceneThemeReference {
  readonly label: string;
  readonly tokens: SceneThemeTokens;
}

const definitionSchema = sceneThemeReferenceSchema.extend({
  label: z.string().min(1).max(32).regex(/\S/u),
  tokens: tokensSchema,
});

function defineTheme(input: unknown): SceneThemeDefinition {
  const result = definitionSchema.safeParse(input);
  if (!result.success) throw new Error('场景主题定义无效。');
  return Object.freeze({ ...result.data, tokens: Object.freeze({ ...result.data.tokens }) });
}

export const DEFAULT_SCENE_THEME: SceneThemeDefinition = defineTheme({
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
});

export const SCENE_THEMES: readonly SceneThemeDefinition[] = Object.freeze([
  DEFAULT_SCENE_THEME,
  defineTheme({
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
  }),
]);

function validatedReference(input: unknown): SceneThemeReference | undefined {
  try {
    const result = sceneThemeReferenceSchema.safeParse(input);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function resolveSceneTheme(reference?: SceneThemeReference): SceneThemeDefinition {
  if (reference === undefined) return DEFAULT_SCENE_THEME;
  const parsed = validatedReference(reference);
  if (!parsed) throw new Error('场景主题引用无效。');
  const theme = SCENE_THEMES.find(
    (entry) => entry.id === parsed.id && entry.version === parsed.version,
  );
  if (!theme) throw new Error('场景主题引用无效。');
  return theme;
}
