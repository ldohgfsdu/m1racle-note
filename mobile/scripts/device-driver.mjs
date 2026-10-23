import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {nativeElementTarget} from './native-view-target.mjs';

export async function waitFor(check,label,timeout=20000) {
 const end=Date.now()+timeout;
 do {if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<end);
 throw new Error('Device state did not settle: '+label);
}

export function capturePng(adb) {
 const displays=adb('shell','dumpsys','SurfaceFlinger','--display-id').toString();
 const primary=displays.match(/Display (\d+) \(HWC display 0\)/)?.[1];
 assert.ok(primary,'Identify the primary physical display before capturing a screenshot.');
 const bytes=adb('exec-out','screencap','-p','-d',primary);
 assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'The native screenshot must be a PNG without diagnostic text.');
 return bytes;
}

// Debug WebView QA without Playwright's unsupported Browser-domain commands.
// Each connection owns an ADB-assigned port and removes only that forward.
export class DeviceDriver {
 constructor({serial,output}) {
  const sdk=process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  this.executable=sdk?join(sdk,'platform-tools',process.platform==='win32'?'adb.exe':'adb'):'adb';
  const devices=this.run('devices').toString().split(/\r?\n/).map(line=>line.match(/^(\S+)\s+device(?:\s|$)/)?.[1]).filter(Boolean);
  this.serial=serial || (devices.length===1?devices[0]:null);
  assert.ok(this.serial && devices.includes(this.serial),'Select one connected device with --serial.');
  this.output=output;this.errors=[];this.sequence=0;this.pending=new Map();
 }
 run(...args) {return execFileSync(this.executable,args,{windowsHide:true,maxBuffer:24*1024*1024,stdio:['ignore','pipe','pipe']});}
 adb(...args) {return this.run('-s',this.serial,...args);}
 async connect() {
  assert.equal(typeof WebSocket,'function','Device QA requires Node 22+.');
  await this.disconnect();
  await waitFor(()=>{
   try{this.pid=this.adb('shell','pidof','-s','com.m1racle.note').toString().trim();return Boolean(this.pid);}
   catch(error){if(error.status===1 && !error.stdout?.length)return false;throw error;}
  },'app process');
  this.port=Number(this.adb('forward','tcp:0','localabstract:webview_devtools_remote_'+this.pid).toString().trim());
  assert.ok(this.port>1024);
  let target;
  await waitFor(async()=>{
   try {target=(await (await fetch('http://127.0.0.1:'+this.port+'/json/list',{signal:AbortSignal.timeout(3000)})).json()).find(page=>page.url.includes('appassets.androidplatform.net'));return Boolean(target);}
   catch{return false;}
  },'bundled editor debugger');
  this.socket=new WebSocket(target.webSocketDebuggerUrl);
  this.socket.addEventListener('message',event=>{
   const message=JSON.parse(event.data);
   if(message.method==='Runtime.exceptionThrown')this.errors.push(message.params.exceptionDetails);
   if(message.method==='Runtime.consoleAPICalled' && message.params.type==='error')this.errors.push(message.params.args);
   const task=this.pending.get(message.id);
   if(task){clearTimeout(task.timer);this.pending.delete(message.id);message.error?task.reject(new Error(JSON.stringify(message.error))):task.resolve(message.result);}
  });
  await new Promise((resolve,reject)=>{this.socket.addEventListener('open',resolve,{once:true});this.socket.addEventListener('error',reject,{once:true});});
  await this.call('Runtime.enable');
  await waitFor(async()=>{
   try{return await this.evaluate('Boolean(window.M1racle && document.body.dataset.screen)',3000);}
   catch(error){if(error.message.startsWith('CDP timeout:'))return false;throw error;}
  },'app API after startup',45000);
  await this.evaluate('(()=>{const original=window.M1racle.loadDocument;window.M1racle.loadDocument=function(doc){const result=original(doc);window.__noteQaLoaded=doc.path;return result;};const report=window.M1racle.reportError;window.M1racle.reportError=function(...args){window.__noteQaErrorCount=(window.__noteQaErrorCount || 0)+1;return report(...args);};})()');
 }
 call(method,params={},timeout=20000) {
  assert.equal(this.socket?.readyState,WebSocket.OPEN,'Connect the device debugger before calling '+method);
  return new Promise((resolve,reject)=>{
   const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('CDP timeout: '+method+(params.expression?' '+params.expression.slice(0,100):'')));},timeout);
   this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));
  });
 }
 async evaluate(expression,timeout=20000) {
  const result=await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},timeout);
  if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;
 }
 nativeScreen() {
  const xml=this.adb('exec-out','uiautomator','dump','/dev/tty').toString();
  assert.ok(!xml.includes('android:id/aerr_'),'An Android ANR dialog blocks the app.');
  assert.ok(xml.includes('package="com.m1racle.note"'),'The app is not in the native foreground.');return xml;
 }
 async waitNativeScreen() {
  let screen;
  await waitFor(()=>{
   try{screen=this.nativeScreen();return true;}
   catch(error){if(error.message==='The app is not in the native foreground.')return false;throw error;}
  },'native app foreground');return screen;
 }
 async tap(role,name,{corner=false}={}) {
  const xml=await this.waitNativeScreen(),webview=xml.match(/<node[^>]*class="android.webkit.WebView"[^>]*>/)?.[0];
  let bounds=webview?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)?.slice(1).map(Number);
  const {nodes}=await this.call('Accessibility.getFullAXTree'),node=nodes.find(node=>node.role?.value===role && node.name?.value===name);assert.ok(node?.backendDOMNodeId,role+': '+name);
  const {model}=await this.call('DOM.getBoxModel',{backendNodeId:node.backendDOMNodeId}),xs=model.border.filter((_,i)=>i%2===0),ys=model.border.filter((_,i)=>i%2===1);
  const box={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
  const viewport=await this.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');if(bounds)assert.ok(Math.abs(viewport.width*viewport.dpr-(bounds[2]-bounds[0]))<2);
  let point;
  if(!bounds){
   assert.equal(corner,false,'Review corner coordinates separately for the native View Hierarchy fallback');
   const target=await nativeElementTarget(this,{backendNodeId:node.backendDOMNodeId},'native-fallback-'+this.sequence);const b=target.bounds;bounds=[b.x,b.y,b.x+b.width,b.y+b.height];point=target.point;
  }else point={x:Math.round(bounds[0]+(box.x+(corner?box.width-3:box.width/2))*viewport.dpr),y:Math.round(bounds[1]+(box.y+(corner?box.height-3:box.height/2))*viewport.dpr)};
  assert.ok(point.x>=bounds[0] && point.x<bounds[2] && point.y>=bounds[1] && point.y<bounds[3],'Native target is off screen.');
  const {object}=await this.call('DOM.resolveNode',{backendNodeId:node.backendDOMNodeId}),token=String(++this.sequence);
  await this.call('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(token){this.addEventListener("click",()=>{window.__noteQaClick=token;},{once:true});}',arguments:[{value:token}]});
  try {
   await writeFile(join(this.output,'native-'+token+'.xml'),xml);this.adb('shell','input','tap',String(point.x),String(point.y));
   await waitFor(()=>this.evaluate('window.__noteQaClick==='+JSON.stringify(token)),'native click: '+name);
  }finally{await this.call('Runtime.releaseObject',{objectId:object.objectId});}
  return {role,name,box,bounds,point,corner};
 }
 readNote(name) {assert.match(name,/^[a-zA-Z0-9.-]+\.md$/);return this.adb('exec-out','run-as','com.m1racle.note','cat','files/Notes/'+name);}
 listNotes() {return this.adb('shell','run-as','com.m1racle.note','ls','-1','files/Notes').toString().trim().split(/\r?\n/).filter(Boolean);}
 waitDisk(name,bytes) {return waitFor(()=>this.readNote(name).equals(Buffer.from(bytes)),'disk bytes: '+name);}
 async openNote(name,bytes) {
  assert.match(name,/^[a-zA-Z0-9.-]+\.md$/);await this.evaluate('window.M1racle.openFile('+JSON.stringify(name)+')');
  await waitFor(()=>this.evaluate('window.__noteQaLoaded==='+JSON.stringify(name)+' && document.body.dataset.screen==="editor" && !document.querySelector(".busy-indicator") && document.querySelector(".cm-scroller")?.clientHeight>100 && window.M1racle.getMarkdown()==='+JSON.stringify(Buffer.from(bytes).toString('utf8').replace(/^\ufeff/,''))),'document loaded: '+name);
 }
 async focusEnd() {
  await this.evaluate('window.M1racle.focus()');
  for(const type of ['keyDown','keyUp'])await this.call('Input.dispatchKeyEvent',{type,key:'End',code:'End',windowsVirtualKeyCode:35,modifiers:2});
 }
 screenshot(name) {return writeFile(join(this.output,name),capturePng((...args)=>this.adb(...args)));}
 async disconnect() {
  if(this.socket){this.socket.close();this.socket=null;}
  for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new Error('Device debugger disconnected.'));}this.pending.clear();
  if(this.port){
   const port=this.port;this.port=null;
   try{this.adb('forward','--remove','tcp:'+port);}
   catch(error){
    // A physical disconnect may already remove this device's forward. Check
    // server state; never remove another device's forwards or mask a live one.
    const forwards=this.run('forward','--list').toString().trim().split(/\r?\n/);
    if(forwards.some(line=>line.split(/\s+/)[1]==='tcp:'+port))throw error;
   }
  }
 }
}
