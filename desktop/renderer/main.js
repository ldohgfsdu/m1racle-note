import { EditorState } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, placeholder } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, undo, redo, indentWithTab,isolateHistory } from '@codemirror/commands';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { languages } from '@codemirror/language-data';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { SourceDocument } from '../../editor/src/source.mjs';
import {createSourceHistory} from '../../editor/src/source-history.mjs';
import {editorPhrases} from '../../editor/src/phrases.mjs';
import '@atomic-editor/editor/styles.css';
import '../../design-system/platform/web/m1racle-tokens.css';
import './window.css';
import './chrome.css';
import './preview-refresh.css';
import dayFavicon from '../assets/icon-32-day.png';
import nightFavicon from '../assets/icon-32-night.png';
import {surfaceExtension,changeSurface,highlightMarkdown,selectedCode} from './surface.js';
import {initAppearance} from './appearance.js';
import {createDefaultOnboarding} from './onboarding.js';
import {insertion,headingTarget,formatPlan,activeFormat,tableInsertion} from './formatting.js';
import {createInsertDialog} from './insert-dialog.js';
import {initRecovery} from './recovery.js';
import {initMenus} from './menus.js';
import {stylePreview,bindStylePreview,clearStylePreview} from './style-preview.js';
import {initSelectionMenu} from './selection-menu.js';
import {initWritingTools} from './writing-tools.js';
import {renderedBoundaryEdits} from './rendered-input.js';
import {suggestedSaveName} from './save-name.js';
import {initLibrary} from './library.js';
import {initSplitMenu} from './split-menu.js';
import {createPaneMotion} from './pane-motion.js';
import {initPaneDrag} from './pane-drag.js';

const $ = id => document.getElementById(id);
const highlightStyle=HighlightStyle.define([
  {tag:tags.heading,class:'m1-heading-token'},
  {tag:tags.strong,class:'m1-strong-token'}, {tag:tags.emphasis,fontStyle:'italic'},
  {tag:tags.list,class:'m1-list-token'},
  {tag:tags.keyword,color:'var(--keyword)'}, {tag:tags.string,color:'var(--accent)'},
  {tag:[tags.number,tags.bool],color:'var(--number)'}, {tag:tags.comment,color:'var(--muted)'},
  {tag:[tags.link,tags.url],color:'var(--accent)',textDecoration:'underline'},
  {tag:[tags.processingInstruction,tags.typeName,tags.tagName],color:'var(--keyword)'},
  {tag:tags.strikethrough,textDecoration:'line-through'},
]);
const bridge = window.desktop;
const welcome = '# 留一点空间，给思考。\n\n这是 **M1racle Note** 的 Windows 首版。打开你的 Markdown，直接点击文字写作；需要检查原文时，点击右上角的「源码」。\n\n## 阅读，也能认真写作\n\n- 默认显示排版后的文档\n- 点击排版后的文字，直接开始编辑\n- 格式按钮直接修改 Markdown 源码\n\n> 文档只是一个本地 Markdown 文件。你的文字，保持你的格式。\n\n## 常用语法\n\n- **粗体**、*斜体*和 `行内代码`，随手标记重点\n- 插入链接、图片和代码块时，可以填写自己的内容\n- 选中多行文字，一次设置列表、引用或待办\n\n```javascript\nconst thought = "把想法写下来";\nconsole.log(thought);\n```\n\n---\n\n打开文件 **Ctrl+O** · 保存 **Ctrl+S** · 切换模式 **Ctrl+E**\n';

const mainElement=document.querySelector('main');
const paneMotion=createPaneMotion(mainElement);
const panes=[];
const paneNodes=new Map();
let root=null;
let active=null;
let failedPane=null;
let renamingPane=null;
let closing=false;
let paneCounter=0;
let selectionMenu,writingTools,documentLibrary,splitMenu;
let saveFeedbackTimer=0;
function hideSavedFeedback(){clearTimeout(saveFeedbackTimer);$('save-feedback').hidden=true;}
function savedFeedback(pane) {
  const node=$('save-feedback');clearTimeout(saveFeedbackTimer);
  node.textContent=`${pane.dirty?'已保存本次内容，后续修改待保存':'已保存到磁盘'} · ${pane.fileName()}`;node.title=pane.filename;node.hidden=false;
  saveFeedbackTimer=setTimeout(()=>{node.hidden=true;},2500);
}

function report(error,pane) {
  if(error?.saveError)hideSavedFeedback();
  const message=(error?.message || String(error)).replace(/^Error invoking remote method ['"]document['"]:\s*(?:Error:\s*)?/,'');
  $('error-message').textContent=message;$('error').hidden=false;
  if(error?.saveError && (pane || failedPane)){if(pane)failedPane=pane;failedPane.saveFailed=true;failedPane.updateStatus();}
  $('retry-save').hidden=$('error-save-as').hidden=!(failedPane?.saveFailed);
}
function filenameTitle(pane) {
  return pane.filename ? pane.displayName ? `${pane.displayName}（磁盘文件名：${pane.fileName()}）` : pane.filename : pane.displayName ? `首次保存将使用这个名称：${pane.displayName}` : pane.example?'示例文档':'未保存的新文档';
}
function paintChrome() {
  const pane=active;if(!pane?.view)return;
  $('filename').textContent=pane.label+(pane.dirty?' ·':'');
  $('path').textContent=pane.filename || '本地 Markdown · 你的文件，你的格式';
  $('filename').title=filenameTitle(pane);
  $('status').textContent=pane.statusText();
  $('status').dataset.state=pane.saveFailed||pane.draftFailed?'error':pane.dirty?'pending':'saved';
  $('stats').textContent=`${pane.view.state.doc.length.toLocaleString()} 字符 · ${pane.view.state.doc.lines} 行 · ${pane.bom?'UTF-8（BOM）':'UTF-8'}`;
  $('stats').title=pane.bom?'文件编码：UTF-8，含字节顺序标记（BOM）':'文件编码：UTF-8';
  $('read').setAttribute('aria-pressed',String(pane.mode==='read'));
  $('code').setAttribute('aria-pressed',String(pane.mode==='code'));
  $('mode-hint').textContent=pane.mode==='read'?'直接点击文字编辑 · Ctrl+E 源码':'源码编辑 · Ctrl+E 文档';
  updateFormatButtons();
  documentLibrary?.setCurrent({path:pane.filename,label:pane.label,example:pane.example,dirty:pane.dirty});
}
function setActive(pane) {
  if(!pane || pane===active)return;
  active?.section.classList.remove('active');
  active=pane;pane.section.classList.add('active');
  selectionMenu?.hide();writingTools?.refresh();
  paintChrome();
  bridge?.request('pane-focus',{pane:pane.id}).catch(()=>{});
  scheduleSessionReport(true);
}
const activePane=()=>active;

// Session tracking: which document is active and where the user is in it.
// Context only - the Markdown file stays the single source of document bytes.
let sessionTimer=0;
function sessionPayload() {
  const pane=active;
  if(!pane?.view)return null;
  const selection=pane.view.state.selection.main;
  return {path:pane.filename||'',mode:pane.mode,cursor:{anchor:selection.anchor,head:selection.head},scrollTop:Math.round(pane.view.scrollDOM.scrollTop)};
}
function sendSessionReport() {
  sessionTimer=0;
  const payload=sessionPayload();
  if(payload && bridge)bridge.sessionReport(payload);
}
function scheduleSessionReport(immediate=false) {
  clearTimeout(sessionTimer);sessionTimer=0;
  if(immediate){sendSessionReport();return;}
  sessionTimer=setTimeout(sendSessionReport,500);
}
function applySessionPosition(saved) {
  const view=active?.view;
  if(!view || !saved)return;
  const length=view.state.doc.length;
  const clamp=value=>Math.max(0,Math.min(Number.isInteger(value) && value>=0 ? value : 0,length));
  view.dispatch({selection:{anchor:clamp(saved.cursor?.anchor),head:clamp(saved.cursor?.head)}});
  requestAnimationFrame(()=>{
    if(view.destroyed)return;
    const scroller=view.scrollDOM;
    const max=Math.max(0,scroller.scrollHeight-scroller.clientHeight);
    const top=Number.isFinite(saved.scrollTop)?Math.round(saved.scrollTop):0;
    scroller.scrollTop=Math.min(Math.max(0,top),max);
  });
}
async function restoreSession() {
  const saved=await bridge.request('session-get').catch(()=>null);
  if(!saved?.path)return false;
  try {
    const result=await bridge.request('open-recent',{pane:firstPane.id,path:saved.path,restore:true});
    if(result.missing){report(new Error(`上次编辑的文档已不在原位置：${saved.path}`),firstPane);return false;}
    firstPane.load(result);
    if(saved.mode==='code')await firstPane.setMode('code');
    applySessionPosition(saved);
    scheduleSessionReport(true);
    return true;
  } catch(error) {
    const reason=(error?.message || String(error)).replace(/^Error invoking remote method ['"]document['"]:\s*(?:Error:\s*)?/,'');
    report(new Error(`无法打开上次编辑的文档：${saved.path}（${reason}）`),firstPane);
    return false;
  }
}

function openRename() {
  const pane=active,input=$('filename-input');
  if(!pane?.view || !input.hidden)return;
  renamingPane=pane;
  const value=pane.displayName || pane.fileName();
  input.value=value;$('filename').hidden=true;input.hidden=false;input.focus();
  const dot=value.toLowerCase().lastIndexOf('.md');
  input.setSelectionRange(0,dot>0?dot:value.length);
}
function closeRename(commit,refocus=false) {
  const pane=renamingPane,input=$('filename-input');
  renamingPane=null;
  if(!pane || input.hidden)return;
  const value=input.value.trim();
  input.hidden=true;$('filename').hidden=false;
  if(commit && value && value!==(pane.displayName || pane.fileName())) {
    if(/[\\/:*?"<>|\u0000-\u001f]/.test(value))report(new Error('名称不能包含 \\ / : * ? " < > | 等字符。'),pane);
    else{pane.displayName=value;if(!pane.filename)pane.example=false;pane.updateStatus();}
  }
  $('filename').title=filenameTitle(pane);
  if(refocus)pane.focus();
}

function updateFormatButtons() {
  const view=active?.view;if(!view)return;
  for(const button of document.querySelectorAll('[data-format],[data-selection-format]')) {
    const type=button.dataset.format || button.dataset.selectionFormat;
    if(type==='link' || type==='image' || type==='fence' || type==='table')continue;
    const attribute=button.getAttribute('role')?.startsWith('menuitem')?'aria-checked':'aria-pressed';
    try{button.setAttribute(attribute,String(activeFormat(view.state,type)));}catch{button.setAttribute(attribute,'false');}
  }
}
function format(type) {
  clearStylePreview();
  const view=active?.view;
  if(!view || view.composing)return;
  if(view.state.readOnly){report(new Error('当前文档只读，不能应用格式。'),active);return;}
  if(['bold','italic','strike','inlinecode','quote','list','ordered','task'].includes(type) || /^heading-[0-6]$/.test(type)) {
    try {
      const plan=formatPlan(view.state,type);if(!plan)return;
      view.dispatch({changes:plan.changes,selection:plan.selection,annotations:isolateHistory.of('full'),scrollIntoView:true,userEvent:'input.format'});view.focus();
    }catch(error){report(error,active);}
    return;
  }
  if(['link','image','fence','table'].includes(type) && view.state.selection.ranges.length>1){report(new Error('请先保留一个选区，再插入链接、图片、代码块或表格。'),active);return;}
  if(['link','image','fence'].includes(type)){selectionMenu?.hide();openInsert(type,view);return;}
  if(type==='table') {
    try {
      const plan=tableInsertion(view.state);
      view.dispatch({...plan,annotations:isolateHistory.of('full'),scrollIntoView:true,userEvent:'input.format'});view.focus();
    }catch(error){report(error,active);}
  }
}


// QA-only autosave trace. Returns immediately unless a test set the flag
// before the edit. Callers must not hash in an argument: that runs before this
// check. It records private pane fields, not the filename marker.
function noteQaFnv(text) {
  let hash = 0x811c9dc5;
  const value = String(text);
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function noteQaSaveTrace(event, pane, extra) {
  if (globalThis.__noteQaSaveDiag !== true) return;
  try {
    const raw = pane?.source?.raw ?? "";
    const saved = pane?.savedRaw ?? "";
    const view = pane?.view;
    const selection = view?.state?.selection?.main;
    const entry = {
      t: Date.now(),
      event,
      dirty: pane?.dirty === true,
      saveFailed: pane?.saveFailed === true,
      draftFailed: pane?.draftFailed === true,
      hasFilename: !!pane?.filename,
      mode: pane?.mode ?? null,
      status: typeof pane?.statusText === "function" ? pane.statusText() : null,
      composing: view?.composing === true,
      hasTimer: !!pane?.timer,
      rawLength: raw.length,
      rawHashFnv: noteQaFnv(raw),
      savedLength: saved.length,
      savedHashFnv: noteQaFnv(saved),
      docLength: view?.state?.doc?.length ?? null,
      selection: selection ? {empty: selection.empty === true, anchor: selection.anchor, head: selection.head} : null,
      ...(extra || {}),
    };
    const bucket = globalThis.__noteQaSaveTrace || (globalThis.__noteQaSaveTrace = []);
    bucket.push(entry);
    if (bucket.length > 200) bucket.shift();
    console.info("[note-qa-save] " + JSON.stringify(entry));
  } catch {}
}

class Pane {
  constructor(id) {
    this.id=id;
    const section=id==='primary'?$('pane-primary'):$('pane-template').content.firstElementChild.cloneNode(true);
    section.dataset.pane=id;
    this.section=section;
    this.bar=section.querySelector('.pane-bar');
    this.nameEl=section.querySelector('.pane-name');
    this.host=section.querySelector('.pane-editor');
    this.start=section.querySelector('.pane-start');
    this.view=null;this.source=null;    this.filename='';this.displayName='';this.savedRaw='';this.bom=false;
    this.mode='read';this.timer=0;this.busy=false;this.saveQueue=Promise.resolve();
    this.dirty=false;this.example=true;this.saveFailed=false;this.switching=0;this.statusNote='';
    this.compositionWaiters=[];this.draftId='';this.draftTimer=0;this.draftAt=0;this.draftFailed=false;
    this.onLinkClick=url=>this.openLink(url);
    this.sourceHistory=createSourceHistory(()=>this.source);
    section.addEventListener('pointerdown',event=>{setActive(this);if(!event.target.closest('button'))this.focus();},true);
    for(const button of section.querySelectorAll('[data-pane-action]'))button.onclick=()=>{
      if(button.dataset.paneAction==='split-menu')splitMenu.open(button,this);
      else command(button.dataset.paneAction,this);
    };
  }
  get label(){return this.displayName || this.fileName();}
  fileName(){return this.filename.split(/[\\/]/).pop() || (this.example?'欢迎.md':'未命名.md');}
  focus(){this.view?.focus();}
  newDraftId(){return crypto.randomUUID?crypto.randomUUID():`d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;}
  clearDraft(){clearTimeout(this.draftTimer);this.draftTimer=0;this.draftFailed=false;if(this.draftId && bridge)bridge.request('draft-clear',{id:this.draftId}).catch(()=>{});}
  scheduleDraft() {
    clearTimeout(this.draftTimer);this.draftTimer=0;
    if(!bridge || !this.draftId)return;
    if(!this.dirty){this.clearDraft();return;}
    // Trailing debounce, but never later than two seconds after the last
    // snapshot: continuous typing must not starve the recovery copy.
    const wait=this.draftFailed?2000:Date.now()-this.draftAt>2000?0:400;
    this.draftTimer=setTimeout(()=>{if(this.view?.composing){this.draftTimer=0;return;}this.writeDraft();},wait);
  }
  writeDraft() {
    this.draftTimer=0;
    const id=this.draftId,raw=this.source.raw,path=this.filename||'';
    bridge.request('draft-write',{id,path,raw,pane:this.id}).then(()=>{
      this.draftAt=Date.now();
      if(this.draftFailed){this.draftFailed=false;this.updateStatus();}
    }).catch(()=>{
      this.draftAt=Date.now();
      if(this.dirty && !this.draftFailed){this.draftFailed=true;this.updateStatus();}
    });
  }
  paintBar(){
    this.nameEl.textContent=this.label+(this.dirty?' ·':'');this.nameEl.title=filenameTitle(this);
    this.start.hidden=!!this.filename || this.example || this.source.raw.length>0;
  }
  statusText() {
    return this.statusNote || (this.saveFailed?'保存失败 · 内容仍在编辑器中':this.draftFailed?'未能创建恢复副本 · 请尽快保存文件':this.dirty ? this.filename?'待自动保存':'未保存 · Ctrl+S 保存文件' : this.filename ? '已保存' : this.example?'示例文档':'未保存的新文档');
  }
  updateStatus(text) {
    this.statusNote=text || '';
    this.dirty=this.source.raw!==this.savedRaw;
    this.paintBar();
    if(this===active)paintChrome();
  }
  openLink(url) {
    if(url.startsWith('#')) {
      try {
        const position=headingTarget(this.view.state,url);
        if(position===null)throw new Error('未找到这个标题，请检查链接中的标题名称。');
        this.view.dispatch({selection:{anchor:position},effects:EditorView.scrollIntoView(position,{y:'start',yMargin:24})});this.focus();
      }catch(error){report(error,this);}
    }
    else if (/^(https?:|mailto:)/i.test(url)) bridge?.request('open-link',{url}).catch(error=>report(error,this));
    else report(new Error('暂不支持打开这个本地链接，可在源码中查看路径。'),this);
  }
  async setMode(next,reset=false) {
    if(next===this.mode && !reset)return;
    clearStylePreview();selectionMenu?.hide();
    const token=++this.switching;this.mode=next;
    if(reset)this.section.dataset.mode=next==='read'?'rendered':'source';
    if(this===active)paintChrome();
    if(!reset){
      const current=this.view;
      await changeSurface(current,next==='read',this.onLinkClick,()=>token===this.switching && this.view===current);
    }
    if(token!==this.switching)return;
    if(!reset && !matchMedia('(prefers-reduced-motion: reduce)').matches)this.host.animate([{opacity:.7},{opacity:1}],{duration:130,easing:'ease-out'});
    scheduleSessionReport(true);
  }
  load(doc,editing=false) {
    const replacing=!!this.view;
    clearStylePreview();selectionMenu?.hide();writingTools?.reset();
    clearTimeout(this.timer);this.view?.destroy();
    this.filename=doc.path;this.displayName='';this.source=new SourceDocument(doc.raw);this.savedRaw=doc.raw;this.bom=doc.bom===true;
    this.example=doc.example===true;this.saveFailed=false;this.statusNote='';
    this.clearDraft();this.draftId=this.newDraftId();
    this.mount(editing);
    if(replacing)paneMotion.content(this.host);
    scheduleSessionReport(true);
  }
  loadRecovered({draftId,raw,savedRaw,path,bom,targetPath}) {
    clearStylePreview();selectionMenu?.hide();writingTools?.reset();
    clearTimeout(this.timer);this.view?.destroy();
    this.filename=path;this.displayName=path?'':targetPath.split(/[\\/]/).pop() || '未命名.md';
    this.source=new SourceDocument(raw);this.savedRaw=savedRaw;this.bom=bom===true;
    this.example=false;this.saveFailed=false;
    this.clearDraft();this.draftId=draftId;
    this.mount(true);
    this.updateStatus('已恢复未保存的草稿');
  }
  mount(editing) {
    const {rawField,extensions}=this.sourceHistory,onLinkClick=this.onLinkClick;
    this.view=new EditorView({parent:this.host,state:EditorState.create({doc:this.source.normalized(),extensions:[
      ...extensions,stylePreview,EditorState.phrases.of(editorPhrases),
      history(),drawSelection(),highlightActiveLine(),bracketMatching(),EditorView.lineWrapping,EditorState.allowMultipleSelections.of(true),placeholder('从一句话开始，写下第一个想法。'),surfaceExtension(onLinkClick),renderedBoundaryEdits(()=>this.mode==='read'),
      markdown({base:markdownLanguage,codeLanguages:languages,extensions:highlightMarkdown}),syntaxHighlighting(highlightStyle),search(),
      keymap.of([
        {key:'Mod-b',run:()=>{format('bold');return true;}},{key:'Mod-i',run:()=>{format('italic');return true;}},
        ...Array.from({length:7},(_,level)=>({key:`Mod-Alt-${level}`,run:()=>{format(`heading-${level}`);return true;}})),
        {key:'Mod-Shift-7',run:()=>{format('ordered');return true;}},{key:'Mod-Shift-8',run:()=>{format('list');return true;}},
        {key:'Mod-Shift-9',run:()=>{format('quote');return true;}},{key:'Mod-Alt-t',run:()=>{format('task');return true;}},
        ...historyKeymap,...searchKeymap,...markdownKeymap,...defaultKeymap,indentWithTab]),
      EditorView.updateListener.of(update=>{
        if(update.selectionSet || update.docChanged){if(this===active){updateFormatButtons();selectionMenu?.schedule();writingTools?.refresh();}scheduleSessionReport();}
        if(!update.docChanged && update.state.field(rawField)===this.source.raw)return;
        this.source.raw=update.state.field(rawField);this.example=false;this.updateStatus();
        clearTimeout(this.timer);
        if(this.filename && bridge){
          this.timer=setTimeout(()=>{
            noteQaSaveTrace('autosave-fire', this, {via:'edit', delay:550});
            if(this.view?.composing){noteQaSaveTrace('autosave-skip-composing', this, {via:'edit'});this.timer=0;return;}
            this.save().catch(()=>{});
          },550);
          noteQaSaveTrace('autosave-schedule', this, {via:'edit', delay:550});
        } else noteQaSaveTrace('autosave-not-armed', this, {via:'edit', delay:550});
        this.scheduleDraft();
      })
    ]})});
    this.view.contentDOM.addEventListener('focus',()=>setActive(this));
    // Never persist an uncommitted IME preedit: autosave, draft and explicit
    // save wait for composition end, then catch up.
    this.view.contentDOM.addEventListener('compositionend',()=>setTimeout(()=>{
      if(!this.view || this.view.composing){noteQaSaveTrace('compositionend-still-composing', this);return;}
      const waiting=this.compositionWaiters.splice(0);for(const done of waiting)done();
      if(this.dirty){
        if(this.filename && bridge){
          clearTimeout(this.timer);
          this.timer=setTimeout(()=>{noteQaSaveTrace('autosave-fire', this, {via:'compositionend', delay:550});this.save().catch(()=>{});},550);
          noteQaSaveTrace('autosave-schedule', this, {via:'compositionend', delay:550});
        } else noteQaSaveTrace('autosave-not-armed', this, {via:'compositionend', delay:550});
        this.scheduleDraft();
      } else noteQaSaveTrace('compositionend-clean', this);
    },0));
    this.view.scrollDOM.addEventListener('scroll',()=>{if(this===active)scheduleSessionReport();},{passive:true});
    $('error').hidden=true;$('format').hidden=false;this.updateStatus();this.setMode('read',true);writingTools?.refresh();if(editing)this.focus();
  }
  // Resolves true once no composition is active; false if it is still active
  // after limit ms. Callers must NOT persist when it returns false.
  afterComposition(limit=3000) {
    if(!this.view?.composing)return Promise.resolve(true);
    return new Promise(done=>{
      const waiter=()=>{clearTimeout(timer);done(true);};
      const timer=setTimeout(()=>{const at=this.compositionWaiters.indexOf(waiter);if(at>=0)this.compositionWaiters.splice(at,1);done(false);},limit);
      this.compositionWaiters.push(waiter);
    });
  }
  save(as=false) {
    clearTimeout(this.timer);
    const operation=this.saveQueue.then(async()=>{
      noteQaSaveTrace('save-enter', this, {as});
      if(!await this.afterComposition()) {
        noteQaSaveTrace('save-defer-composition', this, {as});
        // Still composing: never write the unconfirmed preedit. Stay dirty and
        // visibly pending; compositionend re-arms the autosave.
        this.updateStatus('输入法组合尚未结束，已暂缓保存');return false;
      }
      const raw=this.source.raw,pending=this.displayName,firstSave=!this.filename;
      if(!bridge)throw new Error('请在 Windows 桌面应用中打开，浏览器预览不保存文件。');
      this.updateStatus('正在保存…');
      const result=await bridge.request(as ? 'save-as' : 'save',{raw,name:pending || (firstSave?suggestedSaveName(raw):undefined),pane:this.id});
      if(!result){this.updateStatus();noteQaSaveTrace('save-result', this, {as, canceled:true});return false;}
      this.filename=result.path;this.savedRaw=raw;this.example=false;this.saveFailed=false;if(firstSave && this.displayName===pending)this.displayName='';$('error').hidden=true;this.clearDraft();this.updateStatus();scheduleSessionReport(true);
      // Gate the hash: this argument is evaluated before noteQaSaveTrace checks the flag.
      const saveResultTrace={as,canceled:false};
      if(globalThis.__noteQaSaveDiag===true && typeof result.raw==='string'){
        saveResultTrace.resultRawLength=result.raw.length;
        saveResultTrace.resultRawHashFnv=noteQaFnv(result.raw);
      }
      noteQaSaveTrace('save-result', this, saveResultTrace);
      return true;
    }).catch(error=>{noteQaSaveTrace('save-catch', this, {as, message:String(error?.message||error), code:error?.code??null, stack:String(error?.stack||'')});error.saveError=true;report(error,this);throw error;});
    this.saveQueue=operation.catch(()=>{});return operation;
  }
  async mayLeave() {
    clearTimeout(this.timer);await this.saveQueue;
    if(!this.dirty)return true;
    const answer=await bridge.request('confirm',{name:this.label});
    if(answer==='discard'){this.clearDraft();return true;}
    return answer==='save' && await this.save() && !this.dirty;
  }
  destroy(){clearTimeout(this.timer);clearTimeout(this.draftTimer);this.view?.destroy();this.view=null;}
}

function nextPaneId(){return 'pane-'+(++paneCounter);}
function createPane(id){const pane=new Pane(id);panes.push(pane);return pane;}
function updateBars(){const multi=panes.length>1;for(const pane of panes)pane.bar.hidden=!multi;}
function applyRatio(split){split.firstSlot.style.flexGrow=split.ratio;split.secondSlot.style.flexGrow=1-split.ratio;}
function bindDivider(split){
  const divider=split.divider;
  const setFromEvent=event=>{
    const rect=split.el.getBoundingClientRect();
    const ratio=split.dir==='row'?(event.clientX-rect.left)/rect.width:(event.clientY-rect.top)/rect.height;
    split.ratio=Math.min(.85,Math.max(.15,ratio));applyRatio(split);
  };
  divider.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    event.preventDefault();paneMotion.stopSplit(split);divider.focus();
    divider.setPointerCapture(event.pointerId);
    const move=moveEvent=>{if(moveEvent.buttons)setFromEvent(moveEvent);};
    const end=()=>{divider.removeEventListener('pointermove',move);divider.removeEventListener('pointerup',end);divider.removeEventListener('pointercancel',end);divider.removeEventListener('lostpointercapture',end);};
    divider.addEventListener('pointermove',move);divider.addEventListener('pointerup',end);divider.addEventListener('pointercancel',end);divider.addEventListener('lostpointercapture',end);
  });
  divider.addEventListener('keydown',event=>{
    const delta=split.dir==='row'?(event.key==='ArrowLeft'?-0.05:event.key==='ArrowRight'?0.05:0):(event.key==='ArrowUp'?-0.05:event.key==='ArrowDown'?0.05:0);
    if(!delta)return;
    event.preventDefault();
    paneMotion.stopSplit(split);
    split.ratio=Math.min(.85,Math.max(.15,split.ratio+delta));applyRatio(split);
  });
}
function moveInto(parent,element,before=null) {
  if(parent.moveBefore && element.isConnected)parent.moveBefore(element,before);
  else parent.insertBefore(element,before);
}
function splitLeaf(node,dir,pane,before=false) {
  const split={type:'split',parent:node.parent,parentSlot:node.parentSlot,dir,ratio:.5};
  split.el=document.createElement('div');split.el.className='split';split.el.dataset.dir=dir;
  split.firstSlot=document.createElement('div');split.firstSlot.className='slot';
  split.secondSlot=document.createElement('div');split.secondSlot.className='slot';
  split.divider=document.createElement('div');split.divider.className='divider';split.divider.tabIndex=0;split.divider.setAttribute('role','separator');split.divider.setAttribute('aria-orientation',dir==='row'?'vertical':'horizontal');
  split.el.append(split.firstSlot,split.divider,split.secondSlot);
  node.parentSlot.append(split.el);
  const branchSlot=before?split.firstSlot:split.secondSlot,existingSlot=before?split.secondSlot:split.firstSlot;
  moveInto(existingSlot,node.el);branchSlot.append(pane.section);
  const branch={type:'pane',pane,parent:split,parentSlot:branchSlot,el:pane.section};
  split.first=before?branch:node;split.second=before?node:branch;
  node.parent=split;node.parentSlot=existingSlot;
  if(split.parent){if(split.parent.first===node)split.parent.first=split;else split.parent.second=split;}
  else root=split;
  paneNodes.set(pane,branch);
  applyRatio(split);bindDivider(split);
  return split;
}
function removeLeaf(node) {
  const parent=node.parent;
  if(!parent)return;
  const sibling=parent.first===node?parent.second:parent.first;
  moveInto(parent.parentSlot,sibling.el,parent.el);parent.el.remove();
  sibling.parent=parent.parent;sibling.parentSlot=parent.parentSlot;
  if(sibling.parent){if(sibling.parent.first===parent)sibling.parent.first=sibling;else sibling.parent.second=sibling;}
  else root=sibling;
}
async function splitPane(pane,dir,openFile=false,before=false) {
  const id=nextPaneId();
  let branch;
  try {
    const result=await bridge.request(openFile?'open':'new',{pane:id});
    if(!result){pane.focus();return;}
    if(openFile){
      const duplicate=panes.find(candidate=>candidate.filename && candidate.filename.toLowerCase()===result.path.toLowerCase());
      if(duplicate){
        setActive(duplicate);duplicate.updateStatus('这个文件已在这一栏打开');duplicate.focus();
        return;
      }
    }
    branch=createPane(id);
    const split=splitLeaf(paneNodes.get(pane),dir,branch,before);
    updateBars();
    branch.load(result,true);
    setActive(branch);
    paneMotion.split(split,branch,before);
  } finally {
    if(!branch)await bridge.request('pane-closed',{pane:id}).catch(()=>{});
  }
}
async function closePane(pane) {
  if(panes.length<2)return;
  if(!await pane.mayLeave())return;
  const before=paneMotion.capture();
  bridge?.request('pane-closed',{pane:pane.id}).catch(()=>{});
  const node=paneNodes.get(pane);
  removeLeaf(node);paneNodes.delete(pane);
  panes.splice(panes.indexOf(pane),1);
  pane.destroy();pane.section.remove();
  if(failedPane===pane){failedPane=null;$('error').hidden=true;}
  updateBars();
  if(active===pane)setActive(panes[panes.length-1]);
  active?.focus();paneMotion.layout(before);
}
function canMovePane(pane) {return !!pane?.view && panes.includes(pane) && !pane.busy && !pane.view.composing;}
function swapPanes(pane,other) {
  if(pane===other || !canMovePane(pane) || !canMovePane(other))return;
  const first=paneNodes.get(pane),second=paneNodes.get(other),before=paneMotion.capture();
  const scroll=[pane,other].map(item=>({pane:item,top:item.view.scrollDOM.scrollTop,left:item.view.scrollDOM.scrollLeft}));
  moveInto(first.parentSlot,other.section,pane.section);moveInto(second.parentSlot,pane.section);
  first.pane=other;first.el=other.section;second.pane=pane;second.el=pane.section;
  paneNodes.set(pane,second);paneNodes.set(other,first);
  setActive(pane);pane.focus();
  for(const item of scroll){item.pane.view.scrollDOM.scrollTop=item.top;item.pane.view.scrollDOM.scrollLeft=item.left;item.pane.view.requestMeasure();}
  paneMotion.layout(before);
  $('pane-layout-status').textContent=`已交换「${pane.label}」与「${other.label}」的位置`;
}
async function closeWindow() {
  for(const pane of [...panes])if(!await pane.mayLeave())return;
  scheduleSessionReport(true);
  bridge.closeReady();
}
async function restoreDraft(draft) {
  const pane=activePane();
  if(!pane)return false;
  if(!await pane.mayLeave())return false;
  try {
    const document=await bridge.request('recover-open',{pane:pane.id,path:draft.path,draftId:draft.id});
    pane.loadRecovered({draftId:draft.id,raw:document.draft?.raw ?? draft.raw,savedRaw:document.raw,path:document.path,bom:document.bom,targetPath:draft.path});
    return true;
  } catch(error) {report(error,pane);return false;}
}
// Select into a temporary session so cancellation, a failed read or switching
// to an already-open file cannot change this editor's save/conflict baseline.
async function openInPane(pane,type='open',payload={}) {
  const id=nextPaneId();
  try {
    const result=await bridge.request(type,{...payload,pane:id,deferRecent:true});
    if(!result){pane.focus();return {ok:false,cancelled:true};}
    if(result.missing){report(new Error(`这个文档已不在原位置：${payload.path}`),pane);return {ok:false,status:'missing'};}
    const duplicate=panes.find(candidate=>candidate.filename && candidate.filename.toLowerCase()===result.path.toLowerCase());
    if(duplicate){
      setActive(duplicate);duplicate.updateStatus('这个文件已在这一栏打开');duplicate.focus();
      return {ok:true};
    }
    if(!await pane.mayLeave()){pane.focus();return {ok:false,cancelled:true};}
    const accepted=await bridge.request('pane-adopt',{pane:pane.id,from:id});
    pane.load(accepted);pane.focus();
    return {ok:true};
  } catch(error) {
    // A failed acceptance after Discard still leaves the original editor here.
    if(pane.dirty)pane.scheduleDraft();
    pane.focus();throw error;
  } finally {
    await bridge.request('pane-closed',{pane:id}).catch(()=>{});
  }
}
// Sidebar and recent-file actions share the same pane and replacement guards.
async function openRecentPath(path) {
  const pane=active;
  if(!pane || pane.busy || !bridge)return {ok:false};
  pane.busy=true;
  try {
    return await openInPane(pane,'open-recent',{path});
  } catch(error) {
    const reason=(error?.message || String(error)).replace(/^Error invoking remote method ['"]document['"]:\s*(?:Error:\s*)?/,'');
    report(new Error(`无法打开这个文档：${path}（${reason}）`),pane);
    return {ok:false,status:'denied'};
  } finally {pane.busy=false;}
}
async function command(type,target,options={}) {
  if(type==='toggle-sidebar'){
    if(!document.querySelector('dialog[open]'))await documentLibrary?.toggle();
    return;
  }
  if(type==='close'){if(closing)return;closing=true;try{await closeWindow();}finally{closing=false;}return;}
  const pane=target || active;
  if(!pane || !panes.includes(pane))return {ok:false,error:'当前没有可用的编辑窗口，请稍后重试。'};
  if(pane.busy)return {ok:false,error:'当前操作尚未完成，请稍后重试。'};
  if(target)setActive(pane);
  if(type==='swap-pane'){swapPanes(pane,panes.find(item=>item.id===options.with));return;}
  // Presentation changes already cancel stale scroll restoration through
  // Pane.switching, just like the read/source buttons. Do not hold the file
  // command lock while waiting for animation frames and lose a second Ctrl+E.
  if(type==='toggle'){
    try{await pane.setMode(pane.mode==='read'?'code':'read');}
    catch(error){report(error,pane);}
    return;
  }
  pane.busy=true;
  try {
    if(type==='default-app'){await onboarding.open();return;}
    if(type==='copy-code') {
      const text=selectedCode(pane.view);if(text===null)throw new Error('先把光标放到代码块里，或选中要复制的内容。');
      await bridge.request('copy-text',{text});pane.updateStatus('已复制');return;
    }
    if(type==='undo' || type==='redo'){(type==='undo'?undo:redo)(pane.view);pane.focus();return;}
    if(type==='save' || type==='save-as'){selectionMenu?.dismiss();hideSavedFeedback();if(await pane.save(type==='save-as')){savedFeedback(pane);if(active===pane)pane.focus();}return;}
    if(!bridge)throw new Error('文件操作仅在 Windows 桌面版本提供。');
    if(type==='new-window' || type==='open-window'){await bridge.request(type);return;}
    if(type==='split-right'){await splitPane(pane,'row');return;}
    if(type==='split-left'){await splitPane(pane,'row',false,true);return;}
    if(type==='split-down'){await splitPane(pane,'column');return;}
    if(type==='split-up'){await splitPane(pane,'column',false,true);return;}
    if(type==='split-open'){await splitPane(pane,'row',true);return;}
    if(type==='split-open-left'){await splitPane(pane,'row',true,true);return;}
    if(type==='split-open-down'){await splitPane(pane,'column',true);return;}
    if(type==='split-open-up'){await splitPane(pane,'column',true,true);return;}
    if(type==='split-close'){await closePane(pane);return;}
    if(type==='open')return await openInPane(pane);
    if(type==='new'){
      if(!await pane.mayLeave()){pane.focus();return {ok:false,cancelled:true};}
      const result=await bridge.request(type,{pane:pane.id});
      if(!result){pane.focus();return {ok:false,cancelled:true};}
      pane.load(result,type==='new');
      pane.focus();
      return {ok:true};
    }
  }catch(error){report(error,pane);return {ok:false,error:type==='open'?'没能打开这篇笔记。文件仍在原处，请重试。':type==='new'?'没能新建笔记，请重试。':error?.message || String(error)};}finally{pane.busy=false;}
}
const openInsert=createInsertDialog((pending,values)=>{
  const view=pending.view;
  if(!view || view.destroyed || pending.document!==view.state.doc)throw new Error('文档已变化，请关闭后重新选择插入位置。');
  let {prefix,text,suffix}=insertion(pending.type,values,pending.selected);
  const {from,to}=pending.selection;
  if(pending.type==='fence') {
    if(from!==view.state.doc.lineAt(from).from)prefix='\n'+prefix;
    if(to!==view.state.doc.lineAt(to).to)suffix+='\n';
  }
  view.dispatch({changes:{from,to,insert:prefix+text+suffix},selection:{anchor:from+prefix.length,head:from+prefix.length+text.length},scrollIntoView:true,userEvent:'input.format'});
  view.focus();
});

for(const type of ['new','open','save','save-as','new-window','open-window','split-right','split-down','split-open','default-app'])$(type).onclick=()=>command(type);
$('filename').onclick=openRename;
$('filename').onkeydown=event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();openRename();}};
const nameInput=$('filename-input');
nameInput.onkeydown=event=>{
  if(event.isComposing || event.keyCode===229)return;
  if(event.key==='Enter'){event.preventDefault();closeRename(true,true);}
  else if(event.key==='Escape'){event.preventDefault();closeRename(false,true);}
};
nameInput.addEventListener('compositionstart',()=>{nameInput.dataset.composing='1';});
nameInput.addEventListener('compositionend',()=>{delete nameInput.dataset.composing;});
nameInput.onblur=()=>{if(!nameInput.dataset.composing)closeRename(true);};
$('read').onclick=()=>active&&active.setMode('read');$('code').onclick=()=>active&&active.setMode('code');
$('format').querySelectorAll('[data-format]').forEach(button=>button.onclick=()=>format(button.dataset.format));
$('selection-menu').querySelectorAll('[data-selection-format]').forEach(button=>button.onclick=()=>format(button.dataset.selectionFormat));
$('undo').onclick=()=>command('undo');$('redo').onclick=()=>command('redo');
$('find').onclick=()=>{const view=active?.view;if(view)openSearchPanel(view);};
$('copy-code').onclick=()=>command('copy-code');
const updateWindowIcon=()=>{
  const root=document.documentElement;
  root.dataset.theme=root.classList.contains('dark')?'dark':'light';
  $('app-icon').href=root.dataset.theme==='dark'?nightFavicon:dayFavicon;
  const tokens=getComputedStyle(root);
  return bridge.request('theme-icon',{
    dark:root.dataset.theme==='dark',
    background:tokens.getPropertyValue('--m1-surface-canvas').trim(),
    foreground:tokens.getPropertyValue('--m1-text-primary').trim(),
  }).catch(report);
};
const storedTheme=()=>{try{return localStorage.getItem('note.theme');}catch{return null;}};
function applyTheme(){const stored=storedTheme();document.documentElement.classList.toggle('dark',stored==='dark' || !stored && matchMedia('(prefers-color-scheme: dark)').matches);updateWindowIcon();}
applyTheme();
$('theme').onclick=()=>{const dark=document.documentElement.classList.toggle('dark');try{localStorage.setItem('note.theme',dark?'dark':'light');}catch{}updateWindowIcon();};
$('retry-save').onclick=()=>command('save',failedPane || active);$('error-save-as').onclick=()=>command('save-as',failedPane || active);$('dismiss-error').onclick=()=>{$('error').hidden=true;};
document.addEventListener('keydown',event=>{
  if(event.defaultPrevented || event.isComposing || event.keyCode===229 || active?.view?.composing || document.querySelector('dialog[open]') || !(event.ctrlKey||event.metaKey) || event.altKey)return;
  if(event.key==='\\' || event.key==='|'){event.preventDefault();command(event.shiftKey?'split-down':'split-right');return;}
  if(event.shiftKey && !['s','n'].includes(event.key.toLowerCase()))return;
  const type={s:event.shiftKey?'save-as':'save',o:'open',n:event.shiftKey?'new-window':'new',e:'toggle'}[event.key.toLowerCase()];
  if(type){event.preventDefault();command(type);}
});
bridge?.onCommand(command);
bridge?.onAssociationError(report);
const onboarding=bridge?createDefaultOnboarding(bridge,{openExisting:()=>command('open'),createNote:()=>command('new'),focusEditor:()=>active?.focus()}):{open:()=>report(new Error('请在桌面软件中设置默认打开方式。'))};
const appearance=initAppearance(()=>{for(const pane of panes)pane.view?.requestMeasure();});
window.addEventListener('storage',event=>{if(event.key!==null && event.key!=='note.theme' && event.key!=='note.appearance')return;if(event.key!=='note.appearance')applyTheme();if(event.key!=='note.theme')appearance.reload();});
window.addEventListener('focus',()=>scheduleSessionReport(true));
initMenus();
splitMenu=initSplitMenu({getActive:activePane,getPanes:()=>[...mainElement.querySelectorAll('.pane')].map(section=>panes.find(pane=>pane.section===section)),canMove:canMovePane,run:command});
initPaneDrag({root:mainElement,getPane:id=>panes.find(pane=>pane.id===id),canMove:canMovePane,swap:(pane,other)=>command('swap-pane',pane,{with:other.id})});
selectionMenu=initSelectionMenu(()=>active?.view,action=>bridge.request('edit-action',{action}),report);
bindStylePreview(()=>active?.view);
writingTools=initWritingTools({getView:()=>active?.view,format,onPrepare:()=>{clearStylePreview();selectionMenu?.hide();}});
const firstPane=createPane('primary');
root={type:'pane',pane:firstPane,parent:null,parentSlot:mainElement,el:firstPane.section};
paneNodes.set(firstPane,root);
updateBars();
setActive(firstPane);
firstPane.load({path:'',raw:welcome,example:true});
const recovery=bridge?initRecovery(bridge,restoreDraft):null;
if(bridge){
 documentLibrary=initLibrary({bridge,openPath:openRecentPath,command,getCurrent:()=>({path:active?.filename||'',label:active?.label||'未命名.md',example:active?.example,dirty:active?.dirty})});
 $('recent').onclick=()=>documentLibrary.showRecent().catch(error=>report(error,active));
}
bridge?.request('initial').then(async doc=>{if(doc)firstPane.load(doc);else await restoreSession();return onboarding.init();}).then(()=>recovery?.()).catch(error=>report(error,firstPane));
