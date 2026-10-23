import './hidden-launch.mjs';
import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,readFile,stat,unlink,rm} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {recordRecent} from '../recent-state.mjs';

const dir=await mkdtemp(join(tmpdir(),'note-library-ui-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-library-evidence-'));
const profile=join(dir,'profile'),a=join(dir,'Alpha.md'),b=join(dir,'Beta.md'),copy=join(dir,'Conflict-copy.md');
const original=Buffer.from('\ufeff# Alpha\r\n\r\n原文\n尾部\r'),other=Buffer.from('# Beta\n\n第二份文档。\n');
await mkdir(profile,{recursive:true});await mkdir(output,{recursive:true});
await writeFile(a,original);await writeFile(b,other);await recordRecent(profile,b);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const checks=[],errors=[],native=[];
let app,page;
const stage=name=>{console.log('STAGE '+name);writeFileSync(join(output,'progress.json'),JSON.stringify({stage:name,at:new Date().toISOString()}));};
const metadata=async()=>JSON.parse(await readFile(join(profile,'library.json'),'utf8'));
const raw=()=>page.locator('.cm-content').evaluate(el=>el.cmTile.root.view.state.doc.toString());
const entry=name=>page.getByRole('button',{name:'打开：'+name,exact:true}).or(page.getByRole('button',{name:'固定：'+name,exact:true})).first();
const more=async name=>{
  const trigger=page.getByRole('button',{name:'更多操作：'+name,exact:true}).first();
  await trigger.hover();await trigger.click();await expect(page.locator('.library-menu')).toBeVisible();
};
const menu=async(name,action)=>{await more(name);await page.locator('.library-menu').getByRole('menuitem',{name:action,exact:true}).click();};
async function sample(label) {
  const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(win=>({visible:win.isVisible(),focused:win.isFocused(),bounds:win.getBounds()})));
  assert.ok(windows.length && windows.every(win=>!win.visible&&!win.focused));native.push({label,windows});
}
async function launch(file=a,userProfile=profile) {
  await mkdir(userProfile,{recursive:true});
  app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),...(file?[file]:[]),'--user-data-dir='+userProfile],env,timeout:30000});
  page=await app.firstWindow();page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  await expect(page).toHaveTitle('M1racle Note');
  await expect(page.locator('#filename')).toHaveText(file?'Alpha.md':'欢迎.md');
  await expect(page.locator('#sidebar-new')).toBeAttached();
  await app.evaluate(()=>{
    globalThis.noteLibraryConfirm=[];globalThis.noteLibrarySave=null;
    globalThis.installDialogs({
      showMessageBox:async()=>({response:globalThis.noteLibraryConfirm.shift()??1}),
      showSaveDialog:async()=>globalThis.noteLibrarySave || {canceled:true},
      showOpenDialog:async()=>({canceled:true,filePaths:[]}),
    });
  });
  await sample('launch');
}
async function stop() {
  if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});app=null;}
}
try {
  stage('welcome-and-draft-save-action');await launch(null,join(dir,'welcome-profile'));
  await expect(page.locator('.library-unsaved')).toBeHidden();
  await expect(page.locator('.library-close')).toHaveCount(0);
  await expect(page.locator('#new')).toBeHidden();await expect(page.locator('#open')).toBeHidden();
  await page.locator('#sidebar-new').click();await expect(page.locator('.library-unsaved')).toBeVisible();
  await page.reload();await expect(page.locator('#filename')).toHaveText('欢迎.md');
  await expect(page.locator('.library-unsaved')).toBeHidden();
  await page.locator('.cm-content').click();await page.keyboard.insertText('示例的编辑内容');
  await expect(page.locator('.library-unsaved')).toBeVisible();const editedWelcome=await raw();
  await page.locator('#sidebar-save').click();assert.equal(await raw(),editedWelcome);
  await expect(page.locator('.library-unsaved')).toBeVisible();
  checks.push('welcome-is-quiet-new-and-edited-drafts-show-save-and-cancel-keeps-content');
  await stop();
  stage('initial-and-save-confirmation');await launch();
  await expect(entry('Alpha.md')).toBeVisible();await expect(entry('Beta.md')).toBeVisible();
  const before=await stat(a);
  await page.locator('#save').click();await expect(page.locator('#save-feedback')).toContainText('已保存到磁盘 · Alpha.md');
  assert.deepEqual(await readFile(a),original);assert.equal((await stat(a)).mtimeMs,before.mtimeMs);
  checks.push('manual-no-edit-save-confirms-without-rewriting-BOM-EOL-or-mtime');

  stage('recent-tab-is-real-open-history');
  await page.getByRole('tab',{name:'最近打开',exact:true}).click();
  await expect(page.locator('#library-recent-panel')).toBeVisible();
  assert.deepEqual(await page.locator('#library-recent-panel .library-item').evaluateAll(rows=>rows.map(row=>row.dataset.path)),[a,b]);
  await expect(page.locator('#library-recent-panel .library-item-name').first()).toHaveText('Alpha');
  await expect(page.locator('#library-recent-panel .library-item-dir').first()).toContainText('刚刚');
  await page.keyboard.press('ArrowLeft');await expect(page.getByRole('tab',{name:'分组',exact:true})).toBeFocused();
  checks.push('recent-tab-orders-real-access-records-and-keyboard-switches-to-groups');
  await page.getByRole('tab',{name:'最近打开',exact:true}).click();
  await menu('Alpha.md','从最近打开移除');
  await expect(page.locator('#library-recent-panel .library-item').filter({hasText:'Alpha'})).toHaveCount(0);
  assert.ok((await metadata()).items.some(item=>item.path===a));assert.deepEqual(await readFile(a),original);
  await page.getByRole('tab',{name:'分组',exact:true}).click();await expect(entry('Alpha.md')).toBeVisible();
  checks.push('removing-a-recent-record-preserves-its-sidebar-entry-and-source-bytes');

  stage('pin-fixed-and-unfix');
  await menu('Alpha.md','置顶');await expect.poll(async()=>(await metadata()).items.find(item=>item.path===a)?.pinned).toBe(true);
  await menu('Alpha.md','固定到常用');await expect(page.locator('.library-tile').filter({hasText:'Alpha'})).toBeVisible();
  await menu('Alpha.md','取消固定');await expect.poll(async()=>(await metadata()).items.find(item=>item.path===a)?.fixed).toBe(false);
  await menu('Alpha.md','固定到常用');
  checks.push('pin-and-fixed-tile-can-be-set-and-reversed');

  stage('group-create-move-rename-and-collapse');
  await page.locator('#sidebar-add-group').click();await page.locator('#library-group-name').fill('写作');
  await page.locator('#library-group-form button[type=submit]').click();await expect(page.locator('#library-group-dialog')).not.toBeVisible();
  const group=(await metadata()).groups[0];
  await more('Beta.md');await page.getByRole('combobox',{name:'移至分组：Beta.md',exact:true}).selectOption(group.id);
  await expect.poll(async()=>(await metadata()).items.find(item=>item.path===b)?.groupId).toBe(group.id);
  let groupNode=page.locator(`details[data-group-id="${group.id}"]`);
  await expect(groupNode.locator('.library-item')).toContainText('Beta');
  await page.getByRole('tab',{name:'最近打开',exact:true}).click();await expect(entry('Beta.md')).toBeVisible();
  await page.getByRole('tab',{name:'分组',exact:true}).click();
  await groupNode.getByRole('button',{name:'重命名分组',exact:true}).hover();await groupNode.getByRole('button',{name:'重命名分组',exact:true}).click();
  await page.locator('#library-group-name').fill('项目文档');await page.locator('#library-group-form button[type=submit]').click();
  await expect(groupNode.locator('.library-group-name')).toHaveText('项目文档');
  await groupNode.locator('summary').click();await expect.poll(async()=>(await metadata()).groups[0].collapsed).toBe(true);
  checks.push('group-create-move-rename-and-fold-persist');

  stage('sidebar-collapse-and-restart');
  await page.locator('#sidebar-toggle').click();await expect(page.locator('#document-sidebar')).toBeHidden();
  await expect.poll(async()=>(await metadata()).collapsed).toBe(true);await stop();await launch();
  await expect(page.locator('#document-sidebar')).toBeHidden();await page.locator('#sidebar-toggle').click();
  await expect(page.locator('#document-sidebar')).toBeVisible();await expect(page.locator('.library-tile')).toContainText('Alpha');
  groupNode=page.locator(`details[data-group-id="${group.id}"]`);
  assert.equal(await groupNode.getAttribute('open'),null);await groupNode.locator('summary').click();
  await expect(groupNode.locator('.library-item')).toBeVisible();
  await expect.poll(async()=>(await metadata()).groups[0].collapsed).toBe(false);
  checks.push('restart-retains-pins-tiles-groups-and-sidebar-fold-state');

  stage('search-and-open');
  await page.getByRole('searchbox',{name:'搜索文件名'}).fill('Alpha');
  await expect(page.locator('#library-groups-panel .library-item').filter({hasText:'Beta'})).toHaveCount(0);
  await page.getByRole('searchbox',{name:'搜索文件名'}).fill('');
  await entry('Beta.md').click();await expect(page.locator('#filename')).toHaveText('Beta.md');
  assert.equal(await raw(),other.toString());
  checks.push('search-and-open-use-existing-document-path');

  stage('unsaved-switch-protection-and-first-save');
  await page.locator('#sidebar-new').click();await expect(page.locator('#filename')).toHaveText('未命名.md');
  const draft='# 侧栏新笔记\n\n保留未保存内容。';await page.keyboard.insertText(draft);
  await entry('Alpha.md').click();await expect(page.locator('#filename')).toHaveText('未命名.md ·');assert.equal(await raw(),draft);
  const newPath=join(dir,'侧栏新笔记.md');
  await app.evaluate((_electron,filePath)=>{globalThis.noteLibrarySave={canceled:false,filePath};},newPath);
  await page.locator('#sidebar-save').click();await expect(page.locator('#save-feedback')).toContainText('已保存到磁盘 · 侧栏新笔记.md');
  await expect(page.locator('.library-unsaved')).toBeHidden();
  assert.equal(await readFile(newPath,'utf8'),draft);await expect(entry('侧栏新笔记.md')).toBeVisible();
  checks.push('sidebar-new-preserves-unsaved-draft-on-cancel-and-registers-first-save');

  stage('missing-entry-and-group-removal');
  await unlink(b);await page.evaluate(()=>window.desktop.request('library-list'));
  await entry('Beta.md').click();await expect(page.locator('#library-status')).toContainText(/无法打开|已不在原位置/);
  await expect(page.locator('#filename')).toHaveText('侧栏新笔记.md');
  await groupNode.getByRole('button',{name:'移除分组',exact:true}).hover();await groupNode.getByRole('button',{name:'移除分组',exact:true}).click();
  await expect.poll(async()=>(await metadata()).groups.length).toBe(0);
  assert.deepEqual(await readFile(a),original);assert.equal(await readFile(newPath,'utf8'),draft);
  checks.push('missing-file-does-not-replace-current-note-and-group-removal-keeps-documents');

  stage('cross-window-metadata');
  const secondWindow=app.waitForEvent('window');await page.evaluate(()=>window.desktop.request('new-window'));
  const second=await secondWindow;second.setDefaultTimeout(10000);
  second.on('pageerror',error=>errors.push(error.message));
  await expect(second.locator('.library-tile').filter({hasText:'Alpha'})).toBeVisible();
  await menu('侧栏新笔记.md','置顶');await expect(second.locator('#library-groups-panel .library-item').filter({hasText:'侧栏新笔记'}).first()).toContainText('置顶');
  await sample('multiple-windows');
  checks.push('metadata-changes-refresh-another-live-window');

  stage('recent-removal-refreshes-another-window');
  await second.getByRole('tab',{name:'最近打开',exact:true}).click();
  await expect(second.getByRole('button',{name:'打开：侧栏新笔记.md',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'最近打开',exact:true}).click();
  await menu('侧栏新笔记.md','从最近打开移除');
  await expect(second.locator('#library-recent-panel .library-item').filter({hasText:'侧栏新笔记'})).toHaveCount(0);
  await page.getByRole('tab',{name:'分组',exact:true}).click();await expect(entry('侧栏新笔记.md')).toBeVisible();
  assert.equal(await readFile(newPath,'utf8'),draft);
  checks.push('recent-removal-refreshes-other-window-and-retains-group-entry-and-file');

  stage('external-conflict-keeps-original-and-allows-copy');
  await entry('Alpha.md').click();await expect(page.locator('#filename')).toHaveText('Alpha.md');
  await writeFile(a,'external\n');
  await page.locator('#code').click();await page.locator('.cm-content').click();await page.keyboard.press('Control+End');
  await page.keyboard.insertText('追加内容');await expect(page.locator('#retry-save')).toBeVisible();
  await page.locator('#save').click();await expect(page.locator('#error')).toBeVisible();await expect(page.locator('#save-feedback')).toBeHidden();
  assert.equal(await readFile(a,'utf8'),'external\n');
  await app.evaluate((_electron,filePath)=>{globalThis.noteLibrarySave={canceled:false,filePath};},copy);
  await page.locator('#error-save-as').click();await expect(page.locator('#filename')).toHaveText('Conflict-copy.md');
  assert.deepEqual(await readFile(copy),Buffer.concat([original,Buffer.from('追加内容')]));
  assert.equal(await readFile(a,'utf8'),'external\n');
  checks.push('conflict-does-not-show-success-or-overwrite-external-bytes-and-copy-retains-source');

  stage('metadata-failure-does-not-block-document-save');
  await writeFile(join(profile,'library.json'),'{corrupt');
  await page.locator('#sidebar-toggle').click();await expect(page.locator('#document-sidebar')).toBeHidden();
  await expect(page.locator('#library-notice')).toBeVisible();await expect(page.locator('#library-notice')).toContainText('未能记住');
  await page.locator('#save').click();await expect(page.locator('#save-feedback')).toContainText('已保存到磁盘 · Conflict-copy.md');
  assert.equal(await readFile(join(profile,'library.json'),'utf8'),'{corrupt');
  assert.deepEqual(await readFile(copy),Buffer.concat([original,Buffer.from('追加内容')]));
  checks.push('damaged-sidebar-metadata-is-not-overwritten-and-file-save-still-works');
  await sample('complete');assert.deepEqual(errors,[]);
  await writeFile(join(output,'library-ui.json'),JSON.stringify({passed:true,checks,errors,native,scope:'Hidden Electron renderer/IPC, synthetic profiles and exact file bytes; live native save tested separately'},null,2));
  console.log(JSON.stringify({passed:true,checks,errors,output}));
} catch(error) {
  await writeFile(join(output,'library-failure.json'),JSON.stringify({passed:false,checks,errors,native,error:String(error?.stack||error),status:await page?.locator('#library-status').textContent().catch(()=>null)},null,2));
  throw error;
} finally {
  await stop();
  assert.ok(dir.startsWith(join(tmpdir(),'note-library-ui-')));
  await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
