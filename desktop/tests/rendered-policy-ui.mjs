import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'note-render-policy-')),path=join(dir,'持续排版.md'),output=join(tmpdir(),'m1racle-note-render-policy');
const raw='\ufeff# 标题\r\n\r\n文档 Windows 正文。\n\n**粗体** 和 *斜体* 及 ~~删除 测试 留下~~。\r\n\r\n`alpha beta gamma`\n\n[链接](https://example.com)\n\n- [ ] 待办\n\n```javascript\nconst n = 1;\n```\n';
await writeFile(path,raw);await mkdir(output,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),path,'--user-data-dir='+join(dir,'profile')],env});
try {
  const page=await app.firstWindow(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.locator('#filename').filter({hasText:'持续排版.md'}).waitFor();
  await page.evaluate(()=>{
    window.sourceLeaks=[];
    function sample(){
      if(document.body.dataset.mode==='rendered') {
        const text=document.querySelector('.cm-content').innerText;
        if(/# 标题|\*|~~|```|https:\/\/example.com|\[链接\]|\[ \]/.test(text))window.sourceLeaks.push(text);
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  const bytes=()=>readFile(path,'utf8');
  const originalMtime=(await stat(path)).mtimeMs;
  const line=page.locator('.cm-line').filter({hasText:'文档 Windows 正文。'});
  await line.click();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  for(let i=0;i<9;i++)await page.keyboard.press('Shift+ArrowRight');
  await page.locator('[data-format=italic]').hover();await page.locator('.style-preview-italic').waitFor();
  assert.equal(await page.locator('.style-preview-italic').innerText(),'Windows');
  assert.equal(await bytes(),raw);assert.equal(await page.locator('#status').innerText(),'已保存');
  assert.match(await page.locator('#mode-hint').innerText(),/预览斜体/);
  await page.screenshot({path:join(output,'hover-preview.png')});
  await page.locator('footer').hover();assert.equal(await page.locator('.style-preview-italic').count(),0);
  for(const type of ['bold','italic','strike','inlinecode']) {
    if(['strike','inlinecode'].includes(type))await page.locator('#format-more summary').click();
    await page.locator(`[data-format=${type}]`).hover();await page.locator(`.style-preview-${type}`).waitFor();
    assert.equal(await bytes(),raw);await page.locator('footer').hover();assert.equal(await page.locator('[data-previewing]').count(),0);
    if(['strike','inlinecode'].includes(type))await page.keyboard.press('Escape');
  }
  assert.equal((await stat(path)).mtimeMs,originalMtime);
  await page.locator('[data-format=italic]').hover();
  await page.keyboard.press('Escape');assert.equal(await page.locator('.style-preview-italic').count(),0);assert.equal(await bytes(),raw);
  await page.locator('footer').hover();await page.locator('[data-format=italic]').hover();await page.locator('[data-format=italic]').click();
  const italic=raw.replace('文档 Windows 正文。','文档 *Windows* 正文。');await expect.poll(bytes).toBe(italic);
  assert.equal(await page.locator('.cm-atomic-em').filter({hasText:'Windows'}).innerText(),'Windows');
  await page.keyboard.insertText('Windows 11');const edited=italic.replace('*Windows*','*Windows 11*');await expect.poll(bytes).toBe(edited);
  await page.locator('#undo').click();await expect.poll(bytes).toBe(italic);await page.locator('#undo').click();await expect.poll(bytes).toBe(raw);
  await page.locator('#redo').click();await expect.poll(bytes).toBe(italic);await page.locator('#redo').click();await expect.poll(bytes).toBe(edited);
  await page.locator('.cm-atomic-strong').filter({hasText:'粗体'}).dblclick();
  await page.locator('[data-format=bold]').hover();await page.locator('.style-preview-bold-off').waitFor();assert.equal(await bytes(),edited);
  await page.locator('[data-format=bold]').click();await expect.poll(bytes).toBe(edited.replace('**粗体**','粗体'));
  await page.locator('#undo').click();await expect.poll(bytes).toBe(edited);
  await page.locator('.cm-atomic-strike').filter({hasText:'删除'}).dblclick();
  await page.locator('#format-more summary').click();await page.locator('[data-format=strike]').hover();
  await page.locator('.style-preview-strike-off').waitFor();
  assert.equal(await page.locator('.cm-atomic-strike').evaluate(el=>getComputedStyle(el).textDecorationLine),'none');
  assert.match((await page.locator('.style-preview-strike-keep').allTextContents()).join(''),/留下/);
  assert.equal(await page.locator('.style-preview-strike-keep').first().evaluate(el=>getComputedStyle(el).textDecorationLine),'line-through');
  await page.locator('footer').hover();await page.keyboard.press('Escape');assert.equal(await bytes(),edited);
  await page.locator('.cm-atomic-inline-code').dblclick({position:{x:12,y:10}});
  await page.locator('#format-more summary').click();await page.locator('[data-format=inlinecode]').hover();
  await page.locator('.style-preview-inlinecode-off').waitFor();
  assert.match((await page.locator('.style-preview-inlinecode-keep').allTextContents()).join(''),/beta gamma/);
  assert.equal(await page.locator('.cm-atomic-inline-code').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  await page.locator('footer').hover();await page.keyboard.press('Escape');assert.equal(await bytes(),edited);
  // Drag selection with the real pointer, then cancel without touching content.
  const box=await page.locator('.cm-atomic-em').filter({hasText:'Windows 11'}).boundingBox();
  await page.mouse.move(box.x+2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width-2,box.y+box.height/2,{steps:12});await page.mouse.up();
  await page.locator('[data-format=bold]').hover();await page.locator('.style-preview-bold').waitFor();
  await page.keyboard.press('Escape');assert.equal(await page.locator('[data-previewing]').count(),0);assert.equal(await bytes(),edited);
  await page.locator('.cm-atomic-link').filter({hasText:'链接'}).dblclick({position:{x:5,y:10}});
  assert.equal((await page.locator('.cm-content').innerText()).includes('https://example.com'),false);
  await page.locator('.cm-line').filter({hasText:'const n = 1;'}).click();await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
  assert.equal((await page.locator('.cm-content').innerText()).includes('```'),false);
  await page.locator('#theme').click();await page.screenshot({path:join(output,'rendered-no-reveal.png')});
  await page.locator('#code').click();assert.match(await page.locator('.cm-content').innerText(),/\*Windows 11\*/);
  await page.locator('#read').click();await expect.poll(()=>page.locator('.cm-content').innerText()).not.toMatch(/\*Windows 11\*/);
  assert.deepEqual(await page.evaluate(()=>window.sourceLeaks),[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['no-source-on-focus-selection-or-style','trimmed-format-range','hover-does-not-write','escape-cancels-preview','commit-matches-preview','typing-inside-format','isolated-undo-redo','preview-removal','link-destination-hidden','fence-hidden-while-editing','explicit-source-mode-only','no-leak-frames','console-clean'],output}));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
