import {_electron as electron} from '@playwright/test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'note-surface-')),path=join(dir,'长文档.md');
await writeFile(path,Array.from({length:120},(_,i)=>`## 第 ${i+1} 节\n\n段落 ${i+1}，切换后仍在这里。\n\n`).join(''));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),path,'--user-data-dir='+join(dir,'profile')],env,timeout:30000});
try {
  const page=await app.firstWindow();await page.locator('#filename').filter({hasText:'长文档.md'}).waitFor();
  await page.locator('.cm-content').click();await page.keyboard.press('Control+Home');
  for(let i=0;i<158;i++)await page.keyboard.press('ArrowDown');
  const target=page.locator('.cm-line').filter({hasText:'段落 40，'});await target.waitFor();await target.click();
  await page.keyboard.press('Home');const y=await target.evaluate(e=>e.getBoundingClientRect().top);
  for(let i=0;i<4;i++) {
    await page.locator('#code').click();await page.waitForTimeout(250);
    assert.ok(Math.abs(await target.evaluate(e=>e.getBoundingClientRect().top)-y)<4);
    await page.locator('#read').click();await page.waitForTimeout(250);
    assert.ok(Math.abs(await target.evaluate(e=>e.getBoundingClientRect().top)-y)<4);
  }
  await page.keyboard.press('End');await page.keyboard.press('Shift+Home');
  await page.locator('#code').click();await page.waitForTimeout(250);await page.keyboard.insertText('替换当前选区');
  await page.waitForTimeout(900);assert.match(await page.locator('.cm-content').innerText(),/替换当前选区/);
  await page.locator('#undo').click();await page.waitForTimeout(200);assert.match(await page.locator('.cm-content').innerText(),/段落 40，切换后仍在这里。/);
  console.log(JSON.stringify({passed:true,checks:['long-document-same-line','screen-position','four-round-trips-no-drift','selection-across-modes','undo-after-selection-edit']}));
}finally{await app.evaluate(({app})=>app.exit(0));await app.close().catch(()=>{});await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
