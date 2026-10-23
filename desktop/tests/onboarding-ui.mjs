import {_electron as electron} from '@playwright/test';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const profile=await mkdtemp(join(tmpdir(),'note-onboarding-'));
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),args:[resolve('desktop/main.mjs'),'--user-data-dir='+profile],env,timeout:30000});
try {
  const page=await app.firstWindow();await page.locator('.cm-content').waitFor();
  // Simulated native responses exercise onboarding without altering system defaults.
  await app.evaluate(({ipcMain})=>{
    globalThis.noteOnboardingState={available:true,dismissed:false,md:false,markdown:false};globalThis.noteSettingsTargeted=true;
    ipcMain.removeHandler('document');ipcMain.handle('document',(_event,type)=>{
      if(type==='initial')return null;
      if(type==='theme-icon')return true;
      if(type==='onboarding-state')return globalThis.noteOnboardingState;
      if(type==='onboarding-dismiss'){globalThis.noteOnboardingState.dismissed=true;return true;}
      if(type==='default-app'){if(globalThis.noteSettingsFailure)throw new Error('launch failed');return {targeted:globalThis.noteSettingsTargeted};}
      throw new Error('Unexpected test request');
    });
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
  await page.reload();await page.locator('#onboarding').waitFor();
  assert.equal(await page.title(),'M1racle Note');assert.equal(await page.locator('#onboarding-primary').innerText(),'前往设置');
  assert.equal(await page.locator('#onboarding-primary').evaluate(e=>e===document.activeElement),true);
  const output=join(tmpdir(),'m1racle-note-windows-qa');await mkdir(output,{recursive:true});
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
  assert.equal(await page.locator('#onboarding-primary').innerText(),'继续设置');
  await app.evaluate(()=>{globalThis.noteOnboardingState.markdown=true;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator('#onboarding-primary').filter({hasText:'开始使用'}).waitFor();
  await page.screenshot({path:join(output,'onboarding-success.png')});
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
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,screenshots:output,checks:['first-launch-dialog','initial-focus','targeted-instructions','partial-default-status','verified-completion','completed-no-repeat','generic-fallback-instructions','skip-no-repeat','manual-reopen','launch-error','escape-skip','no-page-or-console-errors']}));
}finally{await app.evaluate(({app})=>app.exit(0));await app.close().catch(()=>{});await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
