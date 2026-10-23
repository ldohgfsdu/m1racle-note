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
if(args.includes('--help')){console.log('node mobile/scripts/touch-menu-check.mjs --serial emulator-PORT --emulator-pid PID [--apk FILE] [--inspect]\nWindows isolated headless emulator and local QA receiver required. Native long presses and system Copy/Cut/Paste/Select all; no programmatic selections or handle acceptance. --inspect only records the fresh native tree.');process.exit(0);}
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-touch-menu-'));await mkdir(output,{recursive:true});
const d=new DeviceDriver({serial:option('--serial'),output}),ui=new NativeUi(d,output,{allWindows:true}),probe=new ProbeDriver(d,ui,output),token=Date.now().toString(36)+'-'+randomBytes(4).toString('hex'),filename='qa-touch-'+token+'.md',transfer='/data/local/tmp/qa-touch-'+token+'.bin';
const lines=Array.from({length:20},(_,i)=>i===4?'**粗体中文** 和 [链接文字](https://example.invalid)':'clipboardword clipboardword clipboardword clipboardword');
const raw='\ufeff# 触屏写作检查\r\n\r\n'+lines.map((line,i)=>line+['\r\n','\n','\r'][i%3]).join('')+'末尾🌱。',text=raw.slice(1),hash=b=>createHash('sha256').update(b).digest('hex'),normalized=s=>s.replace(/\r\n|\r/g,'\n');
const result={date:new Date().toISOString(),serial:d.serial,filename,checks:[],openIssues:[],touches:ui.touches,errors:d.errors,selectionMethod:'native-Android-long-press-and-system-actions',programmaticSelection:false,physicalHandleAcceptance:false,physicalImeAcceptance:false};let own=false,guard,inspecting=args.includes('--inspect');
const save=()=>writeFile(join(output,'touch-result.json'),JSON.stringify(result,null,2));
const passed=async name=>{result.checks.push(name);await save();console.log(JSON.stringify({passed:name}));};
const current=()=>d.evaluate('({markdown:window.M1racle.getMarkdown(),selection:window.M1racle.getSelection(),dom:window.getSelection()?.toString(),screen:document.body.dataset.screen})');
const returnNote=async()=>{d.adb('shell','am','start','-n','com.m1racle.note/.MainActivity','-f','0x34000000');await d.waitNativeScreen();await waitFor(()=>d.evaluate('document.body.dataset.screen==="editor" && !document.querySelector(".busy-indicator")'),'return to touch-menu note');};
const labels={copy:['Copy','复制'],cut:['Cut','剪切'],paste:['Paste','粘贴'],all:['Select all','全选']};
const menuMatch=action=>n=>n.clickable==='true' && (labels[action].includes(n.text) || labels[action].includes(n['content-desc']));
const menu=async action=>{
 let screen=await ui.snapshot('native menu '+action),match=menuMatch(action);
 if(!screen.nodes.some(match)){
  const overflow=n=>n['resource-id']==='android:id/floating_toolbar_overflow_button' || ['More options','更多选项'].includes(n['content-desc']);
  if(screen.nodes.some(overflow)){await ui.tap(overflow,'native text menu overflow');}
  else {
   const scroll=n=>n.scrollable==='true' && n['resource-id']?.startsWith('android:id/floating_toolbar');
   if(screen.nodes.some(scroll))await ui.swipe(scroll,'native text menu scroll');
  }
  screen=await ui.waitFor(match,'native '+action+' action');
 }
 await ui.tap(match,'native text '+action,{snapshot:screen});await d.evaluate('new Promise(resolve=>setTimeout(resolve,300))');
};
const press=async()=>{
 const surface=n=>n.class==='android.widget.EditText' && n.package==='com.m1racle.note' && n.text.includes('clipboardword');
 await d.waitNativeScreen();await ui.tap(surface,'tap the native writing field');await ui.longPress(surface,'long press the native writing field');
 await waitFor(async()=>{const s=await current();return s.selection.length===1 && s.selection[0].to>s.selection[0].from;},'native word selection');
 const s=await current();assert.equal(s.markdown,text);assert.ok(d.readNote(filename).equals(Buffer.from(raw)));result.lastSelection=s;
 await ui.waitFor(n=>menuMatch('copy')(n) || menuMatch('cut')(n),'native text-selection toolbar');return s.selection[0];
};
const copied=async range=>{
 const clip=await probe.command('clipboard-read');assert.ok(clip.hasClip,'Native menu Copy/Cut must produce a clipboard item');
 assert.equal(Buffer.from(clip.textBase64,'base64').toString(),normalized(text.slice(range.from,range.to)));guard.assertUnchanged();return clip;
};
const undo=async()=>{await returnNote();await d.tap('button','撤销');await d.waitDisk(filename,raw);assert.equal((await current()).markdown,text);};
const geometry=()=>d.evaluate(`(()=>{const v=document.querySelector('.cm-content').cmTile.root.view,t=v.state.doc.toString(),base=v.scrollDOM.getBoundingClientRect();return {line:[...document.querySelectorAll('.cm-line')].find(n=>n.textContent.includes('粗体中文'))?.textContent,points:['粗体中文','链接文字'].map(word=>{const r=v.coordsForChar(t.indexOf(word)+1);return r?{left:r.left-base.left,top:r.top-base.top+v.scrollDOM.scrollTop}:null;})};})()`);
try{
 guard=guestClipboardGuard(d,option('--emulator-pid'));result.hostIsolation=guard.evidence;await d.connect();assert.equal(await d.evaluate('document.body.dataset.screen'),'home','Start at home; do not replace a user draft.');await d.waitNativeScreen();assert.ok(!d.listNotes().includes(filename));
 if(option('--apk')){result.apkSha256=hash(await readFile(resolve(option('--apk'))));const installed=d.adb('shell','pm','path','com.m1racle.note').toString().trim().replace(/^package:/,'');assert.equal(d.adb('shell','sha256sum',installed).toString().split(/\s/)[0],result.apkSha256);}
 result.version=d.adb('shell','dumpsys','package','com.m1racle.note').toString().match(/versionName=([^\s]+)/)?.[1];
 await writeFile(join(output,'original.md'),Buffer.from(raw));own=true;d.adb('push',join(output,'original.md'),transfer);d.adb('shell','run-as','com.m1racle.note','cp',transfer,'files/Notes/'+filename);await d.openNote(filename,raw);
 const initial=await ui.snapshot('touch fixture ready');result.nativeText=initial.nodes.filter(n=>n.text || n['content-desc']).map(n=>({text:n.text,description:n['content-desc'],class:n.class,id:n['resource-id'],bounds:n.bounds}));await d.screenshot('initial.png');await save();
 if(inspecting){result.inspectionOnly=true;}
 else{
  await probe.command('clipboard-set','QA touch clipboard control');await returnNote();const first=await press();await menu('copy');result.wordCopy=await copied(first);assert.ok(d.readNote(filename).equals(Buffer.from(raw)));await passed('native-long-press-and-Copy-preserve-source-and-selected-text');
  await returnNote();const before=await geometry();await press();const after=await geometry();result.formatGeometry={before,after};
  await menu('all');await waitFor(async()=>{const s=await current();return s.selection.length===1 && s.selection[0].from===0 && s.selection[0].to===text.length;},'native Select all covers the Markdown document');await d.screenshot('selected-all.png');
  assert.ok(d.readNote(filename).equals(Buffer.from(raw)));await passed('native-Select-all-covers-complete-Markdown-and-preserves-bytes');
  const allUi=await ui.snapshot('native selection toolbar after Select all');result.selectAllCopyActionAvailable=allUi.nodes.some(menuMatch('copy'));
  if(result.selectAllCopyActionAvailable){await ui.tap(menuMatch('copy'),'native Copy after Select all',{snapshot:allUi});result.allCopy=await copied({from:0,to:text.length});await passed('native-Copy-after-Select-all-includes-complete-Markdown');}
  else result.openIssues.push({check:'Copy after native Select all',details:'The complete source range remains selected, but the system Copy action is absent from the fresh native windows.',snapshot:allUi.index});
  await returnNote();const cut=await press();await menu('cut');await d.waitDisk(filename,'\ufeff'+text.slice(0,cut.from)+text.slice(cut.to));await copied(cut);await undo();await passed('native-Cut-changes-only-selected-range-and-undo-restores-original-bytes');
  const paste='粘贴中文🌱\r\n第二行';await probe.command('clipboard-set',paste);await returnNote();const replacement=await press();await menu('paste');await d.waitDisk(filename,'\ufeff'+text.slice(0,replacement.from)+paste.replace(/\r\n|\r|\n/g,'\r\n')+text.slice(replacement.to));await undo();await passed('native-Paste-replaces-selected-range-with-exact-byte-undo');
  await press();d.adb('shell','input','keyevent','KEYCODE_BACK');await ui.snapshot('first native Back after text selection');await d.evaluate('new Promise(resolve=>setTimeout(resolve,300))');result.afterBack=await current();assert.equal(result.afterBack.screen,'editor','The first Back after text selection should keep the writing page open');assert.equal(result.afterBack.markdown,text);assert.ok(d.readNote(filename).equals(Buffer.from(raw)));await passed('first-system-Back-after-selection-keeps-the-writing-page');
  assert.deepEqual(d.errors,[]);guard.assertUnchanged();result.passed=result.openIssues.length===0;if(!result.passed)process.exitCode=1;
 }
}catch(error){result.passed=false;result.failure=String(error.stack || error);process.exitCode=1;await d.screenshot('failure.png').catch(()=>{});}
finally{
 if(own)try{d.adb('shell','am','start','-n','com.m1racle.note/.MainActivity','-f','0x34000000');await d.waitNativeScreen();const screen=await d.evaluate('document.body.dataset.screen');if(screen==='editor')await d.evaluate('window.M1racle.back()');await waitFor(()=>d.evaluate('document.body.dataset.screen==="home" && !document.querySelector(".busy-indicator")'),'home before owned touch-note cleanup');d.adb('shell','run-as','com.m1racle.note','rm','files/Notes/'+filename);d.adb('shell','rm',transfer);result.ownFixtureRemoved=true;}catch(error){result.cleanupFailure=String(error.message);result.passed=false;process.exitCode=1;}
 if(guard)try{if(!inspecting)await probe.command('clipboard-clear');d.adb('shell','am','start','-n','com.m1racle.note/.MainActivity','-f','0x34000000');await d.waitNativeScreen();guard.finish();result.guestClipboardCleared=!inspecting;}catch(error){result.clipboardCleanupFailure=String(error.message);result.passed=false;process.exitCode=1;}
 try{await d.disconnect();}catch(error){result.disconnectFailure=String(error.message);result.passed=false;process.exitCode=1;}
 await save();console.log(JSON.stringify({passed:result.passed,inspectionOnly:result.inspectionOnly,checks:result.checks.length,output}));
}
