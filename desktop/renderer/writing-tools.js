import {ensureSyntaxTree,syntaxTree,syntaxTreeAvailable} from '@codemirror/language';
import {EditorView} from '@codemirror/view';
import './writing-tools.css';

// These controls derive presentation from CM6. They never own document text or selection.
export function initWritingTools({getView,format,onPrepare=()=>{}}) {
  const outlineToggle=document.getElementById('outline-toggle');
  const focusToggle=document.getElementById('focus-toggle');
  const commandsOpen=document.getElementById('commands-open');
  const outline=document.createElement('aside');
  outline.id='writing-outline';outline.hidden=true;outline.setAttribute('aria-labelledby','writing-outline-title');
  outline.innerHTML='<div class="writing-panel-heading"><h2 id="writing-outline-title">文档大纲</h2><button type="button" id="writing-outline-close" aria-label="关闭文档大纲" title="关闭大纲 · Esc">×</button></div><p id="writing-outline-status" role="status"></p><button type="button" id="writing-outline-refresh" hidden>更新大纲</button><nav id="writing-outline-list" aria-label="文内标题"></nav>';
  document.body.append(outline);
  const outlineList=outline.querySelector('#writing-outline-list'),outlineStatus=outline.querySelector('#writing-outline-status');
  const outlineRefresh=outline.querySelector('#writing-outline-refresh');
  const exitFocus=document.createElement('button');
  exitFocus.id='writing-focus-exit';exitFocus.type='button';exitFocus.hidden=true;exitFocus.textContent='退出专注 · F8';exitFocus.setAttribute('aria-label','退出专注');
  document.body.append(exitFocus);
  const palette=document.createElement('dialog');
  palette.id='writing-commands';palette.setAttribute('aria-labelledby','writing-commands-title');
  palette.innerHTML='<div class="writing-panel-heading"><h2 id="writing-commands-title">快捷操作</h2><button type="button" id="writing-commands-close" aria-label="关闭快捷操作" title="关闭 · Esc">×</button></div><label class="writing-search-label" for="writing-command-search">搜索格式或操作</label><input id="writing-command-search" type="search" autocomplete="off" spellcheck="false" placeholder="例如：二级标题、列表、专注" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="writing-command-list"><p id="writing-command-status" role="status" aria-live="polite"></p><div id="writing-command-list" role="listbox" aria-label="可用操作"></div><details class="writing-shortcuts"><summary>已支持的写作捷径</summary><dl><div><dt>Enter</dt><dd>续写列表、待办和引用</dd></div><div><dt>Alt + ↑ / ↓</dt><dd>移动当前行或所选行</dd></div><div><dt>Shift + Alt + ↑ / ↓</dt><dd>复制当前行或所选行</dd></div><div><dt>Ctrl + Enter</dt><dd>在当前行后插入空行</dd></div><div><dt>选中文字，再粘贴网址</dt><dd>将普通文字变为链接</dd></div><div><dt>Ctrl + F</dt><dd>查找文内文字</dd></div><div><dt>Ctrl + E</dt><dd>切换文档与源码</dd></div><div><dt>Alt + F10</dt><dd>将焦点移到选区工具栏</dd></div></dl></details><p class="writing-command-help">↑ ↓ 选择 · Enter 执行 · Esc 返回写作</p>';
  document.body.append(palette);
  const search=palette.querySelector('#writing-command-search'),commandList=palette.querySelector('#writing-command-list');
  const commandStatus=palette.querySelector('#writing-command-status');
  const actions=[
    {id:'heading-0',label:'正文',keywords:'段落 paragraph 普通文字',shortcut:'Ctrl+Alt+0'},
    ...Array.from({length:6},(_,i)=>({id:`heading-${i+1}`,label:`${['一','二','三','四','五','六'][i]}级标题`,keywords:`H${i+1} heading ${i+1} 标题`,shortcut:`Ctrl+Alt+${i+1}`})),
    {id:'quote',label:'引用',keywords:'引文 quote blockquote',shortcut:'Ctrl+Shift+9'},
    {id:'list',label:'无序列表',keywords:'项目 bullet list 列表',shortcut:'Ctrl+Shift+8'},
    {id:'ordered',label:'编号列表',keywords:'有序 ordered list 列表',shortcut:'Ctrl+Shift+7'},
    {id:'task',label:'待办事项',keywords:'任务 复选 checkbox task todo',shortcut:'Ctrl+Alt+T'},
    {id:'bold',label:'粗体',keywords:'加粗 bold',shortcut:'Ctrl+B'},
    {id:'italic',label:'斜体',keywords:'italic',shortcut:'Ctrl+I'},
    {id:'strike',label:'删除线',keywords:'strike'},
    {id:'inlinecode',label:'行内代码',keywords:'inline code'},
    {id:'outline',label:'显示 / 关闭文档大纲',keywords:'目录 标题 跳转 outline 导航',shortcut:'Ctrl+Shift+O'},
    {id:'focus',label:'进入 / 退出专注写作',keywords:'focus 安静 专注',shortcut:'F8'},
  ];
  let outlineTimer,measureFrame,outlineDocument=null,headings=[],complete=false,outlineVersion=0;
  let paletteSelection=null,paletteView=null,paletteDocument=null,filtered=[],active=0,composing=false;
  let focus=false;
  const isComposing=event=>composing || event?.isComposing || event?.keyCode===229 || getView()?.composing;
  const prepare=()=>onPrepare();
  const restoreSelection=()=>{
    const view=getView();
    if(!view || view!==paletteView || view.state.doc!==paletteDocument)return false;
    if(paletteSelection && !view.state.selection.eq(paletteSelection))view.dispatch({selection:paletteSelection});
    view.focus();return true;
  };
  const measure=()=>{
    cancelAnimationFrame(measureFrame);
    measureFrame=requestAnimationFrame(()=>{
      const bounds=document.querySelector('main')?.getBoundingClientRect();if(!bounds)return;
      outline.style.top=Math.max(0,bounds.top+8)+'px';
      outline.style.bottom=Math.max(8,innerHeight-bounds.bottom+8)+'px';
      exitFocus.style.bottom=Math.max(8,innerHeight-bounds.bottom+12)+'px';
    });
  };
  const updateCurrentHeading=()=>{
    const view=getView();let current=-1;
    if(view && view.state.doc===outlineDocument)for(let i=0;i<headings.length;i++){if(headings[i].from>view.state.selection.main.head)break;current=i;}
    for(const [i,button] of [...outlineList.querySelectorAll('button')].entries()) {
      if(i===current)button.setAttribute('aria-current','location');else button.removeAttribute('aria-current');
    }
  };
  const headingText=(state,node)=>{
    let text=state.sliceDoc(node.from,node.to);const marks=[];
    node.node.cursor().iterate(child=>{
      if(['HeaderMark','EmphasisMark','CodeMark','LinkMark','URL','LinkTitle','StrikethroughMark'].includes(child.name))marks.push({from:child.from-node.from,to:child.to-node.from});
    });
    for(const mark of marks.sort((a,b)=>b.from-a.from))text=text.slice(0,mark.from)+text.slice(mark.to);
    return text.replace(/\s+/g,' ').trim() || '无标题';
  };
  const buildOutline=()=>{
    clearTimeout(outlineTimer);if(outline.hidden)return;
    const view=getView();if(!view)return;
    const state=view.state,document=state.doc,version=++outlineVersion;
    // One short parser budget after typing settles; selection updates never force a parse.
    const parsed=ensureSyntaxTree(state,document.length,8),tree=parsed || syntaxTree(state);
    const next=[];
    tree.iterate({enter(node){
      if(['FencedCode','CodeBlock'].includes(node.name))return false;
      const level=/^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if(level){next.push({from:node.from,level:Number(level[1]),text:headingText(state,node)});return false;}
    }});
    if(getView()!==view || getView().state.doc!==document || version!==outlineVersion)return;
    outlineDocument=document;headings=next;complete=!!parsed || syntaxTreeAvailable(state,document.length);
    const fragment=window.document.createDocumentFragment();
    for(const heading of headings) {
      const button=window.document.createElement('button');button.type='button';button.textContent=heading.text;button.title=heading.text;
      button.style.setProperty('--heading-level',String(heading.level));button.dataset.position=String(heading.from);
      button.addEventListener('click',()=>{
        const current=getView();if(!current || current.composing)return;
        if(current.state.doc!==outlineDocument){scheduleOutline();return;}
        prepare();current.dispatch({selection:{anchor:heading.from},effects:EditorView.scrollIntoView(heading.from,{y:'start',yMargin:24})});current.focus();updateCurrentHeading();
      });fragment.append(button);
    }
    outlineList.replaceChildren(fragment);outlineRefresh.hidden=complete;
    outlineStatus.textContent=complete?(headings.length?`${headings.length} 个标题 · 点击跳转`:'还没有标题；使用标题格式后显示在这里。'):`当前显示已解析部分（${headings.length} 个标题）；长文仍在解析，可稍后更新。`;
    updateCurrentHeading();measure();
  };
  const scheduleOutline=(delay=180)=>{
    if(outline.hidden)return;
    clearTimeout(outlineTimer);outlineTimer=setTimeout(buildOutline,delay);
  };
  const setOutline=open=>{
    prepare();outline.hidden=!open;outlineToggle?.setAttribute('aria-expanded',String(open));
    outlineToggle?.setAttribute('aria-controls',outline.id);
    if(open){outlineStatus.textContent='正在读取文内标题…';scheduleOutline(0);measure();}
    else clearTimeout(outlineTimer);
  };
  const closePalette=(restore=true)=>{
    if(!palette.open)return;
    palette.close();commandsOpen?.setAttribute('aria-expanded','false');
    if(restore){prepare();restoreSelection();}
    paletteView=null;paletteDocument=null;paletteSelection=null;composing=false;
  };
  const setFocus=value=>{
    const view=getView();if(view?.composing)return;
    prepare();const scroll=view?.scrollDOM.scrollTop;
    focus=value;document.body.dataset.focus=String(focus);exitFocus.hidden=!focus;
    focusToggle?.setAttribute('aria-pressed',String(focus));
    focusToggle?.setAttribute('aria-label',focus?'退出专注写作':'专注写作');
    if(focus && !outline.hidden)setOutline(false);
    view?.requestMeasure();measure();
    requestAnimationFrame(()=>{if(getView()===view && scroll!==undefined)view.scrollDOM.scrollTop=scroll;});
  };
  const markActive=()=>{
    const buttons=[...commandList.querySelectorAll('[role=option]')];
    buttons.forEach((button,i)=>button.setAttribute('aria-selected',String(i===active)));
    if(buttons[active]){search.setAttribute('aria-activedescendant',buttons[active].id);buttons[active].scrollIntoView({block:'nearest'});}
    else search.removeAttribute('aria-activedescendant');
  };
  const execute=action=>{
    if(isComposing())return;
    const view=getView();
    if(!view || view!==paletteView || view.state.doc!==paletteDocument){commandStatus.textContent='文档已变化，请关闭后重新打开快捷操作。';return;}
    if(!['outline','focus'].includes(action.id) && view.state.readOnly){commandStatus.textContent='当前文档只读，不能应用格式。';return;}
    prepare();if(!restoreSelection())return;
    closePalette(false);
    if(action.id==='outline')setOutline(outline.hidden);
    else if(action.id==='focus')setFocus(!focus);
    else format(action.id);
  };
  const renderCommands=()=>{
    const query=search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    filtered=actions.filter(action=>query.every(word=>`${action.label} ${action.keywords} ${action.shortcut || ''}`.toLocaleLowerCase().includes(word)));
    active=0;const fragment=document.createDocumentFragment();
    for(const [i,action] of filtered.entries()){
      const button=document.createElement('button');button.type='button';button.id=`writing-command-${action.id}`;button.setAttribute('role','option');button.tabIndex=-1;
      button.disabled=!['outline','focus'].includes(action.id) && !!getView()?.state.readOnly;
      const label=document.createElement('span');label.textContent=action.label;button.append(label);
      if(action.shortcut){const shortcut=document.createElement('kbd');shortcut.textContent=action.shortcut;button.append(shortcut);}
      button.addEventListener('pointerdown',event=>event.preventDefault());
      button.addEventListener('pointermove',()=>{if(!button.disabled){active=i;markActive();}});
      button.addEventListener('click',()=>execute(action));fragment.append(button);
    }
    commandList.replaceChildren(fragment);
    const firstEnabled=[...commandList.querySelectorAll('button')].findIndex(button=>!button.disabled);active=firstEnabled;
    commandStatus.textContent=filtered.length?`${filtered.length} 项操作${getView()?.state.readOnly?' · 当前文档只读':''}`:'没有匹配的操作，试试“标题”“列表”或“专注”。';markActive();
  };
  const openPalette=()=>{
    const view=getView();if(!view || view.composing || document.querySelector('dialog[open]'))return;
    prepare();paletteView=view;paletteDocument=view.state.doc;paletteSelection=view.state.selection;search.value='';
    palette.showModal();commandsOpen?.setAttribute('aria-expanded','true');renderCommands();search.focus();
  };
  outlineToggle?.setAttribute('aria-expanded','false');outlineToggle?.setAttribute('aria-controls',outline.id);
  focusToggle?.setAttribute('aria-pressed','false');commandsOpen?.setAttribute('aria-expanded','false');commandsOpen?.setAttribute('aria-haspopup','dialog');commandsOpen?.setAttribute('aria-controls',palette.id);
  outlineToggle?.addEventListener('click',()=>{if(!isComposing())setOutline(outline.hidden);});
  focusToggle?.addEventListener('click',()=>{if(!isComposing()){setFocus(!focus);getView()?.focus();}});
  commandsOpen?.addEventListener('click',openPalette);
  exitFocus.addEventListener('click',()=>{setFocus(false);getView()?.focus();});
  outline.querySelector('#writing-outline-close').addEventListener('click',()=>{setOutline(false);getView()?.focus();});
  outlineRefresh.addEventListener('click',()=>scheduleOutline(0));
  palette.querySelector('#writing-commands-close').addEventListener('click',()=>{if(!isComposing())closePalette();});
  palette.addEventListener('cancel',event=>{event.preventDefault();if(!isComposing())closePalette();});
  search.addEventListener('compositionstart',()=>{composing=true;});
  search.addEventListener('compositionend',()=>{composing=false;renderCommands();});
  search.addEventListener('input',event=>{if(!event.isComposing && !composing)renderCommands();});
  palette.addEventListener('keydown',event=>{
    if(isComposing(event))return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePalette();return;}
    if(['ArrowUp','ArrowDown'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey){
      event.preventDefault();const buttons=[...commandList.querySelectorAll('button')],enabled=buttons.map((button,i)=>button.disabled?-1:i).filter(i=>i>=0);
      if(enabled.length){const index=enabled.indexOf(active);active=enabled[(index+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length];markActive();}
    }else if(event.key==='Enter' && event.target===search){event.preventDefault();if(filtered[active])execute(filtered[active]);}
  });
  document.addEventListener('keydown',event=>{
    if(isComposing(event) || event.repeat)return;
    const ownPalette=palette.open,otherDialog=[...document.querySelectorAll('dialog[open]')].some(dialog=>dialog!==palette);
    if(otherDialog)return;
    const commandKey=(event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey;
    if(commandKey && event.key.toLowerCase()==='p'){
      event.preventDefault();ownPalette?closePalette():openPalette();return;
    }
    if(ownPalette)return;
    const target=event.target,view=getView();
    if(target instanceof Element && target.closest('input,textarea,select,[contenteditable="true"]') && !view?.dom.contains(target))return;
    if(commandKey && event.key.toLowerCase()==='o'){event.preventDefault();setOutline(outline.hidden);return;}
    if(event.key==='F8' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey){event.preventDefault();setFocus(!focus);view?.focus();return;}
    if(event.key==='Escape' && !outline.hidden && outline.contains(target)){event.preventDefault();setOutline(false);view?.focus();}
  });
  window.addEventListener('resize',measure);
  // Save errors change the editor's vertical space without changing the viewport.
  const layoutObserver=new ResizeObserver(measure);
  const documentArea=document.querySelector('main');if(documentArea)layoutObserver.observe(documentArea);
  const refresh=()=>{
    const view=getView();if(!view)return;
    if(!outline.hidden){
      if(outlineDocument!==view.state.doc){
        outlineStatus.textContent='正在更新文内标题…';for(const button of outlineList.querySelectorAll('button'))button.disabled=true;
        scheduleOutline();
      }else if(!complete && syntaxTreeAvailable(view.state,view.state.doc.length))scheduleOutline(0);
      else updateCurrentHeading();
      measure();
    }
  };
  const reset=()=>{
    closePalette(false);clearTimeout(outlineTimer);outlineVersion++;outlineDocument=null;headings=[];complete=false;outlineList.replaceChildren();
    if(!outline.hidden){outlineStatus.textContent='正在读取文内标题…';scheduleOutline(0);}measure();
  };
  measure();return {refresh,reset};
}
