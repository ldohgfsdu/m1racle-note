import {launchApp,sleep} from './input-helpers.mjs';
import {mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
// Batch 3A screenshots (real Electron). Composition shot is a CDP event-level simulation, not a real IME.
const output=process.env.NOTE_QA_OUTPUT||resolve('docs/reviews/batch-3a/screens');await mkdir(output,{recursive:true});
const raw='# 写作输入\n\n第一段：这是 alpha beta gamma 的内容 😀。\n\n第二段 second paragraph 继续，含 **粗体** 与 `code`。\n\n- 列表一\n- 列表二\n';
for(const theme of ['light','dark']){
 const t=await launchApp({raw,name:'输入验收.md'});
 try{
  const {page}=t;await t.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,700));
  const dark=await page.evaluate(()=>document.documentElement.classList.contains('dark'));
  if((theme==='dark')!==dark)await page.locator('#theme').click();await sleep(400);
  await t.select(raw.length);await page.keyboard.type('\n连续输入 mixed 中英文 text 123。',{delay:10});await t.waitSaved(await t.doc());
  await page.screenshot({path:join(output,`typed-saved-${theme}.png`)});
  const a=raw.indexOf('alpha'),b=raw.indexOf('second')+6;await t.select(a,b);await sleep(200);
  await page.screenshot({path:join(output,`cross-paragraph-selection-${theme}.png`)});
  await t.select(raw.indexOf('内容'));await t.compose('neirong');await sleep(300);
  await page.screenshot({path:join(output,`sim-composition-preedit-${theme}.png`)});
  await t.compose('');await t.focus();
  await page.locator('#code').click();await sleep(500);
  await page.screenshot({path:join(output,`source-mode-${theme}.png`)});
 }finally{await t.close();}
}
console.log('shots',output);
