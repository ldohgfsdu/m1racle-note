import {EditorState} from '@codemirror/state';
import {syntaxTree} from '@codemirror/language';

const marks={StrongEmphasis:'EmphasisMark',Emphasis:'EmphasisMark',Strikethrough:'StrikethroughMark',InlineCode:'CodeMark',Link:'LinkMark'};

// Native CM6 cursor motion skips collapsed delimiters. When a replacement
// covers all visible text plus one delimiter, include the other hidden edge
// too, so replacing a whole rendered line cannot leave an orphan `**` / `[`.
// Partial text inside a format, and every source-mode transaction, keep their
// original CM6 ranges. Lezer supplies all syntax boundaries.
export function completeHiddenEdges(state,from,to) {
 const tree=syntaxTree(state),nodes=new Map();
 for(const [position,bias] of [[from,1],[to,-1]]) {
  for(let node=tree.resolveInner(position,bias);node;node=node.parent) {
   if(marks[node.name])nodes.set(`${node.from}:${node.to}:${node.name}`,node);
  }
 }
 let changed;
 do {
  changed=false;
  for(const node of nodes.values()) {
   const tokens=node.getChildren(marks[node.name]);
   if(tokens.length<2)continue;
   const contentFrom=tokens[0].to;
   const contentTo=node.name==='Link'?(tokens.find(token=>state.sliceDoc(token.from,token.to)===']')?.from ?? node.to):tokens.at(-1).from;
   if(from>node.from && from<=contentFrom && to>=node.to){from=node.from;changed=true;}
   if(to<node.to && to>=contentTo && from<=node.from){to=node.to;changed=true;}
  }
 }while(changed);
 return {from,to};
}

export function renderedBoundaryEdits(isRendered) {
 return EditorState.transactionFilter.of(transaction=>{
  if(!isRendered() || !transaction.docChanged || transaction.effects.length ||
   !['input.type','input.paste','input.drop','delete'].some(event=>transaction.isUserEvent(event)))return transaction;
  const selection=transaction.startState.selection;
  if(selection.ranges.length!==1 || selection.main.empty)return transaction;
  const changes=[];
  transaction.changes.iterChanges((from,to,_fromB,_toB,insert)=>changes.push({from,to,insert:insert.toString()}));
  if(changes.length!==1 || changes[0].from!==selection.main.from || changes[0].to!==selection.main.to)return transaction;
  const original=changes[0],range=completeHiddenEdges(transaction.startState,original.from,original.to);
  if(range.from===original.from && range.to===original.to)return transaction;
  return {changes:{...range,insert:original.insert},selection:{anchor:range.from+original.insert.length},
   annotations:transaction.annotations,scrollIntoView:transaction.scrollIntoView};
 });
}
