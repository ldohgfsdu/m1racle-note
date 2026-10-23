import './hidden-launch.mjs';
import {captureHidden} from './evidence-capture.mjs';
import {expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {cpus,hostname,release} from 'node:os';
import {basename,join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {launchApp,sleep} from './input-helpers.mjs';

// Batch 3C.1-3C.3 writing-experience closure. This suite uses the shared
// Electron helper and a fresh profile per scenario. It writes only new,
// timestamped evidence under docs/reviews/batch-3c/raw.
const repository=resolve('.');
const rawRoot=resolve('docs/reviews/batch-3c/raw');
const configuredRoot=resolve(process.env.NOTE_QA_OUTPUT || rawRoot);
const hiddenMain=resolve('desktop/tests/hidden-main.cjs');
if(configuredRoot!==rawRoot && !configuredRoot.startsWith(rawRoot+String.fromCharCode(92)) && !configuredRoot.startsWith(rawRoot+'/')){
  console.error(`NOTE_QA_OUTPUT must resolve to ${rawRoot}; received ${configuredRoot}`);
  process.exit(1);
}
if(!existsSync(hiddenMain)){
  console.error(`Required hidden-window harness is missing: ${hiddenMain}`);
  process.exit(1);
}
if(process.env.NOTE_TEST_FOREGROUND==='1'){
  console.error('NOTE_TEST_FOREGROUND=1 is not allowed for this suite.');
  process.exit(1);
}
const hiddenRequire=hiddenMain.replaceAll('\\','/');
let nodeOptions=process.env.NODE_OPTIONS||'';
if(/silent-main\.cjs/i.test(nodeOptions)){
  console.error('desktop/tests/silent-main.cjs uses showInactive and is not the no-window harness.');
  process.exit(1);
}
const hiddenOptionNeedle=`--require "${hiddenRequire}"`;
if(!nodeOptions.includes(hiddenOptionNeedle)){
  process.env.NODE_OPTIONS=`${nodeOptions} --require "${hiddenRequire}"`.trim();
}
const runStamp=new Date().toISOString().replace(/[:.]/g,'-');
const output=join(configuredRoot,`writing-experience-${runStamp}-${randomUUID().slice(0,8)}`);
await mkdir(output,{recursive:false});
const checkDir=join(output,'checks'),screenDir=join(output,'screens');
await Promise.all([mkdir(checkDir),mkdir(screenDir)]);
const startedAt=new Date().toISOString();

function slug(value){return value.replace(/[^a-z0-9._-]+/gi,'-').replace(/^-|-$/g,'').slice(0,120);}
async function filesUnder(directory){try{return await readdir(directory);}catch{return [];}}
async function draftFiles(profile){return (await filesUnder(join(profile,'recovery'))).filter(name=>name.endsWith('.json'));}
async function waitFor(predicate,{timeout=10000,interval=100,message='condition'}={}){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    const value=await predicate();
    if(value)return value;
    await sleep(interval);
  }
  throw new Error(`Timed out after ${timeout}ms waiting for ${message}`);
}
async function waitDisk(t,expected,timeout=30000){
  if(typeof t.disk!=='function')throw new Error('waitDisk requires an explicit actual target binding');
  await expect.poll(()=>t.disk(),{timeout}).toBe(expected);
  await expect(t.page.locator('#status')).toHaveText('已保存',{timeout});
}
function bindDisk(t,target){
  if(!target)throw new Error('bindDisk requires an actual target path');
  t.file=target;
  t.disk=()=>readFile(target,'utf8');
  return t;
}
async function closeWindow(t){
  await snapshotActions(t);
  t.__qaDialogSnapshot=await dialogStats(t);
  // Playwright releases its process mapping on 'close'. Retain the actual
  // ChildProcess and subscribe before closing; do not fabricate an exit code.
  const ownedProcess=t.app.process();
  const exited=ownedProcess.exitCode!==null ? Promise.resolve(ownedProcess.exitCode)
    : new Promise(resolve=>ownedProcess.once('exit',resolve));
  const closed=t.app.waitForEvent('close',{timeout:30000});
  await t.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await closed;
  return exited;
}
async function relaunch(t,target,own){
  if(!target)throw new Error('relaunch requires the actual disk target');
  if(t.file && resolve(t.file)!==resolve(target))throw new Error(`relaunch target ${target} does not match the bound target ${t.file}`);
  const expectedName=basename(target);
  const next=await launchApp({keepDir:t.dir,profile:t.profile,args:[]});
  await own(next,{reset:true});
  await expect(next.page.locator('#filename')).toHaveText(expectedName,{timeout:30000});
  return bindDisk(next,target);
}
async function installDialogs(t){
  await t.app.evaluate(({dialog})=>{
    globalThis.__noteQaDialogs={open:[],save:[],confirm:[],calls:[]};
    for(const [method,type,fallback] of [
      ['showOpenDialog','open',{canceled:true,filePaths:[]}],
      ['showSaveDialog','save',{canceled:true}],
      ['showMessageBox','confirm',{response:1}],
    ]){
      dialog[method]=async(...args)=>{
        const result=globalThis.__noteQaDialogs[type].shift() || fallback;
        globalThis.__noteQaDialogs.calls.push({type,result,options:args.at(-1)});
        return result;
      };
    }
  });
}
async function choose(t,type,value){
  await t.app.evaluate((_electron,{type,value})=>globalThis.__noteQaDialogs[type].push(value),{type,value});
}
async function dialogStats(t){
  try{
    return await t.app.evaluate(()=>{
      const value=globalThis.__noteQaDialogs;
      return {
        nativeOpen:value.calls.filter(call=>call.type==='open').length,
        nativeSave:value.calls.filter(call=>call.type==='save').length,
        nativeConfirm:value.calls.filter(call=>call.type==='confirm').length,
        queued:Object.fromEntries(Object.entries(value).filter(([key])=>key!=='calls').map(([key,items])=>[key,items.length])),
        calls:value.calls.map(call=>({type:call.type,result:call.result,options:call.options})),
      };
    });
  }catch{
    return t.__qaDialogSnapshot||null;
  }
}
async function installActionCounters(page){
  await page.evaluate(()=>{
    if(window.__noteQaActionsInstalled)return;
    const counters={pointerdown:0,shortcut:0,textInputs:0,textCharacters:0};
    window.__noteQaActions=counters;
    window.__noteQaActionsInstalled=true;
    document.addEventListener('pointerdown',()=>{counters.pointerdown++;},true);
    document.addEventListener('keydown',event=>{
      if(event.ctrlKey||event.metaKey||event.altKey)counters.shortcut++;
    },true);
    document.addEventListener('beforeinput',event=>{
      if(!String(event.inputType).startsWith('insert'))return;
      counters.textInputs++;
      counters.textCharacters+=typeof event.data==='string'?event.data.length:0;
    },true);
  });
}
async function pageActions(page){
  if(!page || page.isClosed())return {pointerdown:0,shortcut:0,textInputs:0,textCharacters:0};
  return page.evaluate(()=>({...window.__noteQaActions})).catch(()=>({pointerdown:0,shortcut:0,textInputs:0,textCharacters:0}));
}
async function syntheticDomClipboard(t,mode,expected){
  return t.page.evaluate(([mode,expected])=>{
    const content=document.querySelector('.cm-content');
    const view=content?.cmTile?.root?.view;
    if(!content || !view)throw new Error('editor DOM is unavailable for synthetic clipboard');
    const base={mode,scope:'synthetic DOM clipboard, not OS clipboard',expected,target:'editor-content'};
    if(typeof DataTransfer!=='function' || typeof ClipboardEvent!=='function'){
      return {...base,supported:false,consumed:false,delivered:false,error:'synthetic clipboard constructors are unavailable'};
    }
    try{
      const transfer=new DataTransfer();
      if(mode==='paste')transfer.setData('text/plain',expected);
      else if(mode!=='copy')throw new Error(`unknown synthetic clipboard mode: ${mode}`);
      const event=new ClipboardEvent(mode,{clipboardData:transfer,bubbles:true,cancelable:true,composed:true});
      const delivered=content.dispatchEvent(event);
      return {
        ...base,
        supported:true,
        consumed:event.defaultPrevented,
        delivered,
        text:transfer.getData('text/plain'),
        doc:view.state.doc.toString(),
      };
    }catch(error){
      return {...base,supported:false,consumed:false,delivered:false,error:String(error?.message||error)};
    }
  },[mode,expected]);
}
let actionWindowSequence=0;
async function startActionWindow(t){
  await installActionCounters(t.page);
  const baseline=await pageActions(t.page);
  t.__qaActionWindow=`${t.dir}:window-${++actionWindowSequence}`;
  t.__qaActionSnapshots??={};
  t.__qaActionSnapshots[t.__qaActionWindow]={
    baseline,
    latest:null,
  };
}
async function snapshotActions(t){
  if(!t?.page)return null;
  if(!t.__qaActionWindow)await startActionWindow(t);
  const latest=await pageActions(t.page);
  const windowRecord=t.__qaActionSnapshots?.[t.__qaActionWindow];
  if(windowRecord)windowRecord.latest=latest;
  return latest;
}
function aggregateActionSnapshots(resources){
  const total={pointerdown:0,shortcut:0,textInputs:0,textCharacters:0};
  for(const resource of resources){
    for(const windowRecord of Object.values(resource.__qaActionSnapshots||{})){
      if(!windowRecord.latest)continue;
      for(const key of Object.keys(total)){
        total[key]+=Math.max(0,(windowRecord.latest[key]||0)-(windowRecord.baseline[key]||0));
      }
    }
  }
  return total;
}
async function visibleControlLabel(locator){
  return locator.evaluate(element=>
    String(element.getAttribute('aria-label')||element.getAttribute('title')||element.textContent||'').trim(),
  );
}
async function visibleState(page){
  if(!page || page.isClosed())return {closed:true};
  return page.evaluate(()=>{
    const active=document.activeElement;
    const status=document.getElementById('status');
    const error=document.getElementById('error');
    const dialogs=[...document.querySelectorAll('dialog[open]')].filter(dialog=>{
      const rect=dialog.getBoundingClientRect();
      return rect.width>0 && rect.height>0;
    });
    return {
      title:document.title,
      viewport:{width:innerWidth,height:innerHeight},
      activeElement:{tag:active?.tagName||'',id:active?.id||'',class:active?.className||'',label:active?.getAttribute?.('aria-label')||''},
      editorFocused:Boolean(document.querySelector('.cm-content')===active),
      rendererFocusSimulation:document.hasFocus(),
      filename:document.getElementById('filename')?.textContent||'',
      status:status?.textContent||'',
      statusState:status?.dataset.state||'',
      mode:document.querySelector('.pane')?.dataset.mode||'',
      errorVisible:error?!error.hidden:false,
      errorText:document.getElementById('error-message')?.textContent||'',
      dialogs:dialogs.map(dialog=>({id:dialog.id,role:dialog.getAttribute('role')||'dialog',labelledby:dialog.getAttribute('aria-labelledby')||''})),
      theme:document.documentElement.classList.contains('dark')?'dark':'light',
    };
  }).catch(error=>({stateError:String(error?.message||error)}));
}
async function assertNoVisibleFailure(t){
  assert.deepEqual(t.errors,[],'renderer console/page errors');
  assert.equal(await t.page.locator('#error').isVisible(),false,'visible application error');
  assert.notEqual(await t.page.locator('#status').getAttribute('data-state'),'error','error status');
}
async function selectionGeometry(t){
  return t.page.evaluate(()=>{
    const menu=document.getElementById('selection-menu');
    const view=document.querySelector('.cm-content').cmTile.root.view;
    const selection=view.state.selection.main;
    const backgrounds=[...document.querySelectorAll('.cm-selectionBackground')].map(node=>{
      const rect=node.getBoundingClientRect();
      return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom};
    });
    const rect=menu.hidden?null:menu.getBoundingClientRect();
    return {
      hidden:menu.hidden,
      selected:view.state.doc.sliceString(selection.from,selection.to),
      menu:rect&&{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom},
      backgrounds,
    };
  });
}
function overlap(a,b){
  if(!a||!b)return 0;
  return Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))
    *Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
}
function normaliseRaw(raw){return raw.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n');}
function crlfStored(normalized){return `\ufeff${normalized.replace(/\n/g,'\r\n')}`;}

class EvidenceReporter{
  constructor(){
    this.records=[];this.failures=[];this.resources=[];this.currentPage=null;
  }
  async own(t,{reset=false}={}){
    if(!this.resources.includes(t))this.resources.push(t);
    this.currentPage=t.page;
    if(reset || !t.__qaActionWindow)await startActionWindow(t);
  }
  async run(id,body){
    if(process.env.NOTE_QA_WRITING_CASE && !process.env.NOTE_QA_WRITING_CASE.split(',').some(prefix=>id.startsWith(prefix)))return;
    const record={id,status:'passed',stage:'start:check',startedAt:new Date().toISOString(),durationMs:0,metrics:{},failure:null};
    const started=Date.now();
    const stage=value=>{record.stage=value;console.log('STAGE',id,value);};
    const own=(resource,options)=>this.own(resource,options);
    console.log('START',id);
    try{
      await body(stage,own,record);
    }catch(error){
      record.status='failed';
      record.failure={stage:record.stage,message:String(error?.message||error),stack:String(error?.stack||error).slice(0,12000)};
      record.error={name:String(error?.name||'Error'),message:String(error?.message||error),stack:String(error?.stack||error).slice(0,12000)};
      if(typeof error.actual==='string' && typeof error.expected==='string'){
        const actual=error.actual,expected=error.expected;
        let first=0;while(first<Math.min(actual.length,expected.length)&&actual[first]===expected[first])first++;
        record.assertion={actualLength:actual.length,expectedLength:expected.length,firstMismatch:first,
          actualAroundMismatch:actual.slice(Math.max(0,first-80),first+160),expectedAroundMismatch:expected.slice(Math.max(0,first-80),first+160)};
      }
      this.failures.push({id,stage:record.stage,message:record.failure.message});
      const failedResource=this.resources.find(resource=>resource.page===this.currentPage);
      if(this.currentPage && !this.currentPage.isClosed() && failedResource?.app){
        await captureHidden(
          failedResource.app,
          this.currentPage,
          join(screenDir,`fail-${slug(id)}.png`),
        ).catch(()=>{});
      }
    }finally{
      record.durationMs=Date.now()-started;
      for(const resource of this.resources){
        if(resource.page && !resource.page.isClosed())await resource.page.waitForLoadState('domcontentloaded',{timeout:10000}).catch(()=>{});
        await snapshotActions(resource);
      }
      record.actions=aggregateActionSnapshots(this.resources);
      record.actionCounterScope='Per renderer navigation/window. pointerdown counts captured pointerdown events; shortcut counts Ctrl/Meta/Alt keydown events; textInputs counts each insert* beforeinput event, not a logical text sequence or physical keystroke; textCharacters sums beforeinput data. Programmatic selection is excluded. Reloads start a new counter window.';
      record.visibleEnd=await visibleState(this.currentPage);
      record.errors=this.resources.flatMap(resource=>resource.errors||[]);
      record.integrity=[];
      for(const [index,resource] of this.resources.entries()){
        const integrity={file:resource.file,profile:resource.profile};
        try{
          const bytes=await readFile(resource.file);
          integrity.bytes=bytes.length;
          integrity.sha256=createHash('sha256').update(bytes).digest('hex');
          integrity.evidenceFile=join(checkDir,`${slug(id)}-${index}.bytes`);
          await writeFile(integrity.evidenceFile,bytes,{flag:'wx'});
        }catch(error){integrity.diskError=String(error?.message||error);}
        if(!resource.page.isClosed())integrity.editor=await resource.state();
        record.integrity.push(integrity);
      }
      record.dialogs=this.resources.at(-1)?await dialogStats(this.resources.at(-1)).catch(()=>({})):{};
      let rawWrite=null;
      try{
        const number=String(this.records.length).padStart(2,'0');
        await writeFile(join(checkDir,`${number}-${slug(id)}.json`),JSON.stringify(record,null,2));
      }catch(error){
        rawWrite={status:'failed',message:String(error?.message||error),stack:String(error?.stack||error).slice(0,12000)};
        record.status='failed';
        record.stage='write-check-raw-json';
        record.error=rawWrite;
        this.failures.push({id,stage:record.stage,message:rawWrite.message});
      }
      this.records.push(record);
      if(rawWrite){
        await writeFile(join(screenDir,`fail-${slug(id)}.json`),JSON.stringify(record,null,2)).catch(()=>{});
      }
      console.log(record.status.toUpperCase(),id,record.durationMs+'ms',record.failure?record.failure.stage:'');
      await this.cleanupResources();
    }
    return record;
  }
  async cleanupResources(){
    const resources=this.resources.splice(0);
    const removed=new Set();
    for(const resource of resources){
      if(resource.page && !resource.page.isClosed() && resource.app){
        await resource.app.evaluate(({app})=>app.exit(0)).catch(()=>{});
        await resource.app.close().catch(()=>{});
      }
    }
    // Relaunched resources share a profile. Stop every process before removing
    // any directory, or Windows file locks turn cleanup into a long retry loop.
    for(const resource of resources){
      if(resource.dir && !removed.has(resource.dir)){
        removed.add(resource.dir);
        await rm(resource.dir,{recursive:true,force:true,maxRetries:20,retryDelay:250}).catch(()=>{});
      }
    }
    this.currentPage=null;
  }
  async finish(){
    await this.cleanupResources();
    let gitCommit=null;
    let electronVersion=null;
    try{gitCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8',windowsHide:true}).trim();}catch{}
    try{electronVersion=JSON.parse(await readFile(join(repository,'node_modules','electron','package.json'),'utf8')).version;}catch{}
    const passed=this.failures.length===0;
    const summary={
      suite:'writing-experience-ui',
      evidenceClass:'FUNCTIONAL', visualStatus:'VISUAL_UNVERIFIED',
      performanceStatus:'UNVERIFIED: hidden renderer timings cannot establish foreground writing performance.',
      passed,
      passedCount:this.records.filter(record=>record.status==='passed').length,
      failedCount:this.failures.length,
      startedAt,
      finishedAt:new Date().toISOString(),
      output,
      environment:{platform:process.platform,arch:process.arch,osRelease:release(),hostname:hostname(),cpu:cpus()[0]?.model||null,node:process.version,electron:electronVersion,gitCommit},
      focusBoundary:'The suite requires desktop/tests/hidden-main.cjs: native windows remain hidden and show/activate/focus methods are no-ops. Renderer focus remains CDP-emulated and is not physical Windows foreground focus.',
      tasks:this.records.map(record=>({id:record.id,status:record.status,stage:record.status==='failed'?record.failure.stage:null,durationMs:record.durationMs,actions:record.actions,metrics:record.metrics})),
      phaseStatistics:Object.fromEntries([
        ['cold',this.records.flatMap(record=>record.metrics?.coldFirstMs==null?[]:[record.metrics.coldFirstMs])],
        ['warm',this.records.flatMap(record=>record.metrics?.warmMs==null?[]:[record.metrics.warmMs])],
        ['stable',this.records.flatMap(record=>record.metrics?.stable?Object.values(record.metrics.stable):[])],
      ]),
      failures:this.failures,
      checksFile:checkDir,
  scope:'Actual Electron UI via Playwright in the parent run through hidden-main.cjs, with hidden native windows and no window activation. Dialog responses are QA-controlled. Renderer focus is emulated, not physical foreground focus. OS application switching, physical Windows IME, native Win+V, and human learning cost are not verified here.',
    };
    await writeFile(join(output,'writing-experience-ui.json'),JSON.stringify(summary,null,2));
    console.log(JSON.stringify({suite:summary.suite,passed,passedCount:summary.passedCount,failedCount:summary.failedCount,output}));
    if(!passed)process.exitCode=1;
  }
}

const R=new EvidenceReporter();

await R.run('A-quick-note-cold-new-save-close-reopen',async(stage,own,record)=>{
  const coldStart=Date.now();
  stage('cold-launch-fresh-profile');
  const t=await launchApp({args:[]});await own(t,{reset:true});
  record.metrics.coldLaunchToHelperReadyMs=Date.now()-coldStart;
  await installDialogs(t);
  stage('fresh-visible-state');
  assert.equal(await t.page.locator('#filename').textContent(),'欢迎.md');
  assert.match(await t.doc(),/留一点空间，给思考/);
  assert.equal(await t.page.locator('#recovery').isVisible(),false);

  stage('new-document-visible-action');
  await t.page.getByRole('button',{name:'新建'}).click();
  await expect(t.page.locator('#filename')).toHaveText('未命名.md');
  await expect.poll(()=>t.state().then(state=>state.focus)).toBe(true);
  record.metrics.coldLaunchToNewDocumentEditableMs=Date.now()-coldStart;
  record.metrics.startupMeasurement='From launchApp call through visible New action to a focused, empty CodeMirror view. Includes the input helper\'s fixed 250 ms settle and visible New click.';
  assert.equal(await t.doc(),'');
  record.metrics.newDocumentVisible={filename:await t.page.locator('#filename').textContent(),empty:true,focused:true};

  stage('type-about-200-characters');
  const note='快速记录'.repeat(50);
  assert.equal(note.length,200);
  await t.page.keyboard.type(note,{delay:0});
  assert.equal(await t.doc(),note);
  record.metrics.note={characters:note.length,logicalTypingCalls:1};

  stage('first-save-and-dialog-count');
  const target=join(t.dir,'快速记录.md');
  bindDisk(t,target);
  await choose(t,'save',{canceled:false,filePath:target});
  await t.page.getByRole('button',{name:'保存'}).click();
  await waitDisk(t,note);
  assert.equal(await t.page.locator('#filename').textContent(),'快速记录.md');
  const firstDialogs=await dialogStats(t);
  assert.deepEqual(
    {nativeOpen:firstDialogs.nativeOpen,nativeSave:firstDialogs.nativeSave,nativeConfirm:firstDialogs.nativeConfirm},
    {nativeOpen:0,nativeSave:1,nativeConfirm:0},
  );
  record.metrics.requiredSaveDialog={nativeSave:firstDialogs.nativeSave};
  record.metrics.unexpectedDialogs=firstDialogs.nativeOpen+firstDialogs.nativeConfirm;

  stage('normal-close-saved-note');
  assert.equal(await closeWindow(t),0);

  stage('relaunch-without-file-command');
  const reopened=await relaunch(t,target,own);
  await installDialogs(reopened);
  await expect(reopened.page.locator('#filename')).toHaveText('快速记录.md',{timeout:30000});
  assert.equal(await reopened.doc(),note);
  assert.equal(await reopened.disk(),note);
  const reopenFocus=await reopened.state();
  record.metrics.reopenedVisible={filename:await reopened.page.locator('#filename').textContent(),status:await reopened.page.locator('#status').textContent()};

  stage('continue-writing-after-reopen');
  await reopened.focus();
  await reopened.page.keyboard.press('Control+End');
  await reopened.page.keyboard.insertText('继续记录');
  const continued=note+'继续记录';
  await waitDisk(reopened,continued);
  record.metrics.reopenRendererFocusSimulation=reopenFocus.rendererFocusSimulation;
  record.metrics.characterCount=note.length;
  record.metrics.nonEssentialDialogs=firstDialogs.nativeOpen+firstDialogs.nativeConfirm;
  await assertNoVisibleFailure(reopened);
});

await R.run('B-full-article-editing-formatting-history-find-save-themes',async(stage,own,record)=>{
  const initial='\ufeff# 写作验收\r\n\r\n';
  stage('launch-existing-bom-crlf-document');
  const t=await launchApp({raw:initial,name:'完整文章.md'});await own(t,{reset:true});
  await installDialogs(t);
  assert.deepEqual(t.errors,[]);

  stage('type-1500-to-3000-character-mixed-article');
  const paragraphs=[];
  for(let index=1;index<=13;index++){
    paragraphs.push(
      `第${index}段记录中文写作与 English mixed text。作者在安静的桌面前整理思路，观察输入、选择、格式化、撤销和保存之间的连续性。`+
      `这一段的唯一标识是 paragraph-${String(index).padStart(2,'0')}，内容用于确认段落边界、光标位置和源文件范围编辑保持准确。`,
    );
  }
  const body=[
    '## 从清晨开始',
    '',
    ...paragraphs.slice(0,4).flatMap(paragraph=>[paragraph,'']),
    '## 方法与观察',
    '',
    ...paragraphs.slice(4,9).flatMap(paragraph=>[paragraph,'']),
    '### 清单',
    '',
    '- 标题、段落和列表保留为 Markdown 源文本',
    '- 引用内容不经过 AST 反向序列化',
    '- 链接与普通文字可以共同编辑',
    '',
    '> 写作工具应让作者专注于文字，同时让每一次修改都可追溯。',
    '',
    ...paragraphs.slice(9).flatMap(paragraph=>[paragraph,'']),
    '## 收束',
    '',
    '这一段包含真实输入与 English mixed text，用于后续粗体操作。',
    '',
    '相关链接：[参考页面](https://example.com/reference)。',
    '',
    '临时项目',
    '',
    '段落甲',
    '段落乙',
    '',
  ].join('\n');
  assert.ok(body.length>1300 && initial.length+body.length<3000,`article length ${initial.length+body.length}`);
  await t.focus();
  await t.page.keyboard.press('Control+End');
  // Author line by line. Enter legitimately continues Markdown markup. Consume
  // an existing auto-prefix once, or erase it when the author leaves the block.
  // Keep the independently constructed article and exact byte assertions.
  const lines=body.split('\n');
  let authored=normaliseRaw(initial);
  const continuations=[];
  for(const [index,line] of lines.entries()){
    const current=await t.doc();
    assert.ok(current.startsWith(authored),'typing changed a previously authored range');
    let prefix=current.slice(authored.length);
    assert.ok(['','- ','> ','>'].includes(prefix),`unexpected Markdown continuation ${JSON.stringify(prefix)}`);
    if(prefix && !line.startsWith(prefix)){
      continuations.push({line:index,generated:prefix,action:'backspace-prefix-to-leave-block'});
      for(let i=0;i<prefix.length && await t.doc()!==authored;i++)await t.page.keyboard.press('Backspace');
      assert.equal(await t.doc(),authored,'leaving automatic markup must preserve the authored prefix');
      prefix='';
    }else if(prefix)continuations.push({line:index,generated:prefix,action:'type-after-generated-prefix'});
    await t.page.keyboard.type(line.slice(prefix.length),{delay:0});
    authored+=line;
    assert.equal(await t.doc(),authored);
    if(index<lines.length-1){await t.page.keyboard.press('Enter');authored+='\n';}
  }
  record.metrics.markdownEnterContinuations=continuations;
  let expected=normaliseRaw(initial)+body;
  assert.equal(await t.doc(),expected,'typed output must match the independently constructed expectation');
  record.metrics.documentCharacters=expected.length;
  record.metrics.containsRequiredMarkdown={
    heading:expected.includes('## 从清晨开始'),
    paragraphs:expected.includes('paragraph-13'),
    list:expected.includes('- 标题、段落和列表'),
    quote:expected.includes('> 写作工具'),
    link:expected.includes('[参考页面](https://example.com/reference)'),
  };

  stage('visible-bold-format-range');
  let from=expected.indexOf('真实输入');
  let to=from+'真实输入'.length;
  assert.ok(from>0);
  await t.select(from,to);
  const boldControl=t.page.locator('#format [data-format="bold"]');
  assert.equal(await visibleControlLabel(boldControl),'粗体');
  await boldControl.click();
  expected=expected.slice(0,from)+'**真实输入**'+expected.slice(to);
  assert.equal(await t.doc(),expected);
  await sleep(650);
  await waitDisk(t,crlfStored(expected));

  stage('visible-list-format-range');
  from=expected.indexOf('临时项目');
  to=from+'临时项目'.length;
  await t.select(from,to);
  const listControl=t.page.locator('#format [data-format="list"]');
  assert.match(await visibleControlLabel(listControl),/^无序列表(?: ·|$)/);
  assert.equal((await listControl.textContent()).trim(),'列表');
  await listControl.click();
  expected=expected.slice(0,from)+'- 临时项目'+expected.slice(to);
  assert.equal(await t.doc(),expected);
  await sleep(650);
  await waitDisk(t,crlfStored(expected));

  stage('keyboard-paragraph-move');
  from=expected.indexOf('段落乙');
  await t.select(from+2);
  await t.page.keyboard.press('Alt+ArrowUp');
  const swapped=expected.replace('段落甲\n段落乙','段落乙\n段落甲');
  assert.equal(await t.doc(),swapped);
  expected=swapped;
  await t.page.keyboard.press('Control+z');
  assert.equal(await t.doc(),expected.replace('段落乙\n段落甲','段落甲\n段落乙'));
  await t.page.keyboard.press('Control+y');
  assert.equal(await t.doc(),expected);

  stage('clipboard-copy-paste-and-history');
  from=expected.indexOf('段落乙');
  to=from+'段落乙'.length;
  assert.ok(from>=0,'paragraph text for synthetic copy must exist');
  await t.select(from,to);
  const copied=await syntheticDomClipboard(t,'copy','段落乙');
  assert.equal(copied.scope,'synthetic DOM clipboard, not OS clipboard');
  let pasted=null,undoRedo=null;
  let clipboardStatus='UNVERIFIED';
  let clipboardReason='synthetic DOM copy was not consumed by CodeMirror';
  if(copied.supported && copied.consumed && copied.text==='段落乙'){
    await t.select(expected.length);
    pasted=await syntheticDomClipboard(t,'paste',copied.text);
    if(pasted.supported && pasted.consumed){
      expected+='段落乙';
      assert.equal(await t.doc(),expected,'synthetic paste must insert exactly 段落乙');
      await t.page.keyboard.press('Control+z');
      const undone=expected.slice(0,-3);
      assert.equal(await t.doc(),undone,'undo after synthetic paste must restore the exact document');
      await t.page.keyboard.press('Control+y');
      assert.equal(await t.doc(),expected,'redo after synthetic paste must restore the exact document');
      undoRedo={undoRestored:undone,redoRestored:await t.doc()};
      clipboardStatus='VERIFIED_SYNTHETIC_DOM';
    }else{
      clipboardReason='synthetic DOM paste was not consumed by CodeMirror';
    }
  }
  record.metrics.clipboard={
    scope:'synthetic DOM clipboard, not OS clipboard',
    status:clipboardStatus,
    unverifiedReason:clipboardStatus==='UNVERIFIED'?clipboardReason:null,
    nativeClipboardAPIUsed:false,
    selection:{from,to,text:'段落乙'},
    copy:copied,
    paste:pasted,
    undoRedo,
    physicalOsClipboard:'UNVERIFIED',
    crossApplicationPaste:'UNVERIFIED',
    reuseEvidence:'docs/reviews/batch-3c/raw/final-regression/history-clipboard-ui/history-clipboard-ui.json: current2f 13/13 passed, including A4-paste-then-undo-redo-exact before interruption. Physical OS clipboard remains manual/unverified.',
  };

  stage('find-existing-phrase');
  await t.page.getByRole('button',{name:'查找'}).click();
  const panel=t.page.locator('.cm-search');
  await expect(panel).toBeVisible();
  const query=panel.getByRole('textbox',{name:'查找',exact:true});
  await query.fill('相关链接');
  await panel.getByRole('button',{name:'下一处',exact:true}).click();
  const found=await t.page.locator('.cm-content').evaluate(element=>{
    const selection=element.cmTile.root.view.state.selection.main;
    return element.cmTile.root.view.state.doc.sliceString(selection.from,selection.to);
  });
  assert.equal(found,'相关链接');
  await panel.getByRole('button',{name:'关闭查找',exact:true}).click();

  stage('selection-toolbar-does-not-obscure-selected-text');
  from=expected.indexOf('安静');
  assert.ok(from>0);
  await t.page.locator('.cm-content').evaluate((element,from)=>{
    const view=element.cmTile.root.view;
    view.dispatch({selection:{anchor:from,head:from+2},scrollIntoView:true});view.focus();
  },from);
  await expect(t.page.locator('#selection-menu')).toBeVisible();
  const geometry=await selectionGeometry(t);
  assert.equal(geometry.hidden,false);
  assert.ok(geometry.backgrounds.length>0,'selection highlight must exist');
  const covered=geometry.backgrounds.reduce((sum,rect)=>sum+overlap(geometry.menu,rect),0);
  assert.ok(covered<=1,`selection toolbar covers selected text by ${covered}px^2`);
  record.metrics.selectionToolbarCoveredArea=covered;

  stage('explicit-keyboard-save-and-exact-bytes');
  await t.focus();
  await t.page.keyboard.press('Control+s');
  await waitDisk(t,crlfStored(expected),30000);
  assert.equal(await t.disk(),crlfStored(expected));

  stage('light-dark-parity-without-write');
  if(await t.page.locator('html').evaluate(element=>element.classList.contains('dark'))){
    await t.page.getByRole('button',{name:'切换深浅色'}).click();
  }
  const mtime=(await stat(t.file)).mtimeMs;
  const light=await t.page.evaluate(()=>({
    theme:document.documentElement.dataset.theme,
    canvas:getComputedStyle(document.body).backgroundColor,
    paper:getComputedStyle(document.querySelector('.cm-editor')).backgroundColor,
    text:getComputedStyle(document.querySelector('.cm-content')).color,
  }));
  await t.page.getByRole('button',{name:'切换深浅色'}).click();
  await sleep(150);
  const dark=await t.page.evaluate(()=>({
    theme:document.documentElement.dataset.theme,
    canvas:getComputedStyle(document.body).backgroundColor,
    paper:getComputedStyle(document.querySelector('.cm-editor')).backgroundColor,
    text:getComputedStyle(document.querySelector('.cm-content')).color,
  }));
  assert.equal(light.theme,'light');
  assert.equal(dark.theme,'dark');
  assert.notDeepEqual(light,dark);
  assert.equal((await stat(t.file)).mtimeMs,mtime);
  assert.equal(await t.disk(),crlfStored(expected));
  record.metrics.themes={light,dark};
  record.metrics.dialogs=await dialogStats(t);
  await assertNoVisibleFailure(t);
});

function makeLongDocument(chars){
  const unit='正文 **格式** 与 [参考](https://example.com) English mixed，保留精确源文本。\r\n';
  let value='\ufeff# 长文写作中文测试\r\n\r\n';
  while(value.length<chars)value+=unit;
    value+='\r\n末尾标记 tail-anchor。\r\n';
  return value;
}

for(const [label,chars] of [['small-5k',5_000],['medium-200k',200_000],['large-1m',1_000_000]]){
  await R.run(`C-${label}-cold-warm-stable-edit-search-undo-save-reopen`,async(stage,own,record)=>{
    const raw=makeLongDocument(chars);
    const cold=Date.now();
    stage('cold-first-open');
    let t=await launchApp({raw,name:`长文-${label}.md`});await own(t,{reset:true});
    await installDialogs(t);
    record.metrics.coldFirstMs=Date.now()-cold;
    record.metrics.rawCharacters=raw.length;

    stage('warm-reload');
    const warm=Date.now();
    await t.page.reload();
    await own(t,{reset:true});
    await expect(t.page.locator('#filename')).toHaveText(`长文-${label}.md`,{timeout:60000});
    await expect.poll(()=>t.doc(),{timeout:60000}).toBe(normaliseRaw(raw));
    record.metrics.warmMs=Date.now()-warm;

    stage('stable-start-middle-end-edit');
    await t.focus();
    let expected=normaliseRaw(raw);
    assert.equal(await t.doc(),expected);
    const edits=record.metrics.edits=[];
    for(const edit of [
      {name:'start',position:0,text:'开头编辑-中'},
      {name:'middle',position:Math.floor(expected.length/2),text:'中段编辑-English'},
      {name:'end',position:expected.indexOf('末尾标记'),text:'末尾编辑-'},
    ]){
      // A rendered link destination is an atomic/hidden source range. Place
      // the author at nearby visible prose, rather than inside a hidden URL.
      if(edit.name==='middle')edit.position=expected.indexOf('English mixed',Math.floor(expected.length/2));
      if(edit.name==='end')edit.position=expected.indexOf('末尾标记');
      const begin=Date.now();
      stage(`stable-${edit.name}-select-visible-prose`);
      await t.page.locator('.cm-content').evaluate((element,position)=>{
        const view=element.cmTile.root.view;
        view.dispatch({selection:{anchor:position},scrollIntoView:true});view.focus();
      },edit.position);
      const caretSamples=await t.page.locator('.cm-content').evaluate(element=>new Promise(resolve=>{
        const view=element.cmTile.root.view;
        const samples=[];
        const measure=()=>view.requestMeasure({read:()=>{
          const rect=view.coordsAtPos(view.state.selection.main.head),viewport=view.scrollDOM.getBoundingClientRect();
          return {rect:rect&&{top:rect.top,bottom:rect.bottom},viewport:{top:viewport.top,bottom:viewport.bottom},scrollTop:view.scrollDOM.scrollTop};
        },write:sample=>{
          samples.push(sample);
          // CM applies its scroll target after measure writes. Sample again on
          // the next cycle; the first read is not a post-scroll observation.
          if(samples.length===1)requestAnimationFrame(measure);else resolve(samples);
        }});
        measure();
      }));
      const caret=caretSamples.at(-1);
      record.metrics.pendingEdit={...edit,caretSamples};
      assert.ok(caret.rect && caret.rect.bottom>=caret.viewport.top && caret.rect.top<=caret.viewport.bottom,'long-document caret must be in the rendered viewport');
      assert.equal((await t.state()).anchor,edit.position,'prepared cursor must match the visible prose target');
      stage(`stable-${edit.name}-insert`);
      await t.page.keyboard.insertText(edit.text);
      edits.push({name:edit.name,ms:Date.now()-begin,position:edit.position,length:edit.text.length,caret,caretSamples});
      expected=expected.slice(0,edit.position)+edit.text+expected.slice(edit.position);
      stage(`stable-${edit.name}-assert-exact-document`);
      assert.equal(await t.doc(),expected);
    }

    stage('stable-selection-search-scroll');
    const selectStart=Date.now();
    const middle=expected.indexOf('中段编辑-English');
    await t.select(middle,middle+'中段编辑'.length);
    const selected=await t.state();
    assert.equal(selected.head-selected.anchor,'中段编辑'.length);
    const selectMs=Date.now()-selectStart;

    const searchStart=Date.now();
    await t.page.getByRole('button',{name:'查找'}).click();
    const panel=t.page.locator('.cm-search');
    await expect(panel).toBeVisible();
    await panel.getByRole('textbox',{name:'查找',exact:true}).fill('末尾标记');
    await panel.getByRole('button',{name:'下一处',exact:true}).click();
    await panel.getByRole('button',{name:'关闭查找',exact:true}).click();
    const searchMs=Date.now()-searchStart;

    const scrollStart=Date.now();
    const scroll=await t.page.locator('.cm-content').evaluate(element=>{
      const view=element.cmTile.root.view;
      const before=view.scrollDOM.scrollTop;
      view.scrollDOM.scrollTop=Math.max(1,Math.floor(view.scrollDOM.scrollHeight*.45));
      view.requestMeasure();
      return {before,scrollHeight:view.scrollDOM.scrollHeight,clientHeight:view.scrollDOM.clientHeight};
    });
    await sleep(100);
    const afterScroll=await t.page.locator('.cm-content').evaluate(element=>element.cmTile.root.view.scrollDOM.scrollTop);
    assert.ok(scroll.scrollHeight>scroll.clientHeight);
    assert.notEqual(afterScroll,scroll.before);
    const scrollMs=Date.now()-scrollStart;

    stage('stable-undo-redo-save');
    const undoStart=Date.now();
    await t.page.getByRole('button',{name:'撤销'}).click();
    const withoutEnd=expected.replace('末尾编辑-','');
    assert.equal(await t.doc(),withoutEnd);
    const undoMs=Date.now()-undoStart;
    const redoStart=Date.now();
    await t.page.getByRole('button',{name:'重做'}).click();
    assert.equal(await t.doc(),expected);
    const redoMs=Date.now()-redoStart;
    const saveStart=Date.now();
    await t.page.keyboard.press('Control+s');
    const expectedDisk=crlfStored(expected);
    await waitDisk(t,expectedDisk,60000);
    const saveMs=Date.now()-saveStart;

    record.metrics.stable={selection:selectMs,search:searchMs,scroll:scrollMs,undo:undoMs,redo:redoMs,save:saveMs};
    record.metrics.edits=edits;
    record.metrics.scroll={before:scroll.before,after:afterScroll,scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight};

    stage('normal-close-and-session-reopen');
    assert.equal(await closeWindow(t),0);
    const reopenStart=Date.now();
    t=await relaunch(t,t.file,own);
    await installDialogs(t);
    await expect(t.page.locator('#filename')).toHaveText(`长文-${label}.md`,{timeout:90000});
    await expect.poll(()=>t.doc(),{timeout:90000}).toBe(expected);
    assert.equal(await t.disk(),expectedDisk);
    record.metrics.reopenRestoredMs=Date.now()-reopenStart;
    await assertNoVisibleFailure(t);
  });
}

await R.run('D-write-interruption-dialog-switch-close-restart-draft-session',async(stage,own,record)=>{
  stage('fresh-unsaved-document');
  let t=await launchApp({args:[]});await own(t,{reset:true});
  await installDialogs(t);
  await t.page.getByRole('button',{name:'新建'}).click();
  const draftRaw='中断测试：应用内对话框、切换文档和正常关闭都不能丢失这段文字。';
  await t.page.keyboard.type(draftRaw,{delay:0});
  assert.equal(await t.doc(),draftRaw);
  await waitFor(async()=>{
    const files=await draftFiles(t.profile);
    return files.length===1 && (await Promise.all(files.map(async file=>JSON.parse(await readFile(join(t.profile,'recovery',file),'utf8'))))).every(draft=>draft.raw===draftRaw);
  },{message:'complete trailing-debounced draft snapshot'});
  const draftBefore=await Promise.all((await draftFiles(t.profile)).map(file=>readFile(join(t.profile,'recovery',file),'utf8')));

  stage('application-dialog-open-cancel-keeps-selection-focus-draft');
  const word=draftRaw.indexOf('对话框');
  await t.select(word,word+'对话框'.length);
  const linkControl=t.page.locator('#format [data-format="link"]');
  assert.equal(await visibleControlLabel(linkControl),'插入链接');
  await linkControl.click();
  await expect(t.page.locator('#insert-dialog')).toBeVisible();
  assert.equal(await t.page.evaluate(()=>document.activeElement?.id),'insert-target');
  await t.page.keyboard.press('Escape');
  await expect(t.page.locator('#insert-dialog')).toBeHidden();
  const afterDialog=await t.state();
  assert.deepEqual([afterDialog.anchor,afterDialog.head],[word,word+'对话框'.length]);
  assert.equal(afterDialog.focus,true);
  assert.equal(await t.doc(),draftRaw);
  assert.deepEqual(
    await Promise.all((await draftFiles(t.profile)).map(file=>readFile(join(t.profile,'recovery',file),'utf8'))),
    draftBefore,
  );

  stage('switch-document-guard-cancel');
  const other=join(t.dir,'另一篇.md');
  await writeFile(other,'另一篇原文\n');
  await choose(t,'open',{canceled:false,filePaths:[other]});
  await choose(t,'confirm',{response:1});
  const switchBefore=(await dialogStats(t)).nativeConfirm;
  await t.page.getByRole('button',{name:'打开'}).click();
  await expect.poll(async()=>(await dialogStats(t)).nativeConfirm).toBeGreaterThan(switchBefore);
  assert.equal(await t.page.locator('#filename').textContent(),'未命名.md ·');
  assert.equal(await t.doc(),draftRaw);

  stage('discard-guard-then-fresh-unsaved-session');
  const confirmBeforeNew=(await dialogStats(t)).nativeConfirm;
  await choose(t,'confirm',{response:2});
  const newBefore=(await dialogStats(t)).nativeConfirm;
  await t.page.getByRole('button',{name:'新建'}).click();
  await expect.poll(async()=>(await dialogStats(t)).nativeConfirm).toBeGreaterThan(newBefore);
  assert.ok((await dialogStats(t)).nativeConfirm>confirmBeforeNew);
  await expect(t.page.locator('#filename')).toHaveText('未命名.md');
  await t.page.keyboard.type(draftRaw,{delay:0});
  await waitFor(async()=>(await draftFiles(t.profile)).length>0,{message:'fresh recoverable draft'});

  stage('normal-window-close-cancel-keeps-app-and-draft');
  await choose(t,'confirm',{response:1});
  const closeBefore=(await dialogStats(t)).nativeConfirm;
  await t.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await expect.poll(async()=>(await dialogStats(t)).nativeConfirm).toBeGreaterThan(closeBefore);
  assert.equal(await t.page.isClosed(),false);
  assert.equal(await t.doc(),draftRaw);
  assert.equal((await draftFiles(t.profile)).length,1);

  stage('explicit-save-close-reopen-session');
  const saved=join(t.dir,'中断恢复.md');
  bindDisk(t,saved);
  await choose(t,'save',{canceled:false,filePath:saved});
  const saveBefore=(await dialogStats(t)).nativeSave;
  await t.page.getByRole('button',{name:'保存'}).click();
  await waitDisk(t,draftRaw);
  const dialogs=await dialogStats(t);
  record.metrics.qaDialogStub=dialogs;
  record.metrics.appModalOpened=true;
  assert.equal(dialogs.nativeOpen,0,'cancelled guard must not open a file picker');
  assert.equal(dialogs.nativeSave,saveBefore+1);
  assert.equal(dialogs.calls.filter(call=>call.type==='confirm').length,dialogs.nativeConfirm);
  assert.equal(await closeWindow(t),0);
  t=await relaunch(t,saved,own);
  await installDialogs(t);
  await expect(t.page.locator('#filename')).toHaveText('中断恢复.md',{timeout:30000});
  assert.equal(await t.doc(),draftRaw);
  assert.equal(await t.disk(),draftRaw);
  assert.equal(await t.page.locator('#recovery').isVisible(),false);
  record.metrics.rendererFocusSimulation='hidden-main.cjs native windows hidden; CDP renderer focus emulation only';
  record.metrics.osCrossApplicationSwitch='UNVERIFIED';
  record.metrics.dialogBoundary='File, save, and confirm results are QA-stubbed call counts and return values. They are not native Windows dialog UX evidence.';
  await assertNoVisibleFailure(t);
});

await R.run('E-visible-ui-new-format-link-undo-save-recovery-path',async(stage,own,record)=>{
  stage('fresh-profile-visible-new');
  let t=await launchApp({args:[]});await own(t,{reset:true});
  await installDialogs(t);
  const path=[];
  await t.page.getByRole('button',{name:'新建'}).click();path.push('可见按钮：新建');
  await t.page.locator('.cm-content').click();
  await t.page.keyboard.type('第一行需要加粗\n第二行需要成为列表\n第三行项目主页',{delay:0});
  path.push('编辑器：输入三行文字');

  stage('visible-bold-list-link-actions');
  let doc='第一行需要加粗\n第二行需要成为列表\n第三行项目主页';
  assert.equal(await t.doc(),doc);
  let from=doc.indexOf('加粗');
  await t.select(from,from+'加粗'.length);
  const boldControl=t.page.locator('#format [data-format="bold"]');
  assert.equal(await visibleControlLabel(boldControl),'粗体');
  await boldControl.click();path.push('可见按钮：粗体');
  doc=await t.doc();
  assert.match(doc,/第一行需要\*\*加粗\*\*/);
  assert.ok(!doc.includes('**第一行需要加粗**'),'only the selected bold range is wrapped');

  from=doc.indexOf('第二行需要成为列表');
  await t.select(from,from+'第二行需要成为列表'.length);
  const listControl=t.page.locator('#format [data-format="list"]');
  assert.match(await visibleControlLabel(listControl),/^无序列表(?: ·|$)/);
  assert.equal((await listControl.textContent()).trim(),'列表');
  await listControl.click();path.push('可见按钮：列表');
  doc=await t.doc();
  assert.match(doc,/- 第二行需要成为列表/);

  from=doc.indexOf('第三行项目主页');
  await t.select(from,from+'第三行项目主页'.length);
  const linkControl=t.page.locator('#format [data-format="link"]');
  assert.equal(await visibleControlLabel(linkControl),'插入链接');
  await linkControl.click();path.push('可见按钮：插入链接');
  await t.page.locator('#insert-target').fill('https://example.com');
  await t.page.locator('#insert-submit').click();path.push('链接对话框：填写地址并插入');
  doc=await t.doc();
  assert.ok(doc.includes('[第三行项目主页](https://example.com)'));

  stage('visible-undo-save');
  await t.page.getByRole('button',{name:'撤销'}).click();path.push('可见按钮：撤销');
  assert.equal(await t.doc(),'第一行需要**加粗**\n- 第二行需要成为列表\n第三行项目主页');
  const file=join(t.dir,'新用户路径.md');
  bindDisk(t,file);
  await choose(t,'save',{canceled:false,filePath:file});
  await t.page.getByRole('button',{name:'保存'}).click();path.push('可见按钮：保存');
  const savedDoc='第一行需要**加粗**\n- 第二行需要成为列表\n第三行项目主页';
  assert.equal(await t.doc(),savedDoc);
  await waitDisk(t,savedDoc);

  stage('create-draft-for-visible-recovery');
  await t.page.getByRole('button',{name:'新建'}).click();path.push('可见按钮：新建草稿');
  await t.page.locator('.cm-content').click();
  const recoverText='找回这段未保存的记录';
  await t.page.keyboard.type(recoverText,{delay:0});path.push('编辑器：输入待找回内容');
  await waitFor(async()=>{
    const files=await draftFiles(t.profile);
    return files.length===1 && (await Promise.all(files.map(async file=>JSON.parse(await readFile(join(t.profile,'recovery',file),'utf8'))))).every(draft=>draft.raw===recoverText);
  },{message:'complete recoverable draft'});
  await snapshotActions(t);
  execFileSync('taskkill',['/PID',String(t.app.process().pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
  await sleep(800);

  stage('visible-recovery-after-restart');
  t=await launchApp({keepDir:t.dir,profile:t.profile,args:[]});await own(t,{reset:true});
  bindDisk(t,file);
  await installDialogs(t);
  const recovery=t.page.getByRole('dialog',{name:'恢复未保存的草稿'});
  await expect(recovery).toBeVisible({timeout:15000});
  await recovery.getByRole('button',{name:'恢复',exact:true}).click();path.push('恢复对话框：恢复');
  await expect(recovery).toBeHidden();
  assert.equal(await t.doc(),recoverText);
  await assertNoVisibleFailure(t);
  record.metrics.visibleTaskPath=path;
  record.metrics.taskCompleted=true;
  record.metrics.learningCost='UNVERIFIED: automated path visibility does not establish new-user comprehension.';
});

await R.finish();
