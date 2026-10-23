import {_electron as electron,expect} from '@playwright/test';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

// Batch 2B session restore: a normal close followed by a relaunch must resume
// the last active document with its edit mode, cursor and scroll position.
// Contracts under test:
// - only context is stored (path/mode/cursor/scroll), never document bytes
// - the most recently focused window decides what is restored
// - invalid or corrupt session state degrades to the initial interface
// - the Batch 2A draft recovery entry keeps working side by side
// - restored documents keep the existing external-change conflict guards
const dir=await mkdtemp(join(tmpdir(),'note-session-restore-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-session-restore-evidence-'));await mkdir(output,{recursive:true}).catch(()=>{});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY || resolve('desktop/main.mjs');
const checks=[],errors=[],failures=[],scenarios=[];
let app=null,page=null,scenario='';
process.on('unhandledRejection',error=>{errors.push(`${scenario}: unhandled ${error?.message || error}`);});
const sleep=ms=>new Promise(resolveSleep=>setTimeout(resolveSleep,ms));
const textOn=target=>target.locator('.cm-content').evaluate(element=>element.cmTile.root.view.state.doc.toString());
const text=()=>textOn(page);
const selectionOn=target=>target.locator('.cm-content').evaluate(element=>{const main=element.cmTile.root.view.state.selection.main;return {anchor:main.anchor,head:main.head};});
const scrollTopOn=target=>target.locator('.cm-content').evaluate(element=>element.cmTile.root.view.scrollDOM.scrollTop);
const setSelection=(target,position)=>target.locator('.cm-content').evaluate((element,position)=>{element.cmTile.root.view.dispatch({selection:{anchor:position}});},position);
const setScroll=(target,top)=>target.locator('.cm-content').evaluate((element,top)=>{element.cmTile.root.view.scrollDOM.scrollTop=top;},top);
const sha256=value=>createHash('sha256').update(value).digest('hex');
const sessionFile=profile=>join(profile,'session.json');
const sessionRecord=async profile=>{try{return JSON.parse(await readFile(sessionFile(profile),'utf8'));}catch{return null;}};
const waitSession=async profile=>expect.poll(()=>sessionRecord(profile),{timeout:5000}).not.toBeNull();
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
const markWindow=async(target,marker)=>{await target.evaluate(marker=>{document.documentElement.dataset.qa=marker;},marker);};
const windowIdByMarker=async marker=>app.evaluate(async ({BrowserWindow},marker)=>{
 for(const window of BrowserWindow.getAllWindows()){
  const matched=await window.webContents.executeJavaScript(`document.documentElement.dataset.qa===${JSON.stringify(marker)}`).catch(()=>false);
  if(matched)return window.id;
 }
 return -1;
},marker);
const focusWindow=async marker=>{
 const id=await windowIdByMarker(marker);
 assert.ok(id>=0,`window ${marker} not found`);
 await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).focus(),id);
 await sleep(700);
};
const closeWindow=async marker=>{
 const id=await windowIdByMarker(marker);
 assert.ok(id>=0,`window ${marker} not found`);
 await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).close(),id);
 await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),{timeout:10000}).toBe(1);
};
const choice=async(type,value)=>app.evaluate((_electron,{type,value})=>globalThis.noteQaDialogs[type].push(value),{type,value});
const cleanupApp=async()=>{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});app=null;page=null;}};
const runScenario=async(name,run)=>{
 scenario=name;const profile=join(dir,name);const started=Date.now();
 const record={scenario:name,profile,status:'passed',milliseconds:0};
 try{await mkdir(profile,{recursive:true}).catch(()=>{});await run(profile);}
 catch(error){record.status='failed';record.error=String(error?.stack||error);failures.push(name);if(page&&!page.isClosed())await page.screenshot({path:join(output,'failure-'+name+'.png')}).catch(()=>{});}
 finally{record.milliseconds=Date.now()-started;scenarios.push(record);await cleanupApp();}
};

try {
 await runScenario('close-and-restart-resumes-last-document-with-position',async profile=>{
  // Open A, switch to source mode, place the cursor and scroll down; a normal
  // close and relaunch must come back to exactly that document and position.
  const target=join(dir,'s1-doc.md');
  const body='# 会话恢复标题\n\n'+Array.from({length:220},(_,index)=>`第 ${index+1} 行：会话恢复测试内容`).join('\n')+'\n';
  await writeFile(target,body);
  let launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'s1-doc.md'}).waitFor();
  await page.locator('#code').click();
  await expect(page.locator('#code')).toHaveAttribute('aria-pressed','true');
  await sleep(300);
  await setSelection(page,120);
  await setScroll(page,900);
  await expect.poll(()=>sessionRecord(profile).then(value=>value?.path),{timeout:5000}).toBe(target);
  await expect.poll(()=>sessionRecord(profile).then(value=>value?.cursor?.anchor),{timeout:5000}).toBe(120);
  await expect.poll(()=>sessionRecord(profile).then(value=>value?.scrollTop),{timeout:5000}).toBeGreaterThanOrEqual(800);
  const saved=await sessionRecord(profile);
  assert.equal(saved.mode,'code');
  assert.equal(Object.keys(saved).some(key=>/raw|content|text/i.test(key)),false);
  const before=sha256(await readFile(target));
  const exitCode=await closeNormally();
  assert.equal(exitCode,0);
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('s1-doc.md',{timeout:10000});
  await expect(page.locator('#code')).toHaveAttribute('aria-pressed','true');
  assert.equal(await text(),body);
  assert.deepEqual(await selectionOn(page),saved.cursor);
  const scroll=await scrollTopOn(page);
  assert.ok(Math.abs(scroll-saved.scrollTop)<=40,`restored scroll ${scroll}, saved ${saved.scrollTop}`);
  assert.equal(sha256(await readFile(target)),before);
  await expect(page.locator('#status')).toHaveText('已保存');
  await expect(page.locator('#error')).toBeHidden();
  checks.push('close-and-restart-resumes-last-document-with-position');
  await killTree();
 });

 await runScenario('restart-resumes-the-most-recently-opened-document',async profile=>{
  // A -> switch to B -> close -> restart restores B; opening A again and
  // restarting restores A. The rule is repeatable, not a first-opened memory.
  const fileA=join(dir,'s2-a.md'),fileB=join(dir,'s2-b.md');
  await writeFile(fileA,'文档 A 的内容\n');await writeFile(fileB,'文档 B 的内容\n');
  let launched=await launch(profile,[fileA]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'s2-a.md'}).waitFor();
  await choice('open',{canceled:false,filePaths:[fileB]});
  await page.locator('#sidebar-open').click();
  await expect(page.locator('#filename')).toContainText('s2-b.md');
  await expect.poll(()=>sessionRecord(profile).then(value=>value?.path),{timeout:5000}).toBe(fileB);
  await closeNormally();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('s2-b.md',{timeout:10000});
  assert.equal(await text(),'文档 B 的内容\n');
  await choice('open',{canceled:false,filePaths:[fileA]});
  await page.locator('#sidebar-open').click();
  await expect(page.locator('#filename')).toContainText('s2-a.md');
  await expect.poll(()=>sessionRecord(profile).then(value=>value?.path),{timeout:5000}).toBe(fileA);
  await closeNormally();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('s2-a.md',{timeout:10000});
  assert.equal(await text(),'文档 A 的内容\n');
  checks.push('restart-resumes-the-most-recently-opened-document');
  await killTree();
 });

 await runScenario('deleted-last-document-falls-back-with-feedback',async profile=>{
  // The remembered file is gone: start at the initial interface, say so in a
  // non-blocking way, and keep the editor usable.
  const target=join(dir,'s3-gone.md');
  await writeFile(target,'会消失的文档\n');
  let launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'s3-gone.md'}).waitFor();
  await waitSession(profile);
  await closeNormally();
  await rm(target,{force:true});
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('欢迎.md',{timeout:10000});
  await expect(page.locator('#error')).toBeVisible({timeout:5000});
  await expect(page.locator('#error-message')).toContainText('已不在原位置');
  await expect(page.locator('#recovery')).toBeHidden();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('继续工作');
  assert.match(await text(),/继续工作/);
  await expect(page.locator('#status')).not.toHaveText('保存失败');
  checks.push('deleted-last-document-falls-back-with-feedback');
  await killTree();
 });

 await runScenario('unreadable-last-document-reports-clearly',async profile=>{
  // The remembered path is now unreadable (a directory takes its place): the
  // app must explain and fall back without crashing or blocking startup.
  const target=join(dir,'s4-blocked.md');
  await writeFile(target,'会被目录替换的文档\n');
  let launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'s4-blocked.md'}).waitFor();
  await waitSession(profile);
  const exitCode=await closeNormally();
  assert.equal(exitCode,0);
  await rm(target,{force:true});
  await mkdir(target);
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('欢迎.md',{timeout:10000});
  await expect(page.locator('#error')).toBeVisible({timeout:5000});
  await expect(page.locator('#error-message')).toContainText('无法打开上次编辑的文档');
  await expect(page.locator('#recovery')).toBeHidden();
  await page.locator('#dismiss-error').click();
  await expect(page.locator('#error')).toBeHidden();
  checks.push('unreadable-last-document-reports-clearly');
  await killTree();
 });

 await runScenario('first-launch-without-history-shows-initial-ui',async profile=>{
  // No session file at all: the initial interface appears, nothing opens on
  // its own, and no error surface is raised.
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('欢迎.md',{timeout:10000});
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.match(await text(),/留一点空间/);
  const remembered=await sessionRecord(profile);
  assert.ok(remembered===null || remembered.path==='','a document was remembered without being opened');
  const exitCode=await closeNormally();
  assert.equal(exitCode,0);
  checks.push('first-launch-without-history-shows-initial-ui');
 });

 await runScenario('corrupt-session-state-degrades-safely',async profile=>{
  // Garbage and malformed records must be ignored like "no session"; the next
  // normal close then repairs the file with a valid record.
  await writeFile(sessionFile(profile),'{not-json');
  let launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('欢迎.md',{timeout:10000});
  await expect(page.locator('#error')).toBeHidden();
  const exitCode=await closeNormally();
  assert.equal(exitCode,0);
  const repaired=await sessionRecord(profile);
  assert.ok(repaired && repaired.version===1,'session file was not repaired after a normal close');
  await writeFile(sessionFile(profile),JSON.stringify({version:2,path:join(dir,'ghost.md'),mode:'preview',cursor:{anchor:-4,head:'x'},scrollTop:-1}));
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('欢迎.md',{timeout:10000});
  await expect(page.locator('#error')).toBeHidden();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('可用');
  assert.match(await text(),/可用/);
  checks.push('corrupt-session-state-degrades-safely');
  await killTree();
 });

 await runScenario('restart-never-modifies-the-document',async profile=>{
  // A BOM + CRLF document must come back byte-identical: restoring position is
  // viewing state only, and must never rewrite the file.
  const target=join(dir,'s7-bytes.md');
  const bytes=Buffer.concat([Buffer.from([239,187,191]),Buffer.from('# 字节保真\r\n\r\n第一段\r\n第二段\r\n')]);
  await writeFile(target,bytes);
  let launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'s7-bytes.md'}).waitFor();
  await page.waitForTimeout(400);
  await waitSession(profile);
  await closeNormally();
  const before=sha256(await readFile(target));
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('s7-bytes.md',{timeout:10000});
  await sleep(1200);
  assert.equal(sha256(await readFile(target)),before);
  await expect(page.locator('#status')).toHaveText('已保存');
  assert.equal((await page.locator('#filename').textContent()).includes('·'),false);
  await expect(page.locator('#error')).toBeHidden();
  checks.push('restart-never-modifies-the-document');
  await killTree();
 });

 await runScenario('draft-recovery-and-session-restore-coexist',async profile=>{
  // A pending draft for the remembered document: the session reopens the file
  // and the Batch 2A recovery offer still appears; restoring the draft keeps
  // the original untouched until the user edits again.
  const target=join(dir,'s8-target.md'),disk='磁盘内容 A\n',raw='磁盘内容 A\n草稿补充';
  await writeFile(target,disk);
  await seedDraft(profile,{id:'81818181-1111-2222-3333-444444444444',path:target,raw,base:sha256(disk)});
  let launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'s8-target.md'}).waitFor();
  await waitSession(profile);
  await closeNormally();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('s8-target.md',{timeout:10000});
  await expect(page.locator('#recovery')).toBeVisible({timeout:5000});
  await expect(page.locator('.recovery-item')).toHaveCount(1);
  await expect(page.locator('.recovery-item')).toContainText('s8-target.md');
  await sleep(1100);
  assert.equal(await readFile(target,'utf8'),disk);
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),raw);
  await expect(page.locator('#status')).toContainText('已恢复');
  assert.equal(await readFile(target,'utf8'),disk);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('，继续');
  await expect.poll(()=>readFile(target,'utf8'),{timeout:5000}).toBe(raw+'，继续');
  await expect(page.locator('#status')).toHaveText('已保存');
  checks.push('draft-recovery-and-session-restore-coexist');
  await killTree();
 });

 await runScenario('multi-window-last-focused-window-decides',async profile=>{
  // Two windows, A in the first, B in the second. Rule: the restored document
  // belongs to the most recently focused window; if that window closes first,
  // the remaining (next most recently focused) window takes over. Both orders
  // are exercised for repeatability.
  const fileA=join(dir,'s9-a.md'),fileB=join(dir,'s9-b.md');
  await writeFile(fileA,'窗口 A 的文档\n');await writeFile(fileB,'窗口 B 的文档\n');
  let launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('欢迎.md');
  await choice('open',{canceled:false,filePaths:[fileA]});
  await page.locator('#sidebar-open').click();
  await expect(page.locator('#filename')).toContainText('s9-a.md');
  const pageA=page;
  await markWindow(pageA,'A');
  await pageA.evaluate(()=>window.desktop.request('new-window'));
  const pageB=await app.waitForEvent('window',{timeout:15000});
  pageB.on('pageerror',error=>errors.push(`${scenario}: ${error.message}`));
  pageB.on('console',event=>{if(event.type()==='error')errors.push(`${scenario}: ${event.text()}`);});
  await expect(pageB.locator('#filename')).toContainText('未命名',{timeout:10000});
  await markWindow(pageB,'B');
  choice('open',{canceled:false,filePaths:[fileB]});
  await pageB.locator('#sidebar-open').click();
  await expect(pageB.locator('#filename')).toContainText('s9-b.md');
  await expect.poll(()=>sessionRecord(profile).then(value=>value?.path),{timeout:5000}).toBe(fileB);
  await focusWindow('B');
  const closed=app.waitForEvent('close',{timeout:20000});
  await closeWindow('A');
  await expect.poll(()=>sessionRecord(profile).then(value=>value?.path),{timeout:5000}).toBe(fileB);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await closed;app=null;page=null;
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('s9-b.md',{timeout:10000});
  assert.equal(await text(),'窗口 B 的文档\n');
  checks.push('multi-window-last-focused-window-decides');
  await killTree();
 });

 await runScenario('multi-window-remaining-window-takes-over',async profile=>{
  // Variant: the last focused window is closed first, so the remaining window
  // (the next most recently focused one) owns the restored session.
  const fileA=join(dir,'s10-a.md'),fileB=join(dir,'s10-b.md');
  await writeFile(fileA,'窗口 A 的文档\n');await writeFile(fileB,'窗口 B 的文档\n');
  let launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('欢迎.md');
  await choice('open',{canceled:false,filePaths:[fileA]});
  await page.locator('#sidebar-open').click();
  await expect(page.locator('#filename')).toContainText('s10-a.md');
  const pageA=page;
  await markWindow(pageA,'A');
  await pageA.evaluate(()=>window.desktop.request('new-window'));
  const pageB=await app.waitForEvent('window',{timeout:15000});
  pageB.on('pageerror',error=>errors.push(`${scenario}: ${error.message}`));
  pageB.on('console',event=>{if(event.type()==='error')errors.push(`${scenario}: ${event.text()}`);});
  await expect(pageB.locator('#filename')).toContainText('未命名',{timeout:10000});
  await markWindow(pageB,'B');
  choice('open',{canceled:false,filePaths:[fileB]});
  await pageB.locator('#sidebar-open').click();
  await expect(pageB.locator('#filename')).toContainText('s10-b.md');
  await expect.poll(()=>sessionRecord(profile).then(value=>value?.path),{timeout:5000}).toBe(fileB);
  await focusWindow('A');
  await expect.poll(()=>sessionRecord(profile).then(value=>value?.path),{timeout:5000}).toBe(fileA);
  await closeWindow('B');
  await expect.poll(()=>sessionRecord(profile).then(value=>value?.path),{timeout:5000}).toBe(fileA);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await app.waitForEvent('close',{timeout:20000});app=null;page=null;
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('s10-a.md',{timeout:10000});
  assert.equal(await text(),'窗口 A 的文档\n');
  checks.push('multi-window-remaining-window-takes-over');
  await killTree();
 });

 await runScenario('restored-document-keeps-conflict-protection',async profile=>{
  // After a session restore the file is edited externally, then the user types
  // and saves: the existing external-change refusal must still apply, exactly
  // as in a freshly opened document.
  const target=join(dir,'s11-target.md');
  await writeFile(target,'会话内容 A\n');
  let launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'s11-target.md'}).waitFor();
  await waitSession(profile);
  await closeNormally();
  const second='外部改写的 B\n',third='外部再次写入的 C\n';
  await writeFile(target,second);
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('s11-target.md',{timeout:10000});
  assert.equal(await text(),second);
  await writeFile(target,third);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('，补充');
  await expect(page.locator('#error')).toBeVisible({timeout:5000});
  await expect(page.locator('#error-message')).toContainText('其他程序修改');
  assert.equal(await readFile(target,'utf8'),third);
  assert.equal(await text(),second+'，补充');
  await page.locator('#save').click();
  await page.waitForTimeout(400);
  assert.equal(await readFile(target,'utf8'),third);
  checks.push('restored-document-keeps-conflict-protection');
  await killTree();
 });

 assert.deepEqual(errors,[]);
} catch (error) {
 if(page && !page.isClosed())await page.screenshot({path:join(output,'failure-'+(scenario||'setup')+'.png')}).catch(()=>{});
 if(failures[failures.length-1]!==scenario)failures.push(scenario||'setup');
 console.error(String(error?.stack||error));
} finally {
 await cleanupApp();
 const result={passed:failures.length===0,checks,failures,errors,scenarios,scope:'Actual Electron app; normal-close and relaunch flows; dialog buttons supplied by QA harness; physical IME not exercised.'};
 await writeFile(join(output,'session-restore.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:result.passed,checks,failures,output}));
 if(failures.length)process.exitCode=1;
 await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
