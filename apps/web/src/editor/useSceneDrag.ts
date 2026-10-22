import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  applySceneCommandBatch,
  createTranslateCommandBatch,
  type SceneCommandBatch,
  type SceneDocument,
  type ScenePoint,
} from '@neobo/scene';
import { commandErrorMessage } from './selection';

interface DragSession {
  readonly pointerId: number;
  readonly element: SVGSVGElement;
  readonly start: ScenePoint;
  readonly document: SceneDocument;
  readonly selectedIds: readonly string[];
}

interface SceneDragOptions {
  readonly document: SceneDocument;
  readonly enabled: boolean;
  readonly onCommit: (batch: SceneCommandBatch) => boolean;
  readonly onError: (message: string) => void;
}

function canvasPoint(
  element: SVGSVGElement,
  clientX: number,
  clientY: number,
): ScenePoint | undefined {
  try {
    const matrix = element.getScreenCTM();
    if (!matrix) return undefined;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return Number.isFinite(point.x) && Number.isFinite(point.y)
      ? { x: point.x, y: point.y }
      : undefined;
  } catch {
    // 尚未布局或矩阵不可逆时明确取消，不用屏幕坐标冒充场景坐标。
    return undefined;
  }
}

function releaseCapture(session: DragSession) {
  if (session.element.hasPointerCapture(session.pointerId)) {
    session.element.releasePointerCapture(session.pointerId);
  }
}

export function useSceneDrag({ document, enabled, onCommit, onError }: SceneDragOptions) {
  const current = useRef<DragSession | null>(null);
  const [view, setView] = useState<{
    enabled: boolean;
    active: boolean;
    preview: SceneDocument | null;
  }>({ enabled, active: false, preview: null });
  // 视图切换先丢弃临时显示；捕获属于外部资源，由下面的 Effect 对称释放。
  if (view.enabled !== enabled) setView({ enabled, active: false, preview: null });

  const cancel = useCallback(() => {
    const session = current.current;
    current.current = null;
    setView((previous) => ({ ...previous, active: false, preview: null }));
    if (session) releaseCapture(session);
  }, []);

  useEffect(() => {
    if (enabled) return;
    const session = current.current;
    current.current = null;
    if (session) releaseCapture(session);
  }, [enabled]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && current.current) {
        event.preventDefault();
        cancel();
      }
    }
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', onKeyDown);
      const session = current.current;
      current.current = null;
      if (session) releaseCapture(session);
    };
  }, [cancel]);

  function begin(event: PointerEvent<SVGSVGElement>, selectedIds: readonly string[]) {
    if (
      !enabled ||
      current.current ||
      event.button !== 0 ||
      !event.isPrimary ||
      selectedIds.length === 0
    )
      return;
    const element = event.currentTarget;
    const start = canvasPoint(element, event.clientX, event.clientY);
    if (!start) {
      onError('无法读取画布坐标，本次拖动未开始。');
      return;
    }
    const session = { pointerId: event.pointerId, element, start, document, selectedIds };
    current.current = session;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      current.current = null;
      onError('无法捕获拖动指针，请重新操作。');
      return;
    }
    event.preventDefault();
    setView({ enabled, active: true, preview: null });
    onError('');
  }

  function movement(event: PointerEvent<SVGSVGElement>, session: DragSession) {
    const point = canvasPoint(session.element, event.clientX, event.clientY);
    if (!point) {
      onError('无法读取画布坐标，本次拖动已取消。');
      cancel();
      return undefined;
    }
    const delta = { x: point.x - session.start.x, y: point.y - session.start.y };
    if (delta.x === 0 && delta.y === 0) return undefined;
    const plan = createTranslateCommandBatch(session.document, session.selectedIds, delta);
    if (!plan.success) {
      onError(commandErrorMessage(plan.code));
      return undefined;
    }
    return plan.batch;
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!enabled) {
      cancel();
      return;
    }
    const session = current.current;
    if (!session || event.pointerId !== session.pointerId) return;
    const batch = movement(event, session);
    if (!batch) {
      setView((previous) => ({ ...previous, preview: null }));
      return;
    }
    const result = applySceneCommandBatch(session.document, batch);
    if (result.success) {
      setView((previous) => ({ ...previous, preview: result.document }));
      onError('');
    } else {
      setView((previous) => ({ ...previous, preview: null }));
      onError(commandErrorMessage(result.code));
    }
  }

  function onPointerUp(event: PointerEvent<SVGSVGElement>) {
    if (!enabled) {
      cancel();
      return;
    }
    const session = current.current;
    if (!session || event.pointerId !== session.pointerId) return;
    const batch = movement(event, session);
    // 先清理会话，再释放捕获，避免 lostpointercapture 取消已完成的提交。
    current.current = null;
    setView((previous) => ({ ...previous, active: false, preview: null }));
    releaseCapture(session);
    if (batch) onCommit(batch);
  }

  function onPointerCancel(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerId === current.current?.pointerId) cancel();
  }

  return {
    active: enabled && view.active,
    preview: enabled ? view.preview : null,
    begin,
    cancel,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture: onPointerCancel,
  };
}
