import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {DeviceDriver,waitFor} from './device-driver.mjs';
import {nativeElementTarget} from './native-view-target.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node mobile/scripts/writing-tools-check.mjs --serial SERIAL --apk FILE\nStart at home. Real native long-press and format buttons; remaining command selections use CM6. Checks exact disk bytes and undo. Does not accept IME, handle dragging or performance gates.');process.exit(0);}
const output=process.env.NOTE_QA_OUTPUT||await mkdtemp(join(tmpdir(),'note-writing-device-'));await mkdir(output,{recursive:true});
const d=new DeviceDriver({serial:option('--serial'),output}),token=Date.now().toString(36)+'-'+randomBytes(4).toString('hex'),filename='qa-writing-'+token+'.md',transfer='/data/local/tmp/qa-writing-'+token+'.bin';
const raw='\ufeff# 工具验证\r\n\r\n写作内容。\r\n\r保留后文。\n',text=raw.slice(1),body='写作内容。';
const result={date:new Date().toISOString(),serial:d.serial,filename,checks:[],errors:d.errors,selectionMethods:['native-long-press for first bold check','CodeMirror API for remaining command checks'],physicalImeAcceptance:false,physicalHandleAcceptance:false};let own=false;
const save=()=>writeFile(join(output,'writing-result.json'),JSON.stringify(result,null,2));
const passed=async name=>{result.checks.push(name);await save();console.log(JSON.stringify({passed:name}));};
const source=()=>d.evaluate('window.M1racle.getMarkdown()');
const panel=async()=>{let geometry;await waitFor(async()=>{geometry=await d.evaluate('(()=>{const el=document.querySelector(".writing-sheet"),r=el?.getBoundingClientRect();return r?{maxHeight:parseFloat(getComputedStyle(el).maxHeight),top:r.top,bottom:r.bottom,height:r.height,viewport:visualViewport.height}:null;})()');return geometry&&geometry.maxHeight>100&&geometry.height>100&&geometry.top>=0&&geometry.bottom<=geometry.viewport+1;},'writing panel has nonzero visible height');(result.panelGeometry??=[]).push(geometry);};
const original=async()=>{await d.waitDisk(filename,raw);assert.equal(await source(),text);};
const undo=async()=>{await d.tap('button','撤销上一步');await original();};
const select=async()=>{assert.equal(await d.evaluate('window.__noteQaLoaded'),filename,'Stop if the user switches documents');await original();await d.evaluate(`(()=>{const v=document.querySelector('.cm-content').cmTile.root.view,from=v.state.doc.toString().indexOf(${JSON.stringify(body)});v.dispatch({selection:{anchor:from,head:from+${body.length}}});v.focus();})()`);};
await save(); // Keep the owned filename even if USB fails before the first check.
try{
 await d.connect();assert.equal(await d.evaluate('document.body.dataset.screen'),'home','Never replace a user draft');
 result.apkSha256=createHash('sha256').update(await readFile(resolve(option('--apk')))).digest('hex');const installed=d.adb('shell','pm','path','com.m1racle.note').toString().trim().replace(/^package:/,'');assert.equal(d.adb('shell','sha256sum',installed).toString().split(/\s/)[0],result.apkSha256);
 assert.ok(!d.listNotes().includes(filename));await writeFile(join(output,'original.md'),Buffer.from(raw));d.adb('push',join(output,'original.md'),transfer);d.adb('shell','run-as','com.m1racle.note','cp',transfer,'files/Notes/'+filename);own=true;result.ownFixtureCreated=true;await save();await d.openNote(filename,raw);
 if(args.includes('--paragraph-only')){
  result.selectionMethods=['CodeMirror API for paragraph conversion'];
  await select();await d.tap('button','标题');await panel();await d.tap('button','一级标题');const headed=raw.replace(body,'# '+body);await d.waitDisk(filename,headed);
  await d.tap('button','标题');await panel();await d.tap('button','正文');await original();await d.tap('button','撤销上一步');await d.waitDisk(filename,headed);await undo();await passed('native-heading-to-normal-paragraph-and-isolated-byte-exact-undo');
 }else{
 const selector='.cm-line:nth-child(3)';assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`),body);
 let target=await nativeElementTarget(d,selector,'body-focus',{text:true});d.adb('shell','input','tap',String(target.point.x),String(target.point.y));target=await nativeElementTarget(d,selector,'body-long-press',{text:true});d.adb('shell','input','touchscreen','swipe',String(target.point.x),String(target.point.y),String(target.point.x),String(target.point.y),'800');
 await waitFor(()=>d.evaluate('window.M1racle.getSelection().some(s=>s.to>s.from)'),'native selected text');const selected=await d.evaluate('window.M1racle.getSelection()');assert.equal(selected.length,1);const {from,to}=selected[0],part=text.slice(from,to);assert.ok(part&&!/[\s*]/.test(part));
 await d.tap('button','加粗');await d.waitDisk(filename,'\ufeff'+text.slice(0,from)+'**'+part+'**'+text.slice(to));await d.screenshot('native-selection-bold.png');await undo();await passed('native-long-press-then-bold-preserves-selected-range-and-byte-exact-undo');
 for(const [button,prefix] of [['列表','- '],['待办','- [ ] ']]){await select();await d.tap('button',button);await d.waitDisk(filename,raw.replace(body,prefix+body));await undo();await passed('native-'+button+'-and-exact-undo');}
 for(const [button,prefix,suffix=''] of [['一级标题','# '],['二级标题','## '],['三级标题','### '],['四级标题','#### '],['五级标题','##### '],['六级标题','###### '],['斜体','*','*'],['删除线','~~','~~'],['行内代码','`','`'],['编号列表','1. '],['引用','> ']]){
  await select();await d.tap('button','标题');await panel();await d.tap('button',button);await d.waitDisk(filename,raw.replace(body,prefix+body+suffix));await undo();await passed('native-'+button+'-and-exact-undo');
 }
 await select();await d.tap('button','插入');await panel();await d.tap('button','链接');await panel();assert.equal(await d.evaluate('document.querySelector(".writing-sheet input").value'),body);await d.tap('textbox','网址');const url='https://example.com/note-qa-'+token;d.adb('shell','input','text',url);await d.tap('button','插入链接');await d.waitDisk(filename,raw.replace(body,'['+body+']('+url+')'));await waitFor(()=>d.evaluate('document.activeElement===document.querySelector(".cm-content")'),'focus returns after link insertion');await d.screenshot('inserted-link.png');await undo();await passed('native-link-form-retains-selected-label-and-exact-range-with-keyboard-focus-return');
 await select();await d.tap('button','插入');await panel();await d.tap('button','链接');await panel();await d.tap('button','取消');await original();await passed('native-link-cancel-leaves-source-unchanged');
 await select();await d.tap('button','插入');await panel();await d.tap('button','代码块');await panel();await d.tap('textbox','代码语言');d.adb('shell','input','text','python');await d.tap('button','插入代码块');const fenced=await source();assert.ok(fenced.includes('```python\r\n'+body+'\r\n```'));await d.waitDisk(filename,'\ufeff'+fenced);await undo();await passed('native-code-block-wraps-selected-text-and-exact-undo');
 for(const [button,syntax] of [['分隔线','---'],['表格源码模板','| 标题 | 标题 |']]){await select();await d.tap('button','插入');await panel();await d.tap('button',button);const current=await source();assert.ok(current.includes(syntax)&&current.includes(body));await d.waitDisk(filename,'\ufeff'+current);if(button==='表格源码模板')await d.screenshot('table-source-template.png');await undo();await passed('native-'+button+'-keeps-selected-text-and-exact-undo');}
 await select();await d.tap('button','列表');await d.waitDisk(filename,raw.replace(body,'- '+body));await d.evaluate(`(()=>{const v=document.querySelector('.cm-content').cmTile.root.view,at=v.state.doc.toString().indexOf(${JSON.stringify(body)})+${body.length};v.dispatch({selection:{anchor:at}});v.focus();})()`);d.adb('shell','input','keyevent','KEYCODE_ENTER');await d.waitDisk(filename,raw.replace(body,'- '+body+'\r\n- '));d.adb('shell','input','keyevent','KEYCODE_ENTER');await d.waitDisk(filename,raw.replace(body,'- '+body+'\r\n'));let undoSteps=0;while(await source()!==text&&undoSteps<6){await d.tap('button','撤销上一步');undoSteps++;}await original();result.listUndoSteps=undoSteps;await passed('native-Enter-continues-list-and-exits-empty-item-with-byte-exact-history');
 }
 assert.deepEqual(d.errors,[]);result.passed=true;
}catch(error){result.passed=false;result.failure=String(error.stack||error);process.exitCode=1;await d.screenshot('failure.png').catch(()=>{});}
finally{
 if(own)try{await d.evaluate('window.M1racle.back()');await waitFor(()=>d.evaluate('document.body.dataset.screen==="home"&&!document.querySelector(".busy-indicator")'),'home before own fixture cleanup');d.adb('shell','run-as','com.m1racle.note','rm','files/Notes/'+filename);d.adb('shell','rm',transfer);result.ownFixtureRemoved=true;}catch(error){result.passed=false;result.cleanupFailure=String(error);process.exitCode=1;}
 try{await d.disconnect();}catch(error){result.passed=false;result.disconnectFailure=String(error);process.exitCode=1;}finally{await save();}console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,output}));
}
