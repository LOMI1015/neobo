import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as sceneCore from '@neobo/scene';
import type { SceneDocument } from '@neobo/scene';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from './Editor';

const initialDocument: SceneDocument = {
  schemaVersion: 1,
  id: 'drag-test',
  revision: 0,
  canvas: { width: 960, height: 540 },
  rootIds: ['r'],
  nodes: [
    {
      id: 'r',
      type: 'rectangle',
      componentVersion: 1,
      visible: true,
      transform: { x: 20, y: 30, width: 120, height: 80, rotation: 0 },
    },
  ],
};

interface TestMatrix {
  readonly a: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

function installPointerEvents() {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  class TestPoint {
    constructor(
      readonly x: number,
      readonly y: number,
    ) {}
    matrixTransform(matrix: TestMatrix) {
      return { x: this.x * matrix.a + matrix.e, y: this.y * matrix.d + matrix.f };
    }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('DOMPoint', TestPoint);
}

function pointerFixture() {
  installPointerEvents();
  const canvas = screen.getByRole('img', { name: '场景画布' });
  const target = canvas.querySelector('[data-node-id="r"] rect');
  if (!target) throw new Error('测试元素未绘制。');
  const captured = new Set<number>();
  // 已知屏幕矩阵：screen = canvas / 2 + (100, 50)，验证逻辑坐标而非假设 1:1。
  const getScreenCTM = vi.fn(() => ({ inverse: () => ({ a: 2, d: 2, e: -200, f: -100 }) }));
  const setPointerCapture = vi.fn((pointerId: number) => captured.add(pointerId));
  const releasePointerCapture = vi.fn((pointerId: number) => {
    captured.delete(pointerId);
    fireEvent.lostPointerCapture(canvas, { pointerId });
  });
  Object.defineProperties(canvas, {
    getScreenCTM: { configurable: true, value: getScreenCTM },
    setPointerCapture: { configurable: true, value: setPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
    hasPointerCapture: {
      configurable: true,
      value: (pointerId: number) => captured.has(pointerId),
    },
  });
  const start = { pointerId: 7, isPrimary: true, button: 0, clientX: 150, clientY: 100 };
  const end = { ...start, clientX: 200, clientY: 125 };
  return {
    canvas,
    target,
    start,
    end,
    captured,
    getScreenCTM,
    setPointerCapture,
    releasePointerCapture,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('画布选择、拖动与资源释放', () => {
  it('选择单个元素，Shift点击切换多选，点击背景清除选择', () => {
    render(
      <Editor
        initialDocument={{
          ...initialDocument,
          rootIds: ['r', 'b'],
          nodes: [...initialDocument.nodes, { ...initialDocument.nodes[0]!, id: 'b' }],
        }}
      />,
    );
    const { target, canvas, start } = pointerFixture();
    fireEvent.pointerDown(target, start);
    fireEvent.pointerUp(canvas, start);
    expect(screen.getByRole('button', { name: '选择矩形 r' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const second = canvas.querySelector('[data-node-id="b"]');
    if (!second) throw new Error('第二个测试元素未绘制。');
    fireEvent.pointerDown(second, { ...start, shiftKey: true });
    expect(screen.getByText('已选 2 项')).toBeVisible();
    fireEvent.pointerDown(second, { ...start, shiftKey: true });
    expect(screen.getByText('已选 1 项')).toBeVisible();
    fireEvent.pointerDown(canvas, start);
    expect(screen.getByText('未选择元素')).toBeVisible();
    expect(screen.getByText('修订 0')).toBeVisible();
  });

  it('拖动按CTM映射预览，移动期间不写历史，释放一次提交且可一次撤销重做', async () => {
    const user = userEvent.setup();
    render(<Editor initialDocument={initialDocument} />);
    const fixture = pointerFixture();
    fireEvent.pointerDown(fixture.target, fixture.start);
    expect(fixture.setPointerCapture).toHaveBeenCalledWith(7);
    expect(screen.getByRole('button', { name: '添加文字' })).toBeDisabled();
    fireEvent.pointerMove(fixture.canvas, { ...fixture.end, clientX: 175 });
    fireEvent.pointerMove(fixture.canvas, fixture.end);
    expect(fixture.canvas.querySelector('[data-node-id="r"]')).toHaveAttribute(
      'transform',
      'translate(120 80) rotate(0 60 40)',
    );
    expect(screen.getByText('修订 0')).toBeVisible();
    fireEvent.pointerUp(fixture.canvas, fixture.end);
    expect(fixture.releasePointerCapture).toHaveBeenCalledTimes(1);
    expect(screen.getByText('修订 1')).toBeVisible();
    expect(screen.getByLabelText('X 坐标')).toHaveValue('120');
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByLabelText('X 坐标')).toHaveValue('20');
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getByLabelText('X 坐标')).toHaveValue('120');
  });

  it('即使没有pointermove也使用pointerup最终坐标提交', () => {
    render(<Editor initialDocument={initialDocument} />);
    const fixture = pointerFixture();
    fireEvent.pointerDown(fixture.target, fixture.start);
    fireEvent.pointerUp(fixture.canvas, fixture.end);
    expect(screen.getByLabelText('X 坐标')).toHaveValue('120');
    expect(screen.getByText('修订 1')).toBeVisible();
  });

  it('没有移动以及移回起点不新增历史', () => {
    render(<Editor initialDocument={initialDocument} />);
    const fixture = pointerFixture();
    fireEvent.pointerDown(fixture.target, fixture.start);
    fireEvent.pointerUp(fixture.canvas, fixture.start);
    fireEvent.pointerDown(fixture.target, fixture.start);
    fireEvent.pointerMove(fixture.canvas, fixture.end);
    fireEvent.pointerMove(fixture.canvas, fixture.start);
    fireEvent.pointerUp(fixture.canvas, fixture.start);
    expect(screen.getByText('修订 0')).toBeVisible();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
    expect(fixture.captured.size).toBe(0);
  });

  it('忽略其他指针及右键，当前手势不会被第二个指针结束', () => {
    render(<Editor initialDocument={initialDocument} />);
    const fixture = pointerFixture();
    fireEvent.pointerDown(fixture.target, { ...fixture.start, button: 2 });
    fireEvent.pointerDown(fixture.target, { ...fixture.start, isPrimary: false });
    expect(fixture.setPointerCapture).not.toHaveBeenCalled();
    fireEvent.pointerDown(fixture.target, fixture.start);
    fireEvent.pointerMove(fixture.canvas, { ...fixture.end, pointerId: 8 });
    fireEvent.pointerUp(fixture.canvas, { ...fixture.end, pointerId: 8 });
    fireEvent.pointerCancel(fixture.canvas, { pointerId: 8 });
    expect(screen.getByRole('button', { name: '添加文字' })).toBeDisabled();
    expect(screen.getByText('修订 0')).toBeVisible();
    fireEvent.pointerUp(fixture.canvas, fixture.end);
    expect(screen.getByText('修订 1')).toBeVisible();
  });

  it.each(['pointercancel', 'lostpointercapture', 'escape', 'blur'])(
    '%s取消临时预览并释放资源，不提交历史',
    (reason) => {
      render(<Editor initialDocument={initialDocument} />);
      const fixture = pointerFixture();
      fireEvent.pointerDown(fixture.target, fixture.start);
      fireEvent.pointerMove(fixture.canvas, fixture.end);
      if (reason === 'pointercancel') fireEvent.pointerCancel(fixture.canvas, { pointerId: 7 });
      if (reason === 'lostpointercapture') {
        fixture.captured.delete(7);
        fireEvent.lostPointerCapture(fixture.canvas, { pointerId: 7 });
      }
      if (reason === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
      if (reason === 'blur') fireEvent.blur(window);
      fireEvent.pointerUp(fixture.canvas, fixture.end);
      expect(fixture.canvas.querySelector('[data-node-id="r"]')).toHaveAttribute(
        'transform',
        'translate(20 30) rotate(0 60 40)',
      );
      expect(screen.getByRole('button', { name: '添加文字' })).toBeEnabled();
      expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
      expect(screen.getByText('修订 0')).toBeVisible();
      expect(fixture.captured.size).toBe(0);
    },
  );

  it('StrictMode重新挂载监听对称，卸载释放捕获并移除全局监听', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <StrictMode>
        <Editor initialDocument={initialDocument} />
      </StrictMode>,
    );
    const fixture = pointerFixture();
    fireEvent.pointerDown(fixture.target, fixture.start);
    fireEvent.pointerMove(fixture.canvas, fixture.end);
    unmount();
    expect(fixture.captured.size).toBe(0);
    expect(fixture.releasePointerCapture).toHaveBeenCalledTimes(1);
    for (const type of ['keydown', 'blur']) {
      const registrations = add.mock.calls.filter(([eventType]) => eventType === type);
      const removals = remove.mock.calls.filter(([eventType]) => eventType === type);
      expect(registrations).toHaveLength(2);
      expect(removals).toHaveLength(2);
      expect(removals.map(([, listener]) => listener)).toEqual(
        registrations.map(([, listener]) => listener),
      );
    }
  });

  it('隐藏编辑器主动取消和释放，再显示时保留文档但不恢复旧拖动', () => {
    const { rerender } = render(<Editor initialDocument={initialDocument} />);
    const fixture = pointerFixture();
    fireEvent.pointerDown(fixture.target, fixture.start);
    fireEvent.pointerMove(fixture.canvas, fixture.end);
    rerender(<Editor initialDocument={initialDocument} active={false} />);
    expect(fixture.captured.size).toBe(0);
    fireEvent.pointerUp(fixture.canvas, fixture.end);
    rerender(<Editor initialDocument={initialDocument} active />);
    expect(fixture.canvas.querySelector('[data-node-id="r"]')).toHaveAttribute(
      'transform',
      'translate(20 30) rotate(0 60 40)',
    );
    expect(screen.getByText('修订 0')).toBeVisible();
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });

  it('CTM不存在或产生非有限坐标时明确拒绝拖动', () => {
    render(<Editor initialDocument={initialDocument} />);
    const fixture = pointerFixture();
    Object.defineProperty(fixture.canvas, 'getScreenCTM', {
      configurable: true,
      value: () => null,
    });
    fireEvent.pointerDown(fixture.target, fixture.start);
    expect(screen.getByRole('alert')).toHaveTextContent('无法读取画布坐标');
    Object.defineProperty(fixture.canvas, 'getScreenCTM', {
      value: () => ({ inverse: () => ({ a: NaN, d: NaN, e: NaN, f: NaN }) }),
    });
    fireEvent.pointerDown(fixture.target, fixture.start);
    expect(fixture.setPointerCapture).not.toHaveBeenCalled();
    expect(screen.getByText('修订 0')).toBeVisible();
  });

  it('指针捕获失败时显示失败并保留可继续操作的状态', () => {
    render(<Editor initialDocument={initialDocument} />);
    const fixture = pointerFixture();
    fixture.setPointerCapture.mockImplementationOnce(() => {
      throw new DOMException('Inactive pointer', 'NotFoundError');
    });
    fireEvent.pointerDown(fixture.target, fixture.start);
    expect(screen.getByRole('alert')).toHaveTextContent('无法捕获拖动指针');
    fireEvent.pointerMove(fixture.canvas, fixture.end);
    fireEvent.pointerUp(fixture.canvas, fixture.end);
    expect(screen.getByRole('button', { name: '添加文字' })).toBeEnabled();
    expect(screen.getByText('修订 0')).toBeVisible();
  });

  it('拖动越界失败后不提交之前的预览，修订与历史不变', () => {
    render(<Editor initialDocument={initialDocument} />);
    const fixture = pointerFixture();
    fireEvent.pointerDown(fixture.target, fixture.start);
    fireEvent.pointerMove(fixture.canvas, fixture.end);
    fireEvent.pointerUp(fixture.canvas, { ...fixture.end, clientX: 1_000_000 });
    expect(screen.getByRole('alert')).toHaveTextContent('坐标或尺寸超出允许范围');
    expect(screen.getByLabelText('X 坐标')).toHaveValue('20');
    expect(screen.getByText('修订 0')).toBeVisible();
    expect(fixture.captured.size).toBe(0);
  });

  it('原修订拖动不能覆盖期间已推进的历史', () => {
    const history = sceneCore.createSceneHistory(initialDocument);
    vi.spyOn(sceneCore, 'createSceneHistory').mockReturnValue(history);
    render(<Editor initialDocument={initialDocument} />);
    const fixture = pointerFixture();
    fireEvent.pointerDown(fixture.target, fixture.start);
    fireEvent.pointerMove(fixture.canvas, fixture.end);
    const external = history.execute({
      sceneId: initialDocument.id,
      baseRevision: 0,
      operations: [{ type: 'node.update', nodeId: 'r', changes: { transform: { x: 200 } } }],
    });
    expect(external.success).toBe(true);
    fireEvent.pointerUp(fixture.canvas, fixture.end);
    expect(screen.getByRole('alert')).toHaveTextContent('场景已被更新，本次操作未应用');
    expect(history.current().nodes[0]?.transform.x).toBe(200);
    expect(history.current().revision).toBe(1);
    expect(screen.getByLabelText('X 坐标')).toHaveValue('200');
    expect(fixture.captured.size).toBe(0);
    fireEvent.pointerDown(fixture.target, fixture.start);
    fireEvent.pointerUp(fixture.canvas, fixture.end);
    expect(history.current().nodes[0]?.transform.x).toBe(300);
    expect(history.current().revision).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('选中旋转组合中的子节点拖动，场景位移正确换算为父局部坐标', async () => {
    const user = userEvent.setup();
    const grouped: SceneDocument = {
      ...initialDocument,
      rootIds: ['g'],
      nodes: [
        {
          id: 'g',
          type: 'group',
          visible: true,
          children: ['r'],
          transform: { x: 200, y: 100, width: 240, height: 180, rotation: 90 },
        },
        ...initialDocument.nodes,
      ],
    };
    render(<Editor initialDocument={grouped} />);
    const fixture = pointerFixture();
    await user.click(screen.getByRole('button', { name: '选择矩形 r' }));
    fireEvent.pointerDown(fixture.target, fixture.start);
    fireEvent.pointerUp(fixture.canvas, fixture.end);
    expect(fixture.canvas.querySelector('[data-node-id="r"]')).toHaveAttribute(
      'transform',
      'translate(70 -70) rotate(0 60 40)',
    );
    expect(fixture.canvas.querySelector('[data-node-id="g"]')).toHaveAttribute(
      'transform',
      'translate(200 100) rotate(90 120 90)',
    );
    expect(screen.getByText('修订 1')).toBeVisible();
  });

  it('选中组合后从子节点处拖动整个组合，所选后代不重复位移', async () => {
    const user = userEvent.setup();
    const grouped: SceneDocument = {
      ...initialDocument,
      rootIds: ['g'],
      nodes: [
        {
          id: 'g',
          type: 'group',
          visible: true,
          children: ['r'],
          transform: { x: 200, y: 100, width: 240, height: 180, rotation: 0 },
        },
        ...initialDocument.nodes,
      ],
    };
    render(<Editor initialDocument={grouped} />);
    const fixture = pointerFixture();
    await user.click(screen.getByRole('button', { name: '选择组合 g' }));
    fireEvent.click(screen.getByRole('button', { name: '选择矩形 r' }), { shiftKey: true });
    fireEvent.pointerDown(fixture.target, fixture.start);
    fireEvent.pointerUp(fixture.canvas, fixture.end);
    expect(fixture.canvas.querySelector('[data-node-id="g"]')).toHaveAttribute(
      'transform',
      'translate(300 150) rotate(0 120 90)',
    );
    expect(fixture.canvas.querySelector('[data-node-id="r"]')).toHaveAttribute(
      'transform',
      'translate(20 30) rotate(0 60 40)',
    );
    expect(screen.getByText('修订 1')).toBeVisible();
  });
});
