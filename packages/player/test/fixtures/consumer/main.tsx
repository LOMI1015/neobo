import type { SceneDocument } from '@neobo/scene/document';
import {
  ScenePlayer,
  SceneView,
  createSceneComponentRegistry,
  sceneComponents,
} from '@neobo/player';
import { createRoot } from 'react-dom/client';

const scene = {
  schemaVersion: 1,
  id: 'independent-consumer',
  revision: 0,
  canvas: { width: 960, height: 540 },
  theme: { id: 'deep-blue', version: 1 },
  rootIds: ['title', 'chart'],
  nodes: [
    {
      id: 'title',
      type: 'text',
      componentVersion: 1,
      visible: true,
      transform: { x: 20, y: 20, width: 320, height: 72, rotation: 0 },
      text: '只读场景',
    },
    {
      id: 'chart',
      type: 'bar-chart',
      componentVersion: 1,
      visible: true,
      transform: { x: 20, y: 120, width: 480, height: 320, rotation: 0 },
      data: [{ category: '静态分类', value: -2 }],
    },
  ],
} satisfies SceneDocument;

const registry = createSceneComponentRegistry([
  sceneComponents.resolve('text', 1),
  sceneComponents.resolve('rectangle', 1),
  sceneComponents.resolve('bar-chart', 1),
]);
const host = document.getElementById('root');
if (!host) throw new Error('独立消费者挂载点缺失。');

createRoot(host).render(
  <>
    <ScenePlayer document={scene} />
    <svg viewBox="0 0 960 540">
      <SceneView document={scene} registry={registry} />
    </svg>
  </>,
);
