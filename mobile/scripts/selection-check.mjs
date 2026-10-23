import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {DeviceDriver,waitFor} from './device-driver.mjs';

// Packaged WebView presentation regression. Native handle acceptance is manual.
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node mobile/scripts/selection-check.mjs --serial SERIAL [--apk FILE]\nStart at home. Checks packaged preview geometry with programmatic CM selections, replacement and exact undo; does not drive or accept physical handles.');process.exit(0);}
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-selection-device-'));await mkdir(output,{recursive:true});
const d=new DeviceDriver({serial:option('--serial'),output}),token=Date.now().toString(36)+'-'+randomBytes(4).toString('hex'),filename='qa-selection-'+token+'.md',transfer='/data/local/tmp/note-selection-'+token+'.bin';
const raw='\ufeff# 选字位置\r\n\r\n**粗体中文** 和 [链接文字](https://example.invalid) 在同一段。\r第二段保留换行。\n\n末尾。',text=raw.slice(1);
const result={date:new Date().toISOString(),serial:d.serial,filename,selectionMethod:'programmatic-CodeMirror-selection',physicalHandleAcceptance:false,checks:[],errors:d.errors};let own=false;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const select=(first,last)=>d.evaluate(`(()=>{const v=document.querySelector('.cm-content').cmTile.root.view,t=v.state.doc.toString();v.dispatch({selection:{anchor:t.indexOf(${JSON.stringify(first)}),head:t.indexOf(${JSON.stringify(last)})+${last.length}}});})()`);
const geometry=()=>d.evaluate(`(()=>{const v=document.querySelector('.cm-content').cmTile.root.view,t=v.state.doc.toString(),line=[...document.querySelectorAll('.cm-line')].find(line=>line.textContent.includes('粗体中文'));return {text:line.textContent,points:['粗体中文','链接文字'].map(word=>{const r=v.coordsForChar(t.indexOf(word)+1);return r?{left:r.left,right:r.right,top:r.top+v.scrollDOM.scrollTop,bottom:r.bottom+v.scrollDOM.scrollTop}:null;})};})()`);
try {
 await d.connect();assert.equal(await d.evaluate('document.body.dataset.screen'),'home','Start at home; do not replace a user draft.');await d.waitNativeScreen();assert.ok(!d.listNotes().includes(filename));
 await writeFile(join(output,'original.md'),Buffer.from(raw));d.adb('push',join(output,'original.md'),transfer);d.adb('shell','run-as','com.m1racle.note','cp',transfer,'files/Notes/'+filename);own=true;
 await d.openNote(filename,raw);await d.focusEnd();const before=await geometry();assert.ok(before.points.every(Boolean));assert.ok(!before.text.includes('**') && !before.text.includes('https://'));
 result.before=before;
 for(const [first,last] of [['粗体','体'],['粗体','链接文字'],['粗体','第二段保留换行。'],['第二段','粗体中文']]){
  await select(first,last);await d.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const after=await geometry();assert.equal(after.text,before.text);
  for(let i=0;i<before.points.length;i++)for(const key of ['left','right','top','bottom'])assert.ok(Math.abs(after.points[i][key]-before.points[i][key])<0.5,'Selection must not move the displayed text.');
  const from=text.indexOf(first),to=text.indexOf(last)+last.length;assert.deepEqual(await d.evaluate('window.M1racle.getSelection()'),[{from:Math.min(from,to),to:Math.max(from,to)}]);
  assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),text);assert.ok(d.readNote(filename).equals(Buffer.from(raw)));result.checks.push({first,last,geometryStable:true});
 }
 await d.waitNativeScreen();await d.screenshot('packaged-selection.png');await select('粗体','链接文字');await d.call('Input.insertText',{text:'替换🌱'});
 const changed='\ufeff'+text.slice(0,text.indexOf('粗体'))+'替换🌱'+text.slice(text.indexOf('链接文字')+'链接文字'.length);await d.waitDisk(filename,changed);
 await d.evaluate('window.M1racle.undo()');await d.waitDisk(filename,raw);assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),text);result.replacementAndUndoExact=true;
 result.version=d.adb('shell','dumpsys','package','com.m1racle.note').toString().match(/versionName=([^\s]+)/)?.[1];
 if(option('--apk')){result.apkSha256=hash(await readFile(resolve(option('--apk'))));const installed=d.adb('shell','pm','path','com.m1racle.note').toString().trim().replace(/^package:/,'');assert.equal(d.adb('shell','sha256sum',installed).toString().split(/\s/)[0],result.apkSha256);}
 await d.waitNativeScreen();assert.deepEqual(d.errors,[]);result.passed=true;
}catch(error){result.passed=false;result.failure=String(error.stack || error);process.exitCode=1;await d.screenshot('failure.png').catch(()=>{});}
finally {
 if(own)try{await d.evaluate('window.M1racle.back()');await waitFor(()=>d.evaluate('document.body.dataset.screen==="home" && !document.querySelector(".busy-indicator")'),'home before removing owned selection note');d.adb('shell','run-as','com.m1racle.note','rm','files/Notes/'+filename);d.adb('shell','rm',transfer);await d.evaluate('window.M1racle.back()');result.ownFixtureRemoved=true;}catch(error){result.cleanupFailure=String(error.message);result.passed=false;process.exitCode=1;}
 try{await d.disconnect();}catch(error){result.disconnectFailure=String(error.message);result.passed=false;process.exitCode=1;}
 await writeFile(join(output,'selection-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,version:result.version,physicalHandleAcceptance:false,output}));
}
