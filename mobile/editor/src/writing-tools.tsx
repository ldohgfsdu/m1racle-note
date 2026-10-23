import {useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';
import {EditorState,Transaction,type TransactionSpec} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {isolateHistory,undo} from '@codemirror/commands';
import {activeFormat,formatPlan,insertion,tableInsertion} from '../../../editor/src/formatting.mjs';
import {explicitLinkAt,linkEditPlan,webDestination} from '../../../editor/src/link-editing.mjs';

type Context={view:EditorView|null;generation:number;revision:number};
type Pending={view:EditorView;generation:number;revision:number;state:EditorState};
export function createWritingController(context:()=>Context,openWeb:(url:string)=>void){
 const listeners=new Set<()=>void>();let version=0,frame=0;
 const notify=()=>{if(frame)return;frame=requestAnimationFrame(()=>{frame=0;version++;for(const listener of listeners)listener();});};
 const capture=():Pending=>{const c=context();if(!c.view)throw new Error('请先打开笔记。');if(c.view.state.readOnly)throw new Error('当前文档只读，不能修改。');if(c.view.composing)throw new Error('请先确认输入法候选词，再设置格式。');return {view:c.view,generation:c.generation,revision:c.revision,state:c.view.state};};
 const validate=(p:Pending)=>{const c=capture();if(c.view!==p.view||c.generation!==p.generation||c.revision!==p.revision||c.state.doc!==p.state.doc)throw new Error('文档已变化，请重新选择文字后操作。');return c.view;};
 const commit=(p:Pending,plan:TransactionSpec)=>{const view=validate(p);view.dispatch({...plan,annotations:[isolateHistory.of('full'),Transaction.userEvent.of('input.format')],scrollIntoView:true});view.focus();notify();};
 return {
  notify,capture,version:()=>version,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
  generation:()=>context().generation,
  readOnly:()=>!context().view||Boolean(context().view?.state.readOnly),
  active:(type:string)=>{try{const v=context().view;return !!v&&activeFormat(v.state,type);}catch{return false;}},
  selected:(p:Pending)=>p.state.sliceDoc(p.state.selection.main.from,p.state.selection.main.to),
  link:(p:Pending)=>explicitLinkAt(p.state),
  editLink:(values:{label:string;target:string},p:Pending)=>{const view=validate(p),link=explicitLinkAt(p.state);if(!link||link.kind!=='inline')throw new Error('这种链接请在源码中修改。');const plan=linkEditPlan(p.state,link,values);if(plan.changes.length)commit(p,plan);else view.focus();},
  openLink:(p:Pending)=>{validate(p);const link=explicitLinkAt(p.state);if(!link||link.kind!=='inline')throw new Error('这种链接请在源码中查看网址。');openWeb(webDestination(link.target));},
  format:(type:string,p=capture())=>{validate(p);const plan=formatPlan(p.state,type);if(plan)commit(p,plan as TransactionSpec);},
  undo:()=>{const p=capture();undo(p.view);p.view.focus();notify();},
  insert:(type:string,values:{label?:string;target?:string;language?:string},p:Pending)=>{
   validate(p);if(p.state.selection.ranges.length!==1)throw new Error('请先选择一处插入位置。');
   if(type==='table'){commit(p,tableInsertion(p.state));return;}
   const {from,to}=p.state.selection.main;
   if(type==='rule'){
    const before=p.state.sliceDoc(Math.max(0,to-2),to),after=p.state.sliceDoc(to,to+2);
    const prefix=to===0||before.endsWith('\n\n')?'':before.endsWith('\n')?'\n':'\n\n',suffix=after.startsWith('\n\n')?'':after.startsWith('\n')?'\n':'\n\n';
    commit(p,{changes:{from:to,insert:prefix+'---'+suffix},selection:{anchor:to+prefix.length+3+suffix.length}});return;
   }
   if(type==='link'){
    webDestination(values.target??'');
   }
   let {prefix,text,suffix}=insertion(type,values,p.state.sliceDoc(from,to));
   if(type==='fence'){
    const before=p.state.sliceDoc(Math.max(0,from-2),from),after=p.state.sliceDoc(to,to+2);
    prefix=(from===0||before.endsWith('\n\n')?'':before.endsWith('\n')?'\n':'\n\n')+prefix;
    suffix+=to===p.state.doc.length||after.startsWith('\n\n')?'':after.startsWith('\n')?'\n':'\n\n';
   }
   commit(p,{changes:{from,to,insert:prefix+text+suffix},selection:{anchor:from+prefix.length,head:from+prefix.length+text.length}});
  },
 };
}
type Controller=ReturnType<typeof createWritingController>;
const formats=[['heading-0','正文'],['heading-1','一级标题'],['heading-2','二级标题'],['heading-3','三级标题'],['heading-4','四级标题'],['heading-5','五级标题'],['heading-6','六级标题'],['italic','斜体'],['strike','删除线'],['inlinecode','行内代码'],['ordered','编号列表'],['quote','引用']];
export function WritingTools({controller:c,error,busy}:{controller:Controller;error:(message:string)=>void;busy:boolean}){
 useSyncExternalStore(c.subscribe,c.version);const generation=c.generation();
 const [panel,setPanel]=useState<null|'format'|'insert'|'link'|'edit-link'|'fence'>(null),[pending,setPending]=useState<Pending|null>(null),[existing,setExisting]=useState<ReturnType<typeof explicitLinkAt>>(null),[message,setMessage]=useState(''),[label,setLabel]=useState(''),[target,setTarget]=useState(''),[language,setLanguage]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),focusAfterClose=useRef<Pending|null>(null),formComposing=useRef(false);
 useLayoutEffect(()=>{
  // Some embedded Android WebViews compute dvh as zero even while their
  // measured visual viewport is valid. Use that measured height for sheets.
  const viewport=window.visualViewport,measure=()=>document.documentElement.style.setProperty('--writing-viewport-height',Math.max(1,viewport?.height??innerHeight)+'px');
  measure();viewport?.addEventListener('resize',measure);window.addEventListener('resize',measure);
  return()=>{viewport?.removeEventListener('resize',measure);window.removeEventListener('resize',measure);};
 },[]);
 useLayoutEffect(()=>{setPanel(null);setPending(null);},[generation]);
 useLayoutEffect(()=>{if(panel)dialog.current?.showModal();else if(focusAfterClose.current){const p=focusAfterClose.current;focusAfterClose.current=null;if(p.generation===c.generation())p.view.focus();}},[panel,c]);
 const run=(fn:()=>void)=>{try{fn();}catch(e){error(e instanceof Error?e.message:String(e));}};
 const dismiss=(p:Pending|null)=>{focusAfterClose.current=p;setPanel(null);setPending(null);};
 const close=()=>dismiss(pending);
 const open=(kind:'format'|'insert')=>run(()=>{const p=c.capture(),link=kind==='insert'?c.link(p):null;setPending(p);setExisting(link);setMessage('');setPanel(kind);});
 const choose=(kind:'link'|'fence')=>{if(!pending)return;if(kind==='link'&&existing?.kind==='source'){setMessage('这种链接请在源码中修改，原文保持不变。');return;}formComposing.current=false;setLabel(kind==='link'&&existing?existing.label:c.selected(pending));setTarget(kind==='link'&&existing?existing.target:'');setLanguage('');setMessage('');setPanel(kind==='link'&&existing?.kind==='inline'?'edit-link':kind);};
 const insert=(kind:string)=>{if(!pending||formComposing.current)return;try{if(kind==='edit-link')c.editLink({label,target},pending);else c.insert(kind,{label,target,language},pending);dismiss(pending);}catch(e){setMessage(e instanceof Error?e.message:String(e));}};
 const openSaved=()=>{if(!pending||formComposing.current)return;try{c.openLink(pending);}catch(e){setMessage(e instanceof Error?e.message:String(e));}};
 const disabled=busy||c.readOnly();
 const title=panel==='format'?'标题与格式':panel==='insert'?'插入内容':panel==='edit-link'?'编辑链接':panel==='link'?'插入链接':'插入代码块';
 return <>
  <div className="writing-tools" role="toolbar" aria-label="写作工具栏" onPointerDown={e=>{if((e.target as Element).closest('button'))e.preventDefault();}}>
   <button disabled={disabled} onClick={()=>open('format')}>标题</button>
   <button disabled={disabled} aria-pressed={c.active('bold')} onClick={()=>run(()=>c.format('bold'))}>加粗</button>
   <button disabled={disabled} aria-pressed={c.active('list')} onClick={()=>run(()=>c.format('list'))}>列表</button>
   <button disabled={disabled} aria-pressed={c.active('task')} onClick={()=>run(()=>c.format('task'))}>待办</button>
   <button disabled={disabled} onClick={()=>open('insert')}>插入</button>
   <button disabled={disabled} aria-label="撤销上一步" onClick={()=>run(c.undo)}>撤销</button>
  </div>
  {panel?<dialog ref={dialog} className="writing-sheet" data-form={panel==='link'||panel==='edit-link'||panel==='fence'} aria-label={title} onCancel={e=>{e.preventDefault();close();}}>
   <header><h2>{title}</h2><button aria-label="关闭写作面板" onClick={close}>关闭</button></header>
   {panel==='format'?<div className="writing-grid">{formats.map(([type,name])=><button key={type} aria-pressed={c.active(type)} onClick={()=>{if(pending)try{c.format(type,pending);dismiss(pending);}catch(e){setMessage(e instanceof Error?e.message:String(e));}}}>{name}</button>)}</div>:panel==='insert'?<div className="writing-grid">
    <button onClick={()=>choose('link')}>{existing?.kind==='inline'?'编辑链接':'链接'}</button>{existing?.kind==='inline'?<button onClick={openSaved}>打开网页</button>:null}<button onClick={()=>choose('fence')}>代码块</button><button onClick={()=>insert('rule')}>分隔线</button><button onClick={()=>insert('table')}>表格源码模板</button>
   </div>:<form onCompositionStart={()=>{formComposing.current=true;}} onCompositionEnd={()=>{formComposing.current=false;}} onSubmit={e=>{e.preventDefault();insert(panel);}}>
    <div className="writing-fields">{panel==='link'||panel==='edit-link'?<><label>显示文字<input value={label} readOnly={panel==='edit-link'&&!existing?.editableLabel} onChange={e=>setLabel(e.target.value)} autoComplete="off"/></label><label>网址<input type="url" inputMode="url" value={target} onChange={e=>setTarget(e.target.value)} placeholder="https://example.com" autoComplete="off" spellCheck={false}/></label>{panel==='edit-link'&&!existing?.editableLabel?<p>链接文字含排版，请回到正文直接修改文字；这里可以改网址。</p>:null}</>:<><label>代码语言<input value={language} onChange={e=>setLanguage(e.target.value)} placeholder="例如 python，或留空" autoComplete="off"/></label><p>选中的文字会保留为代码内容。</p></>}</div>
    <div className="writing-form-actions">{panel==='edit-link'?<button type="button" onClick={openSaved}>{target!==existing?.target||label!==existing?.label?'打开原网页':'打开网页'}</button>:null}<button type="button" onClick={close}>取消</button><button type="submit">{panel==='edit-link'?'保存修改':panel==='link'?'插入链接':'插入代码块'}</button></div>
   </form>}
   {panel==='insert'?<p>表格以 Markdown 源码编辑，保留原有选中文字。</p>:null}
   {message?<p role="alert" className="writing-message">{message}</p>:null}
  </dialog>:null}
 </>;
}
