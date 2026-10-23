import './hidden-launch.mjs';
import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

// Actual renderer + IPC; inspect the options supplied to Electron's native
// dialog without opening a Windows picker or writing outside synthetic files.
const dir=await mkdtemp(join(tmpdir(),'note-save-name-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-save-name-evidence-'));
await mkdir(output,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const checks=[],errors=[],nativeSamples=[];
let app,page;
const stage=name=>console.log('STAGE '+name);
try {
  stage('launch');
  app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),'--user-data-dir='+join(dir,'profile')],env,timeout:30000});
  page=await app.firstWindow();page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',event=>{if(event.type()==='error')errors.push(event.text());});
  await expect(page).toHaveTitle('M1racle Note');
  assert.match(page.url(),/\/desktop\/dist\/index\.html$/);
  await expect(page.locator('.cm-content')).toContainText('留一点空间');
  assert.equal(await page.locator('vite-error-overlay').count(),0);
  await app.evaluate(()=>globalThis.installDialogs({
    showSaveDialog:async(_window,options)=>{
      globalThis.noteSaveNameCalls.push(options);
      return globalThis.noteSaveNameResult || {canceled:true};
    },
    showMessageBox:async()=>({response:2}),
  }));
  await app.evaluate(()=>{globalThis.noteSaveNameCalls=[];});
  const sample=async label=>{
    const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(win=>({visible:win.isVisible(),focused:win.isFocused(),bounds:win.getBounds()})));
    assert.ok(windows.length);assert.ok(windows.every(win=>!win.visible && !win.focused));
    nativeSamples.push({label,windows});
  };
  const raw=()=>page.locator('.cm-content').evaluate(el=>el.cmTile.root.view.state.doc.toString());
  const lastDefault=()=>app.evaluate(()=>globalThis.noteSaveNameCalls.at(-1)?.defaultPath);
  const save=async expected=>{
    const before=await app.evaluate(()=>globalThis.noteSaveNameCalls.length);
    await page.locator('#save').click();
    await expect.poll(()=>app.evaluate(()=>globalThis.noteSaveNameCalls.length)).toBe(before+1);
    await expect(page.locator('#status')).not.toHaveText('正在保存…');
    assert.equal(await lastDefault(),expected);
    await sample(expected);
  };
  const newText=async value=>{
    await page.locator('#app-menu summary').click();
    await page.locator('#app-menu .menu-items #new').click();
    await expect(page.locator('#filename')).toHaveText('未命名.md');
    await expect.poll(raw).toBe('');
    await page.keyboard.insertText(value);
    await expect.poll(raw).toBe(value);
  };

  await sample('startup');
  stage('heading-default');
  const titleRaw='# 我的第一篇笔记\n\n正文保持原样。\n';
  await newText(titleRaw);await save('我的第一篇笔记.md');
  assert.equal(await raw(),titleRaw);
  assert.deepEqual((await readdir(dir)).filter(name=>name.endsWith('.md')),[]);
  checks.push('first-save-uses-heading-cancel-keeps-raw-and-writes-no-file');

  stage('manual-name');
  await page.locator('#filename').click();await page.locator('#filename-input').fill('我指定的名字');
  await page.keyboard.press('Enter');await save('我指定的名字.md');
  checks.push('manual-name-overrides-body-title');

  stage('title-edit-and-save-as');
  await newText('## 初稿\n\n内容');await save('初稿.md');
  await page.locator('#code').click();
  await expect(page.locator('#code')).toHaveAttribute('aria-pressed','true');
  await page.locator('.cm-content').click();await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+End');await page.keyboard.insertText('## 最终标题\n\n内容');
  const beforeAs=await app.evaluate(()=>globalThis.noteSaveNameCalls.length);
  await page.locator('#app-menu summary').click();await page.locator('#save-as').click();
  await expect.poll(()=>app.evaluate(()=>globalThis.noteSaveNameCalls.length)).toBe(beforeAs+1);
  assert.equal(await lastDefault(),'最终标题.md');
  checks.push('cancel-does-not-cache-title-and-save-as-on-new-note-uses-current-title');

  stage('fallbacks');
  await newText('# CON .md');await save('_CON.md');
  checks.push('reserved-device-title-with-spaces-and-extension-is-safe');
  await newText('没有标题的第一行\n第二行');await save('没有标题的第一行.md');
  await newText('');await save('未命名.md');
  checks.push('plain-first-line-and-empty-document-fallback');

  stage('write-and-existing-path');
  const destination=join(dir,'我的第一篇笔记.md');
  await newText(titleRaw);
  await app.evaluate((_electron,filePath)=>{globalThis.noteSaveNameResult={canceled:false,filePath};},destination);
  await save('我的第一篇笔记.md');await expect(page.locator('#filename')).toHaveText('我的第一篇笔记.md');
  assert.deepEqual(await readFile(destination),Buffer.from(titleRaw));
  await app.evaluate(()=>{globalThis.noteSaveNameResult=null;});
  await page.locator('#code').click();await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');await page.keyboard.press('Control+Shift+End');
  const changed='# 新的正文标题\n\n文件名保持不变。\n';await page.keyboard.insertText(changed);
  await expect.poll(()=>readFile(destination,'utf8')).toBe(changed);
  await page.locator('#app-menu summary').click();await page.locator('#save-as').click();
  await expect.poll(lastDefault).toBe(destination);
  assert.deepEqual(await readFile(destination),Buffer.from(changed));
  checks.push('first-save-writes-exact-bytes-and-later-save-as-keeps-existing-path');
  await sample('complete');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks,errors,nativeSamples,visual:'UNVERIFIED: native dialog was controlled; no foreground picker opened',output}));
  await writeFile(join(output,'save-name.json'),JSON.stringify({passed:true,checks,errors,nativeSamples},null,2));
} catch(error) {
  await writeFile(join(output,'save-name-failure.json'),JSON.stringify({passed:false,checks,errors,nativeSamples,error:String(error?.stack||error),defaultPath:app?await app.evaluate(()=>globalThis.noteSaveNameCalls?.at(-1)?.defaultPath).catch(()=>null):null},null,2));
  throw error;
} finally {
  if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
  await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
