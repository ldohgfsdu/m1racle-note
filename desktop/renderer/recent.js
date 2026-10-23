import {labelRecent,relativeTime,STATUS_HINT} from '../recent-labels.mjs';

// Recent documents dialog. The list comes from the main process (metadata only
// plus a stat-based status); clicking a row asks the app to open that path.
// "更多操作" per row offers one action: remove the record from the list. It only
// edits recent metadata; the document, drafts and the open document stay as is.
export function initRecent(bridge,openPath) {
 const dialog=document.getElementById('recent-dialog'),list=document.getElementById('recent-list'),status=document.getElementById('recent-status');
 let openMenu=null,timer=0;
 const say=text=>{status.textContent=text||'';status.hidden=!text;};
 const closeMenu=restoreFocus=>{
  if(!openMenu)return;
  const {menu,trigger}=openMenu;openMenu=null;
  menu.remove();trigger.setAttribute('aria-expanded','false');
  if(restoreFocus)trigger.focus();
 };
 const refreshTimes=()=>list.querySelectorAll('.recent-time[data-at]').forEach(node=>{node.textContent=relativeTime(Number(node.dataset.at));});
 const rows=()=>[...list.querySelectorAll('.recent-item')];
 const remove=async(entry,title)=>{
  closeMenu(false);
  const index=rows().findIndex(node=>node.dataset.path===entry.path);
  try {
   const items=await bridge.request('recent-remove',{path:entry.path});
   render(Array.isArray(items)?items:[]);
   say(`已从最近文档移除「${title}」，原文件没有改动`);
   const left=rows();
   (left[Math.min(index,left.length-1)] || document.getElementById('recent-close')).focus();
  } catch(error) {
   say('没能移除这条记录，请再试一次');
  }
 };
 const toggleMenu=(entry,title,trigger)=>{
  if(openMenu?.trigger===trigger){closeMenu(true);return;}
  closeMenu(false);
  const menu=document.createElement('div');menu.className='recent-menu';menu.setAttribute('role','menu');
  const item=document.createElement('button');item.type='button';item.setAttribute('role','menuitem');item.className='recent-menu-item';item.textContent='从最近文档移除';
  item.onclick=()=>remove(entry,title);
  menu.append(item);
  menu.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu(true);}else if(event.key==='Tab')closeMenu(false);};
  trigger.parentElement.append(menu);trigger.setAttribute('aria-expanded','true');
  openMenu={menu,trigger};item.focus();
 };
 const render=items=>{
  closeMenu(false);
  list.textContent='';
  if(!items.length) {
   const empty=document.createElement('p');empty.className='recent-empty';empty.textContent='还没有最近打开的文档';
   const actions=document.createElement('div');actions.className='recent-actions';
   const make=(id,label,className)=>{const button=document.createElement('button');button.type='button';button.id=id;button.className=className;button.textContent=label;button.onclick=()=>{dialog.close();document.getElementById(id==='recent-new'?'new':'open').click();};return button;};
   actions.append(make('recent-new','\u65b0\u5efa','recent-primary'),make('recent-open','\u6253\u5f00\u6587\u4ef6',''));
   list.append(empty,actions);return;
  }
  const labels=labelRecent(items);
  items.forEach((entry,index)=>{
   const label=labels[index],unavailable=entry.status!=='ok';
   const wrap=document.createElement('div');wrap.className='recent-row';
   const row=document.createElement('button');row.type='button';row.className='recent-item';
   row.dataset.path=entry.path;row.dataset.status=entry.status;
   row.title=entry.path;
   const name=document.createElement('span');name.className='recent-name';name.textContent=label.shortTitle;
   const time=document.createElement('span');time.className='recent-time';time.dataset.at=String(entry.accessedAt);time.textContent=relativeTime(entry.accessedAt);
   const dir=document.createElement('span');dir.className='recent-dir';dir.textContent=unavailable?(STATUS_HINT[entry.status] || STATUS_HINT.denied):label.hint;
   row.append(name,time,dir);
   row.onclick=async()=>{
    row.disabled=true;
    dialog.close();
    let result={ok:false};
    try { result=await openPath(entry.path); } catch { result={ok:false,status:'denied'}; }
    if(!result.ok && !result.cancelled){
     await show();
     say(result.status==='missing'?'这个文档已不在原位置，没有新建任何文件':'无法打开这个文档，原文件没有改动');
    }
    row.disabled=false;
   };
   row.onkeydown=event=>{
    if(event.key==='Delete'){event.preventDefault();remove(entry,label.title);}
    else if(event.key==='ArrowDown' || event.key==='ArrowUp'){
     const all=rows(),next=all[all.indexOf(row)+(event.key==='ArrowDown'?1:-1)];
     if(next){event.preventDefault();next.focus();}
    }
   };
   const more=document.createElement('button');more.type='button';more.className='recent-more';more.textContent='⋯';
   more.setAttribute('aria-label',`更多操作：${label.title}`);more.setAttribute('aria-haspopup','menu');more.setAttribute('aria-expanded','false');more.title='更多操作';
   more.onclick=()=>toggleMenu(entry,label.title,more);
   wrap.append(row,more);
   list.append(wrap);
  });
 };
 async function show() {
  say('');
  const items=await bridge.request('recent-list').catch(()=>[]);
  render(Array.isArray(items)?items:[]);
  if(!dialog.open)dialog.showModal();
 }
 // Times keep moving while the dialog stays open (re-rendered on each open too).
 dialog.addEventListener('close',()=>{clearInterval(timer);timer=0;closeMenu(false);});
 dialog.addEventListener('cancel',event=>{if(openMenu){event.preventDefault();closeMenu(true);}});
 dialog.addEventListener('click',event=>{if(openMenu && !openMenu.menu.contains(event.target) && event.target!==openMenu.trigger)closeMenu(false);});
 document.getElementById('recent').onclick=async()=>{await show();clearInterval(timer);timer=setInterval(refreshTimes,30000);};
 document.getElementById('recent-close').onclick=()=>dialog.close();
}