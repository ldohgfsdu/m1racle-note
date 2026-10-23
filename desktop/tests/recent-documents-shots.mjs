import {_electron as electron} from '@playwright/test';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

// Evidence helper (not a pass/fail test): real screenshots of the main window and
// the recent documents dialog, in day and night, for design review.
const output=process.env.NOTE_QA_OUTPUT || resolve('docs/reviews/batch-2c/raw/screens');
await mkdir(output,{recursive:true});
const root=await mkdtemp(join(tmpdir(),'note-recent-shots-'));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const make=async(parts,name,body)=>{const folder=join(root,...parts);await mkdir(folder,{recursive:true});const file=join(folder,name);await writeFile(file,body);return file;};
const files=[
 await make(['文档','随笔'],'今天的想法.md','# 今天的想法\n\n本地优先，直接写作。\n'),
 await make(['项目一','计划'],'todo.md','# todo\n'),
 await make(['项目二','计划'],'todo.md','# todo\n'),
 await make(['工作','周报'],'第 42 周周报：最近文档、会话恢复与草稿保护的联调记录与风险清单.md','# 周报\n'),
];
const profile=join(root,'profile');await mkdir(profile);
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),'--user-data-dir='+profile],env});
try {
 const page=await app.firstWindow();
 await page.setViewportSize?.({width:1180,height:820}).catch(()=>{});
 await app.evaluate(({dialog},paths)=>{globalThis.q=paths.slice();dialog.showOpenDialog=async()=>({canceled:false,filePaths:[globalThis.q.shift()]});},files);
 for(const file of files){await page.locator('#open').click();await page.waitForTimeout(500);}
 await page.waitForTimeout(500);
 for(const theme of ['light','dark']) {
  const dark=await page.evaluate(()=>document.documentElement.classList.contains('dark'));
  if((theme==='dark')!==dark)await page.locator('#theme').click();
  await page.waitForTimeout(400);
  await page.screenshot({path:join(output,`main-window-${theme}.png`)});
  await page.locator('#recent').click();await page.waitForTimeout(400);
  await page.screenshot({path:join(output,`recent-dialog-${theme}.png`)});
  await page.locator('#recent-close').click();
 }
} finally {
 await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});
 await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
console.log('screens written to',output);
