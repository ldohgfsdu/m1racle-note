import {launchApp,createReporter,sleep} from './input-helpers.mjs';
import {resolve,join} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Floating toolbar positioning contract (real Electron, REAL mouse drag selection, silent harness).
// Contract: selection is the anchor; above with small gap, else below; horizontal only clamped to the
// viewport; never covers the selection; adjacent-text overlap is recorded but is NEVER a reason to move away.
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/toolbar-reposition/raw');
const shots=process.env.NOTE_QA_SHOTS||resolve('docs/reviews/toolbar-reposition/screens');
const TAG=process.env.NOTE_QA_TAG||'';
const MAX_GAP=16;
const R=createReporter('toolbar-reposition-ui');
const long='这是一个很长的段落用来测试多行选区的定位策略 long paragraph wraps across several visual lines so that multi line selections can be made with the real mouse path. '.repeat(4);
const filler=Array.from({length:30},(_,i)=>`填充段落 ${i} filler paragraph ${i}。`).join('\n\n');
const raw=`# 标题 Heading\n\n第一段：alpha beta gamma delta。\n\n第二段 second paragraph here。\n\n${long}\n\n${filler}\n\n最后一行 last line。\n`;
const rows=[];
const measure=(page)=>page.evaluate(()=>{
 const menu=document.querySelector('#selection-menu');if(!menu||menu.hidden)return {hidden:true};
 const view=document.querySelector('.cm-content').cmTile.root.view,sel=view.state.selection.main;
 const rc=r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom});
 const m=rc(menu.getBoundingClientRect()),sc=rc(view.scrollDOM.getBoundingClientRect());
 const selRects=[...document.querySelectorAll('.cm-selectionBackground')].map(e=>rc(e.getBoundingClientRect())).filter(r=>r.right-r.left>1);
 const inter=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
 const dist=(a,b)=>Math.hypot(Math.max(0,a.left-b.right,b.left-a.right),Math.max(0,a.top-b.bottom,b.top-a.bottom));
 let nearest=null;for(const r of selRects){const d=dist(m,r);if(!nearest||d<nearest.d)nearest={d,r};}
 const xo=nearest?Math.max(0,Math.min(m.right,nearest.r.right)-Math.max(m.left,nearest.r.left)):0;
 let adjacent=0;
 for(const line of document.querySelectorAll('.cm-line')){
  const l=view.state.doc.lineAt(view.posAtDOM(line));if(sel.from<=l.to&&sel.to>=l.from)continue;
  const range=document.createRange();range.selectNodeContents(line);
  for(const c of range.getClientRects())if(c.width>1&&c.height>1&&line.textContent.trim()&&inter(m,rc(c))>1)adjacent++;
 }
 const bold=menu.querySelector('[data-selection-format="bold"]').getBoundingClientRect();
 const last=selRects.at(-1)||{right:0,top:0,bottom:0};
 return {hidden:false,menu:m,scroll:sc,win:{w:innerWidth,h:innerHeight},selRects:selRects.length,
  selCover:selRects.reduce((s,r)=>s+inter(m,r),0),gap:nearest?nearest.d:null,xOverlap:xo,side:nearest&&m.bottom<=nearest.r.top+1?'above':'below',
  adjacentTextRectsCovered:adjacent,boldCenter:{x:(bold.left+bold.right)/2,y:(bold.top+bold.bottom)/2},selEnd:{x:last.right,y:(last.top+last.bottom)/2}};
});
const lineEnds=(t,from)=>t.page.locator('.cm-content').evaluate((e,from)=>{const v=e.cmTile.root.view;const top0=v.coordsAtPos(from).top;let p=from;while(v.coordsAtPos(p+1)&&Math.abs(v.coordsAtPos(p+1).top-top0)<3)p++;return p;},from);
async function drag(t,a,b){const pa=await t.pos(a),pb=await t.pos(b);await t.page.mouse.move(pa.x+1,pa.y);await t.page.mouse.down();await t.page.mouse.move(pb.x+1,pb.y,{steps:6});await t.page.mouse.up();}
const scenarios=[
 {id:'S1-user-screenshot-left-of-first-paragraph',sel:()=>[raw.indexOf('第一段'),raw.indexOf('第一段')+3]},
 {id:'S2-right-end-of-wrapped-line',sel:async t=>{const s=raw.indexOf('这是一个很长');const e=await lineEnds(t,s);return [e-5,e];}},
 {id:'S3-top-heading-line',sel:()=>[raw.indexOf('标题'),raw.indexOf('标题')+2]},
 {id:'S4-multi-line',sel:async t=>{const s=raw.indexOf('这是一个很长')+10;const e=await lineEnds(t,s);return [s,e+30];}},
 {id:'S5-cross-paragraph',sel:()=>[raw.indexOf('alpha'),raw.indexOf('second')+6]},
 {id:'S6-bottom-last-line',scroll:'end',sel:()=>[raw.indexOf('最后一行'),raw.indexOf('最后一行')+4]},
 {id:'S7-scrolled-middle',scroll:'mid',sel:async t=>{const s=raw.indexOf('填充段落 15');return [s,s+5];}},
 {id:'S8-narrow-window',size:[722,760],sel:()=>[raw.indexOf('第一段'),raw.indexOf('第一段')+3]},
 {id:'S9-zoom-150',zoom:1.5,sel:()=>[raw.indexOf('第一段'),raw.indexOf('第一段')+3]},
 {id:'S10-keyboard-selection',keyboard:true,sel:()=>[raw.indexOf('第一段'),raw.indexOf('第一段')+3]},
];
for(const theme of ['light','dark']) {
 const t=await launchApp({raw,name:'reposition.md'});
 try{
  const {page,app}=t;
  const dark=await page.evaluate(()=>document.documentElement.classList.contains('dark'));
  if((theme==='dark')!==dark)await page.locator('#theme').click();
  for(const sc of scenarios){
   await R.check(`${theme}:${sc.id}`,async()=>{
    await app.evaluate(({BrowserWindow},[w,h,z])=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(w,h);win.webContents.setZoomFactor(z);},[...(sc.size||[1180,820]),sc.zoom||1]);
    await sleep(400);
    await page.evaluate(sel=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:0}});},0);
    await page.evaluate(m=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.scrollDOM.scrollTop=m==='end'?1e9:m==='mid'?v.scrollDOM.scrollHeight/2-200:0;},sc.scroll||'top');
    await sleep(300);
    const [a,b]=await sc.sel(t);
    await page.evaluate(a=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:a},scrollIntoView:true});},a);await sleep(300);
    if(sc.keyboard){await t.select(a);await page.keyboard.down('Shift');for(let i=0;i<b-a;i++)await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');}
    else await drag(t,a,b);
    await sleep(500);
    const scrollBefore=(await t.state()).scrollTop;
    const m=await measure(page);m.selText=await page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view,s=v.state.selection.main;return v.state.sliceDoc(s.from,s.to).slice(0,30);});
    await mkdir(shots,{recursive:true});await page.screenshot({path:join(shots,`${theme}-${sc.id}${TAG}.png`)});
    const travel=m.hidden?null:Math.round(Math.hypot(m.boldCenter.x-m.selEnd.x,m.boldCenter.y-m.selEnd.y));
    const row={theme,id:sc.id,selText:m.selText,...(m.hidden?{hidden:true}:{menu:m.menu,gap:+m.gap?.toFixed(1),xOverlap:Math.round(m.xOverlap),side:m.side,selCover:Math.round(m.selCover),adjacentCovered:m.adjacentTextRectsCovered,mouseTravelToBold:travel})};
    rows.push(row);console.log('ROW',JSON.stringify(row));
    assert.equal(m.hidden,false,'toolbar visible');
    assert.ok(m.selCover<=1,'toolbar covers selected text: '+m.selCover);
    assert.ok(m.menu.left>=0&&m.menu.right<=m.win.w&&m.menu.top>=m.scroll.top-1&&m.menu.bottom<=m.win.h,'inside viewport '+JSON.stringify(m.menu));
    assert.ok(m.gap<=MAX_GAP,`toolbar detached from selection: gap ${m.gap}px > ${MAX_GAP}`);
    assert.ok(m.xOverlap>0,`toolbar horizontally unrelated to selection (overlap ${m.xOverlap})`);
    // real mouse: bold, then continue writing
    const before=await t.doc();
    if(sc.id.includes('cross-paragraph')){ // block-spanning selection: bold is intentionally unavailable; use the copy button instead
     const full=await page.evaluate(()=>{const v=document.querySelector('.cm-content').cmTile.root.view,s=v.state.selection.main;return v.state.sliceDoc(s.from,s.to);});
     await page.locator('#selection-menu [data-selection-command=copy]').click();await sleep(200);assert.equal(await t.getClipboard(),full.replace(/\r/g,''));
    } else {
     await page.mouse.click(m.boldCenter.x,m.boldCenter.y);await sleep(200);
     const after=await t.doc();assert.notEqual(after,before,'bold applied');
     assert.equal(after.length-before.length,4,'bold adds exactly ** **');
    }
    await page.keyboard.press('Control+End');await page.keyboard.type('续写');
    assert.ok((await t.doc()).endsWith('续写'),'can continue writing');
    for(let i=0;i<4;i++){await page.keyboard.press('Control+z');}
    const st=await t.state();assert.equal(st.scrollTop>=0,true);
    await t.page.evaluate(()=>0);
    // restore doc exactly for the next scenario
    await page.evaluate(raw=>{const v=document.querySelector('.cm-content').cmTile.root.view;if(v.state.doc.toString()!==raw)v.dispatch({changes:{from:0,to:v.state.doc.length,insert:raw}});},raw);
   });
  }
 for(const hs of [{id:'H1-heading-menu-after-left-selection',sel:()=>[raw.indexOf('第一段'),raw.indexOf('第一段')+3]},{id:'H2-heading-menu-at-bottom',scroll:'end',sel:()=>[raw.indexOf('最后一行'),raw.indexOf('最后一行')+4]}]) {
  await R.check(`${theme}:${hs.id}`,async()=>{
   const {page,app}=t;
   await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1180,820);win.webContents.setZoomFactor(1);});await sleep(400);
   await page.evaluate(m=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:0}});v.scrollDOM.scrollTop=m==='end'?1e9:0;},hs.scroll||'top');await sleep(300);
   const [a,b]=hs.sel();await page.evaluate(a=>{const v=document.querySelector('.cm-content').cmTile.root.view;v.dispatch({selection:{anchor:a},scrollIntoView:true});},a);await sleep(300);
   await drag(t,a,b);await sleep(500);
   const before=await t.doc();
   const trigger=page.locator('#selection-menu [data-selection-submenu]').first();
   await trigger.click();await sleep(300);
   const g=await page.evaluate(()=>{const r=e=>{const b=e.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom}};
    const menu=document.querySelector('#selection-menu'),trg=menu.querySelector('[data-selection-submenu][aria-expanded=true]'),panel=document.getElementById(trg.getAttribute('aria-controls'));
    const v=document.querySelector('.cm-content').cmTile.root.view;
    const selRects=[...document.querySelectorAll('.cm-selectionBackground')].map(e=>r(e));
    return {trg:r(trg),panel:r(panel),hidden:panel.hidden,win:[innerWidth,innerHeight],selRects};});
   const dist=(x,y)=>Math.hypot(Math.max(0,x.left-y.right,y.left-x.right),Math.max(0,x.top-y.bottom,y.top-x.bottom));
   const row={theme,id:hs.id,triggerToPanelDistance:+dist(g.trg,g.panel).toFixed(1),panel:g.panel,trg:g.trg};rows.push(row);console.log('ROW',JSON.stringify(row));
   assert.equal(g.hidden,false,'panel open');
   const cover=g.selRects.reduce((sum,r)=>sum+Math.max(0,Math.min(g.panel.right,r.right)-Math.max(g.panel.left,r.left))*Math.max(0,Math.min(g.panel.bottom,r.bottom)-Math.max(g.panel.top,r.top)),0);assert.ok(cover<=1,'heading panel covers selected text: '+cover);
   assert.ok(g.panel.left>=0&&g.panel.right<=g.win[0]&&g.panel.top>=0&&g.panel.bottom<=g.win[1],'panel inside window');
   assert.ok(row.triggerToPanelDistance<=16,'heading menu is anchored to its own trigger button: '+row.triggerToPanelDistance);
   assert.equal(await t.doc(),before,'opening the menu does not edit');
   const first=page.locator('#selection-menu .selection-options:not([hidden]) button').first();await first.click();await sleep(300);
   await page.keyboard.press('Control+z');await sleep(100);
   await page.evaluate(raw=>{const v=document.querySelector('.cm-content').cmTile.root.view;if(v.state.doc.toString()!==raw)v.dispatch({changes:{from:0,to:v.state.doc.length,insert:raw}});},raw);
  });
 } }finally{await t.app.close().catch(()=>{});}
}
await mkdir(output,{recursive:true});await writeFile(join(output,`toolbar-reposition-rows${TAG}.json`),JSON.stringify(rows,null,2));
await R.finish(output);