import {launchApp,createReporter,sleep} from './input-helpers.mjs';
import {mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

// Batch 3A final gate, task 3: floating selection toolbar vs. selection/caret (rendered mode, light+dark).
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/batch-3a/final');await mkdir(output,{recursive:true});
const R=createReporter('input-selection-toolbar-ui');
const raw='# 选区工具栏\n\n第一段：这是 alpha beta gamma 的内容，需要选择一些文字来验证工具栏位置。\n\n第二段 second paragraph 继续，含 **粗体** 与更多文字内容用于跨段选择。\n\n第三段 third paragraph。\n';
const geom=(t)=>t.page.evaluate(()=>{
 const v=document.querySelector('.cm-content').cmTile.root.view,s=v.state.selection.main,menu=document.getElementById('selection-menu');
 const r=el=>{const b=el.getBoundingClientRect();return {l:b.left,t:b.top,r:b.right,b:b.bottom};};
 const bg=[...document.querySelectorAll('.cm-selectionBackground')].map(r);
 const a=v.coordsAtPos(s.from,1),b=v.coordsAtPos(s.to,-1);
 return {empty:s.empty,from:s.from,to:s.to,menuHidden:menu.hidden,menu:menu.hidden?null:r(menu),bg,a,b,caret:s.empty?v.coordsAtPos(s.head):null,doc:v.state.doc.sliceString(s.from,s.to)};
});
const hit=(m,x)=>m&&x&&Math.min(m.r,x.r??x.right)>Math.max(m.l,x.l??x.left)&&Math.min(m.b,x.b??x.bottom)>Math.max(m.t,x.t??x.top);
for(const theme of ['light','dark']) {
 const t=await launchApp({raw,name:'选区.md'});
 try {
  const {page}=t;await t.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));
  const dark=await page.evaluate(()=>document.documentElement.classList.contains('dark'));
  if((theme==='dark')!==dark)await page.locator('#theme').click();await sleep(300);
  const sel=async(a,b)=>{await t.select(a,b);await sleep(350);return geom(t);};
  await R.check(`${theme}-toolbar-appears-and-does-not-cover-single-line-selection`,async()=>{
   const a=raw.indexOf('alpha'),g=await sel(a,a+'alpha beta gamma'.length);
   assert.equal(g.menuHidden,false);assert.equal(g.doc,'alpha beta gamma');
   assert.ok(g.bg.length>=1,'selection highlight drawn');
   for(const x of g.bg)assert.ok(!hit(g.menu,x),'toolbar overlaps selection highlight');
   await page.screenshot({path:join(output,`toolbar-single-${theme}.png`)});
  });
  await R.check(`${theme}-highlight-matches-editor-selection-bounds`,async()=>{
   const a=raw.indexOf('alpha'),g=await sel(a,a+'alpha beta gamma'.length);
   const left=Math.min(...g.bg.map(x=>x.l)),right=Math.max(...g.bg.map(x=>x.r));
   assert.ok(Math.abs(left-g.a.left)<=3,`left ${left} vs ${g.a.left}`);assert.ok(Math.abs(right-g.b.right)<=3,`right ${right} vs ${g.b.right}`);
  });
  await R.check(`${theme}-cross-paragraph-selection-toolbar-clear-of-highlight`,async()=>{
   const a=raw.indexOf('需要选择'),b=raw.indexOf('跨段选择')+4,g=await sel(a,b);
   assert.equal(g.menuHidden,false);assert.ok(g.bg.length>=3,'multi-line highlight '+g.bg.length);
   for(const x of g.bg)assert.ok(!hit(g.menu,x),'toolbar overlaps multi-line highlight');
   await page.screenshot({path:join(output,`toolbar-cross-paragraph-${theme}.png`)});
  });
  await R.check(`${theme}-keyboard-adjust-updates-toolbar-and-selection`,async()=>{
   const a=raw.indexOf('alpha'),g0=await sel(a,a+5);
   await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');await sleep(400);
   const g1=await geom(t);assert.equal(g1.to,g0.to+2);assert.equal(g1.from,g0.from);assert.equal(g1.menuHidden,false);
   for(const x of g1.bg)assert.ok(!hit(g1.menu,x));
   assert.ok(Math.abs(Math.max(...g1.bg.map(x=>x.r))-g1.b.right)<=3);
  });
  await R.check(`${theme}-mouse-drag-hides-then-shows-and-matches`,async()=>{
   await t.clickAt(raw.indexOf('第三段')+1);await sleep(400);  // collapse first: pressing inside an existing selection starts CM's text drag-and-drop, not a new selection
   const a=raw.indexOf('beta'),b=raw.indexOf('gamma')+5,pa=await t.pos(a),pb=await t.pos(b);
   await page.mouse.move(pa.x+1,pa.y);await page.mouse.down();await page.mouse.move((pa.x+pb.x)/2,pa.y,{steps:4});
   await sleep(250);assert.equal((await geom(t)).menuHidden,true,'hidden while dragging');
   await page.mouse.move(pb.x+1,pb.y,{steps:4});await page.mouse.up();await sleep(450);
   const g=await geom(t);assert.equal(g.doc,'beta gamma');assert.equal(g.menuHidden,false);for(const x of g.bg)assert.ok(!hit(g.menu,x));
  });
  await R.check(`${theme}-collapse-click-escape-typing-close-toolbar`,async()=>{
   const a=raw.indexOf('alpha');
   await sel(a,a+5);await t.clickAt(raw.indexOf('第三段')+1);await sleep(400);let g=await geom(t);assert.equal(g.menuHidden,true);assert.equal(g.empty,true);
   g=await sel(a,a+5);assert.equal(g.menuHidden,false);await page.keyboard.press('Escape');await sleep(200);g=await geom(t);assert.equal(g.menuHidden,true);
   assert.equal(g.doc,'alpha','Escape keeps the selection');
   await sel(a,a+5);await page.keyboard.type('X');await sleep(400);g=await geom(t);assert.equal(g.menuHidden,true);
   await page.keyboard.press('Control+z');
  });
  await R.check(`${theme}-caret-not-covered-and-source-mode-has-no-toolbar`,async()=>{
   const g=await sel(raw.indexOf('alpha')+2,raw.indexOf('alpha')+2);assert.equal(g.menuHidden,true);
   await sel(raw.indexOf('alpha'),raw.indexOf('alpha')+5);await page.locator('#code').click();await sleep(500);
   assert.equal((await geom(t)).menuHidden,true);
   await page.screenshot({path:join(output,`source-mode-no-toolbar-${theme}.png`)});
   await page.locator('#read').click();await sleep(400);
  });
  await R.check(`${theme}-console-clean`,async()=>assert.deepEqual(t.errors,[]));
 } finally {await t.close();}
}
await R.finish(output,{scope:'Real Electron, Playwright mouse/keyboard; rendered-mode selection toolbar'});
