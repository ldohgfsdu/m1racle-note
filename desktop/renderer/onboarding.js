export function createDefaultOnboarding(bridge) {
  const modal=document.getElementById('onboarding'),primary=document.getElementById('onboarding-primary'),skip=document.getElementById('onboarding-skip');
  const description=document.getElementById('onboarding-description'),message=document.getElementById('onboarding-message');
  let awaitingSettings=false,checking=false,complete=false,previousFocus;
  function error(value){message.textContent=value?.message || String(value);message.dataset.error='true';}
  function showState(state) {
    complete=state.md && state.markdown;
    for(const type of ['md','markdown'])document.getElementById(`association-${type}`).textContent=`.${type} · ${state[type]===null?'未确认':state[type]?'已设置':'待设置'}`;
    primary.textContent=complete?'开始使用':awaitingSettings?'继续设置':'前往设置';
    skip.hidden=complete;skip.textContent=awaitingSettings?'先开始使用':'暂时跳过';
    description.textContent=complete?'以后双击 Markdown 文件，就会在这里打开。': '将 M1racle Note 设为默认应用，双击 Markdown 文件就能直接阅读。';
    message.textContent=complete?'已确认默认打开设置。':state.md===null?'暂时无法确认默认应用，你仍可前往设置或先开始使用。':awaitingSettings?'在 Windows 设置中选择 M1racle Note，完成后回到这里。':'需要在 Windows 设置中确认一次。也可以稍后再设置。';
    delete message.dataset.error;
  }
  async function refresh() {
    if(checking)return;
    checking=true;primary.disabled=true;
    try {const state=await bridge.request('onboarding-state');showState(state);return state;}
    catch(value){error(new Error('暂时无法确认默认应用。你可以先开始使用，稍后再检查。'));}
    finally{checking=false;primary.disabled=false;}
  }
  async function close() {
    primary.disabled=true;skip.disabled=true;
    try {await bridge.request('onboarding-dismiss');awaitingSettings=false;modal.close();previousFocus?.focus({preventScroll:true});}
    catch(value){error(new Error('未能保存这次选择，请重试。'));}
    finally{primary.disabled=false;skip.disabled=false;}
  }
  async function open(first=false) {
    const state=await refresh();
    if(!state)return;
    if(!state.available){error(new Error('此预览版暂不支持系统默认打开设置。'));if(!first){previousFocus=document.activeElement;modal.showModal();}return;}
    if(first && complete){if(!state.dismissed)await bridge.request('onboarding-dismiss');return;}
    if(first && state.dismissed)return;
    previousFocus=document.activeElement;if(!modal.open)modal.showModal();
    primary.focus();
  }
  primary.onclick=async()=>{
    if(complete){await close();return;}
    primary.disabled=true;
    try {
      const result=await bridge.request('default-app');awaitingSettings=true;
      message.textContent=result.targeted?'在 Windows 设置中，为 .md 和 .markdown 选择 M1racle Note。':'在 Windows 默认应用设置中搜索 .md，选择 M1racle Note；.markdown 也可以同样设置。';
      delete message.dataset.error;primary.textContent='继续设置';skip.textContent='先开始使用';
    }catch(value){error(new Error('未能打开 Windows 设置。可在系统“设置 → 应用 → 默认应用”中搜索 .md，选择 M1racle Note。'));}
    finally{primary.disabled=false;}
  };
  skip.onclick=close;
  modal.addEventListener('cancel',event=>{event.preventDefault();close();});
  window.addEventListener('focus',()=>{if(awaitingSettings && modal.open)refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && awaitingSettings && modal.open)refresh();});
  return {init:()=>open(true),open:()=>open(false)};
}
