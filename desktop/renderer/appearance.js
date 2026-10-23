export function initAppearance(onChange) {
  const defaults={width:'comfortable',font:'sans',size:16,leading:1.7};
  const choices={width:['a4','a5','comfortable','fluid'],font:['sans','serif','mono']};
  function read() {
    const settings={...defaults};
    try {
      const stored=JSON.parse(localStorage.getItem('note.appearance') || '{}');
      for(const [key,values] of Object.entries(choices))if(values.includes(stored?.[key]))settings[key]=stored[key];
      for(const [key,min,max] of [['size',14,28],['leading',1.4,2.2]]) {
        const value=stored?.[key];
        if(typeof value!=='number' && typeof value!=='string')continue;
        const number=Number(value);
        if(Number.isFinite(number) && number>=min && number<=max)settings[key]=number;
      }
    }catch{}
    return settings;
  }
  let settings=read();
  const panel=document.getElementById('appearance');
  const trigger=document.getElementById('appearance-open');
  const isOpen=()=>panel.matches(':popover-open');
  function position() {
    if(!isOpen())return;
    const edge=12,gap=8,anchor=trigger.getBoundingClientRect();
    const top=Math.max(edge,Math.min(anchor.bottom+gap,innerHeight-edge-1));
    panel.style.maxHeight=Math.max(1,innerHeight-top-edge)+'px';
    const box=panel.getBoundingClientRect();
    const menuAnchor=trigger.closest('nav')?.querySelector('#app-menu > summary');
    const right=menuAnchor?.getBoundingClientRect().right ?? anchor.right;
    panel.style.left=Math.max(edge,Math.min(right-box.width,innerWidth-box.width-edge))+'px';
    panel.style.top=top+'px';
  }
  function apply() {
    document.documentElement.dataset.width=settings.width;
    document.documentElement.dataset.font=settings.font;
    document.documentElement.style.setProperty('--text-size',settings.size+'px');
    document.documentElement.style.setProperty('--text-leading',settings.leading);
    for(const key of Object.keys(choices)) {
      for(const input of document.getElementById('appearance-'+key).querySelectorAll('input[type=radio]'))input.checked=input.value===settings[key];
    }
    for(const key of ['size','leading'])document.getElementById('appearance-'+key).value=settings[key];
    document.getElementById('appearance-size-label').textContent=settings.size+' px';
    document.getElementById('appearance-leading-label').textContent=settings.leading.toFixed(2);
    onChange();
    position();
  }
  function persist() {
    try{localStorage.setItem('note.appearance',JSON.stringify(settings));}catch{}
  }
  function close(restoreFocus=false) {
    if(isOpen())panel.hidePopover();
    trigger.setAttribute('aria-expanded','false');
    if(restoreFocus)trigger.focus({preventScroll:true});
  }
  trigger.onclick=event=>{
    event.preventDefault();
    if(isOpen()){close(true);return;}
    for(const other of document.querySelectorAll('[popover]:popover-open'))other.hidePopover();
    for(const menu of document.querySelectorAll('.toolbar-menu[open]'))menu.open=false;
    panel.showPopover();
    trigger.setAttribute('aria-expanded','true');
    position();
    panel.querySelector('#appearance-width input:checked')?.focus({preventScroll:true});
  };
  panel.addEventListener('toggle',()=>trigger.setAttribute('aria-expanded',String(isOpen())));
  // Escape returns to the invoker; native outside-click dismissal keeps the
  // clicked editor/control in charge of focus. No editor selection is changed.
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape' || event.isComposing || event.keyCode===229 || !isOpen())return;
    event.preventDefault();event.stopImmediatePropagation();close(true);
  },true);
  panel.addEventListener('focusout',event=>{
    if(event.relatedTarget && !panel.contains(event.relatedTarget) && event.relatedTarget!==trigger)close();
  });
  for(const key of Object.keys(choices)) {
    document.getElementById('appearance-'+key).addEventListener('change',event=>{
      if(!event.target.matches('input[type=radio]') || !choices[key].includes(event.target.value))return;
      settings[key]=event.target.value;apply();persist();
    });
  }
  for(const key of ['size','leading']) {
    document.getElementById('appearance-'+key).oninput=event=>{
      settings[key]=Number(event.target.value);apply();persist();
    };
  }
  document.getElementById('appearance-reset').onclick=()=>{
    settings={...defaults};apply();try{localStorage.removeItem('note.appearance');}catch{}
  };
  window.addEventListener('resize',position);
  const observer=new ResizeObserver(position);
  for(const element of [panel,trigger,trigger.closest('nav')])if(element)observer.observe(element);
  apply();
  return {reload(){settings=read();apply();}};
}
