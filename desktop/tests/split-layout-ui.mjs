import './hidden-launch.mjs';
import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';

// Hidden renderer layout/session checks. DOM focus, geometry, and animation
// timing are not OS foreground, physical IME, visual, or motion-quality proof.
const dir=await mkdtemp(join(tmpdir(),'note-split-layout-'));
const output=process.env.NOTE_QA_OUTPUT||await mkdtemp(join(tmpdir(),'note-split-layout-evidence-'));
await mkdir(output,{recursive:true});
const profile=join(dir,'profile');await mkdir(profile);
const rootDoc=join(dir,'根稿.md'),distantDoc=join(dir,'深层稿.md'),dragDoc=join(dir,'拖动稿.md'),contentDoc=join(dir,'替换稿.md');
const rawRoot='# 根稿\n\n保持左侧原文。\n',rawDistant='# 深层稿\n\n远处窗格。\n';
const rawDrag=Buffer.from('\ufeff# 拖动稿\r\n\r\n第一行\n第二行\r第三行\r\n');
const rawDragText=rawDrag.toString('utf8').replace(/^\ufeff/,'').replace(/\r\n?/g,'\n');
const rawContent='# 替换稿\n\n同窗格替换。\n';
for(const [path,raw] of [[rootDoc,rawRoot],[distantDoc,rawDistant],[dragDoc,rawDrag],[contentDoc,rawContent]])await writeFile(path,raw);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const entry=process.env.NOTE_TEST_APP_ENTRY||resolve('desktop/main.mjs');
const electronPath=resolve('node_modules/electron/dist/electron.exe');
let app,page,ended=false,lastStage='setup';
const checks=[],errors=[];
const stage=name=>{lastStage=name;console.log('STAGE '+name);};
const pane=id=>page.locator(`.pane[data-pane="${id}"]`);
const editor=pane=>pane.locator('.cm-content');
const waitPanes=count=>expect.poll(()=>page.locator('.pane').count(),{timeout:15000}).toBe(count);
const menuOpen=()=>page.locator('#split-menu').evaluate(menu=>menu.matches(':popover-open'));
const activeId=()=>page.evaluate(()=>document.querySelector('.pane.active')?.dataset.pane||null);
const waitNamed=async name=>{
  const find=()=>page.locator('.pane').evaluateAll((nodes,name)=>
    nodes.find(node=>(node.querySelector('.pane-name')?.textContent||'').replace(/\s*·\s*$/,'').trim()===name)?.dataset.pane||null,name);
  await expect.poll(find,{timeout:15000}).toBeTruthy();return find();
};
const openMenu=async trigger=>{
  await trigger.click();await expect(page.locator('#split-menu')).toBeVisible();
  await expect.poll(menuOpen).toBe(true);
};
const action=async(trigger,value)=>{
  await openMenu(trigger);
  await page.locator(`#split-menu [data-split-action="${value}"]`).click();
  await expect(page.locator('#split-menu')).toBeHidden();
};
const layout=id=>page.evaluate(id=>{
  const target=document.querySelector(`.pane[data-pane="${id}"]`),slot=target?.parentElement;
  const split=slot?.parentElement;if(!split?.classList.contains('split'))return null;
  return {dir:split.dataset.dir,slot:[...split.children].filter(node=>node.classList.contains('slot')).indexOf(slot)};
},id);
const text=id=>editor(pane(id)).evaluate(node=>node.cmTile.root.view.state.doc.toString());
const focus=async id=>assert.equal(await editor(pane(id)).evaluate(node=>{node.focus();return document.activeElement===node;}),true);
const choose=(type,value)=>app.evaluate((_electron,{type,value})=>globalThis.noteQaDialogs[type].push(value),{type,value});
const recordAnimations=()=>page.evaluate(()=>{
  if(Element.prototype.__qaSplitAnimate)return;const bucket=globalThis.__qaSplitAnimations=[],animate=Element.prototype.animate;
  Object.defineProperty(Element.prototype,'__qaSplitAnimate',{value:true});
  Element.prototype.animate=function(frames,options){
    const animation=animate.call(this,frames,options),record=()=>{
      if(animation.id?.startsWith('note-'))bucket.push({id:animation.id,
        duration:Number(animation.effect?.getTiming().duration)||0,label:this.className||this.id});
    };
    queueMicrotask(record);
    return animation;
  };
});
const takeAnimations=()=>page.evaluate(()=>globalThis.__qaSplitAnimations?.splice(0)||[]);
const waitMotion=async()=>{
  await expect.poll(()=>page.evaluate(()=>!document.getAnimations().some(animation=>
    animation.id?.startsWith('note-') && animation.playState==='running')),{timeout:5000}).toBe(true);
};
const settle=async()=>{await waitMotion();await page.evaluate(()=>new Promise(requestAnimationFrame));};
const captureViews=ids=>page.evaluate(ids=>{
  const map=globalThis.__splitLayoutViews||(globalThis.__splitLayoutViews=new Map());
  for(const id of ids){
    const view=document.querySelector(`.pane[data-pane="${id}"] .cm-content`)?.cmTile?.root?.view;
    if(view)map.set(id,view);
  }
  return [...map.keys()];
},ids);
const changedViews=ids=>page.evaluate(ids=>{
  const map=globalThis.__splitLayoutViews||new Map();
  return ids.filter(id=>map.get(id)!==document.querySelector(`.pane[data-pane="${id}"] .cm-content`)?.cmTile?.root?.view);
},ids);
const paneRects=()=>page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('.pane')].map(node=>
  [node.dataset.pane,node.getBoundingClientRect().toJSON()])));
const armPointerObservation=()=>page.evaluate(()=>{
  globalThis.__qaPanePointerId=-1;
  globalThis.__qaPaneSwapCapture=[];
  document.addEventListener('pointerdown',event=>{
    globalThis.__qaPanePointerId=event.pointerId;
  },{capture:true,once:true});
  const proto=Element.prototype;
  if(!proto.__qaPaneMoveObserved){
    const original=proto.moveBefore;
    proto.moveBefore=function(element,...rest){
      if(globalThis.__qaTrackPaneSwap && element?.classList?.contains('pane')){
        const root=document.querySelector('main'),pointerId=globalThis.__qaPanePointerId;
        globalThis.__qaPaneSwapCapture.push({
          pane:element.dataset.pane,
          rootCaptured:root.hasPointerCapture(pointerId),
          barCaptured:[...document.querySelectorAll('.pane-bar')].some(bar=>bar.hasPointerCapture(pointerId)),
        });
      }
      return original.call(this,element,...rest);
    };
    Object.defineProperty(proto,'__qaPaneMoveObserved',{value:true});
  }
  globalThis.__qaTrackPaneSwap=true;
});
const paneCapture=pointerId=>page.evaluate(pointerId=>{
  const root=document.querySelector('main');
  return {
    root:root.hasPointerCapture(pointerId),
    bars:[...document.querySelectorAll('.pane-bar')].map(bar=>({
      pane:bar.closest('.pane').dataset.pane,
      captured:bar.hasPointerCapture(pointerId),
    })),
    dragActive:root.classList.contains('pane-drag-active'),
    previews:document.querySelectorAll('.pane-drag-preview').length,
    dragging:document.querySelectorAll('.pane-dragging').length,
    dropTargets:document.querySelectorAll('.pane-drop-target').length,
  };
},pointerId);
const paneBarCursorTree=id=>pane(id).locator('.pane-bar').evaluate(bar=>{
  const cursor=node=>getComputedStyle(node).cursor;
  return {
    bar:cursor(bar),
    grip:cursor(bar.querySelector('.pane-grip')),
    gripIcon:cursor(bar.querySelector('.pane-grip svg')),
    name:cursor(bar.querySelector('.pane-name')),
    actions:cursor(bar.querySelector('.pane-actions')),
    buttons:[...bar.querySelectorAll('button')].map(cursor),
  };
});
const hoverPaneNameCursor=async id=>{
  const target=await pane(id).locator('.pane-name').boundingBox();
  assert.ok(target);
  const x=target.x+target.width/2,y=target.y+target.height/2;
  await page.mouse.move(x,y);
  await page.evaluate(()=>new Promise(requestAnimationFrame));
  return page.evaluate(({id,x,y})=>{
    const bar=document.querySelector(`.pane[data-pane="${id}"] .pane-bar`);
    const hit=document.elementFromPoint(x,y);
    return {
      hit:hit?.closest('.pane-bar')===bar?hit.className:null,
      hitCursor:hit?getComputedStyle(hit).cursor:null,
      barCursor:getComputedStyle(bar).cursor,
    };
  },{id,x,y});
};
const drag=async(from,to,cancel=false)=>{
  await settle();
  await armPointerObservation();
  const source=await pane(from).locator('.pane-bar .pane-name').boundingBox();
  const target=await pane(to).locator('.cm-content').boundingBox();
  assert.ok(source&&target);
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);
  await page.mouse.down();
  const pointerId=await expect.poll(()=>page.evaluate(()=>globalThis.__qaPanePointerId),{timeout:1000}).not.toBe(-1)
    .then(()=>page.evaluate(()=>globalThis.__qaPanePointerId));
  const downCapture=await paneCapture(pointerId);
  assert.equal(downCapture.root,true,'pane drag must capture on the stable workspace root');
  assert.ok(downCapture.bars.every(item=>!item.captured),'no movable pane bar may own pointer capture');
  assert.equal(downCapture.dragActive,false,'capture alone must not start the visual drag');
  assert.deepEqual(await paneBarCursorTree(from),{
    bar:'grabbing',grip:'grabbing',gripIcon:'grabbing',name:'grabbing',actions:'grabbing',buttons:['pointer','pointer','pointer'],
  });
  await page.mouse.move(source.x+source.width/2+10,source.y+source.height/2+10,{steps:2});
  assert.equal((await paneCapture(pointerId)).root,true,'capture must remain on the workspace root while dragging');
  assert.equal((await paneCapture(pointerId)).dragActive,true);
  const draggingCursor=await paneBarCursorTree(from);
  await page.mouse.move(target.x+Math.min(80,target.width/3),target.y+Math.min(80,target.height/3),{steps:12});
  assert.equal(await page.locator('.pane-drag-preview').count(),1);
  assert.equal(await pane(to).evaluate(node=>node.classList.contains('pane-drop-target')),true);
  if(cancel)await page.keyboard.press('Escape');else await page.mouse.up();
  if(cancel)await page.mouse.up().catch(()=>{});
  const swapCapture=await page.evaluate(()=>{
    globalThis.__qaTrackPaneSwap=false;
    return globalThis.__qaPaneSwapCapture;
  });
  return {pointerId,downCapture,draggingCursor,swapCapture};
};

try {
  app=await electron.launch({executablePath:electronPath,args:[entry,rootDoc,'--user-data-dir='+profile],env,timeout:30000});
  page=await app.firstWindow();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',event=>{if(event.type()==='error')errors.push(event.text());});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await recordAnimations();
  await page.locator('#filename').filter({hasText:'根稿.md'}).waitFor();
  await app.evaluate(()=>{
    globalThis.noteQaDialogs={open:[],save:[],confirm:[],calls:[]};
    globalThis.installDialogs({
      showOpenDialog:async(...args)=>{const result=globalThis.noteQaDialogs.open.shift()||{canceled:true,filePaths:[]};globalThis.noteQaDialogs.calls.push({type:'open',result,options:args.at(-1)});return result;},
      showSaveDialog:async(...args)=>{const result=globalThis.noteQaDialogs.save.shift()||{canceled:true};globalThis.noteQaDialogs.calls.push({type:'save',result,options:args.at(-1)});return result;},
      showMessageBox:async(...args)=>{const result=globalThis.noteQaDialogs.confirm.shift()||{response:1};globalThis.noteQaDialogs.calls.push({type:'confirm',result,options:args.at(-1)});return result;},
    });
  });

  stage('contract-and-left-open');
  assert.equal(await page.locator('.pane').count(),1);
  await openMenu(page.locator('#split-options'));
  assert.equal(await page.locator('#split-choices').isVisible(),true);
  assert.equal(await page.locator('#split-choices .split-directions').count(),2);
  assert.equal(await page.locator('#split-choices [data-split-action]').count(),8);
  assert.equal(await page.locator('#split-choices .split-directions').first().evaluate(node=>
    getComputedStyle(node).display),'grid');
  assert.equal(await page.locator('#split-choices .split-directions').first().locator('[role="menuitem"]').count(),4);
  await page.keyboard.press('Escape');
  await expect(page.locator('#split-menu')).toBeHidden();
  await choose('open',{canceled:false,filePaths:[distantDoc]});
  await action(page.locator('#split-options'),'split-open-left');
  await waitPanes(2);
  const leftId=await waitNamed('深层稿.md');
  assert.notEqual(leftId,'primary');
  assert.deepEqual(await layout(leftId),{dir:'row',slot:0});
  const enterAnimations=await takeAnimations();
  assert.ok(enterAnimations.some(item=>item.id==='note-split-menu'&&item.duration===120));
  assert.ok(enterAnimations.some(item=>item.id==='note-pane-enter'&&item.duration===240));
  assert.ok(enterAnimations.some(item=>item.id==='note-split-layout'&&item.duration===240));
  await settle();
  const rootBox=await pane('primary').boundingBox(),leftBox=await pane(leftId).boundingBox();
  assert.ok(leftBox.x<rootBox.x && Math.abs(leftBox.y-rootBox.y)<4);
  assert.deepEqual(await readFile(rootDoc),Buffer.from(rawRoot));
  assert.deepEqual(await readFile(distantDoc,'utf8'),rawDistant);
  assert.equal(await text('primary'),rawRoot);
  assert.equal(await text(leftId),rawDistant);
  checks.push('four-direction-menu-left-open-geometry-source-and-meaningful-enter-motion');

  stage('canceled-left-and-up-new');
  await choose('open',{canceled:true,filePaths:[]});
  await action(page.locator('#split-options'),'split-open-left');
  await expect.poll(()=>app.evaluate(()=>globalThis.noteQaDialogs.calls.length)).toBeGreaterThanOrEqual(2);
  assert.equal(await page.locator('.pane').count(),2);
  assert.equal(await activeId(),leftId);
  await action(pane(leftId).locator('[data-pane-action="split-menu"]'),'split-up');
  await waitPanes(3);
  const upId=await activeId();
  assert.deepEqual(await layout(upId),{dir:'column',slot:0});
  assert.deepEqual(await layout(leftId),{dir:'column',slot:1});
  assert.equal((await text(upId)).length,0);
  assert.deepEqual(await readFile(rootDoc),Buffer.from(rawRoot));
  checks.push('canceled-left-adds-no-pane-up-blank-pane-has-correct-symmetry');

  stage('distant-menu-swap-identities-selection-history');
  await action(page.locator('#split-options'),'split-right');
  await waitPanes(4);
  const distantId=await activeId();
  await choose('open',{canceled:false,filePaths:[dragDoc]});
  await pane(distantId).locator('.pane-start [data-pane-action="open"]').click();
  await expect.poll(()=>text(distantId)).toBe(rawDragText);
  await focus(leftId);
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('选择锚点');
  await expect.poll(()=>readFile(distantDoc,'utf8')).toBe(rawDistant+'选择锚点');
  const beforeSelection=await editor(pane(leftId)).evaluate(node=>{
    const selection=node.cmTile.root.view.state.selection.main;
    return {anchor:selection.anchor,head:selection.head};
  });
  await focus(distantId);await page.keyboard.press('Control+End');await page.keyboard.insertText('撤销标记');
  await expect.poll(()=>readFile(dragDoc),{timeout:10000}).toEqual(Buffer.concat([rawDrag,Buffer.from('撤销标记')]));
  const distantBytes=await readFile(dragDoc);
  await captureViews([leftId,distantId]);
  const beforeSwap={left:await layout(leftId),distant:await layout(distantId)};
  await openMenu(pane(leftId).locator('[data-pane-action="split-menu"]'));
  await page.locator('#split-swap').click();
  assert.equal(await page.locator('#split-swap-targets').isVisible(),true);
  assert.equal(await page.locator(`[data-swap-target="${distantId}"]`).count(),1);
  await page.locator('#split-swap-back').click();
  assert.equal(await page.locator('#split-choices').isVisible(),true);
  await page.locator('#split-swap').click();
  await page.locator(`[data-swap-target="${distantId}"]`).click();
  await expect(page.locator('#split-menu')).toBeHidden();
  await settle();
  assert.deepEqual(await layout(leftId),beforeSwap.distant);
  assert.deepEqual(await layout(distantId),beforeSwap.left);
  assert.deepEqual(await changedViews([leftId,distantId]),[]);
  assert.equal(await text(leftId),rawDistant+'选择锚点');
  assert.deepEqual(await editor(pane(leftId)).evaluate(node=>{
    const selection=node.cmTile.root.view.state.selection.main;
    return {anchor:selection.anchor,head:selection.head};
  }),{anchor:beforeSelection.anchor,head:beforeSelection.head});
  assert.deepEqual(await readFile(rootDoc),Buffer.from(rawRoot));
  assert.deepEqual(await readFile(dragDoc),distantBytes);
  checks.push('menu-swaps-distant-existing-view-doc-selections-and-history-objects-without-swap-disk-write');

  stage('undo-survives-menu-move-and-drag');
  await focus(distantId);
  await page.keyboard.press('Control+z');
  await expect.poll(()=>text(distantId)).toBe(rawDragText);
  assert.deepEqual(await editor(pane(distantId)).evaluate(node=>node.cmTile.root.view===globalThis.__splitLayoutViews.get(node.closest('.pane').dataset.pane)),true);
  checks.push('undo-history-follows-editor-across-menu-swap');

  stage('real-pointer-drag-swaps');
  await captureViews([leftId,distantId]);
  const beforeRects=await paneRects();
  const layoutsBeforeDrag={left:await layout(leftId),distant:await layout(distantId)};
  const pointerSwap=await drag(leftId,distantId);
  assert.deepEqual(pointerSwap.draggingCursor,{
    bar:'grabbing',grip:'grabbing',gripIcon:'grabbing',name:'grabbing',actions:'grabbing',buttons:['grabbing','grabbing','grabbing'],
  });
  assert.equal(pointerSwap.swapCapture.length,2);
  assert.deepEqual(pointerSwap.swapCapture.map(item=>item.rootCaptured),[true,true]);
  assert.deepEqual(pointerSwap.swapCapture.map(item=>item.barCaptured),[false,false]);
  const swapMotion=await takeAnimations();
  await settle();
  assert.deepEqual(await changedViews([leftId,distantId]),[]);
  assert.deepEqual(await layout(leftId),layoutsBeforeDrag.distant);
  assert.deepEqual(await layout(distantId),layoutsBeforeDrag.left);
  const afterRects=await paneRects();
  const near=(actual,expected)=>Math.abs(actual-expected)<=3;
  assert.ok(near(afterRects[leftId].x,beforeRects[distantId].x) && near(afterRects[leftId].y,beforeRects[distantId].y));
  assert.ok(near(afterRects[distantId].x,beforeRects[leftId].x) && near(afterRects[distantId].y,beforeRects[leftId].y));
  assert.ok(swapMotion.some(item=>item.id==='note-pane-swap'&&item.duration===240));
  assert.deepEqual(await paneBarCursorTree(leftId),{
    bar:'grab',grip:'grab',gripIcon:'grab',name:'grab',actions:'grab',buttons:['pointer','pointer','pointer'],
  });
  assert.deepEqual(await hoverPaneNameCursor(leftId),{hit:'pane-name',hitCursor:'grab',barCursor:'grab'});
  const releasedCapture=await paneCapture(pointerSwap.pointerId);
  assert.equal(releasedCapture.root,false);
  assert.ok(releasedCapture.bars.every(item=>!item.captured));
  assert.deepEqual(
    {dragActive:releasedCapture.dragActive,previews:releasedCapture.previews,
      dragging:releasedCapture.dragging,dropTargets:releasedCapture.dropTargets},
    {dragActive:false,previews:0,dragging:0,dropTargets:0},
  );
  checks.push('page-mouse-bar-drag-keeps-stable-root-capture-through-swap-and-restores-nested-grab-cursor');

  stage('plain-bar-click-capture-and-cursor');
  await armPointerObservation();
  const clickTarget=await pane(leftId).locator('.pane-name').boundingBox();
  assert.ok(clickTarget);
  await page.mouse.move(clickTarget.x+clickTarget.width/2,clickTarget.y+clickTarget.height/2);
  await page.mouse.down();
  const clickPointerId=await expect.poll(()=>page.evaluate(()=>globalThis.__qaPanePointerId),{timeout:1000}).not.toBe(-1)
    .then(()=>page.evaluate(()=>globalThis.__qaPanePointerId));
  assert.equal((await paneCapture(clickPointerId)).root,true,'a plain bar press uses the same stable capture');
  await page.mouse.up();
  const clickedCapture=await paneCapture(clickPointerId);
  assert.equal(clickedCapture.root,false);
  assert.ok(clickedCapture.bars.every(item=>!item.captured));
  assert.deepEqual(
    {dragActive:clickedCapture.dragActive,previews:clickedCapture.previews,
      dragging:clickedCapture.dragging,dropTargets:clickedCapture.dropTargets},
    {dragActive:false,previews:0,dragging:0,dropTargets:0},
  );
  assert.deepEqual(await hoverPaneNameCursor(leftId),{hit:'pane-name',hitCursor:'grab',barCursor:'grab'});
  assert.deepEqual(await page.evaluate(()=>globalThis.__qaPaneSwapCapture),[]);
  await page.evaluate(()=>{globalThis.__qaTrackPaneSwap=false;});
  checks.push('plain-bar-click-releases-stable-capture-without-moving-dom-or-losing-grab-cursor');

  stage('drag-cancel');
  const layoutBeforeCancel=await page.evaluate(()=>
    [...document.querySelectorAll('.pane')].map(node=>node.dataset.pane));
  await expect.poll(()=>readFile(dragDoc),{timeout:10000}).toEqual(rawDrag);
  const sourceAtCancel=await readFile(dragDoc);
  const canceledDrag=await drag(leftId,distantId,true);
  await settle();
  assert.equal(await page.locator('.pane-drag-preview').count(),0);
  assert.equal(await page.locator('.pane-drop-target').count(),0);
  const escapedCapture=await paneCapture(canceledDrag.pointerId);
  assert.equal(escapedCapture.root,false);
  assert.ok(escapedCapture.bars.every(item=>!item.captured));
  assert.deepEqual(
    {dragActive:escapedCapture.dragActive,previews:escapedCapture.previews,
      dragging:escapedCapture.dragging,dropTargets:escapedCapture.dropTargets},
    {dragActive:false,previews:0,dragging:0,dropTargets:0},
  );
  assert.deepEqual(canceledDrag.swapCapture,[]);
  assert.deepEqual(await hoverPaneNameCursor(leftId),{hit:'pane-name',hitCursor:'grab',barCursor:'grab'});
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('.pane')].map(node=>node.dataset.pane)),layoutBeforeCancel);
  assert.deepEqual(await changedViews([leftId,distantId]),[]);
  assert.deepEqual(await readFile(dragDoc),sourceAtCancel);
  checks.push('escape-releases-stable-capture-restores-grab-cursor-layout-and-source');

  stage('autosave-bom-mixed-eol-after-swaps');
  await focus(distantId);await page.keyboard.press('Control+End');await page.keyboard.insertText('拖动后保存。');
  await expect.poll(()=>readFile(dragDoc),{timeout:10000}).toEqual(Buffer.concat([rawDrag,Buffer.from('拖动后保存。')]));
  assert.equal(await editor(pane(distantId)).evaluate(node=>node.cmTile.root.view.state.doc.toString()).then(value=>value.includes('\r')),false);
  checks.push('autosave-after-swaps-writes-bound-BOM-mixed-EOL-file');

  stage('undo-after-pointer-swap');
  const beforeUndoDoc=await text(distantId);
  await page.keyboard.press('Control+z');
  await expect.poll(()=>text(distantId)).not.toBe(beforeUndoDoc);
  assert.deepEqual(await changedViews([leftId,distantId]),[]);
  checks.push('undo-remains-bound-to-editor-after-pointer-swap');

  stage('content-motion');
  await takeAnimations();
  await choose('open',{canceled:false,filePaths:[contentDoc]});
  await pane(upId).locator('.pane-start [data-pane-action="open"]').click();
  await expect.poll(()=>text(upId)).toBe(rawContent);
  assert.ok((await takeAnimations()).some(item=>item.id==='note-pane-content'&&item.duration===160));
  checks.push('same-pane-content-replacement-uses-160ms-in-built-css');

  stage('reduced-motion');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  await takeAnimations();
  await action(page.locator('#split-options'),'split-left');
  await waitPanes(5);
  assert.deepEqual(await layout(await activeId()),{dir:'row',slot:0});
  const reducedMotion=await takeAnimations();
  assert.deepEqual(reducedMotion.filter(item=>item.duration>0),[]);
  checks.push('reduced-motion-split-skips-meaningful-app-animation-duration');

  assert.deepEqual(errors,[]);
  const result={passed:true,checks,visualEvidence:'VISUAL_UNVERIFIED',
    scope:'Hidden Electron DOM/geometry/object identity and file bytes; renderer focus is not OS foreground focus; animation presence is not native motion quality or physical IME evidence.'};
  await writeFile(join(output,'split-layout.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,output}));
}catch(error){
  let failure=null;
  if(page&&!page.isClosed())failure=await page.evaluate(()=>({
    panes:[...document.querySelectorAll('.pane')].map(node=>({id:node.dataset.pane,name:node.querySelector('.pane-name')?.textContent||''})),
    active:document.querySelector('.pane.active')?.dataset.pane||null,
    menuOpen:Boolean(document.getElementById('split-menu')?.matches(':popover-open')),
  })).catch(()=>null);
  await writeFile(join(output,'split-layout-failure.json'),JSON.stringify({
    passed:false,stage:lastStage,error:String(error?.stack||error),checks,errors,failure,visualEvidence:'VISUAL_UNVERIFIED',
  },null,2)).catch(()=>{});
  console.error('FAILURE_EVIDENCE '+join(output,'split-layout-failure.json'));
  throw error;
}finally{
  if(app&&!ended){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
  await rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
