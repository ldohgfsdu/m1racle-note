import './hidden-launch.mjs';
import {captureHidden} from './evidence-capture.mjs';
import {launchApp} from './input-helpers.mjs';
import {expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

// Bounded capability probe, not an automatic visual acceptance suite. No ROI
// heuristic, retries, display activation, or inferred menu identity is allowed.
const output=resolve(process.env.NOTE_QA_OUTPUT);
await mkdir(output,{recursive:true});
process.env.NOTE_QA_CAPTURE='cdp';
const t=await launchApp({raw:'\ufeff# 受控截图\r\n\r\n## hello world\r\n\r\n第二段正文保持原样。\r\n',name:'受控截图.md'});
const results=[];
const capture=async label=>{
  const result=await captureHidden(t.app,t.page,join(output,label+'.png'));
  results.push({label,...result});
  console.log('CAPTURE',label,result.image?'CANDIDATE':'UNVERIFIED');
  if(result.captureError)throw new Error(result.captureError);
};
try {
  await t.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));
  const from=(await t.doc()).indexOf('hello world');
  const select=()=>t.select(from,from+11);
  const theme=async dark=>{
    if(dark!==await t.page.evaluate(()=>document.documentElement.classList.contains('dark')))await t.page.locator('#theme').click();
    await expect.poll(()=>t.page.evaluate(()=>document.documentElement.classList.contains('dark'))).toBe(dark);
  };
  for(const dark of [false,true]) {
    await theme(dark);await select();
    await t.page.locator('#heading-level').click();
    await expect(t.page.locator('#heading-menu')).toHaveAttribute('open','');
    await capture(`top-${dark?'dark':'light'}`);
    await t.page.keyboard.press('Escape');
    await t.page.locator('#heading-level').evaluate(el=>el.parentElement.open=false);
    await select();
    const trigger=t.page.locator('[data-selection-submenu="text"]');
    await expect(trigger).toBeVisible();
    const box=await trigger.boundingBox();
    await t.page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    await expect(t.page.locator('#selection-text-options')).toBeVisible();
    await capture(`floating-h2-${dark?'dark':'light'}`);
    if(dark) {
      await t.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(720,520));
      await expect.poll(()=>t.page.evaluate(()=>innerWidth)).toBeLessThan(1000);
      await capture('narrow-resize-dark');
    }
    await t.page.keyboard.press('Escape');
  }
  await t.focus();
  await t.page.keyboard.press('Control+e');
  await expect(t.page.locator('.pane')).toHaveAttribute('data-mode','source');
  await capture('source-dark');
  await t.page.keyboard.press('Control+e');
  await expect(t.page.locator('.pane')).toHaveAttribute('data-mode','rendered');
  await capture('rendered-dark');
  assert.equal(await t.doc(),'# 受控截图\n\n## hello world\n\n第二段正文保持原样。\n');
} catch(error) {
  results.push({probeError:String(error?.stack||error)});
  process.exitCode=1;
} finally {
  await writeFile(join(output,'capture-controlled-ui.json'),JSON.stringify({
    status:'VISUAL_UNVERIFIED',attemptsPerState:1,maxCaptureMs:5000,results,
    acceptance:'Only independent pixel review can accept a specific image; the capture API does not issue PASS.',
  },null,2),{flag:'wx'});
  await t.close();
}
