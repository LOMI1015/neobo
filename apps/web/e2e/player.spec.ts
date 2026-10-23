import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/');
});

async function apply(page: Page, values: Readonly<Record<string, string>>) {
  for (const [label, value] of Object.entries(values)) {
    await page.getByRole('textbox', { name: label, exact: true }).fill(value);
  }
  await page.getByRole('button', { name: '应用属性', exact: true }).click();
}

test('只读预览使用已提交文档，返回保留草稿、选区和原有历史', async ({ page }) => {
  await page.getByRole('button', { name: '添加文字', exact: true }).click();
  await apply(page, { 文字内容: '已提交的场景文字', 'X 坐标': '300', 'Y 坐标': '200' });
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('尚未应用的草稿');
  await page.getByRole('button', { name: '预览', exact: true }).click();
  const preview = page.getByRole('main', { name: '场景预览', exact: true });
  const canvas = preview.getByRole('img', { name: '场景预览画布', exact: true });
  const textNode = canvas.locator('[data-node-id="text-1"]');
  await expect(textNode.locator('foreignObject > div')).toHaveText('已提交的场景文字');
  await expect(
    preview.locator('.editor-selection, [data-editor-node-id], input, textarea'),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '添加文字', exact: true })).toHaveCount(0);
  const transform = await textNode.getAttribute('transform');
  const box = await textNode.boundingBox();
  if (!box) throw new Error('预览文字未布局。');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 20);
  await page.mouse.up();
  await expect(textNode).toHaveAttribute('transform', transform ?? '');
  await textNode.click({ button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Delete');
  await expect(textNode).toBeVisible();
  await page.getByRole('button', { name: '返回编辑', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('button', { name: '画布编辑', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: '文字内容', exact: true })).toHaveValue(
    '尚未应用的草稿',
  );
  await expect(page.getByRole('button', { name: '选择文字 text-1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('修订 2', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文字内容', exact: true })).toHaveValue('文字');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文字内容', exact: true })).toHaveValue(
    '已提交的场景文字',
  );
});

test('图表预览反复进入返回和窄屏适配正常，拖动中不能进入预览', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '添加柱状图', exact: true }).click();
  for (const [index, category, value] of [
    [1, '分类甲', '24'],
    [2, '分类乙', '-12'],
  ] as const) {
    await page.getByRole('button', { name: '添加数据', exact: true }).click();
    await page.getByRole('textbox', { name: `分类 ${index}`, exact: true }).fill(category);
    await page.getByRole('textbox', { name: `数值 ${index}`, exact: true }).fill(value);
  }
  await apply(page, { 'X 坐标': '300', 'Y 坐标': '200', 宽度: '1100', 高度: '650' });
  const editorChart = page
    .getByRole('img', { name: '场景画布', exact: true })
    .locator('[data-node-id="bar-chart-1"]');
  const original = await editorChart.getAttribute('transform');
  const frame = editorChart.locator('[data-chart-frame]');
  const box = await frame.boundingBox();
  if (!box) throw new Error('图表命中框未布局。');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 20);
  await expect(page.getByRole('button', { name: '预览', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(editorChart).toHaveAttribute('transform', original ?? '');
  for (let iteration = 0; iteration < 3; iteration += 1) {
    if (iteration === 1) await page.setViewportSize({ width: 960, height: 540 });
    if (iteration === 2) await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '预览', exact: true }).click();
    const preview = page.getByRole('main', { name: '场景预览', exact: true });
    const drawing = preview.locator('[data-chart-host] svg');
    await expect(drawing.getByText('分类甲', { exact: true })).toBeVisible();
    await expect(drawing.getByText('分类乙', { exact: true })).toBeVisible();
    await expect(page.locator('[data-chart-host]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '返回编辑', exact: true })).toBeFocused();
    const viewport = page.viewportSize();
    const canvas = preview.getByRole('img', { name: '场景预览画布', exact: true });
    const canvasBox = await canvas.boundingBox();
    if (!viewport || !canvasBox) throw new Error('播放器缺少视口尺寸。');
    expect(canvasBox.x).toBeGreaterThanOrEqual(0);
    expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(canvasBox.y + canvasBox.height).toBeLessThanOrEqual(viewport.height + 1);
    if (iteration === 0) {
      await page.screenshot({ path: testInfo.outputPath('readonly-player.png'), fullPage: true });
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
    await page.getByRole('button', { name: '返回编辑', exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect(
      editorChart.locator('[data-chart-host] svg').getByText('分类甲', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-chart-host]')).toHaveCount(1);
    await expect(page.getByText('修订 2', { exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
