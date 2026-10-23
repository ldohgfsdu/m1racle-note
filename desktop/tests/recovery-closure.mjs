import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

// Batch 2A review closure: adversarial draft-lifecycle checks beyond the
// acceptance suite. Each scenario runs against a private profile. Every
// scenario records the process/profile state before and after, and failures
// keep a screenshot plus the full scenario log.
const dir=await mkdtemp(join(tmpdir(),'note-recovery-closure-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-recovery-closure-evidence-'));await mkdir(output,{recursive:true}).catch(()=>{});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY || resolve('desktop/main.mjs');
const checks=[],errors=[],failures=[],scenarios=[],killModes=[];
let app=null,page=null,scenario='';
process.on('unhandledRejection',error=>{errors.push(`${scenario}: unhandled ${error?.message || error}`);});
const sleep=ms=>new Promise(resolveSleep=>setTimeout(resolveSleep,ms));
const textOn=target=>target.locator('.cm-content').evaluate(element=>element.cmTile.root.view.state.doc.toString());
const text=()=>textOn(page);
const exists=async file=>{try{await stat(file);return true;}catch{return false;}};
const draftFiles=profile=>readdir(join(profile,'recovery')).catch(()=>[]).then(names=>names.filter(name=>name.endsWith('.json')));
const draftFile=(profile,id)=>join(profile,'recovery',id+'.json');
const waitDraft=async profile=>expect.poll(()=>draftFiles(profile),{timeout:5000}).not.toHaveLength(0);
const waitNoDraft=async profile=>expect.poll(()=>draftFiles(profile),{timeout:5000}).toHaveLength(0);
const seedDraft=async(profile,{id,path='',raw,base,updatedAt=Date.now()})=>{
 await mkdir(join(profile,'recovery'),{recursive:true});
 await writeFile(draftFile(profile,id),JSON.stringify({version:1,id,path,raw,...(typeof base==='string'?{base}:{}),updatedAt}));
};
const sha256=value=>createHash('sha256').update(value).digest('hex');
const ps=script=>execFileSync('powershell',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
const descendants=pid=>{
 const out=ps(`$all=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId); $result=@(); $queue=@(${pid}); while($queue.Count){ $current=$queue[0]; $queue=@($queue | Select-Object -Skip 1); foreach($child in $all){ if($child.ParentProcessId -eq $current){ $result+=([int]$child.ProcessId); $queue+=([int]$child.ProcessId) } } }; if($result.Count){$result -join ','}`);
 return out?out.split(',').map(Number):[];
};
const alive=pids=>{
 if(!pids.length)return [];
 const out=ps(`$ids=${pids.join(',')}; @(Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object {$_.ProcessName -eq 'electron'} | ForEach-Object {$_.Id}) -join ','`);
 return out?out.split(',').map(Number):[];
};
const machineState=async profile=>{
 try{return {electronProcessCount:Number(ps('@(Get-Process electron -ErrorAction SilentlyContinue).Count')) || 0,singleton:(await readdir(profile)).filter(name=>/singleton|lock/i.test(name))};}
 catch{return {note:'profile-not-readable'};}
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
// The suite kills the whole process tree the way a real crash does; the
// single-mode launcher below the suite documents why (orphaned helpers keep
// the Chromium profile singleton and the next launch then quits immediately).
const killTree=async()=>{try{execFileSync('taskkill',['/PID',String(app.process().pid),'/T','/F'],{stdio:'ignore'});}catch{}await sleep(500);app=null;page=null;};
const killMainOnly=async()=>{const pid=app.process().pid;execFileSync('taskkill',['/PID',String(pid),'/F'],{stdio:'ignore'});app=null;page=null;return pid;};
const closeNormally=async()=>{const proc=app.process();const closed=app.waitForEvent('close',{timeout:15000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;app=null;page=null;return proc.exitCode;};
const choice=async(type,value)=>app.evaluate((_electron,{type,value})=>globalThis.noteQaDialogs[type].push(value),{type,value});
const cleanupApp=async()=>{if(app){await killTree().catch(()=>{app=null;page=null;});}};

const runScenario=async(name,run)=>{
 scenario=name;const profile=join(dir,name);const started=Date.now();
 const record={scenario:name,profile,status:'passed',milliseconds:0};
 try{await mkdir(profile,{recursive:true}).catch(()=>{});record.pre=await machineState(profile);await run(profile);}
 catch(error){record.status='failed';record.error=String(error?.stack||error);failures.push(name);if(page&&!page.isClosed())await page.screenshot({path:join(output,'failure-'+name+'.png')}).catch(()=>{});}
 finally{record.milliseconds=Date.now()-started;record.post=await machineState(profile);scenarios.push(record);await cleanupApp();}
};

try {
 await runScenario('interleaved-write-and-clear-keeps-user-choice',async profile=>{
  // A discard issued after an in-flight snapshot must be the final state: no
  // resurrection of content the user removed.
  const id='abababab-1111-1111-1111-111111111111';
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toBeVisible();
  await page.evaluate(async id=>{await Promise.all([window.desktop.request('draft-write',{id,path:'',raw:'x'.repeat(8_000_000)}),window.desktop.request('draft-clear',{id})]);},id);
  await expect.poll(()=>exists(draftFile(profile,id)),{timeout:3000}).toBe(false);
  checks.push('interleaved-write-and-clear-keeps-user-choice');
  await killTree();
 });

 await runScenario('same-document-snapshots-apply-in-order',async profile=>{
  // Successive snapshots of one document must land in request order even when
  // the earlier payload is much heavier than the later one.
  const id='babababa-2222-2222-2222-222222222222';
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toBeVisible();
  await page.evaluate(async id=>{await Promise.all([window.desktop.request('draft-write',{id,path:'',raw:'甲'.repeat(4_000_000)}),window.desktop.request('draft-write',{id,path:'',raw:'尾段内容'})]);},id);
  await expect.poll(()=>readFile(draftFile(profile,id),'utf8').then(value=>JSON.parse(value).raw).catch(()=>null),{timeout:5000}).toBe('尾段内容');
  checks.push('same-document-snapshots-apply-in-order');
  await killTree();
 });

 await runScenario('cross-window-claim-rejected-and-draft-preserved',async profile=>{
  // Two windows may both list the same draft; only the first restore may claim
  // it, and the loser sees the reason without losing the snapshot.
  const id='cccccccc-1111-2222-3333-444444444444';
  await seedDraft(profile,{id,raw:'跨窗草稿'});
  const launched=await launch(profile);app=launched.app;page=launched.page;
  const pageA=page;
  await expect(pageA.locator('#recovery')).toBeVisible();
  await pageA.evaluate(()=>window.desktop.request('new-window'));
  const pageB=await app.waitForEvent('window',{timeout:15000});
  pageB.on('pageerror',error=>errors.push(`${scenario}: ${error.message}`));
  pageB.on('console',event=>{if(event.type()==='error')errors.push(`${scenario}: ${event.text()}`);});
  await expect(pageB.locator('#recovery')).toBeVisible({timeout:10000});
  await pageA.locator('.recovery-restore').click();
  await expect(pageA.locator('#recovery')).toBeHidden();
  assert.equal(await textOn(pageA),'跨窗草稿');
  await pageB.locator('.recovery-restore').click();
  await expect(pageB.locator('#error')).toBeVisible({timeout:5000});
  await expect(pageB.locator('#error-message')).toContainText('另一个窗口');
  assert.notEqual(await textOn(pageB),'跨窗草稿');
  assert.equal((await draftFiles(profile)).length,1);
  await pageB.locator('.recovery-discard').click();
  await expect(pageB.locator('.recovery-hint')).toContainText('另一个窗口',{timeout:5000});
  await expect(pageB.locator('#recovery')).toBeVisible();
  assert.equal((await draftFiles(profile)).length,1);
  page=pageA;
  checks.push('cross-window-claim-rejected-and-draft-preserved');
  await killTree();
 });

 await runScenario('stale-offer-surfaces-when-draft-vanished',async profile=>{
  // If the snapshot disappears between listing and restore, the ui must say so
  // and must not load placeholder content as if it were a draft.
  const id='dddddddd-1111-2222-3333-444444444444';
  await seedDraft(profile,{id,raw:'已被删除的草稿'});
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible();
  await rm(draftFile(profile,id),{force:true});
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#error')).toBeVisible({timeout:5000});
  await expect(page.locator('#error-message')).toContainText('已不存在');
  assert.match(await text(),/留一点空间/);
  await page.locator('.recovery-discard').click();
  await expect(page.locator('#recovery')).toBeHidden();
  checks.push('stale-offer-surfaces-when-draft-vanished');
  await killTree();
 });

 await runScenario('blocked-recovery-path-lists-safely-and-surfaces-write-failure',async profile=>{
  // A recovery path occupied by a plain file must neither crash the listing
  // nor silently pretend snapshots are being written.
  await writeFile(join(profile,'recovery'),'occupied');
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'欢迎.md'}).waitFor();
  await expect(page.locator('#recovery')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');await page.keyboard.insertText('恢复目录被占用的内容');
  await expect(page.locator('#status')).toContainText('未能创建恢复副本',{timeout:5000});
  checks.push('blocked-recovery-path-lists-safely-and-surfaces-write-failure');
  await killTree();
 });

 await runScenario('continuous-typing-still-produces-snapshots',async profile=>{
  // A crash in the middle of uninterrupted typing must still find a recent
  // snapshot: the debounce alone must not starve while keys keep arriving.
  // Note: the 400ms/2s cadence is a best-effort scheduling policy, not a
  // guaranteed loss bound under abnormal termination.
  const typed='0123456789'.repeat(12);
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'欢迎.md'}).waitFor();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  const typing=page.keyboard.type(typed,{delay:60}).catch(()=>{});
  await sleep(1200);
  await expect.poll(()=>draftFiles(profile),{timeout:1200}).not.toHaveLength(0);
  await killTree();
  await typing;
  const relaunched=await launch(profile);app=relaunched.app;page=relaunched.page;
  await expect(page.locator('#recovery')).toBeVisible({timeout:5000});
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  const recovered=await text();
  assert.ok(recovered.length>=8,`recovered only ${recovered.length} characters`);
  assert.ok(typed.startsWith(recovered),`recovered text is not a prefix: ${JSON.stringify(recovered)}`);
  checks.push('continuous-typing-still-produces-snapshots');
  await killTree();
 });

 await runScenario('restore-then-immediate-save-persists-draft',async profile=>{
  // Restoring and saving without any new input must persist the draft body.
  const target=join(dir,'restore-save-target.md'),raw='恢复后立即保存的内容';
  await writeFile(target,'磁盘上的旧内容\n');
  await seedDraft(profile,{id:'eeeeeeee-1111-2222-3333-444444444444',path:target,raw,base:sha256('磁盘上的旧内容\n')});
  const launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'restore-save-target.md'}).waitFor();
  await expect(page.locator('#recovery')).toBeVisible();
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),raw);
  await page.locator('#save').click();
  await expect(page.locator('#status')).toHaveText('已保存');
  assert.equal(await readFile(target,'utf8'),raw);
  await waitNoDraft(profile);
  checks.push('restore-then-immediate-save-persists-draft');
  await killTree();
 });

 await runScenario('crash-during-recovery-offers-draft-again',async profile=>{
  // Restoring does not consume the snapshot; a crash right after restoring
  // must offer the same draft again.
  const id='ffffffff-1111-2222-3333-444444444444';
  await seedDraft(profile,{id,raw:'恢复中崩溃的内容'});
  let launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible();
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  await killTree();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible({timeout:5000});
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),'恢复中崩溃的内容');
  checks.push('crash-during-recovery-offers-draft-again');
  await killTree();
 });

 await runScenario('external-change-since-snapshot-blocks-in-place-save',async profile=>{
  // The draft was taken against an older disk state and the file changed while
  // the app was gone. Restoring must not refresh the conflict baseline: both an
  // explicit save and the auto-save after further input must refuse in place,
  // so the unseen external version survives and the draft body is preserved.
  const target=join(dir,'external-target.md'),old='磁盘旧内容\n',external='外部修改后的内容\n',raw='草稿编辑内容';
  await writeFile(target,old);
  await seedDraft(profile,{id:'99999999-1111-2222-3333-444444444444',path:target,raw,base:sha256(old)});
  await writeFile(target,external);
  const launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'external-target.md'}).waitFor();
  await expect(page.locator('#recovery')).toBeVisible();
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),raw);
  await page.waitForTimeout(1100);
  assert.equal(await readFile(target,'utf8'),external);
  await page.locator('#save').click();
  await expect(page.locator('#error')).toBeVisible({timeout:5000});
  await expect(page.locator('#error-message')).toContainText('其他程序修改');
  assert.equal(await readFile(target,'utf8'),external);
  assert.equal(await text(),raw);
  assert.equal((await draftFiles(profile)).length,1);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('，补充');
  await page.waitForTimeout(1200);
  assert.equal(await readFile(target,'utf8'),external);
  await expect(page.locator('#error')).toBeVisible();
  assert.equal(await text(),raw+'，补充');
  checks.push('external-change-since-snapshot-blocks-in-place-save');
  await killTree();
 });

 await runScenario('restore-then-switch-discard-clears-only-that-draft',async profile=>{
  // Switching documents after a restore with an explicit discard removes the
  // snapshot and the next launch offers nothing.
  await seedDraft(profile,{id:'12121212-1111-2222-3333-444444444444',raw:'切换前的草稿'});
  let launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible();
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),'切换前的草稿');
  await choice('confirm',{response:2});
  await page.locator('#app-menu summary').click();
  await page.locator('#app-menu .menu-items #new').click();
  await expect(page.locator('#filename')).toContainText('未命名.md');
  await waitNoDraft(profile);
  await killTree();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename').filter({hasText:'欢迎.md'})).toBeVisible();
  await expect(page.locator('#recovery')).toBeHidden();
  checks.push('restore-then-switch-discard-clears-only-that-draft');
  await killTree();
 });

 await runScenario('kill-modes-and-profile-lock-state',async profile=>{
  // Distinguish the three termination modes used by this suite and expose the
  // orphaned-helper behavior of a main-process-only kill.
  let launched=null;
  for(let attempt=0;attempt<2;attempt++){
   launched=await launch(profile);app=launched.app;page=launched.page;
   await page.locator('#filename').filter({hasText:'欢迎.md'}).waitFor();
   const children=descendants(app.process().pid);
   await killMainOnly();
   await sleep(1500);
   const survivors=alive(children);
   killModes.push({mode:'main-only',attempt,children:children.length,survivors:survivors.length});
   for(const pid of survivors)try{execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{stdio:'ignore'});}catch{}
   await sleep(800);
   if(survivors.length)break;
  }
  launched=await launch(profile);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'欢迎.md'}).waitFor();
  const treeChildren=descendants(app.process().pid);
  await killTree();
  await sleep(800);
  assert.deepEqual(alive(treeChildren),[]);
  killModes.push({mode:'tree',children:treeChildren.length,survivors:0});
  launched=await launch(profile);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'欢迎.md'}).waitFor();
  const exitCode=await closeNormally();
  killModes.push({mode:'normal-close',exitCode});
  assert.equal(exitCode,0);
  checks.push('kill-modes-and-profile-lock-state');
 });

 await runScenario('crash-then-external-change-refuses-in-place-save',async profile=>{
  // Final gate R1: real crash, then an external program replaces the file, then
  // recovery. The snapshot must carry the bytes it was based on so that saving
  // the restored draft (explicitly or via auto-save) can never silently
  // overwrite the unseen external version; save-as remains the way out.
  const target=join(dir,'gate-target.md'),first='原始内容 A\n',typed='，未保存的编辑 B',external='外部程序写入的 C\n',rescued=join(dir,'gate-rescued.md');
  await writeFile(target,first);
  let launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'gate-target.md'}).waitFor();
  await rm(target,{force:true});
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(typed);
  await waitDraft(profile);
  const id=(await draftFiles(profile))[0].replace(/\.json$/,'');
  const snapshot=JSON.parse(await readFile(draftFile(profile,id),'utf8'));
  assert.equal(snapshot.raw,first+typed);
  assert.equal(snapshot.base,sha256(first));
  await killTree();
  await writeFile(target,external);
  launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible({timeout:5000});
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),first+typed);
  assert.equal(await readFile(target,'utf8'),external);
  await page.locator('#save').click();
  await expect(page.locator('#error')).toBeVisible({timeout:5000});
  await expect(page.locator('#error-message')).toContainText('其他程序修改');
  await expect(page.locator('#error-save-as')).toBeVisible();
  assert.equal(await readFile(target,'utf8'),external);
  assert.equal((await draftFiles(profile)).length,1);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('，继续输入');
  await expect.poll(()=>readFile(draftFile(profile,id),'utf8').then(value=>JSON.parse(value).raw).catch(()=>null),{timeout:5000}).toBe(first+typed+'，继续输入');
  await page.waitForTimeout(1200);
  assert.equal(await readFile(target,'utf8'),external);
  await page.locator('#retry-save').click();
  await page.waitForTimeout(300);
  assert.equal(await readFile(target,'utf8'),external);
  await expect(page.locator('#error-save-as')).toBeVisible();
  await choice('save',{canceled:false,filePath:rescued});
  await page.locator('#error-save-as').click();
  await expect(page.locator('#status')).toHaveText('已保存');
  assert.equal(await readFile(rescued,'utf8'),first+typed+'，继续输入');
  assert.equal(await readFile(target,'utf8'),external);
  await waitNoDraft(profile);
  checks.push('crash-then-external-change-refuses-in-place-save');
  await killTree();
 });

 await runScenario('other-window-cannot-discard-claimed-draft',async profile=>{
  // Final gate R2: once one window has restored a draft, another window's
  // discard must be rejected; the recovery copy stays until the claiming window
  // saves, discards it itself, or the process dies.
  const target=join(dir,'claim-target.md'),first='初始内容\n',typed='，A 窗编辑',continued='，继续';
  await writeFile(target,first);
  let launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'claim-target.md'}).waitFor();
  await rm(target,{force:true});
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(typed);
  await waitDraft(profile);
  const id=(await draftFiles(profile))[0].replace(/\.json$/,'');
  await killTree();
  await writeFile(target,first);
  launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  const pageA=page;
  await expect(pageA.locator('#recovery')).toBeVisible({timeout:5000});
  await pageA.evaluate(()=>window.desktop.request('new-window'));
  const pageB=await app.waitForEvent('window',{timeout:15000});
  pageB.on('pageerror',error=>errors.push(`${scenario}: ${error.message}`));
  pageB.on('console',event=>{if(event.type()==='error')errors.push(`${scenario}: ${event.text()}`);});
  await expect(pageB.locator('#recovery')).toBeVisible({timeout:10000});
  await pageA.locator('.recovery-restore').click();
  await expect(pageA.locator('#recovery')).toBeHidden();
  assert.equal(await textOn(pageA),first+typed);
  await pageB.locator('.recovery-discard').click();
  await expect.poll(()=>exists(draftFile(profile,id)),{timeout:3000}).toBe(true);
  await expect(pageB.locator('.recovery-hint')).toContainText('另一个窗口',{timeout:5000});
  await expect(pageB.locator('#recovery')).toBeVisible();
  await rm(target,{force:true});
  await pageA.locator('.cm-content').click();await pageA.keyboard.press('Control+End');await pageA.keyboard.insertText(continued);
  await expect.poll(()=>readFile(draftFile(profile,id),'utf8').then(value=>JSON.parse(value).raw).catch(()=>null),{timeout:5000}).toBe(first+typed+continued);
  page=pageA;
  await killTree();
  await writeFile(target,first);
  launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible({timeout:5000});
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),first+typed+continued);
  checks.push('other-window-cannot-discard-claimed-draft');
  await killTree();
 });

 await runScenario('legacy-draft-without-base-refuses-in-place-save',async profile=>{
  // Snapshots from before the base-hash upgrade carry no verifiable baseline.
  // Their restore must not silently overwrite an existing original whose bytes
  // differ from the draft body: in-place save refuses, save-as remains.
  const target=join(dir,'legacy-target.md'),disk='磁盘现有内容\n',draft='旧版草稿内容',rescued=join(dir,'legacy-rescued.md');
  await writeFile(target,disk);
  await seedDraft(profile,{id:'14141414-1111-2222-3333-444444444444',path:target,raw:draft});
  const launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'legacy-target.md'}).waitFor();
  await expect(page.locator('#recovery')).toBeVisible();
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),draft);
  await page.waitForTimeout(1100);
  assert.equal(await readFile(target,'utf8'),disk);
  await page.locator('#save').click();
  await expect(page.locator('#error')).toBeVisible({timeout:5000});
  await expect(page.locator('#error-message')).toContainText('其他程序修改');
  assert.equal(await readFile(target,'utf8'),disk);
  await choice('save',{canceled:false,filePath:rescued});
  await page.locator('#error-save-as').click();
  await expect(page.locator('#status')).toHaveText('已保存');
  assert.equal(await readFile(rescued,'utf8'),draft);
  assert.equal(await readFile(target,'utf8'),disk);
  await waitNoDraft(profile);
  checks.push('legacy-draft-without-base-refuses-in-place-save');
  await killTree();
 });

 await runScenario('legacy-draft-equal-to-disk-saves-in-place',async profile=>{
  // A legacy snapshot whose body already equals the disk holds nothing the
  // file could lose, so the normal in-place save flow stays available.
  const target=join(dir,'legacy-equal.md'),body='磁盘与草稿一致\n';
  await writeFile(target,body);
  await seedDraft(profile,{id:'15151515-1111-2222-3333-444444444444',path:target,raw:body});
  const launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'legacy-equal.md'}).waitFor();
  await expect(page.locator('#recovery')).toBeVisible();
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),body);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('补充');
  await expect.poll(()=>readFile(target,'utf8'),{timeout:5000}).toBe(body+'补充');
  await expect(page.locator('#status')).toHaveText('已保存');
  await waitNoDraft(profile);
  checks.push('legacy-draft-equal-to-disk-saves-in-place');
  await killTree();
 });

 assert.deepEqual(errors,[]);
} catch (error) {
 if(page && !page.isClosed())await page.screenshot({path:join(output,'failure-'+(scenario||'setup')+'.png')}).catch(()=>{});
 if(failures[failures.length-1]!==scenario)failures.push(scenario||'setup');
 console.error(String(error?.stack||error));
} finally {
 await cleanupApp();
 const result={passed:failures.length===0,checks,failures,errors,scenarios,killModes,scope:'Actual Electron app; crash simulation by process termination; dialog buttons supplied by QA harness; physical IME not exercised.'};
 await writeFile(join(output,'recovery-closure.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:result.passed,checks,failures,output}));
 if(failures.length)process.exitCode=1;
 await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
