import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {DeviceDriver,waitFor} from './device-driver.mjs';
import {nativeElementTarget} from './native-view-target.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node mobile/scripts/link-editing-check.mjs --serial SERIAL --apk FILE\nStart at home. Programmatic CM caret; Android native edit form clicks and ASCII input; exact disk, undo, no-op and cancellation checks. Does not accept physical IME or handle gates.');process.exit(0);}
const output=process.env.NOTE_QA_OUTPUT||await mkdtemp(join(tmpdir(),'note-link-device-'));await mkdir(output,{recursive:true});
const d=new DeviceDriver({serial:option('--serial'),output}),token=Date.now().toString(36)+'-'+randomBytes(4).toString('hex'),filename='qa-link-'+token+'.md',transfer='/data/local/tmp/qa-link-'+token+'.bin';
const raw='\ufeff# 链接检查\r\n\r\n[项目](https://example.com/old  "保留说明")\r\n\r[**样式**](<https://example.com/styled> \'原说明\')\n保留后文。',text=raw.slice(1);
const result={date:new Date().toISOString(),serial:d.serial,filename,checks:[],errors:d.errors,selectionMethod:'CodeMirror API; buttons and form text use Android native input',physicalImeAcceptance:false,physicalHandleAcceptance:false};let own=false;
const save=()=>writeFile(join(output,'link-result.json'),JSON.stringify(result,null,2));await save();
const passed=async name=>{result.checks.push(name);await save();console.log(JSON.stringify({passed:name}));};
const select=async label=>{assert.equal(await d.evaluate('window.__noteQaLoaded'),filename);await d.evaluate(`(()=>{const v=document.querySelector('.cm-content').cmTile.root.view,at=v.state.doc.toString().indexOf(${JSON.stringify(label)})+1;v.dispatch({selection:{anchor:at}});v.focus();})()`);};
const edit=async label=>{await select(label);await d.tap('button','插入');await d.tap('button','编辑链接');};
const revealField=async name=>{
 for(let i=0;i<8;i++){
  const geometry=await d.evaluate(`(()=>{const input=[...document.querySelectorAll('.writing-fields input')].find(n=>n.labels?.[0]?.textContent.trim()===${JSON.stringify(name)}),r=input?.getBoundingClientRect(),p=document.querySelector('.writing-fields').getBoundingClientRect();return r?{center:(r.top+r.bottom)/2,top:p.top,bottom:p.bottom}:null;})()`);assert.ok(geometry,'Observed form field missing: '+name);
  if(geometry.center>=geometry.top+2&&geometry.center<=geometry.bottom-2)return;
  const target=await nativeElementTarget(d,'.writing-fields','field-scroll-'+name+'-'+i),xs=target.box.filter((_,j)=>j%2===0),ys=target.box.filter((_,j)=>j%2===1),left=Math.min(...xs),top=Math.min(...ys),width=Math.max(...xs)-left,height=Math.max(...ys)-top,up=geometry.center>geometry.bottom;
  const point=f=>({x:Math.round(target.bounds.x+(left+width*.5-target.viewport.x)*target.viewport.dpr),y:Math.round(target.bounds.y+(top+height*f-target.viewport.y)*target.viewport.dpr)}),from=point(up?.8:.2),to=point(up?.2:.8);
  d.adb('shell','input','touchscreen','swipe',String(from.x),String(from.y),String(to.x),String(to.y),'300');(result.formSwipes??=[]).push({name,from,to,coordinateSource:'observed native WebView and live writing-fields bounds'});
 }
 throw new Error('The field did not become visible after native form scrolling: '+name);
};
const input=async(name,value)=>{await revealField(name);await d.tap('textbox',name);d.adb('shell','input','keycombination','-t','100','KEYCODE_CTRL_LEFT','KEYCODE_A');d.adb('shell','input','text',value);};
const undo=async()=>{await d.tap('button','撤销上一步');await d.waitDisk(filename,raw);assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),text);};
try{
 await d.connect();assert.equal(await d.evaluate('document.body.dataset.screen'),'home','Never replace a user draft');result.apkSha256=createHash('sha256').update(await readFile(resolve(option('--apk')))).digest('hex');const apk=d.adb('shell','pm','path','com.m1racle.note').toString().trim().replace(/^package:/,'');assert.equal(d.adb('shell','sha256sum',apk).toString().split(/\s/)[0],result.apkSha256);
 assert.ok(!d.listNotes().includes(filename));await writeFile(join(output,'original.md'),Buffer.from(raw));d.adb('push',join(output,'original.md'),transfer);d.adb('shell','run-as','com.m1racle.note','cp',transfer,'files/Notes/'+filename);own=true;result.ownFixtureCreated=true;await save();await d.openNote(filename,raw);
 await edit('项目');await input('网址','https://example.com/new');await d.tap('button','保存修改');await d.waitDisk(filename,raw.replace('/old','/new'));await waitFor(()=>d.evaluate('document.activeElement===document.querySelector(".cm-content")'),'focus returns to body');await undo();await passed('native-URL-edit-only-preserves-title-spacing-BOM-and-mixed-EOL-with-exact-undo');
 await edit('项目');await input('显示文字','Renamed');await d.tap('button','保存修改');await d.waitDisk(filename,raw.replace('[项目]','[Renamed]'));await undo();await passed('native-caption-edit-only-and-exact-undo');
 await edit('样式');assert.equal(await d.evaluate('document.querySelector(".writing-sheet input").readOnly'),true);await input('网址','https://example.com/styled-new');await d.screenshot('edit-styled-link.png');await d.tap('button','保存修改');await d.waitDisk(filename,raw.replace('/styled>','/styled-new>'));await undo();await passed('native-styled-caption-and-angle-wrapper-remain-byte-identical-on-URL-edit');
 await edit('项目');const before=d.adb('shell','run-as','com.m1racle.note','stat','-c','%Y','files/Notes/'+filename).toString();await d.tap('button','保存修改');assert.ok(d.readNote(filename).equals(Buffer.from(raw)));assert.equal(d.adb('shell','run-as','com.m1racle.note','stat','-c','%Y','files/Notes/'+filename).toString(),before);await passed('native-unchanged-save-does-not-rewrite-the-file');
 await edit('项目');await input('网址','https://example.com/cancelled');await d.tap('button','取消');assert.ok(d.readNote(filename).equals(Buffer.from(raw)));assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),text);await passed('native-cancel-keeps-original-file-and-text');assert.deepEqual(d.errors,[]);result.passed=true;
}catch(error){result.passed=false;result.failure=String(error.stack||error);process.exitCode=1;await d.screenshot('failure.png').catch(()=>{});}
finally{
 if(own)try{await d.evaluate('window.M1racle.back()');await waitFor(()=>d.evaluate('document.body.dataset.screen==="home"&&!document.querySelector(".busy-indicator")'),'home before own fixture cleanup');d.adb('shell','run-as','com.m1racle.note','rm','files/Notes/'+filename);d.adb('shell','rm',transfer);result.ownFixtureRemoved=true;}catch(e){result.cleanupFailure=String(e);result.passed=false;process.exitCode=1;}
 try{await d.disconnect();}catch(e){result.disconnectFailure=String(e);result.passed=false;process.exitCode=1;}finally{await save();}console.log(JSON.stringify({passed:result.passed,checks:result.checks.length,output}));
}
