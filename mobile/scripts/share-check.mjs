import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {DeviceDriver,waitFor} from './device-driver.mjs';
import {NativeUi} from './native-ui.mjs';
import {ProbeDriver,probePackage} from './probe-driver.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node mobile/scripts/share-check.mjs --serial SERIAL [--apk FILE] [--observe] [--lifecycle]\nInstall the test-only QA receiver first. Start Note at home. Only the local QA receiver is selected. --observe records baseline contract failures before returning a failure status. --lifecycle reclaims the background Note process before a delayed read.');process.exit(0);}
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-share-device-'));await mkdir(output,{recursive:true});
const d=new DeviceDriver({serial:option('--serial'),output}),ui=new NativeUi(d,output),probe=new ProbeDriver(d,ui,output),token=Date.now().toString(36)+'-'+randomBytes(4).toString('hex'),filename='qa-share-'+token+'.md',transfer='/data/local/tmp/qa-share-'+token+'.bin';
const title='分享测试 '+token,raw='\ufeff# '+title+'\r\n\r\n分享时的原文。\n混合换行\r尾行。',expectedName=title+'.md',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={date:new Date().toISOString(),serial:d.serial,filename,checks:[],findings:[],touches:ui.touches,errors:d.errors,recipient:probePackage,networkRecipient:false,physicalImeAcceptance:false,physicalHandleAcceptance:false};let own=false;
const save=()=>writeFile(join(output,'share-result.json'),JSON.stringify(result,null,2));
const passed=async name=>{result.checks.push(name);await save();console.log(JSON.stringify({passed:name}));};
const contract=(condition,code,details)=>{if(condition)return;result.findings.push({code,...details});if(!args.includes('--observe'))assert.fail(code);};
const returnNote=async({restored=false}={})=>{
 d.adb('shell','am','start','-n','com.m1racle.note/.MainActivity','-f','0x34000000');
 await d.waitNativeScreen();
 if(d.socket?.readyState!==WebSocket.OPEN)await d.connect();
 const screen=await d.evaluate('document.body.dataset.screen');
 if(restored)assert.equal(screen,'editor','The reclaimed sharing activity should restore its current document.');
 if(screen==='home')await d.openNote(filename,d.readNote(filename));
 await waitFor(()=>d.evaluate('document.body.dataset.screen==="editor" && !document.querySelector(".busy-indicator")'),'return to Note editor');
};
const recipient=async()=>{
 const match=n=>n.text==='Note QA Receiver' && n.package!==probePackage;
 let screen=await ui.waitFor(n=>n['resource-id']==='android:id/resolver_list' || match(n),'Android share sheet');
 if(!screen.nodes.some(match)){
  await ui.swipe(n=>n['resource-id']==='android:id/resolver_list','expand Android share recipients');
  screen=await ui.waitFor(match,'QA recipient in expanded Android share sheet');
 }
 return match;
};
const share=async label=>{
 const before=probe.result()?.request;
 await d.tap('button','更多菜单');await d.tap('button','分享文档');
 const match=await recipient();await d.screenshot(label+'-chooser.png');
 await ui.tap(match,'select local QA receiver');
 await ui.waitFor(n=>n.package===probePackage,'local receiver foreground');
 return probe.waitResult(r=>r.command==='read-shared' && r.request!==before,label+' received bytes');
};
try{
 await d.connect();assert.equal(await d.evaluate('document.body.dataset.screen'),'home','Start at home; never replace a user draft.');await d.waitNativeScreen();
 assert.ok(!d.listNotes().includes(filename));d.adb('shell','pm','path',probePackage);
 if(option('--apk')){result.apkSha256=hash(await readFile(resolve(option('--apk'))));const installed=d.adb('shell','pm','path','com.m1racle.note').toString().trim().replace(/^package:/,'');assert.equal(d.adb('shell','sha256sum',installed).toString().split(/\s/)[0],result.apkSha256);}
 result.version=d.adb('shell','dumpsys','package','com.m1racle.note').toString().match(/versionName=([^\s]+)/)?.[1];
 await writeFile(join(output,'original.md'),Buffer.from(raw));own=true;d.adb('push',join(output,'original.md'),transfer);d.adb('shell','run-as','com.m1racle.note','cp',transfer,'files/Notes/'+filename);await d.openNote(filename,raw);
 const first=await share('first');result.first=first;assert.equal(first.intentType,'text/markdown');assert.equal(first.readGranted,true);assert.equal(first.writeGranted,false);assert.equal(first.sha256,hash(Buffer.from(raw)));await writeFile(join(output,'first-shared.md'),probe.read('shared.bin'));await passed('system-share-grants-read-only-and-delivers-exact-BOM-mixed-EOL');
 contract(first.displayName===expectedName,'shared-file-name-does-not-use-document-title',{expected:expectedName,actual:first.displayName});
 await returnNote();assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),raw.slice(1));await d.focusEnd();await d.call('Input.insertText',{text:'后续修改🌱'});const edited=raw+'后续修改🌱';await d.waitDisk(filename,edited);await passed('editing-source-after-share-still-saves-correct-note');
 const delayed=await probe.command('read-shared');result.delayed=delayed;await writeFile(join(output,'delayed-shared.md'),probe.read('shared.bin'));
 contract(delayed.sha256===first.sha256,'shared-uri-follows-later-source-edits',{sharedAtRequest:first.sha256,readLater:delayed.sha256});await passed('delayed-recipient-read-observed');
 await returnNote();const second=await share('second');result.second=second;assert.equal(second.sha256,hash(Buffer.from(edited)));assert.equal(second.writeGranted,false);
 contract(first.uri!==second.uri,'two-shares-reuse-one-live-document-uri',{uri:second.uri});await passed('next-share-delivers-the-new-source-revision');
 if(args.includes('--lifecycle')){
  await ui.waitFor(n=>n.package===probePackage,'receiver foreground before reclaiming Note');
  result.pidBeforeReclaim=d.adb('shell','pidof','-s','com.m1racle.note').toString().trim();await d.disconnect();
  const pid=()=>{try{return d.adb('shell','pidof','-s','com.m1racle.note').toString().trim();}catch(error){if(error.status===1)return '';throw error;}};
  assert.match(result.pidBeforeReclaim,/^\d+$/);
  d.adb('shell','am','kill','com.m1racle.note');
  result.reclaimMethod='Android am kill';
  try{await waitFor(()=>pid()!==result.pidBeforeReclaim,'background Note process reclaimed',3000);}
  catch(error){
   if(!error.message.startsWith('Device state did not settle:'))throw error;
   // A receiver's live provider connection can keep the provider above cached priority.
   // Signal only Note's still-matching UID/PID; never force-stop or revoke URI grants.
   assert.equal(pid(),result.pidBeforeReclaim);await writeFile(join(output,'provider-before-kill.txt'),d.adb('shell','dumpsys','activity','providers','com.m1racle.note'));
   d.adb('shell','run-as','com.m1racle.note','kill','-9',result.pidBeforeReclaim);result.reclaimMethod='run-as Note UID SIGKILL while provider is in use';
   await waitFor(()=>pid()!==result.pidBeforeReclaim,'old background Note PID has exited');
  }
  const retained=await probe.command('read-shared');result.afterReclaim=retained;assert.equal(retained.sha256,second.sha256);assert.equal(retained.writeGranted,false);
  result.pidAfterReclaim=d.adb('shell','pidof','-s','com.m1racle.note').toString().trim();assert.notEqual(result.pidBeforeReclaim,result.pidAfterReclaim);await passed('shared-copy-stays-readable-after-background-process-reclamation');
  await returnNote({restored:true});assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),edited.slice(1));await passed('reclaimed-sharing-activity-restores-the-edited-document');
 }
 await returnNote();await d.tap('button','更多菜单');await d.tap('button','分享文档');await recipient();d.adb('shell','input','keyevent','KEYCODE_BACK');await d.waitNativeScreen();await waitFor(()=>d.evaluate('!document.querySelector(".busy-indicator") && document.querySelector(".cm-content")?.contentEditable==="true"'),'editable after cancelling share');
 await d.focusEnd();await d.call('Input.insertText',{text:'取消后继续写'});await d.waitDisk(filename,edited+'取消后继续写');await passed('cancel-share-keeps-editable-source');
 assert.deepEqual(d.errors,[]);result.passed=result.findings.length===0;if(!result.passed)process.exitCode=1;
}catch(error){result.passed=false;result.failure=String(error.stack || error);process.exitCode=1;await d.screenshot('failure.png').catch(()=>{});}
finally{
 if(own)try{await returnNote();await d.evaluate('window.M1racle.back()');await waitFor(()=>d.evaluate('document.body.dataset.screen==="home" && !document.querySelector(".busy-indicator")'),'home before owned share cleanup');d.adb('shell','run-as','com.m1racle.note','rm','files/Notes/'+filename);d.adb('shell','rm',transfer);await d.evaluate('window.M1racle.back()');result.ownFixtureRemoved=true;}catch(error){result.cleanupFailure=String(error.message);result.passed=false;process.exitCode=1;}
 try{await d.disconnect();}catch(error){result.disconnectFailure=String(error.message);result.passed=false;process.exitCode=1;}
 await save();console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,findings:result.findings.length,output}));
}
