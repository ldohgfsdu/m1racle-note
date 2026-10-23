import './hidden-launch.mjs';
import {launchApp} from './input-helpers.mjs';
import {captureHidden} from './evidence-capture.mjs';
import {expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const output=resolve(process.env.NOTE_QA_OUTPUT || 'docs/reviews/batch-3c/raw/efficiency');
await mkdir(output,{recursive:true});
const records=[];
const base='频繁操作目标文字\n\n第二段 English text\n';
const raw='\ufeff'+base.replaceAll('\n','\r\n');
const stored=text=>'\ufeff'+text.replaceAll('\n','\r\n');
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {n:sorted.length,medianMs:sorted[Math.floor(sorted.length/2)],maxMs:sorted.at(-1)};};

for(const dark of [false,true]) {
  const t=await launchApp({raw,name:'高频操作.md'});
  try {
    const click=async locator=>{
      assert.equal(await locator.isVisible(),true,'functional control must be DOM-visible');
      const box=await locator.boundingBox();
      assert.ok(box && box.width>0 && box.height>0,'control requires measured geometry');
      await t.page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    };
    if(dark !== await t.page.evaluate(()=>document.documentElement.classList.contains('dark')))await click(t.page.locator('#theme'));
    await t.page.evaluate(()=>{
      globalThis.__efficiencyActions={pointerdowns:0,modifierKeydowns:0,inputEvents:0};
      document.addEventListener('pointerdown',()=>globalThis.__efficiencyActions.pointerdowns++,true);
      document.addEventListener('keydown',event=>{if(event.ctrlKey||event.altKey||event.metaKey)globalThis.__efficiencyActions.modifierKeydowns++;},true);
      document.addEventListener('input',()=>globalThis.__efficiencyActions.inputEvents++,true);
    });
    const run=async(id,body)=>{
      const record={id,theme:dark?'dark':'light',status:'PASS',latencyScope:'Hidden renderer orchestration only; foreground performance UNVERIFIED'};
      console.log('START',id,record.theme);
      try {
        const before=await t.page.evaluate(()=>({...globalThis.__efficiencyActions}));
        record.operations=await body();
        const after=await t.page.evaluate(()=>({...globalThis.__efficiencyActions}));
        record.actions=Object.fromEntries(Object.keys(after).map(key=>[key,after[key]-before[key]]));
        record.selectionFixture='CodeMirror selections are prepared programmatically; excluded from user action counts.';
        await expect.poll(()=>readFile(t.file,'utf8'),{timeout:5000}).toBe(stored(await t.doc()));
        await expect(t.page.locator('#status')).toHaveText('已保存');
        assert.deepEqual(t.errors,[]);
        assert.equal(await t.page.locator('#error').isVisible(),false);
        const bytes=await readFile(t.file);
        record.sha256=createHash('sha256').update(bytes).digest('hex');
        record.bytes=bytes.length;
        record.native=await t.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(win=>({visible:win.isVisible(),focused:win.isFocused()})));
        assert.ok(record.native.every(win=>!win.visible&&!win.focused));
      } catch(error) {
        record.status='FAIL';record.error=String(error?.stack||error);
        record.state=await t.state().catch(()=>null);
      }
      records.push(record);
      await writeFile(join(output,`${dark?'dark':'light'}-${id}.json`),JSON.stringify(record,null,2),{flag:'wx'});
      console.log(record.status,id,record.theme);
      return record.status==='PASS';
    };
    let failed=false;
    for(const [id,action,expected] of [
      ['bold-toolbar',()=>click(t.page.locator('#format [data-format="bold"]')),base.replace('目标文字','**目标文字**')],
      ['bold-shortcut',()=>t.page.keyboard.press('Control+b'),base.replace('目标文字','**目标文字**')],
      ['list-toolbar',()=>click(t.page.locator('#format [data-format="list"]')),'- '+base],
      ['quote-toolbar',()=>click(t.page.locator('#format [data-format="quote"]')),'> '+base],
    ]) {
      const passed=await run(id,async()=>{
        const samples=[];
        for(let i=0;i<5;i++) {
          const start=base.indexOf('目标文字');
          await t.select(start,start+4);
          const began=performance.now();
          await action();assert.equal(await t.doc(),expected);
          await click(t.page.locator('#undo'));assert.equal(await t.doc(),base);
          await click(t.page.locator('#redo'));assert.equal(await t.doc(),expected);
          await click(t.page.locator('#undo'));assert.equal(await t.doc(),base);
          samples.push(performance.now()-began);
        }
        return {cycles:5,formatUndoRedoUndo:stats(samples),exactDocumentChecks:20};
      });
      if(!passed){failed=true;break;}
    }
    if(failed)continue;
    if(!await run('find-close-continue',async()=>{
      const samples=[];
      for(let i=0;i<5;i++) {
        const began=performance.now();
        await click(t.page.locator('#find'));
        const panel=t.page.locator('.cm-search');
        await panel.getByRole('textbox',{name:'查找',exact:true}).fill('English');
        await click(panel.getByRole('button',{name:'下一处',exact:true}));
        assert.equal(await t.page.locator('.cm-content').evaluate(el=>{const view=el.cmTile.root.view,s=view.state.selection.main;return view.state.doc.sliceString(s.from,s.to);}), 'English');
        await click(panel.getByRole('button',{name:'关闭查找',exact:true}));
        assert.equal((await t.state()).focus,true);
        assert.equal(await t.doc(),base);
        samples.push(performance.now()-began);
      }
      return {cycles:5,findClose:stats(samples),selectionExact:true,editorFocusRestored:true};
    }))continue;
    if(!await run('source-rendered-toggle',async()=>{
      const samples=[];
      const original=(await t.state()).mode;
      for(let i=0;i<5;i++) {
        await t.focus();
        const began=performance.now();
        await t.page.keyboard.press('Control+e');
        await expect.poll(()=>t.state().then(state=>state.mode)).not.toBe(original);
        assert.equal(await t.doc(),base);
        await t.page.keyboard.press('Control+e');
        await expect.poll(()=>t.state().then(state=>state.mode)).toBe(original);
        assert.equal(await t.doc(),base);
        samples.push(performance.now()-began);
      }
      return {cycles:5,roundTrip:stats(samples),sourceUnchanged:true};
    }))continue;
    await run('rapid-typing-burst',async()=>{
      await t.select(base.length);
      const burst='rapid writing 0123456789 '.repeat(5);
      const began=performance.now();
      await t.page.keyboard.type(burst,{delay:0});
      assert.equal(await t.doc(),base+burst);
      await expect.poll(()=>readFile(t.file,'utf8'),{timeout:5000}).toBe(stored(base+burst));
      return {characters:burst.length,typingCalls:1,orchestrationMs:performance.now()-began,exactBytes:true,physicalIme:'UNVERIFIED'};
    });
    await captureHidden(t.app,t.page,join(output,`${dark?'dark':'light'}-end.png`));
  } finally {await t.close();}
}
const report={suite:'writing-efficiency-ui',evidenceClass:'FUNCTIONAL',status:records.some(row=>row.status==='FAIL')?'FAIL':'PASS',
  records,visual:'VISUAL_UNVERIFIED',humanEfficiency:'UNVERIFIED',foregroundPerformance:'UNVERIFIED',
  actionBoundary:'Counts are automation events; they do not measure human task time or physical keystrokes.'};
await writeFile(join(output,'writing-efficiency-ui.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({suite:report.suite,status:report.status,passed:records.filter(row=>row.status==='PASS').length,failed:records.filter(row=>row.status==='FAIL').length}));
if(report.status==='FAIL')process.exitCode=1;
