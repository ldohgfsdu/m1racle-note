export function initRecovery(bridge,restore) {
 const dialog=document.getElementById('recovery'),list=document.getElementById('recovery-list');
 async function show(drafts) {
  list.textContent='';
  let remaining=drafts.length;
  dialog.showModal();
  const settle=item=>{item.remove();if(--remaining<=0)dialog.close();};
  for(const draft of drafts) {
   const item=document.createElement('div');item.className='recovery-item';
   item.dataset.path=draft.path;
   const name=document.createElement('span');name.className='recovery-name';
   name.textContent=draft.path.split(/[\\/]/).pop() || '未命名文档';
   name.title=draft.path || '未命名文档';
   const time=document.createElement('span');time.className='recovery-time';
   time.textContent=new Date(draft.updatedAt).toLocaleString();
   const actions=document.createElement('div');actions.className='recovery-actions';
   const discard=document.createElement('button');discard.className='recovery-discard';discard.textContent='丢弃';
   const restoreButton=document.createElement('button');restoreButton.className='recovery-restore';restoreButton.textContent='恢复';
   discard.onclick=async()=>{
    discard.disabled=true;
    try{await bridge.request('draft-clear',{id:draft.id});settle(item);}
    catch(error) {
     discard.disabled=false;
     item.dataset.state='error';
     const message=(error?.message || String(error)).replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/,'');
     let hint=item.querySelector('.recovery-hint');
     if(!hint){hint=document.createElement('span');hint.className='recovery-hint';item.append(hint);}
     hint.textContent=message;
    }
   };
   restoreButton.onclick=async()=> {
    restoreButton.disabled=true;
    try {if(await restore(draft)){settle(item);return;}restoreButton.disabled=false;}
    catch{restoreButton.disabled=false;}
   };
   actions.append(discard,restoreButton);
   item.append(name,time,actions);list.append(item);
  }
 }
 return async()=>{
  const drafts=await bridge.request('draft-list');
  if(Array.isArray(drafts) && drafts.length)await show(drafts);
 };
}
