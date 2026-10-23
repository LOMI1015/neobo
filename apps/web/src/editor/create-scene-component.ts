import { SCENE_SCHEMA_VERSION, validateSceneDocument, type SceneDocument } from '@neobo/scene';
import {
  sceneComponents,
  type SceneAtomicNode,
  type SceneComponentRegistry,
  type SceneComponentType,
} from '@neobo/player';

export function createSceneComponent(
  type: SceneComponentType,
  { id, canvas }: { readonly id: string; readonly canvas: SceneDocument['canvas'] },
  registry: SceneComponentRegistry = sceneComponents,
): SceneAtomicNode {
  const description = registry.resolve(type, 1);
  const width = Math.min(description.defaultSize.width, canvas.width);
  const height = Math.min(description.defaultSize.height, canvas.height);
  const common = {
    id,
    componentVersion: description.componentVersion,
    visible: true,
    transform: {
      x: (canvas.width - width) / 2,
      y: (canvas.height - height) / 2,
      width,
      height,
      rotation: 0,
    },
  };
  const result = validateSceneDocument({
    schemaVersion: SCENE_SCHEMA_VERSION,
    id: 'component-creation',
    revision: 0,
    canvas,
    rootIds: [id],
    nodes: [
      description.type === 'text'
        ? { ...common, type: description.type, text: description.defaultText }
        : description.type === 'bar-chart'
          ? { ...common, type: description.type, data: description.defaultData }
          : { ...common, type: description.type },
    ],
  });
  if (!result.success) throw new Error('场景组件初始数据无效。');
  const node = result.data.nodes[0];
  if (!node || node.type === 'group') throw new Error('场景组件初始数据无效。');
  return node;
}
