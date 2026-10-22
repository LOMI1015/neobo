import { useCallback, useState, type PointerEvent } from 'react';
import {
  createEmptyScene,
  createGroupCommandBatch,
  createSceneHistory,
  createUngroupCommandBatch,
  getNodeWorldCorners,
  SCENE_COMMAND_LIMITS,
  type SceneCommandBatch,
  type SceneDocument,
  type SceneNode,
} from '@neobo/scene';
import { SceneView } from '../scene/SceneView';
import { LayerList } from './LayerList';
import { PropertiesPanel, type NodeChanges } from './PropertiesPanel';
import { commandErrorMessage, nextNodeId, selectionRoots, toggleSelection } from './selection';
import { useSceneDrag } from './useSceneDrag';
import './editor.css';

export interface EditorProps {
  readonly initialDocument?: SceneDocument;
  readonly active?: boolean;
}

export function Editor({ initialDocument, active = true }: EditorProps) {
  const [history] = useState(() =>
    createSceneHistory(
      initialDocument ?? createEmptyScene({ id: 'local-scene', width: 1920, height: 1080 }),
    ),
  );
  const [document, setDocument] = useState(() => history.current());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const accept = useCallback((nextDocument: SceneDocument) => {
    setDocument(nextDocument);
    const ids = new Set(nextDocument.nodes.map((node) => node.id));
    setSelectedIds((current) => current.filter((id) => ids.has(id)));
    setError('');
  }, []);

  const execute = useCallback(
    (batch: SceneCommandBatch) => {
      const result = history.execute(batch);
      if (!result.success) {
        if (result.code === 'REVISION_CONFLICT') accept(history.current());
        setError(commandErrorMessage(result.code));
        return false;
      }
      accept(result.document);
      return true;
    },
    [accept, history],
  );

  const drag = useSceneDrag({ document, enabled: active, onCommit: execute, onError: setError });
  const displayDocument = drag.preview ?? document;
  const singleNode =
    selectedIds.length === 1
      ? document.nodes.find((node) => node.id === selectedIds[0])
      : undefined;

  function batch(operations: SceneCommandBatch['operations']): SceneCommandBatch {
    return { sceneId: document.id, baseRevision: document.revision, operations };
  }

  function select(nodeId: string, extend: boolean) {
    if (drag.active) return;
    setSelectedIds((current) => (extend ? toggleSelection(current, nodeId) : [nodeId]));
    setError('');
  }

  function add(type: 'text' | 'rectangle') {
    const id = nextNodeId(document, type);
    const width = Math.min(320, document.canvas.width);
    const height = Math.min(type === 'text' ? 72 : 180, document.canvas.height);
    const common = {
      id,
      visible: true,
      transform: {
        x: (document.canvas.width - width) / 2,
        y: (document.canvas.height - height) / 2,
        width,
        height,
        rotation: 0,
      },
    };
    const node: SceneNode =
      type === 'text'
        ? { ...common, type: 'text', componentVersion: 1, text: '文字' }
        : { ...common, type: 'rectangle', componentVersion: 1 };
    if (
      execute(batch([{ type: 'node.add', node, parentId: null, index: document.rootIds.length }]))
    ) {
      setSelectedIds([id]);
    }
  }

  function removeSelected() {
    const roots = selectionRoots(document, selectedIds);
    if (roots.length > SCENE_COMMAND_LIMITS.maxOperations) {
      setError(commandErrorMessage('COMMAND_LIMIT'));
      return;
    }
    execute(batch(roots.map((nodeId) => ({ type: 'node.remove', nodeId }))));
  }

  function groupSelected() {
    const id = nextNodeId(document, 'group');
    const plan = createGroupCommandBatch(document, selectedIds, id);
    if (!plan.success) {
      setError(commandErrorMessage(plan.code));
      return;
    }
    if (execute(plan.batch)) setSelectedIds([id]);
  }

  function ungroupSelected() {
    if (singleNode?.type !== 'group') return;
    const plan = createUngroupCommandBatch(document, singleNode.id);
    if (!plan.success) {
      setError(commandErrorMessage(plan.code));
      return;
    }
    if (execute(plan.batch)) setSelectedIds([...singleNode.children]);
  }

  function restore(direction: 'undo' | 'redo') {
    const request = { sceneId: document.id, baseRevision: document.revision };
    const result = history[direction](request);
    if (result.success) accept(result.document);
    else {
      if (result.code === 'REVISION_CONFLICT') accept(history.current());
      setError(commandErrorMessage(result.code));
    }
  }

  function updateNode(node: SceneNode, changes: NodeChanges) {
    execute(batch([{ type: 'node.update', nodeId: node.id, changes }]));
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.active) return;
    const target = event.target;
    const nodeId =
      target instanceof Element
        ? target.closest('[data-node-id]')?.getAttribute('data-node-id')
        : undefined;
    if (!nodeId) {
      if (!event.shiftKey) setSelectedIds([]);
      setError('');
      return;
    }
    if (event.shiftKey) {
      select(nodeId, true);
      return;
    }
    const coveredBySelection = !selectionRoots(document, [...selectedIds, nodeId]).includes(nodeId);
    const nextSelection =
      selectedIds.includes(nodeId) || coveredBySelection ? selectedIds : [nodeId];
    setSelectedIds([...nextSelection]);
    drag.begin(event, nextSelection);
  }

  return (
    <section className="editor" aria-label="二维场景编辑器">
      <div className="editor-toolbar" role="toolbar" aria-label="编辑工具">
        <div className="editor-tool-group">
          <button type="button" disabled={drag.active} onClick={() => add('text')}>
            <span aria-hidden="true">T</span> 添加文字
          </button>
          <button type="button" disabled={drag.active} onClick={() => add('rectangle')}>
            <span aria-hidden="true">□</span> 添加矩形
          </button>
        </div>
        <div className="editor-tool-group">
          <button
            type="button"
            disabled={drag.active || selectedIds.length < 2}
            onClick={groupSelected}
          >
            组合
          </button>
          <button
            type="button"
            disabled={drag.active || singleNode?.type !== 'group'}
            onClick={ungroupSelected}
          >
            拆组
          </button>
          <button
            className="editor-delete"
            type="button"
            disabled={drag.active || selectedIds.length === 0}
            onClick={removeSelected}
          >
            删除
          </button>
        </div>
        <div className="editor-tool-group editor-history-tools">
          <button
            type="button"
            disabled={drag.active || !history.canUndo()}
            onClick={() => restore('undo')}
          >
            撤销
          </button>
          <button
            type="button"
            disabled={drag.active || !history.canRedo()}
            onClick={() => restore('redo')}
          >
            重做
          </button>
        </div>
      </div>
      <div className="editor-session">
        <span>
          <span className="editor-session-dot" aria-hidden="true" />
          仅当前会话，刷新后不会保存
        </span>
        <span>修订 {document.revision}</span>
      </div>
      {error && (
        <div className="editor-error" role="alert">
          {error}
        </div>
      )}
      <div className="editor-workspace">
        <aside
          className="editor-sidebar editor-layer-panel"
          aria-labelledby="editor-layers-heading"
        >
          <div className="editor-panel-heading">
            <h2 id="editor-layers-heading">图层</h2>
            <span>{document.nodes.length}</span>
          </div>
          <LayerList
            document={document}
            selectedIds={selectedIds}
            disabled={drag.active}
            onSelect={select}
            onToggleVisible={(node) => updateNode(node, { visible: !node.visible })}
          />
          <p className="editor-help editor-layer-help">
            Shift + 点击多选。图层从上到下排列，隐藏元素仍可选择。
          </p>
        </aside>
        <div className="editor-stage-panel">
          <div className="editor-canvas-heading">
            <span>场景画布</span>
            <span>
              {document.canvas.width} × {document.canvas.height}
            </span>
          </div>
          <div className="editor-stage">
            <svg
              className="editor-canvas"
              viewBox={`0 0 ${document.canvas.width} ${document.canvas.height}`}
              width={document.canvas.width}
              height={document.canvas.height}
              role="img"
              aria-label="场景画布"
              onPointerDown={onPointerDown}
              onPointerMove={drag.onPointerMove}
              onPointerUp={drag.onPointerUp}
              onPointerCancel={drag.onPointerCancel}
              onLostPointerCapture={drag.onLostPointerCapture}
            >
              <SceneView document={displayDocument} />
              <g className="editor-selection" pointerEvents="none" aria-hidden="true">
                {selectedIds.map((id) => {
                  const corners = getNodeWorldCorners(displayDocument, id);
                  return corners ? (
                    <polygon
                      key={id}
                      points={corners.map((point) => `${point.x},${point.y}`).join(' ')}
                    />
                  ) : null;
                })}
              </g>
            </svg>
            {document.nodes.length === 0 && (
              <div className="editor-canvas-empty">
                <strong>从一张白板开始</strong>
                <span>添加文字或矩形，创建你的第一个场景。</span>
              </div>
            )}
          </div>
          <div className="editor-canvas-footer">
            <span>{drag.active ? '拖动中 · 按 Esc 取消' : '点击选择 · Shift 多选 · 拖动移动'}</span>
            <span>{selectedIds.length > 0 ? `已选 ${selectedIds.length} 项` : '未选择元素'}</span>
          </div>
        </div>
        <aside
          className="editor-sidebar editor-property-panel"
          aria-labelledby="editor-properties-heading"
        >
          <div className="editor-panel-heading">
            <h2 id="editor-properties-heading">属性</h2>
          </div>
          {singleNode ? (
            <PropertiesPanel
              key={`${singleNode.id}:${document.revision}`}
              node={singleNode}
              disabled={drag.active}
              onApply={(changes) => updateNode(singleNode, changes)}
            />
          ) : (
            <div className="editor-sidebar-empty">
              <span className="editor-empty-symbol" aria-hidden="true">
                ⌘
              </span>
              <p>
                {selectedIds.length > 1 ? `已选择 ${selectedIds.length} 个元素` : '选择一个元素'}
              </p>
              <span>
                {selectedIds.length > 1
                  ? '可拖动、组合或删除所选元素。'
                  : '在画布或图层中选择后编辑属性。'}
              </span>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
