import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/');
});

async function chooseTheme(page: Page, label: '中性浅色' | '深色蓝') {
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '场景主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
}

async function apply(page: Page, values: Readonly<Record<string, string>>) {
  for (const [label, value] of Object.entries(values)) {
    await page.getByRole('textbox', { name: label, exact: true }).fill(value);
  }
  await page.getByRole('button', { name: '应用属性', exact: true }).click();
}

test('两套主题的实际绘制、撤销和预览一致，切换保留选区和未提交草稿', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: '添加文字', exact: true }).click();
  await apply(page, { 文字内容: '主题场景', 'X 坐标': '160', 'Y 坐标': '120' });
  await page.getByRole('button', { name: '添加矩形', exact: true }).click();
  await apply(page, { 'X 坐标': '160', 'Y 坐标': '260' });
  await page.getByRole('button', { name: '添加柱状图', exact: true }).click();
  for (const [index, category, value] of [
    [1, '分类甲', '24'],
    [2, '分类乙', '-12'],
  ] as const) {
    await page.getByRole('button', { name: '添加数据', exact: true }).click();
    await page.getByRole('textbox', { name: `分类 ${index}`, exact: true }).fill(category);
    await page.getByRole('textbox', { name: `数值 ${index}`, exact: true }).fill(value);
  }
  await apply(page, { 'X 坐标': '650', 'Y 坐标': '230', 宽度: '1000', 高度: '650' });
  await page.getByRole('button', { name: '选择文字 text-1', exact: true }).click();
  await page.getByRole('textbox', { name: '文字内容', exact: true }).fill('保留的未应用草稿');
  const canvas = page.getByRole('img', { name: '场景画布', exact: true });
  const background = canvas.locator('[data-scene-background]');
  const transforms = await canvas
    .locator('g[data-node-id]')
    .evaluateAll((nodes) =>
      nodes.map((node) => [node.getAttribute('data-node-id'), node.getAttribute('transform')]),
    );
  const button = page.getByRole('button', { name: '添加文字', exact: true });
  const buttonColor = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
  const chart = canvas.locator('[data-chart-host] svg');
  await expect(background).toHaveAttribute('fill', '#ffffff');
  await expect(chart.getByText('分类甲', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('neutral-light.png'), fullPage: true });

  await chooseTheme(page, '深色蓝');
  await expect(page.getByText('修订 7', { exact: true })).toBeVisible();
  await expect(background).toHaveAttribute('fill', '#0f172a');
  await expect(canvas.locator('[data-node-id="text-1"] foreignObject > div')).toHaveCSS(
    'color',
    'rgb(226, 232, 240)',
  );
  await expect(canvas.locator('[data-node-id="rectangle-1"] > rect')).toHaveAttribute(
    'fill',
    '#1e3a5f',
  );
  await expect(canvas.locator('[data-node-id="rectangle-1"] > rect')).toHaveAttribute(
    'stroke',
    '#60a5fa',
  );
  await expect(chart.locator('[fill="#60a5fa"]')).toHaveCount(2);
  await expect(chart.getByText('分类甲', { exact: true })).toHaveAttribute('fill', '#cbd5e1');
  expect(await chart.locator('[stroke="#94a3b8"]').count()).toBeGreaterThan(0);
  expect(await chart.locator('[stroke="#334155"]').count()).toBeGreaterThan(0);
  expect(
    await canvas
      .locator('g[data-node-id]')
      .evaluateAll((nodes) =>
        nodes.map((node) => [node.getAttribute('data-node-id'), node.getAttribute('transform')]),
      ),
  ).toEqual(transforms);
  await expect(button).toHaveCSS('background-color', buttonColor);
  await expect(page.getByRole('button', { name: '选择文字 text-1', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const draft = page.getByRole('textbox', { name: '文字内容', exact: true });
  await expect(draft).toHaveValue('保留的未应用草稿');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(background).toHaveAttribute('fill', '#ffffff');
  await expect(draft).toHaveValue('保留的未应用草稿');
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(background).toHaveAttribute('fill', '#0f172a');
  await expect(draft).toHaveValue('保留的未应用草稿');
  await chooseTheme(page, '深色蓝');
  await expect(page.getByText('修订 9', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  const preview = page.getByRole('main', { name: '场景预览', exact: true });
  await expect(preview.locator('[data-scene-background]')).toHaveAttribute('fill', '#0f172a');
  await expect(preview.locator('[data-node-id="text-1"] foreignObject > div')).toHaveText(
    '主题场景',
  );
  await expect(preview.locator('[data-chart-host] svg').getByText('分类甲')).toBeVisible();
  await expect(page.locator('[data-chart-host]')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('deep-blue.png'), fullPage: true });
  await page.getByRole('button', { name: '返回编辑', exact: true }).click();
  await expect(background).toHaveAttribute('fill', '#0f172a');
  await expect(draft).toHaveValue('保留的未应用草稿');
  expect(errors).toEqual([]);
});

test('空画布与窄屏可用右键和键盘切换主题，同值不增加历史', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stage = page.getByRole('group', { name: '画布操作', exact: true });
  await stage.focus();
  await page.keyboard.press('Shift+F10');
  await page.getByRole('menuitem', { name: '场景主题', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  const dark = page.getByRole('menuitemradio', { name: '深色蓝', exact: true });
  await dark.focus();
  await page.keyboard.press('Enter');
  const canvas = page.getByRole('img', { name: '场景画布', exact: true });
  await expect(canvas.locator('[data-scene-background]')).toHaveAttribute('fill', '#0f172a');
  await expect(page.getByText('修订 1', { exact: true })).toBeVisible();
  await chooseTheme(page, '深色蓝');
  await expect(page.getByText('修订 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(canvas.locator('[data-scene-background]')).toHaveAttribute('fill', '#ffffff');
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
});
