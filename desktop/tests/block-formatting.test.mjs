import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EditorState,EditorSelection} from '@codemirror/state';
import {markdown,markdownLanguage} from '@codemirror/lang-markdown';
import {syntaxTree} from '@codemirror/language';
import {history,isolateHistory,undo,redo} from '@codemirror/commands';
import {SourceDocument} from '../../editor/src/source.mjs';
import {FileSession} from '../session.mjs';
import {formatPlan} from '../renderer/formatting.js';

function fixture(raw,type,selection){
  const source=new SourceDocument(raw),text=source.normalized();
  const state=EditorState.create({doc:text,selection:selection??{anchor:0,head:text.length},extensions:[markdown({base:markdownLanguage}),history(),EditorState.allowMultipleSelections.of(true)]});
  const plan=formatPlan(state,type);
  // Preparing a hover plan must not change the source, document, or selection.
  assert.equal(source.raw,raw);assert.equal(state.doc.toString(),text);
  return {source,state,plan,apply:()=>source.apply(plan?.changes??[])};
}

test('block conversion retains BOM, mixed line endings and all surrounding source bytes',()=>{
  const raw='\ufeffoutside  \r\n\r\nalpha  \n\nbeta\r\n\rending  ';
  const normalized=new SourceDocument(raw).normalized(),from=normalized.indexOf('alpha'),to=normalized.indexOf('beta')+4;
  const f=fixture(raw,'ordered',{anchor:from,head:to});
  assert.equal(f.apply(),'\ufeffoutside  \r\n\r\n1. alpha  \n\n2. beta\r\n\rending  ');
  assert.ok(f.plan.changes.every(change=>!/[\r\n]/.test(change.insert)));
  assert.equal(f.plan.preview.rows.length,2);
});

test('a first-line BOM stays before the newly inserted heading marker',()=>{
  const f=fixture('\ufeffalpha\r\n\r\nuntouched','heading-2',{anchor:1,head:6});
  assert.equal(f.apply(),'\ufeff## alpha\r\n\r\nuntouched');
});

test('an empty code-indented line is rejected while three-space heading indentation remains supported',()=>{
  for(const text of ['    ','\t']){
    const state=EditorState.create({doc:text,selection:{anchor:text.length},extensions:[markdown({base:markdownLanguage})]});
    assert.throws(()=>formatPlan(state,'heading-2'));
    assert.equal(state.doc.toString(),text);
  }
  const f=fixture('   ','heading-2',{anchor:3});
  assert.equal(f.apply(),'   ## ');
  assert.match(syntaxTree(f.state.update(f.plan).state).toString(),/ATXHeading2/);
});

test('actual Windows file saving keeps BOM and original EOL bytes after a block edit',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'note-block-source-')),path=join(dir,'note.md');
  try{
    const raw='\ufeffbefore\r\n\r\nalpha\n\nbeta\rafter';await writeFile(path,raw);
    const session=new FileSession(),opened=await session.load(path),normalized=new SourceDocument(opened.raw).normalized();
    const f=fixture(opened.raw,'list',{anchor:normalized.indexOf('alpha'),head:normalized.indexOf('beta')+4});
    await session.save(f.apply());
    assert.deepEqual(await readFile(path),Buffer.from('\ufeffbefore\r\n\r\n- alpha\n\n- beta\rafter'));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('a selection ending at the next line start leaves that line untouched',()=>{
  const f=fixture('alpha\nbeta\ngamma','heading-3',{anchor:0,head:6});
  assert.equal(f.apply(),'### alpha\nbeta\ngamma');
});

test('mixed task application preserves checked tasks and marks only new content unchecked',()=>{
  const f=fixture('- [x] done\n\nnew','task');
  assert.equal(f.apply(),'- [x] done\n\n- [ ] new');
  assert.deepEqual(f.plan.preview.rows.map(row=>row.checked),[true,false]);
});

test('converting an ordered checked task keeps its checked state and matches the preview',()=>{
  const f=fixture('1. [x] done','task');
  assert.equal(f.plan.preview.rows[0].checked,true);
  assert.equal(f.apply(),'- [x] done');
});

test('mixed quotation application does not add an unintended level to existing quotes',()=>{
  const f=fixture('> quoted\n\nplain','quote');
  assert.equal(f.apply(),'> quoted\n\n> plain');
  assert.equal(f.plan.changes.length,1);
});

test('quotation removal removes one explicit level while retaining nested content',()=>{
  const f=fixture('> > deep\n>\n> shallow','quote');
  assert.equal(f.apply(),'> deep\n\nshallow');
  assert.deepEqual(f.plan.preview.rows.map(row=>row.quoteRemains),[true,false,false]);
});

test('ordered conversion preserves blank separators without counting them as items',()=>{
  assert.equal(fixture('first\n\nsecond','ordered').apply(),'1. first\n\n2. second');
  assert.equal(fixture('5. old\n\nnew','ordered').apply(),'5. old\n\n6. new');
});

test('converting ATX headings removes only syntactic closing markers and retains trailing spaces',()=>{
  assert.equal(fixture('# title #  ','heading-0').apply(),'title  ');
  assert.equal(fixture('# title #  ','list').apply(),'- title  ');
  assert.equal(fixture('# title \\#  ','heading-0').apply(),'title \\#  ');
});

for(const [name,raw,type,from,to] of [
  ['fenced code','```txt\nalpha\n```','quote',7,12],
  ['indented code','    alpha','list'],
  ['table','| A | B |\n| --- | --- |\n| a | b |','heading-2'],
  ['HTML block','<div>\nalpha\n</div>','ordered'],
  ['Setext heading','title\n=====','heading-2'],
  ['link reference definition','[a]: https://example.com','heading-2'],
  ['nested list','- alpha\n  - beta\n- gamma','ordered'],
  ['multi-line list item','- alpha\n  continuation','task'],
])test(`unsupported ${name} is rejected without changing source or selection`,()=>{
  const source=new SourceDocument(raw),text=source.normalized(),selection={anchor:from??0,head:to??text.length};
  const state=EditorState.create({doc:text,selection,extensions:[markdown({base:markdownLanguage})]});
  const before=state.selection.toJSON();
  assert.throws(()=>formatPlan(state,type));
  assert.equal(source.raw,raw);assert.equal(state.doc.toString(),text);assert.deepEqual(state.selection.toJSON(),before);
});

test('disjoint block selections preserve direction and restore both ranges through isolated undo and redo',()=>{
  const original=EditorSelection.create([EditorSelection.range(0,5),EditorSelection.range(16,11)],1);
  const f=fixture('alpha\nbeta\ngamma','list',original);
  let current=f.state;
  current=current.update({changes:f.plan.changes,selection:f.plan.selection,annotations:isolateHistory.of('full'),userEvent:'input.format'}).state;
  assert.equal(current.doc.toString(),'- alpha\nbeta\n- gamma');
  assert.equal(current.selection.mainIndex,1);
  assert.deepEqual(current.selection.ranges.map(range=>[range.anchor,range.head]),[[2,7],[20,15]]);
  const target=()=>({state:current,dispatch:transaction=>{current=transaction.state;}});
  assert.equal(undo(target()),true);assert.equal(current.doc.toString(),'alpha\nbeta\ngamma');assert.deepEqual(current.selection.toJSON(),original.toJSON());
  assert.equal(redo(target()),true);assert.equal(current.doc.toString(),'- alpha\nbeta\n- gamma');assert.equal(undo(target()),true);assert.equal(undo(target()),false);
});

test('disjoint selections on one physical line insert only one block prefix',()=>{
  const selection=EditorSelection.create([EditorSelection.range(0,1),EditorSelection.range(3,4)]);
  const f=fixture('alpha','quote',selection);
  assert.equal(f.apply(),'> alpha');assert.equal(f.plan.changes.length,1);
  assert.equal(f.plan.selection.ranges.length,2);
});

test('applying a line format collapses one text selection so the next Enter keeps the text',()=>{
  const raw='\ufeff# 工具验证\r\n\r\n写作内容。\r\n\r保留后文。\n',source=new SourceDocument(raw),text=source.normalized();
  const from=text.indexOf('写作内容。'),to=from+5;
  for(const [type,prefix] of [['heading-1','# '],['heading-2','## '],['list','- '],['ordered','1. '],['task','- [ ] '],['quote','> ']]){
    const state=EditorState.create({doc:text,selection:{anchor:from,head:to},extensions:[markdown({base:markdownLanguage})]});
    const plan=formatPlan(state,type),next=state.update({changes:plan.changes,selection:plan.selection,userEvent:'input.format'}).state;
    assert.equal(next.selection.ranges.length,1,type);assert.ok(next.selection.main.empty,type);
    assert.equal(next.selection.main.head,to+prefix.length,type);
    const entered=next.update({changes:{from:next.selection.main.head,insert:'\n'},userEvent:'input'}).state;
    assert.ok(entered.doc.toString().includes(prefix+'写作内容。'),type);
  }
  const reversed=EditorState.create({doc:text,selection:{anchor:to,head:from},extensions:[markdown({base:markdownLanguage})]});
  assert.equal(reversed.update({changes:formatPlan(reversed,'heading-1').changes,selection:formatPlan(reversed,'heading-1').selection,userEvent:'input.format'}).state.selection.main.head,to+2);
});
