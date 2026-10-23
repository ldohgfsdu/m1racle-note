// The native Windows renderer runs in Electron; browser-only previews cannot cover its bridge.
import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'note-writing-tools-')),path=join(dir,'写作工具.md');
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-writing-tools-evidence-'));await mkdir(output,{recursive:true});
const raw='\ufeff# 开场\r\n\r\n原样 内容 保留。\n\n## 第一节 **内容**\r\n\r\n这一段继续写。\n\nSetext 标题\n-----------\n\n```markdown\n# 围栏中的假标题\n```\n\n## 收尾\n';
await writeFile(path,raw);const originalMtime=(await stat(path)).mtimeMs;
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),path,'--user-data-dir='+join(dir,'profile')],env});
try {
  const page=await app.firstWindow(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.locator('#filename').filter({hasText:'写作工具.md'}).waitFor();
  await page.evaluate(()=>{window.writingOriginalContent=document.querySelector('.cm-content');});
  const bytes=()=>readFile(path,'utf8'),outline=page.locator('#writing-outline'),palette=page.locator('#writing-commands');
  await page.keyboard.press('Control+Shift+o');await expect(outline).toBeVisible();
  const headings=outline.locator('#writing-outline-list button');await expect(headings).toHaveCount(4);
  assert.deepEqual(await headings.allTextContents(),['开场','第一节 内容','Setext 标题','收尾']);
  await headings.filter({hasText:'Setext 标题'}).click();await expect(headings.filter({hasText:'Setext 标题'})).toHaveAttribute('aria-current','location');
  assert.equal(await bytes(),raw);assert.equal((await stat(path)).mtimeMs,originalMtime);
  await page.keyboard.press('Control+Shift+o');await expect(outline).toBeHidden();
  const appearance=()=>page.evaluate(()=>({width:document.documentElement.dataset.width,font:document.documentElement.dataset.font,size:document.documentElement.style.getPropertyValue('--text-size'),leading:document.documentElement.style.getPropertyValue('--text-leading')}));
  const originalAppearance=await appearance();
  await page.keyboard.press('F8');await expect(page.locator('body')).toHaveAttribute('data-focus','true');
  await expect(page.locator('#format')).toBeHidden();await expect(page.locator('header.titlebar')).toBeVisible();await expect(page.locator('#status')).toBeVisible();await expect(page.locator('#writing-focus-exit')).toBeVisible();
  assert.deepEqual(await appearance(),originalAppearance);
  await page.locator('#writing-focus-exit').click();await expect(page.locator('body')).toHaveAttribute('data-focus','false');await expect(page.locator('#format')).toBeVisible();
  await page.keyboard.press('F8');await page.keyboard.press('F8');await expect(page.locator('body')).toHaveAttribute('data-focus','false');
  assert.equal(await page.evaluate(()=>window.writingOriginalContent===document.querySelector('.cm-content')),true);assert.equal(await bytes(),raw);
  const selectWord=async()=>{
    await page.locator('.cm-line').filter({hasText:'原样 内容 保留。'}).click();await page.keyboard.press('Home');
    for(let i=0;i<3;i++)await page.keyboard.press('ArrowRight');for(let i=0;i<2;i++)await page.keyboard.press('Shift+ArrowRight');
  };
  await selectWord();await page.keyboard.press('Control+Shift+p');await expect(palette).toBeVisible();
  const search=palette.locator('#writing-command-search');await search.fill('粗体');
  await page.keyboard.press('Escape');await expect(palette).toBeHidden();assert.equal(await bytes(),raw);
  // Escape restores CM selection: reopening and applying must affect the same two characters.
  await page.keyboard.press('Control+Shift+p');await search.fill('粗体');await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();await expect.poll(bytes).toBe(raw.replace('原样 内容 保留。','原样 **内容** 保留。'));
  await page.keyboard.press('Control+z');await expect.poll(bytes).toBe(raw);
  await selectWord();await page.keyboard.press('Control+Shift+p');await search.fill('二级');await page.keyboard.press('Enter');
  await expect.poll(bytes).toBe(raw.replace('原样 内容 保留。','## 原样 内容 保留。'));
  await page.keyboard.press('Control+z');await expect.poll(bytes).toBe(raw);
  await selectWord();await page.keyboard.press('Control+Shift+p');await search.fill('列表');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect.poll(bytes).toBe(raw.replace('原样 内容 保留。','1. 原样 内容 保留。'));
  await page.keyboard.press('Control+z');await expect.poll(bytes).toBe(raw);
  // Real key events must reach the same format commands advertised by the palette.
  for(const [shortcut,prefix] of [
    ['Control+Alt+1','# '],['Control+Alt+2','## '],
    ['Control+Shift+7','1. '],['Control+Shift+8','- '],['Control+Shift+9','> '],['Control+Alt+t','- [ ] '],
  ]) {
    await selectWord();await page.keyboard.press(shortcut);
    await expect.poll(bytes,{message:`${shortcut} applies one block format`}).toBe(raw.replace('原样 内容 保留。',prefix+'原样 内容 保留。'));
    await page.keyboard.press('Control+z');await expect.poll(bytes,{message:`one undo restores ${shortcut}`}).toBe(raw);
  }
  await selectWord();await page.keyboard.press('Control+Alt+2');
  const headingRaw=raw.replace('原样 内容 保留。','## 原样 内容 保留。');await expect.poll(bytes).toBe(headingRaw);
  await page.keyboard.press('Control+Alt+0');await expect.poll(bytes).toBe(raw);
  await page.keyboard.press('Control+z');await expect.poll(bytes).toBe(headingRaw);
  await page.keyboard.press('Control+z');await expect.poll(bytes).toBe(raw);
  // Existing CM Markdown continuation remains usable after the new shortcut path.
  await selectWord();await page.keyboard.press('Control+Alt+t');
  const taskRaw=raw.replace('原样 内容 保留。','- [ ] 原样 内容 保留。');await expect.poll(bytes).toBe(taskRaw);
  await page.keyboard.press('End');await page.keyboard.press('Enter');
  // Newly inserted lines use the document's detected CRLF; untouched LF remains unchanged.
  await expect.poll(bytes).toBe(raw.replace('原样 内容 保留。','- [ ] 原样 内容 保留。\r\n- [ ] '));
  await page.keyboard.press('Control+z');await expect.poll(bytes).toBe(taskRaw);
  await page.keyboard.press('Control+z');await expect.poll(bytes).toBe(raw);
  await page.locator('.cm-content').dispatchEvent('keydown',{key:'F8',isComposing:true,bubbles:true});
  await expect(page.locator('body')).toHaveAttribute('data-focus','false');
  await page.locator('.cm-content').dispatchEvent('keydown',{key:'P',ctrlKey:true,shiftKey:true,isComposing:true,bubbles:true});await expect(palette).toBeHidden();
  await page.keyboard.press('Control+Shift+p');await search.fill('这是没有的操作');await expect(palette.locator('#writing-command-list button')).toHaveCount(0);await page.keyboard.press('Escape');
  await page.setViewportSize({width:720,height:600});await page.keyboard.press('Control+Shift+o');await expect(outline).toBeVisible();
  const bounds=await outline.boundingBox(),main=await page.locator('main').boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=720);assert.ok(bounds.y>=main.y && bounds.y+bounds.height<=main.y+main.height);
  const controls=await outline.locator('button:visible').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {width:r.width,height:r.height};}));assert.ok(controls.every(rect=>rect.width>=44 && rect.height>=44));
  await page.screenshot({path:join(output,'outline-720.png')});await page.keyboard.press('Control+Shift+o');
  await page.keyboard.press('Control+Shift+p');await search.fill('标题');await page.screenshot({path:join(output,'commands-720.png')});
  const commandControls=await palette.locator('button:visible,input:visible').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {width:r.width,height:r.height};}));assert.ok(commandControls.every(rect=>rect.width>=44 && rect.height>=44));
  await page.keyboard.press('Escape');await page.locator('#theme').click();await page.keyboard.press('F8');await page.screenshot({path:join(output,'focus-dark-720.png')});await page.keyboard.press('F8');
  assert.equal(await bytes(),raw);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['ATX-and-setext-outline','fenced-heading-ignored','navigation-without-write','focus-exit-and-F8','appearance-and-editor-instance-preserved','search-and-empty-results','keyboard-choice','selection-restored','block-and-inline-dispatch','real-heading-list-quote-task-shortcuts','one-undo-per-shortcut','existing-Enter-task-continuation','undo-BOM-mixed-EOL','synthetic-composition-shortcut-guard','720px-overlay-bounds','44px-controls','dark-theme','console-clean'],output}));
}catch(error){
  const page=await app.firstWindow().catch(()=>null);
  if(page){console.error(await page.locator('#writing-commands').evaluate(dialog=>({open:dialog.open,text:dialog.innerText,active:document.activeElement?.id})).catch(()=>null));await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});}
  throw error;
}finally {
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});
  const root=resolve(tmpdir()),target=resolve(dir);if(target.startsWith(root+'\\') || target.startsWith(root+'/'))await rm(target,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
