import './hidden-launch.mjs';
import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {recordRecent} from '../recent-state.mjs';

// One hidden Electron window exercises the split/file-opening contract. Each
// pane owns its editor and save queue; native choosers and confirmations are
// controlled by the hidden test harness. Focus here is renderer/DOM focus, not
// physical Windows foreground focus, and menu geometry is not visual approval.
const dir=await mkdtemp(join(tmpdir(),'note-split-view-'));
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-split-view-evidence-'));
await mkdir(output,{recursive:true});
const sub=join(dir,'子目录'),profile=join(dir,'profile');
await mkdir(sub),await mkdir(profile);
const a=join(dir,'对照原文.md'),b=join(sub,'摘录.md'),down=join(dir,'下方文档.md');
const targeted=join(dir,'定向打开.md'),sidebarDoc=join(dir,'侧栏文档.md');
const cancelChoice=join(dir,'取消目标.md'),saveChoice=join(dir,'保存目标.md');
const discardChoice=join(dir,'丢弃目标.md'),savedDraft=join(dir,'保存后的草稿.md');
const overwriteTarget=join(dir,'覆盖目标.md');
const bomDoc=join(dir,'BOM混合换行.md'),missing=join(dir,'不存在.md');
const outerLeftDoc=join(dir,'外枝左.md'),outerRightDoc=join(dir,'外枝右.md'),outerDownDoc=join(dir,'外枝下.md');
const outerUnusedDoc=join(dir,'外枝未用.md');
const rawA='# 对照原文\n\n![一](pic-one.png)\n\n这里是原文。\n';
const rawB='# 摘录\n\n![二](pic-two.png)\n\n笔记从这里开始。\n';
const rawDown='# 下方文档\n\n向下打开后保持独立。\n';
const rawTargeted='# 定向打开\n\n文件必须进入指定的窗格。\n';
const rawSidebar='# 侧栏文档\n\n从文档侧栏进入当前空白分屏。\n';
const rawCancel='# 取消目标\n\n取消文件选择时不能改变这里。\n';
const rawSave='# 保存目标\n\n保存草稿后再打开这里。\n';
const rawDiscard='# 丢弃目标\n\n放弃草稿后打开这里。\n';
const rawOverwriteOld='# 旧覆盖目标\n\n这段旧内容不能重新进入编辑器。\n';
const overwriteDraft='# 覆盖保存草稿\n\n这份草稿必须在打开目标后继续显示。\n';
const rawOuterLeft='# 外枝左\n\n关闭外层兄弟后仍可打开和保存。\n';
const rawOuterRight='# 外枝右\n\n外层关闭后的右侧后代仍可保存。\n';
const rawOuterDown='# 外枝下\n\n嵌套后代保持连接。\n';
const rawOuterUnused='# 外枝未用\n\n为原来的空右枝提供可打开文件。\n';
const rawBom=Buffer.from('\ufeff# 字节原样\r\n\r\n第一行\n第二行\r第三行\r\n结尾');
for(const [path,value] of [
  [a,rawA],[b,rawB],[down,rawDown],[targeted,rawTargeted],[sidebarDoc,rawSidebar],
  [cancelChoice,rawCancel],[saveChoice,rawSave],[discardChoice,rawDiscard],
  [overwriteTarget,rawOverwriteOld],[bomDoc,rawBom],
  [outerLeftDoc,rawOuterLeft],[outerRightDoc,rawOuterRight],[outerDownDoc,rawOuterDown],
  [outerUnusedDoc,rawOuterUnused],
])await writeFile(path,value);
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
await writeFile(join(dir,'pic-one.png'),pixel),await writeFile(join(sub,'pic-two.png'),pixel);
await recordRecent(profile,b),await recordRecent(profile,sidebarDoc);

const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY || resolve('desktop/main.mjs');
const electronPath=resolve('node_modules/electron/dist/electron.exe');
const checks=[],errors=[],geometry=[];let app,page,ended=false,lastStage='setup';
const stage=name=>{lastStage=name;console.log('STAGE '+name);};
const watch=page=>{
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',event=>{if(event.type()==='error')errors.push(event.text());});
  return page;
};
const normalized=raw=>raw.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n');
const pane=id=>page.locator(`.pane[data-pane="${id}"]`);
const content=pane=>pane.locator('.cm-content');
const paneText=pane=>content(pane).evaluate(element=>element.cmTile.root.view.state.doc.toString());
const waitPanes=async count=>{
  await expect.poll(()=>page.locator('.pane').count(),{timeout:15000}).toBe(count);
  // A pane exists before its opening animation has given it its final bounds.
  await expect.poll(()=>page.evaluate(()=>document.getAnimations().some(animation=>animation.id.startsWith('note-') && animation.playState==='running'))).toBe(false);
};
const countPaneBars=()=>page.locator('.pane-bar:visible').count();
const windowCount=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length);
const activePaneId=()=>page.evaluate(()=>document.querySelector('.pane.active')?.dataset.pane || null);
const paneIdByName=name=>page.locator('.pane').evaluateAll((nodes,name)=>{
  const found=nodes.find(node=>(node.querySelector('.pane-name')?.textContent || '').replace(/\s*·\s*$/,'').trim()===name);
  return found?.dataset.pane || null;
},name);
const waitPaneNamed=async name=>{
  await expect.poll(()=>paneIdByName(name),{timeout:15000}).toBeTruthy();
  return paneIdByName(name);
};
const menuOpen=()=>page.locator('#split-menu').evaluate(menu=>menu.matches(':popover-open'));
const openMenu=async trigger=>{
  await trigger.focus();await page.keyboard.press('Enter');
  await expect(page.locator('#split-menu')).toBeVisible();
  await expect.poll(menuOpen).toBe(true);
};
const splitAction=async action=>{
  await page.locator(`#split-menu [data-split-action="${action}"]`).click();
  await expect(page.locator('#split-menu')).toBeHidden();
};
const topSplit=async action=>{
  await openMenu(page.locator('#split-options'));
  await splitAction(action);
};
const paneOpenByKeyboard=async id=>{
  const button=pane(id).locator('.pane-bar [data-pane-action="open"]');
  await button.focus();await page.keyboard.press('Enter');
};
const paneStartOpenByKeyboard=async id=>{
  const button=pane(id).locator('.pane-start [data-pane-action="open"]');
  await button.focus();await page.keyboard.press('Enter');
};
const editorFocus=()=>page.evaluate(()=>({
  pane:document.activeElement?.closest?.('.pane')?.dataset.pane || null,
  editor:Boolean(document.activeElement?.closest?.('.cm-content')),
}));
const layoutAt=id=>page.evaluate(id=>{
  const target=document.querySelector(`.pane[data-pane="${id}"]`);
  if(!target)return null;
  const slot=target.parentElement,parent=slot?.parentElement;
  if(!parent?.classList.contains('split'))return {dir:null,slot:null};
  const slots=[...parent.children].filter(child=>child.classList.contains('slot'));
  return {dir:parent.dataset.dir,slot:slots.indexOf(slot)};
},id);
const layoutNear=async(id,expected)=>{
  let actual=null;
  await expect.poll(async()=>actual=await layoutAt(id),{timeout:15000}).toEqual(expected);
  assert.deepEqual(actual,expected);
};
const appendAndWait=async(id,path,marker)=>{
  await focusEditor(id);await page.keyboard.press('Control+End');await page.keyboard.insertText(marker);
  await expect.poll(()=>readFile(path,'utf8'),{timeout:10000}).toContain(marker);
};
const focusEditor=async id=>{
  const focused=await page.evaluate(id=>{
    const host=document.querySelector(`.pane[data-pane="${id}"] .cm-content`);
    host?.focus();
    return Boolean(host && document.activeElement===host);
  },id);
  assert.equal(focused,true,`无法聚焦窗格 ${id} 的编辑器`);
};
const appendAndOpenNow=async(id,marker)=>{
  await page.evaluate(({id,marker})=>{
    const target=document.querySelector(`.pane[data-pane="${id}"]`),host=target.querySelector('.cm-content');
    host.focus();
    const view=host.cmTile.root.view,at=view.state.doc.length;
    view.dispatch({changes:{from:at,to:at,insert:marker},selection:{anchor:at+marker.length}});
    target.querySelector('.pane-bar [data-pane-action="open"]').click();
  },{id,marker});
};
const callTypesSince=base=>app.evaluate((_electron,base)=>globalThis.noteQaDialogs.calls.slice(base).map(call=>call.type),base);

try {
  app=await electron.launch({executablePath:electronPath,args:[entry,a,'--user-data-dir='+profile],env,timeout:30000});
  page=watch(await app.firstWindow());page.setDefaultTimeout(15000);
  await page.locator('#filename').filter({hasText:'对照原文.md'}).waitFor();
  await app.evaluate(()=>{
    globalThis.noteQaDialogs={open:[],save:[],confirm:[],calls:[]};
    globalThis.installDialogs({
      showOpenDialog:async(...args)=>{const result=globalThis.noteQaDialogs.open.shift() || {canceled:true,filePaths:[]};globalThis.noteQaDialogs.calls.push({type:'open',result,options:args.at(-1)});return result;},
      showSaveDialog:async(...args)=>{const result=globalThis.noteQaDialogs.save.shift() || {canceled:true};globalThis.noteQaDialogs.calls.push({type:'save',result,options:args.at(-1)});return result;},
      showMessageBox:async(...args)=>{const result=globalThis.noteQaDialogs.confirm.shift() || {response:1};globalThis.noteQaDialogs.calls.push({type:'confirm',result,options:args.at(-1)});return result;},
    });
  });
  const choose=(type,value)=>app.evaluate((_electron,{type,value})=>globalThis.noteQaDialogs[type].push(value),{type,value});
  const count=type=>app.evaluate((_electron,type)=>globalThis.noteQaDialogs.calls.filter(call=>call.type===type).length,type);
  const callBase=()=>app.evaluate(()=>globalThis.noteQaDialogs.calls.length);

  stage('single-pane-menu-keyboard-and-geometry');
  assert.equal(await page.locator('.pane').count(),1);
  assert.equal(await countPaneBars(),0);
  const nativeWindows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(win=>({
    visible:win.isVisible(),focused:win.isFocused(),
  })));
  assert.ok(nativeWindows.length && nativeWindows.every(win=>!win.visible && !win.focused));
  const topTrigger=page.locator('#split-options');
  await openMenu(topTrigger);
  assert.equal(await page.locator('#split-menu-title').textContent(),'对照原文.md');
  assert.equal(await page.locator('#split-menu [data-split-action]').first().evaluate(node=>node===document.activeElement),true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#split-menu [data-split-action]').nth(1).evaluate(node=>node===document.activeElement),true);
  const menuGeometry=await page.locator('#split-menu').evaluate(menu=>{
    const box=menu.getBoundingClientRect(),anchor=document.getElementById('split-options').getBoundingClientRect();
    return {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height,
      viewport:{width:innerWidth,height:innerHeight},anchor:{right:anchor.right,bottom:anchor.bottom}};
  });
  assert.ok(menuGeometry.left>=0 && menuGeometry.top>=0 && menuGeometry.right<=menuGeometry.viewport.width && menuGeometry.bottom<=menuGeometry.viewport.height);
  const unclamped=menuGeometry.anchor.right>=menuGeometry.width+8 && menuGeometry.anchor.right<=menuGeometry.viewport.width-8;
  if(unclamped)assert.ok(Math.abs(menuGeometry.right-menuGeometry.anchor.right)<=8);
  geometry.push({case:'topbar-menu',...menuGeometry});
  await page.keyboard.press('Escape');
  await expect(page.locator('#split-menu')).toBeHidden();
  assert.equal(await topTrigger.evaluate(node=>node===document.activeElement),true);
  await topTrigger.click();
  await expect(page.locator('#split-menu')).toBeVisible();
  await topTrigger.click();
  await expect(page.locator('#split-menu')).toBeHidden();
  assert.equal(await topTrigger.getAttribute('aria-expanded'),'false');
  assert.equal(await topTrigger.evaluate(node=>node===document.activeElement),true);
  await topTrigger.click();
  await expect(page.locator('#split-menu')).toBeVisible();
  const outsideBox=await page.locator('#filename').boundingBox();
  assert.ok(outsideBox);
  await page.mouse.click(outsideBox.x+4,outsideBox.y+outsideBox.height/2);
  await expect(page.locator('#split-menu')).toBeHidden();
  assert.equal(await topTrigger.getAttribute('aria-expanded'),'false');
  checks.push('single-pane-menu-supports-keyboard-repeat-click-and-outside-dismissal');

  stage('direct-open-right-and-cancel');
  await choose('open',{canceled:false,filePaths:[b]});
  await topSplit('split-open');
  await waitPanes(2);
  const rightId=await waitPaneNamed('摘录.md');
  assert.equal(await activePaneId(),rightId);
  assert.deepEqual(await layoutAt(rightId),{dir:'row',slot:1});
  const sourceBox=await pane('primary').boundingBox(),rightBox=await pane(rightId).boundingBox();
  assert.ok(rightBox.x>sourceBox.x && Math.abs(rightBox.y-sourceBox.y)<4);
  assert.equal(await paneText(pane('primary')),normalized(rawA));
  assert.equal(await paneText(pane(rightId)),normalized(rawB));
  assert.deepEqual(await editorFocus(),{pane:rightId,editor:true});
  const openBeforeCancel=await count('open'),confirmBeforeCancel=await count('confirm');
  await choose('open',{canceled:true,filePaths:[]});
  await topSplit('split-open');
  await expect.poll(()=>count('open')).toBe(openBeforeCancel+1);
  assert.equal(await page.locator('.pane').count(),2);
  assert.equal(await count('confirm'),confirmBeforeCancel);
  assert.equal(await paneText(pane(rightId)),normalized(rawB));
  assert.deepEqual(await editorFocus(),{pane:rightId,editor:true});
  checks.push('direct-open-right-targets-active-pane-and-cancel-adds-no-pane-or-confirm');

  stage('images-and-divider');
  const loadedImages=()=>page.evaluate(()=>[...document.querySelectorAll('.cm-content img[src]')].map(image=>({
    src:image.getAttribute('src'),ok:image.complete && image.naturalWidth>0,
  })));
  await expect.poll(async()=>{const images=await loadedImages();return images.length===2 && images.every(image=>image.ok);}).toBe(true);
  assert.deepEqual((await loadedImages()).map(image=>image.src).sort(),['pic-one.png','pic-two.png']);
  const rowSplit=page.locator('.split[data-dir=row]').first();
  const slotWidths=()=>rowSplit.evaluate(element=>[...element.children].filter(child=>child.classList.contains('slot')).map(slot=>slot.getBoundingClientRect().width));
  const widthsBefore=await slotWidths(),divider=rowSplit.locator(':scope > .divider'),dividerBox=await divider.boundingBox();
  assert.ok(dividerBox);
  await page.mouse.move(dividerBox.x+dividerBox.width/2,dividerBox.y+dividerBox.height/2);await page.mouse.down();
  await page.mouse.move(dividerBox.x+dividerBox.width/2+150,dividerBox.y+dividerBox.height/2,{steps:10});await page.mouse.up();
  const widthsAfter=await slotWidths();
  assert.ok(widthsAfter[0]-widthsBefore[0]>80 && widthsBefore[1]-widthsAfter[1]>80,`拖拽未改变分栏宽度: ${widthsBefore} -> ${widthsAfter}`);
  geometry.push({case:'divider',before:widthsBefore,after:widthsAfter});
  checks.push('pane-local-images-and-pointer-divider-resize');

  stage('direct-open-down');
  await choose('open',{canceled:false,filePaths:[down]});
  await topSplit('split-open-down');
  await waitPanes(3);
  const downId=await waitPaneNamed('下方文档.md');
  assert.equal(await activePaneId(),downId);
  await layoutNear(downId,{dir:'column',slot:1});
  await layoutNear(rightId,{dir:'column',slot:0});
  assert.deepEqual(await page.locator('.pane:visible').evaluateAll(nodes=>nodes.map(node=>node.dataset.pane)),['primary',rightId,downId]);
  const parentBox=await pane(rightId).boundingBox(),downBox=await pane(downId).boundingBox();
  assert.ok(downBox.y>parentBox.y && Math.abs(downBox.x-parentBox.x)<4);
  assert.equal(await paneText(pane(downId)),normalized(rawDown));
  assert.equal(await page.locator('.pane-start:visible').count(),0);
  assert.equal(await countPaneBars(),3);
  checks.push('direct-open-down-nests-below-selected-pane');

  stage('nested-close-keeps-sibling-panes');
  const confirmBeforeNestedClose=await count('confirm');
  await pane(rightId).locator('.pane-bar [data-pane-action="split-close"]').focus();
  await page.keyboard.press('Enter');
  await waitPanes(2);
  assert.equal(await pane(rightId).count(),0);
  assert.equal(await pane('primary').count(),1);
  assert.equal(await pane(downId).count(),1);
  assert.equal(await paneText(pane(downId)),normalized(rawDown));
  assert.equal(await count('confirm'),confirmBeforeNestedClose);
  await layoutNear(downId,{dir:'row',slot:1});
  checks.push('closing-sibling-of-nested-split-retains-other-panes');

  stage('per-pane-open-targets-inactive-pane');
  assert.equal(await activePaneId(),downId);
  const openBeforeTarget=await count('open'),confirmBeforeTarget=await count('confirm');
  await choose('open',{canceled:false,filePaths:[targeted]});
  await paneOpenByKeyboard('primary');
  await expect.poll(()=>paneIdByName('定向打开.md')).toBe('primary');
  assert.equal(await activePaneId(),'primary');
  assert.equal(await count('open'),openBeforeTarget+1);
  assert.equal(await count('confirm'),confirmBeforeTarget);
  assert.equal(await paneText(pane('primary')),normalized(rawTargeted));
  assert.equal(await paneText(pane(downId)),normalized(rawDown));
  assert.deepEqual(await editorFocus(),{pane:'primary',editor:true});
  checks.push('per-pane-open-keyboard-activation-replaces-exactly-inactive-target');

  stage('pane-menu-captures-target-and-sidebar-opens-blank');
  assert.equal(await activePaneId(),'primary');
  const targetLabel=await pane(downId).locator('.pane-name').textContent();
  await openMenu(pane(downId).locator('.pane-bar [data-pane-action="split-menu"]'));
  assert.equal(await page.locator('#split-menu-title').textContent(),targetLabel.replace(/\s*·\s*$/,''));
  assert.equal(await pane(downId).locator('[data-pane-action="split-menu"]').getAttribute('aria-expanded'),'true');
  await splitAction('split-right');
  await waitPanes(3);
  const sidebarPaneId=await activePaneId();
  assert.notEqual(sidebarPaneId,downId);
  assert.deepEqual(await layoutAt(downId),{dir:'row',slot:0});
  assert.deepEqual(await layoutAt(sidebarPaneId),{dir:'row',slot:1});
  assert.equal(await pane(downId).locator('[data-pane-action="split-menu"]').getAttribute('aria-expanded'),'false');
  assert.equal(await pane(sidebarPaneId).locator('.pane-start').isVisible(),true);
  assert.equal(await page.locator('.pane-start:visible').count(),1);
  await expect(page.getByRole('button',{name:'打开：侧栏文档.md',exact:true})).toBeVisible();
  const sidebarEntry=page.getByRole('button',{name:'打开：侧栏文档.md',exact:true});
  assert.equal(await sidebarEntry.getAttribute('data-path'),sidebarDoc);
  const openBeforeSidebar=await count('open'),confirmBeforeSidebar=await count('confirm');
  await sidebarEntry.click();
  await expect.poll(()=>pane(downId).count()).toBe(1);
  await expect.poll(()=>paneText(pane(sidebarPaneId))).toBe(normalized(rawSidebar));
  assert.equal(await page.locator('.pane').count(),3);
  assert.equal(await activePaneId(),sidebarPaneId);
  assert.equal(await pane(sidebarPaneId).locator('.pane-start').isVisible(),false);
  assert.equal(await count('open'),openBeforeSidebar);
  assert.equal(await count('confirm'),confirmBeforeSidebar);
  assert.deepEqual(await editorFocus(),{pane:sidebarPaneId,editor:true});
  checks.push('pane-menu-captures-inactive-target-and-sidebar-opens-new-active-blank');

  stage('unsaved-open-cancel-then-autosave');
  const sidebarId=sidebarPaneId;
  const cancelBase=await callBase(),markerCancel='取消后的修改先保留。',confirmsBeforeCancel=await count('confirm');
  const samePath=(left,right)=>String(left||'').replaceAll('\\','/').toLowerCase()===String(right||'').replaceAll('\\','/').toLowerCase();
  const cancelListing=async()=>{
    const {recent,library}=await page.evaluate(async()=>({
      recent:await window.desktop.request('recent-list'),
      library:await window.desktop.request('library-list'),
    }));
    return [...recent,...library.items].map(item=>item.path).filter(path=>typeof path==='string');
  };
  const assertCancelChoiceNotListed=async when=>{
    const paths=await cancelListing();
    assert.equal(paths.some(path=>samePath(path,cancelChoice)),false,`${when}不应记录取消选择的文件`);
  };
  await assertCancelChoiceNotListed('取消前');
  await choose('open',{canceled:false,filePaths:[cancelChoice]});
  await choose('confirm',{response:1});
  await appendAndOpenNow(sidebarId,markerCancel);
  await expect.poll(()=>count('confirm')).toBe(confirmsBeforeCancel+1);
  assert.deepEqual(await callTypesSince(cancelBase),['open','confirm']);
  assert.equal(await page.locator('.pane').count(),3);
  assert.equal(await activePaneId(),sidebarId);
  assert.equal(await paneText(pane(sidebarId)),normalized(rawSidebar)+markerCancel);
  assert.equal(await readFile(cancelChoice,'utf8'),rawCancel);
  await assertCancelChoiceNotListed('取消后');
  await appendAndWait(sidebarId,sidebarDoc,'取消后自动保存到原文件。');
  assert.equal(await readFile(cancelChoice,'utf8'),rawCancel);
  checks.push('unsaved-cancel-preserves-target-independent-autosave-and-omits-history');

  stage('unsaved-open-save-then-autosave');
  await topSplit('split-right');
  await waitPanes(4);
  const savePaneId=await activePaneId();
  assert.equal(await pane(savePaneId).locator('.pane-start').isVisible(),true);
  await focusEditor(savePaneId);await page.keyboard.insertText('尚未命名的保存草稿。');
  const saveBase=await callBase();
  await choose('open',{canceled:false,filePaths:[saveChoice]});
  await choose('confirm',{response:0});
  await choose('save',{canceled:false,filePath:savedDraft});
  await paneOpenByKeyboard(savePaneId);
  await expect.poll(()=>paneIdByName('保存目标.md')).toBe(savePaneId);
  assert.deepEqual(await callTypesSince(saveBase),['open','confirm','save']);
  assert.equal(await readFile(savedDraft,'utf8'),'尚未命名的保存草稿。');
  assert.equal(await readFile(saveChoice,'utf8'),rawSave);
  assert.equal(await page.locator('.pane').count(),4);
  assert.equal(await activePaneId(),savePaneId);
  assert.deepEqual(await editorFocus(),{pane:savePaneId,editor:true});
  checks.push('unsaved-save-writes-draft-then-opens-new-file-in-same-pane');

  stage('unsaved-save-as-selected-file-shows-accepted-bytes');
  await topSplit('split-right');
  await waitPanes(5);
  const overwritePaneId=await activePaneId();
  assert.equal(await pane(overwritePaneId).locator('.pane-start').isVisible(),true);
  await focusEditor(overwritePaneId);
  await page.keyboard.insertText(overwriteDraft);
  assert.equal(await paneText(pane(overwritePaneId)),normalized(overwriteDraft));
  const overwriteBase=await callBase();
  await choose('open',{canceled:false,filePaths:[overwriteTarget]});
  await choose('confirm',{response:0});
  await choose('save',{canceled:false,filePath:overwriteTarget});
  await paneOpenByKeyboard(overwritePaneId);
  await expect.poll(()=>paneIdByName('覆盖目标.md'),{timeout:15000}).toBe(overwritePaneId);
  await expect.poll(()=>paneText(pane(overwritePaneId))).toBe(normalized(overwriteDraft));
  assert.deepEqual(await callTypesSince(overwriteBase),['open','confirm','save']);
  assert.equal(await activePaneId(),overwritePaneId);
  assert.equal(await page.locator('#status').textContent(),'已保存');
  assert.notEqual(await paneText(pane(overwritePaneId)),normalized(rawOverwriteOld));
  assert.equal(await readFile(overwriteTarget,'utf8'),overwriteDraft);
  assert.deepEqual(await editorFocus(),{pane:overwritePaneId,editor:true});
  const overwriteMarker='继续自动保存。';
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(overwriteMarker);
  await expect.poll(()=>readFile(overwriteTarget,'utf8'),{timeout:10000}).toBe(overwriteDraft+overwriteMarker);
  checks.push('save-as-selected-file-shows-saved-draft-and-continues-autosave');
  await pane(overwritePaneId).locator('.pane-bar [data-pane-action="split-close"]').focus();
  await page.keyboard.press('Enter');
  await waitPanes(4);

  stage('unsaved-open-discard');
  await topSplit('split-right');
  await waitPanes(5);
  const discardPaneId=await activePaneId();
  await focusEditor(discardPaneId);await page.keyboard.insertText('这段草稿应被放弃。');
  const discardBase=await callBase(),savesBeforeDiscard=await count('save');
  await choose('open',{canceled:false,filePaths:[discardChoice]});
  await choose('confirm',{response:2});
  await paneOpenByKeyboard(discardPaneId);
  await expect.poll(()=>paneIdByName('丢弃目标.md')).toBe(discardPaneId);
  assert.deepEqual(await callTypesSince(discardBase),['open','confirm']);
  assert.equal(await count('save'),savesBeforeDiscard);
  assert.equal(await readFile(discardChoice,'utf8'),rawDiscard);
  assert.equal(await page.locator('.pane').count(),5);
  checks.push('unsaved-discard-loads-selection-without-saving-draft');

  stage('duplicate-open-switches-without-replacement');
  const downTitle=await pane(downId).locator('.pane-name').textContent();
  assert.match(downTitle,/下方文档\.md/);
  const duplicateMarker='重复打开后仍保存回原绑定。',confirmBeforeDuplicate=await count('confirm');
  const duplicateBase=await callBase();
  await choose('open',{canceled:false,filePaths:[targeted]});
  await appendAndOpenNow(downId,'准备重复打开的未保存内容。');
  await expect.poll(activePaneId).toBe('primary');
  assert.deepEqual(await callTypesSince(duplicateBase),['open']);
  assert.equal(await count('confirm'),confirmBeforeDuplicate);
  assert.equal(await page.locator('.pane').count(),5);
  assert.equal(await paneIdByName('定向打开.md'),'primary');
  assert.equal(await page.locator('.pane').filter({hasText:'定向打开.md'}).count(),1);
  assert.equal(await paneText(pane(downId)),normalized(rawDown)+'准备重复打开的未保存内容。');
  assert.equal(await readFile(targeted,'utf8'),rawTargeted);
  await focusEditor(downId);await page.keyboard.press('Control+End');await page.keyboard.insertText(duplicateMarker);
  await expect.poll(()=>readFile(down,'utf8'),{timeout:10000}).toContain(duplicateMarker);
  assert.equal(await readFile(targeted,'utf8'),rawTargeted);
  checks.push('duplicate-open-focuses-existing-pane-without-confirm-duplicate-or-rebinding');

  stage('missing-open-preserves-binding');
  assert.equal(await activePaneId(),downId);
  const confirmBeforeMissing=await count('confirm'),openBeforeMissing=await count('open');
  await choose('open',{canceled:false,filePaths:[missing]});
  await paneOpenByKeyboard(downId);
  await expect.poll(()=>count('open')).toBe(openBeforeMissing+1);
  await expect(page.locator('#error')).toBeVisible();
  assert.match(await page.locator('#error-message').textContent(),/不存在|ENOENT|无法/);
  assert.equal(await count('confirm'),confirmBeforeMissing);
  assert.equal(await page.locator('.pane').count(),5);
  assert.equal(await paneText(pane(downId)),normalized(rawDown)+'准备重复打开的未保存内容。'+duplicateMarker);
  await page.locator('#dismiss-error').click();
  await appendAndWait(downId,down,'失败打开后仍自动保存。');
  checks.push('failed-open-keeps-original-session-and-autosave-target');

  stage('bom-and-mixed-eol-exact-bytes');
  await topSplit('split-right');
  await waitPanes(6);
  const bomPaneId=await activePaneId();
  await choose('open',{canceled:false,filePaths:[bomDoc]});
  await paneStartOpenByKeyboard(bomPaneId);
  await expect.poll(()=>paneIdByName('BOM混合换行.md')).toBe(bomPaneId);
  assert.equal(await paneText(pane(bomPaneId)),normalized(rawBom.toString('utf8')));
  assert.match(await page.locator('#stats').textContent(),/UTF-8（BOM）/);
  assert.deepEqual(await readFile(bomDoc),rawBom);
  await page.locator('#save').click();
  await expect(page.locator('#status')).toHaveText('已保存');
  assert.deepEqual(await readFile(bomDoc),rawBom);
  checks.push('opening-and-unchanged-save-preserve-BOM-and-mixed-EOL-bytes');

  stage('outer-sibling-close-keeps-nested-descendants');
  await topSplit('split-right');await waitPanes(7);
  const outerLeftId=await activePaneId();
  await choose('open',{canceled:false,filePaths:[outerLeftDoc]});
  await paneStartOpenByKeyboard(outerLeftId);
  await expect.poll(()=>paneIdByName('外枝左.md')).toBe(outerLeftId);
  await topSplit('split-right');await waitPanes(8);
  const outerRightId=await activePaneId();
  await choose('open',{canceled:false,filePaths:[outerDownDoc]});
  await topSplit('split-open-down');await waitPanes(9);
  const outerDownId=await waitPaneNamed('外枝下.md');
  await choose('open',{canceled:false,filePaths:[outerUnusedDoc]});
  await paneOpenByKeyboard(outerRightId);
  await expect.poll(()=>paneText(pane(outerRightId))).toBe(normalized(rawOuterUnused));
  assert.deepEqual(await layoutAt(outerLeftId),{dir:'row',slot:0});
  await layoutNear(outerRightId,{dir:'column',slot:0});
  await layoutNear(outerDownId,{dir:'column',slot:1});
  const confirmBeforeOuterClose=await count('confirm');
  await pane(outerLeftId).locator('.pane-bar [data-pane-action="split-close"]').focus();
  await page.keyboard.press('Enter');
  await waitPanes(8);
  assert.equal(await pane(outerLeftId).count(),0);
  assert.equal(await pane(outerRightId).count(),1);
  assert.equal(await pane(outerDownId).count(),1);
  assert.equal(await count('confirm'),confirmBeforeOuterClose);
  await layoutNear(outerRightId,{dir:'column',slot:0});
  await layoutNear(outerDownId,{dir:'column',slot:1});
  assert.equal(await pane(outerRightId).evaluate(node=>Boolean(node.isConnected && node.closest('.split'))),true);
  assert.equal(await pane(outerDownId).evaluate(node=>Boolean(node.isConnected && node.closest('.split'))),true);
  const connected=await page.evaluate(({outerRightId,outerDownId})=>{
    const right=document.querySelector(`.pane[data-pane="${outerRightId}"]`);
    const lower=document.querySelector(`.pane[data-pane="${outerDownId}"]`);
    return Boolean(right?.isConnected && lower?.isConnected && right.parentElement?.parentElement===lower.parentElement?.parentElement);
  },{outerRightId,outerDownId});
  assert.equal(connected,true);
  assert.equal(await paneText(pane(outerRightId)),normalized(rawOuterUnused));
  assert.equal(await paneText(pane(outerDownId)),normalized(rawOuterDown));

  await choose('open',{canceled:false,filePaths:[outerRightDoc]});
  await paneOpenByKeyboard(outerRightId);
  await expect.poll(()=>paneText(pane(outerRightId))).toBe(normalized(rawOuterRight));
  assert.equal(await readFile(outerRightDoc,'utf8'),rawOuterRight);
  await appendAndWait(outerRightId,outerRightDoc,'外层关闭后右枝自动保存。');
  await appendAndWait(outerDownId,outerDownDoc,'外层关闭后的自动保存。');
  checks.push('closing-outer-sibling-keeps-connected-nested-descendants-and-autosave');

  stage('window-close-guards');
  await topSplit('split-right');await waitPanes(9);
  const dirtyId1=await activePaneId();
  await focusEditor(dirtyId1);await page.keyboard.insertText('未保存甲。');
  await topSplit('split-down');await waitPanes(10);
  const dirtyId2=await activePaneId();
  await focusEditor(dirtyId2);await page.keyboard.insertText('未保存乙。');
  const confirmsNow=await count('confirm');
  await choose('confirm',{response:1});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await expect.poll(()=>count('confirm')).toBe(confirmsNow+1);
  assert.equal(await windowCount(),1);
  await choose('confirm',{response:2});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await expect.poll(()=>count('confirm')).toBe(confirmsNow+3);
  assert.equal(await windowCount(),1);
  await choose('confirm',{response:2});await choose('confirm',{response:2});
  const closing=app.waitForEvent('close',{timeout:20000});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await closing;ended=true;
  assert.deepEqual(await readFile(bomDoc),rawBom);
  assert.equal(await readFile(a,'utf8'),rawA);
  checks.push('window-close-consults-every-dirty-pane');

  assert.deepEqual(errors,[]);
  const result={
    passed:true,checks,errors,geometry,visualEvidence:'VISUAL_UNVERIFIED',
    scope:'Actual hidden Electron panes, split layout, IPC sessions, dialog guards and byte checks. Popover evidence is DOM and bounding-box geometry, not a visual review. Renderer focus is emulated, not physical Windows foreground focus.',
  };
  await writeFile(join(output,'split-view.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,output}));
}catch(error){
  let dom=null,native=null,dialogs=null;
  if(page && !page.isClosed())dom=await page.evaluate(()=>({
    activePane:document.querySelector('.pane.active')?.dataset.pane || null,
    panes:[...document.querySelectorAll('.pane')].map(node=>({
      id:node.dataset.pane||'',name:node.querySelector('.pane-name')?.textContent||'',
      text:node.querySelector('.cm-content')?.cmTile?.root?.view?.state?.doc?.toString?.()||'',
      startVisible:Boolean(node.querySelector('.pane-start') && !node.querySelector('.pane-start').hidden),
    })),
    menuOpen:Boolean(document.getElementById('split-menu')?.matches(':popover-open')),
    alert:document.getElementById('error')?.hidden===false?document.getElementById('error-message')?.textContent:'',
  })).catch(()=>null);
  if(app) {
    native=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(win=>({
      visible:win.isVisible(),focused:win.isFocused(),bounds:win.getBounds(),
    }))).catch(()=>null);
    dialogs=await app.evaluate(()=>globalThis.noteQaDialogs).catch(()=>null);
  }
  const failure={passed:false,stage:lastStage,error:String(error?.stack||error),checks,errors,dom,native,dialogs,visualEvidence:'VISUAL_UNVERIFIED'};
  await writeFile(join(output,'split-view-failure.json'),JSON.stringify(failure,null,2)).catch(()=>{});
  console.error('FAILURE_EVIDENCE '+join(output,'split-view-failure.json'));
  throw error;
}finally {
  if(app && !ended){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
  await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
