import {launchApp,createReporter,sleep} from './input-helpers.mjs';
import {resolve,join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
// REVISED (toolbar-reposition task, reason: the 3B assertion zero overlap with neighbouring text encoded the rejected policy of moving the toolbar away from the selection). New contract: adjacent-text overlap is only RECORDED (secondary goal); the toolbar must stay anchored to the selection (gap<=16px, horizontal overlap with it) and must not cover the selected text. Full geometry matrix: toolbar-reposition-ui.mjs.
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/batch-3b/raw');
const shots=process.env.NOTE_QA_SHOTS||resolve('docs/reviews/batch-3b/screens');
const R=createReporter('toolbar-obstruction-ui');
const raw='# 标题 Heading\n\n第一段：alpha beta gamma。\n\n第二段 second paragraph。\n\n## 小标题\n\n第三段 third paragraph here。\n';
// Overlap of the toolbar with any text rect of a line that does not contain the selection.
const measure=(t)=>t.page.evaluate(()=>{
  const menu=document.querySelector('#selection-menu');if(!menu||menu.hidden)return {hidden:true};
  const m=menu.getBoundingClientRect(),view=document.querySelector('.cm-content').cmTile.root.view,sel=view.state.selection.main;
  const hits=[];
  for(const line of document.querySelectorAll('.cm-line')){
    const pos=view.posAtDOM(line),l=view.state.doc.lineAt(pos);
    if(sel.from<=l.to && sel.to>=l.from)continue; // the selected line itself is allowed to be avoided only by the selection rule
    const r=document.createRange();r.selectNodeContents(line);
    for(const c of r.getClientRects()){if(c.width<1||c.height<1)continue;
      const w=Math.min(m.right,c.right)-Math.max(m.left,c.left),h=Math.min(m.bottom,c.bottom)-Math.max(m.top,c.top);
      if(w>1&&h>1&&line.textContent.trim())hits.push({line:line.textContent.slice(0,20),w:Math.round(w),h:Math.round(h)});}
  }
  return {hidden:false,rect:{top:Math.round(m.top),bottom:Math.round(m.bottom),left:Math.round(m.left),right:Math.round(m.right)},hits};
});
const cases=[['under-heading','第一段'],['middle-paragraph','second'],['under-subheading','第三段']];
for(const [id,needle] of cases){
  await R.check('toolbar-no-text-cover-'+id,async()=>{
    const t=await launchApp({raw,name:'tb.md'});
    try{
      const a=raw.indexOf(needle);await t.select(a,a+needle.length);await sleep(450);
      const r=await measure(t);assert.equal(r.hidden,false,'toolbar visible');
      await mkdir(shots,{recursive:true});await t.page.screenshot({path:join(shots,'toolbar-'+id+(process.env.NOTE_QA_TAG||'')+'.png')});
      const sel=await t.page.evaluate(()=>[...document.querySelectorAll('.cm-selectionBackground')].map(e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};}));
      const gap=Math.min(...sel.map(b=>Math.hypot(Math.max(0,r.rect.left-b.right,b.left-r.rect.right),Math.max(0,r.rect.top-b.bottom,b.top-r.rect.bottom))));
      const covered=sel.reduce((n,b)=>n+Math.max(0,Math.min(r.rect.right,b.right)-Math.max(r.rect.left,b.left))*Math.max(0,Math.min(r.rect.bottom,b.bottom)-Math.max(r.rect.top,b.top)),0);
      console.log('RECORD',id,'adjacentTextRectsCovered='+r.hits.length,'gapToSelection='+gap.toFixed(1));
      assert.ok(gap<=16,'toolbar must stay anchored to the selection, gap '+gap);
      assert.ok(covered<=1,'toolbar must not cover the selected text');
    }finally{await t.app.close().catch(()=>{});}
  });
}
await R.finish(output);