import {_electron as electron} from '@playwright/test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

// Batch 2C.1 screenshots (real Electron, light and dark): list, empty, hover with
// more-actions and its menu. Same-name, missing-row, removal feedback and the
// 20 / 50 record lists are captured by recent-closure-ui.mjs.
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/batch-2c1/screens');await mkdir(output,{recursive:true});
const root=await mkdtemp(join(tmpdir(),'note-recent-shots-'));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const docs=join(root,'docs','随笔');await mkdir(docs,{recursive:true});
const names=['周报','读书笔记','会议纪要','灵感','旅行清单'];
const files=[];for(const name of names){const file=join(docs,name+'.md');await writeFile(file,`# ${name}\n`);files.push(file);}
const now=Date.now();
const seed=async profile=>writeFile(join(profile,'recent.json'),JSON.stringify({version:1,updatedAt:now,items:files.map((file,index)=>({path:file,name:file.split('\\').pop(),dir:docs,accessedAt:now-[30_000,20*60_000,5*3_600_000,26*3_600_000,4*86_400_000][index]}))}));
const run=async(theme,withData)=>{
 const profile=join(root,`${theme}-${withData?'data':'empty'}`);await mkdir(profile);if(withData)await seed(profile);
 const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),'--user-data-dir='+profile],env});
 try {
  const page=await app.firstWindow();
  await page.locator('#filename').waitFor();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));
  const dark=await page.evaluate(()=>document.documentElement.classList.contains('dark'));
  if((theme==='dark')!==dark)await page.locator('#theme').click();
  await page.waitForTimeout(400);
  await page.locator('#recent').click();await page.waitForTimeout(300);
  await page.screenshot({path:join(output,withData?`list-${theme}.png`:`empty-${theme}.png`)});
  if(withData) {
   const row=page.locator('#recent-list .recent-row').nth(1);
   await row.hover();await page.waitForTimeout(200);
   await page.screenshot({path:join(output,`hover-more-${theme}.png`)});
   await row.locator('.recent-more').click();await page.waitForTimeout(200);
   await page.screenshot({path:join(output,`menu-open-${theme}.png`)});
  }
 } finally {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
};
try{for(const theme of ['light','dark']){await run(theme,false);await run(theme,true);}console.log('shots written to',output);}
finally{await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:250}).catch(()=>{});}