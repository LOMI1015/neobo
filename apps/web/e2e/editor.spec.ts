import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const node = (page: Page, id: string) => page.locator(`g[data-node-id="${id}"]`);
const layer = (page: Page, id: string) =>
  page.getByRole('button', { name: new RegExp(`^选择.+ ${id}$`) });

async function edit(page: Page, values: Readonly<Record<string, string>>) {
  for (const [label, value] of Object.entries(values))
    await page.getByRole('textbox', { name: label, exact: true }).fill(value);
  await page.getByRole('button', { name: '应用属性' }).click();
}

async function add(page: Page, type: '文字' | '矩形') {
  await page.getByRole('button', { name: `添加${type}` }).click();
}

async function screenCorners(page: Page, id: string) {
  return node(page, id).evaluate((element) => {
    if (!(element instanceof SVGGraphicsElement)) throw new Error('节点必须为 SVG 图形。');
    const matrix = element.getScreenCTM();
    if (!matrix) throw new Error('节点缺少屏幕变换。');
    const box = element.getBBox();
    return [
      new DOMPoint(box.x, box.y),
      new DOMPoint(box.x + box.width, box.y),
      new DOMPoint(box.x + box.width, box.y + box.height),
      new DOMPoint(box.x, box.y + box.height),
    ].map((point) => {
      const transformed = point.matrixTransform(matrix);
      return { x: transformed.x, y: transformed.y };
    });
  });
}

function sameCorners(
  actual: readonly { x: number; y: number }[],
  expected: readonly { x: number; y: number }[],
) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, index) => {
    expect(point.x).toBeCloseTo(expected[index]?.x ?? NaN, 4);
    expect(point.y).toBeCloseTo(expected[index]?.y ?? NaN, 4);
  });
}

async function center(page: Page, id: string) {
  const points = await screenCorners(page, id);
  const first = points[0];
  const opposite = points[2];
  if (!first || !opposite) throw new Error('缺少节点四角。');
  return { x: (first.x + opposite.x) / 2, y: (first.y + opposite.y) / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/');
  await expect(page.getByRole('img', { name: '场景画布' })).toBeVisible();
});

test('文字、矩形与属性编辑通过统一历史恢复，服务切换保留会话', async ({ page }) => {
  await add(page, '文字');
  await edit(page, {
    文字内容: '销售概览\n中文 😀 <script>文本</script>',
    'X 坐标': '260',
    'Y 坐标': '180',
  });
  await expect(node(page, 'text-1').locator('foreignObject > div')).toHaveText(
    '销售概览\n中文 😀 <script>文本</script>',
  );
  await expect(node(page, 'text-1').locator('script')).toHaveCount(0);
  await add(page, '矩形');
  await edit(page, { 'X 坐标': '260', 'Y 坐标': '400', 宽度: '600', 高度: '240' });
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(node(page, 'rectangle-1')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(node(page, 'rectangle-1')).toBeVisible();
  await page.getByRole('button', { name: '服务检查', exact: true }).click();
  await expect(page.getByText('服务已连接', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '画布编辑', exact: true }).click();
  await expect(node(page, 'rectangle-1')).toBeVisible();
  await expect(page.getByText('仅当前会话，刷新后不会保存')).toBeVisible();
});

test('非连续组合占最高选中层，旋转后拆组保持实际 SVG 几何', async ({ page }) => {
  await add(page, '文字');
  await edit(page, { 'X 坐标': '240', 'Y 坐标': '220' });
  await add(page, '矩形');
  await edit(page, { 'X 坐标': '420', 'Y 坐标': '300', '旋转角度（°）': '20' });
  await add(page, '文字');
  await edit(page, { 'X 坐标': '660', 'Y 坐标': '460' });
  const before = await screenCorners(page, 'text-1');
  await layer(page, 'text-1').click();
  await layer(page, 'text-2').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '组合', exact: true }).click();
  sameCorners(await screenCorners(page, 'text-1'), before);
  await expect(node(page, 'group-1').locator(':scope > g')).toHaveCount(2);
  const roots = await page
    .locator('svg.editor-canvas > g[data-node-id]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-node-id')));
  expect(roots).toEqual(['rectangle-1', 'group-1']);
  await edit(page, { '旋转角度（°）': '35' });
  const first = await screenCorners(page, 'text-1');
  const second = await screenCorners(page, 'text-2');
  await page.getByRole('button', { name: '拆组', exact: true }).click();
  await expect(node(page, 'group-1')).toHaveCount(0);
  sameCorners(await screenCorners(page, 'text-1'), first);
  sameCorners(await screenCorners(page, 'text-2'), second);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(node(page, 'group-1')).toBeVisible();
  sameCorners(await screenCorners(page, 'text-1'), first);
});

test('适配画布使用真实 CTM 拖动，画布外释放只形成一步历史', async ({ page }) => {
  await add(page, '矩形');
  await edit(page, { 'X 坐标': '500', 'Y 坐标': '300' });
  const original = await node(page, 'rectangle-1').getAttribute('transform');
  const start = await center(page, 'rectangle-1');
  const before = await screenCorners(page, 'rectangle-1');
  const canvas = page.getByRole('img', { name: '场景画布' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('画布未布局。');
  const movement = { x: 83, y: 37 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + movement.x, start.y + movement.y, { steps: 5 });
  await page.mouse.up();
  const moved = await screenCorners(page, 'rectangle-1');
  moved.forEach((point, index) => {
    expect(point.x - (before[index]?.x ?? NaN)).toBeCloseTo(movement.x, 4);
    expect(point.y - (before[index]?.y ?? NaN)).toBeCloseTo(movement.y, 4);
  });
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(node(page, 'rectangle-1')).toHaveAttribute('transform', original ?? '');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  const nextStart = await center(page, 'rectangle-1');
  await page.mouse.move(nextStart.x, nextStart.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 15, nextStart.y);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  await expect(page.getByText('拖动中 · 按 Esc 取消')).toHaveCount(0);
});

test('Escape、指针取消和失去捕获不修改场景或新增历史', async ({ page }) => {
  await add(page, '矩形');
  const original = await node(page, 'rectangle-1').getAttribute('transform');
  for (const cancellation of ['escape', 'pointercancel', 'lostpointercapture'] as const) {
    const start = await center(page, 'rectangle-1');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 50, start.y + 25);
    if (cancellation === 'escape') await page.keyboard.press('Escape');
    else
      await page
        .getByRole('img', { name: '场景画布' })
        .dispatchEvent(cancellation, { pointerId: 1, isPrimary: true });
    await page.mouse.up();
    await expect(node(page, 'rectangle-1')).toHaveAttribute('transform', original ?? '');
  }
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(node(page, 'rectangle-1')).toHaveCount(0);
});

test('键盘切换视图时取消隐藏编辑器的拖动，返回后仍可继续编辑', async ({ page }) => {
  await add(page, '矩形');
  const original = await node(page, 'rectangle-1').getAttribute('transform');
  const start = await center(page, 'rectangle-1');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 10);
  await page.getByRole('button', { name: '服务检查', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('服务已连接', { exact: true })).toBeVisible();
  await page.mouse.up();
  await page.getByRole('button', { name: '画布编辑', exact: true }).click();
  await expect(node(page, 'rectangle-1')).toHaveAttribute('transform', original ?? '');
  await add(page, '文字');
  await expect(node(page, 'text-1')).toBeVisible();
});

test('选中旋转组合后从子节点处整体拖动，图层单选子节点仍按世界方向移动', async ({ page }) => {
  await add(page, '文字');
  await edit(page, { 'X 坐标': '300', 'Y 坐标': '220' });
  await add(page, '矩形');
  await edit(page, { 'X 坐标': '700', 'Y 坐标': '400' });
  await layer(page, 'text-1').click();
  await layer(page, 'rectangle-1').click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: '组合', exact: true }).click();
  await edit(page, { '旋转角度（°）': '45' });
  const first = await screenCorners(page, 'text-1');
  const second = await screenCorners(page, 'rectangle-1');
  const start = await center(page, 'text-1');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 45, start.y + 20);
  await page.mouse.up();
  const firstMoved = await screenCorners(page, 'text-1');
  const secondMoved = await screenCorners(page, 'rectangle-1');
  firstMoved.forEach((point, index) => {
    expect(point.x - (first[index]?.x ?? NaN)).toBeCloseTo(45, 4);
    expect(point.y - (first[index]?.y ?? NaN)).toBeCloseTo(20, 4);
  });
  secondMoved.forEach((point, index) => {
    expect(point.x - (second[index]?.x ?? NaN)).toBeCloseTo(45, 4);
    expect(point.y - (second[index]?.y ?? NaN)).toBeCloseTo(20, 4);
  });
  await layer(page, 'text-1').click();
  const childStart = await center(page, 'text-1');
  await page.mouse.move(childStart.x, childStart.y);
  await page.mouse.down();
  await page.mouse.move(childStart.x + 30, childStart.y - 15);
  await page.mouse.up();
  const childMoved = await screenCorners(page, 'text-1');
  childMoved.forEach((point, index) => {
    expect(point.x - (firstMoved[index]?.x ?? NaN)).toBeCloseTo(30, 4);
    expect(point.y - (firstMoved[index]?.y ?? NaN)).toBeCloseTo(-15, 4);
  });
  sameCorners(await screenCorners(page, 'rectangle-1'), secondMoved);
});

test('窄屏和滚动后画布仍可操作，文字使用 XHTML 换行且不执行标记', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await add(page, '文字');
  await edit(page, {
    文字内容:
      '中文😀\n<script>只是文本</script>\nABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ',
    宽度: '180',
    高度: '220',
  });
  const text = node(page, 'text-1').locator('foreignObject > div');
  await expect(text).toBeVisible();
  expect(await text.evaluate((element) => element.namespaceURI)).toBe(
    'http://www.w3.org/1999/xhtml',
  );
  const lines = await text.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const width = element.getBoundingClientRect().width;
    return {
      width,
      fragments: [...range.getClientRects()]
        .filter((rect) => rect.width > 0)
        .map((rect) => rect.width),
    };
  });
  expect(lines.fragments.length).toBeGreaterThan(3);
  expect(lines.fragments.every((width) => width <= lines.width + 1)).toBe(true);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await node(page, 'text-1').scrollIntoViewIfNeeded();
  const start = await center(page, 'text-1');
  const before = await screenCorners(page, 'text-1');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 10, start.y + 10);
  await page.mouse.up();
  const after = await screenCorners(page, 'text-1');
  after.forEach((point, index) => {
    expect(point.x - (before[index]?.x ?? NaN)).toBeCloseTo(10, 3);
    expect(point.y - (before[index]?.y ?? NaN)).toBeCloseTo(10, 3);
  });
});

test('二维工作区展示完整编辑布局和当前选择', async ({ page }, testInfo) => {
  await add(page, '文字');
  await edit(page, {
    文字内容: '从一张白板开始',
    'X 坐标': '200',
    'Y 坐标': '180',
    宽度: '600',
    高度: '100',
  });
  await add(page, '矩形');
  await edit(page, { 'X 坐标': '200', 'Y 坐标': '380', 宽度: '720', 高度: '340' });
  await add(page, '文字');
  await edit(page, {
    文字内容: '文字、形状与组合\n自由构建你的场景',
    'X 坐标': '1000',
    'Y 坐标': '420',
    宽度: '600',
    高度: '180',
  });
  await expect(page.getByRole('heading', { name: '图层', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '属性', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('canvas-editor.png'), fullPage: true });
});
