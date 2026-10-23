import {mkdir,mkdtemp,readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {DeviceDriver,waitFor} from './device-driver.mjs';

// This recorder never inserts text, synthesizes composition, or drives handles.
// Preparation focuses the note at its end; the operator then uses the handset
// keyboard and selection handles. Control requests
// only capture evidence or finish; they cannot make a physical gate pass.
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node mobile/scripts/physical-input-check.mjs --serial SERIAL [--apk FILE]\nStart at home. Creates one test note and records manual input. Write {id,label} to request.json for a checkpoint, or {id,finish:true} to finish. Evidence stays in NOTE_QA_OUTPUT or a new temporary folder. --native-selection is a runtime-only 0.0.9 diagnostic; review the extension layout before reuse.');process.exit(0);}
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-physical-input-'));await mkdir(output,{recursive:true});
const device=new DeviceDriver({serial:option('--serial'),output}),token=Date.now().toString(36)+'-'+randomBytes(4).toString('hex');
const filename='qa-physical-'+token+'.md',transfer='/data/local/tmp/note-physical-'+token+'.bin';
const raw='\ufeff# 真机输入验证\r\n\r\n在下方输入区试写。\n\r\n**粗体中文** 和 [链接文字](https://example.invalid) 在同一段。\r跨段选区：第一段。\n第二段保留换行。\r\n\r\n输入区：';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const result={date:new Date().toISOString(),serial:device.serial,filename,events:[],states:[],checkpoints:[],errors:device.errors,inputSource:'manual-handset-only',gates:{ChineseIme:'pending-review',selectionHandles:'pending-review',sustainedPerformance:'pending'}};
let own=false,started=false,lastState='',requestId;
const save=()=>writeFile(join(output,'physical-input-result.json'),JSON.stringify(result,null,2));
const state=()=>device.evaluate('({markdown:window.M1racle.getMarkdown(),selection:window.M1racle.getSelection(),composing:document.querySelector(".cm-content")?.cmTile.root.view.composing,domSelection:window.getSelection()?.toString(),screen:document.body.dataset.screen,path:window.__noteQaLoaded})');
try {
 await device.connect();assert.equal(await device.evaluate('document.body.dataset.screen'),'home','Start at home; a user draft must never be replaced.');await device.waitNativeScreen();
 result.model=device.adb('shell','getprop','ro.product.model').toString().trim();result.android=device.adb('shell','getprop','ro.build.version.release').toString().trim();result.inputMethod=device.adb('shell','settings','get','secure','default_input_method').toString().trim();
 result.originalNotes=device.listNotes();assert.ok(!result.originalNotes.includes(filename));
 if(option('--apk')){result.apkSha256=hash(await readFile(resolve(option('--apk'))));const installed=device.adb('shell','pm','path','com.m1racle.note').toString().trim().replace(/^package:/,'');assert.equal(device.adb('shell','sha256sum',installed).toString().split(/\s/)[0],result.apkSha256);}
 await writeFile(join(output,'original.md'),Buffer.from(raw));device.adb('push',join(output,'original.md'),transfer);device.adb('shell','run-as','com.m1racle.note','cp',transfer,'files/Notes/'+filename);own=true;
 await device.openNote(filename,raw);assert.ok(device.readNote(filename).equals(Buffer.from(raw)));
 if(args.includes('--native-selection')){
  // Diagnostic only: same editor, parser, file bridge and preview, omitting
  // the optional selection-drawing extension from the inspected 0.0.9 layout.
  result.nativeSelectionDiagnostic=await device.evaluate('(()=>{const v=document.querySelector(".cm-content").cmTile.root.view,s=v.state,b=s.config.base;if(b.length!==17 || !Array.isArray(b[1]) || !document.querySelector(".cm-selectionLayer"))throw new Error("Review the APK extension layout before this diagnostic");v.setState(s.constructor.create({doc:s.doc,selection:s.selection,extensions:b.filter((_,i)=>i!==1)}));if(document.querySelector(".cm-selectionLayer"))throw new Error("Selection drawing remained installed");return {optionalSelectionDrawing:false,previewEnabled:v.plugins.some(p=>p.value?.previewCache),editContext:Boolean(v.contentDOM.editContext)};})()');
  assert.equal(result.nativeSelectionDiagnostic.previewEnabled,true);assert.ok(device.readNote(filename).equals(Buffer.from(raw)));
 }
 await device.call('Runtime.addBinding',{name:'__noteQaPhysicalEvent'});
 device.socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.bindingCalled' && message.params.name==='__noteQaPhysicalEvent'){try{result.events.push(JSON.parse(message.params.payload));}catch(error){device.errors.push(String(error));}}});
 result.eventPath=await device.evaluate(`(()=>{window.__noteQaPhysicalStop?.();const content=document.querySelector('.cm-content'),listeners=[];const observe=(target,types,source)=>{for(const type of types){const listener=event=>{if(window.__noteQaLoaded!==${JSON.stringify(filename)})return;if(source==='DOM' && event.type!=='selectionchange' && !content?.contains(event.target))return;window.__noteQaPhysicalEvent(JSON.stringify({source,type:event.type,time:performance.now(),trusted:event.isTrusted,data:event.data??null,text:event.text??null,updateRangeStart:event.updateRangeStart??null,updateRangeEnd:event.updateRangeEnd??null,inputType:event.inputType??null,isComposing:event.isComposing??null,selection:window.M1racle.getSelection()}));};target.addEventListener(type,listener,true);listeners.push(()=>target.removeEventListener(type,listener,true));}};observe(document,['compositionstart','compositionupdate','compositionend','beforeinput','input','selectionchange','pointerdown','pointerup'],'DOM');if(content.editContext)observe(content.editContext,['compositionstart','compositionend','textupdate'],'EditContext');window.__noteQaPhysicalStop=()=>listeners.forEach(remove=>remove());return content.editContext?'EditContext-and-DOM':'DOM';})()`);
 await device.focusEnd();await device.screenshot('prepared.png');result.manualStart=await device.evaluate('performance.now()');started=true;await writeFile(join(output,'ready.json'),JSON.stringify({filename,output,control:join(output,'request.json')},null,2));
 console.log(JSON.stringify({ready:true,filename,output,manualInputRequired:true}));await save();
 const deadline=Date.now()+30*60*1000;
 while(Date.now()<deadline) {
  const value=await state();assert.equal(value.path,filename,'Stop recording before switching to a personal note.');
  const encoded=JSON.stringify(value);if(encoded!==lastState){result.states.push({time:new Date().toISOString(),...value});lastState=encoded;await save();}
  let request;try{await access(join(output,'request.json'));request=JSON.parse(await readFile(join(output,'request.json'),'utf8'));}catch{}
  if(request && request.id!==requestId){
   requestId=request.id;const index=result.checkpoints.length,checkpoint={id:request.id,label:String(request.label || 'manual checkpoint'),time:new Date().toISOString(),state:value};
   await writeFile(join(output,'checkpoint-'+index+'.xml'),device.nativeScreen());await device.screenshot('checkpoint-'+index+'.png');
   const bytes=device.readNote(filename);await writeFile(join(output,'checkpoint-'+index+'.md'),bytes);checkpoint.diskSha256=hash(bytes);checkpoint.diskMatchesEditor=bytes.equals(Buffer.from('\ufeff'+value.markdown));
   checkpoint.inputMethod=device.adb('shell','settings','get','secure','default_input_method').toString().trim();checkpoint.imeState=device.adb('shell','dumpsys','input_method').toString().split(/\r?\n/).filter(line=>/mInputShown=|mIsInputViewShown=/.test(line)).map(line=>line.trim());
   result.checkpoints.push(checkpoint);await save();console.log(JSON.stringify({checkpoint:index,label:checkpoint.label,diskMatchesEditor:checkpoint.diskMatchesEditor}));
   if(request.finish){assert.equal(value.composing,false,'Finish only after committing or cancelling the candidate.');await device.waitDisk(filename,'\ufeff'+value.markdown);result.recordingCompleted=true;break;}
  }
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 assert.ok(result.recordingCompleted,'Manual recording timed out; no physical gate was accepted.');assert.deepEqual(device.errors,[]);
 result.finalState=await state();result.finalSha256=hash(device.readNote(filename));
} catch(error){result.failure=String(error.stack || error);process.exitCode=1;}
finally {
 if(started)await device.evaluate('window.__noteQaPhysicalStop?.()').catch(()=>{});
 // Keep the manually edited note until review. Only the caller that owns this
 // exact name may remove it after preserving its evidence.
 result.testNoteRetained=own;
 if(own)try{device.adb('shell','rm',transfer);}catch(error){result.cleanupFailure=String(error.message);}
 try{await device.disconnect();}catch(error){result.disconnectFailure=String(error.message);process.exitCode=1;}
 await save();console.log(JSON.stringify({recordingCompleted:Boolean(result.recordingCompleted),testNoteRetained:own,output,physicalGatesRequireReview:true}));
}
