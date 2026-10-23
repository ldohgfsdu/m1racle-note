import { test, expect } from '@playwright/test';

test.use({ hasTouch: true });
const raw = '<!-- untouched -->\r\n\r\n- [ ] 事项一：这是一段会在窄屏换行的待办内容，后面文字仍需能够正常选择和编辑。\r\n- [x] 事项二\n  - [ ] 事项三\r\n\r\n1. [ ] 事项四\n\n> - [ ] 事项五\r\n';

for (const config of [
  { host: 'android', width: 393, size: 14, leading: 1.4, minimum: 48 },
  { host: 'android', width: 320, size: 24, leading: 2.2, minimum: 48 },
  { host: 'browser', width: 393, size: 17, leading: 1.8, minimum: 44 },
]) test(`${config.host} task targets fit at ${config.width}px and ${config.size}px font`, async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: config.width, height: 852 });
  if (config.host === 'android') await page.addInitScript(() => { window.Native = { postMessage: () => {} }; });
  await page.goto('http://127.0.0.1:5173');
  await expect(page).toHaveTitle('M1racle Note');
  await expect(page.getByRole('heading', { name: '笔记', exact: true })).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  await page.evaluate(({ raw, config }) => {
    window.M1racle.setPreferences({ size: config.size, leading: config.leading, font: config.size === 24 ? 'serif' : 'sans' });
    window.M1racle.loadDocument({ id: 'tasks', path: 'tasks.md', markdown: raw });
  }, { raw, config });
  const typography = await page.locator('.cm-content').evaluate(element => {
    const style = getComputedStyle(element);
    return { size: parseFloat(style.fontSize), leading: parseFloat(style.lineHeight), font: style.fontFamily };
  });
  expect(typography.size).toBe(config.size);
  expect(typography.leading).toBeCloseTo(config.size * config.leading, 1);
  const expectedFont = await page.locator('html').evaluate((element, serif) => getComputedStyle(element).getPropertyValue(serif ? '--m1-font-reading-serif' : '--m1-font-ui').trim(), config.size === 24);
  expect(typography.font.replaceAll('"', '').replaceAll(' ', '')).toBe(expectedFont.replaceAll('"', '').replaceAll(' ', ''));
  expect(errors).toEqual([]);
  const inputs = page.locator('input.cm-atomic-task-checkbox');
  await expect(inputs).toHaveCount(5);
  expect(await inputs.nth(3).evaluate(element => element.closest('.cm-line')!.textContent)).toMatch(/^1\.事项四$/);
  await page.screenshot({ path: testInfo.outputPath('task-targets.png') });
  const geometry = await inputs.evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(), line = element.closest('.cm-line')!;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let text: Node | null, firstTextX: number | null = null;
    while ((text = walker.nextNode())) {
      const start = text.textContent!.indexOf('事项');
      if (start < 0) continue;
      const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + 1);
      firstTextX = range.getBoundingClientRect().left; break;
    }
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, firstTextX };
  }));
  for (const [index, rect] of geometry.entries()) {
    expect(rect.width).toBeGreaterThanOrEqual(config.minimum);
    expect(rect.height).toBeGreaterThanOrEqual(config.minimum);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(config.width);
    expect(rect.firstTextX).not.toBeNull();
    expect(rect.firstTextX!).toBeGreaterThanOrEqual(rect.x + rect.width - 1);
    for (const other of geometry.slice(index + 1)) {
      expect(rect.x + rect.width <= other.x || other.x + other.width <= rect.x || rect.y + rect.height <= other.y || other.y + other.height <= rect.y).toBe(true);
    }
  }
  const beforeSelection = await page.evaluate(() => window.M1racle.getSelection());
  const first = geometry[0];
  // Hit the corner outside the small visible square, using a touch event.
  await page.touchscreen.tap(first.x + first.width - 3, first.y + first.height - 3);
  await expect.poll(() => page.evaluate(() => window.M1racle.getMarkdown())).toBe(raw.replace('- [ ] 事项一', '- [x] 事项一'));
  expect(await page.evaluate(() => window.M1racle.getSelection())).toEqual(beforeSelection);
  await page.evaluate(() => window.M1racle.undo());
  await expect.poll(() => page.evaluate(() => window.M1racle.getMarkdown())).toBe(raw);
  await page.evaluate(() => window.M1racle.redo());
  await expect.poll(() => page.evaluate(() => window.M1racle.getMarkdown())).toBe(raw.replace('- [ ] 事项一', '- [x] 事项一'));
  await page.evaluate(() => window.M1racle.setReadOnly(true));
  await inputs.first().click();
  expect(await page.evaluate(() => window.M1racle.getMarkdown())).toBe(raw.replace('- [ ] 事项一', '- [x] 事项一'));
  await page.screenshot({ path: testInfo.outputPath('task-targets.png') });
  expect(errors).toEqual([]);
});
