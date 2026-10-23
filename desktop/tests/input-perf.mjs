import {launchApp,sleep} from './input-helpers.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

// Batch 3A repeatable writing-path measurements (real Electron, real key and
// mouse events via Playwright). Latency = input event timestamp -> next
// animation frame callback in the renderer (a proxy for event-to-paint, not a
// hardware latency measurement). Budgets are judgement thresholds, not gates.
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/batch-3a/raw');await mkdir(output,{recursive:true});
const N=Number(process.env.PERF_N||60);
const unit='正文 **格式** 与 [参考](https://example.com) English mixed。保留这段文字。\n\n';
const make=chars=>'# 性能\n\n'+unit.repeat(Math.ceil(chars/unit.length));
const sizes=[{label:'5k',chars:5_000},{label:'200k',chars:200_000},{label:'1M',chars:1_000_000}];
const stat=a=>{const s=[...a].sort((x,y)=>x-y),q=p=>s[Math.min(s.length-1,Math.floor(p*s.length))];return {n:s.length,median:+q(.5).toFixed(1),p95:+q(.95).toFixed(1),max:+s.at(-1).toFixed(1)};};
const budgets={input:50,middleEdit:50,click:50,selection:50,select_all:200,modeSwitch:500};
const results=[];
const install=page=>page.evaluate(()=>{
 window.__lat=[];const view=document.querySelector('.cm-content').cmTile.root.view;
 const mark=e=>{const t0=e.timeStamp;requestAnimationFrame(()=>window.__lat.push(performance.now()-t0));};
 document.addEventListener('keydown',mark,true);document.addEventListener('pointerdown',mark,true);
 window.__take=()=>window.__lat.splice(0);
});
const take=async(page)=>{await sleep(150);return page.evaluate(()=>window.__take());};
for(const size of sizes) {
 const raw=make(size.chars);
 for(const mode of ['read','code']) {
  const t=await launchApp({raw,name:`perf-${size.label}.md`});
  try {
   const {page}=t;await sleep(800);
   if(mode==='code'){await page.locator('#code').click();await sleep(600);}
   await install(page);
   const row={size:size.label,chars:raw.length,mode,metrics:{}};
   // ordinary typing at end
   await t.focus();await page.keyboard.press('Control+End');await take(page);
   for(let i=0;i<N;i++){await page.keyboard.type(i%2?'b':'字');await sleep(25);}
   row.metrics.input=stat(await take(page));
   // middle edit
   const mid=Math.floor((await t.doc()).length/2);await t.select(mid);await take(page);
   for(let i=0;i<N;i++){await page.keyboard.press('x');await sleep(25);}
   row.metrics.middleEdit=stat(await take(page));
   // cursor positioning by click (pointerdown -> frame)
   await take(page);
   for(let i=0;i<30;i++){const box=await page.locator('.cm-content').boundingBox();await page.mouse.click(box.x+80+(i*17)%400,box.y+60+(i*29)%300);await sleep(40);}
   row.metrics.click=stat((await take(page)).filter((_,i)=>true));
   // selection operations: shift+arrow, shift+down, select-all
   await t.select(mid);await take(page);
   for(let i=0;i<N/2;i++){await page.keyboard.press('Shift+ArrowRight');await sleep(20);await page.keyboard.press('Shift+ArrowDown');await sleep(20);}
   row.metrics.selection=stat(await take(page));
   for(let i=0;i<5;i++){await page.keyboard.press('Control+a');await sleep(150);await page.keyboard.press('ArrowLeft');await sleep(80);}
   const sa=await take(page);row.metrics.select_all=stat(sa.filter((_,i)=>i%2===0));
   // mode switch: click -> mode attr + 3 frames
   const sw=[];
   for(let i=0;i<8;i++){
    const ms=await page.evaluate(async()=>{
     const pane=document.querySelector('.pane'),target=pane.dataset.mode==='rendered'?'code':'read',want=target==='code'?'source':'rendered';
     const t0=performance.now();document.getElementById(target).click();
     while(pane.dataset.mode!==want)await new Promise(requestAnimationFrame);
     for(let k=0;k<5;k++)await new Promise(requestAnimationFrame);
     return performance.now()-t0;});
    sw.push(ms);await sleep(200);
   }
   row.metrics.modeSwitch=stat(sw);
   row.verdict=Object.fromEntries(Object.entries(row.metrics).map(([k,v])=>[k,v.p95<=budgets[k]?'within-budget':'over-budget']));
   results.push(row);console.log(JSON.stringify(row));
  } finally {await t.close();}
 }
}
let commit='';try{commit=execFileSync('git',['rev-parse','--short','HEAD']).toString().trim();}catch{}
await writeFile(join(output,`input-perf-${process.argv[2]||'current'}.json`),JSON.stringify({commit,N,budgetsMsP95:budgets,method:'event timestamp -> next rAF in renderer; Playwright real input; Electron on the dev PC; not hardware latency',results},null,2));
