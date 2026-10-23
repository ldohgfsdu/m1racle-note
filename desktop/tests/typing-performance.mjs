import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

// Measures editor transactions, not physical key latency or a device Gate.
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-typing-evidence-'));
await mkdir(output,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'note-typing-')),file=join(dir,'长文输入.md');
const unit='正文 **格式** 与 [参考](https://example.com)。保留这段文字。\r\n\n';
const raw='\ufeff# 长文输入\r\n\r\n'+unit.repeat(Math.ceil(1_000_000/unit.length))+'末尾目标。\n';
await writeFile(file,raw);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[process.env.NOTE_TEST_APP_ENTRY || resolve('desktop/main.mjs'),file,'--user-data-dir='+join(dir,'profile')],env,timeout:60000});
try {
 const page=await app.firstWindow(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',event=>{if(event.type()==='error')errors.push(event.text());});
 await page.locator('#filename').filter({hasText:'长文输入.md'}).waitFor({timeout:60000});
 await page.locator('.cm-content').click({position:{x:100,y:35}});await page.keyboard.press('Control+End');await page.waitForTimeout(500);
 const timings=await page.evaluate(()=>{
  const view=document.querySelector('.cm-content').cmTile.root.view,input=[],selection=[];
  for(let i=0;i<9;i++) {
   let started=performance.now();view.dispatch({changes:{from:view.state.doc.length,insert:'测'},selection:{anchor:view.state.doc.length+1},userEvent:'input.type'});input.push(performance.now()-started);
   started=performance.now();view.dispatch({selection:{anchor:view.state.doc.length-1}});selection.push(performance.now()-started);
  }
  const cache=view.plugins.map(plugin=>plugin.value?.previewCache).find(Boolean);
  return {input,selection,normalizedChars:view.state.doc.length,preview:cache?{...cache.stats}:null};
 });
 await page.keyboard.press('End');await page.keyboard.insertText('实际输入');
 await expect.poll(()=>readFile(file,'utf8'),{timeout:15000}).toBe(raw+'测'.repeat(9)+'实际输入');
 for(let i=0;i<11;i++){await page.locator('#undo').click();await page.waitForTimeout(600);if(await readFile(file,'utf8')===raw)break;}
 await expect.poll(()=>readFile(file,'utf8'),{timeout:10000}).toBe(raw);
 assert.equal(await page.title(),'M1racle Note');assert.deepEqual(errors,[]);
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 const result={passed:true,rawChars:raw.length,...timings,medianInputMs:median(timings.input),medianSelectionMs:median(timings.selection),diskExactAfterUndo:true,errors,scope:'Actual Electron editor transactions and one keyboard insertion; not physical IME, frame latency, or sustained performance acceptance.'};
 await page.screenshot({path:join(output,'typing-'+(process.argv[2] || 'current')+'.png')});
 await writeFile(join(output,'typing-'+(process.argv[2] || 'current')+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {
 await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});
 await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
