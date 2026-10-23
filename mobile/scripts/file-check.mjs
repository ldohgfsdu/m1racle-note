import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {DeviceDriver,waitFor} from './device-driver.mjs';

const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
if(args.includes('--help')){console.log('node mobile/scripts/file-check.mjs [--serial SERIAL] [--apk FILE]\nDebug app, Node 22+ and ADB required. Tests pause/resume and restarts the app; creates and removes only its own notes. Start from home.');process.exit(0);}
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-files-device-'));await mkdir(output,{recursive:true});
const device=new DeviceDriver({serial:option('--serial'),output}),token=Date.now().toString(36)+'-'+randomBytes(4).toString('hex');
const prefix='qa-lifecycle-'+token+'-',owned=new Set(),transfer='/data/local/tmp/note-lifecycle-'+token+'.bin';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),result={date:new Date().toISOString(),serial:device.serial,fixturePrefix:prefix,ownedFiles:[],checks:[],touches:[],errors:device.errors,physicalGates:{ChineseIme:'pending',selectionHandles:'pending',sustainedPerformance:'pending'}};
const saveProgress=async()=>{result.ownedFiles=[...owned];await writeFile(join(output,'file-progress.json'),JSON.stringify(result,null,2));};
const passed=async name=>{result.checks.push(name);await saveProgress();console.log(JSON.stringify({passed:name}));};
const writeNote=async(name,bytes)=>{
 assert.ok(name.startsWith(prefix));assert.match(name,/^[a-zA-Z0-9.-]+\.md$/);owned.add(name);
 const host=join(output,'transfer.bin');await writeFile(host,bytes);device.adb('push',host,transfer);device.adb('shell','run-as','com.m1racle.note','cp',transfer,'files/Notes/'+name);
};
const home=async()=>{await device.evaluate('window.M1racle.back()');await waitFor(()=>device.evaluate('document.body.dataset.screen==="home" && !document.querySelector(".busy-indicator")'),'home after flush');};
const appearance=()=>device.evaluate('({theme:document.documentElement.dataset.theme,paper:document.documentElement.dataset.paper,font:document.documentElement.dataset.font,size:document.documentElement.style.getPropertyValue("--body-size"),leading:document.documentElement.style.getPropertyValue("--body-leading")})');
const insert=async text=>{await device.focusEnd();await device.call('Input.insertText',{text});};
const restart=async()=>{
 await device.disconnect();device.adb('shell','am','force-stop','com.m1racle.note');
 device.adb('shell','am','start','-n','com.m1racle.note/.MainActivity');await device.connect();
 await waitFor(()=>device.evaluate('document.body.dataset.screen==="home" && !document.querySelector(".busy-indicator")'),'restart home');await device.waitNativeScreen();
};
let initialAppearance;
try {
 await device.connect();assert.equal(await device.evaluate('document.body.dataset.screen'),'home','Start at home so no user draft is replaced.');await device.waitNativeScreen();
 initialAppearance=await appearance();
 const filename=prefix+'core.md',raw='\ufeff# 文件流程\r\n\r\n原文不能丢失。\n尾行\r',other=prefix+'other.md',otherRaw='# 第二篇\r\n\n保持不变。\n';
 await writeNote(filename,Buffer.from(raw));await writeNote(other,Buffer.from(otherRaw));await device.openNote(filename,raw);assert.equal(device.readNote(filename).toString('utf8'),raw);
 await passed('open-keeps-original-BOM-and-mixed-EOL');
 let current=raw+'离开前写入';await insert('离开前写入');await waitFor(()=>device.evaluate('window.M1racle.getMarkdown()==='+JSON.stringify(current.slice(1))),'input before leaving');
 result.pendingBytesBeforeLeave=device.readNote(filename).equals(Buffer.from(raw));await home();await device.waitDisk(filename,current);
 await device.openNote(other,otherRaw);assert.equal(device.readNote(other).toString('utf8'),otherRaw);result.touches.push(await device.tap('button','返回首页'));await waitFor(()=>device.evaluate('document.body.dataset.screen==="home"'),'native back home');await device.openNote(filename,current);
 await passed('leave-and-switch-flush-correct-file');
 current+='后台前写入';await insert('后台前写入');await waitFor(()=>device.evaluate('window.M1racle.getMarkdown()==='+JSON.stringify(current.slice(1))),'input before pause');
 device.adb('shell','input','keyevent','KEYCODE_HOME');await device.waitDisk(filename,current);
 device.adb('shell','am','start','-n','com.m1racle.note/.MainActivity');await waitFor(()=>device.evaluate('document.body.dataset.screen==="editor"'),'resumed editor');await device.waitNativeScreen();
 assert.equal(await device.evaluate('window.M1racle.getMarkdown()'),current.slice(1));await passed('native-home-pause-flush-and-resume');
 await home();const previousPid=device.pid;await restart();assert.notEqual(device.pid,previousPid);await device.openNote(filename,current);
 assert.deepEqual(await appearance(),initialAppearance);await passed('process-restart-reopen-and-appearance-preserved');
 const beforeRetry=current,external='# 外部内容\n请保留这个版本。\n';await writeNote(filename,Buffer.from(external));current+='保存失败也保留';await insert('保存失败也保留');
 await waitFor(()=>device.evaluate('Boolean(document.querySelector(".error-banner[data-save-failed=true]"))'),'save failure');assert.equal(device.readNote(filename).toString('utf8'),external);assert.equal(await device.evaluate('window.M1racle.getMarkdown()'),current.slice(1));
 const beforeRetryFailure=await device.evaluate('window.__noteQaErrorCount || 0');result.touches.push(await device.tap('button','重试保存'));await waitFor(()=>device.evaluate('(window.__noteQaErrorCount || 0)>'+beforeRetryFailure),'retry reports the persistent conflict');assert.equal(device.readNote(filename).toString('utf8'),external);
 await writeNote(filename,Buffer.from(beforeRetry));result.touches.push(await device.tap('button','重试保存'));await device.waitDisk(filename,current);await waitFor(()=>device.evaluate('!document.querySelector(".error-banner")'),'successful retry clears error');
 await passed('conflict-retains-external-and-buffer-then-retry-recovers');
 await writeNote(filename,Buffer.from(external));current+='需要另存的文字';await insert('需要另存的文字');await waitFor(()=>device.evaluate('Boolean(document.querySelector(".error-banner[data-save-failed=true]"))'),'copy recovery failure');
 const continued='继续写作仍然看得见。'.repeat(30);current+=continued;await insert(continued);
 await waitFor(()=>device.evaluate('window.M1racle.getMarkdown()==='+JSON.stringify(current.slice(1))),'continue writing during failure');
 await waitFor(async()=>{
  result.caretDuringFailure=await device.evaluate('(()=>{const view=document.querySelector(".cm-content").cmTile.root.view,caret=view.coordsAtPos(view.state.selection.main.head),banner=document.querySelector(".error-banner").getBoundingClientRect();return {bottom:caret?.bottom ?? null,bannerTop:banner.top};})()');
  return result.caretDuringFailure.bottom!==null && result.caretDuringFailure.bottom<result.caretDuringFailure.bannerTop;
 },'caret remains above save-failure banner');
 assert.deepEqual(await device.evaluate('window.M1racle.getSelection()'),[{from:current.slice(1).length,to:current.slice(1).length}]);
 await device.screenshot('save-failure.png');const beforeNames=new Set(device.listNotes());result.touches.push(await device.tap('button','保存副本'));
 let copy;await waitFor(async()=>{const candidates=device.listNotes().filter(name=>!beforeNames.has(name));if(!candidates.length)return false;assert.equal(candidates.length,1);assert.match(candidates[0],/^note-copy-[0-9a-f-]+\.md$/);copy=candidates[0];owned.add(copy);return device.evaluate('window.__noteQaLoaded==='+JSON.stringify(copy)+' && !document.querySelector(".busy-indicator") && !document.querySelector(".error-banner")');},'copy loaded');
 await device.waitDisk(copy,current);assert.equal(device.readNote(filename).toString('utf8'),external);assert.equal(await device.evaluate('window.M1racle.getMarkdown()'),current.slice(1));
 current+='副本继续写';await insert('副本继续写');await device.waitDisk(copy,current);await passed('native-save-copy-keeps-original-and-resumes-autosave');
 await home();await restart();await device.openNote(copy,current);assert.deepEqual(await appearance(),initialAppearance);assert.equal(device.readNote(filename).toString('utf8'),external);await device.screenshot('recovered-copy.png');
 await passed('recovered-copy-survives-another-process-restart');
 assert.deepEqual(device.errors,[]);await device.waitNativeScreen();result.api=device.adb('shell','getprop','ro.build.version.sdk').toString().trim();result.version=device.adb('shell','dumpsys','package','com.m1racle.note').toString().match(/versionName=([^\s]+)/)?.[1];
 if(option('--apk')){result.apkSha256=hash(await readFile(resolve(option('--apk'))));const installed=device.adb('shell','pm','path','com.m1racle.note').toString().trim().replace(/^package:/,'');assert.equal(device.adb('shell','sha256sum',installed).toString().split(/\s/)[0],result.apkSha256);}
 result.passed=true;
}catch(error){result.passed=false;result.failure=String(error.stack || error);await device.screenshot('failure.png').catch(()=>{});process.exitCode=1;}
finally {
 try {
  if(device.socket?.readyState!==WebSocket.OPEN)await device.connect();
  await home();
  for(const name of owned){assert.ok(name.startsWith(prefix) || /^note-copy-[0-9a-f-]+\.md$/.test(name));device.adb('shell','run-as','com.m1racle.note','rm','files/Notes/'+name);}
  if(owned.size)device.adb('shell','rm',transfer);
  await home();result.ownFixturesRemoved=true;
 }catch(error){result.cleanupFailure=String(error.message);result.passed=false;process.exitCode=1;}
 try{await device.disconnect();}catch(error){result.disconnectFailure=String(error.message);result.passed=false;process.exitCode=1;}
 result.ownedFiles=[...owned];await writeFile(join(output,'file-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,version:result.version,output,physicalGatesRemainOpen:true}));
}
