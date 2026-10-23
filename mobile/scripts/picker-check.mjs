import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {DeviceDriver,waitFor} from './device-driver.mjs';
import {NativeUi} from './native-ui.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node mobile/scripts/picker-check.mjs --serial SERIAL [--apk FILE] [--inspect] [--lifecycle]\nStart at home. Real Android picker; unique fixtures only. --inspect captures inventory then cancels. --lifecycle kills only the background Note process while the picker is open, after checking the saved bytes. Evidence stays outside the checkout.');process.exit(0);}
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-picker-device-'));await mkdir(output,{recursive:true});
const d=new DeviceDriver({serial:option('--serial'),output}),ui=new NativeUi(d,output),token=Date.now().toString(36)+'-'+randomBytes(4).toString('hex'),prefix='qa-picker-'+token+'-';
const ownedNotes=new Set(),ownedPublic=new Set(),transfer='/data/local/tmp/'+prefix+'transfer.bin',current=prefix+'current.md',valid=prefix+'valid.md',invalid=prefix+'invalid.md';
const original='\ufeff# 导入前的笔记\r\n\r\n保留旧笔记。\n尾行\r',imported='\ufeff# '+prefix+'document\r\n\r\n原文件不能被改写。\n混合换行\r尾行。';
const result={date:new Date().toISOString(),serial:d.serial,checks:[],nativeTouches:ui.touches,errors:d.errors,physicalImeAcceptance:false,physicalHandleAcceptance:false};let pickerOpen=false;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const save=()=>writeFile(join(output,'picker-result.json'),JSON.stringify({...result,ownedNotes:[...ownedNotes],ownedPublic:[...ownedPublic]},null,2));
const passed=async name=>{result.checks.push(name);await save();console.log(JSON.stringify({passed:name}));};
const writePrivate=async(name,bytes)=>{assert.ok(name.startsWith(prefix));assert.ok(!d.listNotes().includes(name));ownedNotes.add(name);await writeFile(join(output,'transfer.bin'),bytes);d.adb('push',join(output,'transfer.bin'),transfer);d.adb('shell','run-as','com.m1racle.note','cp',transfer,'files/Notes/'+name);};
const writePublic=async(name,bytes)=>{assert.ok(name.startsWith(prefix));const path='/sdcard/Download/'+name;d.adb('shell','test','!','-e',path);ownedPublic.add(name);await writeFile(join(output,name),bytes);d.adb('push',join(output,name),path);};
const returnEditor=async()=>{await waitFor(()=>d.evaluate('document.body.dataset.screen==="editor" && !document.querySelector(".busy-indicator") && document.querySelector(".cm-content")?.contentEditable==="true"'),'editable document after picker');await d.waitNativeScreen();pickerOpen=false;};
const documentNode=node=>/documentsui$/.test(node.package);
const publicBytes=name=>{assert.ok(name.startsWith(prefix));return d.adb('exec-out','cat','/sdcard/Download/'+name);};
const openPicker=async kind=>{
 const importLabel=result.version==='0.0.7'?'打开其他文档':'导入 Markdown 副本';
 await d.tap('button','更多菜单');await d.tap('button',kind==='import'?importLabel:'导出 Markdown');pickerOpen=true;
 await ui.waitFor(documentNode,'Android '+kind+' picker');
 if(result.version!=='0.0.7')assert.equal(await d.evaluate('document.querySelector(".cm-content")?.contentEditable'),'false');
};
const cancelPicker=async({requireEditor=true}={})=>{
 for(let i=0;i<4;i++){
  const screen=await ui.snapshot('cancel picker');
  if(!screen.nodes.some(documentNode)){await d.waitNativeScreen();pickerOpen=false;if(requireEditor)await returnEditor();return;}
  d.adb('shell','input','keyevent','KEYCODE_BACK');
 }
 throw new Error('Picker did not return after Back');
};
const downloads=async()=>{
 await ui.tap(node=>documentNode(node) && node['content-desc']==='Show roots','show storage roots');
 const roots=await ui.waitFor(node=>documentNode(node) && node.text==='Downloads' && node['resource-id']==='android:id/title','Downloads root');
 await writeFile(join(output,'roots-inventory.json'),JSON.stringify(roots.nodes,null,2));
 await ui.tap(node=>documentNode(node) && node.text==='Downloads' && node['resource-id']==='android:id/title','open Downloads root');
};
const chooseFile=async name=>{
 await downloads();await ui.waitFor(node=>documentNode(node) && node.text===name && node['resource-id']==='android:id/title','file row: '+name);
 await ui.tap(node=>documentNode(node) && node.text===name && node['resource-id']==='android:id/title','choose '+name);
};
const finishExport=async name=>{
 assert.ok(name.startsWith(prefix));d.adb('shell','test','!','-e','/sdcard/Download/'+name);await downloads();
 const screen=await ui.waitFor(node=>documentNode(node) && node.class==='android.widget.EditText','export filename');await writeFile(join(output,'save-inventory.json'),JSON.stringify(screen.nodes,null,2));
 await ui.tap(node=>documentNode(node) && node.class==='android.widget.EditText','export filename field');
 d.adb('shell','input','keycombination','KEYCODE_CTRL_LEFT','KEYCODE_A');d.adb('shell','input','text',name);
 await ui.waitFor(node=>documentNode(node) && node.class==='android.widget.EditText' && node.text===name,'exact export filename');
 ownedPublic.add(name);await ui.tap(node=>documentNode(node) && node.class==='android.widget.Button' && /^save$/i.test(node.text),'save exported file');
};
const importedCopy=async(beforeNames,expected)=>{
 let name;await waitFor(()=>{const added=d.listNotes().filter(n=>!beforeNames.has(n));assert.ok(added.length<=1,'Unexpected notes appeared during import');if(!added.length)return false;name=added[0];assert.match(name,/^import-[0-9a-f-]+\.md$/);assert.ok(d.readNote(name).equals(Buffer.from(expected)));ownedNotes.add(name);return true;},'imported private file created');
 await returnEditor();await waitFor(()=>d.evaluate('window.M1racle.getMarkdown()==='+JSON.stringify(expected.slice(1))),'imported copy loaded');
 assert.ok(d.readNote(name).equals(Buffer.from(expected)));return name;
};
const reclaimBackground=async label=>{
 const beforePid=d.pid;await d.disconnect();d.adb('shell','am','kill','com.m1racle.note');
 await waitFor(()=>{try{return !d.adb('shell','pidof','-s','com.m1racle.note').toString().trim();}catch(error){if(error.status===1)return true;throw error;}},'background Note process reclaimed');
 const item={label,beforePid,pickerRetained:true};(result.reclaims??=[]).push(item);await save();return item;
};
const reconnectAfterReclaim=async item=>{await d.connect();item.afterPid=d.pid;assert.notEqual(item.afterPid,item.beforePid);};
try {
 await d.connect();assert.equal(await d.evaluate('document.body.dataset.screen'),'home','Start at home; never replace a user draft.');await d.waitNativeScreen();
 result.originalNotes=d.listNotes();result.version=d.adb('shell','dumpsys','package','com.m1racle.note').toString().match(/versionName=([^\s]+)/)?.[1];
 if(option('--apk')){result.apkSha256=hash(await readFile(resolve(option('--apk'))));const installed=d.adb('shell','pm','path','com.m1racle.note').toString().trim().replace(/^package:/,'');assert.equal(d.adb('shell','sha256sum',installed).toString().split(/\s/)[0],result.apkSha256);}
 await writePrivate(current,Buffer.from(original));await writePublic(valid,Buffer.from(imported));await writePublic(invalid,Buffer.from([0xff,0xfe,0x00,0x61]));
 await d.openNote(current,original);await d.focusEnd();await d.call('Input.insertText',{text:'继续写作。'});const beforePicker=original+'继续写作。';
 await openPicker('import');
 const picker=await ui.waitFor(node=>/documentsui/.test(node.package),'Android document picker');assert.equal(await d.evaluate('document.querySelector(".cm-content")?.contentEditable'),'false');await d.waitDisk(current,beforePicker);
 await d.screenshot('picker-open.png');
 if(args.includes('--inspect')){
  result.inspectionCompleted=true;await writeFile(join(output,'picker-inventory.json'),JSON.stringify(picker.nodes,null,2));console.log(JSON.stringify(picker.nodes.filter(node=>node.text || node['content-desc']).map(node=>({text:node.text,description:node['content-desc'],id:node['resource-id'],class:node.class,bounds:node.bounds}))));
  await cancelPicker();assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),beforePicker.slice(1));await passed('cancel-import-keeps-editable-original-and-disk-bytes');
 }else{
  await cancelPicker();assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),beforePicker.slice(1));assert.ok(d.readNote(current).equals(Buffer.from(beforePicker)));await passed('cancel-import-keeps-editable-original-and-disk-bytes');
  await openPicker('import');await chooseFile(invalid);await returnEditor();await waitFor(()=>d.evaluate('Boolean(document.querySelector(".error-banner"))'),'invalid encoding error');
  result.invalidEncodingMessage=await d.evaluate('document.querySelector(".error-banner").textContent');
  if(result.version!=='0.0.7'){assert.match(result.invalidEncodingMessage,/UTF-8/);assert.ok(!result.invalidEncodingMessage.includes('Input length'));}
  assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),beforePicker.slice(1));assert.ok(d.readNote(current).equals(Buffer.from(beforePicker)));assert.deepEqual(d.listNotes().sort(),[...result.originalNotes,current].sort());assert.ok(publicBytes(invalid).equals(Buffer.from([0xff,0xfe,0x00,0x61])));await d.tap('button','关闭提示');await passed('invalid-encoding-keeps-current-document-and-leaves-no-import');
  const beforeImport=new Set(d.listNotes());await openPicker('import');await chooseFile(valid);let copy=await importedCopy(beforeImport,imported);
  assert.ok(publicBytes(valid).equals(Buffer.from(imported)));assert.ok(d.readNote(current).equals(Buffer.from(beforePicker)));await passed('imported-copy-preserves-BOM-mixed-EOL-and-original-file');
  await d.focusEnd();await d.call('Input.insertText',{text:'副本继续写🌱'});const edited=imported+'副本继续写🌱';await d.waitDisk(copy,edited);assert.ok(publicBytes(valid).equals(Buffer.from(imported)));await d.evaluate('window.M1racle.undo()');await d.waitDisk(copy,imported);await d.evaluate('window.M1racle.redo()');await d.waitDisk(copy,edited);await passed('editing-and-undo-affect-only-private-copy');
  await openPicker('export');await d.screenshot('export-picker.png');await cancelPicker();assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),edited.slice(1));await d.waitDisk(copy,edited);await passed('cancel-export-keeps-editable-document');
  const exported=prefix+'export.md';await openPicker('export');await finishExport(exported);await returnEditor();await waitFor(()=>{try{return publicBytes(exported).equals(Buffer.from(edited));}catch{return false;}},'exported exact bytes');assert.ok(publicBytes(valid).equals(Buffer.from(imported)));await passed('system-export-writes-exact-current-BOM-and-mixed-EOL');
  const beforeReimport=new Set(d.listNotes());await openPicker('import');await chooseFile(exported);copy=await importedCopy(beforeReimport,edited);await passed('exported-file-reimports-with-identical-bytes');
  if(args.includes('--lifecycle')){
   await openPicker('export');await d.waitDisk(copy,edited);const exportReclaim=await reclaimBackground('complete export');const restartedExport=prefix+'after-reclaim.md';await finishExport(restartedExport);await reconnectAfterReclaim(exportReclaim);await returnEditor();
   await waitFor(()=>{try{return publicBytes(restartedExport).equals(Buffer.from(edited));}catch{return false;}},'export after Android process reclamation');assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),edited.slice(1));await passed('export-survives-background-process-reclamation');
   const beforeRestoredImport=new Set(d.listNotes());await openPicker('import');const importReclaim=await reclaimBackground('complete import');await chooseFile(valid);await reconnectAfterReclaim(importReclaim);copy=await importedCopy(beforeRestoredImport,imported);assert.ok(publicBytes(valid).equals(Buffer.from(imported)));await passed('import-survives-background-process-reclamation');
   await openPicker('import');const cancelledImport=await reclaimBackground('cancel import');await cancelPicker({requireEditor:false});await reconnectAfterReclaim(cancelledImport);await returnEditor();assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),imported.slice(1));
   await d.focusEnd();await d.call('Input.insertText',{text:'回来继续写'});const resumed=imported+'回来继续写';await d.waitDisk(copy,resumed);assert.ok(publicBytes(valid).equals(Buffer.from(imported)));await passed('cancel-import-after-reclamation-restores-editable-current-note');
   await openPicker('export');const cancelledExport=await reclaimBackground('cancel export');await cancelPicker({requireEditor:false});await reconnectAfterReclaim(cancelledExport);await returnEditor();assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),resumed.slice(1));await d.waitDisk(copy,resumed);await passed('cancel-export-after-reclamation-restores-current-note');
  }
  if(result.version!=='0.0.7'){const pending=d.adb('shell','run-as','com.m1racle.note','find','files/pending-exports','-type','f').toString().trim();assert.equal(pending,'','Completed or cancelled exports must remove their temporary copies.');result.exportCopiesRemoved=true;}
  result.passed=true;
 }
 assert.deepEqual(d.errors,[]);
}catch(error){result.passed=false;result.failure=String(error.stack || error);process.exitCode=1;await d.screenshot('failure.png').catch(()=>{});}
finally {
 try{
  if(pickerOpen)await cancelPicker({requireEditor:false});
  if(d.socket?.readyState!==WebSocket.OPEN)await d.connect();
  await d.evaluate('window.M1racle.back()');await waitFor(()=>d.evaluate('document.body.dataset.screen==="home" && !document.querySelector(".busy-indicator")'),'home before owned fixture cleanup');
  for(const name of ownedNotes){assert.ok(name.startsWith(prefix) || /^import-[0-9a-f-]+\.md$/.test(name));d.adb('shell','run-as','com.m1racle.note','rm','files/Notes/'+name);}
  for(const name of ownedPublic){assert.ok(name.startsWith(prefix));d.adb('shell','rm','/sdcard/Download/'+name);}
  if(ownedNotes.size)d.adb('shell','rm',transfer);await d.evaluate('window.M1racle.back()');result.ownFixturesRemoved=true;
 }catch(error){result.cleanupFailure=String(error.message);result.passed=false;process.exitCode=1;}
 try{await d.disconnect();}catch(error){result.disconnectFailure=String(error.message);result.passed=false;process.exitCode=1;}
 await save();console.log(JSON.stringify({inspectionCompleted:Boolean(result.inspectionCompleted),passed:result.passed??null,checks:result.checks.length,output}));
}
