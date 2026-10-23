import {launchApp,createReporter,sleep,loneSurrogate} from './input-helpers.mjs';
import {expect} from '@playwright/test';
import {resolve,join} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

// Batch 3B: undo/redo + selection replace + clipboard + mode-switch history contract.
// Real Electron, real keyboard/mouse (Playwright). IME cases are CDP EVENT-LEVEL SIMULATION, not a real IME.
// External rich-text applications / OS clipboard managers are NOT exercised (see MANUAL-3B-CHECK.md).
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/batch-3b/raw');
const R=createReporter('history-clipboard-ui');
const {check}=R;
const UNDO='Control+z',REDO='Control+y';
const base='# 标题\n\n第一段：alpha beta gamma。\n\n第二段 second paragraph。\n\n第三段 third **bold** end。\n';
const steps=async(t,key,expectDoc,max=40)=>{let n=0;while(n<max&&(await t.doc())!==expectDoc){await t.page.keyboard.press(key);n++;await sleep(20);}return n;};
let originalClipboard=null;
const setup=async(raw=base,name='历史.md')=>{const t=await launchApp({raw,name});await t.focus();return t;};

// ---------------- A: undo / redo ----------------
{
 const t=await setup();originalClipboard=await t.getClipboard();
 try {
  const end=base.length;
  await check('A1-continuous-typing-single-undo-then-redo',async()=>{
   await t.select(end);await t.page.keyboard.type('连续输入 hello world 你好。',{delay:8});
   const typed=await t.doc();await t.waitSaved(typed);
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base,'one undo removes the whole fast burst, not the article');
   assert.equal((await t.state()).head,end);
   await t.page.keyboard.press(REDO);assert.equal(await t.doc(),typed);assert.equal((await t.state()).head,typed.length);
   await t.waitSaved(typed);await t.page.keyboard.press(UNDO);await t.waitSaved(base);
  });
  await check('A1b-typing-pause-creates-separate-undo-groups',async()=>{
   await t.select(end);await t.page.keyboard.type('abc',{delay:8});await sleep(800);await t.page.keyboard.type('def',{delay:8});
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base+'abc');
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);
   await t.page.keyboard.press(REDO);await t.page.keyboard.press(REDO);assert.equal(await t.doc(),base+'abcdef');
   await t.page.keyboard.press(UNDO);await t.page.keyboard.press(UNDO);
  });
  await check('A2-delete-then-undo-restores-selection-and-text',async()=>{
   const a=base.indexOf('alpha'),b=a+'alpha beta'.length;await t.select(a,b);await t.page.keyboard.press('Delete');
   assert.equal(await t.doc(),base.slice(0,a)+base.slice(b));await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);
   const s=await t.state();assert.equal([Math.min(s.anchor,s.head),Math.max(s.anchor,s.head)].join(),[a,b].join(),'selection restored by undo');
   await t.page.keyboard.press(REDO);assert.equal(await t.doc(),base.slice(0,a)+base.slice(b));await t.page.keyboard.press(UNDO);
  });
  await check('A2b-repeated-backspace-grouped-and-undone-without-losing-more',async()=>{
   const p=base.indexOf('beta')+4;await t.select(p);for(let i=0;i<4;i++)await t.page.keyboard.press('Backspace');
   assert.equal(await t.doc(),base.slice(0,p-4)+base.slice(p));
   const n=await steps(t,UNDO,base);assert.equal(await t.doc(),base);assert.ok(n>=1&&n<=4,'undo steps '+n);
   await steps(t,REDO,base.slice(0,p-4)+base.slice(p));await steps(t,UNDO,base);
  });
  await check('A3-multiline-input-delete-and-undo-exact',async()=>{
   await t.select(end);await t.page.keyboard.type('L1');await t.page.keyboard.press('Enter');await t.page.keyboard.type('L2');await t.page.keyboard.press('Enter');await t.page.keyboard.type('L3');
   const typed=await t.doc();const a=typed.indexOf('L1'),s=typed.indexOf('L3')+2;
   await sleep(700);await t.select(a,s);await t.page.keyboard.press('Backspace');assert.equal(await t.doc(),typed.slice(0,a));
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),typed);
   await t.page.keyboard.press(REDO);assert.equal(await t.doc(),typed.slice(0,a));
   await t.page.keyboard.press(UNDO);await steps(t,UNDO,base);assert.equal(await t.doc(),base);
  });
  await check('A4-paste-then-undo-redo-exact',async()=>{
   await t.setClipboard('粘贴A\n粘贴B');await t.select(end);await t.page.keyboard.press('Control+v');
   assert.equal(await t.doc(),base+'粘贴A\n粘贴B');await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);
   await t.page.keyboard.press(REDO);assert.equal(await t.doc(),base+'粘贴A\n粘贴B');await t.waitSaved(base+'粘贴A\n粘贴B');
   await t.page.keyboard.press(UNDO);await t.waitSaved(base);
  });
  await check('A5-selection-replace-undo-restores-original-and-selection',async()=>{
   const a=base.indexOf('second'),b=a+'second paragraph'.length;await t.select(a,b);await t.page.keyboard.type('替换内容');
   assert.equal(await t.doc(),base.slice(0,a)+'替换内容'+base.slice(b));
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);
   const s=await t.state();assert.equal([Math.min(s.anchor,s.head),Math.max(s.anchor,s.head)].join(),[a,b].join());
   await t.page.keyboard.press(REDO);assert.equal(await t.doc(),base.slice(0,a)+'替换内容'+base.slice(b));await t.page.keyboard.press(UNDO);
  });
  await check('A6-new-branch-after-undo-drops-redo',async()=>{
   await t.select(end);await t.page.keyboard.type('旧分支');await sleep(700);await t.page.keyboard.press(UNDO);
   await t.page.keyboard.type('新分支');assert.equal(await t.doc(),base+'新分支');
   await t.page.keyboard.press(REDO);assert.equal(await t.doc(),base+'新分支','redo is empty after a new edit');
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);
  });
  await check('A7-markdown-format-one-undo-and-selection',async()=>{
   const a=base.indexOf('gamma'),b=a+5;await t.select(a,b);await t.page.keyboard.press('Control+b');
   assert.equal(await t.doc(),base.slice(0,a)+'**gamma**'+base.slice(b));
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);await t.page.keyboard.press(REDO);assert.equal(await t.doc(),base.slice(0,a)+'**gamma**'+base.slice(b));
   await t.page.keyboard.press(UNDO);
   // format then type: separate steps
   await t.select(a,b);await t.page.keyboard.press('Control+i');await t.page.keyboard.type('Z');
   await t.page.keyboard.press(UNDO);assert.ok((await t.doc()).includes('*gamma*'),'typing undone first, format kept');
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);
  });
  await check('A9-autosave-before-and-after-undo-disk-follows',async()=>{
   await t.select(end);await t.page.keyboard.type('自动保存测试');await t.waitSaved(base+'自动保存测试');
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base);await t.waitSaved(base);
   await t.page.keyboard.press(REDO);await t.waitSaved(base+'自动保存测试');
   await t.page.keyboard.press(UNDO);await t.waitSaved(base);
   // toolbar buttons
   await t.page.keyboard.type('X');await t.waitSaved(base+'X');await t.page.locator('#undo').click();await t.waitSaved(base);await t.page.locator('#redo').click();await t.waitSaved(base+'X');await t.page.locator('#undo').click();await t.waitSaved(base);
  });
  await check('A8-ime-composition-commit-undo-is-one-step-sim',async()=>{
   await t.focus();await t.select(end);for(const s of ['n','ni','nih','niha','nihao'])await t.compose(s);await t.commit('你好');
   assert.equal(await t.doc(),base+'你好');await t.waitSaved(base+'你好');
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base,'undo removes the committed word, no pinyin residue');
   await t.waitSaved(base);await t.page.keyboard.press(REDO);assert.equal(await t.doc(),base+'你好');await t.page.keyboard.press(UNDO);
  });
  await check('A-fast-repeated-edits-no-duplicate-history-records',async()=>{
   await t.select(end);await t.page.keyboard.type('x'.repeat(40),{delay:0});
   const n=await steps(t,UNDO,base);assert.equal(await t.doc(),base);assert.ok(n<=2,'fast burst undone in '+n+' steps');
   const m=await steps(t,REDO,base+'x'.repeat(40));assert.ok(m<=2);await steps(t,UNDO,base);
   await t.page.keyboard.press(UNDO);assert.equal(await t.doc(),base,'extra undo is a no-op, never eats the original');
  });
  await check('A-console-clean',async()=>assert.deepEqual(t.errors,[]));
 } finally {await t.close();}
}
await R.finish(output,{scope:'Real Electron + Playwright; IME cases are CDP event-level simulation'});
