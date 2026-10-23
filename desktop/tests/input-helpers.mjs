import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

// Shared helpers for Batch 3A input/editing tests. Real Electron renderer.
// IME note: imeSetComposition/insertText below are CDP *event-level
// simulation* of composition events. They are NOT a physical IME.
export const entry=process.env.NOTE_TEST_APP_ENTRY || resolve('desktop/main.mjs');
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function createReporter(name) {
 const checks=[],failures=[];
 return {
  checks,failures,
  async check(id,fn) {
   try{await fn();checks.push(id);console.log('PASS',id);}
   catch(error){failures.push({id,message:String(error?.message||error).slice(0,600)});console.log('FAIL',id,'::',String(error?.message||error).slice(0,300));}
  },
  async finish(output,extra={}) {
   const result={suite:name,passed:failures.length===0,passedCount:checks.length,failed:failures.length,checks,failures,...extra};
   await mkdir(output,{recursive:true});
   await writeFile(join(output,name+'.json'),JSON.stringify(result,null,2));
   console.log(JSON.stringify({suite:name,passed:result.passed,passedCount:checks.length,failed:failures.length}));
   if(failures.length)process.exitCode=1;
  },
 };
}
export async function launchApp({raw,name='编辑.md',profile,keepDir,args}={}) {
 const dir=keepDir||await mkdtemp(join(tmpdir(),'note-3a-'));
 const file=join(dir,name);
 if(raw!==undefined)await writeFile(file,raw);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const prof=profile||join(dir,'profile');
 const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[entry,...(args||(raw!==undefined?[file]:[])),'--user-data-dir='+prof],env,timeout:60000});
 const page=await app.firstWindow(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 await page.locator('.cm-content').waitFor();
 // The welcome view is replaced when the initial document arrives; wait for
 // the real document so typing never races that swap (test-harness fix).
 if(raw!==undefined)await page.locator('#filename').filter({hasText:name}).waitFor({timeout:30000});
 if(raw!==undefined)await expect.poll(()=>page.locator('.cm-content').evaluate(e=>e.cmTile.root.view.state.doc.length),{timeout:30000}).toBe(raw.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n').length);
 await new Promise(r=>setTimeout(r,250));
 const cdp=await page.context().newCDPSession(page);
 const api={
  app,page,cdp,dir,file,profile:prof,errors,
  state:()=>page.locator('.cm-content').evaluate(e=>{const v=e.cmTile.root.view,s=v.state.selection.main;return {doc:v.state.doc.toString(),composing:v.composing,anchor:s.anchor,head:s.head,focus:v.hasFocus,mode:document.querySelector('.pane').dataset.mode,scrollTop:v.scrollDOM.scrollTop};}),
  doc:()=>page.locator('.cm-content').evaluate(e=>e.cmTile.root.view.state.doc.toString()),
  disk:()=>readFile(file,'utf8'),
  select:(anchor,head=anchor)=>page.locator('.cm-content').evaluate((e,[a,h])=>{const v=e.cmTile.root.view;v.dispatch({selection:{anchor:a,head:h}});v.focus();},[anchor,head]),
  focus:()=>page.locator('.cm-content').evaluate(e=>e.cmTile.root.view.focus()),
  blur:()=>page.evaluate(()=>document.activeElement.blur()),
  compose:(text)=>cdp.send('Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length}),
  commit:(text)=>cdp.send('Input.insertText',{text}),
  waitSaved:async(expected)=>{await expect.poll(()=>readFile(file,'utf8'),{timeout:8000}).toBe(expected);await expect(page.locator('#status')).toHaveText('已保存',{timeout:8000});},
  setClipboard:t=>app.evaluate(({clipboard},t)=>clipboard.writeText(t),t),
  getClipboard:()=>app.evaluate(({clipboard})=>clipboard.readText()),
  pos:(pos)=>page.locator('.cm-content').evaluate((e,pos)=>{const c=e.cmTile.root.view.coordsAtPos(pos);return c&&{x:c.left,y:(c.top+c.bottom)/2};},pos),
  async clickAt(pos,opts={}){const p=await this.pos(pos);await page.mouse.click(p.x+1,p.y,opts);return p;},
  async close(){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250}).catch(()=>{});},
 };
 return api;
}
export const loneSurrogate=s=>/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
