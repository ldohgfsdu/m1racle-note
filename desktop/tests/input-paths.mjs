import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

// Separates real keyboard paths (Enter, per-key typing, clipboard paste) from
// CDP virtual injection (Playwright insertText -> Input.insertText) to judge
// whether the previously observed leading-newline drop can reach real users.
// Every path is also checked for editor-vs-disk consistency.
const dir=await mkdtemp(join(tmpdir(),'note-input-paths-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-input-evidence-'));await mkdir(output,{recursive:true}).catch(()=>{});
const file=join(dir,'输入路径.md'),raw='abc\n';
await writeFile(file,raw);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY || resolve('desktop/main.mjs'),checks=[],errors=[];
let app,page,ended=false,originalClipboard=null;
const text=()=>page.locator('.cm-content').evaluate(element=>element.cmTile.root.view.state.doc.toString());
const disk=async()=>readFile(file,'utf8');
const waitSaved=async expected=>{await expect.poll(disk,{timeout:5000}).toBe(expected);await expect(page.locator('#status')).toHaveText('已保存');};
try {
 app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[entry,file,'--user-data-dir='+join(dir,'profile')],env});
 page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));page.on('console',event=>{if(event.type()==='error')errors.push(event.text());});
 await page.locator('#filename').filter({hasText:'输入路径.md'}).waitFor();
 originalClipboard=await app.evaluate(({clipboard})=>clipboard.readText());
 await page.locator('.cm-content').click();await page.keyboard.press('Control+End');

 await page.keyboard.press('Enter');
 assert.equal(await text(),'abc\n\n');await waitSaved('abc\n\n');checks.push('real-enter-appends-one-newline-exactly');

 await page.keyboard.type('xyz',{delay:10});
 assert.equal(await text(),'abc\n\nxyz');await waitSaved('abc\n\nxyz');checks.push('per-key-typing-appends-exactly');

 await app.evaluate(({clipboard})=>clipboard.writeText('P\nQ'));
 await page.keyboard.press('Control+v');
 assert.equal(await text(),'abc\n\nxyzP\nQ');await waitSaved('abc\n\nxyzP\nQ');checks.push('clipboard-multiline-paste-appends-exactly');

 await page.keyboard.insertText('S');
 assert.equal(await text(),'abc\n\nxyzP\nQS');await waitSaved('abc\n\nxyzP\nQS');checks.push('cdp-inserttext-without-leading-newline-appends-exactly');

 await page.keyboard.press('Enter');
 assert.equal(await text(),'abc\n\nxyzP\nQS\n');
 const beforeCdp=await text();
 await page.keyboard.insertText('\nR');
 const afterCdp=await text();
 const leadingNewlinePreserved=afterCdp===beforeCdp+'\nR';
 await waitSaved(afterCdp);
 assert.equal(await disk(),afterCdp);
 checks.push('cdp-inserttext-leading-newline-after-trailing-newline-stays-doc-disk-consistent');
 await writeFile(join(output,'input-paths-cdp-characterization.json'),JSON.stringify({
  scene:'CDP Input.insertText("\\nR") at EOF of a newline-terminated document',
  before:beforeCdp,after:afterCdp,leadingNewlinePreserved,docEqualsDisk:true,
 },null,2));

 if(originalClipboard!==null)await app.evaluate(({clipboard},value)=>clipboard.writeText(value),originalClipboard).catch(()=>{});
 assert.deepEqual(errors,[]);
 assert.deepEqual((await readdir(dir)).filter(name=>name.endsWith('.tmp')),[]);
 const result={passed:true,checks,errors,cdpLeadingNewlinePreserved:leadingNewlinePreserved,scope:'Actual Electron renderer and storage; CDP path uses Input.insertText like Playwright insertText. Physical IME not exercised.'};
 await writeFile(join(output,'input-paths.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,output}));
}catch(error){if(page && !page.isClosed())await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});throw error;}
finally {
 if(app && !ended){
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});
 }
 await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
