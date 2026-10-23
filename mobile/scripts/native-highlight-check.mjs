import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {DeviceDriver,waitFor,capturePng} from './device-driver.mjs';
import {nativeElementTarget} from './native-view-target.mjs';

const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node mobile/scripts/native-highlight-check.mjs --serial SERIAL --apk FILE\nStart at home. Native long-press and actual screenshot pixel comparison; never sets the selection. Does not accept handle comfort, IME or performance.');process.exit(0);}
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-native-highlight-'));await mkdir(output,{recursive:true});
const d=new DeviceDriver({serial:option('--serial'),output}),token=Date.now().toString(36)+'-'+randomBytes(4).toString('hex'),filename='qa-highlight-'+token+'.md',transfer='/data/local/tmp/qa-highlight-'+token+'.bin';
const raw='\ufeff# 长按高亮验证\r\n\r\n'+Array.from({length:20},(_,i)=>'**粗体中文** 和 [链接文字](https://example.invalid) 在同一段。'+['\r\n','\n','\r'][i%3]).join('');
const result={date:new Date().toISOString(),serial:d.serial,filename,errors:d.errors,selectionMethod:'native-Android-long-press',programmaticSelection:false,handleAcceptance:false,imeAcceptance:false,performanceAcceptance:false};let own=false;
try{
 await d.connect();assert.equal(await d.evaluate('document.body.dataset.screen'),'home','Never replace a user draft');
 result.apkSha256=createHash('sha256').update(await readFile(resolve(option('--apk')))).digest('hex');const installed=d.adb('shell','pm','path','com.m1racle.note').toString().trim().replace(/^package:/,'');assert.equal(d.adb('shell','sha256sum',installed).toString().split(/\s/)[0],result.apkSha256);
 assert.ok(!d.listNotes().includes(filename));await writeFile(join(output,'original.md'),Buffer.from(raw));d.adb('push',join(output,'original.md'),transfer);d.adb('shell','run-as','com.m1racle.note','cp',transfer,'files/Notes/'+filename);own=true;await d.openNote(filename,raw);
 const tap=await nativeElementTarget(d,'.cm-atomic-strong','focus');d.adb('shell','input','tap',String(tap.point.x),String(tap.point.y));
 const press=await nativeElementTarget(d,'.cm-atomic-strong','long-press');
 const geometry=()=>d.evaluate('(()=>{const n=document.querySelector(".cm-content"),r=n.getBoundingClientRect(),s=document.querySelector(".cm-scroller");return {x:r.x,y:r.y,width:r.width,height:r.height,scrollTop:s.scrollTop,scrollLeft:s.scrollLeft,paper:document.documentElement.dataset.paper,theme:document.documentElement.dataset.theme};})()');
 result.before=await geometry();const before=capturePng((...a)=>d.adb(...a));await writeFile(join(output,'before.png'),before);
 d.adb('shell','input','touchscreen','swipe',String(press.point.x),String(press.point.y),String(press.point.x),String(press.point.y),'800');
 await waitFor(()=>d.evaluate('window.M1racle.getSelection().some(r=>r.to>r.from)&&!!document.querySelector(".cm-selectionBackground")'),'native long-press produces a selection');
 result.selection=await d.evaluate('window.M1racle.getSelection()');result.after=await geometry();assert.deepEqual(result.after,result.before,'Compare pixels only when paper and scroll geometry are unchanged');
 const selected=await nativeElementTarget(d,'.cm-selectionBackground','visible-highlight'),{bounds,viewport,box}=selected;
 const xs=box.filter((_,i)=>i%2===0),ys=box.filter((_,i)=>i%2===1),rect={x:bounds.x+(Math.min(...xs)-viewport.x)*viewport.dpr,y:bounds.y+(Math.min(...ys)-viewport.y)*viewport.dpr,width:(Math.max(...xs)-Math.min(...xs))*viewport.dpr,height:(Math.max(...ys)-Math.min(...ys))*viewport.dpr};
 const after=capturePng((...a)=>d.adb(...a));await writeFile(join(output,'after.png'),after);
 result.pixels=await d.evaluate(`(async()=>{const pixels=async(encoded)=>{const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'})),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');context.drawImage(bitmap,0,0);const data=context.getImageData(0,0,bitmap.width,bitmap.height);bitmap.close();return data;};const a=await pixels(${JSON.stringify(before.toString('base64'))}),b=await pixels(${JSON.stringify(after.toString('base64'))}),rect=${JSON.stringify(rect)};let changed=0,total=0;for(let y=Math.ceil(rect.y);y<Math.floor(rect.y+rect.height);y++)for(let x=Math.ceil(rect.x);x<Math.floor(rect.x+rect.width);x++){const i=(y*a.width+x)*4;total++;if(Math.max(...[0,1,2].map(c=>Math.abs(a.data[i+c]-b.data[i+c])))>=8)changed++;}return {changed,total,rect};})()`);
 assert.ok(result.pixels.total>100);assert.ok(result.pixels.changed>result.pixels.total*.15,'Selection must visibly change the actual screen pixels');
 assert.equal(await d.evaluate('window.M1racle.getMarkdown()'),raw.slice(1));assert.ok(d.readNote(filename).equals(Buffer.from(raw)));assert.deepEqual(d.errors,[]);result.passed=true;
}catch(error){result.passed=false;result.failure=String(error.stack||error);process.exitCode=1;await d.screenshot('failure.png').catch(()=>{});}
finally{
 if(own)try{await d.evaluate('window.M1racle.back()');await waitFor(()=>d.evaluate('document.body.dataset.screen==="home"&&!document.querySelector(".busy-indicator")'),'home before own fixture cleanup');d.adb('shell','run-as','com.m1racle.note','rm','files/Notes/'+filename);d.adb('shell','rm',transfer);result.ownFixtureRemoved=true;}catch(error){result.passed=false;result.cleanupFailure=String(error);process.exitCode=1;}
 await d.disconnect();await writeFile(join(output,'highlight-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,pixels:result.pixels,output}));
}
