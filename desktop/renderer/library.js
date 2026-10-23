import './library.css';
import './library-preview-refresh.css';
import {labelRecent,relativeTime} from '../recent-labels.mjs';
import {groupNameKey} from '../library-names.mjs';
import {createLibraryMotion} from './library-motion.js';

const STATUS_TEXT={missing:'原位置已找不到',denied:'无法访问原文件'};
const ERROR_PREFIX=/^Error invoking remote method ['"]document['"]:\s*(?:Error:\s*)?/;
const normalizePath=value=>String(value||'').replaceAll('/','\\').toLowerCase();
const errorMessage=error=>String(error?.message||error||'未知错误').replace(ERROR_PREFIX,'');

function element(tag,className,text) {
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text!==undefined)node.textContent=text;
 return node;
}

function button(className,text,label) {
 const node=element('button',className,text);
 node.type='button';
 if(label)node.setAttribute('aria-label',label);
 return node;
}

function normalizeRecord(value) {
 const result=value && typeof value==='object' && !Array.isArray(value)?value:{};
 return {
  version:1,
  collapsed:result.collapsed===true,
  groups:Array.isArray(result.groups)?result.groups.filter(group=>group&&typeof group.id==='string'&&typeof group.name==='string'):[],
  items:Array.isArray(result.items)?result.items.filter(item=>item&&typeof item.path==='string'):[]
 };
}

function fileLabel(item) {
 const fromMain=String(item.name||'').trim();
 if(fromMain)return fromMain;
 const parts=String(item.path||'').split(/[\\/]/);
 return parts[parts.length-1]||'未命名文档';
}

function fileDir(item) {
 if(typeof item.dir==='string')return item.dir;
 return String(item.path||'').replace(/[\\/][^\\/]*$/,'');
}

export function initLibrary({bridge,openPath,command,getCurrent}) {
 const workspace=document.getElementById('workspace');
 const sidebar=document.getElementById('document-sidebar');
 const toggleButton=document.getElementById('sidebar-toggle');
 if(!workspace||!sidebar||!bridge)throw new Error('文档侧栏缺少所需的页面结构或 bridge');

 let record=normalizeRecord();
 let recentItems=[];
 let view='groups';
 let displayLabels=new Map();
 const pendingGroupFolds=new Map();
 const groupNodes=new Map();
 const motion=createLibraryMotion(sidebar);
 let hasRendered=false;
 let current={path:'',label:'',example:false,dirty:false};
 const readCurrent=value=>({path:String(value?.path||''),label:String(value?.label||''),example:value?.example===true,dirty:value?.dirty===true});
 const updateUnsaved=()=>{unsaved.hidden=Boolean(current.path)||(current.example&&!current.dirty);};
 let destroyed=false;
 let openMenu=null;
 let refreshing=null;
 let refreshRequest=0;
 let appliedRefresh=0;
 let refreshQueued=false;
 let persistentError='';
 let dialogMode='add';
 let dialogGroupId='';
 let toggleQueue=Promise.resolve(),pendingToggles=0,intendedCollapsed=null,noticeTimer=0;

 sidebar.replaceChildren();
 sidebar.className='library-sidebar';
 workspace.classList.add('library-workspace');

 const header=element('div','library-header');
 const heading=element('div','library-heading');
 heading.append(element('h2','library-title','文档'));
 const documentCount=element('span','library-document-count');
 heading.append(documentCount);
 header.append(heading);

 const actions=element('div','library-actions');
 const newButton=button('library-action library-action-primary','新建','新建文档');
 newButton.id='sidebar-new';
 const openButton=button('library-action','打开','打开文档');
 openButton.id='sidebar-open';
 const addGroupButton=button('library-action library-action-quiet','新分组','新建分组');
 addGroupButton.id='sidebar-add-group';
 header.append(actions);
 actions.append(newButton,openButton);

 const searchLabel=element('label','library-search');
 const search=element('input','library-search-input');
 search.type='search';
 search.placeholder='搜索文件名';
 search.autocomplete='off';
 search.spellcheck=false;
 search.setAttribute('aria-label','搜索文件名');
 searchLabel.append(search);

 const unsaved=element('section','library-unsaved');
 unsaved.hidden=true;
 unsaved.innerHTML='<span class="library-unsaved-mark" aria-hidden="true"></span><span class="library-unsaved-copy"><strong>未保存草稿</strong></span>';
 const saveButton=button('library-draft-save','保存','保存草稿');
 saveButton.id='sidebar-save';
 unsaved.append(saveButton);

 const tabs=element('div','library-tabs');
 tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','文档浏览方式');
 const groupsTab=button('library-tab','分组');groupsTab.id='library-groups-tab';
 const recentTab=button('library-tab','最近打开');recentTab.id='library-recent-tab';
 for(const [tab,key] of [[groupsTab,'groups'],[recentTab,'recent']]){
  tab.setAttribute('role','tab');tab.setAttribute('aria-controls',`library-${key}-panel`);
  tab.onclick=()=>selectView(key);
 }
 tabs.append(groupsTab,recentTab);
 tabs.onkeydown=event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();
  const next=event.key==='Home'?'groups':event.key==='End'?'recent':view==='groups'?'recent':'groups';
  selectView(next);(next==='groups'?groupsTab:recentTab).focus();
 };

 const status=element('p','library-status');
 status.id='library-status';
 status.setAttribute('role','status');
 status.setAttribute('aria-live','polite');
 status.hidden=true;
 const notice=element('div','library-notice');
 notice.id='library-notice';notice.setAttribute('role','status');notice.hidden=true;
 document.body.append(notice);

 const scroller=element('div','library-scroller');
 const fixedSection=element('section','library-section library-fixed-section');
 const fixedHeading=element('div','library-section-heading');
 fixedHeading.append(element('h3','library-section-title','常用'),element('span','library-section-count'));
 const fixedGrid=element('div','library-fixed-grid');
 fixedSection.append(fixedHeading,fixedGrid);

 const pinnedSection=element('section','library-section');
 const pinnedHeading=element('div','library-section-heading');
 pinnedHeading.append(element('h3','library-section-title','置顶'),element('span','library-section-count'));
 const pinnedList=element('div','library-list');
 pinnedSection.append(pinnedHeading,pinnedList);

 const groupsSection=element('section','library-section library-groups-section');
 const groupsHeading=element('div','library-section-heading');
 groupsHeading.append(element('h3','library-section-title','我的分组'),element('span','library-section-count'),addGroupButton);
 const groupsHost=element('div','library-groups');
 groupsSection.append(groupsHeading,groupsHost);

 const recentSection=element('section','library-section');
 const recentHeading=element('div','library-section-heading');
 recentHeading.append(element('h3','library-section-title','未分组'),element('span','library-section-count'));
 const recentList=element('div','library-list');
 recentSection.append(recentHeading,recentList);

 const empty=element('div','library-empty');
 empty.innerHTML='<strong>还没有文档入口</strong><p>新建文档或打开本地 Markdown，之后会常驻在这里。</p>';

 const searchEmpty=element('p','library-search-empty','没有找到匹配的文档');
 searchEmpty.setAttribute('role','status');searchEmpty.hidden=true;
 const groupsPanel=element('div','library-panel');groupsPanel.id='library-groups-panel';
 groupsPanel.setAttribute('role','tabpanel');groupsPanel.setAttribute('aria-labelledby',groupsTab.id);
 groupsPanel.append(fixedSection,pinnedSection,groupsSection,recentSection,empty);
 const recentPanel=element('div','library-panel');recentPanel.id='library-recent-panel';
 recentPanel.setAttribute('role','tabpanel');recentPanel.setAttribute('aria-labelledby',recentTab.id);
 const historyList=element('div','library-list library-recent-list');
 const historyEmpty=element('p','library-history-empty','还没有最近打开的文档');
 recentPanel.append(historyList,historyEmpty);
 scroller.append(groupsPanel,recentPanel,searchEmpty);
 sidebar.append(header,searchLabel,tabs,unsaved,status,scroller);

 const dialog=element('dialog','library-dialog');
 dialog.id='library-group-dialog';
 dialog.setAttribute('aria-labelledby','library-group-title');
 const form=element('form');
 form.id='library-group-form';
 const dialogHeading=element('div','dialog-heading');
 const dialogTitle=element('h2','','新建分组');
 dialogTitle.id='library-group-title';
 dialogHeading.append(dialogTitle);
 const field=element('label','library-dialog-field','分组名称');
 const nameInput=element('input');
 nameInput.id='library-group-name';
 nameInput.name='name';
 nameInput.type='text';
 nameInput.maxLength=60;
 nameInput.autocomplete='off';
 nameInput.required=true;
 field.append(nameInput);
 const dialogStatus=element('p','library-dialog-status');
 dialogStatus.setAttribute('role','alert');
 dialogStatus.hidden=true;
 const dialogActions=element('div','library-dialog-actions');
 const cancelButton=button('library-dialog-button','取消');
 const submitButton=button('library-dialog-button library-dialog-submit','创建');
 submitButton.type='submit';
 dialogActions.append(cancelButton,submitButton);
 form.append(dialogHeading,field,dialogStatus,dialogActions);
 dialog.append(form);
 document.body.append(dialog);

 const dismissNotice=()=>{
  clearTimeout(noticeTimer);noticeTimer=0;notice.hidden=true;notice.textContent='';
 };
 const announce=(text,tone='',persistent=false)=>{
  if(text&&tone!=='error'&&!persistent){
   dismissNotice();notice.dataset.tone='success';notice.textContent=text;notice.hidden=false;
   noticeTimer=setTimeout(dismissNotice,2600);
   return;
  }
  if(notice.dataset.tone==='success')dismissNotice();
  status.textContent=text||'';
  status.dataset.tone=tone;
  status.hidden=!text;
 };

 const showPersistentError=message=>{
  persistentError=`文档入口未能保存：${errorMessage(message)}`;
  announce(persistentError,'error',true);
 };

 const clearPersistentError=()=>{
  persistentError='';
  if(status.dataset.tone==='error'&&/^文档入口未能保存：/.test(status.textContent)) {
   status.textContent='';status.hidden=true;
  }
 };

 const sayDialog=(text='')=>{
  dialogStatus.textContent=text;
  dialogStatus.hidden=!text;
  nameInput.setAttribute('aria-invalid',String(Boolean(text)));
 };

 const closeMenu=restoreFocus=>{
  if(!openMenu)return;
  const {menu,trigger}=openMenu;
  openMenu=null;
  motion.forget(menu);
  menu.remove();
  trigger.setAttribute('aria-expanded','false');
  if(restoreFocus&&trigger.isConnected)trigger.focus();
 };

 const updateToggle=()=>{
  const collapsed=intendedCollapsed??record.collapsed,open=!collapsed;
  motion.setSidebar(collapsed);
  sidebar.dataset.state=collapsed?'closed':'open';
  toggleButton?.setAttribute('aria-expanded',String(open));
  toggleButton?.setAttribute('aria-label',open?'收起文档侧栏':'展开文档侧栏');
 };

 const activePath=()=>{
  const live=getCurrent?.();
  if(live&&typeof live==='object')current=readCurrent(live);
  return normalizePath(current.path);
};

 const setSelected=path=>{
  const wanted=normalizePath(path);
  sidebar.querySelectorAll('.is-current').forEach(node=>{
   node.classList.remove('is-current');
   node.removeAttribute('aria-current');
  });
  if(!wanted)return;
  sidebar.querySelectorAll('[data-path]').forEach(node=>{
   if(normalizePath(node.dataset.path)!==wanted)return;
   node.classList.add('is-current');
   if(node.classList.contains('library-item'))node.setAttribute('aria-current','page');
  });
 };

 const matchesSearch=item=>{
  const needle=search.value.trim().toLocaleLowerCase();
  if(!needle)return true;
  return `${fileLabel(item)} ${fileDir(item)}`.toLocaleLowerCase().includes(needle);
 };

 const invoke=async(action,success='')=>{
  try {
   await bridge.request('library-update',action);
   const updated=await refresh();
   clearPersistentError();announce('');
   if(success)announce(success);
   return updated;
  } catch(error) {
   if(!status.hidden&&status.dataset.tone==='error'&&status.textContent===persistentError) {
    // Keep metadata write failures visible until the next explicit success.
   } else announce(`操作失败：${errorMessage(error)}`,'error');
   throw error;
  }
 };

 const openItem=async item=>{
  if(!item||item.status==='missing') {
   announce('这个文档已不在原位置；原文件没有被改动。','error');
   return;
  }
  if(item.status==='denied') {
   announce('无法访问这个文档；请检查文件权限。','error');
   return;
  }
  try {
   const result=await openPath(item.path);
   if(result?.ok) {
    clearPersistentError();
    setCurrent({path:item.path,label:fileLabel(item)});
   }
   else if(!result?.cancelled)announce('无法打开这个文档；原文件没有改动。','error');
  } catch(error) {
   announce(`无法打开文档：${errorMessage(error)}`,'error');
  }
 };

 const moveSelect=(item)=>{
  const select=element('select','library-move-select');
  select.setAttribute('aria-label',`移至分组：${fileLabel(item)}`);
  const none=element('option','','未分组');
  none.value='__ungrouped__';
  select.append(none);
  for(const group of record.groups) {
   const option=element('option','',group.name);
   option.value=group.id;
   select.append(option);
  }
  select.value=item.groupId===null||item.groupId===undefined?'__ungrouped__':item.groupId;
  select.onchange=async()=>{
   const groupId=select.value==='__ungrouped__'?null:select.value;
   select.disabled=true;
   const group=record.groups.find(candidate=>candidate.id===groupId);
   try {
    await invoke({type:'item-update',path:item.path,groupId},group?`已移至「${group.name}」`:'已移出分组');
   } catch {
    select.value=item.groupId===null||item.groupId===undefined?'__ungrouped__':item.groupId;
    select.disabled=false;
   }
  };
  return select;
 };

 const menuAction=(text,handler,danger=false)=>{
  const action=button(`library-menu-item${danger?' is-danger':''}`,text);
  action.setAttribute('role','menuitem');
  action.onclick=async()=>{
   closeMenu(false);
   try {
    await handler();
   } catch {}
  };
  return action;
 };

 const removeItem=async item=>{
  const label=fileLabel(item);
  try {
   await invoke({type:'item-remove',path:item.path},`已移出「${label}」的侧栏入口；原文件没有改动`);
  } catch {}
 };

 const toggleMenu=(item,trigger)=>{
  if(openMenu?.trigger===trigger) {
   closeMenu(true);
   return;
  }
  closeMenu(false);
  const label=fileLabel(item);
  const menu=element('div','library-menu');
  menu.setAttribute('role','menu');
  menu.setAttribute('aria-label',`${label} 的文档操作`);
  const groupField=element('label','library-menu-field','移至分组');
  groupField.append(moveSelect(item));
  menu.append(
   menuAction(item.pinned?'取消置顶':'置顶',()=>invoke({type:'item-update',path:item.path,pinned:!item.pinned},item.pinned?'已取消置顶':'已置顶')),
   menuAction(item.fixed?'取消固定':'固定到常用',()=>invoke({type:'item-update',path:item.path,fixed:!item.fixed},item.fixed?'已从常用取消固定':'已固定到常用')),
   groupField,
   menuAction('移出文档列表',()=>removeItem(item),true)
  );
  if(view==='recent')menu.append(menuAction('从最近打开移除',async()=>{
   try{
    await bridge.request('recent-remove',{path:item.path});await refresh();
    announce(`已从最近打开移除「${label}」；分组和原文件保留`);
   }catch(error){announce(`无法移除最近记录：${errorMessage(error)}`,'error');}
  }));
  menu.onkeydown=event=>{
   const target=event.target;
   // Native selects consume their own arrows, Home and End before bubbling here.
   if(event.defaultPrevented||(event.key!=='Escape'&&target instanceof HTMLSelectElement))return;
   const moveFocus=(step,edge)=>{
    const items=[...menu.querySelectorAll('[role="menuitem"]')];if(!items.length)return;
    const index=items.indexOf(document.activeElement);
    const next=edge==='first'?0:edge==='last'?items.length-1:index<0?(step>0?0:items.length-1):(index+step+items.length)%items.length;
    items[next].focus();
   };
   if(event.key==='Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeMenu(true);
   } else if(event.key==='Tab'&&!event.shiftKey&&event.target===menu.lastElementChild) {
    closeMenu(false);
   } else if(event.key==='ArrowDown'){
    event.preventDefault();moveFocus(1);
   } else if(event.key==='ArrowUp'){
    event.preventDefault();moveFocus(-1);
   } else if(event.key==='Home'){
    event.preventDefault();moveFocus(0,'first');
   } else if(event.key==='End'){
    event.preventDefault();moveFocus(0,'last');
   }
  };
  document.body.append(menu);
  trigger.setAttribute('aria-expanded','true');
  openMenu={menu,trigger};
  const triggerRect=trigger.getBoundingClientRect();
  const sidebarRect=sidebar.getBoundingClientRect();
  const desiredWidth=Math.min(218,Math.max(160,sidebar.clientWidth-16));
  menu.style.width=`${desiredWidth}px`;
  const menuHeight=menu.offsetHeight;
  const top=triggerRect.bottom+3+menuHeight<=window.innerHeight-8
   ?triggerRect.bottom+3
   :Math.max(8,triggerRect.top-menuHeight-3);
  const left=Math.max(8,Math.min(triggerRect.right-desiredWidth,sidebarRect.right-desiredWidth-8));
  menu.style.top=`${top}px`;
  menu.style.left=`${left}px`;
  motion.enter(menu,'menu');
  menu.querySelector('button')?.focus();
 };

 const itemRow=(item,history=false)=>{
  const row=element('div','library-row');
  const open=button('library-item','',`打开：${fileLabel(item)}`);
  open.dataset.path=item.path;
  open.dataset.status=item.status||'ok';
  open.title=item.path;
  const main=element('span','library-item-main');
  const label=displayLabels.get(normalizePath(item.path));
  const name=element('span','library-item-name',label?.title||fileLabel(item));
  const dir=element('span','library-item-dir');
  if(item.status==='ok'){
   if(history){
    const time=element('span','library-access-time',relativeTime(item.accessedAt));
    time.dataset.at=String(item.accessedAt);time.title=new Date(item.accessedAt).toLocaleString();
    dir.append(time,document.createTextNode(` · ${label?.hint||fileDir(item)}`));
   }else dir.textContent=label?.hint||fileDir(item);
  }else dir.textContent=STATUS_TEXT[item.status]||'无法访问';
  main.append(name,dir);
  const flags=element('span','library-item-flags');
  if(item.pinned)flags.append(element('span','library-flag','置顶'));
  if(item.fixed)flags.append(element('span','library-flag','常用'));
  open.append(main,flags);
  open.onclick=()=>openItem(item);
  const more=button('library-more','⋯',`更多操作：${fileLabel(item)}`);
  more.setAttribute('aria-haspopup','menu');
  more.setAttribute('aria-expanded','false');
  more.onclick=event=>{
   event.stopPropagation();
   toggleMenu(item,more);
  };
  open.oncontextmenu=event=>{event.preventDefault();toggleMenu(item,more);};
  row.append(open,more);
  return row;
 };

 const tile=(item)=>{
  const row=element('div','library-tile-row');
  const node=button('library-tile','',`固定：${fileLabel(item)}`);
  node.dataset.path=item.path;
  node.dataset.status=item.status||'ok';
  node.title=item.path;
  const label=element('span','library-tile-name',displayLabels.get(normalizePath(item.path))?.title||fileLabel(item));
  const hint=element('span','library-tile-hint',item.status==='ok'?(displayLabels.get(normalizePath(item.path))?.hint||fileDir(item)):(STATUS_TEXT[item.status]||'无法访问'));
  const flags=element('span','library-tile-flags');
  if(item.pinned)flags.append(element('span','library-flag','置顶'));
  node.append(label,hint,flags);
  node.onclick=()=>openItem(item);
  const more=button('library-tile-more','⋯',`更多操作：${fileLabel(item)}`);
  more.setAttribute('aria-haspopup','menu');
  more.setAttribute('aria-expanded','false');
  more.onclick=event=>{
   event.stopPropagation();
   toggleMenu(item,more);
  };
  node.oncontextmenu=event=>{event.preventDefault();toggleMenu(item,more);};
  row.append(node,more);
  return row;
 };

 const groupDetails=group=>{
  let details=groupNodes.get(group.id);
  const created=!details;
  if(created){
  details=element('details','library-group');
  details.dataset.groupId=group.id;
  const summary=element('summary','library-group-summary');
  const title=element('span','library-group-name');
  const icon=element('span','library-group-icon');
  icon.setAttribute('aria-hidden','true');
  icon.innerHTML='<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2.5 6V4.5h5l2 2h8v9.5h-15z"/></svg>';
  const count=element('span','library-group-count');
  const groupActions=element('span','library-group-actions');
  const rename=button('library-group-action','','重命名分组');
  rename.innerHTML='<span aria-hidden="true">✎</span>';
  const remove=button('library-group-action','','移除分组');
  remove.innerHTML='<span aria-hidden="true">−</span>';
  groupActions.append(rename,remove);
  summary.append(icon,title,count,groupActions);
  const list=element('div','library-list library-group-list');
  const liveGroup=()=>record.groups.find(candidate=>candidate.id===details.dataset.groupId);
  rename.onclick=event=>{
   event.preventDefault();
   event.stopPropagation();
   const live=liveGroup();if(live)openGroupDialog('rename',live);
  };
  remove.onclick=event=>{
   event.preventDefault();
   event.stopPropagation();
   const live=liveGroup();if(live)removeGroup(live);
  };
  details.append(summary,list);
  summary.addEventListener('click',event=>{
   event.preventDefault();
   if(search.value.trim())return;
   const live=liveGroup();if(!live)return;
   const previous=live.collapsed,change={collapsed:!previous};
   live.collapsed=change.collapsed;
   summary.setAttribute('aria-expanded',String(!change.collapsed));
   motion.fold(details,!change.collapsed);
   pendingGroupFolds.set(live.id,change);
   summary.setAttribute('aria-busy','true');
   // Persist the user's click now. The asynchronous native toggle event can
   // arrive after a search render has already detached these details.
   invoke({type:'group-collapse',id:live.id,collapsed:change.collapsed}).catch(()=>{
    if(pendingGroupFolds.get(live.id)!==change)return;
    pendingGroupFolds.delete(live.id);
    const latest=liveGroup();
    if(latest)latest.collapsed=previous;
    render();
   }).finally(()=>{
    if(pendingGroupFolds.get(live.id)!==change)return;
    pendingGroupFolds.delete(live.id);summary.setAttribute('aria-busy','false');
   });
  });
  groupNodes.set(group.id,details);
  }
  const summary=details.querySelector('summary'),list=details.querySelector('.library-group-list');
  details.hidden=false;
  const title=details.querySelector('.library-group-name'),count=details.querySelector('.library-group-count');
  title.textContent=group.name;title.title=group.name;
  count.textContent=String(record.items.filter(item=>item.groupId===group.id).length);count.title=`${count.textContent} 个文档`;
  const children=record.items.filter(item=>item.groupId===group.id&&matchesSearch(item)).sort((left,right)=>Number(right.pinned)-Number(left.pinned));
  const signature=JSON.stringify(children.map(item=>[item,displayLabels.get(normalizePath(item.path))]));
  if(list.dataset.signature!==signature){
   list.replaceChildren(...children.map(item=>itemRow(item)));
   if(!children.length)list.append(element('p','library-group-empty','暂无文档，可从列表中移入'));
   list.dataset.signature=signature;
  }
  const expanded=Boolean(search.value.trim())||!group.collapsed;
  summary.setAttribute('aria-expanded',String(expanded));
  summary.setAttribute('aria-busy',String(pendingGroupFolds.has(group.id)));
  if(created){details.open=expanded;details.dataset.expanded=String(expanded);}
  else motion.fold(details,expanded,{animate:hasRendered});
  details.hidden=false;
  return details;
 };

 const removeGroup=async group=>{
  try {
   await invoke({type:'group-remove',id:group.id},`已移除分组「${group.name}」；文档入口和原文件都保留`);
  } catch {}
 };

 const renderSection=(section,list,items,renderItem)=>{
  list.replaceChildren();
  if(items.length)for(const item of items)list.append(renderItem(item));
  section.hidden=items.length===0;
  const count=section.querySelector('.library-section-count');
  if(count)count.textContent=String(items.length);
 };

 function render() {
  if(destroyed)return;
  closeMenu(false);
  const metadata=new Map(record.items.map(item=>[normalizePath(item.path),item]));
  const history=recentItems.map(item=>({...metadata.get(normalizePath(item.path)),...item}));
  const all=[...new Map([...record.items,...history].map(item=>[normalizePath(item.path),item])).values()];
  const labels=labelRecent(all.map(item=>({name:fileLabel(item),dir:fileDir(item),path:item.path})),{levels:1,rootFirst:true});
  displayLabels=new Map(all.map((item,index)=>[normalizePath(item.path),labels[index]]));
  const visible=record.items.filter(matchesSearch);
  const fixed=visible.filter(item=>item.fixed);
  const pinned=visible.filter(item=>item.pinned&&!item.fixed);
  const recent=visible.filter(item=>!item.pinned&&!item.fixed&&(item.groupId===null||item.groupId===undefined));
  renderSection(fixedSection,fixedGrid,fixed,tile);
  renderSection(pinnedSection,pinnedList,pinned,itemRow);
  renderSection(recentSection,recentList,recent,item=>itemRow(item));
  const visibleHistory=history.filter(matchesSearch);
  historyList.replaceChildren(...visibleHistory.map(item=>itemRow(item,true)));
  historyEmpty.hidden=Boolean(history.length)||Boolean(search.value.trim());
  groupsPanel.hidden=view!=='groups';recentPanel.hidden=view!=='recent';
  for(const [tab,key] of [[groupsTab,'groups'],[recentTab,'recent']]){
   tab.setAttribute('aria-selected',String(view===key));tab.tabIndex=view===key?0:-1;
  }

  const wanted=new Set(record.groups.map(group=>group.id));
  for(const [id,node] of groupNodes)if(!wanted.has(id)){motion.forget(node);node.remove();groupNodes.delete(id);}
  let visibleGroups=0;
  for(const group of record.groups) {
   const children=visible.filter(item=>item.groupId===group.id);
   if(search.value.trim()&&children.length===0){
    const node=groupNodes.get(group.id);
    if(node){
     motion.forget(node);node.hidden=true;
     const list=node.querySelector('.library-group-list');list.replaceChildren();delete list.dataset.signature;
    }
    continue;
   }
   visibleGroups++;
   const created=!groupNodes.has(group.id),node=groupDetails(group);
   // Keep existing details mounted: replacing them interrupts fold animation and keyboard focus.
   if(!node.isConnected){groupsHost.append(node);if(created&&hasRendered)motion.enter(node);}
  }
  groupsSection.hidden=Boolean(search.value.trim())&&visibleGroups===0;
  groupsSection.querySelector('.library-section-count').textContent=String(record.groups.length);
  empty.hidden=record.items.length>0||Boolean(search.value.trim());
  searchEmpty.hidden=!search.value.trim()||(view==='groups'?visible.length:visibleHistory.length)>0;
  const live=getCurrent?.();
  if(live&&typeof live==='object')current=readCurrent(live);
  updateUnsaved();
  setSelected(activePath());
  documentCount.textContent=String(view==='groups'?record.items.length:history.length);
  documentCount.title=view==='groups'?'侧栏中的文档数量':'最近打开的文档数量（最多 20 个）';
  updateToggle();
  hasRendered=true;
 }

 function setCurrent(value) {
  const next=value&&typeof value==='object'?value:getCurrent?.();
  current=readCurrent(next);
  updateUnsaved();
  setSelected(activePath());
 }

 async function refresh() {
  if(destroyed)return record;
  if(refreshing) {
   refreshQueued=true;
   // A mutation must wait for the queued fresh list, not the older in-flight
   // snapshot; otherwise its success notice can precede the actual new row.
   return refreshing.then(()=>refreshing||record);
  }
  const requestId=++refreshRequest;
  sidebar.dataset.loading='true';
  refreshing=(async()=>{
   try {
    const [list,history]=await Promise.all([bridge.request('library-list'),bridge.request('recent-list')]);
    if(requestId>appliedRefresh) {
     appliedRefresh=requestId;
     record=normalizeRecord(list);
     recentItems=(Array.isArray(history)?history:[]).filter(item=>item&&typeof item.path==='string'&&Number.isFinite(item.accessedAt)).sort((a,b)=>b.accessedAt-a.accessedAt).slice(0,20);
     for(const group of record.groups){const pending=pendingGroupFolds.get(group.id);if(pending)group.collapsed=pending.collapsed;}
     render();
    }
    return record;
   } catch(error) {
    announce(`无法读取文档列表：${errorMessage(error)}`,'error',true);
    throw error;
   } finally {
    refreshing=null;
    if(refreshQueued&&!destroyed) {
     refreshQueued=false;
     refresh().catch(()=>{});
    } else sidebar.dataset.loading='false';
   }
  })();
  return refreshing;
 }

 const openGroupDialog=(mode,group=null)=>{
  if(notice.dataset.tone==='success')dismissNotice();
  dialogMode=mode;
  dialogGroupId=group?.id||'';
  dialogTitle.textContent=mode==='rename'?'重命名分组':'新建分组';
  submitButton.textContent=mode==='rename'?'保存':'创建';
  nameInput.value=group?.name||'';
  sayDialog('');
  if(!dialog.open)dialog.showModal();
  motion.enter(dialog,'dialog');
  requestAnimationFrame(()=>{
   nameInput.focus();
   if(mode==='rename')nameInput.select();
  });
 };

 const toggle=force=>{
  const ownedFocus=sidebar.contains(document.activeElement)||Boolean(openMenu?.menu.contains(document.activeElement));
  closeMenu(false);
  pendingToggles++;toggleButton?.setAttribute('aria-busy','true');
  const operation=toggleQueue.then(async()=>{
   const next=typeof force==='boolean'?force:!(intendedCollapsed??record.collapsed);
   const moveFocus=next&&(ownedFocus||sidebar.contains(document.activeElement));
   intendedCollapsed=next;updateToggle();
   if(moveFocus)toggleButton?.focus();
   try {
    const updated=await bridge.request('library-update',{type:'collapse',collapsed:next});
    record={...record,collapsed:updated?.collapsed??next};
    if(pendingToggles===1)intendedCollapsed=null;
    updateToggle();return !next;
   } catch(error) {
    const message=`已${next?'收起':'展开'}侧栏，但未能记住此状态：${errorMessage(error)}`;
    announce(message,'error',true);
    notice.dataset.tone='error';notice.textContent=message;notice.hidden=false;clearTimeout(noticeTimer);
    noticeTimer=setTimeout(()=>{notice.hidden=true;},6000);
    return !next;
   }
  }).finally(()=>{pendingToggles--;if(!pendingToggles)toggleButton?.setAttribute('aria-busy','false');});
  toggleQueue=operation.catch(()=>{});return operation;
 };

 const runCommand=async type=>{
  try {
   await command(type);
  } catch(error) {
   announce(`文件操作失败：${errorMessage(error)}`,'error');
  }
 };

 function selectView(next){view=next==='recent'?'recent':'groups';render();}

 newButton.onclick=()=>runCommand('new');
 openButton.onclick=()=>runCommand('open');
 addGroupButton.onclick=()=>openGroupDialog('add');
 saveButton.onclick=()=>runCommand('save');
 toggleButton?.addEventListener('click',()=>toggle());
 search.addEventListener('input',render);
 cancelButton.onclick=()=>dialog.close();
 nameInput.addEventListener('input',()=>sayDialog(''));
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(submitButton.disabled)return;
  const name=nameInput.value.trim();
  if(!name) {
   sayDialog('请输入分组名称');
   nameInput.focus();
   return;
  }
  const unchanged=dialogMode==='rename'&&record.groups.find(group=>group.id===dialogGroupId)?.name===name;
  if(!unchanged&&record.groups.some(group=>group.id!==dialogGroupId&&groupNameKey(group.name)===groupNameKey(name))){
   sayDialog('已存在同名分组，请换一个名称');nameInput.focus();return;
  }
  submitButton.disabled=true;
  cancelButton.disabled=true;nameInput.disabled=true;
  sayDialog('');
  try {
   const action=dialogMode==='rename'
    ?{type:'group-rename',id:dialogGroupId,name}
    :{type:'group-add',name};
   const success=dialogMode==='rename'?`分组已更名为「${name}」`:`已新建分组「${name}」`;
   await invoke(action);
   dialog.close();
   announce(success);
  } catch(error) {
   sayDialog(`无法保存分组：${errorMessage(error)}`);
  } finally {
   submitButton.disabled=false;
   cancelButton.disabled=false;nameInput.disabled=false;
   if(dialog.open)nameInput.focus();
  }
 });
 dialog.addEventListener('cancel',event=>{
  event.preventDefault();
  if(submitButton.disabled)return;
  dialog.close();
 });
 dialog.addEventListener('close',()=>{
  sayDialog('');
  dialogMode='add';
  dialogGroupId='';
 });

 const onDocumentPointer=event=>{
  if(openMenu&&!openMenu.menu.contains(event.target)&&event.target!==openMenu.trigger)closeMenu(false);
 };
 const onKeyDown=event=>{
  const shortcut=event.key==='F9'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.shiftKey
   || !event.altKey&&(event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='b';
  if(event.defaultPrevented||event.isComposing||event.keyCode===229||!shortcut)return;
  if(document.querySelector('dialog[open]'))return;
  event.preventDefault();
  toggle();
 };
 const onLibraryChanged=()=>refresh().catch(()=>{});
 const onLibraryError=message=>showPersistentError(message);
 document.addEventListener('pointerdown',onDocumentPointer,true);
 document.addEventListener('keydown',onKeyDown,true);
 bridge.onLibraryChanged?.(onLibraryChanged);
 bridge.onLibraryError?.(onLibraryError);

 const controller={
  refresh,
  setCurrent,
  toggle,
  async showRecent(){selectView('recent');await toggle(false);await refresh();},
  destroy() {
   destroyed=true;
   motion.destroy();groupNodes.clear();
   closeMenu(false);
   dismissNotice();notice.remove();
   document.removeEventListener('pointerdown',onDocumentPointer,true);
   document.removeEventListener('keydown',onKeyDown,true);
   dialog.remove();
  }
 };
 updateToggle();
 setCurrent();
 refresh().catch(()=>{});
 return controller;
}
