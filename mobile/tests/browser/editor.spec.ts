import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
test('actual editor preserves corpus through mount, typing, undo and redo', async ({ page }) => {
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 await page.goto('http://127.0.0.1:5173');
 await page.waitForFunction(() => Boolean((window as any).M1racle));
 const baseline: object[] = [];
 for (const file of readdirSync('editor-corpus').filter(f => f.endsWith('.md'))) {
  const raw = readFileSync(`editor-corpus/${file}`, 'utf8');
  const load = await page.evaluate(({raw,file}) => {
   const start = performance.now();
   (window as any).M1racle.loadDocument({ id:file, path:file, markdown:raw });
   return performance.now()-start;
  }, { raw, file });
  await expect(page.locator('.cm-content')).toBeVisible();
  expect(await page.evaluate(() => (window as any).M1racle.getMarkdown()),file).toBe(raw);
  await page.evaluate(() => (window as any).M1racle.focus());
  await page.keyboard.press('Control+Home');
  const inputStart = Date.now();
  await page.keyboard.insertText('测🌱');
  await expect.poll(() => page.evaluate(() => (window as any).M1racle.getMarkdown())).toBe('测🌱'+raw);
  const inputMs = Date.now()-inputStart;
  await page.evaluate(() => (window as any).M1racle.undo());
  await expect.poll(() => page.evaluate(() => (window as any).M1racle.getMarkdown())).toBe(raw);
  await page.evaluate(() => (window as any).M1racle.redo());
  await expect.poll(() => page.evaluate(() => (window as any).M1racle.getMarkdown())).toBe('测🌱'+raw);
  baseline.push({file, chars:raw.length, loadMs:load, automationInputMs:inputMs});
 }
 expect(errors).toEqual([]);
 const output = process.env.NOTE_QA_OUTPUT || 'test-results/mobile';
 mkdirSync(output, { recursive:true });
 writeFileSync(`${output}/browser-baseline.json`, JSON.stringify({ environment:'Playwright Chromium desktop; not Android IME or latency proof', date:new Date().toISOString(), baseline }, null, 2));
});
test('deleting mixed line endings and grouped typing undo restores exact source', async ({page}) => {
 await page.goto('http://127.0.0.1:5173');
 await page.waitForFunction(() => Boolean((window as any).M1racle));
 const raw = 'first\r\nsecond\nthird\rlast';
 await page.evaluate(raw => (window as any).M1racle.loadDocument({id:'mixed', markdown:raw, path:'mixed.md'}),raw);
 await page.evaluate(() => (window as any).M1racle.focus());
 await page.keyboard.press('Control+Home');
 await page.keyboard.press('End'); await page.keyboard.press('Delete');
 await expect.poll(() => page.evaluate(() => (window as any).M1racle.getMarkdown())).toBe('firstsecond\nthird\rlast');
 await page.evaluate(() => (window as any).M1racle.undo());
 expect(await page.evaluate(() => (window as any).M1racle.getMarkdown())).toBe(raw);
 await page.keyboard.press('Control+Home'); await page.keyboard.type('abc');
 await page.evaluate(() => (window as any).M1racle.undo());
 expect(await page.evaluate(() => (window as any).M1racle.getMarkdown())).toBe(raw);
});
test('task toggling, search and read-only preserve source boundaries', async ({page}) => {
 await page.goto('http://127.0.0.1:5173');
 await page.waitForFunction(() => Boolean((window as any).M1racle));
 const raw='- [ ] Task\n\nA **bold** and [link](https://example.com).\n';
 await page.evaluate(raw => (window as any).M1racle.loadDocument({id:'tasks',markdown:raw,path:'task.md'}),raw);
 await page.locator('input.cm-atomic-task-checkbox').check();
 await expect.poll(()=>page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw.replace('[ ]','[x]'));
 await page.evaluate(()=>(window as any).M1racle.undo());
 expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw);
 await page.evaluate(()=>(window as any).M1racle.setReadOnly(true));
 await page.locator('input.cm-atomic-task-checkbox').click();
 expect(await page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe(raw);
 await page.evaluate(()=>(window as any).M1racle.find('bold'));
 await expect(page.locator('.cm-search input[name=search]')).toHaveValue('bold');
});
test('synthetic composition commits Chinese text without duplicating preedit', async ({page,context}) => {
 await page.goto('http://127.0.0.1:5173');
 await page.waitForFunction(() => Boolean((window as any).M1racle));
 await page.evaluate(()=>{(window as any).M1racle.loadDocument({id:'ime',markdown:'原文\n',path:'ime.md'});(window as any).M1racle.focus();});
 await page.keyboard.press('Control+Home');
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:'nihao',selectionStart:5,selectionEnd:5});
 await cdp.send('Input.insertText',{text:'你好'});
 await expect.poll(()=>page.evaluate(()=>(window as any).M1racle.getMarkdown())).toBe('你好原文\n');
});
test('native bridge surface has a visible bounded viewport', async ({page})=>{
 await page.setViewportSize({width:393,height:852});
 await page.addInitScript(()=>{(window as any).Native={postMessage:()=>{}};});
 await page.goto('http://127.0.0.1:5173');
 await page.waitForFunction(()=>Boolean((window as any).M1racle));
 await expect(page.getByRole('heading',{name:'笔记',exact:true})).toBeVisible();
 expect(await page.getByRole('button',{name:'新建笔记',exact:true}).evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
 await page.evaluate(()=>{document.documentElement.style.height='0px';document.body.style.height='0px';});
 await page.evaluate(()=>(window as any).M1racle.loadDocument({id:'native',markdown:'# Native\n\nText',path:'native.md'}));
 expect(await page.locator('.cm-scroller').evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThan(100);
 await page.evaluate(()=>(window as any).M1racle.find('Text'));
 const searchTargets = await page.locator('.cm-search label, .cm-search button').evaluateAll(elements=>elements.map(e=>{
  const {x,y,width,height}=e.getBoundingClientRect(); return {x,y,width,height,close:e.getAttribute('name')==='close'};
 }));
 const close = searchTargets.find(target=>target.close)!;
 for(const target of searchTargets){
  expect(target.height).toBeGreaterThanOrEqual(48);
  expect(target.width).toBeGreaterThanOrEqual(48);
  expect(target.x).toBeGreaterThanOrEqual(0);
  expect(target.x+target.width).toBeLessThanOrEqual(393);
  if(!target.close) expect(target.x+target.width<=close.x || target.x>=close.x+close.width || target.y+target.height<=close.y || target.y>=close.y+close.height).toBe(true);
 }
});
test('selection bridge reports offsets in original CRLF source',async({page})=>{
 await page.goto('http://127.0.0.1:5173');
 await page.waitForFunction(()=>Boolean((window as any).M1racle));
 await page.evaluate(()=>{(window as any).M1racle.loadDocument({id:'crlf-selection',markdown:'a\r\nb',path:'sample.md'});(window as any).M1racle.focus();});
 await page.keyboard.press('Control+End');
 expect(await page.evaluate(()=>(window as any).M1racle.getSelection())).toEqual([{from:4,to:4}]);
});
