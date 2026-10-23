import {Compartment} from '@codemirror/state';
import {EditorView,lineNumbers,highlightActiveLineGutter} from '@codemirror/view';
import {foldGutter,syntaxTree} from '@codemirror/language';
import {inlinePreview,atomicEditorTheme,atomicMarkdownSyntax,imageBlocks,highlightMarkdown} from '@atomic-editor/editor';
import {compactSelection} from './compact-selection.js';
import {codeBlockTools} from './code-block-tools.js';
export {highlightMarkdown};
const presentation=new Compartment();
export function surfaceExtension(onLinkClick) {
  return presentation.of([atomicEditorTheme,atomicMarkdownSyntax,inlinePreview({onLinkClick}),imageBlocks(),compactSelection,codeBlockTools]);
}
export async function changeSurface(view,rendered,onLinkClick,isCurrent=()=>true) {
  const activeDocument=view.state.doc;
  const selection=view.state.selection.main;
  const rect=view.scrollDOM.getBoundingClientRect(),caret=view.coordsAtPos(selection.head);
  const position=caret && caret.top>=rect.top && caret.bottom<=rect.bottom ? selection.head : view.posAtCoords({x:rect.left+60,y:rect.top+24},false) ?? view.viewport.from;
  const y=view.coordsAtPos(position)?.top ?? rect.top+24;
  view.dom.closest('.pane')?.setAttribute('data-mode',rendered?'rendered':'source');
  view.dispatch({effects:presentation.reconfigure(rendered?[atomicEditorTheme,atomicMarkdownSyntax,inlinePreview({onLinkClick}),imageBlocks(),compactSelection,codeBlockTools]:[lineNumbers(),highlightActiveLineGutter(),foldGutter()])});
  view.dispatch({effects:EditorView.scrollIntoView(position,{y:'start',yMargin:0})});
  for(let i=0;i<4;i++) {
    await new Promise(requestAnimationFrame);
    // Typing, opening another file, or switching again can invalidate the
    // old anchor while a frame is pending. Let the new CM6 state own scroll.
    if(!isCurrent() || view.destroyed || view.state.doc!==activeDocument)return;
    const coords=view.coordsAtPos(position);if(coords)view.scrollDOM.scrollTop+=coords.top-y;
  }
}
export function selectedCode(view) {
  const selection=view.state.selection.main;
  if(!selection.empty)return view.state.sliceDoc(selection.from,selection.to);
  let node=syntaxTree(view.state).resolveInner(selection.head,1);
  while(node && !['FencedCode','CodeBlock'].includes(node.name))node=node.parent;
  const text=node?.getChildren('CodeText') || [];
  return text.length?view.state.sliceDoc(text[0].from,text.at(-1).to):null;
}
