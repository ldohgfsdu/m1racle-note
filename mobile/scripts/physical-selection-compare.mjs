import {mkdir,mkdtemp,readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {DeviceDriver} from './device-driver.mjs';

// Temporary diagnostic UI in the debug WebView. Both fields contain disposable
// text; the real note, preferences, parser and selection implementation stay intact.
const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
if(args.includes('--help')){console.log('node mobile/scripts/physical-selection-compare.mjs --serial SERIAL [--markdown]\nStart in the retained physical test note. Compares a textarea and bare CodeMirror with manual gestures only. --markdown uses the inspected 0.0.9 extension layout and requires review for later APKs. Write {id,label} or {id,finish:true} to request.json.');process.exit(0);}
const output=process.env.NOTE_QA_OUTPUT || await mkdtemp(join(tmpdir(),'note-selection-compare-'));await mkdir(output,{recursive:true});
const markdown=args.includes('--markdown');
const d=new DeviceDriver({serial:option('--serial'),output}),fixture=markdown?'**粗体中文** 和 [链接文字](https://example.invalid) 在同一段。\n第二段保留换行。':'粗体中文 和 链接文字 在同一段。\n第二段保留换行。';
const result={date:new Date().toISOString(),serial:d.serial,variant:markdown?'0.0.9-source-and-preview-extensions':'textarea-and-bare-CodeMirror',inputSource:'manual-handset-only',diagnosticOnly:true,events:[],checkpoints:[],errors:d.errors};
const save=()=>writeFile(join(output,'comparison-result.json'),JSON.stringify(result,null,2));
function prepare(text,markdown){
 if(window.__noteQaCompare)throw new Error('Another comparison is active');
 const original=document.querySelector('.cm-content')?.cmTile.root.view;if(!original)throw new Error('Open the test note first');
 const host=document.createElement('section');host.id='qa-selection-compare';host.setAttribute('aria-label','选字对照测试');
 host.innerHTML='<style>#qa-selection-compare{position:fixed;inset:0;z-index:2147483647;overflow:auto;background:var(--paper);color:var(--ink);padding:20px;box-sizing:border-box;font:17px/1.8 sans-serif}#qa-selection-compare h1{font-size:23px;margin:0 0 8px}#qa-selection-compare p{font-size:14px;margin:0 0 12px}#qa-selection-compare label{display:block;font-weight:600;margin-top:14px}#qa-selection-compare textarea,#qa-selection-compare .compare-cm{display:block;width:100%;height:136px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);font:17px/1.8 sans-serif;box-sizing:border-box}#qa-selection-compare textarea{padding:12px;resize:none}#qa-selection-compare .cm-editor{height:100%}#qa-selection-compare .cm-content{padding:12px!important;margin:0!important;min-height:0!important;max-width:none!important;width:auto!important;border:0!important;box-shadow:none!important}#qa-selection-compare .cm-scroller{font:17px/1.8 sans-serif!important;overflow:auto}</style><h1>选字对照（排查用）</h1><p>两处分别长按“粗体中文”，拖到“链接文字”末尾。这里的文字仅供测试。</p><label for="qa-compare-native">A · 普通文本框</label><textarea id="qa-compare-native" aria-label="A 普通文本框"></textarea><label>B · 基础编辑框</label><div class="compare-cm"></div>';
 original.contentDOM.blur();document.body.appendChild(host);
 const area=host.querySelector('textarea');area.value=text;
 let firstView,extensions=[];
 if(markdown){
  // QA-only: these are the inspected 0.0.9 app's presentation extensions.
  // Exclude its source-history field and bridge update listener completely.
  const base=original.state.config.base;
  if(base.length!==17 || !base[6].language || !Array.isArray(base[9]))throw new Error('Review the APK extension layout before this diagnostic');
  const common=[0,1,2,3,4,6,7,8,13].map(i=>base[i]);
  const parent=document.createElement('div');parent.className='compare-cm';area.replaceWith(parent);
  firstView=new original.constructor({parent,state:original.state.constructor.create({doc:text,extensions:common})});
  firstView.contentDOM.setAttribute('aria-label','A 完整源码');
  host.querySelector('label').textContent='A · 完整源码';host.querySelectorAll('label')[1].textContent='B · 排版预览';
  extensions=[...common,base[9]];
 }
 const view=new original.constructor({parent:host.querySelectorAll('.compare-cm')[markdown?1:0],state:original.state.constructor.create({doc:text,extensions})});
 view.contentDOM.setAttribute('aria-label','B 基础编辑框');
 const listeners=[],field=target=>target===area || firstView?.contentDOM.contains(target)?'A':view.contentDOM.contains(target)?'B':null;
 const viewState=v=>({text:v.state.doc.toString(),from:v.state.selection.main.from,to:v.state.selection.main.to,composing:v.composing,editContext:Boolean(v.contentDOM.editContext)});
 const state=()=>({A:firstView?viewState(firstView):{text:area.value,from:area.selectionStart,to:area.selectionEnd},B:viewState(view),dom:window.getSelection()?.toString(),active:field(document.activeElement),original:window.M1racle.getMarkdown()});
 const listener=e=>{const target=e.type==='selectionchange'?document.activeElement:e.target,source=field(target);if(!source)return;window.__noteQaCompareEvent(JSON.stringify({source,type:e.type,trusted:e.isTrusted,time:performance.now(),pointerType:e.pointerType??null,x:e.clientX??null,y:e.clientY??null,inputType:e.inputType??null,data:e.data??null,state:state()}));};
 for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend','selectionchange','beforeinput','input','compositionstart','compositionend']){document.addEventListener(type,listener,true);listeners.push(()=>document.removeEventListener(type,listener,true));}
 const stop=()=>{listeners.forEach(remove=>remove());view.contentDOM.blur();firstView?.contentDOM.blur();view.destroy();firstView?.destroy();host.remove();delete window.__noteQaCompare;};
 window.__noteQaCompare={state,stop};return {editContext:Boolean(view.contentDOM.editContext)};
}
let prepared=false,requestId;
try{
 await d.connect();await d.waitNativeScreen();assert.equal(await d.evaluate('document.body.dataset.screen'),'editor');
 result.original=await d.evaluate('window.M1racle.getMarkdown()');assert.ok(result.original.startsWith('# 真机输入验证'),'Use the retained QA note, never a personal draft.');
 assert.equal(await d.evaluate('document.querySelector(".cm-content").cmTile.root.view.composing'),false);
 await d.call('Runtime.addBinding',{name:'__noteQaCompareEvent'});
 d.socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.bindingCalled' && message.params.name==='__noteQaCompareEvent')result.events.push(JSON.parse(message.params.payload));});
 result.configuration=await d.evaluate('('+prepare.toString()+')('+JSON.stringify(fixture)+','+markdown+')');prepared=true;
 await d.screenshot('prepared.png');await writeFile(join(output,'ready.json'),JSON.stringify({output,control:join(output,'request.json')},null,2));await save();console.log(JSON.stringify({ready:true,output}));
 const deadline=Date.now()+15*60*1000;
 while(Date.now()<deadline){
  let request;try{await access(join(output,'request.json'));request=JSON.parse(await readFile(join(output,'request.json'),'utf8'));}catch{}
  if(request && request.id!==requestId){
   requestId=request.id;const state=await d.evaluate('window.__noteQaCompare.state()');assert.equal(state.original,result.original,'Comparison must not edit the note');
   const index=result.checkpoints.length;result.checkpoints.push({request,time:new Date().toISOString(),state});
   await d.screenshot('checkpoint-'+index+'.png');await writeFile(join(output,'checkpoint-'+index+'.xml'),await d.waitNativeScreen());await save();console.log(JSON.stringify({checkpoint:index}));
   if(request.finish){assert.equal(state.B.composing,false);assert.notEqual(state.A.composing,true);result.recordingCompleted=true;break;}
  }
  await save();await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.ok(result.recordingCompleted,'Comparison timed out; no selection gate accepted');assert.deepEqual(d.errors,[]);
}catch(error){result.failure=String(error.stack||error);process.exitCode=1;}
finally{
 if(prepared)try{await d.evaluate('window.__noteQaCompare?.stop()');await d.evaluate('new Promise(resolve=>setTimeout(resolve,500))');result.originalAfterCleanup=await d.evaluate('window.M1racle.getMarkdown()');assert.equal(result.originalAfterCleanup,result.original,'Removing diagnostic UI changed the test note');}catch(error){result.cleanupFailure=String(error);process.exitCode=1;}
 await d.disconnect();await save();console.log(JSON.stringify({output,recordingCompleted:Boolean(result.recordingCompleted),diagnosticOnly:true}));
}
