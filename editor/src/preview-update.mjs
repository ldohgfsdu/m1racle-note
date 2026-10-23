import {ensureSyntaxTree,syntaxTree,syntaxTreeAvailable} from '@codemirror/language';

function edgeBlocks(state,tree,position,bias) {
 const point=Math.max(0,Math.min(state.doc.length,position));
 let node=tree.resolveInner(point,bias);
 while(node.parent?.parent)node=node.parent;
 if(node.parent)return [node];
 const line=state.doc.lineAt(point),before=tree.topNode.childBefore(point),after=tree.topNode.childAfter(point);
 // Leading/trailing whitespace on the same physical line belongs to that
 // block. In a gap, include both neighbors: editing a separator may join them.
 if(after && after.from<=line.to && after.to>=line.from)return [after];
 if(before && before.to>=line.from && before.from<=line.to)return [before];
 return [before,after].filter(Boolean);
}

function wholeBlocks(state,tree,range) {
 let {from,to}=range;
 for(const node of [...edgeBlocks(state,tree,from,1),...edgeBlocks(state,tree,to,-1)]) {
  from=Math.min(from,state.doc.lineAt(node.from).from);
  to=Math.max(to,state.doc.lineAt(node.to).to);
 }
 return {from,to};
}

function touchesReference(tree,range) {
 let found=false;
 tree.iterate({from:range.from,to:range.to,enter(node){
  if(node.to<range.from || node.from>range.to)return false;
  if(node.name==='LinkReference'){found=true;return false;}
 }});
 return found;
}

export function previewRegion(before,after,changes,oldSelection,newSelection,selectionChanged) {
 let oldRange=null,newRange=null;
 const include=(range,from,to)=>range?{from:Math.min(range.from,from),to:Math.max(range.to,to)}:{from,to};
 changes.iterChangedRanges((fromA,toA,fromB,toB)=>{
  oldRange=include(oldRange,fromA,toA);newRange=include(newRange,fromB,toB);
 });
 if(selectionChanged) {
  for(const range of oldSelection.ranges)oldRange=include(oldRange,range.from,range.to);
  for(const range of newSelection.ranges)newRange=include(newRange,range.from,range.to);
 }
 if(!oldRange && !newRange)return null;
 const inverse=changes.invertedDesc,oldTree=syntaxTree(before),newTree=syntaxTree(after);
 // Markdown setext headings, list continuation and block delimiters can change
 // the neighbors of an edit. Start with neighboring physical lines, then close
 // over complete old/new parser blocks until their mapped bounds agree.
 const neighboringLines=(state,range)=>{
  const first=state.doc.lineAt(range.from).number,last=state.doc.lineAt(range.to).number;
  return {from:state.doc.line(Math.max(1,first-1)).from,to:state.doc.line(Math.min(state.doc.lines,last+1)).to};
 };
 oldRange=neighboringLines(before,oldRange || {from:inverse.mapPos(newRange.from,-1),to:inverse.mapPos(newRange.to,1)});
 newRange=neighboringLines(after,newRange || {from:changes.mapPos(oldRange.from,-1),to:changes.mapPos(oldRange.to,1)});
 for(let round=0;round<8;round++) {
  const previous=[oldRange.from,oldRange.to,newRange.from,newRange.to];
  oldRange=wholeBlocks(before,oldTree,oldRange);
  newRange=include(newRange,changes.mapPos(oldRange.from,-1),changes.mapPos(oldRange.to,1));
  newRange=wholeBlocks(after,newTree,newRange);
  oldRange=include(oldRange,inverse.mapPos(newRange.from,-1),inverse.mapPos(newRange.to,1));
  if(previous.every((value,i)=>value===[oldRange.from,oldRange.to,newRange.from,newRange.to][i])) {
   // Definitions can affect links anywhere in the document, not just here.
   return touchesReference(oldTree,oldRange) || touchesReference(newTree,newRange)?{full:true}:{before:oldRange,after:newRange};
  }
 }
 return {full:true};
}

// Cache presentation only. Text, parsing, composition, selection and undo remain
// owned by CodeMirror. A partial rebuild uses the original library's builder.
export class PreviewCache {
 constructor(view,build,{selectionSensitive=true}={}) {
  this.build=build;this.selectionSensitive=selectionSensitive;
  this.stats={full:0,partial:0,lastChars:0};this.full(view);
 }
 remember(view) {
  this.doc=view.state.doc;this.selection=view.state.selection;this.focus=view.hasFocus;
  this.complete=syntaxTreeAvailable(view.state,view.state.doc.length);
 }
 full(view) {
  this.decorations=this.build(view);this.stats.full++;this.stats.lastChars=view.state.doc.length;
  this.remember(view);return this.decorations;
 }
 update(update,force=false) {
  const view=update.view,before=update.startState,after=update.state;
  if(force || this.doc!==before.doc || !this.complete || !syntaxTreeAvailable(before,before.doc.length) || !ensureSyntaxTree(after,after.doc.length,200))return this.full(view);
  const selectionChanged=this.selectionSensitive && (!this.selection.eq(after.selection) || this.focus!==view.hasFocus);
  const region=previewRegion(before,after,update.changes,this.selection,after.selection,selectionChanged);
  if(!region){this.remember(view);return this.decorations;}
  if(region.full)return this.full(view);
  const mapped=this.decorations.map(update.changes),fresh=this.build(view,region.after),add=[];
  for(let cursor=fresh.iter();cursor.value;cursor.next())add.push(cursor.value.range(cursor.from,cursor.to));
  const {from:dirtyFrom,to:dirtyTo}=region.after;
  this.decorations=mapped.update({filterFrom:dirtyFrom,filterTo:dirtyTo,
   filter:(from,to)=>dirtyFrom===dirtyTo?!(from<=dirtyTo && to>=dirtyFrom):!((from<dirtyTo || dirtyTo===after.doc.length && from===dirtyTo) && to>=dirtyFrom),add,sort:true});
  this.stats.partial++;this.stats.lastChars=dirtyTo-dirtyFrom;
  this.remember(view);return this.decorations;
 }
}
