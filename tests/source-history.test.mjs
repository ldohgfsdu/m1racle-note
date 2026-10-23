import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {EditorState,Transaction} from '@codemirror/state';
import {history,undo,redo,undoDepth,isolateHistory} from '@codemirror/commands';
import {SourceDocument} from '../editor/src/source.mjs';
import {createSourceHistory} from '../editor/src/source-history.mjs';

function fixture(raw) {
 const source=new SourceDocument(raw),{rawField,extensions}=createSourceHistory(()=>source);
 let state=EditorState.create({doc:source.normalized(),extensions:[history(),...extensions]});
 return {source,get state(){return state;},dispatch(spec){const tr=spec.state?spec:state.update(spec);state=tr.state;source.raw=state.field(rawField);assert.equal(source.normalized(),state.doc.toString());}};
}

for(const name of await readdir('editor-corpus'))if(name.endsWith('.md')) {
 test(name+': native undo/redo preserves exact raw bytes',async()=>{
  const raw=await readFile('editor-corpus/'+name,'utf8'),view=fixture(raw),at=Math.min(3,view.state.doc.length);
  const offset=view.source.offset(at);view.dispatch({changes:{from:at,insert:'测🌱'},userEvent:'input.type'});
  const edited=raw.slice(0,offset)+'测🌱'+raw.slice(offset);assert.equal(view.source.raw,edited);
  assert.ok(undo(view));assert.equal(view.source.raw,raw);assert.ok(redo(view));assert.equal(view.source.raw,edited);
 });
}

test('grouped composition replacement restores mixed newline styles in one undo',()=>{
 const raw='\ufeff甲\r\n乙\n丙\r丁\r\n',view=fixture(raw),at=view.state.doc.toString().indexOf('乙')+1;
 view.dispatch({changes:{from:at,to:at+1,insert:'nihao'},userEvent:'input.type.compose.start'});
 view.dispatch({changes:{from:at,to:at+5,insert:'你好'},userEvent:'input.type.compose'});
 const edited=view.source.raw;assert.equal(undoDepth(view.state),1);undo(view);assert.equal(view.source.raw,raw);redo(view);assert.equal(view.source.raw,edited);
});

test('source newline metadata maps through nonhistorical edits',()=>{
 const raw='甲\r\n乙\n丙\r丁',view=fixture(raw),at=view.state.doc.toString().indexOf('乙')+1;
 view.dispatch({changes:{from:at,to:at+1,insert:''},userEvent:'delete.backward'});
 view.dispatch({changes:{from:0,insert:'前\n'},annotations:Transaction.addToHistory.of(false)});
 undo(view);assert.equal(view.source.raw,'前\r\n'+raw);
});

test('undo removes padding at mixed-ending edit boundaries exactly',()=>{
 for(const [raw,from,to,insert] of [['a\rb\nc',2,3,''],['a\nb\rc',4,4,'\n'],['a\rb\nc',3,3,'\n']]) {
  const view=fixture(raw);view.dispatch({changes:{from,to,insert},userEvent:'input.type'});
  const edited=view.source.raw;undo(view);assert.equal(view.source.raw,raw);redo(view);assert.equal(view.source.raw,edited);
 }
});

test('native history groups random mixed-EOL replacements without raw-source drift',()=>{
 let seed=917;
 const random=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
 const inserts=['测','\n','\n\n','🌱','','文\n字'];
 for(let sample=0;sample<100;sample++) {
  const raw='\ufeff甲\r\n乙\n丙\r丁\r\n戊\n'.repeat(5),view=fixture(raw);
  for(let i=0;i<25;i++) {
   const from=random(view.state.doc.length+1),to=Math.min(view.state.doc.length,from+random(5));
   view.dispatch({changes:{from,to,insert:inserts[random(inserts.length)]},userEvent:i?'input.type.compose':'input.type.compose.start'});
  }
  const edited=view.source.raw;assert.equal(undoDepth(view.state),1);undo(view);assert.equal(view.source.raw,raw,'undo sample '+sample);redo(view);assert.equal(view.source.raw,edited,'redo sample '+sample);
 }
});

test('separate undo groups restore each checkpoint, including adjacent mixed endings',()=>{
 let seed=271;
 const random=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
 for(let sample=0;sample<40;sample++) {
  const view=fixture('甲\r\n乙\n丙\r丁\r\n戊\n'.repeat(3)),checkpoints=[view.source.raw];
  for(let i=0;i<15;i++) {
   const from=random(view.state.doc.length+1),to=Math.min(view.state.doc.length,from+1+random(4));
   view.dispatch({changes:{from,to,insert:['\n','测','\n\n','🌱'][i%4]},annotations:isolateHistory.of('full'),userEvent:'input.type'});checkpoints.push(view.source.raw);
  }
  for(let i=checkpoints.length-2;i>=0;i--){assert.ok(undo(view));assert.equal(view.source.raw,checkpoints[i]);}
  for(let i=1;i<checkpoints.length;i++){assert.ok(redo(view));assert.equal(view.source.raw,checkpoints[i]);}
 }
});
