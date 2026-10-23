// Pane motion changes presentation only. Editor objects, source ranges and file
// sessions are never recreated for a layout animation.
export function motionDuration(token) {
  // CSS minification may express the same token as 240ms or .24s.
  const value=getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const ms=parseFloat(value)*(value.endsWith('ms')?1:value.endsWith('s')?1000:0);
  return Number.isFinite(ms) && ms>0?ms:0;
}
export function createPaneMotion(root) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const running=new Map();
  const layoutStyles=new Map();
  const restoreLayout=element=>{
    const saved=layoutStyles.get(element);if(!saved)return;
    for(const [key,value] of saved)if(value)element.style.setProperty(key,value);else element.style.removeProperty(key);
    layoutStyles.delete(element);
  };
  const duration=token=>reduced.matches?0:motionDuration(token);
  const update=()=>root.classList.toggle('pane-motion',Array.from(running.values()).some(item=>item.id==='note-pane-swap'));
  function animate(element,frames,id,token='--m1-motion-standard') {
    const previous=running.get(element);previous?.cancel();
    const ms=duration(token);
    if(!ms){running.delete(element);update();return;}
    const animation=element.animate(frames,{duration:ms,easing:'cubic-bezier(.2,.8,.2,1)'});
    animation.id=id;running.set(element,animation);update();
    animation.finished.catch(()=>{}).then(()=>{
      if(running.get(element)===animation){running.delete(element);if(id==='note-pane-swap')restoreLayout(element);}update();
    });
    return animation;
  }
  const content=host=>{
    const pending=running.has(host),style=pending?getComputedStyle(host):null;
    animate(host,[{opacity:pending?style.opacity:0,transform:pending?style.transform:'translateY(6px)'},{opacity:1,transform:'none'}],'note-pane-content');
  };
  function split(node,pane,before) {
    const entering=before?node.firstSlot:node.secondSlot,existing=before?node.secondSlot:node.firstSlot;
    animate(existing,[{flexGrow:1},{flexGrow:before?1-node.ratio:node.ratio}],'note-split-layout','--m1-motion-slow');
    animate(entering,[{flexGrow:0},{flexGrow:before?node.ratio:1-node.ratio}],'note-split-layout','--m1-motion-slow');
    const offset=node.dir==='row'?`translateX(${before?-12:12}px)`:`translateY(${before?-10:10}px)`;
    animate(pane.section,[{opacity:0,transform:offset},{opacity:1,transform:'none'}],'note-pane-enter','--m1-motion-slow');
    animate(node.divider,[{opacity:0},{opacity:1}],'note-pane-enter','--m1-motion-slow');
  }
  const capture=()=>{
    const before=new Map([...root.querySelectorAll('.pane')].map(pane=>[pane,pane.getBoundingClientRect()]));
    // A rapid second operation starts at the current on-screen positions.
    for(const [element,animation] of running){
      if(animation.id==='note-split-layout')animation.finish();
      else if(animation.id==='note-pane-swap' || animation.id==='note-pane-enter'){
        animation.cancel();running.delete(element);restoreLayout(element);
      }
    }
    update();
    return before;
  };
  const layout=before=>{
    if(!duration('--m1-motion-slow'))return;
    const after=[...root.querySelectorAll('.pane')].map(pane=>[pane,pane.getBoundingClientRect()]);
    for(const [pane,end] of after){
      const start=before.get(pane);
      if(!start || !end.width || !end.height)continue;
      const dx=start.left-end.left,dy=start.top-end.top;
      if(Math.abs(dx)+Math.abs(dy)+Math.abs(start.width-end.width)+Math.abs(start.height-end.height)<.1)continue;
      layoutStyles.set(pane,['flex','align-self','width','height'].map(key=>[key,pane.style.getPropertyValue(key)]));
      pane.style.flex='none';pane.style.alignSelf='flex-start';pane.style.width=end.width+'px';pane.style.height=end.height+'px';
      // Reflow the live editor during a size change; never stretch its text.
      animate(pane,[{width:start.width+'px',height:start.height+'px',transform:`translate(${dx}px,${dy}px)`},{width:end.width+'px',height:end.height+'px',transform:'none'}],'note-pane-swap','--m1-motion-slow');
    }
  };
  const stopSplit=node=>{
    const first=parseFloat(getComputedStyle(node.firstSlot).flexGrow),second=parseFloat(getComputedStyle(node.secondSlot).flexGrow);
    if(first+second>0)node.ratio=first/(first+second);
    for(const slot of [node.firstSlot,node.secondSlot])running.get(slot)?.cancel();
    node.firstSlot.style.flexGrow=node.ratio;node.secondSlot.style.flexGrow=1-node.ratio;
  };
  reduced.addEventListener('change',()=>{if(reduced.matches)for(const animation of running.values())animation.finish();});
  return {content,split,capture,layout,stopSplit};
}
