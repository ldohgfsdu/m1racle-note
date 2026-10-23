import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';

// Two articles side by side. Each window owns its own document, save queue and
// close guard. Dialog choices and window titles are supplied by the harness;
// this does not verify the Windows file-picker UI or manual window placement.
const dir=await mkdtemp(join(tmpdir(),'note-multi-window-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-multi-window-evidence-'));await mkdir(output,{recursive:true});
const a=join(dir,'对照原文.md'),b=join(dir,'摘录.md'),c=join(dir,'再开一篇.md'),draftNote=join(dir,'对照笔记.md');
const rawA='# 对照原文\n\n这里是原文。\n',rawB='# 摘录\n\n笔记从这里开始。\n',rawC='# 再开一篇\n';
await writeFile(a,rawA);await writeFile(b,rawB);await writeFile(c,rawC);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY || resolve('desktop/main.mjs'),profile=join(dir,'profile'),electronPath=resolve('node_modules/electron/dist/electron.exe'),checks=[],errors=[];
let app,ended=false;
const watch=page=>{page.on('pageerror',error=>errors.push(error.message));page.on('console',event=>{if(event.type()==='error')errors.push(event.text());});return page;};
const text=page=>page.locator('.cm-content').evaluate(element=>element.cmTile.root.view.state.doc.toString());
const windowCount=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length);
const windowTitles=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(win=>win.getTitle()));
const retitle=async(page,title)=>{await page.evaluate(value=>{document.title=value;},title);await expect.poll(windowTitles).toContain(title);};
const closeByTitle=title=>app.evaluate(({BrowserWindow},value)=>{const target=BrowserWindow.getAllWindows().find(win=>win.getTitle()===value);if(!target)throw new Error('未找到窗口 '+value);target.close();},title);
const launchAgain=file=>spawn(electronPath,[entry,file,'--user-data-dir='+profile],{env,stdio:'ignore',windowsHide:true});
const waitExit=child=>new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('再次启动的进程没有退出')),20000);child.on('exit',code=>{clearTimeout(timer);done(code);});child.on('error',error=>{clearTimeout(timer);reject(error);});});
try {
 app=await electron.launch({executablePath:electronPath,args:[entry,a,'--user-data-dir='+profile],env});
 const page1=watch(await app.firstWindow());
 await page1.locator('#filename').filter({hasText:'对照原文.md'}).waitFor();
 await app.evaluate(({dialog})=>{
  globalThis.noteQaDialogs={open:[],save:[],confirm:[],calls:[]};
  for(const [method,type,fallback] of [['showOpenDialog','open',{canceled:true,filePaths:[]}],['showSaveDialog','save',{canceled:true}],['showMessageBox','confirm',{response:1}]]) {
   dialog[method]=async(...args)=>{const result=globalThis.noteQaDialogs[type].shift() || fallback;globalThis.noteQaDialogs.calls.push({type,result,options:args.at(-1)});return result;};
  }
 });
 const choose=(type,value)=>app.evaluate((_electron,{type,value})=>globalThis.noteQaDialogs[type].push(value),{type,value});
 const count=type=>app.evaluate((_electron,type)=>globalThis.noteQaDialogs.calls.filter(call=>call.type===type).length,type);

 await page1.locator('#app-menu summary').click();await page1.locator('#new-window').click();
 const page2=watch(await app.waitForEvent('window'));
 await page2.locator('#filename').filter({hasText:'未命名.md'}).waitFor();
 assert.equal(await text(page2),'');assert.equal(await page2.locator('#status').textContent(),'未保存的新文档');
 assert.equal(await windowCount(),2);checks.push('menu-new-window-opens-a-blank-untitled-window');

 await page1.locator('#app-menu summary').click();await choose('open',{canceled:false,filePaths:[b]});await page1.locator('#open-window').click();
 const page3=watch(await app.waitForEvent('window'));
 await page3.locator('#filename').filter({hasText:'摘录.md'}).waitFor();
 assert.equal(await page3.locator('#status').textContent(),'已保存');assert.equal(await page1.locator('#filename').textContent(),'对照原文.md');
 checks.push('open-in-new-window-loads-the-picked-file');

 await page3.locator('.cm-content').click();await page3.keyboard.press('Control+End');await page3.keyboard.insertText('继续对照。');
 await expect.poll(()=>readFile(b,'utf8')).toBe(rawB+'继续对照。');
 assert.equal(await readFile(a,'utf8'),rawA);assert.equal(await text(page1),rawA);
 checks.push('windows-edit-and-autosave-independently');

 const beforeDedupe=await windowCount();await choose('open',{canceled:false,filePaths:[a]});
 await page1.locator('#app-menu summary').click();await page1.locator('#open-window').click();await page1.waitForTimeout(500);
 assert.equal(await windowCount(),beforeDedupe);checks.push('open-in-new-window-focuses-an-already-open-file');

 const beforeDark=await page3.evaluate(()=>document.documentElement.classList.contains('dark'));
 await page1.locator('#theme').click();
 await expect.poll(()=>page3.evaluate(()=>document.documentElement.classList.contains('dark'))).toBe(!beforeDark);
 await page1.locator('#appearance-open').click();await page1.locator('#appearance:popover-open').waitFor();await page1.locator('#appearance-width label:has(input[value="a5"])').click();assert.equal(await page1.locator('#appearance-width input[value="a5"]').isChecked(),true);await page1.keyboard.press('Escape');await page1.waitForFunction(()=>!document.getElementById('appearance').matches(':popover-open') && document.activeElement?.id==='appearance-open');
 await expect.poll(()=>page3.evaluate(()=>document.documentElement.dataset.width)).toBe('a5');
 checks.push('theme-and-appearance-apply-across-windows');

 await retitle(page2,'QA2');await closeByTitle('QA2');
 await expect.poll(windowCount).toBe(2);assert.equal(await count('confirm'),0);
 await page1.locator('#app-menu summary').click();await page1.locator('#new-window').click();
 const page4=watch(await app.waitForEvent('window'));await page4.locator('#filename').filter({hasText:'未命名.md'}).waitFor();
 await page4.locator('.cm-content').click();await page4.keyboard.insertText('还没保存的对照笔记。');
 await retitle(page4,'QA4');
 await choose('confirm',{response:1});await closeByTitle('QA4');
 await expect.poll(()=>count('confirm')).toBe(1);assert.equal(await windowCount(),3);
 await choose('confirm',{response:0});await choose('save',{canceled:false,filePath:draftNote});await closeByTitle('QA4');
 await expect.poll(windowCount).toBe(2);assert.equal(await readFile(draftNote,'utf8'),'还没保存的对照笔记。');
 checks.push('close-guard-is-per-window');

 const nextWindow=app.waitForEvent('window');
 assert.equal(await waitExit(launchAgain(c)),0);
 const page5=watch(await nextWindow);await page5.locator('#filename').filter({hasText:'再开一篇.md'}).waitFor();
 assert.equal(await windowCount(),3);
 const beforeRepeat=await windowCount();
 assert.equal(await waitExit(launchAgain(a)),0);await page1.waitForTimeout(600);
 assert.equal(await windowCount(),beforeRepeat);checks.push('second-launch-reuses-the-app-for-already-open-files');

 assert.equal(await text(page1),rawA);assert.equal(await text(page3),rawB+'继续对照。');assert.equal(await text(page5),rawC);
 checks.push('windows-keep-independent-documents');
 await page1.screenshot({path:join(output,'multi-window.png')});

 const closing=app.waitForEvent('close',{timeout:20000});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.close()));
 await closing;ended=true;
 assert.deepEqual(errors,[]);
 const result={passed:true,checks,errors,scope:'Actual Electron windows, IPC, storage and close guards; native dialog responses and window titles are controlled by QA.'};
 await writeFile(join(output,'multi-window.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,output}));
}catch(error){
 if(app && !ended){try{const current=app.windows().at(-1);if(current)await current.screenshot({path:join(output,'failure.png')});}catch{}}
 throw error;
}
finally {
 if(app && !ended){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
 await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
