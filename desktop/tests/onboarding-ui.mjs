import './hidden-launch.mjs';
import {_electron as electron} from '@playwright/test';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const profile=await mkdtemp(join(tmpdir(),'note-onboarding-'));
const executablePath=process.env.NOTE_ELECTRON_EXE?resolve(process.env.NOTE_ELECTRON_EXE):resolve('node_modules/electron/dist/electron.exe');
const output=process.env.NOTE_QA_OUTPUT||join(tmpdir(),'m1racle-note-windows-qa');
await mkdir(output,{recursive:true});
const app=await electron.launch({executablePath,args:[resolve('desktop/main.mjs'),'--user-data-dir='+profile],env,timeout:30000});
try {
  const page=await app.firstWindow();await page.locator('.cm-content').waitFor();
  await app.evaluate(({ipcMain})=>{
    globalThis.noteOnboardingState={available:true,dismissed:false,md:false,markdown:false};
    globalThis.noteSettingsTargeted=true;globalThis.noteOnboardingFail=false;globalThis.noteStateReads=0;
    globalThis.noteOpenMode='cancel';globalThis.noteNewMode='cancel';
    ipcMain.removeHandler('document');ipcMain.handle('document',(_event,type)=>{
      if(type==='initial'||type==='session-get')return null;
      if(type==='theme-icon'||type==='pane-closed'||type==='pane-adopt')return true;
      if(type==='confirm')return 'discard';
      if(type==='onboarding-state'){globalThis.noteStateReads=(globalThis.noteStateReads||0)+1;if(globalThis.noteOnboardingFail)throw new Error('query failed');return globalThis.noteOnboardingState;}
      if(type==='onboarding-dismiss'){globalThis.noteOnboardingState.dismissed=true;return true;}
      if(type==='default-app'){if(globalThis.noteSettingsFailure)throw new Error('launch failed');return {targeted:globalThis.noteSettingsTargeted};}
      if(type==='open'){if(globalThis.noteOpenMode==='fail')throw new Error('open failed');return null;}
      if(type==='new'){if(globalThis.noteNewMode==='fail')throw new Error('new failed');if(globalThis.noteNewMode==='ok')return {path:'',raw:''};return null;}
      throw new Error('Unexpected test request: '+type);
    });
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.reload();await page.locator('#onboarding').waitFor();
  assert.equal(await page.title(),'M1racle Note');
  assert.equal(await page.locator('#onboarding-open').innerText(),'打开已有笔记');
  assert.equal(await page.locator('#onboarding-new').innerText(),'新建笔记');
  assert.equal(await page.locator('#onboarding-primary').innerText(),'前往设置');
  assert.equal(await page.locator('#onboarding-open').evaluate(e=>e===document.activeElement),true);
  assert.equal(await page.locator('#onboarding').evaluate(el=>el.open),true);
  await page.screenshot({path:join(output,'onboarding.png')});
  await page.locator('.onboarding-mark img:visible').evaluate(image=>image.decode());
  assert.equal(await page.locator('.onboarding-mark').innerText(),'');
  assert.equal(await page.locator('.onboarding-mark img:visible').evaluate(image=>image.naturalWidth),128);
  assert.equal(await page.locator('.brand-mark img:visible').evaluate(image=>image.naturalWidth),2000);
  await page.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.dataset.theme='light';});
  await page.screenshot({path:join(output,'onboarding-brand-day.png')});
  assert.equal(await page.locator('.onboarding-mark img:visible').evaluate(el=>getComputedStyle(el).mixBlendMode),'normal');
  assert.equal(await page.locator('.onboarding-mark img:visible').evaluate(el=>getComputedStyle(el).filter),'none');
  await page.evaluate(()=>{document.documentElement.classList.add('dark');document.documentElement.dataset.theme='dark';});await page.screenshot({path:join(output,'onboarding-brand-night.png')});
  assert.equal(await page.locator('.onboarding-mark img:visible').evaluate(el=>getComputedStyle(el).mixBlendMode),'normal');
  await page.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.dataset.theme='light';});
  await page.locator('#onboarding-primary').click();assert.match(await page.locator('#onboarding-message').innerText(),/\.md 和 \.markdown/);
  await app.evaluate(()=>{globalThis.noteOnboardingState.md=true;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator('#association-md').filter({hasText:'已设置'}).waitFor();assert.equal(await page.locator('#association-markdown').innerText(),'.markdown · 待设置');
  assert.equal(await page.locator('#onboarding-primary').innerText(),'再检查一次');
  await app.evaluate(()=>{globalThis.noteOnboardingState.markdown=true;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator('#onboarding-primary').filter({hasText:'开始使用'}).waitFor();
  await page.screenshot({path:join(output,'onboarding-success.png')});
  await app.evaluate(()=>{globalThis.noteOnboardingFail=true;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator('#association-md').filter({hasText:'未确认'}).waitFor();
  assert.equal(await page.locator('#association-markdown').innerText(),'.markdown · 未确认');
  assert.notEqual(await page.locator('#onboarding-primary').innerText(),'开始使用');
  assert.equal(await page.locator('#onboarding').evaluate(el=>el.open),true);
  assert.match(await page.locator('#onboarding-message').innerText(),/暂时无法确认默认应用/);
  await app.evaluate(()=>{globalThis.noteOnboardingFail=false;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator('#onboarding-primary').filter({hasText:'开始使用'}).waitFor();
  await page.locator('#onboarding-primary').click();await page.locator('#onboarding').waitFor({state:'hidden'});
  await page.reload();await page.waitForTimeout(250);assert.equal(await page.locator('#onboarding').isVisible(),false);
  await app.evaluate(()=>{globalThis.noteOnboardingState={available:true,dismissed:false,md:false,markdown:false};globalThis.noteSettingsTargeted=false;});
  await page.reload();await page.locator('#onboarding').waitFor();await page.locator('#onboarding-primary').click();
  assert.match(await page.locator('#onboarding-message').innerText(),/搜索 \.md/);
  await page.locator('#onboarding-skip').click();await page.reload();await page.waitForTimeout(250);assert.equal(await page.locator('#onboarding').isVisible(),false);
  await page.locator('#app-menu summary').click();await page.locator('#default-app').click();await page.locator('#onboarding').waitFor();
  await app.evaluate(()=>{globalThis.noteSettingsFailure=true;});await page.locator('#onboarding-primary').click();
  await page.locator('#onboarding-message[data-error="true"]').waitFor();assert.match(await page.locator('#onboarding-message').innerText(),/未能打开/);
  await page.keyboard.press('Escape');await page.locator('#onboarding').waitFor({state:'hidden'});
  await app.evaluate(()=>{globalThis.noteSettingsFailure=false;globalThis.noteOnboardingState={available:true,dismissed:false,md:false,markdown:false};globalThis.noteOpenMode='cancel';globalThis.noteNewMode='cancel';});
  await page.reload();await page.locator('#onboarding').waitFor();
  await page.locator('#onboarding-open').click();
  await page.locator('#onboarding-message').filter({hasText:'还没有打开笔记'}).waitFor();
  assert.equal(await page.locator('#onboarding').evaluate(el=>el.open),true);
  await app.evaluate(()=>{globalThis.noteNewMode='fail';});
  await page.locator('#onboarding-new').click();
  await page.locator('#onboarding-message[data-error="true"]').waitFor();
  assert.match(await page.locator('#onboarding-message').innerText(),/没能新建笔记/);
  assert.equal(await page.locator('#onboarding').evaluate(el=>el.open),true);
  await app.evaluate(()=>{globalThis.noteNewMode='ok';});
  await page.locator('#onboarding-new').click();
  await page.locator('#onboarding').waitFor({state:'hidden'});
  await app.evaluate(()=>{globalThis.noteOnboardingState={available:false,dismissed:false,md:false,markdown:false};globalThis.noteOnboardingFail=false;globalThis.noteStateReads=0;});
  await page.reload();await page.locator('.cm-content').waitFor();
  let reads=0;for(let i=0;i<40;i++){reads=await app.evaluate(()=>globalThis.noteStateReads||0);if(reads>0)break;await page.waitForTimeout(100);}
  assert.ok(reads>0);assert.equal(await page.locator('#onboarding').evaluate(el=>el.open),false);
  await page.locator('#app-menu summary').click();await page.locator('#default-app').click();await page.locator('#onboarding').waitFor();
  assert.match(await page.locator('#onboarding-message').innerText(),/预览版/);
  assert.equal(await page.locator('#onboarding-primary').isDisabled(),true);
  assert.equal(await page.locator('#onboarding-open').isDisabled(),false);
  assert.equal(await page.locator('#default-app').innerText(),'使用引导与默认应用…');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,screenshots:output,checks:['first-launch-dialog','initial-focus-open','refresh-failure-clears-success','open-cancel-keeps-dialog','new-error-keeps-dialog','new-success-closes','source-no-auto-intro','manual-source-intro','escape-skip','no-page-or-console-errors']}));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
