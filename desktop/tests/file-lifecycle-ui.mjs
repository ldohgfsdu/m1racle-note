import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,stat,unlink,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {captureHidden} from './evidence-capture.mjs';

// Actual renderer, IPC, file writes and window close. Dialog choices are supplied
// by the harness; this does not verify the Windows file-picker UI itself.
const dir=await mkdtemp(join(tmpdir(),'note-file-lifecycle-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-file-evidence-'));await mkdir(output,{recursive:true});
const a=join(dir,'原文.md'),b=join(dir,'第二篇.md'),invalid=join(dir,'invalid.md'),copy=join(dir,'冲突副本.md'),draft=join(dir,'新笔记.md'),closing=join(dir,'退出保存.md'),renamed=join(dir,'换名保存.md');
const raw='\ufeff# 原文\r\n\r\n保留混合换行。\n尾部\r',other='# 第二篇\n\n这里不变。\n';
await writeFile(a,raw);await writeFile(b,other);await writeFile(invalid,Buffer.from([255,254,65,0]));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY || resolve('desktop/main.mjs'),checks=[],errors=[],timings={runStartedAt:new Date().toISOString()};
let app,page,ended=false;
const text=()=>page.locator('.cm-content').evaluate(element=>element.cmTile.root.view.state.doc.toString());
const choose=async(type,value)=>app.evaluate((_electron,{type,value})=>globalThis.noteQaDialogs[type].push(value),{type,value});
const count=type=>app.evaluate((_electron,type)=>globalThis.noteQaDialogs.calls.filter(call=>call.type===type).length,type);
const action=async type=>{
 if(await page.locator('#app-menu #'+type).count() && !await page.locator('#app-menu').evaluate(element=>element.open))await page.locator('#app-menu summary').click();
 await page.locator('#'+type).click();
};
const insert=async value=>{await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(value);};
try {
 app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[entry,a,'--user-data-dir='+join(dir,'profile')],env});
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));page.on('console',event=>{if(event.type()==='error')errors.push(event.text());});
 await page.locator('#filename').filter({hasText:'原文.md'}).waitFor();assert.equal(await page.title(),'M1racle Note');
 await app.evaluate(({dialog})=>{
  globalThis.noteQaDialogs={open:[],save:[],confirm:[],calls:[]};
  for(const [method,type,fallback] of [['showOpenDialog','open',{canceled:true,filePaths:[]}],['showSaveDialog','save',{canceled:true}],['showMessageBox','confirm',{response:1}]]) {
   dialog[method]=async(...args)=>{const result=globalThis.noteQaDialogs[type].shift() || fallback;globalThis.noteQaDialogs.calls.push({type,result,options:args.at(-1)});return result;};
  }
 });
 const initial=(await stat(a)).mtimeMs;await action('save');await expect(page.locator('#status')).toHaveText('已保存');
 assert.equal((await stat(a)).mtimeMs,initial);assert.equal(await readFile(a,'utf8'),raw);checks.push('no-edit-save-keeps-bytes-and-mtime');
 const beforeCancelOpen=await count('open');await choose('open',{canceled:true,filePaths:[]});await action('open');await expect.poll(()=>count('open')).toBe(beforeCancelOpen+1);await expect(page.locator('#filename')).toHaveText('原文.md');
 assert.equal(await text(),raw.slice(1).replace(/\r\n|\r/g,'\n'));checks.push('cancel-open-retains-document');
 await choose('open',{canceled:false,filePaths:[invalid]});await action('open');await expect(page.locator('#error')).toBeVisible();await expect(page.locator('#filename')).toHaveText('原文.md');
 assert.equal(await readFile(a,'utf8'),raw);await page.locator('#dismiss-error').click();checks.push('invalid-encoding-retains-current-document');
 await unlink(a);await insert('继续写');await expect(page.locator('#retry-save')).toBeVisible({timeout:10000});assert.match(await text(),/继续写$/);
 await writeFile(a,raw);
 const retryStart=Date.now(),expectedRetry=Buffer.from(raw+'继续写','utf8');
 const readRetry=async()=>readFile(a);
 let retryMs=null;
 await page.locator('#retry-save').click();
 try {
  await expect.poll(async()=>{const disk=await readRetry();if(retryMs===null && disk.equals(expectedRetry))retryMs=Date.now()-retryStart;return disk.equals(expectedRetry);},{timeout:5000}).toBe(true);
 } catch(error) {
  const dumpTarget=await readRetry().catch(()=>null);
  await writeFile(join(output,'file-lifecycle-retry-diagnostics.json'),JSON.stringify({
   step:'missing-file-failure-and-retry-keeps-edits',
   elapsedSinceClickMs:Date.now()-retryStart,
   pollTimeoutMs:5000,
   status:await page.locator('#status').textContent().catch(()=>null),
   errorVisible:await page.locator('#error').isVisible().catch(()=>null),
   errorText:await page.locator('#error-message').textContent().catch(()=>null),
   retryButtonVisible:await page.locator('#retry-save').isVisible().catch(()=>null),
   diskMatchesRestoredOriginal:dumpTarget?dumpTarget.equals(Buffer.from(raw,'utf8')):null,
   diskTailHex:dumpTarget?dumpTarget.subarray(-24).toString('hex'):null,
   expectedTailHex:expectedRetry.subarray(-24).toString('hex'),
  },null,2));
  throw error;
 }
 timings.retrySaveStabilizedMs=retryMs;
 await expect(page.locator('#error')).toBeHidden();checks.push('missing-file-failure-and-retry-keeps-edits');
 await writeFile(a,'外部版本\n');await insert('我的修改');await expect(page.locator('#error-save-as')).toBeVisible({timeout:10000});
 await choose('save',{canceled:false,filePath:copy});await page.locator('#error-save-as').click();await expect(page.locator('#filename')).toHaveText('冲突副本.md');
 assert.equal(await readFile(a,'utf8'),'外部版本\n');assert.equal(await readFile(copy,'utf8'),raw+'继续写我的修改');checks.push('external-conflict-copy-retains-BOM-and-mixed-EOL');
 await action('new');await expect(page.locator('#filename')).toHaveText('未命名.md');await page.keyboard.insertText('# 新笔记\n\n未命名也能继续写。');
 const nameInput=page.locator('#filename-input');
 await page.locator('#filename').click();await nameInput.fill('取消的名字');await page.keyboard.press('Escape');await expect(page.locator('#filename')).toHaveText('未命名.md ·');
 await page.locator('#filename').click();await nameInput.fill('坏/名字');await page.keyboard.press('Enter');await expect(page.locator('#error-message')).toContainText('不能包含');assert.equal(await page.locator('#filename').textContent(),'未命名.md ·');await page.locator('#dismiss-error').click();
 await page.locator('#filename').click();await nameInput.fill('我的新笔记');await page.keyboard.press('Enter');await expect(page.locator('#filename')).toHaveText('我的新笔记 ·');
 assert.ok(!(await readdir(dir)).includes('我的新笔记.md'));
 const beforeNamedSave=await count('save');await choose('save',{canceled:true});await action('save');await expect.poll(()=>count('save')).toBe(beforeNamedSave+1);
 assert.equal((await app.evaluate(()=>globalThis.noteQaDialogs.calls)).filter(call=>call.type==='save').at(-1).options.defaultPath,'我的新笔记.md');
 checks.push('rename-shows-immediately-esc-cancels-and-invalid-name-rejected');
 checks.push('first-save-dialog-defaults-to-display-name-and-writes-nothing');
 const draftText=await text(),beforeCancelLeave=await count('confirm');await choose('open',{canceled:false,filePaths:[b]});await choose('confirm',{response:1});await action('open');await expect.poll(()=>count('confirm')).toBe(beforeCancelLeave+1);assert.equal(await text(),draftText);checks.push('cancel-leave-keeps-unsaved-draft');
 const beforeCancelSave=await count('save');await choose('save',{canceled:true});await action('save');await expect.poll(()=>count('save')).toBe(beforeCancelSave+1);await expect(page.locator('#status')).toContainText('未保存');assert.equal(await text(),draftText);checks.push('cancel-first-save-keeps-draft');
 const beforeCancelClose=await count('confirm');await choose('confirm',{response:1});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await expect.poll(()=>count('confirm')).toBe(beforeCancelClose+1);
 await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(1);assert.equal(await text(),draftText);checks.push('cancel-native-window-close-keeps-draft');
 await choose('confirm',{response:0});await choose('save',{canceled:false,filePath:draft});await choose('open',{canceled:false,filePaths:[b]});await action('open');
 await expect(page.locator('#filename')).toHaveText('第二篇.md');assert.equal(await readFile(draft,'utf8'),draftText);assert.equal(await readFile(b,'utf8'),other);checks.push('save-before-switch-writes-correct-file');
 await page.locator('#filename').click();await page.locator('#filename-input').fill('第二篇的别名');await page.keyboard.press('Enter');
 assert.equal(await page.locator('#filename').textContent(),'第二篇的别名');assert.match(await page.locator('#filename').getAttribute('title'),/第二篇\.md/);
 assert.equal(await readFile(b,'utf8'),other);checks.push('rename-saved-document-changes-display-only-and-keeps-disk-file');
 const beforeAliasSaveAs=await count('save');await choose('save',{canceled:false,filePath:renamed});await action('save-as');await expect(page.locator('#status')).toHaveText('已保存');
 assert.equal((await app.evaluate(()=>globalThis.noteQaDialogs.calls)).filter(call=>call.type==='save').at(-1).options.defaultPath,b);
 assert.equal(await page.locator('#filename').textContent(),'第二篇的别名');assert.match(await page.locator('#filename').getAttribute('title'),/换名保存\.md/);
 assert.equal(await readFile(renamed,'utf8'),other);checks.push('saved-document-alias-persists-after-saving-with-another-name');
 const beforeDiscard=await count('confirm');await choose('confirm',{response:2});
 // Start replacement in the same turn as the edit, before its 550ms autosave.
 // Otherwise hidden-runner round trips can save first and leave a stale stub.
 await page.evaluate(()=>{const view=document.querySelector('.cm-content').cmTile.root.view;view.dispatch({changes:{from:view.state.doc.length,insert:'放弃这次'}});document.getElementById('new').click();});
 await expect.poll(()=>count('confirm')).toBe(beforeDiscard+1);await expect(page.locator('#filename')).toHaveText('未命名.md');
 assert.equal(await readFile(b,'utf8'),other);assert.equal(await readFile(renamed,'utf8'),other);await page.waitForTimeout(750);assert.equal(await text(),'');checks.push('discard-does-not-leak-autosave-into-new-document');
 await page.keyboard.insertText('退出前保存。');const closeText=await text();
 assert.deepEqual(await app.evaluate(()=>Object.fromEntries(['open','save','confirm'].map(type=>[type,globalThis.noteQaDialogs[type].length]))),{open:0,save:0,confirm:0});
 await captureHidden(app,page,join(output,'desktop-unsaved-draft.png'));
 await choose('confirm',{response:0});await choose('save',{canceled:false,filePath:closing});
 const closed=app.waitForEvent('close',{timeout:15000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;ended=true;
 assert.equal(await readFile(closing,'utf8'),closeText);checks.push('native-window-close-saves-draft-before-exit');
 assert.deepEqual(errors,[]);assert.deepEqual((await readdir(dir)).filter(name=>name.endsWith('.tmp')),[]);
 const result={passed:true,checks,errors,timings:{...timings,runEndedAt:new Date().toISOString()},scope:'Actual Electron renderer, IPC, storage, close guard; native dialog responses are controlled by QA.'};
 await writeFile(join(output,'file-lifecycle.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,output}));
}catch(error){if(page && !page.isClosed())await captureHidden(app,page,join(output,'failure.png')).catch(()=>{});throw error;}
finally {
 if(app && !ended){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
 await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
