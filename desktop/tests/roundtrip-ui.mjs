import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

// Round-trip discipline at the UI level: each fixture opens in rendered mode,
// appending with real gestures (Enter, typing) changes only the tail bytes and
// adopts the document default EOL, and undo restores the exact original bytes.
// Byte comparisons include BOM and mixed line endings.
const fixturesDir=resolve('desktop/tests/fixtures');
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-roundtrip-evidence-'));await mkdir(output,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY || resolve('desktop/main.mjs');
const names=(await readdir(fixturesDir)).filter(name=>name.endsWith('.md')).sort();
const checks=[],errors=[];
let app,page;
const text=()=>page.locator('.cm-content').evaluate(element=>element.cmTile.root.view.state.doc.toString());
const append=async value=>{
 await page.locator('.cm-content').click();
 await page.keyboard.press('Control+End');
 await page.keyboard.press('Enter');
 await page.keyboard.press('Enter');
 await page.keyboard.insertText(value);
 await page.keyboard.press('Enter');
};
const closeWindow=async()=>{const closed=app.waitForEvent('close',{timeout:15000});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await closed;};
try {
 assert.ok(names.length>=6,`expected at least 6 fixtures, found ${names.length}: ${names.join(', ')}`);
 for(const [index,name] of names.entries()){
  const dir=await mkdtemp(join(tmpdir(),'note-roundtrip-'));const file=join(dir,name);
  await writeFile(file,await readFile(join(fixturesDir,name)));
  const original=await readFile(file);
  assert.ok(original.length>0,`${name}: fixture must not be empty`);
  const eol=original.toString('utf8').match(/\r\n|\r|\n/)?.[0] ?? '\n';
  const mark=`【往返标记 ${index+1}】`;
  const expected=Buffer.concat([original,Buffer.from(eol+eol+mark+eol,'utf8')]);
  app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[entry,file,'--user-data-dir='+join(dir,'profile')],env});
  page=await app.firstWindow();
  page.on('pageerror',error=>errors.push(`${name}: ${error.message}`));
  page.on('console',event=>{if(event.type()==='error')errors.push(`${name}: ${event.text()}`);});
  await page.locator('#filename').filter({hasText:basename(name)}).waitFor();
  await expect(page.locator('#status')).toHaveText('已保存');
  await expect(page.locator('#mode-hint')).toContainText('直接点击文字编辑');
  assert.ok((await text()).length>0,`${name}: rendered document must not be empty`);
  checks.push(`${name}: loads-in-rendered-mode`);
  await append(mark);
  await expect.poll(async()=>Buffer.compare(await readFile(file),expected)===0,{timeout:8000}).toBe(true);
  checks.push(`${name}: append-inserts-document-eol-and-preserves-all-original-bytes`);
  for(let step=0;step<5;step++)await page.keyboard.press('Control+z');
  await expect.poll(async()=>Buffer.compare(await readFile(file),original)===0,{timeout:8000}).toBe(true);
  checks.push(`${name}: undo-restores-exact-original-bytes`);
  assert.deepEqual((await readdir(dir)).filter(entry=>entry.endsWith('.tmp')),[],`${name}: temporary files left behind`);
  checks.push(`${name}: no-temp-files-left-behind`);
  await closeWindow();app=null;page=null;
  await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
 }
 assert.deepEqual(errors,[]);
 const result={passed:true,fixtures:names,checks,errors,scope:'Actual Electron renderer and autosave; real Enter and typing gestures; fixture bytes compared before and after append and undo; BOM and mixed line endings are covered by fixture bytes.'};
 await writeFile(join(output,'roundtrip.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,output}));
}catch(error){if(page && !page.isClosed())await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});throw error;}
finally {if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}}
