import {launchApp,createReporter,sleep,loneSurrogate} from './input-helpers.mjs';
import {expect} from '@playwright/test';
import {resolve} from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';

// Batch 3A editing scenarios A-E plus selection, clipboard, Unicode, Markdown
// shortcuts, focus and mode switching. Real Electron renderer, real keyboard
// and mouse events through Playwright. IME is NOT exercised here.
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/batch-3a/raw');
const R=createReporter('input-editing-ui');
const {check}=R;
const longDoc=Array.from({length:3000},(_,i)=>`第${i+1}段 Paragraph ${i+1} 含 **粗体** 与 English mixed text。`).join('\n\n')+'\n';
let originalClipboard=null;

// ---------- Scenario A: new article, continuous mixed typing ----------
{
 const t=await launchApp({raw:''});
 originalClipboard=await t.getClipboard();
 try {
  await check('A-mixed-typing-exact-and-saved',async()=>{
   await t.page.locator('.cm-content').click();
   const text='Hello 世界, this is 第一段 mixed 中英文 text 123。\n\nSecond 段落 with "quotes" 和 “中文引号”、符号 ©®™ → ✓ …';
   await t.page.keyboard.type(text,{delay:5});
   assert.equal(await t.doc(),text);await t.waitSaved(text);
  });
  await check('A-fast-typing-no-drop-no-dup',async()=>{
   const before=await t.doc();let s='';for(let i=0;i<60;i++)s+=`w${i}字${i%10} `;
   await t.page.keyboard.type(s,{delay:0});
   assert.equal(await t.doc(),before+s);await t.waitSaved(before+s);
  });
  await check('A-emoji-unicode-insert-exact',async()=>{
   const before=await t.doc(),u='😀👨‍👩‍👧 é e\u0301 مرحبا 𠮷 ①';
   await t.commit(u);assert.equal(await t.doc(),before+u);assert.ok(!loneSurrogate(await t.doc()));
   await t.waitSaved(before+u);
  });
  await check('A-backspace-removes-whole-emoji-cluster',async()=>{
   const before=await t.doc();await t.commit('😀');await t.page.keyboard.press('Backspace');
   assert.equal(await t.doc(),before);assert.ok(!loneSurrogate(await t.doc()));
   await t.commit('👨‍👩‍👧');await t.page.keyboard.press('Backspace');assert.equal(await t.doc(),before);
  });
  await check('A-enter-backspace-delete',async()=>{
   await t.page.keyboard.press('Control+End');const base=await t.doc();
   await t.page.keyboard.press('Enter');assert.equal(await t.doc(),base+'\n');
   await t.page.keyboard.press('Backspace');assert.equal(await t.doc(),base);
   await t.select(base.length-1);await t.page.keyboard.press('Delete');assert.equal(await t.doc(),base.slice(0,-1));
   await t.page.keyboard.press('Control+Z');
   await t.waitSaved(await t.doc());
  });
  await check('A-markdown-shortcuts-list-continue-bold-heading',async()=>{
   await t.select((await t.doc()).length);const b=(await t.doc());
   await t.page.keyboard.type('\n\n- 项目一');await t.page.keyboard.press('Enter');
   assert.ok((await t.doc()).endsWith('- 项目一\n- '),JSON.stringify((await t.doc()).slice(-12)));
   await t.page.keyboard.type('二');await t.page.keyboard.press('Enter');await t.page.keyboard.press('Enter');
   const d=await t.doc();assert.ok(!d.endsWith('- '),'empty list item exits list: '+JSON.stringify(d.slice(-10)));
   await t.page.keyboard.type('# 标题');assert.ok((await t.doc()).endsWith('# 标题'));
   const len=(await t.doc()).length;await t.select(len-2,len);await t.page.keyboard.press('Control+b');
   assert.ok((await t.doc()).endsWith('# **标题**'),(await t.doc()).slice(-12));
   await t.page.keyboard.press('Control+z');assert.ok((await t.doc()).endsWith('# 标题'));
   await t.waitSaved(await t.doc());
  });
 } finally {await t.close();}
}

// ---------- Scenario B: long document, insert/delete at start/middle/end ----------
{
 const t=await launchApp({raw:longDoc,name:'长文.md'});
 try {
  await check('B-start-middle-end-insert-delete-exact-and-saved',async()=>{
   let expected=longDoc;
   await t.select(0);await t.page.keyboard.type('开头插入',{delay:3});expected='开头插入'+expected;
   const mid=Math.floor(expected.length/2);await t.select(mid);
   await t.page.keyboard.type('MID中间',{delay:3});expected=expected.slice(0,mid)+'MID中间'+expected.slice(mid);
   const m=await t.state();assert.equal(m.head,mid+5,'caret after middle insert');
   await t.page.keyboard.press('Control+End');await t.page.keyboard.type('结尾追加',{delay:3});expected+='结尾追加';
   assert.equal(await t.doc(),expected);await t.waitSaved(expected);
   await t.select(0,4);await t.page.keyboard.press('Delete');expected=expected.slice(4);
   const i=expected.indexOf('MID中间');await t.select(i,i+5);await t.page.keyboard.press('Backspace');expected=expected.slice(0,i)+expected.slice(i+5);
   await t.page.keyboard.press('Control+End');for(let k=0;k<4;k++)await t.page.keyboard.press('Backspace');expected=expected.slice(0,-4);
   assert.equal(await t.doc(),expected);await t.waitSaved(expected);assert.equal(expected,longDoc);
  });
  await check('B-middle-edit-keeps-scroll-and-caret',async()=>{
   const mid=Math.floor(longDoc.length/2);await t.select(mid);
   await t.page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({effects:v.constructor.scrollIntoView(v.state.selection.main.head,{y:'center'})});});
   await sleep(300);const s0=await t.state();
   await t.page.keyboard.type('xy',{delay:20});await sleep(900);
   const s1=await t.state();assert.equal(s1.head,s0.head+2);assert.ok(Math.abs(s1.scrollTop-s0.scrollTop)<60,`scroll ${s0.scrollTop}->${s1.scrollTop}`);
   await t.page.keyboard.press('Backspace');await t.page.keyboard.press('Backspace');
   await t.waitSaved(longDoc);
  });
 } finally {await t.close();}
}

// ---------- Scenario C: mouse + keyboard selection, replace, clipboard ----------
{
 const raw='第一段：这是 alpha beta gamma 的内容。\n\n第二段 second paragraph 继续。\n\n第三段 third **bold** end。\n';
 const t=await launchApp({raw,name:'选择.md'});
 try {
  await check('C-click-places-caret-exactly',async()=>{
   for(const pos of [2,10,raw.indexOf('second')+3,raw.indexOf('third')]) {
    await t.clickAt(pos);const s=await t.state();assert.equal(s.head,pos,`click at ${pos}`);assert.equal(s.anchor,pos);
   }
  });
  await check('C-double-click-selects-word',async()=>{
   const p=raw.indexOf('beta');await t.clickAt(p+1,{clickCount:2});
   const s=await t.state(),sel=s.doc.slice(Math.min(s.anchor,s.head),Math.max(s.anchor,s.head));assert.equal(sel,'beta');
   await t.page.keyboard.type('BETA');assert.equal(await t.doc(),raw.replace('beta','BETA'));await t.page.keyboard.press('Control+z');assert.equal(await t.doc(),raw);
  });
  await check('C-triple-click-selects-line',async()=>{
   const p=raw.indexOf('second');await t.clickAt(p+2,{clickCount:3});
   const s=await t.state(),a=Math.min(s.anchor,s.head),b=Math.max(s.anchor,s.head),sel=s.doc.slice(a,b);
   assert.ok(sel.startsWith('第二段 second paragraph 继续。'),JSON.stringify(sel));assert.ok(!sel.includes('第三段')&&!sel.includes('第一段'));
  });
  await check('C-drag-selects-across-paragraphs-and-replace',async()=>{
   const a=raw.indexOf('alpha'),b=raw.indexOf('second')+6;
   const pa=await t.pos(a),pb=await t.pos(b);
   await t.page.mouse.move(pa.x+1,pa.y);await t.page.mouse.down();await t.page.mouse.move((pa.x+pb.x)/2,(pa.y+pb.y)/2,{steps:5});await t.page.mouse.move(pb.x+1,pb.y,{steps:5});await t.page.mouse.up();
   const s=await t.state();assert.equal(Math.min(s.anchor,s.head),a);assert.equal(Math.max(s.anchor,s.head),b);
   await t.page.keyboard.type('替换');
   const exp=raw.slice(0,a)+'替换'+raw.slice(b);assert.equal(await t.doc(),exp);
   await t.waitSaved(exp);
   await t.page.keyboard.press('Control+z');assert.equal(await t.doc(),raw);
  });
  await check('C-shift-arrow-and-shift-click-extend',async()=>{
   await t.select(0);await t.page.keyboard.press('Shift+ArrowRight');await t.page.keyboard.press('Shift+ArrowRight');
   let s=await t.state();assert.equal([s.anchor,s.head].join(),'0,2');
   await t.page.keyboard.down('Shift');await t.clickAt(8);await t.page.keyboard.up('Shift');
   s=await t.state();assert.equal(s.anchor,0);assert.equal(s.head,8);
  });
  await check('C-select-all-and-delete-then-undo-restores',async()=>{
   await t.focus();await t.page.keyboard.press('Control+a');await t.page.keyboard.press('Delete');assert.equal(await t.doc(),'');
   await t.page.keyboard.press('Control+z');assert.equal(await t.doc(),raw);
   await t.waitSaved(raw);
  });
  await check('C-copy-cut-paste-exact',async()=>{
   await t.setClipboard('');const a=raw.indexOf('alpha'),b=a+'alpha beta'.length;
   await t.select(a,b);await t.page.keyboard.press('Control+c');assert.equal(await t.getClipboard(),'alpha beta');assert.equal(await t.doc(),raw);
   await t.select(raw.length);await t.page.keyboard.press('Control+v');assert.equal(await t.doc(),raw+'alpha beta');
   await t.select(a,b);await t.page.keyboard.press('Control+x');assert.equal(await t.getClipboard(),'alpha beta');
   assert.equal(await t.doc(),raw.slice(0,a)+raw.slice(b)+'alpha beta');
   await t.select(a);await t.page.keyboard.press('Control+v');assert.equal(await t.doc(),raw+'alpha beta');
   await t.waitSaved(raw+'alpha beta');
  });
  await check('C-paste-markdown-newlines-unicode-exact',async()=>{
   const before=await t.doc(),clip='## 标题\r\n- a\r\n- **b** `c`\r\n\r\n> 引用 😀 é\r\n\ttab\r\n[link](http://x.y) ~~s~~ <b>x</b> 𠮷';
   await t.setClipboard(clip);await t.select(before.length);await t.page.keyboard.press('Control+v');
   const exp=before+clip.replace(/\r\n/g,'\n'),d=await t.doc();assert.equal(d,exp);assert.ok(!loneSurrogate(d));
   await t.waitSaved(exp);
   await t.select(5);await t.setClipboard('P\nQ');await t.page.keyboard.press('Control+v');
   assert.equal((await t.doc()).slice(5,8),'P\nQ');await t.page.keyboard.press('Control+z');await t.page.keyboard.press('Control+z');
  });
  await check('C-undo-then-continue-typing-redo-cleared',async()=>{
   await t.select(0);await t.page.keyboard.type('AB');await t.page.keyboard.press('Control+z');
   assert.ok(!(await t.doc()).startsWith('A'));await t.page.keyboard.type('C');
   assert.ok((await t.doc()).startsWith('C'));await t.page.keyboard.press('Control+y');assert.ok((await t.doc()).startsWith('C')&&!(await t.doc()).startsWith('CB'));
   assert.equal((await t.state()).head,1);
  });
 } finally {if(originalClipboard!==null)await t.app.evaluate(({clipboard},v)=>clipboard.writeText(v),originalClipboard).catch(()=>{});await t.close();}
}

// ---------- Scenario D: continuous typing + autosave + focus + mode switches ----------
{
 const raw='# 标题\n\n起始段落内容。\n\n结尾段落。\n';
 const t=await launchApp({raw,name:'连续.md'});
 try {
  await check('D-typing-through-autosave-focus-and-mode-switch',async()=>{
   const at=raw.indexOf('起始段落')+4;await t.select(at);
   let typed='';const events=[],trace=[];
   for(let i=0;i<24;i++) {
    const chunk=`<${i}>字${i}a `;await t.page.keyboard.type(chunk,{delay:12});typed+=chunk;{const q=await t.state();trace.push(i+':'+q.head+'/'+q.doc.length+(q.focus?'':'!nf'));}
    if(i===5||i===13) {await sleep(700);}  // let autosave fire mid-stream
    if(i===8) {const before=await t.state();await t.blur();await t.focus();const after=await t.state();events.push('blur');assert.equal(after.head,before.head,'caret after blur/focus');}
    if(i===11||i===18) {const before=await t.state();await t.page.keyboard.press('Control+e');await sleep(450);const after=await t.state();events.push('mode');assert.equal(after.head,before.head,'caret after mode switch');assert.equal(after.doc,before.doc);await t.focus();}
    if(i===20) {const before=await t.state();await t.page.locator('#code').click();await sleep(400);await t.page.locator('#read').click();await sleep(400);await t.focus();assert.equal((await t.state()).head,before.head);}
   }
   const exp=raw.slice(0,at)+typed+raw.slice(at);
   assert.equal(await t.doc(),exp,'trace '+trace.join(' '));await t.waitSaved(exp);
   assert.equal((await t.state()).head,at+typed.length);
  });
  await check('D-selection-survives-autosave',async()=>{
   const d=await t.doc();await t.select(3,9);await t.page.keyboard.type('Z');await t.page.keyboard.press('Control+z');
   await t.select(3,9);await sleep(1500);const s=await t.state();assert.equal([s.anchor,s.head].join(),'3,9');
  });
  await check('D-console-clean',async()=>assert.deepEqual(t.errors,[]));
 } finally {await t.close();}
}
// CRLF + BOM fidelity under editing
{
 const raw='\ufeff# T\r\n\r\npara one\r\n\r\npara two\r\n';
 const t=await launchApp({raw,name:'保真.md'});
 try {
  await check('D-crlf-bom-preserved-through-edit-and-mode-switch',async()=>{
   await t.select(8);await t.page.keyboard.type('X');await t.page.keyboard.press('Enter');await t.page.keyboard.press('Control+e');await sleep(300);await t.page.keyboard.type('Y');
   await t.page.keyboard.press('Control+e');await sleep(300);
   await expect.poll(()=>t.disk().then(v=>v.includes('X')&&v.includes('Y')),{timeout:6000}).toBe(true);await sleep(800);const fin=await t.disk();assert.ok(fin.startsWith('\ufeff')&&!/[^\r]\n/.test(fin.slice(1)),'mixed EOL introduced: '+JSON.stringify(fin));
   const d=await t.disk();assert.equal(d.replace(/\r\n/g,'\n'),'\ufeff'+(await t.doc()));
  });
 } finally {await t.close();}
}

// ---------- Scenario E: close, relaunch, continue writing ----------
{
 const raw='第一行。\n\n第二行内容在这里。\n\n第三行。\n';
 const t=await launchApp({raw,name:'重启.md'});
 let dir=t.dir,profile=t.profile,file=t.file,pos=0,expected='';
 try {
  await check('E-edit-close-relaunch-restores-doc-cursor-and-continues',async()=>{
   pos=raw.indexOf('内容')+2;await t.select(pos);await t.page.keyboard.type('续写');
   expected=raw.slice(0,pos)+'续写'+raw.slice(pos);pos+=2;
   await t.waitSaved(expected);await sleep(900);
   await t.app.close();
   const {launchApp:again}=await import('./input-helpers.mjs');
   const t2=await again({keepDir:dir,profile,args:[]});
   try {
    await expect.poll(()=>t2.doc(),{timeout:8000}).toBe(expected);
    const s=await t2.state();assert.equal(s.head,pos,'cursor restored');
    await t2.focus();await t2.page.keyboard.type('再续');
    const exp2=expected.slice(0,pos)+'再续'+expected.slice(pos);
    assert.equal(await t2.doc(),exp2);
    await expect.poll(()=>readFile(file,'utf8'),{timeout:6000}).toBe(exp2);
    assert.deepEqual(t2.errors,[]);
   } finally {await t2.app.evaluate(({app})=>app.exit(0)).catch(()=>{});await t2.app.close().catch(()=>{});}
  });
 } finally {await t.close();}
}
await R.finish(output,{scope:'Real Electron, real keyboard/mouse via Playwright; no physical IME'});
