import { DEFAULT_SCENE_THEME, type SceneThemeTokens } from '@neobo/theme';
import { createContext } from 'react';

export const SceneThemeContext = createContext<SceneThemeTokens>(DEFAULT_SCENE_THEME.tokens);
