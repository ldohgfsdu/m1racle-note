import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-memory-evidence-'));
await mkdir(output,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'note-memory-')),file=join(dir,'连续输入.md');
const unit='原文 **格式** 与 🌱。\r\n\n',raw='\ufeff# 连续输入\r\n\r\n'+unit.repeat(Math.ceil(1_000_000/unit.length));
await writeFile(file,raw);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),file,'--user-data-dir='+join(dir,'profile')],env,timeout:60000});
try {
 const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',event=>{if(event.type()==='error')errors.push(event.text());});
 await page.locator('#filename').filter({hasText:'连续输入.md'}).waitFor({timeout:60000});
 await page.locator('.cm-content').click({position:{x:80,y:30}});await page.keyboard.press('Control+End');await page.waitForTimeout(300);
 const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.enable');
 const sample=async()=>{await cdp.send('HeapProfiler.collectGarbage');const heap=await cdp.send('Runtime.getHeapUsage');const history=await page.evaluate(()=>{
  const view=document.querySelector('.cm-content').cmTile.root.view;
  const state=view.state.values.find(value=>Array.isArray(value?.done) && Array.isArray(value?.undone));
  const effects=(state?.done || []).flatMap(event=>event.effects || []);
  return {undoEvents:state?.done.length,fullSourceEffects:effects.filter(effect=>typeof effect.value==='string').length,fullSourceChars:effects.reduce((count,effect)=>count+(typeof effect.value==='string'?effect.value.length:0),0)};
 });return {usedHeapBytes:heap.usedSize,...history};};
 const before=await sample();
 await page.evaluate(()=>{const view=document.querySelector('.cm-content').cmTile.root.view;for(let i=0;i<100;i++)view.dispatch({changes:{from:view.state.doc.length,insert:'测'},selection:{anchor:view.state.doc.length+1},userEvent:'input.type'});});
 if(errors.length)throw new Error('Renderer errors: '+JSON.stringify(errors));
 await expect.poll(()=>readFile(file,'utf8'),{timeout:15000}).toBe(raw+'测'.repeat(100));
 const after=await sample();await page.locator('#undo').click();await expect.poll(()=>readFile(file,'utf8'),{timeout:15000}).toBe(raw);
 const undone=await sample();assert.deepEqual(errors,[]);
 const result={passed:true,chars:raw.length,typedCharacters:100,before,after,undone,retainedGrowthBytes:after.usedHeapBytes-before.usedHeapBytes,undoDiskExact:true,scope:'Actual Electron with forced GC measures retained renderer JS heap and undo metadata. Not total process memory or a device performance Gate.'};
 await writeFile(join(output,'typing-memory-'+(process.argv[2] || 'current')+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){
 const page=await app.firstWindow();console.error(JSON.stringify(await page.evaluate(()=>{const view=document.querySelector('.cm-content').cmTile.root.view;return {status:document.querySelector('#status').textContent,error:document.querySelector('#error').hidden?null:document.querySelector('#error').textContent,tail:view.state.doc.sliceString(Math.max(0,view.state.doc.length-120)),sourceFields:view.state.values.filter(value=>typeof value==='string').map(value=>({length:value.length,tail:value.slice(-120)}))};})));
 throw error;
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
