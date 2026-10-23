import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState} from '@codemirror/state';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {history,undo,redo} from '@codemirror/commands';
import {renderedBoundaryEdits} from '../renderer/rendered-input.js';

function fixture(text,from,to,rendered=true) {
 let state=EditorState.create({doc:text,selection:{anchor:from,head:to},extensions:[markdown({base:markdownLanguage}),history(),renderedBoundaryEdits(()=>rendered)]});
 return {get state(){return state;},dispatch:transaction=>{state=transaction.state??state.update(transaction).state;}};
}

test('whole rendered line replacement and deletion include collapsed opening syntax',()=>{
 for(const replacement of ['替换','']) {
  const text='**粗体** 和 [链接](https://example.com)。',view=fixture(text,2,text.length);
  view.dispatch({changes:{from:2,to:text.length,insert:replacement},userEvent:replacement?'input.type':'delete.selection'});
  assert.equal(view.state.doc.toString(),replacement);
  assert.equal(undo(view),true);assert.equal(view.state.doc.toString(),text);
  assert.equal(redo(view),true);assert.equal(view.state.doc.toString(),replacement);
 }
});

test('a selection ending at a hidden closing delimiter leaves no dangling markup',()=>{
 for(const [text,to] of [['前缀 **粗体**',8],['前缀 `代码`',6],['前缀 [链接](https://example.com)',6]]) {
  const view=fixture(text,0,to);view.dispatch({changes:{from:0,to,insert:'替换'},userEvent:'input.paste'});
  assert.equal(view.state.doc.toString(),'替换');
 }
});

test('nested complete markup is expanded but partial text and source mode retain exact ranges',()=>{
 const text='**_粗体_** 尾部',view=fixture(text,3,text.length);
 view.dispatch({changes:{from:3,to:text.length,insert:'替换'},userEvent:'input.type'});
 assert.equal(view.state.doc.toString(),'替换');
 const partial=fixture('**粗体文字**',3,4);
 partial.dispatch({changes:{from:3,to:4,insert:'新'},userEvent:'input.type'});
 assert.equal(partial.state.doc.toString(),'**粗新文字**');
 const source=fixture('**粗体** 后文',2,9,false);
 source.dispatch({changes:{from:2,to:9,insert:'替换'},userEvent:'input.type'});
 assert.equal(source.state.doc.toString(),'**替换');
});
