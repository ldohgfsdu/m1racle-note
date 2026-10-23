import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Functional assertions never depend on a screenshot. A PNG is only a candidate
// until its actual pixels have been independently reviewed against this DOM.
export async function captureHidden(app, page, path) {
  const native = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().map(win => ({
    visible:win.isVisible(), focused:win.isFocused(), bounds:win.getBounds(),
    offscreen:win.webContents.isOffscreen(),
  })));
  assert.ok(native.length > 0 && native.every(win => !win.visible && !win.focused),
    'TEST_ENVIRONMENT_ERROR: capture requires hidden, unfocused native windows');
  const dom = await page.evaluate(() => ({
    title:document.title, url:location.href, viewport:{width:innerWidth,height:innerHeight},
    dpr:devicePixelRatio, theme:document.documentElement.dataset.theme,
    mode:document.querySelector('.pane')?.dataset.mode,
    targets:[...document.querySelectorAll('#selection-text-options, #heading-menu .menu-items')].map(el => ({
      id:el.id, visible:el.checkVisibility({checkVisibilityCSS:true}) && !el.closest('details:not([open])'),
      rect:el.getBoundingClientRect().toJSON(), text:el.textContent,
    })),
  }));
  const evidence = {status:'VISUAL_UNVERIFIED', image:null, metadataPath:path+'.meta.json',
    method:process.env.NOTE_QA_CAPTURE === 'cdp' ? 'CDP Page.captureScreenshot' : 'functional-only',
    native, dom, reason:'Screenshot identity has not been independently reviewed; DOM is functional evidence only.'};
  if (process.env.NOTE_QA_CAPTURE === 'cdp') {
    let session, timer;
    try {
      session = await page.context().newCDPSession(page);
      const result = await Promise.race([
        session.send('Page.captureScreenshot', {format:'png',fromSurface:true,captureBeyondViewport:false}),
        new Promise((_,reject) => {timer=setTimeout(() => reject(new Error('single controlled capture exceeded 5000ms')),5000);}),
      ]);
      const bytes = Buffer.from(result.data,'base64');
      assert.ok(bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')), 'invalid PNG');
      await writeFile(path,bytes,{flag:'wx'});
      evidence.image=path;
      evidence.sha256=createHash('sha256').update(bytes).digest('hex');
      evidence.bytes=bytes.length;
    } catch(error) {
      evidence.captureError=String(error?.stack || error);
    } finally {
      clearTimeout(timer);
      await session?.detach().catch(()=>{});
    }
  }
  await writeFile(evidence.metadataPath,JSON.stringify(evidence,null,2),{flag:'wx'});
  return evidence;
}
