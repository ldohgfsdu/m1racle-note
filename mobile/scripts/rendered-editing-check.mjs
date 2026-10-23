import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {DeviceDriver,waitFor} from './device-driver.mjs';
import {NativeUi} from './native-ui.mjs';
import {nativeElementTarget} from './native-view-target.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node mobile/scripts/rendered-editing-check.mjs --serial SERIAL --apk FILE [--open-link --browser-package mark.via --allow-once]\nStart at home. Native writing-field tap, source-mode menu, ASCII input and exact-byte undo. Optional owned browser URL check permits only the one-time prompt. Does not accept manual IME or handle gates.');process.exit(0);}
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-rendered-device-'));await mkdir(output,{recursive:true});
const d=new DeviceDriver({serial:option('--serial'),output}),ui=new NativeUi(d,output),token=Date.now().toString(36)+'-'+randomBytes(4).toString('hex');
const filename='qa-rendered-'+token+'.md',transfer='/data/local/tmp/qa-rendered-'+token+'.bin';
const webUrl=args.includes('--open-link')?'https://example.com/?note-qa='+token:'https://example.invalid';
const line='**粗体中文** 和 [链接文字]('+webUrl+') 在同一段。';
const raw='\ufeff# 触屏编辑检查\r\n\r\n'+Array.from({length:20},(_,i)=>line+['\r\n','\n','\r'][i%3]).join('')+'末尾。';
const hash=b=>createHash('sha256').update(b).digest('hex'),result={date:new Date().toISOString(),serial:d.serial,filename,checks:[],touches:ui.touches,errors:d.errors,programmaticSelection:false,physicalHandleAcceptance:false,physicalImeAcceptance:false};let own=false;
const save=()=>writeFile(join(output,'rendered-result.json'),JSON.stringify(result,null,2));
const passed=async name=>{result.checks.push(name);await save();console.log(JSON.stringify({passed:name}));};
const presentation=()=>d.evaluate('({mode:document.body.dataset.mode,lines:[...document.querySelectorAll(".cm-line")].filter(n=>n.textContent.includes("粗体中文")).map(n=>n.textContent),selection:window.M1racle.getSelection(),markdown:window.M1racle.getMarkdown()})');
const assertRendered=async()=>{const p=await presentation();assert.equal(p.mode,'rendered');assert.ok(p.lines.length);assert.ok(p.lines.every(t=>!t.includes('**')&&!t.includes('https://')),'A caret or focus must not expose Markdown delimiters or URLs');return p;};
try{
 await d.connect();assert.equal(await d.evaluate('document.body.dataset.screen'),'home','Do not replace a user draft');await d.waitNativeScreen();
 result.apkSha256=hash(await readFile(resolve(option('--apk'))));const installed=d.adb('shell','pm','path','com.m1racle.note').toString().trim().replace(/^package:/,'');assert.equal(d.adb('shell','sha256sum',installed).toString().split(/\s/)[0],result.apkSha256);
 await writeFile(join(output,'original.md'),Buffer.from(raw));assert.ok(!d.listNotes().includes(filename));d.adb('push',join(output,'original.md'),transfer);d.adb('shell','run-as','com.m1racle.note','cp',transfer,'files/Notes/'+filename);own=true;await d.openNote(filename,raw);
 result.before=await assertRendered();assert.ok(d.readNote(filename).equals(Buffer.from(raw)));
 const target=await nativeElementTarget(d,'.cm-atomic-strong','native-body-tap');d.adb('shell','input','tap',String(target.point.x),String(target.point.y));ui.touches.push({label:'native tap in the writing field',...target});
 await d.evaluate('new Promise(resolve=>setTimeout(resolve,600))');result.afterTap=await assertRendered();
 const caretLine=await d.evaluate('(()=>{const v=document.querySelector(".cm-content").cmTile.root.view;return v.state.doc.lineAt(v.state.selection.main.head).text;})()');assert.ok(caretLine.includes('粗体中文'),'The native tap must land in a formatted body line');assert.ok(d.readNote(filename).equals(Buffer.from(raw)));await d.screenshot('native-tap-stays-rendered.png');await passed('native-tap-keeps-Markdown-hidden-and-source-bytes-unchanged');
 const selected=result.afterTap.selection;
 for(const source of [true,false]){
  await d.tap('button','更多菜单');await d.tap('button',source?'显示 Markdown 源码':'返回排版编辑');
  await waitFor(()=>d.evaluate('document.body.dataset.mode==='+JSON.stringify(source?'source':'rendered')),'explicit source mode');
  const p=await presentation();assert.deepEqual(p.selection,selected);assert.equal(p.markdown,raw.slice(1));assert.ok(d.readNote(filename).equals(Buffer.from(raw)));
  if(source){assert.ok(p.lines.some(t=>t.includes('**')&&t.includes('https://')));await d.screenshot('explicit-source.png');}else await assertRendered();
 }
 await passed('native-source-menu-roundtrip-preserves-selection-and-original-bytes');
 assert.equal(selected.length,1);assert.equal(selected[0].from,selected[0].to);
 d.adb('shell','input','text','QA_native');const at=selected[0].from,expected=Buffer.from(raw.slice(0,at+1)+'QA_native'+raw.slice(at+1));await d.waitDisk(filename,expected);result.afterInput=await assertRendered();assert.equal(result.afterInput.markdown,expected.toString('utf8').slice(1));await passed('native-ASCII-input-changes-only-the-source-range');
 await d.tap('button','更多菜单');await d.tap('button','显示 Markdown 源码');await d.tap('button','撤销');await d.waitDisk(filename,raw);assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),raw.slice(1));
 await d.tap('button','更多菜单');await d.tap('button','返回排版编辑');await assertRendered();await passed('undo-survives-source-mode-switch-and-restores-BOM-and-mixed-line-endings');
 if(args.includes('--open-link')){
  const link=await nativeElementTarget(d,'.cm-atomic-link','native-link-arrow',{trailing:true});d.adb('shell','input','tap',String(link.point.x),String(link.point.y));ui.touches.push({label:'native link arrow',...link});
  let screen=await ui.snapshot('external web navigation');
  if(screen.nodes.some(n=>n.package==='com.miui.securitycenter'&&n.text.includes('M1racle Note 想要打开'))){
   assert.ok(args.includes('--allow-once'),'The device requests one-time permission to open the browser');
   await ui.tap(n=>n.package==='com.miui.securitycenter'&&n.text==='本次允许','one-time browser opening');result.oneTimePermission=true;
  }
  const browser=option('--browser-package');assert.equal(browser,'mark.via','This URL-bar inspection currently supports the tested Via handset; supply --browser-package mark.via');
  await ui.waitFor(n=>n.package===browser&&n.text==='Example Domain'&&n.clickable==='true','owned Example Domain browser tab');
  await ui.tap(n=>n.package===browser&&n.text==='Example Domain'&&n.clickable==='true','show the owned browser URL');
  screen=await ui.waitFor(n=>n.package===browser&&n.class==='android.widget.EditText'&&n.text.includes(token),'browser URL contains the owned QA destination');
  const address=screen.nodes.find(n=>n.package===browser&&n.class==='android.widget.EditText'&&n.text.includes(token));assert.equal(address.text,webUrl);
  result.externalLink={url:webUrl,displayedAddress:address.text,browser,phoneClipboardAccessed:false};await d.screenshot('external-web-link.png');
  d.adb('shell','am','start','-n','com.m1racle.note/.MainActivity','-f','0x34000000');await d.waitNativeScreen();await d.disconnect();await d.connect();
  await waitFor(()=>d.evaluate('document.body.dataset.screen==="editor"'),'return from browser');assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),raw.slice(1));assert.ok(d.readNote(filename).equals(Buffer.from(raw)));await passed('native-link-arrow-opens-external-web-intent-and-keeps-original-note-bytes');
 }
 assert.deepEqual(d.errors,[]);result.passed=true;
}catch(error){result.failure=String(error.stack||error);result.passed=false;process.exitCode=1;await d.screenshot('failure.png').catch(()=>{});}
finally{
 if(own)try{d.adb('shell','am','start','-n','com.m1racle.note/.MainActivity','-f','0x34000000');await d.waitNativeScreen();await d.evaluate('window.M1racle.back()');await waitFor(()=>d.evaluate('document.body.dataset.screen==="home"&&!document.querySelector(".busy-indicator")'),'flush before owned fixture cleanup');d.adb('shell','run-as','com.m1racle.note','rm','files/Notes/'+filename);d.adb('shell','rm',transfer);result.ownFixtureRemoved=true;}catch(error){result.cleanupFailure=String(error);result.passed=false;process.exitCode=1;}
 await d.disconnect();await save();console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,output}));
}
