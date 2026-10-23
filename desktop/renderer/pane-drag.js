export function initPaneDrag({root,getPane,canMove,swap}) {
  let drag;
  function clear() {
    const current=drag;if(!current)return;drag=null;
    current.source.section.classList.remove('pane-dragging');
    current.target?.section.classList.remove('pane-drop-target');
    current.preview?.remove();root.classList.remove('pane-drag-active');
    if(root.hasPointerCapture(current.pointerId))root.releasePointerCapture(current.pointerId);
  }
  root.addEventListener('pointerdown',event=>{
    const bar=event.target.closest('.pane-bar');
    if(!bar || event.target.closest('button') || event.button!==0 || !event.isPrimary || drag)return;
    const source=getPane(bar.closest('.pane').dataset.pane);
    if(!canMove(source))return;
    // The bar is moved during a swap. Capture on the stable workspace root so
    // Chromium keeps hit testing through both DOM moves and can reacquire the
    // bar's grab cursor when the physical pointer moves back over it.
    try{root.setPointerCapture(event.pointerId);}
    catch{return;}
    drag={source,pointerId:event.pointerId,x:event.clientX,y:event.clientY,target:null,preview:null};
  });
  root.addEventListener('pointermove',event=>{
    if(!drag || event.pointerId!==drag.pointerId)return;
    if(!drag.preview && Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;
    event.preventDefault();
    if(!canMove(drag.source)){clear();return;}
    if(!drag.preview){
      drag.preview=document.createElement('div');drag.preview.className='pane-drag-preview';drag.preview.setAttribute('aria-hidden','true');
      drag.preview.textContent=drag.source.label;document.body.append(drag.preview);
      drag.width=drag.preview.offsetWidth;drag.height=drag.preview.offsetHeight;
      drag.source.section.classList.add('pane-dragging');root.classList.add('pane-drag-active');
    }
    const node=document.elementFromPoint(event.clientX,event.clientY)?.closest('.pane');
    const candidate=node?getPane(node.dataset.pane):null;
    const target=candidate!==drag.source && canMove(candidate)?candidate:null;
    if(target!==drag.target){drag.target?.section.classList.remove('pane-drop-target');drag.target=target;target?.section.classList.add('pane-drop-target');}
    drag.preview.style.transform=`translate(${Math.max(8,Math.min(event.clientX+14,innerWidth-drag.width-8))}px,${Math.max(8,Math.min(event.clientY+14,innerHeight-drag.height-8))}px)`;
  });
  root.addEventListener('pointerup',event=>{
    if(!drag || event.pointerId!==drag.pointerId)return;
    const {source,target,preview}=drag;
    // Finish the DOM move while capture still belongs to the stable root.
    // Always restore the cursor, including when the swap is refused or throws.
    try{if(preview && target)swap(source,target);}
    finally{clear();}
  });
  for(const type of ['pointercancel','lostpointercapture'])root.addEventListener(type,event=>{if(event.pointerId===drag?.pointerId)clear();});
  document.addEventListener('keydown',event=>{if(drag && event.key==='Escape'){event.preventDefault();event.stopPropagation();clear();}},true);
  window.addEventListener('blur',clear);
}
