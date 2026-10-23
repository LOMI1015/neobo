import { validateSceneDocument, type SceneDocument } from '@neobo/scene/document';
import { Component } from 'react';
import type { SceneComponentRegistry } from './component-registry.js';
import { sceneComponents } from './components.js';
import { SceneView } from './SceneView.js';

export interface ScenePlayerProps {
  readonly document: unknown;
  readonly registry?: SceneComponentRegistry;
  readonly label?: string;
}

interface DrawingProps {
  readonly document: SceneDocument;
  readonly registry: SceneComponentRegistry;
  readonly label: string;
}

class DrawingBoundary extends Component<DrawingProps, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidUpdate(previous: DrawingProps) {
    if (
      this.state.failed &&
      (previous.document !== this.props.document || previous.registry !== this.props.registry)
    ) {
      this.setState({ failed: false });
    }
  }

  override render() {
    if (this.state.failed) return <div role="alert">场景绘制失败。</div>;
    const { document, registry, label } = this.props;
    const { width, height } = document.canvas;
    return (
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          aspectRatio: `${width} / ${height}`,
        }}
      >
        <SceneView document={document} registry={registry} />
      </svg>
    );
  }
}

function validatedDocument(input: unknown): SceneDocument | undefined {
  try {
    const result = validateSceneDocument(input);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function ScenePlayer({
  document,
  registry = sceneComponents,
  label = '场景播放器',
}: ScenePlayerProps) {
  // 校验结果是独立副本；非法替换直接卸载旧绘制，不继续展示过期画面。
  const parsed = validatedDocument(document);
  if (!parsed) return <div role="alert">场景文档无效或版本不受支持。</div>;
  return <DrawingBoundary document={parsed} registry={registry} label={label} />;
}
