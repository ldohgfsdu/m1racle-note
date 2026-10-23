import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,readdir,rm,unlink,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

// Batch 2A acceptance: unsaved-draft recovery across abnormal termination.
// Every scenario uses its own profile so drafts never leak between runs.
const dir=await mkdtemp(join(tmpdir(),'note-recovery-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-recovery-evidence-'));await mkdir(output,{recursive:true}).catch(()=>{});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY || resolve('desktop/main.mjs');
const checks=[],errors=[];
let app=null,page=null,scenario='';
const sleep=ms=>new Promise(resolveSleep=>setTimeout(resolveSleep,ms));
const text=()=>page.locator('.cm-content').evaluate(element=>element.cmTile.root.view.state.doc.toString());
const draftFiles=profile=>readdir(join(profile,'recovery')).catch(()=>[]).then(names=>names.filter(name=>name.endsWith('.json')));
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
// Abnormal termination the way a real crash ends the app: the whole process
// tree dies. Killing only the main process leaves orphaned helpers holding the
// Chromium profile singleton, which makes the next launch quit via
// requestSingleInstanceLock instead of starting.
const kill=async()=>{try{execFileSync('taskkill',['/PID',String(app.process().pid),'/T','/F'],{stdio:'ignore'});}catch{}await sleep(500);app=null;page=null;};
const replaceAll=async value=>{await page.locator('.cm-content').click();await page.keyboard.press('Control+a');await page.keyboard.insertText(value);};
const waitDraft=async profile=>expect.poll(()=>draftFiles(profile),{timeout:5000}).not.toHaveLength(0);
const waitNoDraft=async profile=>expect.poll(()=>draftFiles(profile),{timeout:5000}).toHaveLength(0);
const waitRemembered=async(profile,path)=>expect.poll(async()=>{try{return JSON.parse(await readFile(join(profile,'session.json'),'utf8')).path;}catch{return null;}},{timeout:5000}).toBe(path);
const closeNormally=async()=>{const closed=app.waitForEvent('close',{timeout:15000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;app=null;page=null;};
const choice=async(type,value)=>app.evaluate((_electron,{type,value})=>globalThis.noteQaDialogs[type].push(value),{type,value});

try {
 scenario='1-untitled-crash-recovery';{
  const profile=join(dir,'p1');let launched=await launch(profile);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'欢迎.md'}).waitFor();
  await replaceAll('异常退出的草稿内容');
  await waitDraft(profile);
  await kill();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible();
  await expect(page.locator('.recovery-item')).toHaveCount(1);
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),'异常退出的草稿内容');
  await expect(page.locator('#status')).toContainText('已恢复');
  assert.equal((await draftFiles(profile)).length,1);
  checks.push('untitled-draft-survives-kill-and-restores-into-editor');
  await kill();
 }

 scenario='2-named-unflushed-edit-recovery-without-overwrite';{
  const profile=join(dir,'p2'),target=join(dir,'p2-target.md'),original='原始内容\n',edited='原始内容\n编辑中的新内容';
  await writeFile(target,original);
  let launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'p2-target.md'}).waitFor();
  await unlink(target);
  await replaceAll(edited);
  await expect(page.locator('#retry-save')).toBeVisible({timeout:5000});
  await waitDraft(profile);
  await writeFile(target,original);
  await kill();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible();
  await expect(page.locator('.recovery-item')).toContainText('p2-target.md');
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),edited);
  assert.equal(await readFile(target,'utf8'),original);
  await page.waitForTimeout(900);
  assert.equal(await readFile(target,'utf8'),original);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('，继续');
  await expect.poll(()=>readFile(target,'utf8'),{timeout:5000}).toBe(edited+'，继续');
  await expect(page.locator('#status')).toHaveText('已保存');
  await waitNoDraft(profile);
  await kill();
  launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('p2-target.md');
  assert.equal(await text(),edited+'，继续');
  await waitNoDraft(profile);
  await expect(page.locator('#recovery')).toBeHidden();
  checks.push('named-draft-recovers-without-touching-original-until-user-input');
  await kill();
 }

 scenario='2b-recovery-when-target-file-missing';{
  const profile=join(dir,'p2b'),target=join(dir,'p2b-gone.md'),saved=join(dir,'p2b-saved.md');
  await writeFile(target,'原稿\n');
  let launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'p2b-gone.md'}).waitFor();
  await unlink(target);await replaceAll('文件没了也要恢复');
  await expect(page.locator('#retry-save')).toBeVisible({timeout:5000});
  await waitDraft(profile);
  await kill();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible();
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),'文件没了也要恢复');
  await choice('save',{canceled:false,filePath:saved});
  await page.locator('#save').click();
  await expect(page.locator('#status')).toHaveText('已保存');
  assert.equal(await readFile(saved,'utf8'),'文件没了也要恢复');
  checks.push('draft-recovers-when-original-file-is-missing-and-saves-under-new-name');
  await kill();
 }

 scenario='3-normal-save-leaves-no-recovery-copy';{
  const profile=join(dir,'p3'),target=join(dir,'p3-out.md');
  let launched=await launch(profile);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'欢迎.md'}).waitFor();
  await replaceAll('正常保存的内容');
  await waitDraft(profile);
  await choice('save',{canceled:false,filePath:target});
  await page.locator('#save').click();
  await expect(page.locator('#status')).toHaveText('已保存');
  await waitNoDraft(profile);
  await waitRemembered(profile,target);
  await kill();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('p3-out.md');
  assert.equal(await text(),'正常保存的内容');
  await expect(page.locator('#recovery')).toBeHidden();
  await waitNoDraft(profile);
  checks.push('normal-save-clears-draft-and-shows-no-recovery-offer');
  await kill();
 }

 scenario='4a-discard-on-close-does-not-resurrect';{
  const profile=join(dir,'p4a');
  let launched=await launch(profile);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'欢迎.md'}).waitFor();
  await replaceAll('会被放弃的内容');
  await waitDraft(profile);
  await choice('confirm',{response:2});
  await closeNormally();
  await waitNoDraft(profile);
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename').filter({hasText:'欢迎.md'})).toBeVisible();
  await expect(page.locator('#recovery')).toBeHidden();
  checks.push('explicit-discard-on-close-removes-draft-and-it-stays-gone');
  await kill();
 }

 scenario='4b-discard-in-recovery-banner-does-not-resurrect';{
  const profile=join(dir,'p4b');
  let launched=await launch(profile);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'欢迎.md'}).waitFor();
  await replaceAll('横幅里放弃');
  await waitDraft(profile);
  await kill();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible();
  await page.locator('.recovery-discard').click();
  await expect(page.locator('#recovery')).toBeHidden();
  await waitNoDraft(profile);
  await kill();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeHidden();
  checks.push('discarding-in-the-recovery-offer-removes-draft-permanently');
  await kill();
 }

 scenario='6-corrupt-and-expired-recovery-data-degrade-safely';{
  const profile=join(dir,'p6');
  await mkdir(join(profile,'recovery'),{recursive:true});
  await writeFile(join(profile,'recovery','broken.json'),'{oops');
  await writeFile(join(profile,'recovery','cccccccc-2222-3333-4444-555555555555.json'),JSON.stringify({version:1,id:'cccccccc-2222-3333-4444-555555555555',path:'',raw:'过期的草稿',updatedAt:Date.now()-8*24*60*60*1000}));
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#filename').filter({hasText:'欢迎.md'})).toBeVisible();
  await expect(page.locator('#recovery')).toBeHidden();
  await waitNoDraft(profile);
  assert.match(await text(),/留一点空间/);
  checks.push('corrupt-and-expired-drafts-are-cleaned-without-blocking-startup');
  await kill();
 }

 scenario='7-multiple-drafts-never-mismatch';{
  const profile=join(dir,'p7'),fileA=join(dir,'p7-a.md'),fileB=join(dir,'p7-b.md'),originalA='原始A\n',originalB='原始B\n';
  await writeFile(fileA,originalA);await writeFile(fileB,originalB);
  let launched=await launch(profile,[fileA]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'p7-a.md'}).waitFor();
  await unlink(fileA);await replaceAll('A的草稿');
  await expect(page.locator('#retry-save')).toBeVisible({timeout:5000});
  await waitDraft(profile);
  await writeFile(fileA,originalA);await kill();
  launched=await launch(profile,[fileB]);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'p7-b.md'}).waitFor();
  // Opening a file while A's draft survives shows A's recovery offer over the editor;
  // deferring with Esc keeps the draft and the dialog closes without touching content.
  await expect(page.locator('#recovery')).toBeVisible({timeout:5000});
  await page.keyboard.press('Escape');
  await expect(page.locator('#recovery')).toBeHidden();
  await unlink(fileB);await replaceAll('B的草稿');
  await expect(page.locator('#retry-save')).toBeVisible({timeout:5000});
  await waitDraft(profile);
  await writeFile(fileB,originalB);await kill();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible();
  await expect(page.locator('.recovery-item')).toHaveCount(2);
  await page.locator('.recovery-item').filter({hasText:'p7-a.md'}).locator('.recovery-restore').click();
  await expect(page.locator('.recovery-item').filter({hasText:'p7-a.md'})).toHaveCount(0);
  assert.equal(await text(),'A的草稿');
  await expect(page.locator('#filename')).toContainText('p7-a.md');
  assert.equal(await readFile(fileA,'utf8'),originalA);
  await choice('confirm',{response:0});
  await page.locator('.recovery-item').filter({hasText:'p7-b.md'}).locator('.recovery-restore').click();
  await expect(page.locator('.recovery-item').filter({hasText:'p7-b.md'})).toHaveCount(0);
  assert.equal(await text(),'B的草稿');
  await expect(page.locator('#filename')).toContainText('p7-b.md');
  assert.equal(await readFile(fileA,'utf8'),'A的草稿');
  assert.equal(await readFile(fileB,'utf8'),originalB);
  await expect(page.locator('#recovery')).toBeHidden();
  await page.locator('#save').click();
  await expect(page.locator('#status')).toHaveText('已保存');
  assert.equal(await readFile(fileB,'utf8'),'B的草稿');
  await waitNoDraft(profile);
  checks.push('multiple-drafts-restore-to-their-own-documents-without-cross-writes');
  await kill();
 }

 scenario='8-after-recovery-continue-save-close-restart';{
  const profile=join(dir,'p8'),target=join(dir,'p8-out.md');
  let launched=await launch(profile);app=launched.app;page=launched.page;
  await page.locator('#filename').filter({hasText:'欢迎.md'}).waitFor();
  await replaceAll('恢复后继续写');
  await waitDraft(profile);await kill();
  launched=await launch(profile);app=launched.app;page=launched.page;
  await expect(page.locator('#recovery')).toBeVisible();
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  assert.equal(await text(),'恢复后继续写');
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('，再写一点');
  await choice('save',{canceled:false,filePath:target});
  await page.locator('#save').click();
  await expect(page.locator('#status')).toHaveText('已保存');
  assert.equal(await readFile(target,'utf8'),'恢复后继续写，再写一点');
  await closeNormally();
  launched=await launch(profile,[target]);app=launched.app;page=launched.page;
  await expect(page.locator('#filename')).toContainText('p8-out.md');
  assert.equal(await text(),'恢复后继续写，再写一点');
  await expect(page.locator('#recovery')).toBeHidden();
  await waitNoDraft(profile);
  checks.push('post-recovery-edit-save-close-restart-stays-consistent');
  await kill();
 }

 assert.deepEqual(errors,[]);
 const result={passed:true,checks,errors,scope:'Actual Electron app; drafts simulated by terminating the app process; dialog buttons supplied by QA harness; physical IME not exercised.'};
 await writeFile(join(output,'recovery-ui.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,output}));
}catch(error){
  if(page && !page.isClosed())await page.screenshot({path:join(output,'failure-'+scenario+'.png')}).catch(()=>{});
  await writeFile(join(output,`failure-${scenario||'setup'}.json`),JSON.stringify({scenario,errors,error:String(error?.stack || error)},null,2)).catch(()=>{});
 throw error;
}finally {
 if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
 await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
