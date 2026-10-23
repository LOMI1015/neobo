import {
  SCENE_SCHEMA_VERSION,
  validateSceneDocument,
  type BarChartNode,
  type RectangleNode,
  type TextNode,
} from '@neobo/scene/document';
import type { ReactNode } from 'react';

export type SceneAtomicNode = TextNode | RectangleNode | BarChartNode;
export type SceneComponentType = SceneAtomicNode['type'];

interface ComponentDescription<Type extends SceneComponentType> {
  readonly type: Type;
  readonly componentVersion: 1;
  readonly label: string;
  readonly defaultSize: { readonly width: number; readonly height: number };
}

// render 是纯绘制回调；需要 Hook 或资源生命周期时，返回独立 React 组件。
export interface TextComponentDescription extends ComponentDescription<'text'> {
  readonly defaultText: string;
  readonly render: (node: TextNode) => ReactNode;
}

export interface RectangleComponentDescription extends ComponentDescription<'rectangle'> {
  readonly render: (node: RectangleNode) => ReactNode;
}

export interface BarChartComponentDescription extends ComponentDescription<'bar-chart'> {
  readonly defaultData: BarChartNode['data'];
  readonly render: (node: BarChartNode) => ReactNode;
}

export type SceneComponentDescription =
  TextComponentDescription | RectangleComponentDescription | BarChartComponentDescription;

export interface SceneComponentRegistry {
  resolve(type: 'text', componentVersion: number): TextComponentDescription;
  resolve(type: 'rectangle', componentVersion: number): RectangleComponentDescription;
  resolve(type: 'bar-chart', componentVersion: number): BarChartComponentDescription;
  resolve(type: string, componentVersion: number): SceneComponentDescription;
}

function validDescription(description: SceneComponentDescription): boolean {
  const { width, height } = description.defaultSize;
  // 默认值也走共享契约，注册入口不能扩展节点类型或放宽数据校验。
  return (
    typeof description.label === 'string' &&
    description.label.trim().length > 0 &&
    typeof description.render === 'function' &&
    validateSceneDocument({
      schemaVersion: SCENE_SCHEMA_VERSION,
      id: 'component-registration',
      revision: 0,
      canvas: { width, height },
      rootIds: ['component'],
      nodes: [
        {
          id: 'component',
          type: description.type,
          componentVersion: description.componentVersion,
          visible: true,
          transform: { x: 0, y: 0, width, height, rotation: 0 },
          ...(description.type === 'text' ? { text: description.defaultText } : {}),
          ...(description.type === 'bar-chart' ? { data: description.defaultData } : {}),
        },
      ],
    }).success
  );
}

export function createSceneComponentRegistry(
  descriptions: readonly SceneComponentDescription[],
): SceneComponentRegistry {
  const entries = new Map<string, SceneComponentDescription>();
  for (const description of descriptions) {
    if (!validDescription(description)) throw new Error('场景组件声明无效。');
    const key = `${description.type}:${description.componentVersion}`;
    if (entries.has(key)) throw new Error('场景组件重复注册。');
    const common = {
      type: description.type,
      componentVersion: description.componentVersion,
      label: description.label,
      defaultSize: Object.freeze({
        width: description.defaultSize.width,
        height: description.defaultSize.height,
      }),
    };
    entries.set(
      key,
      description.type === 'text'
        ? Object.freeze({
            ...common,
            type: description.type,
            defaultText: description.defaultText,
            render: description.render,
          })
        : description.type === 'bar-chart'
          ? Object.freeze({
              ...common,
              type: description.type,
              defaultData: Object.freeze(
                description.defaultData.map(({ category, value }) =>
                  Object.freeze({ category, value }),
                ),
              ),
              render: description.render,
            })
          : Object.freeze({ ...common, type: description.type, render: description.render }),
    );
  }

  function resolve(type: 'text', componentVersion: number): TextComponentDescription;
  function resolve(type: 'rectangle', componentVersion: number): RectangleComponentDescription;
  function resolve(type: 'bar-chart', componentVersion: number): BarChartComponentDescription;
  function resolve(type: string, componentVersion: number): SceneComponentDescription;
  function resolve(type: string, componentVersion: number): SceneComponentDescription {
    const description = entries.get(`${type}:${componentVersion}`);
    if (!description) throw new Error('场景组件未注册。');
    return description;
  }

  return Object.freeze({ resolve });
}
