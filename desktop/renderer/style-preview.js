import {StateEffect,StateField} from '@codemirror/state';
import {Decoration,EditorView} from '@codemirror/view';
import {formatPlan} from './formatting.js';

const setPreview=StateEffect.define();
let cancelPreview=()=>{};
const previewField=StateField.define({
  create:()=>Decoration.none,
  update(value,transaction) {
    if(transaction.docChanged || transaction.selection)return Decoration.none;
    for(const effect of transaction.effects)if(effect.is(setPreview))return effect.value;
    return value;
  },
  provide:field=>EditorView.decorations.from(field),
});
export const stylePreview=[previewField,EditorView.updateListener.of(update=>{
  if(update.docChanged || update.selectionSet)cancelPreview(false);
})];
export function clearStylePreview(){cancelPreview();}
export function bindStylePreview(getView) {
  let previewing=false,previousHint='';
  const hint=document.getElementById('mode-hint');
  const clear=(dispatch=true)=>{
    if(!previewing)return;
    previewing=false;if(dispatch)getView()?.dispatch({effects:setPreview.of(Decoration.none)});
    if(hint)hint.textContent=previousHint;
    document.querySelectorAll('[data-previewing]').forEach(button=>delete button.dataset.previewing);
  };
  cancelPreview=clear;
  for(const button of document.querySelectorAll('[data-format],[data-selection-format]')) {
    const type=button.dataset.format || button.dataset.selectionFormat;
    if(!['bold','italic','strike','inlinecode','quote','list','ordered','task'].includes(type) && !/^heading-[0-6]$/.test(type))continue;
    button.title=(button.title || button.textContent.trim())+' · 选中文字后悬停预览，点击应用';
    const show=()=>{
      const view=getView();
      if(button.disabled || !view || view.composing || view.dom.closest('.pane')?.dataset.mode!=='rendered' || view.state.selection.main.empty)return;
      let plan;try{plan=formatPlan(view.state,type);}catch{return;}
      if(!plan)return;
      clear();
      previewing=true;button.dataset.previewing='true';
      previousHint=hint?.textContent || '';
      const label={bold:'粗体',italic:'斜体',strike:'删除线',inlinecode:'行内代码',quote:'引用',list:'无序列表',ordered:'有序列表',task:'待办列表','heading-0':'正文'}[type] || `${type.at(-1)}级标题`;
      if(hint)hint.textContent=`预览${plan.preview.remove?'取消':''}${plan.preview.parts?plan.preview.parts.length+'处':''}${label} · 点击应用，Esc 取消`;
      if(plan.preview.block) {
        const lines=plan.preview.rows.map(row=>Decoration.line({
          class:`style-preview-block style-preview-${row.type}${row.preserveTextStyle?' style-preview-wrap':''}${row.type==='quote' && !row.quoteRemains?' style-preview-quote-off':''}${row.checked?' style-preview-task-checked':''}`,
          attributes:row.marker?{'data-preview-marker':row.marker}:undefined,
        }).range(row.from));
        view.dispatch({effects:setPreview.of(Decoration.set(lines,true))});return;
      }
      const marks=[];
      for(const {from,to,remove,contentFrom,contentTo} of plan.preview.parts || [plan.preview]) {
        if(from>=to)continue;
        marks.push(Decoration.mark({class:`style-preview-${type}${remove?'-off':''}`}).range(from,to));
        if(remove && ['strike','inlinecode'].includes(type)) {
          if(contentFrom<from)marks.push(Decoration.mark({class:`style-preview-${type}-keep`}).range(contentFrom,from));
          if(to<contentTo)marks.push(Decoration.mark({class:`style-preview-${type}-keep`}).range(to,contentTo));
        }
      }
      if(!marks.length){clear();return;}
      view.dispatch({effects:setPreview.of(Decoration.set(marks,true))});
    };
    button.addEventListener('pointerenter',show);button.addEventListener('focus',show);
    button.addEventListener('pointerleave',()=>clear());button.addEventListener('blur',()=>clear());button.addEventListener('click',()=>clear());
  }
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && previewing){clear();event.preventDefault();event.stopPropagation();}},true);
  window.addEventListener('blur',()=>clear());
  return clear;
}
