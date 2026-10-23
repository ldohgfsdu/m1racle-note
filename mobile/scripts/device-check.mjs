import {execFileSync} from 'node:child_process';
import {readFile,writeFile,readdir,mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {capturePng} from './device-driver.mjs';

// Debug-only QA: unique fixtures and external evidence, no Browser-domain CDP.
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node mobile/scripts/device-check.mjs [--serial SERIAL] [--apk FILE]\nNode 22+; keep the debug app in front. NOTE_QA_OUTPUT sets the evidence directory. Physical IME/handles/performance gates stay open.');process.exit(0);}
if(typeof WebSocket==='undefined')throw new Error('Device QA requires Node 22+.');
const root=fileURLToPath(new URL('../../',import.meta.url)),sdk=process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const executable=sdk?join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb'):'adb';
const run=(...a)=>execFileSync(executable,a,{maxBuffer:24*1024*1024,windowsHide:true});
const devices=run('devices').toString().split(/\r?\n/).map(line=>line.match(/^(\S+)\s+device(?:\s|$)/)?.[1]).filter(Boolean);
const serial=option('--serial') || (devices.length===1?devices[0]:null);assert.ok(serial && devices.includes(serial),'Select one connected device with --serial.');
const adb=(...a)=>run('-s',serial,...a),output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-device-evidence-'));
await mkdir(output,{recursive:true});
const pid=adb('shell','pidof','-s','com.m1racle.note').toString().trim();assert.ok(pid,'Keep M1racle Note in front.');
const port=Number(option('--port') || 9227);assert.ok(Number.isInteger(port) && port>1024 && port<65536);
adb('forward','tcp:'+port,'localabstract:webview_devtools_remote_'+pid);
const target=(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(page=>page.url.includes('appassets.androidplatform.net'));assert.ok(target,'No bundled editor page.');
const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map(),errors=[];let sequence=0;
socket.addEventListener('message',event=>{
 const message=JSON.parse(event.data);
 if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
 if(message.method==='Runtime.consoleAPICalled' && message.params.type==='error')errors.push(message.params.args);
 const task=pending.get(message.id);if(task){clearTimeout(task.timer);pending.delete(message.id);message.error?task.reject(new Error(JSON.stringify(message.error))):task.resolve(message.result);}
});
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const waitFor=async(check,label)=>{for(let i=0;i<100;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Device state did not settle: '+label);};
const token=Date.now().toString(36)+'-'+randomBytes(4).toString('hex'),owned=new Set(),transfer='/data/local/tmp/note-qa-'+token+'.bin';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const readNote=name=>adb('exec-out','run-as','com.m1racle.note','cat','files/Notes/'+name);
const writeNote=async(name,bytes)=>{
 assert.match(name,new RegExp('^qa-'+token+'-[a-z0-9-]+\\.md$'));owned.add(name);
 await writeFile(join(output,'transfer.bin'),bytes);adb('push',join(output,'transfer.bin'),transfer);
 adb('shell','run-as','com.m1racle.note','cp',transfer,'files/Notes/'+name);
};
const waitDisk=(name,bytes)=>waitFor(()=>readNote(name).equals(Buffer.from(bytes)),'disk bytes');
const openNote=async(name,bytes)=>{const text=Buffer.from(bytes).toString('utf8').replace(/^\ufeff/,'');const started=performance.now();await evaluate('window.M1racle.openFile('+JSON.stringify(name)+')');await waitFor(()=>evaluate('window.__noteQaLoaded==='+JSON.stringify(name)+' && document.body.dataset.screen==="editor" && !document.querySelector(".busy-indicator") && document.querySelector(".cm-scroller")?.clientHeight>100 && window.M1racle.getMarkdown()==='+JSON.stringify(text)),'native document loaded');return performance.now()-started;};
const focusEnd=async()=>{await evaluate('window.M1racle.focus()');for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'End',code:'End',windowsVirtualKeyCode:35,modifiers:2});};
const screenshot=name=>writeFile(join(output,name),capturePng(adb));
const nativeScreen=()=>{const xml=adb('exec-out','uiautomator','dump','/dev/tty').toString();assert.ok(!xml.includes('android:id/aerr_'),'An Android ANR dialog blocks the app; resolve before QA.');assert.ok(xml.includes('package="com.m1racle.note"'),'The app is not in the native foreground.');return xml;};
const tap=async(role,name)=>{
 const xml=nativeScreen(),webview=xml.match(/<node[^>]*class="android.webkit.WebView"[^>]*>/)?.[0];assert.ok(webview);
 const bounds=webview.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
 const ax=await call('Accessibility.getFullAXTree'),node=ax.nodes.find(node=>node.role?.value===role && node.name?.value===name);assert.ok(node?.backendDOMNodeId,role+': '+name);
 const {model}=await call('DOM.getBoxModel',{backendNodeId:node.backendDOMNodeId}),xs=model.border.filter((_,i)=>i%2===0),ys=model.border.filter((_,i)=>i%2===1);
 const box={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
 const viewport=await evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');assert.ok(Math.abs(viewport.width*viewport.dpr-(bounds[2]-bounds[0]))<2);
 const corner=role==='checkbox',point={x:Math.round(bounds[0]+(box.x+(corner?box.width-3:box.width/2))*viewport.dpr),y:Math.round(bounds[1]+(box.y+(corner?box.height-3:box.height/2))*viewport.dpr)};
 assert.ok(point.x>=bounds[0] && point.x<bounds[2] && point.y>=bounds[1] && point.y<bounds[3],'Native target is off screen.');
 const {object}=await call('DOM.resolveNode',{backendNodeId:node.backendDOMNodeId}),clickToken=String(++sequence);
 await call('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(token){this.addEventListener("click",()=>{window.__noteQaClick=token;},{once:true});}',arguments:[{value:clickToken}]});
 await writeFile(join(output,'native-'+role+'.xml'),xml);adb('shell','input','tap',String(point.x),String(point.y));
 await waitFor(()=>evaluate('window.__noteQaClick==='+JSON.stringify(clickToken)),'native click delivered to '+name);return {box,bounds,point,corner};
};
const result={date:new Date().toISOString(),serial,corpus:[],errors,physicalGates:{ChineseIme:'pending',selectionHandles:'pending',sustainedPerformance:'pending'}};
try {
 await call('Runtime.enable');result.identity=await evaluate('({title:document.title,url:location.href})');assert.equal(result.identity.title,'M1racle Note');
 await evaluate('(()=>{const original=window.M1racle.loadDocument;window.M1racle.loadDocument=function(doc){const result=original(doc);window.__noteQaLoaded=doc.path;return result;};})()');
 nativeScreen();await screenshot('native-start.png');
 await evaluate('window.M1racle.back()');await waitFor(()=>evaluate("document.body.dataset.screen==='home'"),'home');
 const core='qa-'+token+'-core.md',image='![图片说明](images/photo.png)';
 const text=`# 原文保持与图片回退\r\n\r\n${image}\n\n| A | B |\r\n| --- | --- |\n| **原文** | ![表内图片](image.png) |\r\n\r\n- [ ] 点击待办\r\n\r\n末尾。`,raw='\ufeff'+text;
 await writeNote(core,Buffer.from(raw));await openNote(core,Buffer.from(raw));
 const visible=await evaluate("document.querySelector('.cm-content').innerText");assert.ok(visible.includes(image));assert.ok(visible.includes('| **原文** | ![表内图片](image.png) |'));await waitDisk(core,raw);
 result.nativeTaskTouch=await tap('checkbox','标记为完成');assert.ok(result.nativeTaskTouch.box.width>=48 && result.nativeTaskTouch.box.height>=48);
 await waitDisk(core,raw.replace('[ ]','[x]'));await evaluate('window.M1racle.undo()');await waitDisk(core,raw);
 await focusEnd();await call('Input.insertText',{text:'测🌱'});await waitDisk(core,raw+'测🌱');
 assert.deepEqual(await evaluate('window.M1racle.getSelection()'),[{from:text.length+3,to:text.length+3}]);
 await evaluate('window.M1racle.undo()');await waitDisk(core,raw);await evaluate('window.M1racle.redo()');await waitDisk(core,raw+'测🌱');await evaluate('window.M1racle.undo()');await waitDisk(core,raw);
 await focusEnd();await call('Input.imeSetComposition',{text:'nihao',selectionStart:5,selectionEnd:5});
 await waitFor(()=>evaluate('window.M1racle.getMarkdown()==='+JSON.stringify(text+'nihao')),'preedit');
 await call('Input.insertText',{text:'你好'});await new Promise(resolve=>setTimeout(resolve,120));
 const composed=await evaluate('window.M1racle.getMarkdown()');result.syntheticComposition={status:composed===text+'你好'?'passed':'inconclusive-system-ime-ended-preedit',physicalImeAcceptance:false};
 for(let i=0;i<4 && await evaluate('window.M1racle.getMarkdown()')!==text;i++)await evaluate('window.M1racle.undo()');await waitDisk(core,raw);
 await evaluate("window.M1racle.find('原文')");result.nativeSelectAllTouch=await tap('button','选中全部');await waitFor(()=>evaluate('window.M1racle.getSelection().length===2'),'select all matches');
 await tap('button','关闭查找');await call('Input.insertText',{text:'内容'});await waitDisk(core,raw.replaceAll('原文','内容'));
 await evaluate('window.M1racle.undo()');await waitDisk(core,raw);result.nativeSearchAndMultiEdit=true;await screenshot('native-editor.png');
 for(const [index,name] of (await readdir(join(root,'editor-corpus'))).filter(name=>name.endsWith('.md')).entries()) {
  const bytes=await readFile(join(root,'editor-corpus',name)),filename='qa-'+token+'-'+index+'.md';await writeNote(filename,bytes);
  const openMs=await openNote(filename,bytes);assert.ok(readNote(filename).equals(bytes));await focusEnd();
  const started=performance.now();await call('Input.insertText',{text:'测🌱'});const expected=Buffer.concat([bytes,Buffer.from('测🌱')]);
  await waitFor(()=>evaluate('window.M1racle.getMarkdown()==='+JSON.stringify(expected.toString('utf8').replace(/^\ufeff/,''))),'corpus input');const automationInputMs=performance.now()-started;
  await waitDisk(filename,expected);await evaluate('window.M1racle.undo()');await waitDisk(filename,bytes);
  const item={name,chars:bytes.toString('utf8').length,openMs,automationInputMs,sha256:hash(bytes),editAndUndoExact:true};result.corpus.push(item);
  await writeFile(join(output,'device-progress.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(item));
 }
 nativeScreen();assert.deepEqual(errors,[]);result.api=adb('shell','getprop','ro.build.version.sdk').toString().trim();result.version=adb('shell','dumpsys','package','com.m1racle.note').toString().match(/versionName=([^\s]+)/)?.[1];
 if(option('--apk')){const apk=resolve(option('--apk')),installed=adb('shell','pm','path','com.m1racle.note').toString().trim().replace(/^package:/,'');result.apkSha256=hash(await readFile(apk));assert.equal(adb('shell','sha256sum',installed).toString().split(/\s/)[0],result.apkSha256);}
 result.passed=true;
}catch(error){result.passed=false;result.failure=String(error.stack || error);try{await screenshot('failure.png');}catch{}throw error;}
finally {
 try {
  await evaluate('window.M1racle.back()');await waitFor(()=>evaluate("document.body.dataset.screen==='home'"),'cleanup home');
  for(const name of owned){assert.match(name,new RegExp('^qa-'+token+'-[a-z0-9-]+\\.md$'));adb('shell','run-as','com.m1racle.note','rm','files/Notes/'+name);}
  adb('shell','rm',transfer);await evaluate('window.M1racle.back()');result.ownFixturesRemoved=true;
 }catch(error){result.cleanupFailure=String(error.message);result.passed=false;process.exitCode=1;}
 await writeFile(join(output,'device-result.json'),JSON.stringify(result,null,2));socket.close();adb('forward','--remove','tcp:'+port);
 console.log(JSON.stringify({passed:result.passed,corpus:result.corpus.length,version:result.version,syntheticComposition:result.syntheticComposition,output,physicalGatesRemainOpen:true}));
}
