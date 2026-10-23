import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorState,EditorSelection} from '@codemirror/state';
import {markdown} from '@codemirror/lang-markdown';
import {SourceDocument} from '../../editor/src/source.mjs';
import {blockChanges,insertion,inlineCode,headingTarget,inlineStylePlan,tableInsertion} from '../renderer/formatting.js';

test('inline formatting excludes surrounding whitespace and validates parsed style',()=>{
  const text='文档 Windows 正文。',state=EditorState.create({doc:text,selection:{anchor:2,head:11},extensions:[markdown()]});
  const plan=inlineStylePlan(state,'italic');
  assert.equal(state.update(plan).state.doc.toString(),'文档 *Windows* 正文。');
  assert.deepEqual(plan.preview,{from:3,to:10,remove:false});
});
test('partially removing bold splits balanced spans without swallowing spaces',()=>{
  const state=EditorState.create({doc:'**one two three**',selection:{anchor:6,head:9},extensions:[markdown()]});
  const plan=inlineStylePlan(state,'bold');
  assert.equal(state.update(plan).state.doc.toString(),'**one** two **three**');
  assert.equal(plan.preview.remove,true);
});
test('inline code toggles off and formatting does not cross paragraph boundaries',()=>{
  const state=EditorState.create({doc:'`code`',selection:{anchor:1,head:5},extensions:[markdown()]});
  assert.equal(state.update(inlineStylePlan(state,'inlinecode')).state.doc.toString(),'code');
  const multi=EditorState.create({doc:'one\n\ntwo',selection:{anchor:0,head:8},extensions:[markdown()]});
  assert.throws(()=>inlineStylePlan(multi,'bold'));
});

test('multi-line list edits preserve every unselected byte and original line ending',()=>{
  const raw='\ufeff开头\r\n第一项\n第二项\r\n结尾',source=new SourceDocument(raw);
  const text=source.normalized();
  const state=EditorState.create({doc:text,selection:{anchor:text.indexOf('第一项'),head:text.indexOf('结尾')}});
  const changes=blockChanges(state,'list');
  assert.equal(source.apply(changes),'\ufeff开头\r\n- 第一项\n- 第二项\r\n结尾');
});
test('selection ending at the next line does not format that line',()=>{
  const state=EditorState.create({doc:'甲\n乙\n丙',selection:{anchor:0,head:4}});
  assert.equal(state.update({changes:blockChanges(state,'ordered')}).state.doc.toString(),'1. 甲\n2. 乙\n丙');
});
test('quote toggle removes one level and retains indentation',()=>{
  const text='  > > 甲\n  > 乙';
  const state=EditorState.create({doc:text,selection:{anchor:0,head:text.length}});
  assert.equal(state.update({changes:blockChanges(state,'quote')}).state.doc.toString(),'  > 甲\n  乙');
});
test('checked task conversion and toggling preserve body text',()=>{
  const state=EditorState.create({doc:'- [x] 完成\n- [ ] 待办',selection:{anchor:0,head:17}});
  assert.equal(state.update({changes:blockChanges(state,'task')}).state.doc.toString(),'完成\n待办');
  assert.equal(state.update({changes:blockChanges(state,'ordered')}).state.doc.toString(),'1. 完成\n2. 待办');
});
test('links and images escape delimiter characters; unsafe targets are rejected',()=>{
  assert.equal(insertion('link',{label:'[文字]',target:'https://example.com/a (b)'}).suffix,'](https://example.com/a%20%28b%29)');
  assert.equal(insertion('image',{label:'图片',target:'images/图片 1.png'}).suffix,'](images/图片%201.png)');
  assert.throws(()=>insertion('link',{target:'javascript:alert(1)'}));
  assert.throws(()=>insertion('link',{target:'https://'}));
  assert.throws(()=>insertion('image',{target:'../private.png'}));
  assert.throws(()=>insertion('image',{target:'image.svg'}));
});
test('code delimiters cannot be closed by selected backticks',()=>{
  assert.equal(insertion('fence',{language:'python'},'```\nprint(1)').prefix,'````python\n');
  assert.equal(inlineCode('a ` b').prefix,'``');
  assert.throws(()=>insertion('fence',{language:'js\n```'},'text'));
});
test('heading links handle Chinese, emphasis, duplicate headings and ignore fenced content',()=>{
  const text='# 目录\n\n```md\n# 假标题\n```\n\n## 今天 **安排**\n\n## 今天 **安排**\n';
  const state=EditorState.create({doc:text,extensions:[markdown()]});
  assert.equal(headingTarget(state,'#'+encodeURIComponent('今天-安排')),text.indexOf('## 今天'));
  assert.equal(headingTarget(state,'#今天-安排-1'),text.lastIndexOf('## 今天'));
  assert.equal(headingTarget(state,'#假标题'),null);
});

test('table insertion keeps selected text and separates adjacent paragraphs',()=>{
 for(const text of ['正文后半段','正文\n后半段','正文\n\n后半段']) {
  const state=EditorState.create({doc:text,selection:{anchor:0,head:2}}),plan=tableInsertion(state),next=state.update(plan).state;
  assert.match(next.doc.toString(),/^正文\n\n\| 标题 \| 标题 \|\n\| --- \| --- \|\n\| 内容 \| 内容 \|\n\n后半段$/);
  assert.equal(next.sliceDoc(next.selection.main.from,next.selection.main.to),'标题');
 }
 const raw='\ufeff开头\r\n正文\n结尾\r',source=new SourceDocument(raw),text=source.normalized();
 const state=EditorState.create({doc:text,selection:{anchor:text.indexOf('正文'),head:text.indexOf('正文')+2}}),plan=tableInsertion(state);
 assert.equal(source.apply([plan.changes]),raw.slice(0,raw.indexOf('正文')+2)+plan.changes.insert.replaceAll('\n','\r\n')+raw.slice(raw.indexOf('正文')+2));
});

test('tables inserted in an empty document or at the end have an editable header',()=>{
 for(const text of ['', '最后一段\n', '最后一段\n\n']) {
  const state=EditorState.create({doc:text,selection:{anchor:text.length}}),plan=tableInsertion(state),next=state.update(plan).state;
  assert.equal(next.sliceDoc(next.selection.main.from,next.selection.main.to),'标题');
  assert.ok(next.doc.toString().endsWith('| 内容 | 内容 |\n'));
  assert.ok(next.doc.toString().startsWith(text));
 }
});

test('multiple selections format all ranges and retain existing matching styles',()=>{
 const text='one one one',state=EditorState.create({doc:text,selection:EditorSelection.create([EditorSelection.range(0,3),EditorSelection.range(4,7),EditorSelection.range(8,11)]),extensions:[markdown(),EditorState.allowMultipleSelections.of(true)]});
 const plan=inlineStylePlan(state,'bold'),next=state.update(plan).state;
 assert.equal(next.doc.toString(),'**one** **one** **one**');assert.equal(next.selection.ranges.length,3);
 assert.equal(plan.preview.parts.length,3);
 const mixed=EditorState.create({doc:'**one** one',selection:EditorSelection.create([EditorSelection.range(2,5),EditorSelection.range(8,11)]),extensions:[markdown(),EditorState.allowMultipleSelections.of(true)]});
 assert.equal(mixed.update(inlineStylePlan(mixed,'bold')).state.doc.toString(),'**one** **one**');
 assert.equal(next.update(inlineStylePlan(next,'bold')).state.doc.toString(),text);
});

test('overlapping format removals fail before modifying the source',()=>{
 const state=EditorState.create({doc:'**one two**',selection:EditorSelection.create([EditorSelection.range(2,5),EditorSelection.range(6,9)]),extensions:[markdown(),EditorState.allowMultipleSelections.of(true)]});
 assert.throws(()=>inlineStylePlan(state,'bold'),/同一段格式/);assert.equal(state.doc.toString(),'**one two**');
});
