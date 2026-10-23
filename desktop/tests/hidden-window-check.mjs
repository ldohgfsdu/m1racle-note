import './hidden-launch.mjs';
import {captureHidden} from './evidence-capture.mjs';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const stage=(name,detail={})=>{
  process.stdout.write(`STAGE ${name} ${JSON.stringify(detail)}\n`);
};

const hiddenMain=resolve('desktop/tests/hidden-main.cjs').replaceAll('\\','/');
const dir=await mkdtemp(join(tmpdir(),'note-hidden-check-'));
const file=join(dir,'hidden-window.md');
await writeFile(file,'\ufeffhidden window check\r\n');
const env={...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const requireArg=`--require "${hiddenMain}"`;
env.NODE_OPTIONS=env.NODE_OPTIONS?`${env.NODE_OPTIONS} ${requireArg}`:requireArg;
const runnerWrapped=globalThis.__noteHiddenExecFileSync===true;

let app;
try {
  stage('launch:start',{runnerWrapped,hiddenMain});
  app=await electron.launch({
    executablePath:resolve('node_modules/electron/dist/electron.exe'),
    args:[resolve('desktop/main.mjs'),file,'--user-data-dir='+join(dir,'profile')],
    env,
    timeout:60000,
  });
  stage('launch:done');

  // Read native window state before waiting for the renderer. This distinguishes
  // a product-side ready/firstWindow hang from a visible window.
  const sample=async(label)=>{
    const value=await app.evaluate(({BrowserWindow},sampleLabel)=>({
      label:sampleLabel,
      now:Date.now(),
      windows:BrowserWindow.getAllWindows().map(win=>({
        isVisible:win.isVisible(),
        isFocused:win.isFocused(),
        isMinimized:win.isMinimized(),
        bounds:win.getBounds(),
        windowMode:globalThis.__noteHiddenBrowserWindowMode??null,
        webContentsOffscreen:typeof win.webContents.isOffscreen==='function'?win.webContents.isOffscreen():null,
        webContentsBackgroundThrottling:typeof win.webContents.getBackgroundThrottling==='function'
          ?win.webContents.getBackgroundThrottling():null,
        webContentsFrameRate:typeof win.webContents.getFrameRate==='function'?win.webContents.getFrameRate():null,
      })),
    }),label);
    console.log(JSON.stringify(value));
    assert.ok(value.windows.length>0,'no BrowserWindow exists');
    for(const win of value.windows) {
      assert.equal(win.isVisible,false,'BrowserWindow.isVisible() must remain false');
      assert.equal(win.isFocused,false,'hidden checks must not claim OS foreground focus');
    }
    return value;
  };

  stage('sample:startup:before-firstWindow');
  await sample('startup-before-firstWindow');

  stage('firstWindow:start');
  const page=await app.firstWindow({timeout:60000});
  stage('firstWindow:done');
  stage('filename:start');
  await page.locator('#filename').filter({hasText:'hidden-window.md'}).waitFor({timeout:30000});
  stage('filename:done');
  stage('editor-ready:start');
  await page.waitForFunction(()=>document.querySelector('.cm-content')?.cmTile?.root?.view?.state?.doc?.length>0);
  stage('editor-ready:done');

  stage('renderer-animation-frames:start',{requiredFrames:4,timeoutMs:3000});
  const animationFrames=await page.evaluate(async ({requiredFrames,timeoutMs})=>{
    const before={hidden:document.hidden,visibilityState:document.visibilityState};
    const started=performance.now(),frames=[];
    let timer;
    try {
      await Promise.race([
        (async()=>{
          for(let index=1;index<=requiredFrames;index++) {
            const timestamp=await new Promise(requestAnimationFrame);
            frames.push({index,timestamp,durationMs:performance.now()-started});
          }
        })(),
        new Promise((_,reject)=>{
          timer=setTimeout(()=>reject(new Error(
            `requestAnimationFrame produced only ${frames.length}/${requiredFrames} frames in ${timeoutMs}ms`,
          )),timeoutMs);
        }),
      ]);
      return {
        passed:true,before,after:{hidden:document.hidden,visibilityState:document.visibilityState},
        requiredFrames,frames,durationMs:performance.now()-started,
      };
    } catch(error) {
      return {
        passed:false,before,after:{hidden:document.hidden,visibilityState:document.visibilityState},
        requiredFrames,frames,durationMs:performance.now()-started,error:String(error?.message||error),
      };
    } finally {
      clearTimeout(timer);
    }
  },{requiredFrames:4,timeoutMs:3000});
  console.log(JSON.stringify({label:'renderer-animation-frames',animationFrames}));
  stage('renderer-animation-frames:done',{
    passed:animationFrames.passed,frames:animationFrames.frames.length,
    durationMs:animationFrames.durationMs,
  });
  assert.equal(animationFrames.passed,true,
    `hidden renderer did not deliver four animation frames: ${JSON.stringify(animationFrames)}`);

  stage('guard:start');
  const dialogGuard=await app.evaluate(async (electron)=>{
    const reinstall = globalThis.installDialogs;
    if (typeof reinstall !== 'function') {
      return { installed: false, reason: 'installDialogs is unavailable' };
    }
    const installation = reinstall();
    if (installation?.installed !== true) {
      return { installed: false, reason: 'installDialogs did not confirm installation' };
    }
    // Compare electron.dialog with the object returned by installDialogs without
    // invoking any dialog method. Only the marker confirms the fail-closed guard.
    const dialog = electron.dialog;
    const methods=[
      'showOpenDialog','showSaveDialog','showMessageBox','showErrorBox',
      'showOpenDialogSync','showSaveDialogSync','showMessageBoxSync',
    ];
    const entries={};
    for(const method of methods) {
      const fn = electron.dialog[method];
      if (typeof fn !== 'function' || fn.__noteHiddenGuard !== true) {
        return {
          installed: false,
          method,
          marked: electron.dialog[method]?.__noteHiddenGuard === true,
        };
      }
      entries[method] = { blocked: true, marked: true };
    }
    return {
      installed: true,
      liveDialogMatches: dialog === installation.dialog,
      methods: entries,
    };
  });
  console.log(JSON.stringify({label:'dialog-guard',dialogGuard}));
  stage('guard:done');
  assert.equal(dialogGuard.installed,true,
    `hidden dialog guard is not installed: ${JSON.stringify(dialogGuard)}`);
  assert.equal(dialogGuard.liveDialogMatches,true,
    'app.evaluate live dialog object does not match Electron dialog');
  for(const [method,result] of Object.entries(dialogGuard.methods)) {
    assert.equal(result.marked,true,`hidden guard marker missing for ${method}`);
  }

  stage('sample:startup');
  await sample('startup');
  stage('explicit-show:start');
  await app.evaluate(({BrowserWindow})=>{
    const win=BrowserWindow.getAllWindows()[0];
    win.show();
    win.showInactive();
    win.focus();
    win.moveTop();
  });
  stage('sample:explicit-show-calls');
  await sample('explicit-show-calls');

  stage('resize:start');
  const beforeResize=await page.evaluate(()=>({innerWidth,innerHeight}));
  stage('resize:requested',{width:760,height:520,beforeViewport:beforeResize});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(760,520));
  await page.waitForFunction(
    before=>innerWidth!==before.innerWidth||innerHeight!==before.innerHeight,
    beforeResize,
    {timeout:30000},
  );
  const resizeViewport=await page.evaluate(()=>({innerWidth,innerHeight}));
  const resizeNative=await app.evaluate(({BrowserWindow})=>{
    const win=BrowserWindow.getAllWindows()[0];
    return {
      bounds:win.getBounds(),
      contentBounds:win.getContentBounds(),
      isVisible:win.isVisible(),
      isFocused:win.isFocused(),
    };
  });
  stage('resize:observed',{requested:{width:760,height:520},beforeViewport:beforeResize,actualViewport:resizeViewport,actualNative:resizeNative});
  assert.equal(resizeNative.isVisible,false,'BrowserWindow became visible after resize');
  assert.equal(resizeNative.isFocused,false,'BrowserWindow gained OS focus after resize');
  stage('sample:resize');
  await sample('resize');

  stage('editing:start');
  await page.locator('.cm-content').evaluate(content=>{
    const view=content.cmTile.root.view;
    view.dispatch({selection:{anchor:0,head:view.state.doc.line(1).to}});
    view.focus();
  });
  await page.keyboard.type('X');
  await page.keyboard.press('Control+z');
  stage('screenshot:start');
  await captureHidden(app,page,join(dir,'hidden-check.png'));
  stage('screenshot:done');
  const edit=await page.locator('.cm-content').evaluate(content=>({
    text:content.cmTile.root.view.state.doc.toString(),
    active:content.contains(document.activeElement),
  }));
  console.log(JSON.stringify({label:'editing',edit}));
  assert.ok(edit.text.includes('hidden window check'),'CodeMirror document is missing');
  assert.equal(edit.active,true,'CodeMirror did not receive emulated renderer focus');

  for(let index=0;index<5;index++) {
    await new Promise(done=>setTimeout(done,200));
    stage(`sample:stability-${index+1}`);
    await sample(`stability-${index+1}`);
  }
  console.log(JSON.stringify({
    status:'PASS',hiddenWindowCheck:true,runnerExecFileSyncWrapped:runnerWrapped,
    foregroundEvidence:'UNVERIFIED',
  }));
} finally {
  if(app) {
    stage('cleanup:exit');
    await app.evaluate(({app:electronApp})=>electronApp.exit(0)).catch(()=>{});
    stage('cleanup:close');
    await app.close().catch(()=>{});
  }
  stage('cleanup:remove-temp');
  await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200}).catch(()=>{});
  stage('cleanup:done');
}
