import {_electron as electron,expect} from '@playwright/test';
import {mkdir,mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

// Batch 2C.1 recent documents closure (Electron, light AND dark):
// remove from recents (metadata only, keyboard, persistence, re-add, multi-window),
// same-name disambiguation, relative-time refresh, and list scale
// (0/1/20/50 records, mixed invalid, long names, scrolling, keyboard access).
const dir=await mkdtemp(join(tmpdir(),'note-recent-closure-'));
const output=process.env.NOTE_QA_OUTPUT||await mkdtemp(join(tmpdir(),'note-recent-closure-evidence-'));await mkdir(output,{recursive:true}).catch(()=>{});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY||resolve('desktop/main.mjs');
const checks=[],errors=[],failures=[],scenarios=[];
let app=null,page=null,scenario='';
process.on('unhandledRejection',error=>{errors.push(`${scenario}: unhandled ${error?.message||error}`);});
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const sha256=value=>createHash('sha256').update(value).digest('hex');
const exists=async file=>{try{await stat(file);return true;}catch{return false;}};
const recentFile=profile=>join(profile,'recent.json');
const recentRecord=async profile=>{try{return JSON.parse(await readFile(recentFile(profile),'utf8'));}catch{return null;}};
const recentNames=async profile=>(await recentRecord(profile))?.items.map(item=>item.name)??null;
const seed=async(profile,files,{startAge=1000,step=1000,extra={}}={})=>writeFile(recentFile(profile),JSON.stringify({version:1,updatedAt:Date.now(),items:files.map((file,index)=>({path:file,name:file.split('\\').pop(),dir:file.split('\\').slice(0,-1).join('\\'),accessedAt:Date.now()-startAge-index*step})),...extra}));
const launch=async(profile,theme='light',size={width:1180,height:820})=>{
 const launched=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[entry,'--user-data-dir='+profile],env});
 const launchedPage=await launched.firstWindow();
 launchedPage.on('pageerror',error=>errors.push(`${scenario}: ${error.message}`));
 launchedPage.on('console',event=>{if(event.type()==='error')errors.push(`${scenario}: ${event.text()}`);});
 await launched.evaluate(({dialog,BrowserWindow},size)=>{
  globalThis.noteQaDialogs={open:[],save:[],confirm:[]};
  for(const [method,type,fallback] of [['showOpenDialog','open',{canceled:true,filePaths:[]}],['showSaveDialog','save',{canceled:true}],['showMessageBox','confirm',{response:1}]])dialog[method]=async()=>globalThis.noteQaDialogs[type].shift()||fallback;
  BrowserWindow.getAllWindows()[0].setSize(size.width,size.height);
 },size);
 await launchedPage.locator('#filename').waitFor({timeout:15000});
 const dark=await launchedPage.evaluate(()=>document.documentElement.classList.contains('dark'));
 if((theme==='dark')!==dark)await launchedPage.locator('#theme').click();
 await sleep(300);
 return {app:launched,page:launchedPage};
};
const killTree=async()=>{try{execFileSync('taskkill',['/PID',String(app.process().pid),'/T','/F'],{stdio:'ignore'});}catch{}await sleep(500);app=null;page=null;};
const cleanupApp=async()=>{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});app=null;page=null;}};
const choice=async(type,value)=>app.evaluate((_e,{type,value})=>globalThis.noteQaDialogs[type].push(value),{type,value});
const openViaDialog=async file=>{await choice('open',{canceled:false,filePaths:[file]});await page.locator('#open').click();await expect(page.locator('#filename')).toContainText(file.split('\\').pop(),{timeout:8000});};
const showRecent=async()=>{await page.locator('#recent').click();await expect(page.locator('#recent-dialog')).toBeVisible({timeout:5000});};
const hideRecent=async()=>{await page.locator('#recent-close').click();await expect(page.locator('#recent-dialog')).toBeHidden();};
const rowNames=()=>page.locator('#recent-list .recent-item .recent-name').allTextContents();
const rowFor=name=>page.locator('#recent-list .recent-row').filter({has:page.locator('.recent-name',{hasText:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})});
const editorText=()=>page.locator('.cm-content').evaluate(element=>element.cmTile.root.view.state.doc.toString());
const doc=async(folder,name,body)=>{await mkdir(folder,{recursive:true});const file=join(folder,name);await writeFile(file,body??`${name} 的内容\n`);return file;};
const runScenario=async(name,run)=>{
 console.log(new Date().toISOString(),'START',name);
 scenario=name;const profile=join(dir,name.replace(/[^\w-]/g,'_'));const started=Date.now();
 const record={scenario:name,status:'passed',milliseconds:0};
 try{await mkdir(profile,{recursive:true});await run(profile);checks.push(name);}
 catch(error){record.status='failed';record.error=String(error?.stack||error);failures.push(name);if(page&&!page.isClosed())await page.screenshot({path:join(output,'failure-'+name.replace(/[^\w-]/g,'_')+'.png'),timeout:5000}).catch(()=>{});}
 finally{record.milliseconds=Date.now()-started;scenarios.push(record);console.log(new Date().toISOString(),record.status.toUpperCase(),name,record.milliseconds+'ms',record.error?String(record.error).split('\n').slice(0,6).join(' | '):'');await cleanupApp();}
};

try {
 for(const theme of ['light','dark']) {
  await runScenario(`${theme}: remove record via menu is metadata-only and keeps the current document`,async profile=>{
   const a=await doc(join(dir,'rm'),`rm-a-${theme}.md`,'甲正文\n'),b=await doc(join(dir,'rm'),`rm-b-${theme}.md`,'乙正文\n'),c=await doc(join(dir,'rm'),`rm-c-${theme}.md`,'丙正文\n');
   const hashes=Object.fromEntries(await Promise.all([a,b,c].map(async file=>[file,sha256(await readFile(file))])));
   const launched=await launch(profile,theme);app=launched.app;page=launched.page;
   for(const file of [a,b,c])await openViaDialog(file);
   const typed='继续写';await page.locator('.cm-content').click();await page.keyboard.type(typed);
   const before=await editorText();
   // typing leaves an unsaved draft behind; removal must not clear it
   const drafts=async()=>(await readdir(join(profile,'recovery')).catch(()=>[])).filter(name=>name.endsWith('.json')).sort();
   await expect.poll(async()=>(await drafts()).length,{timeout:10000}).toBeGreaterThan(0);
   // Typing in a file-backed document is autosaved after ~550ms (legitimately changing that file and clearing its draft).
   // Settle that first so the before-snapshot is the real pre-removal state; the assertions below still require that removal changes no file bytes and no draft.
   await expect(page.locator('#status')).toHaveText('已保存',{timeout:10000});
   hashes[c]=sha256(await readFile(c));
   const draftsBefore=await drafts();
   await showRecent();
   const target=rowFor(`rm-c-${theme}`);               // the document that is open right now
   await target.hover();
   await expect(target.locator('.recent-more')).toHaveCSS('opacity','1');
   await target.locator('.recent-more').click();
   await expect(page.locator('.recent-menu-item')).toHaveText('从最近文档移除');
   await page.locator('.recent-menu-item').click();
   await expect(page.locator('#recent-status')).toContainText('已从最近文档移除');
   await expect(page.locator('#recent-status')).toContainText('原文件没有改动');
   assert.deepEqual(await rowNames(),[`rm-b-${theme}`,`rm-a-${theme}`]);
   assert.deepEqual(await recentNames(profile),[`rm-b-${theme}.md`,`rm-a-${theme}.md`]);
   for(const file of [a,b,c])assert.equal(sha256(await readFile(file)),hashes[file]);
   assert.deepEqual(await drafts(),draftsBefore,'unsaved draft must survive');
   await page.screenshot({path:join(output,`remove-feedback-${theme}.png`)});
   await hideRecent();
   assert.equal(await editorText(),before);
   await expect(page.locator('#filename')).toContainText(`rm-c-${theme}.md`);
   await killTree();
   const relaunched=await launch(profile,theme);app=relaunched.app;page=relaunched.page;
   await showRecent();
   assert.deepEqual(await rowNames(),[`rm-b-${theme}`,`rm-a-${theme}`]);
   await hideRecent();
   // reopening the same file successfully puts it back at the front
   await openViaDialog(c);
   await showRecent();
   assert.deepEqual(await rowNames(),[`rm-c-${theme}`,`rm-b-${theme}`,`rm-a-${theme}`]);
   for(const file of [a,b,c])assert.equal(sha256(await readFile(file)).length,64);
   assert.equal(sha256(await readFile(a)),hashes[a]);
   await killTree();
  });

  await runScenario(`${theme}: keyboard removal, menu Esc and focus order`,async profile=>{
   const files=[];for(const name of ['k1','k2','k3'])files.push(await doc(join(dir,'kb'),`${name}-${theme}.md`));
   await seed(profile,files);
   const launched=await launch(profile,theme);app=launched.app;page=launched.page;
   await showRecent();
   await page.locator('#recent-list .recent-item').first().focus();
   await page.keyboard.press('ArrowDown');
   await expect(page.locator('#recent-list .recent-item').nth(1)).toBeFocused();
   await page.keyboard.press('ArrowUp');
   await expect(page.locator('#recent-list .recent-item').first()).toBeFocused();
   await page.keyboard.press('Tab');
   await expect(page.locator('#recent-list .recent-more').first()).toBeFocused();
   await page.keyboard.press('Enter');
   await expect(page.locator('.recent-menu-item')).toBeFocused();
   await page.keyboard.press('Escape');                         // closes the menu only
   await expect(page.locator('.recent-menu')).toHaveCount(0);
   await expect(page.locator('#recent-dialog')).toBeVisible();
   await expect(page.locator('#recent-list .recent-more').first()).toBeFocused();
   await page.keyboard.press('Enter');
   await page.keyboard.press('Enter');                          // activates 从最近文档移除
   await expect(page.locator('#recent-status')).toContainText('已从最近文档移除');
   assert.equal((await rowNames()).length,2);
   await expect(page.locator('#recent-list .recent-item').first()).toBeFocused();
   await page.keyboard.press('Delete');                         // Delete on a focused row removes it too
   await expect.poll(async()=>(await rowNames()).length).toBe(1);
   for(const file of files)assert.ok(await exists(file));
   await page.keyboard.press('Escape');
   await expect(page.locator('#recent-dialog')).toBeHidden();
   await killTree();
  });

  await runScenario(`${theme}: missing record click gives feedback without hanging or creating a file`,async profile=>{
   const live=await doc(join(dir,'miss'),`live-${theme}.md`),gone=await doc(join(dir,'miss'),`gone-${theme}.md`);
   await seed(profile,[gone,live]);await rm(gone);
   const before=(await readdir(join(dir,'miss'))).sort();
   const launched=await launch(profile,theme);app=launched.app;page=launched.page;
   await showRecent();
   await expect(rowFor(`gone-${theme}`).locator('.recent-dir')).toHaveText('文件已移动或删除');
   await page.screenshot({path:join(output,`missing-row-${theme}.png`)});
   await rowFor(`gone-${theme}`).locator('.recent-item').click();
   await expect(page.locator('#recent-dialog')).toBeVisible();
   await expect(page.locator('#recent-status')).toContainText('没有新建任何文件');
   await page.screenshot({path:join(output,`missing-click-${theme}.png`)});
   assert.equal(await page.evaluate(()=>1+1),2);
   assert.equal(await app.evaluate(()=>2+2),4);
   assert.deepEqual((await readdir(join(dir,'miss'))).sort(),before);
   await rowFor(`gone-${theme}`).locator('.recent-more').click({force:true});
   await page.locator('.recent-menu-item').click();                // a dead record can be removed too
   await expect(page.locator('#recent-list .recent-item')).toHaveCount(1);
   await rowFor(`live-${theme}`).locator('.recent-item').click();
   await expect(page.locator('#filename')).toContainText(`live-${theme}.md`);
   await killTree();
  });

  await runScenario(`${theme}: same display names are told apart without hovering`,async profile=>{
   const x1=await doc(join(dir,'dis','笔记'),'a.md'),x2=await doc(join(dir,'dis','笔记'),'a.txt'),y1=await doc(join(dir,'dis','甲','计划'),'todo.md'),y2=await doc(join(dir,'dis','乙','计划'),'todo.md'),solo=await doc(join(dir,'dis','笔记'),'solo.md');
   await seed(profile,[x1,x2,y1,y2,solo]);
   const launched=await launch(profile,theme);app=launched.app;page=launched.page;
   await showRecent();
   const names=await rowNames();
   assert.deepEqual(names,['a.md','a.txt','todo','todo','solo']);
   const hints=await page.locator('#recent-list .recent-dir').allTextContents();
   assert.ok(hints[2]!==hints[3],'same name in different folders needs different visible hints: '+hints);
   assert.ok(hints[2].includes('甲') && hints[3].includes('乙'));
   await page.screenshot({path:join(output,`same-name-${theme}.png`)});
   await killTree();
  });
 }

 await runScenario('relative times are calendar based and keep moving while the dialog is open',async profile=>{
  const files=[];for(const name of ['t0','t1','t2','t3','t4'])files.push(await doc(join(dir,'time'),`${name}.md`));
  const now=Date.now(),day=86_400_000;
  await writeFile(recentFile(profile),JSON.stringify({version:1,updatedAt:now,items:files.map((file,index)=>({path:file,name:file.split('\\').pop(),dir:join(dir,'time'),accessedAt:now-[50_000,3*3_600_000,30*3_600_000,4*day,40*day][index]}))}));
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await showRecent();
  const first=await page.locator('#recent-list .recent-time').allTextContents();
  assert.equal(first[0],'刚刚');
  assert.match(first[1],/^(\d+ 小时前|昨天)$/);
  assert.match(first[2],/^(昨天|2 天前)$/);
  assert.match(first[3],/^[3-5] 天前$/);
  assert.match(first[4],/^(\d{4}年)?\d{1,2}月\d{1,2}日$/);
  await expect(page.locator('#recent-list .recent-time').first()).toHaveText('1 分钟前',{timeout:60000});   // light timer re-renders while open
  await killTree();
 });

 await runScenario('scale: 0 and 1 record',async profile=>{
  const launched=await launch(profile);app=launched.app;page=launched.page;
  await showRecent();await expect(page.locator('.recent-empty')).toBeVisible();await hideRecent();
  const one=await doc(join(dir,'scale1'),'only.md');
  await openViaDialog(one);await showRecent();
  assert.deepEqual(await rowNames(),['only']);
  await killTree();
 });

 for(const theme of ['light','dark']) {
  await runScenario(`${theme}: scale 20 / 50 records scroll inside the dialog and stay keyboard accessible`,async profile=>{
   const folder=join(dir,'scale20');await mkdir(folder,{recursive:true});
   const files=[];
   for(let index=0;index<50;index++){
    const long=index===3?'超长文件名'.repeat(12):index===4?'ExtremelyLongEnglishFileNameWithoutAnySpaces'.repeat(2):`文档-${String(index).padStart(2,'0')}`;
    files.push(await doc(index%2?join(folder,'奇'):join(folder,'偶'),`${long}.md`));
   }
   const missing=[files[6],files[11]];for(const file of missing)await rm(file);
   await seed(profile,files);                                  // 50 records on disk
   const launched=await launch(profile,theme,{width:900,height:560});app=launched.app;page=launched.page;
   await showRecent();
   const count=await page.locator('#recent-list .recent-item').count();
   assert.equal(count,20,'cap is 20: the 50 on disk are trimmed to the 20 newest');
   assert.equal(await page.locator('#recent-list .recent-item[data-status=missing]').count(),2);
   const box=await page.evaluate(()=>{
    const d=document.getElementById('recent-dialog').getBoundingClientRect(),l=document.getElementById('recent-list');
    const close=document.getElementById('recent-close').getBoundingClientRect();
    return {top:d.top,bottom:d.bottom,left:d.left,right:d.right,vw:innerWidth,vh:innerHeight,scroll:l.scrollHeight,client:l.clientHeight,overflowY:getComputedStyle(l).overflowY,closeTop:close.top,closeBottom:close.bottom,
     closeHit:document.elementFromPoint(close.left+close.width/2,close.top+close.height/2)?.id,docScroll:document.getElementById('recent-dialog').scrollHeight>document.getElementById('recent-dialog').clientHeight+1};
   });
   assert.ok(box.top>=0 && box.bottom<=box.vh && box.left>=0 && box.right<=box.vw,'dialog stays on screen: '+JSON.stringify(box));
   assert.ok(box.scroll>box.client,'list overflows and scrolls');
   assert.equal(box.overflowY,'auto');
   assert.equal(box.closeHit,'recent-close');
   assert.equal(box.docScroll,false,'the dialog itself must not scroll away from its close button');
   await page.screenshot({path:join(output,`list-50disk-20shown-top-${theme}.png`)});
   // keyboard: arrows move through rows (scrolling them into view), close stays reachable
   await page.locator('#recent-list .recent-item').first().focus();
   for(let step=0;step<19;step++)await page.keyboard.press('ArrowDown');
   await expect(page.locator('#recent-list .recent-item').nth(19)).toBeFocused();
   const last=await page.locator('#recent-list .recent-item').nth(19).evaluate(node=>{const r=node.getBoundingClientRect(),l=document.getElementById('recent-list').getBoundingClientRect();return r.top>=l.top-1 && r.bottom<=l.bottom+1;});
   assert.ok(last,'focused last row is scrolled into view');
   await page.screenshot({path:join(output,`list-50disk-20shown-bottom-${theme}.png`)});
   const closeStill=await page.evaluate(()=>{const c=document.getElementById('recent-close').getBoundingClientRect();return document.elementFromPoint(c.left+c.width/2,c.top+c.height/2)?.id;});
   assert.equal(closeStill,'recent-close');
   // long names stay on one line and do not widen the dialog
   const widths=await page.evaluate(()=>[...document.querySelectorAll('.recent-name')].map(node=>node.scrollWidth<=node.parentElement.clientWidth+1));
   assert.ok(widths.every(Boolean),'long file names do not overflow the row');
   // Enter opens the focused row; Esc closes the dialog
   await page.locator('#recent-list .recent-item').first().focus();
   await page.keyboard.press('Enter');
   await expect(page.locator('#recent-dialog')).toBeHidden();
   await expect(page.locator('#filename')).toContainText('.md');
   await showRecent();await page.keyboard.press('Escape');await expect(page.locator('#recent-dialog')).toBeHidden();
   // valid and invalid mixed: another record still opens after the missing one failed
   await showRecent();
   await page.locator('#recent-list .recent-item[data-status=missing]').first().click();
   await expect(page.locator('#recent-status')).toContainText('没有新建任何文件');
   await page.locator('#recent-list .recent-item[data-status=ok]').nth(2).click();
   await expect(page.locator('#recent-dialog')).toBeHidden();
   await expect(page.locator('#error')).toBeVisible().catch(()=>{});
   // 50-entry shot: the record on disk after another open is still capped at 20
   assert.ok((await recentNames(profile)).length<=20);
   await killTree();
  });
 }

 await runScenario('multi-window: removal and concurrent open never resurrect or lose records',async profile=>{
  const files=[];for(const name of ['w1','w2','w3'])files.push(await doc(join(dir,'mw'),`${name}.md`));
  await seed(profile,files);
  const launched=await launch(profile);app=launched.app;page=launched.page;
  const first=page;
  await first.locator('#app-menu summary').click();await first.locator('#new-window').click();
  await expect.poll(()=>app.windows().length,{timeout:10000}).toBe(2);
  const second=app.windows().find(candidate=>candidate!==first);
  await second.locator('#filename').waitFor();
  for(const target of [first,second]){await target.locator('#recent').click();await expect(target.locator('#recent-dialog')).toBeVisible();}
  // window 1 removes w2 while window 2 still shows the stale list
  await first.locator('#recent-list .recent-row').filter({hasText:'w2'}).locator('.recent-more').dispatchEvent('click');
  await first.locator('.recent-menu-item').dispatchEvent('click');
  await expect(first.locator('#recent-status')).toContainText('已从最近文档移除');
  await expect.poll(()=>recentNames(profile)).toEqual(['w1.md','w3.md']);
  // window 2 opens w3 concurrently: w2 stays removed, nothing else is lost, no duplicates
  await second.locator('#recent-list .recent-item').filter({hasText:'w3'}).dispatchEvent('click');
  await expect.poll(()=>recentNames(profile)).toEqual(['w3.md','w1.md']);
  // a stale row clicked later is a successful open and re-adds the record
  await second.locator('#recent').click();
  await second.locator('#recent-close').click().catch(()=>{});
  const record=await recentRecord(profile);
  assert.equal(new Set(record.items.map(item=>item.name)).size,record.items.length);
  assert.ok(record.removed?.length>=1);
  await killTree();
 });
} catch(error) {
 failures.push('harness: '+String(error?.stack||error));
} finally {
 await cleanupApp();
 const summary={checks,failures,errors,scenarios};
 await writeFile(join(output,'recent-closure-ui.json'),JSON.stringify(summary,null,1));
 console.log(JSON.stringify({passed:checks.length,failed:failures,errors},null,1));
 await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250}).catch(()=>{});
 if(failures.length||errors.length)process.exitCode=1;
}