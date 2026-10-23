import './hidden-launch.mjs';
import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname} from 'node:path';
import assert from 'node:assert/strict';
import {updateLibrary} from '../library-state.mjs';

// Reproductions found during ordinary sidebar use. Dialogs and files are
// isolated; UI state, real IPC and persisted metadata are checked together.
const dir=await mkdtemp(join(tmpdir(),'note-library-usage-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-library-usage-evidence-'));
const profile=join(dir,'profile'),a=join(dir,'Alpha.md'),b=join(dir,'Beta.md');
await mkdir(profile,{recursive:true});await mkdir(output,{recursive:true});
await writeFile(a,'# Alpha\n\n正文。\n');await writeFile(b,'# Beta\n\n另一篇。\n');
let record=await updateLibrary(profile,{type:'group-add',name:'折叠的资料'});
const group=record.groups[0];
await updateLibrary(profile,{type:'remember',path:a});
await updateLibrary(profile,{type:'item-update',path:b,groupId:group.id});
await updateLibrary(profile,{type:'group-collapse',id:group.id,collapsed:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const checks=[],failures=[],errors=[];
let app,page;
const snapshot=async()=>page.evaluate(()=>({
  sidebarHidden:document.getElementById('document-sidebar').hidden,
  sidebarExpanded:document.getElementById('sidebar-toggle').getAttribute('aria-expanded'),
  menus:document.querySelectorAll('.library-menu').length,
  search:document.querySelector('.library-search-input').value,
  current:[...document.querySelectorAll('.library-item[aria-current],.library-tile.is-current')].map(el=>el.dataset.path),
  unsavedVisible:document.querySelector('.library-unsaved').checkVisibility(),
  status:document.getElementById('library-status').textContent,
}));
const check=async(name,run)=>{
  console.log('STAGE '+name);
  try {await run();checks.push(name);}
  catch(error){failures.push({name,error:String(error?.message||error),state:await snapshot()});}
  await writeFile(join(output,'library-usage.json'),JSON.stringify({checks,failures,errors},null,2));
};
try {
  app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),a,'--user-data-dir='+profile],env,timeout:30000});
  page=await app.firstWindow();page.setDefaultTimeout(4000);
  page.on('pageerror',error=>errors.push(error.message));
  await expect(page.locator('#filename')).toHaveText('Alpha.md');
  await expect(page.locator('#library-groups-panel .library-item').filter({hasText:'Alpha'})).toBeVisible();
  await app.evaluate(()=>globalThis.installDialogs({showMessageBox:async()=>({response:1}),showSaveDialog:async()=>({canceled:true}),showOpenDialog:async()=>({canceled:true,filePaths:[]})}));
  const search=page.getByRole('searchbox',{name:'搜索文件名'});
  await check('initial-empty-status-is-hidden',async()=>{
    await expect(page.locator('#library-status')).toBeHidden();
  });
  await check('folder-hints-start-near-the-document-with-full-path-in-tooltip',async()=>{
    const row=page.getByRole('button',{name:'打开：Alpha.md',exact:true});
    await expect(row.locator('.library-item-dir')).toHaveText(basename(dirname(a)));
    await expect(row).toHaveAttribute('title',a);
  });
  await check('search-reveals-match-in-collapsed-group-without-changing-preference',async()=>{
    await search.fill('Beta');
    await expect(page.locator('#library-groups-panel .library-item').filter({hasText:'Beta'})).toBeVisible();
    const disk=JSON.parse(await readFile(join(profile,'library.json'),'utf8'));
    assert.equal(disk.groups[0].collapsed,true);
  });
  await search.fill('');
  await check('search-no-results-is-explained',async()=>{
    await search.fill('no-such-document-20261020');
    await expect(page.locator('.library-search-empty')).toBeVisible();
    await expect(page.locator('.library-search-empty')).toContainText('没有找到');
  });
  await search.fill('');
  await check('group-fold-intent-survives-immediate-search-render',async()=>{
    await page.locator(`details[data-group-id="${group.id}"] summary`).evaluate(summary=>{
      summary.click();
      const input=document.querySelector('.library-search-input');
      input.value='Alpha';input.dispatchEvent(new Event('input',{bubbles:true}));
      input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await expect.poll(async()=>JSON.parse(await readFile(join(profile,'library.json'),'utf8')).groups[0].collapsed).toBe(false);
    await expect(page.locator(`details[data-group-id="${group.id}"] .library-item`)).toBeVisible();
  });
  await check('rapid-two-toggles-retain-original-expanded-state',async()=>{
    await page.locator('#sidebar-toggle').evaluate(button=>{button.click();button.click();});
    // Two UI intents occur within one task, before disk can acknowledge either.
    await page.waitForTimeout(500);
    await expect(page.locator('#document-sidebar')).toBeVisible();
    assert.equal(JSON.parse(await readFile(join(profile,'library.json'),'utf8')).collapsed,false);
  });
  if(!await page.locator('#document-sidebar').isVisible())await page.locator('#sidebar-toggle').click();
  await check('keyboard-collapse-closes-portaled-menu',async()=>{
    const more=page.getByRole('button',{name:'更多操作：Alpha.md',exact:true});
    await more.hover();await more.click();
    await expect(page.locator('.library-menu')).toBeVisible();
    await page.keyboard.press('F9');
    await expect(page.locator('#document-sidebar')).toBeHidden();
    await expect(page.locator('.library-menu')).toHaveCount(0);
    await expect(page.locator('#sidebar-toggle')).toBeFocused();
  });
  if(!await page.locator('#document-sidebar').isVisible())await page.locator('#sidebar-toggle').click();
  await check('same-pane-new-and-open-immediately-update-active-and-unsaved-state',async()=>{
    await page.locator('#sidebar-new').click();
    await expect(page.locator('.library-unsaved')).toBeVisible();
    await expect(page.locator('#library-groups-panel .library-item[aria-current]')).toHaveCount(0);
    await page.locator('#library-groups-panel .library-item').filter({hasText:'Alpha'}).click();
    await expect(page.locator('.library-unsaved')).toBeHidden();
    await expect(page.locator('#library-groups-panel .library-item[aria-current]')).toContainText('Alpha');
  });
  await check('late-save-cannot-restore-removed-entry-but-later-explicit-open-can',async()=>{
    await app.evaluate((_electron,filePath)=>{
      globalThis.libraryDelayedSaveStarted=false;
      globalThis.installDialogs({showSaveDialog:async()=>{
        globalThis.libraryDelayedSaveStarted=true;
        await new Promise(resolve=>{globalThis.releaseLibraryDelayedSave=resolve;});
        return {canceled:false,filePath};
      }});
    },b);
    const saving=page.evaluate(()=>window.desktop.request('save-as',{raw:'# Beta\n\n另一篇。\n',name:'Beta.md'}));
    try {
      await expect.poll(()=>app.evaluate(()=>globalThis.libraryDelayedSaveStarted)).toBe(true);
      await page.evaluate(path=>window.desktop.request('library-update',{type:'item-remove',path}),b);
    } finally {
      await app.evaluate(()=>globalThis.releaseLibraryDelayedSave?.());
      await saving;
    }
    const after=await page.evaluate(()=>window.desktop.request('library-list'));
    assert.ok(!after.items.some(item=>item.path===b),'An older in-flight save resurrected the removed document entry');
    await page.evaluate(path=>window.desktop.request('open-recent',{path}),b);
    const reopened=await page.evaluate(()=>window.desktop.request('library-list'));
    assert.ok(reopened.items.some(item=>item.path===b),'An explicit later open must restore its document entry');
  });
  await check('menu-keyboard-navigation-preserves-select-keys-and-focus',async()=>{
    const more=page.getByRole('button',{name:'更多操作：Beta.md',exact:true});
    const metadataGroupId=async()=>{
      const item=JSON.parse(await readFile(join(profile,'library.json'),'utf8')).items.find(item=>item.path===b);
      return item?.groupId ?? null;
    };
    const openMenu=async()=>{
      await more.click();
      const menu=page.locator('.library-menu');
      await expect(menu).toBeVisible();
      return menu;
    };
    const chooseGroup=async groupId=>{
      const menu=await openMenu();
      await menu.getByRole('combobox',{name:'移至分组：Beta.md',exact:true}).selectOption(groupId??'__ungrouped__');
      await expect(menu).toHaveCount(0);
      await expect.poll(metadataGroupId).toBe(groupId??null);
    };
    const pressSelectKey=async(key,expectedGroupId)=>{
      const menu=await openMenu();
      const select=menu.getByRole('combobox',{name:'移至分组：Beta.md',exact:true});
      await select.focus();
      await page.keyboard.press(key);
      await expect(menu).toHaveCount(0);
      await expect.poll(metadataGroupId).toBe(expectedGroupId);
    };
    const originalGroupId=await metadataGroupId();
    const menu=await openMenu();
    const items=menu.getByRole('menuitem');
    const first=items.first(),last=items.last();
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(last).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(last).toBeFocused();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    const tabMenu=await openMenu();
    await tabMenu.getByRole('menuitem').last().focus();
    await page.keyboard.press('Tab');
    await expect(tabMenu).toHaveCount(0);

    await chooseGroup(group.id);
    await pressSelectKey('Home',null);
    await pressSelectKey('End',group.id);
    await pressSelectKey('ArrowUp',null);
    await pressSelectKey('ArrowDown',group.id);
    await chooseGroup(originalGroupId);
    assert.equal(await metadataGroupId(),originalGroupId);
  });
  await check('narrow-sidebar-menu-dialog-theme-and-keyboard-focus-remain-usable',async()=>{
    await page.setViewportSize({width:720,height:600});
    const bounds=await page.locator('#document-sidebar').evaluate(el=>{
      const r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.ok(bounds.left>=0&&bounds.right<=bounds.viewport&&!bounds.overflow,JSON.stringify(bounds));
    const more=page.getByRole('button',{name:'更多操作：Beta.md',exact:true});
    await more.hover();await more.click();await expect(page.locator('.library-menu')).toBeVisible();
    assert.ok(await page.locator('.library-menu').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));
    await page.keyboard.press('Escape');await expect(page.locator('.library-menu')).toHaveCount(0);await expect(more).toBeFocused();
    await page.locator('#sidebar-add-group').click();await expect(page.locator('#library-group-name')).toBeFocused();
    await page.keyboard.press('F9');await expect(page.locator('#document-sidebar')).toBeVisible();
    await expect(page.locator('#library-group-dialog')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.locator('#library-group-dialog')).toBeHidden();
    const before=await readFile(b),dark=await page.locator('html').evaluate(el=>el.classList.contains('dark'));
    await page.locator('#theme').click();await expect.poll(()=>page.locator('html').evaluate(el=>el.classList.contains('dark'))).toBe(!dark);
    assert.deepEqual(await readFile(b),before);await page.locator('#theme').click();
    await page.setViewportSize({width:1180,height:820});
  });
  await check('group-create-and-rename-reject-duplicates-and-repeated-submit-adds-once',async()=>{
    const before=JSON.parse(await readFile(join(profile,'library.json'),'utf8'));
    await page.locator('#sidebar-add-group').click();
    await page.locator('#library-group-name').fill('  折叠的资料  ');
    await page.locator('#library-group-form button[type=submit]').click();
    await expect(page.locator('.library-dialog-status')).toContainText('同名分组');
    await expect(page.locator('#library-group-name')).toBeFocused();
    assert.deepEqual(JSON.parse(await readFile(join(profile,'library.json'),'utf8')),before);
    await page.locator('#library-group-name').fill('独立的分组');
    await page.locator('#library-group-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
    await expect(page.locator('#library-group-dialog')).toBeHidden();
    await expect.poll(async()=>JSON.parse(await readFile(join(profile,'library.json'),'utf8')).groups.length).toBe(before.groups.length+1);
    const created=page.locator('.library-group').filter({has:page.locator('.library-group-name',{hasText:'独立的分组'})});
    await created.locator('summary').hover();await created.getByRole('button',{name:'重命名分组',exact:true}).click();
    await page.locator('#library-group-name').fill('折叠的资料');
    await page.locator('#library-group-form button[type=submit]').click();
    await expect(page.locator('.library-dialog-status')).toContainText('同名分组');
    await page.keyboard.press('Escape');
    const after=JSON.parse(await readFile(join(profile,'library.json'),'utf8'));
    assert.equal(after.groups.filter(item=>item.name==='独立的分组').length,1);
    assert.deepEqual(after.items,before.items);
    assert.equal(await readFile(a,'utf8'),'# Alpha\n\n正文。\n');
  });
  await check('group-node-and-last-fold-intent-survive-refresh',async()=>{
    const details=page.locator(`details[data-group-id="${group.id}"]`);
    await details.evaluate(node=>{node.__sameGroup=true;const summary=node.querySelector('summary');summary.click();summary.click();});
    await expect(details.locator('summary')).toHaveAttribute('aria-busy','false');
    await expect.poll(async()=>JSON.parse(await readFile(join(profile,'library.json'),'utf8')).groups.find(item=>item.id===group.id).collapsed).toBe(false);
    await expect(details).toHaveAttribute('open','');
    assert.equal(await details.evaluate(node=>node.__sameGroup),true,'Group refresh replaced the animated/focused details node');
    await expect(details.locator('summary')).toHaveAttribute('aria-expanded','true');
  });
  await check('metadata-error-still-allows-local-sidebar-collapse-and-preserves-bad-record',async()=>{
    await writeFile(join(profile,'library.json'),'{corrupt');
    await page.locator('#sidebar-add-group').click();await page.locator('#library-group-name').fill('保存失败时的分组');
    await page.locator('#library-group-form button[type=submit]').click();
    await expect(page.locator('.library-dialog-status')).toContainText('无法保存分组');
    await expect(page.locator('#library-group-name')).toBeEnabled();await expect(page.locator('#library-group-name')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('F9');
    await expect(page.locator('#document-sidebar')).toBeHidden();
    assert.equal(await readFile(join(profile,'library.json'),'utf8'),'{corrupt');
  });
  const native=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(win=>({visible:win.isVisible(),focused:win.isFocused()})));
  assert.ok(native.length && native.every(win=>!win.visible&&!win.focused));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:failures.length===0,checks,failures,native,output}));
  if(failures.length)process.exitCode=1;
} finally {
  if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
  assert.ok(dir.startsWith(join(tmpdir(),'note-library-usage-')));
  await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
