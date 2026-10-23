import {motionDuration} from './pane-motion.js';

export function createLibraryMotion(sidebar) {
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const running=new Map(),folds=new Map();
 let sidebarState;
 const stop=node=>{const current=running.get(node);if(current){running.delete(node);clearTimeout(current.timer);current.animation.cancel();current.cleanup?.();}};
 const play=(node,id,frames,done,cleanup)=>{
  stop(node);
  const duration=reduced.matches?0:motionDuration(id==='note-library-sidebar'||id==='note-library-fold'?'--m1-motion-slow':'--m1-motion-standard');
  if(!duration){done?.();cleanup?.();return;}
  const animation=node.animate(frames,{duration,easing:'cubic-bezier(.2,0,0,1)'});
  animation.id=id;
  const current={animation,done,cleanup,timer:0};running.set(node,current);
  const finish=()=>{
   if(running.get(node)!==current)return;
   running.delete(node);clearTimeout(current.timer);animation.cancel();done?.();cleanup?.();
  };
  animation.finished.then(finish,()=>{});
  // Occluded Chromium surfaces can leave compositor animations pending with
  // startTime=null. Logical visibility must still reach its final state.
  current.timer=setTimeout(finish,duration+32);
 };
 const setSidebar=(collapsed,animate=true)=>{
  if(sidebarState===collapsed)return;
  const initialized=sidebarState!==undefined;
  sidebarState=collapsed;
  const from=sidebar.hidden?0:sidebar.getBoundingClientRect().width;
  const style=getComputedStyle(sidebar),fromTransform=sidebar.hidden?'translateX(-100%)':style.transform,fromOpacity=sidebar.hidden?0:style.opacity;
  stop(sidebar);sidebar.hidden=false;
  const width=sidebar.getBoundingClientRect().width;
  const overlay=getComputedStyle(sidebar).position==='absolute';
  sidebar.inert=collapsed;
  const finish=()=>{sidebar.hidden=collapsed;};
  if(!initialized||!animate){finish();return;}
  sidebar.style.setProperty('--library-motion-width',`${sidebar.clientWidth}px`);
  sidebar.dataset.animating='true';
  const cleanup=()=>{delete sidebar.dataset.animating;sidebar.style.removeProperty('--library-motion-width');};
  play(sidebar,'note-library-sidebar',overlay
   ?[{transform:fromTransform,opacity:fromOpacity},{transform:`translateX(${collapsed?'-100%':'0'})`,opacity:collapsed?0:1}]
   :[{width:`${from}px`,flexBasis:`${from}px`,minWidth:0,opacity:fromOpacity},{width:`${collapsed?0:width}px`,flexBasis:`${collapsed?0:width}px`,minWidth:0,opacity:collapsed?0:1}],finish,cleanup);
 };
 const fold=(details,expanded,{animate=true,from}={})=>{
  const current=folds.get(details);
  if(current?.expanded===expanded&&from===undefined)return;
  if(!current&&details.open===expanded&&from===undefined)return;
  const start=from??details.getBoundingClientRect().height;
  stop(details);folds.delete(details);details.open=true;
  details.dataset.expanded=String(expanded);
  const end=expanded?details.getBoundingClientRect().height:details.querySelector('summary').getBoundingClientRect().height;
  const finish=()=>{details.open=expanded;};
  if(!animate||Math.abs(start-end)<1){finish();return;}
  details.style.overflow='clip';folds.set(details,{expanded});
  play(details,'note-library-fold',[{height:`${start}px`},{height:`${end}px`}],finish,()=>{details.style.removeProperty('overflow');folds.delete(details);});
 };
 const enter=(node,id='entry')=>play(node,`note-library-${id}`,[{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}]);
 const finishAll=()=>{if(reduced.matches)for(const [node,current] of [...running]){running.delete(node);clearTimeout(current.timer);current.animation.cancel();current.done?.();current.cleanup?.();}};
 reduced.addEventListener('change',finishAll);
 return {setSidebar,fold,enter,forget:node=>{stop(node);folds.delete(node);},destroy(){for(const node of [...running.keys()])stop(node);folds.clear();reduced.removeEventListener('change',finishAll);}};
}
