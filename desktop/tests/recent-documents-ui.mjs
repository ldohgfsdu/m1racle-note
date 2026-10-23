import {_electron as electron,expect} from '@playwright/test';
import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

// Batch 2C recent documents: return to writing in one click.
// Contracts under test:
// - history lists documents that were actually opened, most recent first, no
//   duplicates, name plus folder hint, one click reopens and focuses editing
// - history persists across restarts and shows a simple empty state
// - missing or inaccessible files give clear feedback and never create a
//   replacement, never crash, and never affect other valid records
// - reading the history never modifies any document
// - multi-window updates stay consistent; the newest completed open wins
// - recent opening never bypasses draft conflict protection (2A) and updates
//   the restored session (2B)
const dir=await mkdtemp(join(tmpdir(),'note-recent-docs-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-recent-docs-evidence-'));await mkdir(output,{recursive:true}).catch(()=>{});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY || resolve('desktop/main.mjs');
const checks=[],errors=[],failures=[],scenarios=[],measurements={};
let app=null,page=null,scenario='';
process.on('unhandledRejection',error=>{errors.push(`${scenario}: unhandled ${error?.message || error}`);});
const sleep=ms=>new Promise(resolveSleep=>setTimeout(resolveSleep,ms));
const textOn=target=>target.locator('.cm-content').evaluate(element=>element.cmTile.root.view.state.doc.toString());
const text=()=>textOn(page);
const sha256=value=>createHash('sha256').update(value).digest('hex');
const exists=async file=>{try{await stat(file);return true;}catch{return false;}};
const recentItems=async profile=>{try{return JSON.parse(await readFile(join(profile,'recent.json'),'utf8')).items;}catch{return null;}};
const waitRecent=async(profile,names)=>expect.poll(()=>recentItems(profile).then(items=>items?items.map(entry=>entry.name):null),{timeout:5000}).toEqual(names);
const seedDraft=async(profile,{id,path='',raw,base,updatedAt=Date.now()})=>{
 await mkdir(join(profile,'recovery'),{recursive:true});
 await writeFile(join(profile,'recovery',id+'.json'),JSON.stringify({version:1,id,path,raw,...(typeof base==='string'?{base}:{}),updatedAt}));
};
const launch=async(profile,fileArgs=[])=>{
 const launched=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[entry,...fileArgs,'--user-data-dir='+profile],env});
 const launchedPage=await launched.firstWindow();
 launchedPage.on('pageerror',error=>errors.push(`${scenario}: ${error.message}`));
 launchedPage.on('console',event=>{if(event.type()==='error')errors.push(`${scenario}: ${event.text()}`);});
 await launched.evaluate(({dialog})=>{
  globalThis.noteQaDialogs={open:[],save:[],confirm:[],calls:[]};
  for(const [method,type,fallback] of [['showOpenDialog','open',{canceled:true,filePaths:[]}],['showSaveDialog','save',{canceled:true}],['showMessageBox','confirm',{response:1}]]) {
   dialog[method]=async(...args)=>{const result=globalThis.noteQaDialogs[type].shift() || fallback;globalThis.noteQaDialogs.calls.push({type,result,options:args.at(-1)});return result;};
  }
 });
 return {app:launched,page:launchedPage};
};
const killTree=async()=>{try{execFileSync('taskkill',['/PID',String(app.process().pid),'/T','/F'],{stdio:'ignore'});}catch{}await sleep(500);app=null;page=null;};
const closeNormally=async()=>{
 const proc=app.process();
 const closed=app.waitForEvent('close',{timeout:20000});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
 await closed;
 app=null;page=null;
 return proc.exitCode;
};
const choice=async(type,value)=>app.evaluate((_electron,{type,value})=>globalThis.noteQaDialogs[type].push(value),{type,value});
const openViaDialog=async file=>{await choice('open',{canceled:false,filePaths:[file]});await page.locator('#open').click();};
const showRecent=async()=>{await page.locator('#recent').click();await expect(page.locator('#recent-dialog')).toBeVisible({timeout:5000});};
const hideRecent=async()=>{await page.locator('#recent-close').click();await expect(page.locator('#recent-dialog')).toBeHidden();};
const recentNames=()=>page.locator('#recent-list .recent-item .recent-name').allTextContents();
const itemNamed=name=>page.locator('#recent-list .recent-item').filter({hasText:name});
const markWindow=async(target,marker)=>{await target.evaluate(marker=>{document.documentElement.dataset.qa=marker;},marker);};
const focusWindow=async marker=>{
 const id=await app.evaluate(async ({BrowserWindow},marker)=>{
  for(const window of BrowserWindow.getAllWindows()){
   const matched=await window.webContents.executeJavaScript(`document.documentElement.dataset.qa===${JSON.stringify(marker)}`).catch(()=>false);
   if(matched)return window.id;
  }
  return -1;
 },marker);
 assert.ok(id>=0,`window ${marker} not found`);
 await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).focus(),id);
 await sleep(500);
};
const cleanupApp=async()=>{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});app=null;page=null;}};
const runScenario=async(name,run)=>{
 scenario=name;const profile=join(dir,name);const started=Date.now();
 const record={scenario:name,profile,status:'passed',milliseconds:0};
 try{await mkdir(profile,{recursive:true}).catch(()=>{});await run(profile);}
 catch(error){record.status='failed';record.error=String(error?.stack||error);failures.push(name);if(page&&!page.isClosed())await page.screenshot({path:join(output,'failure-'+name+'.png')}).catch(()=>{});}
 finally{record.milliseconds=Date.now()-started;scenarios.push(record);await cleanupApp();}
};

try {
 await runScenario('first-launch-shows-empty-state',async profile=>{
  // No history at all: the list opens to a simple empty state, nothing else changes.
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('欢迎.md',{timeout:10000});
  await showRecent();
  await expect(page.locator('#recent-list .recent-empty')).toBeVisible();
  await expect(page.locator('#recent-list .recent-item')).toHaveCount(0);
  await expect(page.locator('#recent-list .recent-empty')).toHaveText('\u8fd8\u6ca1\u6709\u6700\u8fd1\u6253\u5f00\u7684\u6587\u6863');
  await expect(page.locator('#recent-new')).toHaveText('\u65b0\u5efa');
  await expect(page.locator('#recent-open')).toHaveText('\u6253\u5f00\u6587\u4ef6');
  await expect(page.locator('#recent-list img,#recent-list svg')).toHaveCount(0);
  await expect(page.locator('#error')).toBeHidden();
  await hideRecent();
  await expect(page.locator('#filename')).toContainText('欢迎.md');
  await expect(page.locator('#error')).toBeHidden();
  checks.push('first-launch-shows-empty-state');
  await killTree();
 });

 await runScenario('opening-a-document-records-and-persists',async profile=>{
  // A document opened through the normal open flow appears once, with a name and
  // a folder hint, and the history survives a restart.
  const fileA=join(profile,'rc-a.md');
  await writeFile(fileA,'最近文档 A 的内容\n');
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await openViaDialog(fileA);
  await expect(page.locator('#filename')).toContainText('rc-a.md');
  await showRecent();
  await expect(page.locator('#recent-list .recent-item')).toHaveCount(1);
  await expect(page.locator('.recent-name')).toHaveText('rc-a');
  await expect(page.locator('.recent-dir')).toContainText('opening-a-document-records-and-persists');
  await hideRecent();
  await killTree();
  const relaunched=await launch(profile);app=relaunched.app;page=relaunched.page;
  await expect(page.locator('#filename')).toContainText('rc-a.md',{timeout:10000});
  await showRecent();
  await expect(page.locator('#recent-list .recent-item')).toHaveCount(1);
  await expect(page.locator('.recent-name')).toHaveText('rc-a');
  checks.push('opening-a-document-records-and-persists');
  await killTree();
 });

 await runScenario('order-dedupe-and-single-click-return',async profile=>{
  // Three documents in order A, B, C: the list shows C, B, A. Returning to A in
  // one click moves it to the front without duplicating it.
  const fileA=join(profile,'rc-order-a.md'),fileB=join(profile,'rc-order-b.md'),fileC=join(profile,'rc-order-c.md');
  for(const file of [fileA,fileB,fileC])await writeFile(file,`${file} 的内容\n`);
  const launched=await launch(profile);app=launched.app;page=launched.page;
  for(const file of [fileA,fileB,fileC]){await openViaDialog(file);await expect(page.locator('#filename')).toContainText(file.split('\\').pop());}
  await showRecent();
  assert.deepEqual(await recentNames(),['rc-order-c','rc-order-b','rc-order-a']);
  await itemNamed('rc-order-a').click();
  await expect(page.locator('#recent-dialog')).toBeHidden();
  await expect(page.locator('#filename')).toContainText('rc-order-a.md');
  await showRecent();
  assert.deepEqual(await recentNames(),['rc-order-a','rc-order-c','rc-order-b']);
  await expect(page.locator('#recent-list .recent-item')).toHaveCount(3);
  await waitRecent(profile,['rc-order-a.md','rc-order-c.md','rc-order-b.md']);
  checks.push('order-dedupe-and-single-click-return');
  await killTree();
 });

 await runScenario('returning-from-recent-starts-editing-and-saves',async profile=>{
  // One click from the list opens the document and puts the caret in the editor:
  // typing works immediately and autosave persists it. Open latency is measured.
  const target=join(profile,'rc-edit.md');
  const body=Array.from({length:120},(_,index)=>`第 ${index+1} 行：快速返回写作`).join('\n')+'\n';
  await writeFile(target,body);
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await openViaDialog(target);
  await expect(page.locator('#filename')).toContainText('rc-edit.md');
  await showRecent();
  const started=Date.now();
  await itemNamed('rc-edit').click();
  await expect(page.locator('#recent-dialog')).toBeHidden();
  await expect(page.locator('#filename')).toContainText('rc-edit.md');
  assert.equal(await text(),body);
  await expect.poll(()=>page.evaluate(()=>Boolean(document.activeElement?.closest('.cm-content'))),{timeout:5000}).toBe(true);
  measurements['return-from-recent-to-editable-ms']=Date.now()-started;
  await page.keyboard.insertText('直接输入');
  const expected='直接输入'+body; // a freshly opened document puts the caret at its start
  await expect.poll(()=>readFile(target,'utf8'),{timeout:8000}).toBe(expected);
  await expect(page.locator('#status')).toHaveText('已保存');
  await expect(page.locator('#error')).toBeHidden();
  checks.push('returning-from-recent-starts-editing-and-saves');
  await killTree();
 });

 await runScenario('missing-file-feedback-keeps-list-usable',async profile=>{
  // A deleted document must not crash the app, must not be silently recreated,
  // and must not break the other records. Reading the list never touches files.
  const fileA=join(profile,'rc-gone.md'),fileB=join(profile,'rc-keep.md');
  await writeFile(fileA,'会消失的 A\n');await writeFile(fileB,'保持不变的 B\n');
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await openViaDialog(fileA);
  await openViaDialog(fileB);
  await expect(page.locator('#filename')).toContainText('rc-keep.md');
  const hashB=sha256(await readFile(fileB));
  await rm(fileA,{force:true});
  await showRecent();
  assert.equal(sha256(await readFile(fileB)),hashB);
  await expect(itemNamed('rc-gone').locator('.recent-dir')).toHaveText('文件已移动或删除');
  const beforeFailed=await recentItems(profile);
  await itemNamed('rc-gone').click();
  await expect(page.locator('#error')).toBeVisible({timeout:5000});
  assert.deepEqual(await recentItems(profile),beforeFailed);
  await expect(page.locator('#error-message')).toContainText('已不在原位置');
  await expect(page.locator('#recent-dialog')).toBeVisible();
  assert.equal(await exists(fileA),false);
  await itemNamed('rc-keep').click();
  await expect(page.locator('#recent-dialog')).toBeHidden();
  await expect(page.locator('#filename')).toContainText('rc-keep.md');
  assert.equal(await text(),'保持不变的 B\n');
  await showRecent();
  await expect(page.locator('#recent-list .recent-item')).toHaveCount(2);
  assert.equal(sha256(await readFile(fileB)),hashB);
  await hideRecent();
  assert.equal(sha256(await readFile(fileB)),hashB);
  checks.push('missing-file-feedback-keeps-list-usable');
  await killTree();
 });

 await runScenario('inaccessible-path-reports-clearly',async profile=>{
  // The remembered path is now unreadable (a directory replaced the file):
  // clear feedback, no crash, no empty replacement, other docs unaffected.
  const fileC=join(profile,'rc-blocked.md'),other=join(profile,'rc-other.md');
  await writeFile(fileC,'会被目录替换\n');await writeFile(other,'另一个文档\n');
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await openViaDialog(fileC);
  await openViaDialog(other);
  await expect(page.locator('#filename')).toContainText('rc-other.md');
  await killTree();
  await rm(fileC,{force:true});
  await mkdir(fileC);
  const relaunched=await launch(profile);app=relaunched.app;page=relaunched.page;
  await expect(page.locator('#filename')).toContainText('rc-other.md',{timeout:10000});
  await showRecent();
  await expect(itemNamed('rc-blocked').locator('.recent-dir')).toHaveText('无权访问');
  await itemNamed('rc-blocked').click();
  await expect(page.locator('#error')).toBeVisible({timeout:5000});
  await expect(page.locator('#error-message')).toContainText('无法打开这个文档');
  await expect(page.locator('#recent-dialog')).toBeVisible();
  assert.equal((await stat(fileC)).isDirectory(),true);
  await hideRecent();
  await page.locator('#new').click();
  await expect(page.locator('#filename')).toContainText('未命名.md');
  checks.push('inaccessible-path-reports-clearly');
  await killTree();
 });

 await runScenario('corrupt-recent-record-degrades-safely',async profile=>{
  // Garbage in recent.json reads as no history; the next open rebuilds a valid
  // record, and that record survives a restart.
  await writeFile(join(profile,'recent.json'),'{this is not json');
  const fileA=join(profile,'rc-fix.md');
  await writeFile(fileA,'修复后的文档\n');
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await showRecent();
  await expect(page.locator('#recent-list .recent-empty')).toBeVisible();
  await expect(page.locator('#error')).toBeHidden();
  await hideRecent();
  await openViaDialog(fileA);
  await expect(page.locator('#filename')).toContainText('rc-fix.md');
  await waitRecent(profile,['rc-fix.md']);
  await killTree();
  const relaunched=await launch(profile);app=relaunched.app;page=relaunched.page;
  await expect(page.locator('#filename')).toContainText('rc-fix.md',{timeout:10000});
  await showRecent();
  await expect(page.locator('#recent-list .recent-item')).toHaveCount(1);
  checks.push('corrupt-recent-record-degrades-safely');
  await killTree();
 });

 await runScenario('multi-window-updates-stay-consistent',async profile=>{
  // Two windows open different documents, then the same document: one record,
  // deterministic newest-first order, no lost history, valid JSON on disk.
  const fileA=join(profile,'rc-win-a.md'),fileB=join(profile,'rc-win-b.md'),fileC=join(profile,'rc-win-c.md');
  await writeFile(fileA,'窗口 A\n');await writeFile(fileB,'窗口 B\n');await writeFile(fileC,'窗口 C\n');
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await openViaDialog(fileA);
  await expect(page.locator('#filename')).toContainText('rc-win-a.md');
  const pageOne=page;
  await markWindow(pageOne,'one');
  await pageOne.evaluate(()=>window.desktop.request('new-window'));
  const pageTwo=await app.waitForEvent('window',{timeout:15000});
  pageTwo.on('pageerror',error=>errors.push(`${scenario}: ${error.message}`));
  pageTwo.on('console',event=>{if(event.type()==='error')errors.push(`${scenario}: ${event.text()}`);});
  await expect(pageTwo.locator('#filename')).toContainText('未命名',{timeout:10000});
  await markWindow(pageTwo,'two');
  await choice('open',{canceled:false,filePaths:[fileB]});
  await pageTwo.locator('#open').click();
  await expect(pageTwo.locator('#filename')).toContainText('rc-win-b.md');
  await choice('open',{canceled:false,filePaths:[fileB]});
  await pageOne.locator('#open').click();
  await expect(pageOne.locator('#filename')).toContainText('rc-win-b.md');
  await choice('open',{canceled:false,filePaths:[fileC]});
  await pageTwo.locator('#open').click();
  await expect(pageTwo.locator('#filename')).toContainText('rc-win-c.md');
  await waitRecent(profile,['rc-win-c.md','rc-win-b.md','rc-win-a.md']);
  const items=await recentItems(profile);
  assert.equal(items.filter(entry=>entry.name==='rc-win-b.md').length,1);
  await focusWindow('one');await focusWindow('two');await focusWindow('one');await sleep(800);
  assert.deepEqual(await recentItems(profile),items,'focus changes must not count as access');
  await pageOne.locator('#recent').click();
  await expect(pageOne.locator('#recent-dialog')).toBeVisible({timeout:5000});
  await expect(pageOne.locator('#recent-list .recent-item')).toHaveCount(3);
  const names=await pageOne.locator('#recent-list .recent-item .recent-name').allTextContents();
  assert.deepEqual(names,['rc-win-c','rc-win-b','rc-win-a']);
  await pageOne.locator('#recent-close').click();
  await pageTwo.locator('#recent').click();
  await expect(pageTwo.locator('#recent-dialog')).toBeVisible({timeout:5000});
  await expect(pageTwo.locator('#recent-list .recent-item')).toHaveCount(3);
  checks.push('multi-window-updates-stay-consistent');
  await killTree();
 });

 await runScenario('labels-disambiguate-and-tooltips',async profile=>{
  // Product display rules: name without extension, "上一级 / 再上一级" below it,
  // identical labels climb one level at a time, the full path is only a tooltip,
  // very long names truncate from the middle.
  const make=async(parts,name)=>{const folder=join(profile,...parts);await mkdir(folder,{recursive:true});const file=join(folder,name);await writeFile(file,name+'\n');return file;};
  const one=await make(['a','工作','计划'],'todo.md');
  const two=await make(['b','工作','计划'],'todo.md');
  const three=await make(['c','x','y'],'notes.markdown');
  const longName='开头'.repeat(20)+'结尾'.repeat(20);
  const four=await make(['d'],longName+'.md');
  const launched=await launch(profile);app=launched.app;page=launched.page;
  for(const file of [one,two,three,four]){await openViaDialog(file);await expect(page.locator('#filename')).toContainText(file.split('\\').pop().slice(0,6));}
  await showRecent();
  const rows=page.locator('#recent-list .recent-item');
  await expect(rows).toHaveCount(4);
  const names=await recentNames();
  assert.equal(names[1],'notes');
  assert.equal(names[2],'todo');assert.equal(names[3],'todo');
  assert.ok(names[0].includes('…'),'long name is truncated from the middle');
  assert.ok(names[0].startsWith('开头开头') && names[0].endsWith('结尾结尾'));
  assert.ok([...names[0]].length<=36);
  const hints=await page.locator('#recent-list .recent-item .recent-dir').allTextContents();
  assert.equal(hints[1],'y / x');
  assert.equal(hints[3],'计划 / 工作 / a');
  assert.equal(hints[2],'计划 / 工作 / b');
  assert.equal(hints[0],'d / '+profile.split('\\').pop());
  assert.equal(await rows.nth(3).getAttribute('title'),one);
  assert.equal(await rows.nth(2).getAttribute('title'),two);
  assert.equal(await rows.nth(0).getAttribute('title'),four);
  for(const hint of hints)assert.equal(hint.includes(profile),false,'full path is never shown in the row');
  checks.push('labels-disambiguate-and-tooltips');
  await killTree();
 });

 await runScenario('returning-updates-session-restore',async profile=>{
  // Session restore (2B) and the list cooperate: restart resumes the last
  // active document, and returning to another document via the list updates
  // what the next restart resumes.
  const fileA=join(profile,'rc-sess-a.md'),fileB=join(profile,'rc-sess-b.md');
  await writeFile(fileA,'会话 A 的内容\n');await writeFile(fileB,'会话 B 的内容\n');
  let launched=await launch(profile);app=launched.app;page=launched.page;
  await openViaDialog(fileA);
  await openViaDialog(fileB);
  await expect(page.locator('#filename')).toContainText('rc-sess-b.md');
  let exitCode=await closeNormally();
  assert.equal(exitCode,0);
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('rc-sess-b.md',{timeout:10000});
  assert.equal(await text(),'会话 B 的内容\n');
  await showRecent();
  assert.deepEqual(await recentNames(),['rc-sess-b','rc-sess-a']);
  await itemNamed('rc-sess-a').click();
  await expect(page.locator('#recent-dialog')).toBeHidden();
  await expect(page.locator('#filename')).toContainText('rc-sess-a.md');
  assert.equal(await text(),'会话 A 的内容\n');
  await waitRecent(profile,['rc-sess-a.md','rc-sess-b.md']);
  exitCode=await closeNormally();
  assert.equal(exitCode,0);
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('rc-sess-a.md',{timeout:10000});
  assert.equal(await text(),'会话 A 的内容\n');
  checks.push('returning-updates-session-restore');
  await killTree();
 });

 await runScenario('draft-protection-holds-with-recent-and-recovery',async profile=>{
  // A pending draft (2A) keeps priority: recovery restores first, the history
  // list stays a side glance that never clobbers editor content, and saving a
  // recovered draft whose baseline is stale is still refused in place.
  const target=join(profile,'rc-draft.md'),disk='磁盘内容\n',raw='草稿内容';
  await writeFile(target,disk);
  await seedDraft(profile,{id:'c2c2c2c2-1111-2222-3333-444444444444',path:target,raw,base:sha256('旧版本内容\n')});
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible({timeout:10000});
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),raw);
  await showRecent();
  assert.deepEqual(await recentNames(),['rc-draft']);
  await expect(page.locator('#recent-list .recent-item')).toHaveCount(1);
  await hideRecent();
  assert.equal(await text(),raw);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('补');
  await expect(page.locator('#error')).toBeVisible({timeout:5000});
  await expect(page.locator('#error-message')).toContainText('其他程序修改');
  assert.equal(await readFile(target,'utf8'),disk);
  const rescued=join(profile,'rc-draft-rescued.md');
  await choice('save',{canceled:false,filePath:rescued});
  await page.locator('#error-save-as').click();
  await expect(page.locator('#status')).toHaveText('已保存');
  assert.equal(await readFile(rescued,'utf8'),raw+'补');
  assert.equal(await readFile(target,'utf8'),disk);
  checks.push('draft-protection-holds-with-recent-and-recovery');
  await killTree();
 });

 assert.deepEqual(errors,[]);
} catch (error) {
 if(page && !page.isClosed())await page.screenshot({path:join(output,'failure-'+(scenario||'setup')+'.png')}).catch(()=>{});
 if(failures[failures.length-1]!==scenario)failures.push(scenario||'setup');
 console.error(String(error?.stack||error));
} finally {
 await cleanupApp();
 const result={passed:failures.length===0,checks,failures,errors,scenarios,measurements,scope:'Actual Electron app; dialogs supplied by QA harness; physical IME not exercised; open latency measured, not promised.'};
 await writeFile(join(output,'recent-documents.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:result.passed,checks,failures,measurements,output}));
 if(failures.length)process.exitCode=1;
 await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
