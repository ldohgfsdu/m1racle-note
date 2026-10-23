import {launchApp,createReporter,sleep} from './input-helpers.mjs';
import {expect} from '@playwright/test';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

// Batch 3A composition tests. EVENT-LEVEL SIMULATION ONLY: CDP
// Input.imeSetComposition / Input.insertText. Not a physical IME.
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/batch-3a/raw');
const R=createReporter('input-composition-ui');
const base='第一段文字。\n\n第二段 **粗体** 文字。\n';
const poll=(fn,exp,timeout=3000)=>expect.poll(fn,{timeout}).toBe(exp);
let t;
try {
 // C1 compose+commit in the middle of text
 t=await launchApp({raw:base});
 const mid=3;
 await R.check('sim-compose-commit-middle-exact',async()=>{
  await t.select(mid);await t.compose('nihao');
  assert.equal((await t.state()).composing,true);
  await t.commit('你好');
  const s=await t.state();assert.equal(s.doc,base.slice(0,mid)+'你好'+base.slice(mid));assert.equal(s.composing,false);
  assert.equal(s.head,mid+2);
  await t.waitSaved(s.doc);
 });
 await R.check('sim-compose-cancel-leaves-doc-unchanged',async()=>{
  const before=await t.doc();await t.select(1);await t.compose('abc');await t.compose('');
  await sleep(300);const s=await t.state();assert.equal(s.doc,before);
 });
 await R.check('sim-compose-replaces-selection',async()=>{
  const before=await t.doc();await t.select(0,3);await t.compose('wo');await t.commit('我');
  const s=await t.state();assert.equal(s.doc,'我'+before.slice(3));
 });
 // C2 autosave must not persist uncommitted preedit
 await R.check('sim-autosave-does-not-write-uncommitted-composition',async()=>{
  const committed=await t.doc();await t.waitSaved(committed);
  await t.select(2);await t.compose('pinyin');
  const seen=new Set();
  for(let i=0;i<8;i++){await sleep(250);seen.add(await t.disk());}
  const live=(await t.state()).doc;
  assert.ok(live.includes('pinyin'),'preedit visible in editor');
  assert.deepEqual([...seen],[committed],'disk must keep the last committed text while composing');
  await t.commit('拼音');
  const final=await t.doc();assert.ok(!final.includes('pinyin'));
  await t.waitSaved(final);
 });
 // C2b draft must not capture preedit
 await R.check('sim-draft-does-not-capture-uncommitted-composition',async()=>{
  const {readdir,readFile}=await import('node:fs/promises');
  await t.select(1);await t.compose('zzzdraft');await sleep(2800);
  const dir=join(t.profile,'recovery');let hit=false;
  try{for(const f of await readdir(dir))if((await readFile(join(dir,f),'utf8')).includes('zzzdraft'))hit=true;}catch{}
  assert.equal(hit,false,'recovery draft contains preedit');
  await t.compose('');
 });
 // C3 focus switch during composition: no loss, no duplication
 await R.check('sim-focus-switch-during-composition-no-dup-no-loss',async()=>{
  await t.focus();const before=await t.doc();await t.select(0);
  await t.compose('xyz');await t.blur();await sleep(300);
  const mid=await t.state();
  assert.equal(mid.composing,false);
  assert.ok(mid.doc===before||mid.doc===('xyz'+before),'blur either cancels or commits preedit exactly once: '+JSON.stringify(mid.doc.slice(0,12)));
  await t.focus();await t.commit('Q');
  const end=await t.doc();assert.equal((end.match(/Q/g)||[]).length,1);
  assert.equal((end.match(/xyz/g)||[]).length,mid.doc===before?0:1);
  await t.waitSaved(end);
 });
 // C4 Ctrl+E while composing is ignored; composition intact
 await R.check('sim-mode-shortcut-ignored-while-composing',async()=>{
  await t.focus();await t.select(0);const m0=(await t.state()).mode;
  await t.compose('shi');await t.page.keyboard.press('Control+e');await sleep(400);
  const s=await t.state();assert.equal(s.mode,m0);assert.equal(s.composing,true);
  await t.commit('是');assert.equal((await t.state()).composing,false);
  await t.page.keyboard.press('Control+e');await sleep(500);assert.notEqual((await t.state()).mode,m0);
  await t.page.keyboard.press('Control+e');await sleep(500);assert.equal((await t.state()).mode,m0);
  await t.waitSaved(await t.doc());
 });
 // C5 mode toggle control while composing: doc consistent, typing continues
 await R.check('sim-mode-toggle-click-while-composing-consistent',async()=>{
  await t.focus();await t.select(0);await t.compose('ab');
  await t.page.locator('#code').click();await sleep(500);
  const s=await t.state();
  assert.equal(s.mode,'source');assert.equal(s.composing,false);
  await t.focus();await t.commit('Z');
  const end=await t.doc();assert.equal((end.match(/Z/g)||[]).length,1);
  await t.waitSaved(end);
  await t.page.locator('#read').click();await sleep(400);
  assert.equal(await t.doc(),end);
 });
 // C6 explicit save shortcut while composing must not persist preedit
 await R.check('sim-explicit-save-shortcut-while-composing-waits-for-commit',async()=>{
  await t.focus();await t.select(0);const committed=await t.doc();await t.waitSaved(committed);
  await t.compose('savepre');
  await t.page.keyboard.press('Control+s');await sleep(700);
  const during=await t.disk();
  assert.ok(!during.includes('savepre'),'explicit save wrote preedit: '+during.slice(0,20));
  assert.equal((await t.state()).composing,true);
  await t.commit('完');await t.waitSaved(await t.doc());
  assert.ok(!(await t.doc()).includes('savepre'));
 }); await R.check('console-clean',async()=>assert.deepEqual(t.errors,[]));
} finally {await t?.close();await R.finish(output,{scope:'CDP event-level composition simulation; physical IME UNVERIFIED'});}
