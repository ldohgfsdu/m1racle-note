import {_electron as electron,expect} from '@playwright/test';
import {mkdir,mkdtemp,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {createReporter,sleep} from './input-helpers.mjs';
// Leftover item 2: "remove from recents" must not touch an unsaved draft, the dirty editor, or the file on disk.
// Deterministic: the draft is SEEDED (not produced by typing), so no autosave race is involved.
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/batch-3b/raw');
const R=createReporter('recent-draft-integration-ui');
const sha=v=>createHash('sha256').update(v).digest('hex');
const dir=await mkdtemp(join(tmpdir(),'note-recent-draft-'));
const entry=process.env.NOTE_TEST_APP_ENTRY||resolve('desktop/main.mjs');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const profile=join(dir,'profile'),rec=join(profile,'recovery');
await mkdir(rec,{recursive:true});
const mk=async(n,body)=>{const f=join(dir,n);await writeFile(f,body);return f;};
const a=await mk('seed-a.md','甲\n'),b=await mk('seed-b.md','乙\n'),c=await mk('seed-c.md','丙原文\n');
const draftRaw='丙原文\n未保存的草稿内容 draft only\n',id='dddddddd-1111-2222-3333-444444444444';
const draftPath=join(rec,id+'.json');
const draftJson=JSON.stringify({version:1,id,path:c,raw:draftRaw,base:sha('丙原文\n'),updatedAt:Date.now()});
await writeFile(draftPath,draftJson);
await writeFile(join(profile,'recent.json'),JSON.stringify({version:1,updatedAt:Date.now(),items:[c,b,a].map((p,i)=>({path:p,name:p.split('\\').pop(),dir:dir,accessedAt:Date.now()-1000*(i+1)}))}));
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[entry,'--user-data-dir='+profile],env,timeout:60000});
const page=await app.firstWindow();
try{
 await app.evaluate(({dialog})=>{for(const m of ['showOpenDialog','showSaveDialog','showMessageBox'])dialog[m]=async()=>({canceled:true,filePaths:[],response:1});});
 await R.check('recents-remove-keeps-unsaved-draft-editor-and-disk',async()=>{
  await expect(page.locator('#recovery')).toBeVisible({timeout:15000});
  await page.locator('.recovery-restore').click();
  await expect(page.locator('#recovery')).toBeHidden();
  const text=()=>page.locator('.cm-content').evaluate(e=>e.cmTile.root.view.state.doc.toString());
  await expect.poll(text,{timeout:10000}).toBe(draftRaw);
  await sleep(1500); // let any (legitimate) timers fire; the preconditions below then pin the deterministic state
  // preconditions: dirty restored draft still on disk, original file untouched
  assert.equal(await readFile(draftPath,'utf8'),draftJson,'precondition: draft file byte-identical');
  assert.equal(await readFile(c,'utf8'),'丙原文\n','precondition: file on disk is the original');
  const status=await page.locator('#status').textContent();assert.notEqual(status.trim(),'已保存','precondition: document is dirty');
  await page.locator('#recent').click();await expect(page.locator('#recent-dialog')).toBeVisible();
  const row=page.locator('#recent-list .recent-row').filter({has:page.locator('.recent-name',{hasText:/^seed-c$/})});
  await row.hover();await row.locator('.recent-more').click();
  await page.locator('.recent-menu-item').click();
  await expect(page.locator('#recent-status')).toContainText('已从最近文档移除');
  const items=JSON.parse(await readFile(join(profile,'recent.json'),'utf8')).items.map(i=>i.name);
  assert.deepEqual(items,['seed-b.md','seed-a.md'],'record removed from recents');
  await sleep(1500);
  assert.equal(await readFile(draftPath,'utf8'),draftJson,'draft bytes unchanged by removal');
  assert.deepEqual((await readdir(rec)).filter(n=>n.endsWith('.json')),[id+'.json'],'draft set unchanged');
  assert.equal(await readFile(c,'utf8'),'丙原文\n','file on disk unchanged by removal');
  assert.equal(await text(),draftRaw,'editor content unchanged');
  assert.notEqual((await page.locator('#status').textContent()).trim(),'已保存','still dirty');
 });
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
await R.finish(output);