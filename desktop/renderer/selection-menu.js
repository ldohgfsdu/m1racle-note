import {syntaxTree} from '@codemirror/language';
import {formatPlan,activeFormat} from './formatting.js';
import {clearStylePreview} from './style-preview.js';

// CodeMirror owns the selection. The toolbar follows its coordinates and applies no edits.
export function initSelectionMenu(getView,nativeEdit,report) {
  const menu=document.getElementById('selection-menu');
  const headingMenu=document.getElementById('heading-menu');
  let timer,dragging=false,dismissed=false,openPanel=null,observedScroll=null;
  const paneResize=new ResizeObserver(()=>{if(!menu.hidden)position();});
  const visibleButtons=container=>[...container.querySelectorAll('button:not(:disabled)')].filter(button=>button.checkVisibility({checkVisibilityCSS:true}));
  const mainButtons=()=>visibleButtons(menu).filter(button=>!button.closest('.selection-options'));
  const closePanels=(restoreFocus=false)=>{
    const trigger=openPanel && menu.querySelector(`[aria-controls="${openPanel.id}"]`);
    for(const panel of menu.querySelectorAll('.selection-options'))panel.hidden=true;
    for(const button of menu.querySelectorAll('[data-selection-submenu]'))button.setAttribute('aria-expanded','false');
    openPanel=null;clearStylePreview();
    if(restoreFocus)trigger?.focus({preventScroll:true});
  };
  const hide=(restoreFocus=true)=>{
    const focused=menu.contains(document.activeElement);
    clearTimeout(timer);closePanels();menu.hidden=true;
    if(restoreFocus && focused)getView()?.focus();
  };
  const dismiss=()=>{hide(false);dismissed=true;};
  const horizontalBounds=view=>{
    const box=view.scrollDOM.getBoundingClientRect();
    const left=Math.max(8,box.left+12),right=Math.min(innerWidth-8,box.right-12);
    return {left,right,width:Math.max(1,right-left)};
  };
  const syncFormats=view=>{
    const controls=document.querySelectorAll('#selection-menu [data-selection-format],#heading-menu [data-format]');
    const states=new Map();
    for(const button of controls){
      const type=button.dataset.selectionFormat || button.dataset.format;
      if(!button.dataset.actionTitle)button.dataset.actionTitle=button.title || button.textContent.trim();
      let reason='',active=false;
      if(type==='link'){
        let node=syntaxTree(view.state).resolveInner(view.state.selection.main.from,1);
        for(;node;node=node.parent)if(['FencedCode','CodeBlock','InlineCode','Link'].includes(node.name))reason='此处保留源码，暂不插入链接';
        const {from,to}=view.state.selection.main;
        if(/\n/.test(view.state.sliceDoc(from,to)))reason='链接文字需要位于同一段内';
      }else{
        if(states.has(type))({reason,active}=states.get(type));
        else{
          try{const plan=formatPlan(view.state,type);if(!plan)reason='此处暂不支持这个格式';active=plan?.active ?? activeFormat(view.state,type);}
          catch(error){reason=error?.message || '此处保留源码，暂不应用这个格式';}
          states.set(type,{reason,active});
        }
      }
      button.disabled=Boolean(reason);button.title=reason || button.dataset.actionTitle;
      if(button.getAttribute('role')?.startsWith('menuitem'))button.setAttribute('aria-checked',String(active));
      else if(type!=='link')button.setAttribute('aria-pressed',String(active));
    }
    let level=null;
    for(let candidate=0;candidate<=6;candidate++){
      if(states.get(`heading-${candidate}`)?.active){level=candidate;break;}
    }
    const label=level===null?'文本':level===0?'正文':`H${level}`;
    for(const element of document.querySelectorAll('[data-heading-label]'))element.textContent=label;
  };
  const positionPanel=()=>{
    if(!openPanel)return;
    const view=getView(),trigger=menu.querySelector(`[aria-controls="${openPanel.id}"]`);
    if(!view || !trigger)return closePanels();
    const viewport=view.scrollDOM.getBoundingClientRect(),anchor=trigger.getBoundingClientRect();
    const horizontal=horizontalBounds(view);
    const available=Math.max(44,viewport.height-12);
    openPanel.style.maxHeight=available+'px';
    openPanel.style.maxWidth=horizontal.width+'px';
    openPanel.style.minWidth='';
    openPanel.style.minWidth=Math.min(parseFloat(getComputedStyle(openPanel).minWidth)||0,horizontal.width)+'px';
    openPanel.style.left=horizontal.left+'px';
    const bounds=openPanel.getBoundingClientRect();
    const gap=8,padding=6;
    const below=anchor.bottom+gap,above=anchor.top-gap-bounds.height;
    const fitsBelow=below+bounds.height<=viewport.bottom-padding;
    const fitsAbove=above>=viewport.top+padding;
    const unclampedTop=fitsBelow?below:fitsAbove?above:below;
    const top=Math.max(viewport.top+padding,Math.min(viewport.bottom-bounds.height-padding,unclampedTop));
    const left=Math.max(horizontal.left,Math.min(horizontal.right-bounds.width,anchor.left));
    openPanel.style.left=left+'px';openPanel.style.top=top+'px';
  };
  const position=()=>{
    const view=getView();if(!view)return hide();
    if(observedScroll!==view.scrollDOM){
      if(observedScroll)paneResize.unobserve(observedScroll);
      observedScroll=view.scrollDOM;paneResize.observe(observedScroll);
    }
    syncFormats(view);
    if(dragging || dismissed || view.dom.closest('.pane')?.dataset.mode!=='rendered' || document.querySelector('dialog[open]'))return hide();
    const selection=view.state.selection.main;if(selection.empty)return hide();
    const viewport=view.scrollDOM.getBoundingClientRect();
    const points=[view.coordsAtPos(selection.from,1),view.coordsAtPos(selection.to,-1)].filter(point=>point && point.bottom>=viewport.top && point.top<=viewport.bottom);
    if(!points.length)return hide();
    const horizontal=horizontalBounds(view);
    menu.style.maxWidth=horizontal.width+'px';
    menu.style.left=horizontal.left+'px';
    menu.hidden=false;
    const bounds=menu.getBoundingClientRect(),first=points[0],last=points.at(-1);
    const center=Math.abs(first.top-last.top)<5?(first.left+last.right)/2:first.left+Math.min(bounds.width/2,100);
    // Positioning contract: the selection is the anchor. Prefer above it (10px gap); if there is no room put the
    // toolbar below the LAST selected line. Horizontally it only follows the selection (single line: centred on it;
    // multi-line: anchored to the first line) and is clamped to the active editor pane. Neighbouring text is never a reason to
    // move the toolbar away from the selection (it may overlap a heading/adjacent line: that is accepted).
    const above=first.top-bounds.height-10;
    const top=above>=viewport.top+6?above:Math.min(viewport.bottom-bounds.height-6,last.bottom+10);
    menu.style.left=Math.max(horizontal.left,Math.min(horizontal.right-bounds.width,center-bounds.width/2))+'px';
    menu.style.top=Math.max(viewport.top+6,top)+'px';positionPanel();
  };
  const openSubmenu=(trigger,focus=false,last=false)=>{
    const panel=document.getElementById(trigger.getAttribute('aria-controls'));
    if(!panel)return;
    if(openPanel===panel && !focus)return closePanels();
    closePanels();openPanel=panel;panel.hidden=false;trigger.setAttribute('aria-expanded','true');positionPanel();
    if(focus){const buttons=visibleButtons(panel);(last?buttons.at(-1):buttons.find(button=>button.getAttribute('aria-checked')==='true') || buttons[0])?.focus({preventScroll:true});}
  };
  const schedule=()=>{dismissed=false;clearTimeout(timer);timer=setTimeout(position,100);};
  const moveWithinPanel=(panel,event)=>{
    const buttons=visibleButtons(panel),index=buttons.indexOf(document.activeElement);
    if(!buttons.length)return;
    let next=index;
    if(event.key==='Home')next=0;
    else if(event.key==='End')next=buttons.length-1;
    else if(event.key==='ArrowRight')next=(index+1)%buttons.length;
    else if(event.key==='ArrowLeft')next=(index-1+buttons.length)%buttons.length;
    else if(event.key==='ArrowDown')next=panel.dataset.columns==='3'?(index===0?1:index+3<buttons.length?index+3:0):(index+1)%buttons.length;
    else if(event.key==='ArrowUp')next=panel.dataset.columns==='3'?(index===0?buttons.length-1:index<=3?0:index-3):(index-1+buttons.length)%buttons.length;
    else return;
    event.preventDefault();buttons[next]?.focus({preventScroll:true});
  };
  // Pointer interactions must not replace the document selection with a button selection.
  menu.addEventListener('pointerdown',event=>event.preventDefault());
  menu.addEventListener('click',async event=>{
    const trigger=event.target.closest('[data-selection-submenu]');
    if(trigger){openSubmenu(trigger,event.detail===0);return;}
    if(event.target.closest('[data-selection-format]'))closePanels();
    if(document.querySelector('dialog[open]')){hide();dismissed=true;}
    const action=event.target.closest('[data-selection-command]')?.dataset.selectionCommand;
    if(!action)return;
    try{getView()?.focus();await nativeEdit(action);hide();dismissed=true;}catch(error){report(error);}
  });
  menu.addEventListener('focusout',()=>queueMicrotask(()=>{if(!menu.contains(document.activeElement))closePanels();}));
  document.addEventListener('pointerdown',event=>{
    const view=getView();
    if(view?.dom.contains(event.target)){dragging=true;hide();}
    else if(!menu.contains(event.target))dismiss();
  },true);
  document.addEventListener('pointerup',()=>{if(dragging){dragging=false;schedule();}});
  document.addEventListener('pointercancel',()=>{dragging=false;hide();});
  document.addEventListener('scroll',()=>{if(!menu.hidden)position();},true);
  window.addEventListener('resize',()=>{if(!menu.hidden)position();});
  window.addEventListener('blur',()=>{hide(false);dismissed=true;});
  headingMenu?.addEventListener('toggle',()=>{if(!headingMenu.open)clearStylePreview();});
  // Cancel the preview and dismiss its owning toolbar layer in the same Escape.
  // This capture listener is registered before the preview's generic Escape handler.
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape' || menu.hidden)return;
    clearStylePreview();event.preventDefault();event.stopPropagation();
    if(openPanel)closePanels(true);
    else{hide();dismissed=true;}
  },true);
  document.addEventListener('keydown',event=>{
    if(headingMenu?.contains(event.target)){
      if(event.target.id==='heading-level' && ['ArrowDown','ArrowUp'].includes(event.key)){
        event.preventDefault();headingMenu.open=true;
        const buttons=visibleButtons(headingMenu);(event.key==='ArrowUp'?buttons.at(-1):buttons.find(button=>button.getAttribute('aria-checked')==='true') || buttons[0])?.focus();return;
      }
      if(event.target.closest('.heading-options'))moveWithinPanel(headingMenu.querySelector('.heading-options'),event);
    }
    if(event.altKey && event.key==='F10' && !getView()?.state.selection.main.empty){
      event.preventDefault();dismissed=false;position();if(!menu.hidden)mainButtons()[0]?.focus();return;
    }
    if(!menu.contains(event.target))return;
    if(event.key==='Tab'){hide(false);dismissed=true;return;}
    if(openPanel?.contains(event.target)){moveWithinPanel(openPanel,event);return;}
    const trigger=event.target.closest('[data-selection-submenu]');
    if(trigger && ['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();openSubmenu(trigger,true,event.key==='ArrowUp');return;}
    const buttons=mainButtons(),index=buttons.indexOf(document.activeElement);
    if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      event.preventDefault();closePanels();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length]?.focus();
    }
  });
  return {schedule,hide,dismiss};
}
