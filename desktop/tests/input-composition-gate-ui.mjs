import {launchApp,createReporter,sleep} from './input-helpers.mjs';
import {expect} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

// Batch 3A final gate: composition x autosave/draft/explicit-save semantics.
// EVENT-LEVEL SIMULATION (CDP Input.imeSetComposition / insertText); NOT a real IME.
// Each check inspects UI status text, editor document and on-disk bytes.
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/batch-3a/raw');
const R=createReporter('input-composition-gate-ui');
const base='第一段文字。\n\n第二段内容。\n';
const status=t=>t.page.locator('#status').innerText();
const draftTexts=async t=>{const dir=join(t.profile,'recovery');try{return await Promise.all((await readdir(dir)).filter(f=>f.endsWith('.json')).map(f=>readFile(join(dir,f),'utf8')));}catch{return [];}};
// Fires the real application-menu item (same IPC path as the Ctrl+S accelerator; CDP key events do not reach native accelerators).
const menuSave=t=>t.app.evaluate(({Menu,BrowserWindow})=>{const walk=items=>{for(const i of items){if(i.accelerator==='CmdOrCtrl+S'){i.click(undefined,BrowserWindow.getAllWindows()[0],undefined);return true;}if(i.submenu&&walk(i.submenu.items))return true;}return false;};return walk(Menu.getApplicationMenu().items);});
const fresh=async()=>{const t=await launchApp({raw:base});await t.focus();return t;};
const diskNever=async(t,needle,ms,step=200)=>{for(let i=0;i<ms/step;i++){const d=await t.disk();assert.ok(!d.includes(needle),`disk contained "${needle}" at +${i*step}ms`);await sleep(step);}};
let t;
try {
 t=await fresh();
 await R.check('G1-start-multiple-updates-end-then-autosave',async()=>{
  await t.select(3);
  for(const s of ['n','ni','nih','niha','nihao']){await t.compose(s);await sleep(120);}
  assert.equal((await t.state()).composing,true);
  await diskNever(t,'nihao',1500);
  assert.equal(await t.disk(),base);assert.match(await status(t),/待自动保存|自动保存/);
  await t.commit('你好');const exp=base.slice(0,3)+'你好'+base.slice(3);
  assert.equal(await t.doc(),exp);await t.waitSaved(exp);assert.equal(await status(t),'已保存');
 });
 await t.close();

 t=await fresh();
 await R.check('G2-ctrl-s-during-composition-commits-after-end',async()=>{
  await t.select(3);await t.compose('shi');assert.equal(await menuSave(t),true);await sleep(500);
  assert.equal(await t.disk(),base);assert.equal((await t.state()).composing,true);
  await t.commit('是');const exp=base.slice(0,3)+'是'+base.slice(3);
  await t.waitSaved(exp);assert.equal(await t.doc(),exp);assert.equal(await status(t),'已保存');
 });
 await t.close();

 t=await fresh();
 await R.check('G3-composition-over-3s-never-writes-preedit-and-state-is-explicit',async()=>{
  await t.select(3);await t.compose('chaoshi');
  assert.equal(await menuSave(t),true);
  await diskNever(t,'chaoshi',4600,250);          // spans the 3s wait branch + 1.5s beyond
  const s=await t.state();assert.equal(s.composing,true);assert.ok(s.doc.includes('chaoshi'),'editor keeps the preedit');
  assert.equal(await t.disk(),base,'disk keeps last committed bytes');
  const st=await status(t);assert.ok(!/已保存/.test(st),'UI must not claim saved: '+st);
  assert.ok(/暂缓|未结束|待|保存/.test(st),'UI must say save is pending/deferred: '+st);
  assert.deepEqual((await draftTexts(t)).filter(x=>x.includes('chaoshi')),[],'draft must not hold preedit');
  await t.commit('超时');const exp=base.slice(0,3)+'超时'+base.slice(3);
  await t.waitSaved(exp);assert.equal(await t.doc(),exp);assert.equal(await status(t),'已保存');
 });
 await t.close();

 t=await fresh();
 await R.check('G4-cancel-composition-not-persisted',async()=>{
  await t.select(3);await t.compose('quxiao');await sleep(800);await t.compose('');await sleep(300);
  assert.equal(await t.doc(),base);
  await diskNever(t,'quxiao',1500);assert.equal(await t.disk(),base);
  assert.equal(await status(t),'已保存');
  assert.deepEqual((await draftTexts(t)).filter(x=>x.includes('quxiao')),[]);
 });
 await t.close();

 t=await fresh();
 await R.check('G5a-focus-switch-and-mode-switch-during-composition',async()=>{
  await t.select(3);await t.compose('qie');await t.blur();await sleep(300);
  const s1=await t.state();assert.equal(s1.composing,false);
  await t.waitSaved(s1.doc);assert.equal(await t.disk(),s1.doc);assert.ok((s1.doc.match(/qie/g)||[]).length<=1);
  await t.focus();await t.select(3);await t.compose('mo');await t.page.locator('#code').click();await sleep(500);
  const s2=await t.state();assert.equal(s2.mode,'source');assert.equal(s2.composing,false);
  await t.waitSaved(s2.doc);assert.equal(await t.disk(),s2.doc);assert.ok((s2.doc.match(/mo/g)||[]).length<=1+((s1.doc.match(/mo/g)||[]).length));
 });
 await R.check('G5b-window-close-during-composition-prompts-not-silent-save',async()=>{
  await t.page.locator('#read').click();await sleep(300);await t.focus();
  const committed=await t.disk();await t.select(3);await t.compose('guan');
  await t.app.evaluate(({dialog})=>{globalThis.__prompts=0;dialog.showMessageBox=async()=>{globalThis.__prompts++;return {response:1};};});
  await t.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await sleep(4500);
  const prompts=await t.app.evaluate(()=>globalThis.__prompts);
  const d=await t.disk();
  assert.ok(!d.includes('guan')||prompts===0&&false,'preedit silently persisted on close: '+d.slice(0,20));
  assert.equal(await t.page.isClosed(),false,'window must stay open after cancelled prompt or while composition unresolved');
  await t.compose('');
 });
 await t.close();

 // G6 race: compositionend arriving right as the autosave timer fires
 t=await fresh();
 await R.check('G6-compositionend-vs-autosave-timer-race',async()=>{
  for(let round=0;round<12;round++){
   const before=await t.doc();await t.select(3);
   await t.compose('r'+round);await t.commit('字'+round);
   await sleep(round*55);                       // sweep around the 550ms timer
   await t.select(3);await t.compose('x'+round);
   await sleep(520+round*8);                    // straddle the timer fire time
   await t.commit('尾'+round);
   const exp=await t.doc();assert.ok(!/[rx]\d/.test(exp.replace(/[字尾]\d+/g,'')),'preedit letters leaked into doc: '+exp.slice(0,30));
   await t.waitSaved(exp);assert.equal(await t.disk(),exp);
  }
 });
 await t.close();

 // G7 abnormal exit during composition: 2A recovery must not offer or claim preedit as saved
 {
  const first=await launchApp({raw:base});
  await first.focus();await first.select(3);await first.compose('beng');await sleep(2800);
  const diskBefore=await first.disk();
  const pid=first.app.process().pid;
  const {execFileSync}=await import('node:child_process');
  try{execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{stdio:'ignore'});}catch{}
  await sleep(800);
  await R.check('G7-crash-during-composition-disk-and-draft-have-no-preedit',async()=>{
   assert.equal(diskBefore,base);assert.equal(await first.disk(),base);
   assert.deepEqual((await draftTexts(first)).filter(x=>x.includes('beng')),[]);
  });
  const second=await launchApp({keepDir:first.dir,profile:first.profile,args:[first.file]});
  await R.check('G7-relaunch-shows-clean-committed-document-not-claimed-saved-preedit',async()=>{
   const s=await second.state();assert.ok(!s.doc.includes('beng'));assert.equal(await second.disk(),base);
   const rec=await second.page.locator('#recovery').isVisible().catch(()=>false);
   const body=rec?await second.page.locator('#recovery').innerText():'';assert.ok(!body.includes('beng'));
  });
  await second.app.evaluate(({app})=>app.exit(0)).catch(()=>{});await second.app.close().catch(()=>{});
  t=null;
 }
} finally {await t?.close();await R.finish(output,{scope:'CDP event-level composition simulation; physical IME UNVERIFIED'});}
