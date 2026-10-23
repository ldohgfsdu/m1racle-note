import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {DeviceDriver,waitFor} from './device-driver.mjs';
import {NativeUi} from './native-ui.mjs';
import {ProbeDriver} from './probe-driver.mjs';
import {guestClipboardGuard} from './clipboard-host.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node mobile/scripts/clipboard-check.mjs --serial emulator-PORT --emulator-pid PID [--apk FILE]\nWindows headless emulator only. Requires the local QA receiver. Uses actual Android clipboard and keyboard shortcuts with programmatic CM selections. Never accepts physical handles or IME.');process.exit(0);}
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-clipboard-device-'));await mkdir(output,{recursive:true});
const d=new DeviceDriver({serial:option('--serial'),output}),ui=new NativeUi(d,output),probe=new ProbeDriver(d,ui,output),token=Date.now().toString(36)+'-'+randomBytes(4).toString('hex'),filename='qa-clipboard-'+token+'.md',transfer='/data/local/tmp/qa-clipboard-'+token+'.bin';
const raw='\ufeff# 剪贴板验证\r\n\r\n**粗体中文🌱** 和 [链接文字](https://example.invalid)\r末尾。',text=raw.slice(1),from=text.indexOf('粗体中文🌱'),to=text.indexOf('末尾。')+'末尾。'.length,hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={date:new Date().toISOString(),serial:d.serial,filename,checks:[],errors:d.errors,selectionMethod:'programmatic-CodeMirror-selection',inputMethod:'Android-native-keycombination',physicalHandleAcceptance:false,physicalImeAcceptance:false};let own=false,isolated=false;
const save=()=>writeFile(join(output,'clipboard-result.json'),JSON.stringify(result,null,2));
const passed=async name=>{result.checks.push(name);await save();console.log(JSON.stringify({passed:name}));};
let hostGuard;
const verifyIsolation=()=>{
 hostGuard=guestClipboardGuard(d,option('--emulator-pid'));result.hostIsolation=hostGuard.evidence;isolated=true;
};
const assertHostUnchanged=()=>hostGuard.assertUnchanged();
const returnNote=async()=>{
 d.adb('shell','am','start','-n','com.m1racle.note/.MainActivity','-f','0x34000000');await d.waitNativeScreen();
 await waitFor(()=>d.evaluate('document.body.dataset.screen==="editor" && !document.querySelector(".busy-indicator")'),'return to clipboard test note');
};
const select=async(first,last)=>{
 await d.tap('textbox','');
 await d.evaluate(`(()=>{const v=document.querySelector('.cm-content').cmTile.root.view,t=v.state.doc.toString();v.dispatch({selection:{anchor:t.indexOf(${JSON.stringify(first)}),head:t.indexOf(${JSON.stringify(last)})+${last.length}}});v.focus();})()`);
 await d.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 result.selected=await d.evaluate(`({focus:document.hasFocus(),active:document.activeElement?.className,dom:window.getSelection()?.toString(),source:window.M1racle.getSelection()})`);
};
const shortcut=async key=>{
 const start=await d.evaluate('window.__clipboardQaEvents.length');
 result.nativeFocus=d.adb('shell','dumpsys','window').toString().split(/\r?\n/).filter(line=>line.includes('mCurrentFocus=')&&line.includes('com.m1racle.note'));
 assert.ok(result.nativeFocus.length,'Native keyboard focus must belong to Note');
 d.adb('shell','input','keycombination','-t','100','KEYCODE_CTRL_LEFT','KEYCODE_'+key);
 await waitFor(()=>d.evaluate('window.__clipboardQaEvents.slice('+start+').some(e=>["copy","cut","paste"].includes(e.type)||e.type==="keydown"&&e.ctrl)'), 'native shortcut reaches the editor');
 await d.evaluate('new Promise(resolve=>setTimeout(resolve,300))');
};
const undo=async()=>{await d.tap('button','撤销');await d.waitDisk(filename,raw);assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),text);};
try{
 verifyIsolation();await d.connect();assert.equal(await d.evaluate('document.body.dataset.screen'),'home','Start at home; never replace a user draft.');await d.waitNativeScreen();assert.ok(!d.listNotes().includes(filename));
 if(option('--apk')){result.apkSha256=hash(await readFile(resolve(option('--apk'))));const installed=d.adb('shell','pm','path','com.m1racle.note').toString().trim().replace(/^package:/,'');assert.equal(d.adb('shell','sha256sum',installed).toString().split(/\s/)[0],result.apkSha256);}
 result.version=d.adb('shell','dumpsys','package','com.m1racle.note').toString().match(/versionName=([^\s]+)/)?.[1];
 await writeFile(join(output,'original.md'),Buffer.from(raw));own=true;d.adb('push',join(output,'original.md'),transfer);d.adb('shell','run-as','com.m1racle.note','cp',transfer,'files/Notes/'+filename);await d.openNote(filename,raw);
 await d.evaluate(`(()=>{window.__clipboardQaController?.abort();window.__clipboardQaController=new AbortController();window.__clipboardQaEvents=[];for(const type of ['keydown','keyup','copy','cut','paste'])document.addEventListener(type,event=>{window.__clipboardQaEvents.push({type,key:event.key,ctrl:event.ctrlKey,trusted:event.isTrusted,prevented:event.defaultPrevented,target:event.target.className,active:document.activeElement?.className,plain:event.clipboardData?.getData('text/plain')});},{signal:window.__clipboardQaController.signal,capture:true});})()`);
 result.beforeCopy=await d.evaluate(`({focus:document.hasFocus(),active:document.activeElement?.className,dom:window.getSelection()?.toString(),source:window.M1racle.getSelection()})`);
 const control=await probe.command('clipboard-set','QA clipboard control');assert.equal(Buffer.from(control.textBase64,'base64').toString(),'QA clipboard control');result.clipboardControl=control;assertHostUnchanged();await returnNote();
 await select('粗体中文🌱','末尾。');await shortcut('C');const copied=await probe.command('clipboard-read');result.copied=copied;assert.ok(copied.hasClip,'Android clipboard is empty after native Copy');assert.equal(Buffer.from(copied.textBase64,'base64').toString(),text.slice(from,to).replace(/\r\n|\r/g,'\n'));assert.ok(copied.types.includes('text/plain'));assert.ok(d.readNote(filename).equals(Buffer.from(raw)));assertHostUnchanged();await passed('native-copy-keeps-selected-Markdown-Chinese-emoji-and-source-bytes');
 await returnNote();await select('粗体中文🌱','末尾。');await shortcut('X');await d.waitDisk(filename,'\ufeff'+text.slice(0,from)+text.slice(to));const cut=await probe.command('clipboard-read');assert.equal(cut.textBase64,copied.textBase64);assertHostUnchanged();await returnNote();await undo();await passed('native-cut-changes-only-selected-source-and-undo-restores-exact-bytes');
 const pasted='粘贴中文🌱\r\n第二行\n尾巴';await probe.command('clipboard-set',pasted);assertHostUnchanged();await returnNote();await select('粗体中文🌱','粗体中文🌱');await shortcut('V');
 const end=from+'粗体中文🌱'.length,expected='\ufeff'+text.slice(0,from)+pasted.replace(/\r\n|\n|\r/g,'\r\n')+text.slice(end);await d.waitDisk(filename,expected);await undo();await passed('native-paste-replaces-selection-and-preserves-unrelated-mixed-EOL-with-exact-undo');
 await d.evaluate('window.M1racle.setReadOnly(true)');await select('粗体中文🌱','粗体中文🌱');await shortcut('V');assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),text);assert.ok(d.readNote(filename).equals(Buffer.from(raw)));await d.evaluate('window.M1racle.setReadOnly(false)');await passed('read-only-native-paste-cannot-modify-source');
 await d.screenshot('clipboard-editor.png');assert.deepEqual(d.errors,[]);assertHostUnchanged();result.passed=true;
}catch(error){result.passed=false;result.failure=String(error.stack || error);process.exitCode=1;await d.screenshot('failure.png').catch(()=>{});}
finally{
 try{result.events=await d.evaluate('window.__clipboardQaEvents');await d.evaluate('window.__clipboardQaController?.abort()');}catch{}
 if(own)try{await returnNote();await d.evaluate('window.M1racle.setReadOnly(false);window.M1racle.back()');await waitFor(()=>d.evaluate('document.body.dataset.screen==="home" && !document.querySelector(".busy-indicator")'),'home before owned clipboard cleanup');d.adb('shell','run-as','com.m1racle.note','rm','files/Notes/'+filename);d.adb('shell','rm',transfer);result.ownFixtureRemoved=true;}catch(error){result.cleanupFailure=String(error.message);result.passed=false;process.exitCode=1;}
 if(isolated)try{await probe.command('clipboard-clear');d.adb('shell','am','start','-n','com.m1racle.note/.MainActivity','-f','0x34000000');await d.waitNativeScreen();hostGuard.finish();result.guestClipboardCleared=true;}catch(error){result.clipboardCleanupFailure=String(error.message);result.passed=false;process.exitCode=1;}
 try{await d.disconnect();}catch(error){result.disconnectFailure=String(error.message);result.passed=false;process.exitCode=1;}
 await save();console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,output}));
}
