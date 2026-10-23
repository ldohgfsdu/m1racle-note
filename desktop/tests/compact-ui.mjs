import {_electron as electron,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const profile=await mkdtemp(join(tmpdir(),'note-compact-')),output=process.env.NOTE_QA_OUTPUT||await mkdtemp(join(tmpdir(),'note-compact-evidence-'));
await mkdir(output,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),'--user-data-dir='+profile],env});
try {
  const page=await app.firstWindow(),errors=[];
  const capturePage=async filename=>{
    const data=await app.evaluate(async({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows()[0];
      assertHidden(win);
      function assertHidden(window){if(window.isVisible()||window.isFocused())throw new Error('Expected hidden, unfocused QA window');}
      const image=await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
      assertHidden(win);
      if(image.isEmpty())throw new Error('Empty hidden-window capture');
      return image.toPNG().toString('base64');
    });
    await writeFile(join(output,filename),Buffer.from(data,'base64'));
  };
  page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.locator('.cm-content').waitFor();await page.locator('.brand img:visible').evaluate(e=>e.decode());
  assert.equal(await page.title(),'M1racle Note');
  const native=await app.evaluate(({BrowserWindow})=>{
    const win=BrowserWindow.getAllWindows()[0];return {bounds:win.getBounds(),content:win.getContentBounds(),menu:win.isMenuBarVisible()};
  });
  assert.equal(native.menu,false);assert.ok(Math.abs(native.bounds.height-native.content.height)<=2);assert.ok(Math.abs(native.bounds.width-native.content.width)<=2);
  const hwnd=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
  const cornerPreference=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class NoteWindowProbe {
 [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd,int attribute,out int value,int size);
 public static int Corners(long hwnd) { int value; int result=DwmGetWindowAttribute(new IntPtr(hwnd),33,out value,4); if(result!=0)throw new Exception("DWM probe failed"); return value; }
}
'@
[NoteWindowProbe]::Corners([long]${hwnd})
`],{encoding:'utf8',windowsHide:true}).trim();
  assert.equal(cornerPreference,'1');
  assert.equal(await page.locator('main').evaluate(e=>e.getBoundingClientRect().top),80);
  const layout=()=>page.evaluate(()=>{
    const rect=selector=>document.querySelector(selector).getBoundingClientRect();
    const sidebar=rect('#document-sidebar'),format=rect('#format'),header=rect('header');
    const scroller=document.querySelector('.cm-scroller'),content=rect('.cm-content');
    const left=content.left-scroller.getBoundingClientRect().left,right=scroller.clientWidth-left-content.width;
    return {sidebarTop:sidebar.top,headerBottom:header.bottom,sidebarRight:sidebar.right,formatLeft:format.left,left,right,width:content.width};
  });
  let positions=await layout();
  assert.equal(positions.sidebarTop,positions.headerBottom);assert.equal(positions.formatLeft,positions.sidebarRight);
  assert.ok(Math.abs(positions.left-positions.right)<2,JSON.stringify(positions));
  await page.locator('#sidebar-toggle').click();await expect(page.locator('#document-sidebar')).toBeHidden();
  positions=await layout();assert.equal(positions.formatLeft,0);assert.ok(Math.abs(positions.left-positions.right)<2,JSON.stringify(positions));
  await page.locator('#sidebar-toggle').click();await expect(page.locator('#document-sidebar')).toBeVisible();
  assert.equal(await page.locator('header').evaluate(e=>getComputedStyle(e).webkitAppRegion),'drag');
  assert.equal(await page.locator('header nav[aria-label="文件与视图"]').evaluate(e=>getComputedStyle(e).webkitAppRegion),'no-drag');
  assert.equal(await page.evaluate(()=>navigator.windowControlsOverlay.visible),true);
  await page.locator('#app-menu summary').click();await page.locator('#save-as').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('#app-menu').getAttribute('open'),null);
  assert.equal(await page.locator('#new').isVisible(),false);assert.equal(await page.locator('#new').evaluate(element=>element.closest('details').id),'app-menu');assert.equal(await page.locator('#sidebar-new').isVisible(),true);
  await page.locator('#format-more summary').click();await page.locator('[data-format=ordered]').waitFor();await page.locator('[data-format=inlinecode]').click();
  assert.equal(await page.locator('#format-more').getAttribute('open'),null);await page.locator('#undo').click();
  await page.reload();await page.locator('.cm-content').waitFor();
  if(await page.locator('html').evaluate(e=>e.classList.contains('dark')))await page.locator('#theme').click();
  const lightColors=await page.evaluate(()=>({background:getComputedStyle(document.body).backgroundColor,text:getComputedStyle(document.body).color}));
  await capturePage('day.png');
  await page.locator('#theme').click();
  await expect.poll(()=>page.evaluate(()=>({background:getComputedStyle(document.body).backgroundColor,text:getComputedStyle(document.body).color}))).not.toEqual(lightColors);
  await capturePage('night.png');
  // Capture only this process's native window, including Windows caption buttons.
  const capture=async filename=>{
   const data=await app.evaluate(async({BrowserWindow,desktopCapturer})=>{
    const win=BrowserWindow.getAllWindows()[0],handle=win.getNativeWindowHandle();
    const id=(handle.length===8?handle.readBigUInt64LE():BigInt(handle.readUInt32LE())).toString();
    const bounds=win.getBounds();
    const sources=await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:bounds.width,height:bounds.height}});
    const own=sources.find(source=>source.id.split(':')[1]===id);
    if(!own || own.thumbnail.isEmpty())return null;
    return own.thumbnail.toPNG().toString('base64');
   });
   if(!data)return false;
   await writeFile(join(output,filename),Buffer.from(data,'base64'));return true;
  };
  const hidden=await app.evaluate(({BrowserWindow})=>!BrowserWindow.getAllWindows()[0].isVisible());
  let nativeScreenshot=false,nativeMaximize='NOT_RUN: native maximize can reveal a hidden window';
  if(!hidden){
    nativeScreenshot=await capture('native-night.png');
    await page.locator('#theme').click();await capture('native-day.png');await page.locator('#theme').click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
    assert.equal(await page.locator('main').evaluate(e=>e.getBoundingClientRect().top),80);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].unmaximize());
    await expect.poll(()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMaximized())).toBe(false);
    nativeMaximize='PASS';
  }
  const appearanceLabel=value=>page.locator('#appearance-width label:has(input[value="'+value+'"])');
  const appearanceBox=()=>page.evaluate(()=>{const anchor=document.getElementById('appearance-open').getBoundingClientRect(),menu=document.querySelector('#app-menu > summary').getBoundingClientRect(),panel=document.getElementById('appearance').getBoundingClientRect();return {panelTop:panel.top,panelBottom:panel.bottom,panelLeft:panel.left,panelRight:panel.right,panelWidth:panel.width,anchorBottom:anchor.bottom,menuRight:menu.right,viewportWidth:innerWidth,viewportHeight:innerHeight};});
  const assertAnchored=async label=>{const box=await appearanceBox();assert.ok(box.panelTop>=box.anchorBottom-1 && box.panelTop<=box.anchorBottom+48,label+' '+JSON.stringify(box));assert.ok(box.panelLeft>=-0.5 && box.panelTop>=-0.5 && box.panelRight<=box.viewportWidth+0.5 && box.panelBottom<=box.viewportHeight+0.5,label+' '+JSON.stringify(box));const expectedRight=Math.max(12+box.panelWidth,Math.min(box.menuRight,box.viewportWidth-12));assert.ok(Math.abs(box.panelRight-expectedRight)<=0.5,label+' horizontal anchor '+JSON.stringify(box));};
  const docText=()=>page.locator('.cm-content').evaluate(element=>element.cmTile.root.view.state.doc.toString());
  const beforeDoc=await docText();
  await page.locator('#appearance-open').click();
  await page.waitForFunction(()=>document.getElementById('appearance').matches(':popover-open'));
  await assertAnchored('normal');
  await page.locator('#appearance-open').click();
  await page.waitForFunction(()=>!document.getElementById('appearance').matches(':popover-open') && document.activeElement?.id==='appearance-open');
  await page.locator('#appearance-open').click();
  await page.waitForFunction(()=>document.getElementById('appearance').matches(':popover-open'));
  await assertAnchored('normal-reopen');
  await appearanceLabel('fluid').click();
  await page.waitForFunction(()=>document.querySelector('#appearance-width input[value="fluid"]').checked && document.documentElement.dataset.width==='fluid');
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.getElementById('appearance').matches(':popover-open') && document.activeElement?.id==='appearance-open');
  await page.reload();await page.locator('.cm-content').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-width'),'fluid');
  assert.equal(await docText(),beforeDoc);
  await page.locator('#appearance-open').click();
  await page.waitForFunction(()=>document.getElementById('appearance').matches(':popover-open'));
  await appearanceLabel('comfortable').click();
  await page.waitForFunction(()=>document.querySelector('#appearance-width input[value="comfortable"]').checked && document.documentElement.dataset.width==='comfortable');
  const editorPoint=await page.locator('.cm-content').evaluate(element=>{const view=element.cmTile.root.view,coords=view.coordsAtPos(0),box=element.getBoundingClientRect();return {x:Math.max(box.left+1,Math.min(box.right-1,coords.left+1)),y:(coords.top+coords.bottom)/2};});
  assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('.cm-content')===document.querySelector('.cm-content'),editorPoint),true);
  await page.mouse.click(editorPoint.x,editorPoint.y);
  await page.waitForFunction(()=>!document.getElementById('appearance').matches(':popover-open') && document.activeElement?.classList.contains('cm-content'));
  assert.equal(await page.locator('.cm-content').evaluate(element=>element.cmTile.root.view.hasFocus),true);
  await page.locator('#read').click();
  await page.waitForFunction(()=>!document.getElementById('appearance').matches(':popover-open') && document.activeElement?.id==='read');
  assert.equal(await docText(),beforeDoc);
  await page.setViewportSize({width:720,height:600});
  await page.locator('#appearance-open').click();
  await page.waitForFunction(()=>document.getElementById('appearance').matches(':popover-open'));
  await assertAnchored('narrow');
  await page.setViewportSize({width:360,height:600});
  await page.waitForFunction(()=>Math.abs(document.getElementById('appearance').getBoundingClientRect().left-12)<=0.5);
  await assertAnchored('narrow-clamped');
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.getElementById('appearance').matches(':popover-open') && document.activeElement?.id==='appearance-open');
  await page.setViewportSize({width:720,height:600});
  const toolbarHitTest=()=>page.evaluate(()=>{
    const sidebar=document.querySelector('#document-sidebar'),toolbar=document.querySelector('#format');
    const sidebarRect=sidebar.getBoundingClientRect();
    const controls=[...toolbar.querySelectorAll('button, summary, select, input')].flatMap(control=>{
      const rect=control.getBoundingClientRect();
      const style=getComputedStyle(control);
      if(rect.width<=0 || rect.height<=0 || style.display==='none' || style.visibility==='hidden' || Number(style.opacity)===0 || !control.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))return [];
      return [{name:control.getAttribute('aria-label') || control.textContent.trim(),rect,control}];
    });
    const overlaps=controls.filter(({rect})=>rect.left<sidebarRect.right && rect.right>sidebarRect.left && rect.top<sidebarRect.bottom && rect.bottom>sidebarRect.top).map(({name})=>name);
    const misses=controls.filter(({rect,control})=>{
      const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
      return !hit || hit!==control && !control.contains(hit);
    }).map(({name})=>name);
    return {sidebarVisible:!sidebar.hidden,sidebarWidth:sidebarRect.width,expectedSidebarWidth:innerWidth<=850?240:272,controlCount:controls.length,overlaps,misses};
  });
  const assertToolbarHitTargets=async label=>{
    const result=await toolbarHitTest();
    assert.ok(result.controlCount>0,`${label}: no visible format controls`);
    assert.deepEqual(result.overlaps,[],`${label}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.misses,[],`${label}: ${JSON.stringify(result)}`);
  };
  const assertToolbarHitTargetsWithSidebar=async(visible,label)=>{
    await expect(page.locator('#document-sidebar')).not.toHaveAttribute('data-animating','true');
    const result=await toolbarHitTest();
    assert.equal(result.sidebarVisible,visible,`${label}: ${JSON.stringify(result)}`);
    if(visible)assert.equal(result.sidebarWidth,result.expectedSidebarWidth,`${label}: ${JSON.stringify(result)}`);
    await assertToolbarHitTargets(label);
  };
  for(const width of [900,720]){
    await page.setViewportSize({width,height:600});
    if(!await page.locator('#document-sidebar').isVisible())await page.locator('#sidebar-toggle').click();
    await expect(page.locator('#document-sidebar')).toBeVisible();
    await assertToolbarHitTargetsWithSidebar(true,`${width}px sidebar open`);
    await page.locator('#sidebar-toggle').click();
    await expect(page.locator('#document-sidebar')).toBeHidden();
    await assertToolbarHitTargetsWithSidebar(false,`${width}px sidebar closed`);
    await page.locator('#sidebar-toggle').click();
    await expect(page.locator('#document-sidebar')).toBeVisible();
  }
  const fit=await page.evaluate(()=>{
    const header=document.querySelector('header').getBoundingClientRect(),nav=document.querySelector('nav').getBoundingClientRect();
    return {navRight:nav.right,availableRight:header.right-138};
  });
  assert.ok(fit.navRight<=fit.availableRight,JSON.stringify(fit));
  await page.locator('#app-menu summary').click();assert.ok(await page.locator('#app-menu .menu-items').evaluate(e=>e.getBoundingClientRect().right<=innerWidth));await page.keyboard.press('Escape');
  await capturePage('narrow.png');assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['80px-editor-chrome-and-44px-sidebar-start','editor-toolbar-belongs-to-editor','prose-centered-with-sidebar-open-and-closed','stored-full-width-survives-reload','appearance-popover-anchor-and-dismiss','900px-and-720px-no-overlap-after-animation','frameless-content-bounds','DWM-square-corners','native-menu-hidden','native-caption-overlay','drag-regions','menu-escape-and-action','file-actions-live-in-sidebar-and-overflow','theme-computed-colors','console-clean'],nativeMaximize,nativeScreenshot,visual:'UNVERIFIED until independent pixel review',output}));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
