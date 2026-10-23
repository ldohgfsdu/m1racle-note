import { useRef, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { inlinePreview, atomicEditorTheme, atomicMarkdownSyntax, highlightMarkdown, readOnlyExtension } from '@atomic-editor/editor';
import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap, undo, redo } from '@codemirror/commands';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { search, searchKeymap, SearchQuery, setSearchQuery, openSearchPanel } from '@codemirror/search';
import { SourceDocument } from '../../../editor/src/source.mjs';
import {createSourceHistory} from '../../../editor/src/source-history.mjs';
import {editorPhrases} from '../../../editor/src/phrases.mjs';
import '../../../design-system/platform/web/m1racle-tokens.css';
import '@atomic-editor/editor/styles.css';
import './style.css';
import './material.css';
import {createWritingController} from './writing-tools';
import { bootUI, library, showEditor, showHome, preferences, setTitle, showError, clearSaveError as dismissSaveError, setBusy, setSourceMode as displaySourceMode, noteTitle, defaultPreferences, type Preferences } from './ui';

type Document = { id: string; markdown: string; path: string; title?:string; theme?: string };
declare global { interface Window { Native?: { postMessage(message: string): void }; M1racle: typeof api; } }
const root = createRoot(document.getElementById('root')!);
let view: EditorView | null = null;
const editable = new Compartment();
const presentation = new Compartment();
const openLink=(url:string)=>requestHost('open-link',{url});
let source = new SourceDocument('');
let id = '', revision = 0, generation = 0;
const writing=createWritingController(()=>({view,generation,revision}),openLink);
const send = (event: object) => window.Native?.postMessage(JSON.stringify(event));
const {rawField,extensions:sourceHistory}=createSourceHistory(()=>source);
const extensions = [...sourceHistory, EditorView.updateListener.of(update => {
  view = update.view;
  if(update.selectionSet||update.docChanged||update.transactions.some(t=>t.reconfigured))writing.notify();
  if (!update.docChanged && update.state.field(rawField)===source.raw) return;
  source.raw = update.state.field(rawField);
  revision++;
  send({ type: 'change', id, revision, markdown: source.raw });
  setTitle(noteTitle(source.raw));
  if(!window.Native) saveBrowserDocument();
})];
function Surface({ doc }: { doc: Document }) {
  const parent = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const editor = new EditorView({ parent: parent.current!, state: EditorState.create({
      doc: source.normalized(), extensions: [history(), drawSelection(), EditorView.lineWrapping,EditorState.phrases.of(editorPhrases),EditorState.allowMultipleSelections.of(true),
        EditorState.transactionFilter.of(transaction => transaction.docChanged && transaction.startState.readOnly ? [] : transaction),
        markdown({base: markdownLanguage, extensions: highlightMarkdown}),
        atomicEditorTheme, atomicMarkdownSyntax, presentation.of(inlinePreview({onLinkClick:openLink})),
        search(), keymap.of([...historyKeymap,...searchKeymap,...markdownKeymap,...defaultKeymap]),
        EditorView.scrollMargins.of(editor=>{
          const banner=document.querySelector('.error-banner');
          const tools=document.querySelector('.writing-tools');
          const top=Math.min(banner?.getBoundingClientRect().top??Infinity,tools?.getBoundingClientRect().top??Infinity);
          return Number.isFinite(top)?{bottom:Math.max(0,editor.scrollDOM.getBoundingClientRect().bottom-top+12)}:{};
        }),
        editable.of([EditorState.readOnly.of(false), EditorView.editable.of(true), readOnlyExtension(false)]),
        ...extensions],
    }) });
    view = editor;
    writing.notify();
    return () => { editor.destroy(); if (view === editor) view = null; };
  }, [doc.id]);
  return <div ref={parent} className="atomic-cm-editor"/>;
}
const api = {
  loadDocument(doc: Document) {
    const started = performance.now();
    id = doc.id; revision = 0; source = new SourceDocument(doc.markdown); view = null;
    const token = ++generation;
    if(doc.theme) api.setTheme(doc.theme);
    showEditor(doc.title??noteTitle(doc.markdown));
    flushSync(() => root.render(<Surface key={token} doc={doc}/>));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token === generation) send({ type: 'loaded', id, milliseconds: performance.now() - started, chars: doc.markdown.length });
    }));
  },
  setTheme(theme: string) { document.documentElement.dataset.theme = theme; },
  setPreferences: preferences,
  setLibrary: library,
  showHome,
  reportError: showError,
  clearSaveError(documentId?:string) { if(!documentId || documentId===id) dismissSaveError(); },
  setBusy,
  setSourceMode(value:boolean) {
    if(!view || view.composing)return false;
    // Reconfigure presentation in the existing editor: source, selection,
    // history, search and the Android file session keep their current state.
    view.dispatch({effects:presentation.reconfigure(value?[]:inlinePreview({onLinkClick:openLink}))});
    displaySourceMode(value);view.focus();return true;
  },
  command(type:string,payload:Record<string,unknown>={}) {requestHost(type,payload);},
  changePreferences(patch:Partial<Preferences>) {const value=preferences(patch);send({type:'preferences',preferences:value});},
  openFile(filename:string) { requestHost('open',{filename}); },
  back() { requestHost('home'); },
  focus() { view?.focus(); },
  undo() { if(view) undo(view); }, redo() { if(view) redo(view); },
  find(query: string) { if(view) { view.dispatch({effects:setSearchQuery.of(new SearchQuery({search:query}))}); openSearchPanel(view); } },
  getSelection() {
    return view?.state.selection.ranges.map(r => ({ from: source.offset(r.from), to: source.offset(r.to) })) ?? [];
  },
  setReadOnly(value: boolean) { view?.dispatch({effects:editable.reconfigure([EditorState.readOnly.of(value), EditorView.editable.of(!value), readOnlyExtension(value)])}); },
  getMarkdown() { return source.raw; },
};
window.M1racle = api;
let browserDocuments:Record<string,{markdown:string;modified:number}>={};
function browserLibrary() { library(Object.entries(browserDocuments).map(([id,n])=>({id,title:noteTitle(n.markdown),preview:n.markdown.split(/\r\n|\n|\r/).filter(l=>l.trim()&&!l.startsWith('#')).join(' ').slice(0,90),modified:n.modified})).sort((a,b)=>b.modified-a.modified)); }
function saveBrowserDocument() {
 if(!browserDocuments[id])return;
 browserDocuments[id]={markdown:source.raw,modified:Date.now()};
 localStorage.setItem('m1racle.notes.v1',JSON.stringify(browserDocuments));
}
function requestHost(type:string,payload:Record<string,unknown>={}) {
 if(window.Native) {
  if(['home','create','open','import','export','save-copy'].includes(type)) {
   view?.contentDOM.blur(); setBusy(true,type==='export'?'正在导出文档':'正在打开文档');
   requestAnimationFrame(()=>{api.setReadOnly(true);send({type,...payload});});
  } else send({type,...payload});
  return;
 }
 if(type==='home'){saveBrowserDocument();browserLibrary();showHome();}
 if(type==='create'){
  const filename=crypto.randomUUID();browserDocuments[filename]={markdown:'',modified:Date.now()};
  api.loadDocument({id:filename,path:`${filename}.md`,markdown:''});saveBrowserDocument();api.focus();
 }
 if(type==='open') { const filename=String(payload.filename);const doc=browserDocuments[filename];if(doc)api.loadDocument({id:filename,path:filename,markdown:doc.markdown}); }
 if(type==='preferences')localStorage.setItem('m1racle.preferences.v1',JSON.stringify(payload.preferences));
 if(type==='open-link'){
  try{const url=new URL(String(payload.url));if(!['http:','https:'].includes(url.protocol))throw new Error('仅支持打开 http 或 https 网页链接。');window.open(url.href,'_blank','noopener,noreferrer');}
  catch(error){showError(error instanceof Error?error.message:'无法打开这个链接。');}
 }
 if(type==='import'){
  const input=document.createElement('input');input.type='file';input.accept='.md,.markdown,text/plain';
  input.onchange=async()=>{const f=input.files?.[0];if(f){const filename=crypto.randomUUID();browserDocuments[filename]={markdown:await f.text(),modified:Date.now()};api.loadDocument({id:filename,path:f.name,markdown:browserDocuments[filename].markdown});saveBrowserDocument();}};input.click();
 }
 if(type==='share'||type==='export'){
  const file=new File([source.raw],`${noteTitle(source.raw)}.md`,{type:'text/markdown'});
  if(type==='share'&&navigator.canShare?.({files:[file]}))navigator.share({files:[file]}).catch(()=>{});
  else{const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 }
}
bootUI({writing,request:requestHost,undo:api.undo,redo:api.redo,find:api.find,focus:api.focus,setSourceMode:api.setSourceMode,revealSelection:()=>{
 if(view) view.dispatch({effects:EditorView.scrollIntoView(view.state.selection.main.head,{y:'nearest'})});
}});
if(window.Native)send({type:'ready'});
else{
 try{browserDocuments=JSON.parse(localStorage.getItem('m1racle.notes.v1')??'{}');preferences(JSON.parse(localStorage.getItem('m1racle.preferences.v1')??JSON.stringify(defaultPreferences)));}catch{browserDocuments={};}
 if(!Object.keys(browserDocuments).length)browserDocuments.welcome={markdown:'# 留一点空间，给思考。\n\n像普通笔记一样写，文件仍然是你的 Markdown。\n\n## 从这里开始\n\n点击这段文字，直接开始编辑。试试 **粗体**、*斜体* 和 `代码`。\n\n- [ ] 写下一个想法\n- [x] 保留对文件的掌控\n\n> 不急着整理所有知识，先把一个想法写清楚。\n',modified:Date.now()};
 browserLibrary();
}

