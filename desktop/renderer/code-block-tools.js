import {StateField} from '@codemirror/state';
import {ensureSyntaxTree,syntaxTree} from '@codemirror/language';
import {Decoration,EditorView,WidgetType} from '@codemirror/view';
import './code-block-tools.css';

const languages={
  bash:'Bash',c:'C',cpp:'C++',cs:'C#',css:'CSS',go:'Go',html:'HTML',
  java:'Java',js:'JavaScript',javascript:'JavaScript',json:'JSON',jsx:'JSX',
  kotlin:'Kotlin',md:'Markdown',markdown:'Markdown',php:'PHP',py:'Python',
  python:'Python',rb:'Ruby',ruby:'Ruby',rust:'Rust',sh:'Shell',shell:'Shell',
  sql:'SQL',swift:'Swift',ts:'TypeScript',tsx:'TSX',txt:'Text',text:'Text',
  xml:'XML',yaml:'YAML',yml:'YAML',
};

function child(node,name) {
  for(let item=node.firstChild;item;item=item.nextSibling)if(item.name===name)return item;
  return null;
}

function codeText(state,node) {
  const parts=[];
  for(let item=node.firstChild;item;item=item.nextSibling) {
    if(item.name==='CodeText')parts.push(state.sliceDoc(item.from,item.to));
  }
  return parts.join('');
}

class CodeBlockTools extends WidgetType {
  constructor(label,text) {
    super();
    this.label=label;
    this.text=text;
  }

  eq(other) {
    return other.label===this.label && other.text===this.text;
  }

  toDOM(view) {
    const header=document.createElement('div');
    header.className='code-block-tools';
    header.setAttribute('role','group');
    header.setAttribute('aria-label','代码块工具');

    const language=document.createElement('span');
    language.className='code-block-tools-language';
    language.textContent=this.label;
    header.appendChild(language);

    const copy=document.createElement('button');
    copy.className='code-block-tools-copy';
    copy.type='button';
    copy.textContent='复制';
    copy.title='复制代码';
    if(!this.text) {
      copy.textContent='代码为空';
      copy.title='代码块中还没有内容';
      copy.disabled=true;
    }
    copy.addEventListener('click',async event=>{
      event.preventDefault();
      event.stopPropagation();
      if(copy.dataset.state==='copying')return;
      copy.dataset.state='copying';
      copy.disabled=true;
      try {
        if(typeof window.desktop?.request!=='function')throw new Error('当前环境不支持复制');
        await window.desktop.request('copy-text',{text:this.text});
        copy.textContent='已复制';
        copy.dataset.state='success';
      } catch(error) {
        copy.textContent='复制失败';
        copy.title=error?.message || String(error);
        copy.dataset.state='error';
      } finally {
        copy.disabled=false;
        setTimeout(()=>{
          if(copy.isConnected) {
            copy.textContent='复制';
            copy.title='复制代码';
            delete copy.dataset.state;
          }
        },1800);
      }
    });
    copy.addEventListener('pointerdown',event=>{
      if(event.pointerType!=='touch')event.preventDefault();
    });
    header.appendChild(copy);
    return header;
  }

  ignoreEvent() {
    return true;
  }
}

function buildTools(state,tree) {
  const ranges=[];
  tree.iterate({
    enter(node) {
      if(node.name!=='FencedCode')return;
      const text=codeText(state,node.node);
      const info=child(node.node,'CodeInfo');
      const infoText=info?state.sliceDoc(info.from,info.to).trim().split(/\s+/,1)[0]:'';
      const label=infoText?(languages[infoText.toLowerCase()] || infoText):'纯文本';
      ranges.push(Decoration.widget({
        widget:new CodeBlockTools(label,text),
        block:true,
        side:-1,
      }).range(node.from));
    },
  });
  return Decoration.set(ranges,true);
}

const codeBlockToolsField=StateField.define({
  create(state) {
    const tree=ensureSyntaxTree(state,state.doc.length,50) ?? syntaxTree(state);
    return {tree,decorations:buildTools(state,tree)};
  },
  update(value,transaction) {
    const tree=syntaxTree(transaction.state);
    if(!transaction.docChanged && tree===value.tree)return value;
    return {tree,decorations:buildTools(transaction.state,tree)};
  },
  provide:field=>EditorView.decorations.from(field,value=>value.decorations),
});

export const codeBlockTools=codeBlockToolsField;
