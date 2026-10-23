import {_electron as electron} from '@playwright/test';
import {mkdir,mkdtemp,readdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

// Batch 2C.1 P1: clicking a failed (missing / moved / replaced by a folder /
// ACL-denied / locked) recent record must never hang the window. Each
// iteration records click timings and, after the click, a main-process ping and
// a renderer round trip so a stall can be attributed to the layer that stalled:
//   main    = app.evaluate ping slow          (main thread or file wait)
//   renderer= page.evaluate round trip slow   (renderer blocked)
//   ui      = both responsive but the expected UI state never arrived
//   harness = UI state ok, only the Playwright action (click/screenshot) stalled
// Env: NOTE_QA_ITERATIONS (default 10), NOTE_QA_OUTPUT (evidence dir).
const iterations=Number(process.env.NOTE_QA_ITERATIONS||10);
const root=await mkdtemp(join(tmpdir(),'note-recent-fail-'));
const output=process.env.NOTE_QA_OUTPUT||join(root,'evidence');await mkdir(output,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY||resolve('desktop/main.mjs');
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const withTimeout=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout '+label)),ms))]);
const timed=async(label,fn,ms=5000)=>{const started=performance.now();try{await withTimeout(fn(),ms,label);return {ok:true,ms:Math.round(performance.now()-started)};}catch(error){return {ok:false,ms:Math.round(performance.now()-started),error:String(error.message||error)};}};
const kinds=['missing','moved','folder-replaces-file','acl-denied','locked'];
const results=[],errorLog=[],failures=[];
const profile=join(root,'profile');await mkdir(profile);
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[entry,'--user-data-dir='+profile],env});
const page=await app.firstWindow();
page.on('pageerror',error=>errorLog.push('pageerror: '+error.message));
page.on('console',event=>{if(event.type()==='error')errorLog.push('console: '+event.text());});
await app.evaluate(({dialog})=>{for(const method of ['showOpenDialog','showSaveDialog','showMessageBox'])dialog[method]=async()=>({canceled:true,filePaths:[],response:1});});
const writeRecent=async items=>writeFile(join(profile,'recent.json'),JSON.stringify({version:1,updatedAt:Date.now(),items:items.map((file,index)=>({path:file,name:file.split('\\').pop(),dir:file.split('\\').slice(0,-1).join('\\'),accessedAt:Date.now()-index*1000}))}));
const holdLock=file=>{
 const script=`$f=[IO.File]::Open('${file.replace(/'/g,"''")}','Open','Read','None');Write-Output READY;Start-Sleep -Seconds 120`;
 const child=spawn('powershell.exe',['-NoProfile','-Command',script],{stdio:['ignore','pipe','ignore']});
 return new Promise((done,fail)=>{child.stdout.on('data',data=>{if(String(data).includes('READY'))done(child);});child.on('error',fail);setTimeout(()=>fail(new Error('lock helper did not start')),8000);});
};
const killChild=child=>{try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{}};
const setTheme=async theme=>{const dark=await page.evaluate(()=>document.documentElement.classList.contains('dark'));if((theme==='dark')!==dark)await page.locator('#theme').click();await sleep(300);};
const user=process.env.USERNAME;
async function iteration(theme,kind,index) {
 const work=join(root,`${theme}-${kind}-${index}`);await mkdir(work);
 const target=join(work,`target-${kind}.md`),sentinel=join(work,'sentinel.md');
 await writeFile(target,'目标内容\n');await writeFile(sentinel,'哨兵内容\n');
 await writeRecent([target,sentinel]);
 let lock=null,beforeEntries=null;
 const row={theme,kind,index,steps:{}};
 try {
  if(kind==='missing')await rm(target);
  if(kind==='moved'){await mkdir(join(work,'elsewhere'));await rename(target,join(work,'elsewhere','target-moved.md'));}
  if(kind==='folder-replaces-file'){await rm(target);await mkdir(target);}
  if(kind==='acl-denied')execFileSync('icacls',[target,'/deny',`${user}:(R)`],{stdio:'ignore'});
  if(kind==='locked')lock=await holdLock(target);
  beforeEntries=(await readdir(work)).sort();
  await page.evaluate(()=>{document.getElementById('error').hidden=true;});
  row.steps.openDialog=await timed('open dialog',async()=>{await page.locator('#recent').click({timeout:4000});await page.locator('#recent-dialog').waitFor({state:'visible',timeout:4000});});
  const item=page.locator('#recent-list .recent-item').first();
  row.steps.list=await timed('list rows',async()=>{await item.waitFor({state:'visible',timeout:4000});});
  row.status=await item.getAttribute('data-status');
  const clicked=performance.now();
  // dispatch through the DOM so a Playwright actionability stall is not confused with an app stall
  row.mode=index%2===0?'playwright-click':'dom-dispatch';
  row.steps.click=await timed('row click',()=>row.mode==='playwright-click'?item.click({timeout:4000}):item.dispatchEvent('click'));
  row.steps.errorBanner=await timed('error banner',async()=>{await page.waitForFunction(()=>!document.getElementById('error').hidden,null,{timeout:4000});});
  row.errorText=await page.locator('#error-message').textContent().catch(()=>null);
  row.steps.dialogBack=await timed('dialog reopened',async()=>{await page.waitForFunction(()=>document.getElementById('recent-dialog').open,null,{timeout:4000});});
  row.sinceClickMs=Math.round(performance.now()-clicked);
  row.steps.screenshot=await timed('screenshot after click',async()=>{await page.screenshot({path:join(output,'shot-'+theme+'-'+kind+'.png'),timeout:5000});},7000);
  row.steps.mainPing=await timed('main ping',()=>app.evaluate(()=>1),2000);
  row.steps.rendererRoundTrip=await timed('renderer round trip',()=>page.evaluate(()=>1),2000);
  // recoverability: the dialog closes by button, the banner dismisses, the editor accepts input
  row.steps.closeButton=await timed('close button',async()=>{await page.evaluate(()=>document.getElementById('recent-close').click());await page.waitForFunction(()=>!document.getElementById('recent-dialog').open,null,{timeout:3000});});
  row.steps.dismissBanner=await timed('dismiss banner',async()=>{await page.evaluate(()=>document.getElementById('dismiss-error').click());await page.waitForFunction(()=>document.getElementById('error').hidden,null,{timeout:3000});});
  row.steps.reopenAndEsc=await timed('reopen and Esc',async()=>{await page.evaluate(()=>document.getElementById('recent').click());await page.waitForFunction(()=>document.getElementById('recent-dialog').open,null,{timeout:3000});await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.getElementById('recent-dialog').open,null,{timeout:3000});});
  row.steps.typing=await timed('typing',async()=>{await page.locator('.cm-content').click({timeout:3000});await page.keyboard.type('x');await page.waitForFunction(()=>document.querySelector('.cm-content').innerText.includes('x'),null,{timeout:3000});await page.keyboard.press('Backspace');});
  // another valid record still opens after the failure
  row.steps.sentinelOpens=await timed('sentinel opens',async()=>{
   await page.evaluate(()=>document.getElementById('recent').click());
   await page.waitForFunction(()=>document.getElementById('recent-dialog').open,null,{timeout:3000});
   await page.evaluate(()=>[...document.querySelectorAll('#recent-list .recent-item')].find(node=>node.dataset.path.endsWith('sentinel.md')).click());
   await page.waitForFunction(()=>document.getElementById('filename').textContent.includes('sentinel.md'),null,{timeout:4000});
  },8000);
  row.noFileCreated=JSON.stringify((await readdir(work)).sort())===JSON.stringify(beforeEntries);
 } catch(error) {row.exception=String(error.stack||error);}
 finally {
  if(lock)killChild(lock);
  if(kind==='acl-denied')try{execFileSync('icacls',[target,'/remove:d',user],{stdio:'ignore'});}catch{}
  await sleep(150);
 }
 const slow=name=>row.steps[name] && (!row.steps[name].ok);
 const bad=Object.entries(row.steps).filter(([,step])=>!step.ok).map(([name])=>name);
 row.failedSteps=bad;
 if(bad.length||row.exception||row.noFileCreated===false) {
  row.layer=slow('mainPing')?'main':slow('rendererRoundTrip')?'renderer':bad.some(name=>['errorBanner','dialogBack','list','sentinelOpens'].includes(name))?'ui':'harness';
  failures.push(`${theme}/${kind}#${index}: ${bad.join(',')||row.exception||'file created'} (${row.layer})`);
  await page.screenshot({path:join(output,`failure-${theme}-${kind}-${index}.png`),timeout:5000}).catch(()=>{});
 }
 results.push(row);
 await page.evaluate(()=>{document.getElementById('error').hidden=true;const d=document.getElementById('recent-dialog');if(d.open)d.close();}).catch(()=>{});
}
try {
 for(const theme of ['light','dark']) {
  await setTheme(theme);
  for(let index=0;index<iterations;index++)for(const kind of kinds)await iteration(theme,kind,index);
 }
} finally {
 await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});
 const stat_=(values)=>{const sorted=values.sort((a,b)=>a-b);return {n:sorted.length,min:sorted[0],median:sorted[Math.floor(sorted.length/2)],max:sorted.at(-1)};};
 const summary={iterationsPerCombination:iterations,kinds,runs:results.length,failures,pageErrors:errorLog,
  sinceClickMs:stat_(results.map(row=>row.sinceClickMs).filter(Number.isFinite)),
  mainPingMs:stat_(results.map(row=>row.steps.mainPing?.ms).filter(Number.isFinite)),
  rendererRoundTripMs:stat_(results.map(row=>row.steps.rendererRoundTrip?.ms).filter(Number.isFinite)),
  byKind:Object.fromEntries(kinds.map(kind=>[kind,{status:[...new Set(results.filter(row=>row.kind===kind).map(row=>row.status))],errorText:[...new Set(results.filter(row=>row.kind===kind).map(row=>row.errorText))]}]))};
 await writeFile(join(output,'recent-failed-click.json'),JSON.stringify({summary,results},null,1));
 console.log(JSON.stringify(summary,null,1));
 await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:250}).catch(()=>{});
 if(failures.length||errorLog.length){console.error('FAILED',failures.length,'page errors',errorLog.length);process.exitCode=1;}
}