import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import {WritingTools,type createWritingController} from './writing-tools';

export type Note = { id:string; title:string; preview:string; modified:number };
export type Preferences = { theme:'light'|'dark'|'system'; paper:'fluid'|'a4'|'a5'; font:'sans'|'serif'; size:number; leading:number };
export const defaultPreferences:Preferences = {theme:'system',paper:'fluid',font:'sans',size:17,leading:1.8};
type State = {screen:'home'|'editor'; notes:Note[]; title:string; preferences:Preferences; sourceMode:boolean; error:string; saveFailed:boolean; busy:boolean; busyLabel:string};
let state:State={screen:'home',notes:[],title:'未命名笔记',preferences:defaultPreferences,sourceMode:false,error:'',saveFailed:false,busy:false,busyLabel:'正在打开文档'};
const subscribers=new Set<()=>void>();
let lastAppearance='';
let lastAppearanceKey='';
let lastChrome='';
function syncNativeChrome() {
 if(!window.Native)return;
 const chrome=JSON.stringify({type:'chrome',...state,dark:document.documentElement.dataset.theme==='dark'});
 if(chrome!==lastChrome){lastChrome=chrome;window.Native.postMessage(chrome);}
}
function syncAppearance() {
 if(!window.Native)return;
 const dark=document.documentElement.dataset.theme==='dark';
 const role=state.screen==='home'?'--m1-surface-canvas':state.preferences.paper!=='fluid'?'--m1-surface-subtle':'--m1-surface-paper';
 const key=`${dark}:${role}`;
 if(key===lastAppearanceKey)return;
 const background=getComputedStyle(document.documentElement).getPropertyValue(role).trim();
 const appearance=JSON.stringify({type:'appearance',dark,background});
 lastAppearanceKey=key;
 if(appearance!==lastAppearance){lastAppearance=appearance;window.Native?.postMessage(appearance);}
}
function update(patch:Partial<State>) { state={...state,...patch}; subscribers.forEach(f=>f()); document.body.dataset.screen=state.screen; syncAppearance(); syncNativeChrome(); }
export function library(notes:Note[]) { update({notes,busy:false}); }
export function setSourceMode(sourceMode:boolean) { document.body.dataset.mode=sourceMode?'source':'rendered';update({sourceMode}); }
export function showEditor(title:string) { setSourceMode(false);update({screen:'editor',title,busy:false,error:'',saveFailed:false}); }
export function showHome() { update({screen:'home',error:'',saveFailed:false,busy:false}); }
export function setTitle(title:string) { if(title!==state.title) update({title}); }
export function showError(error:string,recoverable=false) { update({error,saveFailed:Boolean(error && recoverable),busy:false}); }
export function clearSaveError() { if(state.saveFailed) update({error:'',saveFailed:false}); }
export function setBusy(busy:boolean,busyLabel='正在打开文档') { update({busy,busyLabel}); }
export function preferences(value:Partial<Preferences>) {
 const p={...state.preferences,...value};
 p.size=Math.min(24,Math.max(14,Number(p.size)||17)); p.leading=Math.min(2.2,Math.max(1.4,Number(p.leading)||1.8));
 if(!['fluid','a4','a5'].includes(p.paper)) p.paper='fluid';
 if(!['system','light','dark'].includes(p.theme)) p.theme='system';
 if(!['sans','serif'].includes(p.font)) p.font='sans';
 const dark=p.theme==='dark'||(p.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
 document.documentElement.dataset.theme=dark?'dark':'light'; document.documentElement.dataset.paper=p.paper;
 document.documentElement.dataset.font=p.font;
 document.documentElement.style.setProperty('--body-size',`${p.size}px`);
 document.documentElement.style.setProperty('--body-leading',String(p.leading));
 update({preferences:p});
 return p;
}
export function noteTitle(markdown:string) {
 for(const line of markdown.replace(/^\uFEFF/,'').matchAll(/[^\r\n]+/g)) {
  if(line[0].trim())return line[0].replace(/^#{1,6}\s+/,'').slice(0,64) || '未命名笔记';
 }
 return '未命名笔记';
}
function noteDate(timestamp:number) {
 const date=new Date(timestamp),today=new Date();
 const yesterday=new Date(today);yesterday.setDate(today.getDate()-1);
 const time=date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
 if(date.toDateString()===today.toDateString())return `今天 ${time}`;
 if(date.toDateString()===yesterday.toDateString())return `昨天 ${time}`;
 return date.toLocaleDateString('zh-CN',{...(date.getFullYear()!==today.getFullYear()?{year:'numeric' as const}:{}),month:'long',day:'numeric'});
}
// A derived list excerpt only; the Markdown source is never rewritten.
function notePreview(text:string) { return text.replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/(^|\s)>\s?/g,'$1').replace(/[*_`~]/g,'').replace(/\s+/g,' ').trim(); }
type Actions={writing:ReturnType<typeof createWritingController>;request:(type:string,payload?:Record<string,unknown>)=>void; undo:()=>void; redo:()=>void; find:(query:string)=>void; focus:()=>void; revealSelection:()=>void; setSourceMode:(value:boolean)=>boolean};
function Icon({name}:{name:string}) {
 const paths:Record<string,React.ReactNode>={
  back:<path d="m14 5-7 7 7 7"/>,plus:<path d="M12 5v14M5 12h14"/>,
  more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  share:<><path d="M12 15V3m-4 4 4-4 4 4M7 11H5v10h14V11h-2"/></>,
  settings:<><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
  search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
  undo:<><path d="m8 4-5 5 5 5M3 9h10a6 6 0 0 1 0 12"/></>,
  redo:<><path d="m16 4 5 5-5 5m5-5H11a6 6 0 0 0 0 12"/></>,
  file:<><path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8M8 16h6"/></>,
  import:<><path d="M4 14v6h16v-6M12 3v12m-5-5 5 5 5-5"/></>,
  export:<><path d="M4 14v6h16v-6M12 15V3m-5 5 5-5 5 5"/></>,
  moon:<path d="M20 14a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z"/>,
  check:<path d="m5 12 4 4L19 6"/>, close:<path d="m6 6 12 12M18 6 6 18"/>,
  code:<><path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/></>,
 };
 return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]??paths.file}</svg>;
}
function App({actions}:{actions:Actions}) {
 const s=useSyncExternalStore(callback=>{subscribers.add(callback);return()=>subscribers.delete(callback);},()=>state);
 const [query,setQuery]=useState(''),[panel,setPanel]=useState<'menu'|'settings'|null>(null);
 const popover=useRef<HTMLDivElement>(null);
 const errorBanner=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const banner=errorBanner.current;
  const measure=()=>{
   const space=banner?Math.max(0,innerHeight-banner.getBoundingClientRect().top+12):0;
   const root=document.documentElement,value=space+'px';
   if(root.style.getPropertyValue('--editor-error-space')===value)return;
   root.style.setProperty('--editor-error-space',value);actions.revealSelection();
  };
  measure();const observer=new ResizeObserver(measure);if(banner)observer.observe(banner);
  window.addEventListener('resize',measure);
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
 },[s.error,s.saveFailed,actions.revealSelection]);
 useEffect(()=>{setPanel(null);},[s.screen]);
 useEffect(()=>{
  if(!panel)return;
  const dismiss=(e:PointerEvent)=>{if(!popover.current?.contains(e.target as Node)&&!(e.target as Element).closest('[data-panel-toggle]'))setPanel(null);};
  const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setPanel(null);};
  document.addEventListener('pointerdown',dismiss);document.addEventListener('keydown',escape);
  return()=>{document.removeEventListener('pointerdown',dismiss);document.removeEventListener('keydown',escape);};
 },[panel]);
 const request=(type:string,payload?:Record<string,unknown>)=>{setPanel(null);actions.request(type,payload);};
 const changePreference=(patch:Partial<Preferences>)=>{preferences(patch);actions.request('preferences',{preferences:state.preferences});};
 const notes=s.notes.filter(n=>`${n.title} ${n.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const command=(fn:()=>void)=>{setPanel(null);fn();};
 return <>
  {s.screen==='home'?<main className="home">
   <header className="home-header"><div><div className="home-brand"><span><strong>M1racle</strong> Note</span></div><h1>笔记</h1></div><button className="glass icon-button" aria-label="首页菜单" data-panel-toggle disabled={s.busy} aria-expanded={panel==='menu'} onClick={()=>setPanel(panel==='menu'?null:'menu')}><Icon name="more"/></button></header>
   <label className="search-field"><Icon name="search"/><input aria-label="搜索笔记" placeholder="搜索笔记" value={query} onChange={e=>setQuery(e.target.value)}/>{query?<button aria-label="清除搜索" onClick={()=>setQuery('')}><Icon name="close"/></button>:null}</label>
   <section className="note-section"><div className="section-label"><h2>{query?'搜索结果':'最近编辑'}</h2><span>{notes.length} 篇</span></div>
   <div className="note-list">{notes.map(note=><button className="note-row" key={note.id} disabled={s.busy} onClick={()=>request('open',{filename:note.id})}>
    <div className="note-copy"><h3>{note.title}</h3><p>{notePreview(note.preview)||'还没有正文'}</p><time dateTime={new Date(note.modified).toISOString()}>{noteDate(note.modified)}</time></div><span className="row-chevron" aria-hidden="true">›</span>
   </button>)}</div>
   {!notes.length?<div className="empty-state"><Icon name={query?'search':'file'}/><h3>{query?'没有找到笔记':'从一个想法开始'}</h3><p>{query?'换个关键词试试。':'轻点 ＋，写下第一篇笔记。'}</p></div>:null}</section>
   <button className="new-note glass" aria-label="新建笔记" disabled={s.busy} onClick={()=>request('create')}><Icon name="plus"/></button>
  </main>:<nav className="editor-chrome" aria-label="文档工具栏">
   <button className="glass icon-button back-button" aria-label="返回首页" disabled={s.busy} onClick={()=>request('home')}><Icon name="back"/></button>
   <span className="toolbar-spacer" aria-hidden="true"/>
   <div className="glass action-capsule"><button className="icon-button" aria-label="撤销" disabled={s.busy} onClick={actions.undo}><Icon name="undo"/></button><button className="icon-button" aria-label="更多菜单" data-panel-toggle disabled={s.busy} aria-expanded={panel==='menu'} onClick={()=>setPanel(panel==='menu'?null:'menu')}><Icon name="more"/></button></div>
  </nav>}
  {panel?<div ref={popover} className={`glass popover ${panel==='settings'?'settings-panel':''}`} role="dialog" aria-label={panel==='settings'?'文档设置':'更多操作'}>
   {panel==='menu'?<>
    {s.screen==='home'?<button className="menu-row" onClick={()=>request('import')}><Icon name="import"/><span>导入 Markdown 副本</span></button>:<>
     <button className="menu-row" onClick={()=>command(()=>actions.find(''))}><Icon name="search"/><span>查找</span><span className="shortcut">⌘ F</span></button>
     <button className="menu-row" disabled={s.busy} aria-pressed={s.sourceMode} onClick={()=>command(()=>actions.setSourceMode(!s.sourceMode))}><Icon name="code"/><span>{s.sourceMode?'返回排版编辑':'显示 Markdown 源码'}</span></button>
     <button className="menu-row" onClick={()=>command(actions.undo)}><Icon name="undo"/><span>撤销</span></button>
     <button className="menu-row" onClick={()=>command(actions.redo)}><Icon name="redo"/><span>重做</span></button>
     <div className="menu-separator"/><button className="menu-row" onClick={()=>request('share')}><Icon name="share"/><span>分享文档</span></button><button className="menu-row" onClick={()=>request('export')}><Icon name="export"/><span>导出 Markdown</span></button>
     <button className="menu-row" onClick={()=>request('import')}><Icon name="import"/><span>导入 Markdown 副本</span></button>
    </>}
    <div className="menu-separator"/><button className="menu-row" onClick={()=>setPanel('settings')}><Icon name="settings"/><span>{s.screen==='home'?'外观设置':'排版与外观'}</span><span className="row-chevron">›</span></button>
   </>:<>
    <div className="panel-heading"><h2>排版与外观</h2><button className="icon-button" aria-label="关闭设置" onClick={()=>setPanel(null)}><Icon name="close"/></button></div>
    <fieldset><legend>纸张尺寸</legend><div className="paper-options">{([['fluid','自适应',''],['a4','A4','210 × 297'],['a5','A5','148 × 210']] as const).map(([value,label,dimensions])=><button aria-pressed={s.preferences.paper===value} className={s.preferences.paper===value?'selected':''} key={value} onClick={()=>changePreference({paper:value})}><span className={`paper-glyph ${value}`}/><strong>{label}</strong>{dimensions?<small>{dimensions} mm</small>:<small>随屏幕调整</small>}</button>)}</div><p className="setting-help">A4 / A5 显示纸张比例，正文连续编辑。</p></fieldset>
    <fieldset><legend>字体</legend><div className="segmented">{([['sans','无衬线'],['serif','宋体']] as const).map(([value,label])=><button className={s.preferences.font===value?'selected':''} aria-pressed={s.preferences.font===value} key={value} onClick={()=>changePreference({font:value})}>{label}</button>)}</div></fieldset>
    <label className="range-setting"><span>字号 <output>{s.preferences.size}</output></span><input aria-label="字号" type="range" min="14" max="24" step="1" value={s.preferences.size} onChange={e=>changePreference({size:Number(e.target.value)})}/></label>
    <label className="range-setting"><span>行距 <output>{s.preferences.leading.toFixed(1)}</output></span><input aria-label="行距" type="range" min="1.4" max="2.2" step="0.1" value={s.preferences.leading} onChange={e=>changePreference({leading:Number(e.target.value)})}/></label>
    <fieldset><legend>外观</legend><div className="segmented">{([['system','自动'],['light','浅色'],['dark','深色']] as const).map(([value,label])=><button className={s.preferences.theme===value?'selected':''} aria-pressed={s.preferences.theme===value} key={value} onClick={()=>changePreference({theme:value})}>{label}</button>)}</div></fieldset>
   </>}
  </div>:null}
  {s.error?<div ref={errorBanner} className="error-banner" role="alert" data-save-failed={s.saveFailed}><span>{s.error}</span>{s.saveFailed?<div className="error-actions"><button disabled={s.busy} onClick={()=>request('retry-save')}>重试保存</button><button disabled={s.busy} onClick={()=>request('save-copy')}>保存副本</button></div>:<button aria-label="关闭提示" onClick={()=>showError('')}><Icon name="close"/></button>}</div>:null}
  {s.screen==='editor'?<WritingTools controller={actions.writing} error={showError} busy={s.busy}/>:null}
  {s.busy?<div className="busy-indicator" role="status" aria-label={s.busyLabel}/>:null}
 </>;
}
export function bootUI(actions:Actions) {
 // The active Android host supplies storage, while this WebView renders chrome.
 // A bridge alone must not hide the home/menu controls before native chrome is wired.
 document.body.dataset.host=window.Native?'android':'browser';
 preferences(defaultPreferences);
 matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(state.preferences.theme==='system')preferences({});});
 createRoot(document.getElementById('app')!).render(<App actions={actions}/>);
}


