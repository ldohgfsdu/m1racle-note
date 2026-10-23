import './hidden-launch.mjs';
import {_electron as electron,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

// Real hidden renderer + IPC + isolated disk bytes. Same-task observations
// distinguish clean/dirty transitions from the later 550 ms autosave.
const dir=await mkdtemp(join(tmpdir(),'note-save-undo-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-save-undo-evidence-'));
const file=join(dir,'文稿乙.md'),draft=join(dir,'首次保存.md'),profile=join(dir,'profile');
const original=Buffer.from('\ufeff# 文稿乙\r\n\r\n保留正文。\n尾部\r');
await mkdir(output,{recursive:true});await writeFile(file,original);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const checks=[],errors=[],native=[],geometry=[];let app,page,passed=false,stage='launch';
const at=name=>{stage=name;console.log('STAGE '+name);};
const editor=()=>page.locator('.cm-content');
const doc=()=>editor().evaluate(el=>el.cmTile.root.view.state.doc.toString());
const observe=()=>editor().evaluate(el=>{
 const view=el.cmTile.root.view,selection=view.state.selection.main;
 return {sameView:view===window.noteSaveUndoView,anchor:selection.anchor,head:selection.head,focus:view.hasFocus};
});
const sample=async()=>{
 const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(win=>({visible:win.isVisible(),focused:win.isFocused()})));
 assert.ok(windows.length && windows.every(win=>!win.visible&&!win.focused));native.push({stage,windows});
};
try {
 app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),file,'--user-data-dir='+profile],env,timeout:30000});
 page=await app.firstWindow();page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',event=>{if(event.type()==='error')errors.push(event.text());});
 await expect(page).toHaveTitle('M1racle Note');assert.match(page.url(),/\/desktop\/dist\/index\.html$/);
 await expect(page.locator('#filename')).toHaveText('文稿乙.md');
 await expect(page.locator('#status')).toHaveText('已保存');
 assert.equal(await page.locator('vite-error-overlay').count(),0);await sample();
 await app.evaluate((_electron,filePath)=>{
  globalThis.noteUndoConfirms=0;
  globalThis.installDialogs({showSaveDialog:async()=>({canceled:false,filePath}),showMessageBox:async()=>{globalThis.noteUndoConfirms++;return {response:1};}});
 },draft);

 at('edit-undo-clean-before-autosave');
 const clean=await editor().evaluate(el=>{
  const view=el.cmTile.root.view;window.noteSaveUndoView=view;
  view.dispatch({changes:{from:view.state.doc.length,insert:'临时修改'},userEvent:'input.type'});
  const pending=document.getElementById('status').dataset.state;
  document.getElementById('undo').click();
  return {pending,after:document.getElementById('status').dataset.state,status:document.getElementById('status').textContent,title:document.getElementById('filename').textContent,sameView:view===el.cmTile.root.view};
 });
 assert.equal(clean.pending,'pending');assert.equal(clean.after,'saved');assert.equal(clean.status,'已保存');
 assert.equal(clean.title,'文稿乙.md');assert.equal(clean.sameView,true);
 assert.deepEqual(await readFile(file),original);checks.push(stage);

 at('undo-clean-document-switch-needs-no-save-prompt');
 await page.locator('#sidebar-new').click();await expect(page.locator('#filename')).toHaveText('未命名.md');
 assert.equal(await app.evaluate(()=>globalThis.noteUndoConfirms),0);
 await page.locator('#library-groups-panel').getByRole('button',{name:'打开：文稿乙.md',exact:true}).click();
 await expect(page.locator('#filename')).toHaveText('文稿乙.md');checks.push(stage);

 at('manual-save-keeps-history-and-clean-baseline');
 await editor().evaluate(el=>{const view=el.cmTile.root.view;window.noteSaveUndoView=view;view.dispatch({changes:{from:view.state.doc.length,insert:'保存内容'},userEvent:'input.type'});view.focus();});
 const selection=await observe();await page.keyboard.press('Control+s');
 await expect(page.locator('#save-feedback')).toContainText('已保存到磁盘');
 await expect(page.locator('#status')).toHaveText('已保存');
 assert.deepEqual(await readFile(file),Buffer.concat([original,Buffer.from('保存内容')]));
 assert.deepEqual(await observe(),selection);
 const history=await editor().evaluate(el=>{
  const view=el.cmTile.root.view;
  document.getElementById('undo').click();
  const undo={text:view.state.doc.toString(),state:document.getElementById('status').dataset.state};
  document.getElementById('redo').click();
  return {undo,redo:{text:view.state.doc.toString(),state:document.getElementById('status').dataset.state},sameView:view===window.noteSaveUndoView};
 });
 assert.equal(history.undo.text,original.toString('utf8').slice(1).replace(/\r\n|\r/g,'\n'));
 assert.equal(history.undo.state,'pending');assert.equal(history.redo.state,'saved');assert.equal(history.sameView,true);
 assert.equal(history.redo.text,history.undo.text+'保存内容');checks.push(stage);

 at('clean-document-switch-needs-no-save-prompt');
 await page.locator('#sidebar-new').click();await expect(page.locator('#filename')).toHaveText('未命名.md');
 assert.equal(await app.evaluate(()=>globalThis.noteUndoConfirms),0);checks.push(stage);

 at('first-sidebar-save-preserves-view-selection-focus-and-history');
 const draftText='# 首次保存\n\n连续写作。';await page.keyboard.insertText(draftText);
 await expect(page.locator('.library-unsaved')).toBeVisible();
 await editor().evaluate(el=>{const view=el.cmTile.root.view;window.noteSaveUndoView=view;view.dispatch({selection:{anchor:4,head:6}});});
 await expect(page.locator('#selection-menu')).toBeVisible();
 const bounds=await editor().evaluate(el=>{
  const view=el.cmTile.root.view,menu=document.getElementById('selection-menu');
  return {pane:view.scrollDOM.getBoundingClientRect().toJSON(),menu:menu.getBoundingClientRect().toJSON()};
 });geometry.push(bounds);
 assert.ok(bounds.menu.left>=bounds.pane.left+12-.5,JSON.stringify(bounds));
 assert.ok(bounds.menu.right<=bounds.pane.right-12+.5,JSON.stringify(bounds));
 const before=await observe();await page.locator('#sidebar-save').click();
 await expect(page.locator('#filename')).toHaveText('首次保存.md');
 await expect(page.locator('#save-feedback')).toContainText('已保存到磁盘 · 首次保存.md');
 await expect(page.locator('.library-unsaved')).toBeHidden();
 await expect(page.locator('#selection-menu')).toBeHidden();
 assert.deepEqual(await observe(),before);assert.equal(before.focus,true);
 assert.equal(await readFile(draft,'utf8'),draftText);
 const draftHistory=await editor().evaluate(el=>{
  const view=el.cmTile.root.view;document.getElementById('undo').click();
  const undo={text:view.state.doc.toString(),state:document.getElementById('status').dataset.state};
  document.getElementById('redo').click();
  return {undo,redo:view.state.doc.toString(),state:document.getElementById('status').dataset.state};
 });
 assert.equal(draftHistory.undo.text,'');assert.equal(draftHistory.undo.state,'pending');
 assert.equal(draftHistory.redo,draftText);assert.equal(draftHistory.state,'saved');checks.push(stage);

 at('first-save-registers-ungrouped-and-recent-path-metadata');
 const row=page.locator('#library-groups-panel').getByRole('button',{name:'打开：首次保存.md',exact:true});
 await expect(row).toBeVisible();
 const library=JSON.parse(await readFile(join(profile,'library.json'),'utf8'));
 assert.equal(library.items.find(item=>item.path===draft)?.groupId,null);
 await page.locator('#library-recent-tab').click();
 await expect(page.locator('#library-recent-panel').getByRole('button',{name:'打开：首次保存.md',exact:true})).toBeVisible();
 assert.equal(await readFile(draft,'utf8'),draftText);checks.push(stage);

 at('conflict-retains-disk-and-editor-history');
 await writeFile(draft,'外部版本');
 await editor().evaluate(el=>{const view=el.cmTile.root.view;view.dispatch({changes:{from:view.state.doc.length,insert:'!'},userEvent:'input.paste'});});
 await page.locator('#save').click();await expect(page.locator('#retry-save')).toBeVisible();
 await expect(page.locator('#status')).toContainText('保存失败');await expect(page.locator('#save-feedback')).toBeHidden();
 assert.equal(await readFile(draft,'utf8'),'外部版本');assert.equal(await doc(),draftText+'!');
 await page.locator('#undo').click();assert.equal(await doc(),draftText);
 assert.equal((await observe()).sameView,true);checks.push(stage);
 await sample();assert.deepEqual(errors,[]);passed=true;
} finally {
 await writeFile(join(output,'save-undo-ui.json'),JSON.stringify({passed,stage,checks,errors,native,geometry,scope:'Hidden Electron renderer, IPC and isolated Markdown bytes; physical IME and visual acceptance unverified'},null,2));
 if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
 await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
 console.log(JSON.stringify({passed,checks:checks.length,stage,output}));
}
