import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

// Closed-loop writing smoke on the actual Electron app: new document, typing,
// first save, autosave, clean close and reopen. Dialog choices are harness-supplied.
const dir=await mkdtemp(join(tmpdir(),'note-smoke-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-smoke-evidence-'));await mkdir(output,{recursive:true});
const file=join(dir,'闭环验证.md'),profile=join(dir,'profile');
const first='随手记下今天试用的感受：\n\n新建、输入、保存、退出、再打开，每一步都要稳。\nMixed CN/EN line with 标点、emoji 😄 和符号 ∑。\n';
const second='重新打开后继续写，自动保存不能丢字。';
const extra='—— 第二会话补记。';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY || resolve('desktop/main.mjs');
const checks=[],errors=[];
let app,page;
const text=()=>page.locator('.cm-content').evaluate(element=>element.cmTile.root.view.state.doc.toString());
const insert=async value=>{await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText(value);};
const launch=args=>electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[entry,...args,'--user-data-dir='+profile],env});
const watch=p=>{p.on('pageerror',error=>errors.push(error.message));p.on('console',event=>{if(event.type()==='error')errors.push(event.text());});return p;};
const stubDialogs=()=>app.evaluate(({dialog})=>{
 globalThis.noteQaDialogs={open:[],save:[],confirm:[],calls:[]};
 for(const [method,type,fallback] of [['showOpenDialog','open',{canceled:true,filePaths:[]}],['showSaveDialog','save',{canceled:true}],['showMessageBox','confirm',{response:1}]]) {
  dialog[method]=async(...args)=>{const result=globalThis.noteQaDialogs[type].shift() || fallback;globalThis.noteQaDialogs.calls.push({type,result,options:args.at(-1)});return result;};
 }
});
const choose=(type,value)=>app.evaluate((_electron,{type,value})=>globalThis.noteQaDialogs[type].push(value),{type,value});
const action=async type=>{if(type==='new'||type==='open')await page.locator('#app-menu summary').click();await page.locator('#'+type).click();};
const closeWindow=async()=>{const closed=app.waitForEvent('close',{timeout:15000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;};
try {
 app=await launch([]);page=watch(await app.firstWindow());await stubDialogs();
 await page.locator('#filename').filter({hasText:'欢迎.md'}).waitFor();await expect(page.locator('#status')).toHaveText('示例文档');
 assert.match(await text(),/留一点空间，给思考/);checks.push('fresh-launch-shows-welcome-example');
 await action('new');await expect(page.locator('#filename')).toHaveText('未命名.md');assert.equal(await text(),'');
 checks.push('new-document-starts-empty-and-untitled');
 await insert(first);
 await choose('save',{canceled:true});await action('save');await expect(page.locator('#status')).toContainText('未保存');
 assert.ok(!(await readdir(dir)).includes('闭环验证.md'));assert.equal(await text(),first);
 checks.push('cancel-first-save-keeps-draft-and-writes-nothing');
 await choose('save',{canceled:false,filePath:file});await action('save');
 await expect(page.locator('#status')).toHaveText('已保存');await expect(page.locator('#filename')).toHaveText('闭环验证.md');
 assert.equal(await readFile(file,'utf8'),first);checks.push('save-writes-exact-draft-bytes');
 await insert(second);await expect.poll(()=>readFile(file,'utf8'),{timeout:8000}).toBe(first+second);
 await expect(page.locator('#status')).toHaveText('已保存');checks.push('autosave-persists-typing-after-first-save');
 await closeWindow();app=null;checks.push('saved-document-closes-without-prompt');
 app=await launch([file]);page=watch(await app.firstWindow());await stubDialogs();
 await page.locator('#filename').filter({hasText:'闭环验证.md'}).waitFor();await expect(page.locator('#status')).toHaveText('已保存');
 assert.equal(await text(),first+second);checks.push('reopen-with-file-restores-exact-content');
 await insert(extra);await expect.poll(()=>readFile(file,'utf8'),{timeout:8000}).toBe(first+second+extra);
 checks.push('second-session-typing-persists');
 await closeWindow();app=null;
  app=await launch([]);page=watch(await app.firstWindow());
  await expect(page.locator('#filename')).toContainText('闭环验证.md',{timeout:10000});
  assert.equal(await text(),first+second+extra);
  await expect(page.locator('#status')).toHaveText('已保存');
  checks.push('relaunch-without-file-restores-the-last-document');
  assert.deepEqual(errors,[]);
  assert.deepEqual((await readdir(dir)).filter(name=>name.endsWith('.tmp')),[]);
  const result={passed:true,checks,errors,scope:'Actual Electron renderer, IPC, file writes, close guard and restarts; dialog choices are controlled by QA; session restore resumes the last document across restarts.'};
 await writeFile(join(output,'smoke.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,output}));
}catch(error){if(page && !page.isClosed())await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});throw error;}
finally {if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
