import { useCallback, useState, type MouseEvent, type PointerEvent } from 'react';
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
import { SceneView, sceneComponents, type SceneComponentType } from '@neobo/player';
import { createSceneComponent } from './create-scene-component';
import { Button } from '../components/ui/button';
import { EditorActionsMenu, EditorContextMenu, type EditorMenuActions } from './EditorMenus';
import { LayerList } from './LayerList';
import { PropertiesPanel, type NodeChanges } from './PropertiesPanel';
import { commandErrorMessage, nextNodeId, selectionRoots, toggleSelection } from './selection';
import { useSceneDrag } from './useSceneDrag';
import './editor.css';

export interface EditorProps {
  readonly initialDocument?: SceneDocument;
  readonly active?: boolean;
  readonly onPreview?: (document: SceneDocument) => void;
}

type MenuSource = 'canvas' | 'layers' | 'actions';

export function Editor({ initialDocument, active = true, onPreview }: EditorProps) {
  const [history] = useState(() =>
    createSceneHistory(
      initialDocument ?? createEmptyScene({ id: 'local-scene', width: 1920, height: 1080 }),
    ),
  );
  const [document, setDocument] = useState(() => history.current());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ source: MenuSource; revision: number } | null>(null);
  // 隐藏视图或场景推进后立即关闭菜单，避免 Portal 留在编辑器外使用过时上下文。
  if (menu && (!active || menu.revision !== document.revision)) setMenu(null);

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

  const drag = useSceneDrag({
    document,
    enabled: active && menu === null,
    onCommit: execute,
    onError: setError,
  });
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

  function add(type: SceneComponentType) {
    const id = nextNodeId(document, type);
    const node = createSceneComponent(type, { id, canvas: document.canvas });
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

  function changeMenu(source: MenuSource, open: boolean) {
    if (open) {
      if (!active || drag.active) return;
      setMenu({ source, revision: document.revision });
    } else {
      setMenu((current) => (current?.source === source ? null : current));
    }
  }

  function contextMenu(event: MouseEvent<HTMLElement>) {
    if (!active || drag.active) {
      event.preventDefault();
      return;
    }
    const target = event.target;
    const element =
      target instanceof Element ? target.closest('[data-node-id], [data-editor-node-id]') : null;
    const nodeId =
      element?.getAttribute('data-node-id') ?? element?.getAttribute('data-editor-node-id');
    if (!nodeId) return;
    const coveredBySelection = !selectionRoots(document, [...selectedIds, nodeId]).includes(nodeId);
    if (!selectedIds.includes(nodeId) && !coveredBySelection) setSelectedIds([nodeId]);
    setError('');
  }

  const menuActions: EditorMenuActions = {
    selectionCount: selectedIds.length,
    canGroup: selectedIds.length >= 2,
    canUngroup: singleNode?.type === 'group',
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
    singleVisible: singleNode?.visible,
    onGroup: groupSelected,
    onUngroup: ungroupSelected,
    onDelete: removeSelected,
    onToggleVisible: () => {
      if (singleNode) updateNode(singleNode, { visible: !singleNode.visible });
    },
    onUndo: () => restore('undo'),
    onRedo: () => restore('redo'),
  };

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !event.isPrimary || drag.active || menu !== null) return;
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
          <Button
            variant="outline"
            type="button"
            disabled={drag.active}
            onClick={() => add('text')}
          >
            <span aria-hidden="true">T</span> 添加{sceneComponents.resolve('text', 1).label}
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={drag.active}
            onClick={() => add('rectangle')}
          >
            <span aria-hidden="true">□</span> 添加{sceneComponents.resolve('rectangle', 1).label}
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={drag.active}
            onClick={() => add('bar-chart')}
          >
            <span aria-hidden="true">▥</span> 添加{sceneComponents.resolve('bar-chart', 1).label}
          </Button>
        </div>
        <div className="editor-tool-group">
          <Button
            variant="outline"
            type="button"
            disabled={drag.active || selectedIds.length < 2}
            onClick={groupSelected}
          >
            组合
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={drag.active || singleNode?.type !== 'group'}
            onClick={ungroupSelected}
          >
            拆组
          </Button>
          <Button
            variant="destructive"
            type="button"
            disabled={drag.active || selectedIds.length === 0}
            onClick={removeSelected}
          >
            删除
          </Button>
        </div>
        <div className="editor-tool-group editor-history-tools">
          <Button
            variant="outline"
            type="button"
            disabled={drag.active || !history.canUndo()}
            onClick={() => restore('undo')}
          >
            撤销
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={drag.active || !history.canRedo()}
            onClick={() => restore('redo')}
          >
            重做
          </Button>
          {onPreview && (
            <Button
              variant="outline"
              type="button"
              disabled={!active || drag.active}
              onClick={() => onPreview(history.current())}
            >
              预览
            </Button>
          )}
          <EditorActionsMenu
            actions={menuActions}
            disabled={!active || drag.active}
            open={menu?.source === 'actions' && active}
            onOpenChange={(open) => changeMenu('actions', open)}
          />
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
        <EditorContextMenu
          label="图层操作"
          actions={menuActions}
          disabled={!active || drag.active}
          open={menu?.source === 'layers' && active}
          onOpenChange={(open) => changeMenu('layers', open)}
        >
          <aside
            className="editor-sidebar editor-layer-panel"
            aria-labelledby="editor-layers-heading"
            onContextMenu={contextMenu}
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
          </aside>
        </EditorContextMenu>
        <div className="editor-stage-panel">
          <div className="editor-canvas-heading">
            <span>场景画布</span>
            <span>
              {document.canvas.width} × {document.canvas.height}
            </span>
          </div>
          <EditorContextMenu
            label="画布操作"
            actions={menuActions}
            disabled={!active || drag.active}
            open={menu?.source === 'canvas' && active}
            onOpenChange={(open) => changeMenu('canvas', open)}
          >
            <div
              className="editor-stage"
              onContextMenu={contextMenu}
              tabIndex={0}
              role="group"
              aria-label="画布操作"
            >
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
                {active && <SceneView document={displayDocument} />}
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
            </div>
          </EditorContextMenu>
          <div className="editor-canvas-footer">
            <span>{drag.active ? '拖动中' : '就绪'}</span>
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
              <p>
                {selectedIds.length > 1 ? `已选择 ${selectedIds.length} 个元素` : '选择一个元素'}
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
