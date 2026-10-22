import type { MouseEvent } from 'react';
import type { SceneDocument, SceneNode } from '@neobo/scene';
import { nodeTitle } from './selection';

interface LayerListProps {
  readonly document: SceneDocument;
  readonly selectedIds: readonly string[];
  readonly disabled: boolean;
  readonly onSelect: (nodeId: string, extend: boolean) => void;
  readonly onToggleVisible: (node: SceneNode) => void;
}

export function LayerList({
  document,
  selectedIds,
  disabled,
  onSelect,
  onToggleVisible,
}: LayerListProps) {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));

  function renderLayer(nodeId: string, ancestorHidden: boolean) {
    const node = nodes.get(nodeId);
    if (!node) return null;
    const hidden = ancestorHidden || !node.visible;
    return (
      <li key={node.id}>
        <div className={`editor-layer-row${selectedIds.includes(node.id) ? ' is-selected' : ''}`}>
          <button
            className="editor-layer-select"
            type="button"
            disabled={disabled}
            aria-label={`选择${nodeTitle(node)} ${node.id}`}
            aria-pressed={selectedIds.includes(node.id)}
            onClick={(event: MouseEvent<HTMLButtonElement>) => onSelect(node.id, event.shiftKey)}
          >
            <span className="editor-layer-icon" aria-hidden="true">
              {node.type === 'text' ? 'T' : node.type === 'rectangle' ? '□' : '▣'}
            </span>
            <span className="editor-layer-name">
              <span>{node.type === 'text' ? node.text || '空文字' : nodeTitle(node)}</span>
              <span className="editor-layer-id">
                {node.id}
                {hidden ? (ancestorHidden ? ' · 随组合隐藏' : ' · 隐藏') : ''}
              </span>
            </span>
          </button>
          <button
            className="editor-layer-visibility"
            type="button"
            disabled={disabled}
            aria-label={`${node.visible ? '隐藏' : '显示'} ${node.id}`}
            onClick={() => onToggleVisible(node)}
          >
            {node.visible ? '显' : '隐'}
          </button>
        </div>
        {node.type === 'group' && node.children.length > 0 && (
          <ul>{[...node.children].reverse().map((id) => renderLayer(id, hidden))}</ul>
        )}
      </li>
    );
  }

  return document.nodes.length > 0 ? (
    <ul className="editor-layers">
      {[...document.rootIds].reverse().map((id) => renderLayer(id, false))}
    </ul>
  ) : (
    <div className="editor-sidebar-empty">
      <span className="editor-empty-symbol" aria-hidden="true">
        ▱
      </span>
      <p>还没有元素</p>
      <span>从上方添加文字或矩形。</span>
    </div>
  );
}
