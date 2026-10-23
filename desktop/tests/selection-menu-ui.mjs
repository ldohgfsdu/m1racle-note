// Browser plugin not available. Validate the actual Electron renderer with Playwright.
import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {captureHidden} from './evidence-capture.mjs';
const dir=await mkdtemp(join(tmpdir(),'note-selection-menu-')),path=join(dir,'选区编辑.md'),output=process.env.NOTE_QA_OUTPUT || join(tmpdir(),'m1racle-note-selection-menu');
const raw='\ufeff# 选中文字，就地编辑\r\n\r\nHello Windows world.\n\n继续写下你的想法。\n\nAuthority chain: `M1racle Note0.1.md` → `M1racle Note0.2.md` → **本文件（产品定义与架构约束）**\r\n\r\n结束。\n';
await writeFile(path,raw);await mkdir(output,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),path,'--user-data-dir='+join(dir,'profile')],env});
try {
  const page=await app.firstWindow(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.locator('#filename').filter({hasText:'选区编辑.md'}).waitFor();
  await app.evaluate(async({clipboard})=>{globalThis.noteClipboard=await clipboard.read();});
  const menu=page.locator('#selection-menu'),bytes=()=>readFile(path,'utf8'),geometry=[];
  const assertPaneBounds=async label=>{
    const result=await page.evaluate(()=>{
      const r=element=>element.getBoundingClientRect().toJSON();
      const content=document.querySelector('.cm-content:focus') || document.querySelector('.pane.is-active .cm-content') || document.querySelector('.cm-content');
      const view=content.cmTile.root.view;
      return {pane:r(view.scrollDOM),menu:r(document.getElementById('selection-menu')),panels:[...document.querySelectorAll('#selection-menu .selection-options:not([hidden])')].map(r)};
    });geometry.push({label,...result});
    await writeFile(join(output,'pane-geometry.json'),JSON.stringify(geometry,null,2));
    for(const box of [result.menu,...result.panels]){
      assert.ok(box.left>=result.pane.left+12-.5,label+' left '+JSON.stringify(result));
      assert.ok(box.right<=result.pane.right-12+.5,label+' right '+JSON.stringify(result));
      assert.ok(box.top>=result.pane.top-.5 && box.bottom<=result.pane.bottom+.5,label+' vertical '+JSON.stringify(result));
    }
  };
  assert.equal(await menu.isVisible(),false);
  const select=async()=>{
    await page.locator('.cm-line').filter({hasText:'Hello Windows world.'}).click();await page.keyboard.press('Home');
    for(let i=0;i<6;i++)await page.keyboard.press('ArrowRight');
    for(let i=0;i<7;i++)await page.keyboard.press('Shift+ArrowRight');
    await menu.waitFor();
  };
  await select();
  await assertPaneBounds('wide');
  await menu.locator('[data-selection-format=italic]').hover();await page.locator('.style-preview-italic').waitFor();
  assert.equal(await page.locator('.style-preview-italic').innerText(),'Windows');assert.equal(await bytes(),raw);
  await captureHidden(app,page,join(output,'hover.png'));
  await menu.locator('[data-selection-format=italic]').click();
  const styled=raw.replace('Windows','*Windows*');await expect.poll(bytes).toBe(styled);
  assert.equal((await page.locator('.cm-content').innerText()).includes('*Windows*'),false);
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();
  await page.locator('#undo').click();await expect.poll(bytes).toBe(raw);
  await select();await page.keyboard.press('Alt+F10');
  assert.equal(await menu.locator('[data-selection-format=bold]').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('ArrowRight');assert.equal(await menu.locator('[data-selection-format=italic]').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();
  await select();await menu.locator('[data-selection-command=copy]').click();
  await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe('Windows');assert.equal(await bytes(),raw);
  await select();await menu.locator('[data-selection-command=cut]').click();
  await expect.poll(bytes).toBe(raw.replace('Windows',''));await page.locator('#undo').click();await expect.poll(bytes).toBe(raw);
  await select();await app.evaluate(({clipboard})=>clipboard.writeText('新 🌱\n下一行'));
  await page.keyboard.press('Control+v');await expect.poll(bytes).toBe(raw.replace('Windows','新 🌱\r\n下一行'));
  await page.locator('#undo').click();await expect.poll(bytes).toBe(raw);
  await select();await menu.locator('[data-selection-format=link]').click();await page.locator('#insert-dialog').waitFor();
  assert.equal(await page.locator('#insert-label').inputValue(),'Windows');await expect(menu).toBeHidden();await page.locator('#insert-cancel').click();assert.equal(await bytes(),raw);
  const doc=raw.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n'),from=doc.indexOf('→ **本文件'),to=doc.indexOf('\n',from)+1,compactChecks=[];
  const editorState=()=>page.locator('.cm-content').evaluate(el=>{const v=el.cmTile.root.view,s=v.state.selection.main;return {doc:v.state.doc.toString(),anchor:s.anchor,head:s.head};});
  const drag=async(anchor,head)=>{
    await page.locator('.cm-line').filter({hasText:'结束。'}).click();
    const coords=await page.locator('.cm-content').evaluate((el,[a,h])=>{
      const v=el.cmTile.root.view,p=pos=>{const r=v.coordsAtPos(pos);return {x:r.left+1,y:(r.top+r.bottom)/2};};return [p(a),p(h)];
    },[anchor,head]);
    await page.mouse.move(coords[0].x,coords[0].y);await page.mouse.down();await page.mouse.move(coords[1].x,coords[1].y,{steps:12});await page.mouse.up();
    await expect.poll(editorState).toEqual({doc,anchor,head});
  };
  for(const dark of [false,true]) {
    if(dark!==await page.evaluate(()=>document.documentElement.classList.contains('dark')))await page.locator('#theme').click();
    await drag(from,to);
    await expect.poll(()=>page.locator('.cm-compactSelectionLayer .cm-selectionBackground').count()).toBe(2);
    const g=await page.locator('.cm-content').evaluate((el,to)=>{
      const v=el.cmTile.root.view,r=el=>el.getBoundingClientRect().toJSON();return {end:v.coordsAtPos(to-1),charWidth:v.defaultCharacterWidth,markers:[...document.querySelectorAll('.cm-compactSelectionLayer .cm-selectionBackground')].map(r)};
    },to);
    for(const r of g.markers) {
      assert.ok(r.right<=g.end.right+g.charWidth/2+2,'selection stops at text plus compact newline marker');
      assert.ok(r.bottom<=g.end.bottom+1,'no rectangle on the unselected next line');
    }
    await expect(menu).toBeVisible();await page.keyboard.press('Escape');
    await expect.poll(editorState).toEqual({doc,anchor:from,head:to});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await captureHidden(app,page,join(output,`compact-newline-${dark?'dark':'light'}.png`));
    await page.keyboard.press('Shift+ArrowRight');await expect.poll(async()=>(await editorState()).head).toBe(to+1);
    const blank=await page.locator('.cm-compactSelectionLayer .cm-selectionBackground').last().boundingBox();
    assert.ok(blank.width<=g.charWidth,'selected empty line uses a compact marker');
    await page.keyboard.press('Shift+ArrowLeft');await expect.poll(async()=>(await editorState()).head).toBe(to);
    // Reopen the toolbar with a fresh pointer selection before testing copy.
    await drag(from,to);await expect(menu).toBeVisible();
    await menu.locator('[data-selection-command=copy]').click();
    await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe(doc.slice(from,to));
    await page.keyboard.press('Backspace');await expect.poll(async()=>(await editorState()).doc).toBe(doc.slice(0,from)+doc.slice(to));
    await page.locator('#undo').click();await expect.poll(bytes).toBe(raw);await expect.poll(async()=>(await editorState()).doc).toBe(doc);
    await drag(to,from);await expect.poll(editorState).toEqual({doc,anchor:to,head:from});
    compactChecks.push(`${dark?'dark':'light'}-compact-newline-empty-line-copy-delete-undo-reverse`);
  }
  await select();
  const beforeOutside=await editorState();
  await page.keyboard.press('Alt+F10');
  await page.getByRole('searchbox',{name:'搜索文件名'}).click();
  await expect(menu).toBeHidden();await expect(page.getByRole('searchbox',{name:'搜索文件名'})).toBeFocused();
  assert.deepEqual(await editorState(),beforeOutside);
  await page.setViewportSize({width:720,height:600});await expect(menu).toBeHidden();
  await select();await assertPaneBounds('720px');
  await menu.locator('[data-selection-submenu=text]').click();await expect(page.locator('#selection-text-options')).toBeVisible();
  await assertPaneBounds('720px-heading-submenu');await page.keyboard.press('Escape');
  const beforeSave=await editorState();await page.locator('#save').click();
  await expect(menu).toBeHidden();assert.deepEqual(await editorState(),beforeSave);assert.equal(await bytes(),raw);
  await select();const beforeShortcut=await editorState();await page.keyboard.press('Control+s');
  await expect(menu).toBeHidden();assert.deepEqual(await editorState(),beforeShortcut);assert.equal(await bytes(),raw);
  await select();
  const bounds=await menu.boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=720);assert.ok(bounds.y>=80 && bounds.y+bounds.height<=576);
  await page.locator('#theme').click();await select();await captureHidden(app,page,join(output,'night-720.png'));
  const beforeToggle=await editorState();
  for(const visible of [false,true]){
    await page.keyboard.press('F9');
    if(visible)await expect(page.locator('#document-sidebar')).toBeVisible();
    else await expect(page.locator('#document-sidebar')).toBeHidden();
    await expect.poll(()=>page.locator('.cm-content').evaluate(element=>{
      const pane=element.cmTile.root.view.scrollDOM.getBoundingClientRect(),menu=document.getElementById('selection-menu').getBoundingClientRect();
      return menu.left>=pane.left+12-.5 && menu.right<=pane.right-12+.5;
    })).toBe(true);
    await expect(menu).toBeVisible();await assertPaneBounds(visible?'keyboard-sidebar-shown':'keyboard-sidebar-hidden');
    assert.deepEqual(await editorState(),beforeToggle);
  }
  await page.keyboard.press('Control+e');await expect(page.locator('.pane')).toHaveAttribute('data-mode','source');await expect(menu).toBeHidden();assert.equal(await bytes(),raw);
  await page.locator('#read').click();await page.setViewportSize({width:1200,height:800});
  await page.locator('.cm-content').evaluate(el=>el.cmTile.root.view.focus());await page.keyboard.press('Control+\\');
  await expect(page.locator('.pane')).toHaveCount(2);
  await page.locator('#pane-primary .cm-content').evaluate(el=>{
    const view=el.cmTile.root.view,from=view.state.doc.toString().indexOf('Windows');
    view.focus();view.dispatch({selection:{anchor:from,head:from+7}});
  });
  await expect(menu).toBeVisible();await assertPaneBounds('split-pane');
  await menu.locator('[data-selection-submenu=text]').click();await expect(page.locator('#selection-text-options')).toBeVisible();
  await assertPaneBounds('split-heading-submenu');
  assert.equal(await bytes(),raw);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,visual:'VISUAL_UNVERIFIED',checks:['selection-only','hover-no-write','format-with-selection-preserved','escape-dismiss','keyboard-access','native-copy','native-cut-and-undo','native-multiline-paste-and-undo','link-selection-retained',...compactChecks,'pane-and-submenu-clamping','outside-click-retains-selection-and-control-focus','manual-save-and-shortcut-dismiss-with-selection-retained','720px-clamping','keyboard-sidebar-resize-clamping','split-pane-clamping','dark-theme','source-mode-hidden','BOM-mixed-EOL-preserved','console-clean'],output}));
}finally {
  await app.evaluate(async({clipboard})=>{if(globalThis.noteClipboard)await clipboard.write(globalThis.noteClipboard);}).catch(()=>{});
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});
  await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
