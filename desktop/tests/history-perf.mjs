import {launchApp,sleep} from './input-helpers.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
// Batch 3B history/clipboard response measurements. Same method as input-perf (3A): keydown -> next rAF.
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/batch-3b/raw');await mkdir(output,{recursive:true});
const N=Number(process.env.PERF_N||20);
const unit='正文 **格式** 一 [参考](https://example.com) English mixed。保留这段文字。\n\n';
const make=chars=>'# 性能\n\n'+unit.repeat(Math.ceil(chars/unit.length));
const sizes=[{label:'5k',chars:5_000},{label:'200k',chars:200_000},{label:'1M',chars:1_000_000}];
const stat=a=>{const s=[...a].sort((x,y)=>x-y),q=p=>s[Math.min(s.length-1,Math.floor(p*s.length))];return {n:s.length,median:+q(.5).toFixed(1),p95:+q(.95).toFixed(1),max:+s.at(-1).toFixed(1)};};
const budget=50,rows=[];
for(const size of sizes){
 const raw=make(size.chars);const t=await launchApp({raw,name:`hperf-${size.label}.md`});
 try{
  const {page}=t;await sleep(800);
  await page.evaluate(()=>{window.__lat=[];const mark=e=>{const t0=e.timeStamp;requestAnimationFrame(()=>window.__lat.push(performance.now()-t0));};document.addEventListener('keydown',mark,true);window.__take=()=>window.__lat.splice(0);});
  const take=async()=>{await sleep(150);return page.evaluate(()=>window.__take());};
  const doc=()=>t.doc();
  const row={size:size.label,chars:raw.length,metrics:{}};
  const mid=Math.floor(raw.length/2);
  // N separate history groups in the middle (600ms apart), then undo xN and redo xN
  await t.select(mid);await take();
  for(let i=0;i<N;i++){await page.keyboard.type('x');await sleep(600);}
  await take();
  for(let i=0;i<N;i++){await page.keyboard.press('Control+z');await sleep(40);}
  row.metrics.undo=stat(await take());
  for(let i=0;i<N;i++){await page.keyboard.press('Control+y');await sleep(40);}
  row.metrics.redo=stat(await take());
  // cross-paragraph replace (select across a blank line) + undo
  const s=await doc();const a=s.indexOf('\n\n',mid)-3,b=a+8;
  const cross=[],crossUndo=[];
  for(let i=0;i<Math.min(N,10);i++){
   const cur=await doc(),from=cur.indexOf('\n\n',mid)-3;await t.select(from,from+8);await take();
   await page.keyboard.press('Delete');cross.push(...await take());
   await page.keyboard.press('Control+z');crossUndo.push(...await take());
  }
  row.metrics.crossParagraphDelete=stat(cross);row.metrics.crossParagraphUndo=stat(crossUndo);
  // paste (10 lines and 1 line)
  await t.app.evaluate(({clipboard})=>clipboard.writeText(Array.from({length:10},(_,i)=>`粘贴行 ${i} paste line`).join('\n')));
  const paste=[];
  for(let i=0;i<Math.min(N,10);i++){await t.select(mid);await take();await page.keyboard.press('Control+v');paste.push(...await take());await page.keyboard.press('Control+z');await take();}
  row.metrics.paste10lines=stat(paste);
  row.verdict=Object.fromEntries(Object.entries(row.metrics).map(([k,v])=>[k,v.p95<=budget?'within-budget':'over-budget']));
  rows.push(row);console.log(JSON.stringify(row));
 }finally{await t.close();}
}
await writeFile(join(output,`history-perf-${process.argv[2]||'current'}.json`),JSON.stringify({N,budgetMsP95:budget,method:'keydown timestamp -> next rAF (proxy, not hardware latency); Playwright real input; Electron on dev PC',rows},null,2));