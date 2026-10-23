// One top-layer menu serves the title bar and every pane, including nested
// panes whose overflow would otherwise clip the file-opening actions.
import {motionDuration} from './pane-motion.js';
export function initSplitMenu({getActive,getPanes,canMove,run}) {
  const menu=document.getElementById('split-menu');
  const title=document.getElementById('split-menu-title');
  const topButton=document.getElementById('split-options');
  const choices=document.getElementById('split-choices'),targets=document.getElementById('split-swap-list');
  const targetList=document.getElementById('split-swap-targets'),swapButton=document.getElementById('split-swap');
  const backButton=document.getElementById('split-swap-back');
  const items=()=>[...menu.querySelectorAll('button')].filter(button=>!button.disabled && button.checkVisibility());
  let target,trigger;
  const isOpen=()=>menu.matches(':popover-open');
  const close=()=>{if(isOpen())menu.hidePopover();trigger?.setAttribute('aria-expanded','false');};
  const position=()=>{
    if(!trigger?.isConnected){close();return;}
    const anchor=trigger.getBoundingClientRect(),box=menu.getBoundingClientRect();
    const left=Math.max(8,Math.min(anchor.right-box.width,innerWidth-box.width-8));
    const top=anchor.bottom+4+box.height<=innerHeight-8?anchor.bottom+4:Math.max(8,anchor.top-box.height-4);
    menu.style.left=left+'px';menu.style.top=top+'px';
    menu.style.transformOrigin=top<anchor.top?'bottom right':'top right';
  };
  const open=(button,pane=getActive())=>{
    if(!pane)return;
    if(isOpen() && trigger===button){close();button.focus();return;}
    close();target=pane;trigger=button;
    choices.hidden=false;targets.hidden=true;
    swapButton.disabled=!canMove(pane) || !getPanes().some(other=>other!==pane && canMove(other));
    title.textContent=pane.label;title.title=pane.filename || pane.label;
    for(const details of document.querySelectorAll('.toolbar-menu[open]'))details.open=false;
    menu.showPopover();button.setAttribute('aria-expanded','true');position();items()[0]?.focus();
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const ms=motionDuration('--m1-motion-fast');
      if(ms){const animation=menu.animate([{opacity:0,transform:'translateY(-3px) scale(.98)'},{opacity:1,transform:'none'}],{duration:ms,easing:'ease-out'});animation.id='note-split-menu';}
    }
  };
  const showChoices=()=>{targets.hidden=true;choices.hidden=false;position();swapButton.focus();};
  swapButton.onclick=()=>{
    targetList.replaceChildren();
    getPanes().forEach((pane,index)=>{
      if(pane===target)return;
      const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitem');
      button.dataset.swapTarget=pane.id;button.textContent=`窗格 ${index+1} · ${pane.label}`;button.title=pane.filename || pane.label;
      button.disabled=!canMove(target) || !canMove(pane);targetList.append(button);
    });
    choices.hidden=true;targets.hidden=false;position();items()[1]?.focus();
  };
  backButton.onclick=showChoices;
  menu.addEventListener('toggle',()=>{if(!isOpen())trigger?.setAttribute('aria-expanded','false');});
  menu.addEventListener('click',event=>{
    const item=event.target.closest('[data-split-action],[data-swap-target]');
    if(!item)return;
    const pane=target;close();
    if(item.dataset.swapTarget)run('swap-pane',pane,{with:item.dataset.swapTarget});
    else run(item.dataset.splitAction,pane);
  });
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){
      event.preventDefault();event.stopPropagation();
      if(!targets.hidden)showChoices();else{close();trigger?.focus();}return;
    }
    const buttons=items(),index=buttons.indexOf(document.activeElement);
    const next=['ArrowDown','ArrowRight'].includes(event.key)?(index+1)%buttons.length:['ArrowUp','ArrowLeft'].includes(event.key)?(index+buttons.length-1)%buttons.length:event.key==='Home'?0:event.key==='End'?buttons.length-1:null;
    if(next!==null){event.preventDefault();buttons[next]?.focus();}
    if(event.key==='Tab')close();
  });
  topButton.onclick=()=>open(topButton);
  document.addEventListener('pointerdown',event=>{
    if(isOpen() && !menu.contains(event.target) && !trigger?.contains(event.target))close();
  });
  window.addEventListener('resize',()=>{if(isOpen())position();});
  return {open};
}
